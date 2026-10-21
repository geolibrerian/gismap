// 3D models (glTF/GLB, OBJ, PLY) for CAD and asset data, placed either at an
// anchor (longitude, latitude, altitude) or from absolute projected coordinates.
import { loadThreeAddon } from "./three-host.js?v=0.1.0";
import { localFrame, projectionFor } from "../../geo-frame.js?v=0.1.0";

const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LON = 111320;

async function readModel(THREE, { url, file }) {
  const name = file?.name || url;
  const extension = name.split(/[?#]/)[0].split(".").pop().toLowerCase();
  const buffer = file ? await file.arrayBuffer() : await fetch(url).then((response) => {
    if (!response.ok) throw new Error(`The model could not be downloaded (HTTP ${response.status}).`);
    return response.arrayBuffer();
  });
  if (extension === "glb" || extension === "gltf") {
    const { GLTFLoader } = await loadThreeAddon("loaders/GLTFLoader.js");
    const base = url ? url.slice(0, url.lastIndexOf("/") + 1) : "";
    return new Promise((resolve, reject) => new GLTFLoader().parse(buffer, base, (gltf) => resolve(gltf.scene), (error) => reject(new Error(`The glTF model could not be read (${error.message || error}).`))));
  }
  if (extension === "obj") {
    const { OBJLoader } = await loadThreeAddon("loaders/OBJLoader.js");
    return new OBJLoader().parse(new TextDecoder().decode(buffer));
  }
  if (extension === "ply") {
    const { PLYLoader } = await loadThreeAddon("loaders/PLYLoader.js");
    const geometry = new PLYLoader().parse(buffer);
    const colored = Boolean(geometry.getAttribute("color"));
    if (!geometry.index) return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 2, sizeAttenuation: false, vertexColors: colored }));
    geometry.computeVertexNormals();
    return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: colored, color: colored ? 0xffffff : 0xb0b8c0 }));
  }
  throw new Error(`3D models must be .glb, .gltf, .obj or .ply, not .${extension}.`);
}

/** A model ready for ThreeHost: { item, bounds, info }. `options` are normalized scene3d options. */
export async function buildModel(THREE, source, options) {
  const object = await readModel(THREE, source);
  object.traverse((child) => {
    [child.material].flat().forEach((material) => {
      if (!material) return;
      // The map frame mirrors north, which turns triangles over: draw both faces.
      material.side = THREE.DoubleSide;
      if (options.color && !material.vertexColors) material.color?.set(options.color);
    });
  });
  const root = new THREE.Group();
  let frame, vertices = 0;
  if (options.crs) {
    // Absolute coordinates (as CAD exports them): bake every vertex into the local frame.
    const projection = await projectionFor(options.crs);
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const native = (v) => (options.upAxis === "y" ? [v.x, -v.z, v.y] : [v.x, v.y, v.z]);
    const [cx, cy] = native(center);
    frame = localFrame(projection.forward(cx, cy));
    const v = new THREE.Vector3();
    const meshes = [];
    object.traverse((child) => { if (child.geometry?.getAttribute?.("position")) meshes.push(child); });
    for (const child of meshes) {
      child.geometry = child.geometry.clone();
      const positions = child.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        v.fromBufferAttribute(positions, i).applyMatrix4(child.matrixWorld);
        const [x, y, z] = native(v);
        const [lon, lat] = projection.forward(x, y);
        const [e, n] = frame.toLocal(lon, lat);
        positions.setXYZ(i, e, n, z * projection.unitFactor * options.verticalExaggeration + options.zOffset);
      }
      vertices += positions.count;
      positions.needsUpdate = true;
      child.geometry.computeBoundingSphere();
      child.geometry.computeVertexNormals?.();
    }
    // Every transform is now in the vertices: clear them all, or nested groups apply twice.
    object.traverse((child) => { child.position.set(0, 0, 0); child.rotation.set(0, 0, 0); child.scale.set(1, 1, 1); child.updateMatrix(); });
    root.add(object);
  } else {
    const [lon, lat, altitude] = options.anchor;
    frame = localFrame([lon, lat]);
    const placed = new THREE.Group();
    placed.add(object);
    if (options.upAxis === "y") object.rotation.x = Math.PI / 2;
    placed.rotation.z = -(options.heading * Math.PI) / 180;
    placed.scale.setScalar(options.scale);
    placed.position.z = altitude + options.zOffset;
    root.add(placed);
    object.traverse((child) => { vertices += child.geometry?.getAttribute?.("position")?.count || 0; });
  }
  if (options.crs && options.heightReference === "ground") {
    // CAD in absolute coordinates: its lowest point sits on the ground.
    root.updateMatrixWorld(true);
    root.position.z -= new THREE.Box3().setFromObject(root).min.z;
  }
  root.add(new THREE.AmbientLight(0xffffff, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(0.4, -0.6, 1);
  root.add(sun);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const [originLon, originLat] = frame.origin;
  const degrees = (e, n) => [originLon + e / (METERS_PER_DEGREE_LON * Math.cos((originLat * Math.PI) / 180)), originLat + n / METERS_PER_DEGREE_LAT];
  const [west, south] = degrees(box.min.x, box.min.y), [east, north] = degrees(box.max.x, box.max.y);
  const scene = new THREE.Scene();
  scene.add(root);
  return {
    item: { scene, origin: frame.mercatorOrigin, scale: frame.mercatorScale, lngLat: frame.origin, onTerrain: options.heightReference === "ground" },
    bounds: [west, south, east, north],
    info: { kind: "model", vertices, placement: options.crs ? "crs" : "anchor", size: [box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z].map((value) => Math.round(value * 100) / 100) },
  };
}
