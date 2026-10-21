// LiDAR point clouds (LAS, LAZ, XYZ) as three.js Points in a local metre frame.
import { lasCrs, parseLas, readLasHeader, readLasPoints } from "../../pointcloud-las.js?v=0.1.0";
import { parseXyz, pointColors } from "../../pointcloud-color.js?v=0.1.0";
import { localFrame, projectionFor, unitFactor } from "../../geo-frame.js?v=0.1.0";

const LAZ_PERF = "https://cdn.jsdelivr.net/npm/laz-perf@0.0.6/lib/web/";
let lazPerfLoading = null;

/** The laz-perf WebAssembly decoder (LASzip), loaded once. */
function loadLazPerf() {
  lazPerfLoading ??= new Promise((resolve, reject) => {
    if (globalThis.createLazPerf) return resolve(globalThis.createLazPerf);
    const script = document.createElement("script");
    script.src = `${LAZ_PERF}laz-perf.js`;
    script.addEventListener("load", () => (globalThis.createLazPerf ? resolve(globalThis.createLazPerf) : reject(new Error("The LAZ decoder did not load."))), { once: true });
    script.addEventListener("error", () => reject(new Error("The LAZ decoder could not be downloaded.")), { once: true });
    document.head.append(script);
  }).then((create) => create({ locateFile: (name) => `${LAZ_PERF}${name}` })).catch((error) => { lazPerfLoading = null; throw error; });
  return lazPerfLoading;
}

async function decodeLaz(buffer, header, options) {
  const Module = await loadLazPerf();
  const filePointer = Module._malloc(buffer.byteLength);
  const zip = new Module.LASZip();
  let pointPointer = 0;
  try {
    Module.HEAPU8.set(new Uint8Array(buffer), filePointer);
    zip.open(filePointer, buffer.byteLength);
    const pointLength = zip.getPointLength();
    pointPointer = Module._malloc(pointLength);
    // Every point is decompressed in order; readLasPoints keeps every step-th one.
    const record = () => { zip.getPoint(pointPointer); return new DataView(Module.HEAPU8.buffer, pointPointer, pointLength); };
    return readLasPoints({ ...header, count: zip.getCount(), pointLength }, record, options);
  } finally {
    zip.delete();
    Module._free(filePointer);
    if (pointPointer) Module._free(pointPointer);
  }
}

async function readSource({ url, file }) {
  if (file) return { name: file.name, buffer: await file.arrayBuffer() };
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The point cloud could not be downloaded (HTTP ${response.status}).`);
  return { name: url, buffer: await response.arrayBuffer() };
}

/** Parsed points in their file CRS: { count, total, step, positions, intensity, classification, rgb, crs }. */
export async function readPointCloud(source, options = {}) {
  const { name, buffer } = await readSource(source);
  const extension = name.split(/[?#]/)[0].split(".").pop().toLowerCase();
  if (["xyz", "pts", "txt", "csv"].includes(extension)) return parseXyz(new TextDecoder().decode(buffer), options);
  const header = readLasHeader(buffer);
  if (!header.compressed) return parseLas(buffer, options);
  return { header, crs: lasCrs(header), ...(await decodeLaz(buffer, header, options)) };
}

/**
 * A point cloud ready for ThreeHost: { item, bounds: [w, s, e, n], info }.
 * `options` are normalized scene3d options (js/scene3d.js).
 */
export async function buildPointCloud(THREE, source, options) {
  const cloud = await readPointCloud(source, options);
  if (!cloud.count) throw new Error("The point cloud has no points.");
  const crs = options.crs || (cloud.crs?.epsg ? `EPSG:${cloud.crs.epsg}` : cloud.crs?.wkt);
  if (!crs) throw new Error("This point cloud does not say which coordinate system it uses. Add scene3d.crs, such as EPSG:26910 or EPSG:2992.");
  const projection = await projectionFor(crs);
  const zFactor = cloud.crs?.verticalUnits ? unitFactor(cloud.crs.verticalUnits) : projection.unitFactor;
  // Keep only the requested classes before any work per point.
  const wanted = options.classes && cloud.classification ? new Set(options.classes) : null;
  const keep = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < cloud.count; i++) {
    if (wanted && !wanted.has(cloud.classification[i])) continue;
    keep.push(i);
    const x = cloud.positions[i * 3], y = cloud.positions[i * 3 + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!keep.length) throw new Error("No points match the requested classes.");
  const center = projection.forward((minX + maxX) / 2, (minY + maxY) / 2);
  const frame = localFrame(center);
  const positions = new Float32Array(keep.length * 3);
  const subset = { count: keep.length, positions, intensity: cloud.intensity && new Uint16Array(keep.length), classification: cloud.classification && new Uint8Array(keep.length), rgb: cloud.rgb && new Uint16Array(keep.length * 3) };
  let west = 180, south = 90, east = -180, north = -90, low = Infinity, high = -Infinity;
  keep.forEach((index, n) => {
    const [lon, lat] = projection.forward(cloud.positions[index * 3], cloud.positions[index * 3 + 1]);
    const z = cloud.positions[index * 3 + 2] * zFactor * options.verticalExaggeration + options.zOffset;
    const [e, northing] = frame.toLocal(lon, lat);
    positions.set([e, northing, z], n * 3);
    if (lon < west) west = lon; if (lon > east) east = lon; if (lat < south) south = lat; if (lat > north) north = lat;
    if (z < low) low = z; if (z > high) high = z;
    if (subset.intensity) subset.intensity[n] = cloud.intensity[index];
    if (subset.classification) subset.classification[n] = cloud.classification[index];
    if (subset.rgb) subset.rgb.set(cloud.rgb.subarray(index * 3, index * 3 + 3), n * 3);
  });
  if (!(Number.isFinite(west) && Math.abs(north) <= 90)) throw new Error("The points did not reproject to valid longitude and latitude; check the CRS.");
  // Ground-relative heights: the 2nd-percentile elevation becomes 0 (the host adds the terrain height).
  let ground = 0;
  if (options.heightReference === "ground") {
    const sample = [];
    for (let i = 2; i < positions.length; i += Math.max(3, Math.floor(positions.length / 30000) * 3)) sample.push(positions[i]);
    sample.sort((a, b) => a - b);
    ground = sample[Math.floor(sample.length * 0.02)] ?? 0;
    for (let i = 2; i < positions.length; i += 3) positions[i] -= ground;
    low -= ground; high -= ground;
  }
  const { colors, mode, legend } = pointColors(subset, options.colorBy);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: options.pointSize, sizeAttenuation: false, vertexColors: true });
  let update;
  if (options.animate?.type === "reveal") {
    // Points appear from the lowest to the highest as the shared clock runs.
    const reveal = { value: high };
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uReveal = reveal;
      shader.vertexShader = shader.vertexShader.replace("void main() {", "uniform float uReveal;\nvoid main() {").replace("#include <project_vertex>", "#include <project_vertex>\n\tif (position.z > uReveal) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);");
    };
    const { durationMs, loop } = options.animate;
    update = (time) => { const progress = loop ? (time % durationMs) / durationMs : Math.min(1, time / durationMs); reveal.value = low + (high - low) * progress; };
  }
  const scene = new THREE.Scene();
  scene.add(new THREE.Points(geometry, material));
  return {
    item: { scene, origin: frame.mercatorOrigin, scale: frame.mercatorScale, lngLat: frame.origin, onTerrain: options.heightReference === "ground", update, animated: Boolean(update) },
    bounds: [west, south, east, north],
    info: { kind: "pointcloud", points: keep.length, total: cloud.total, step: cloud.step, crs: /^EPSG:/i.test(crs) ? crs : "WKT/proj4", colorMode: mode, legend, heightReference: options.heightReference, groundElevation: ground, heightRange: [low, high] },
  };
}
