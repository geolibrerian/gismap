// Optional decorative renderer for *observed* GeoJSON boundaries. It converts
// only WGS84 coordinates to a local metre frame; it never interpolates, buffers,
// or otherwise changes the selected observation geometry.
import { localFrame } from "../geo-frame.js?v=0.1.0";

const finiteCoordinate = (coordinate) => Array.isArray(coordinate)
  && Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1]))
  && Math.abs(Number(coordinate[0])) <= 180 && Math.abs(Number(coordinate[1])) <= 90;

function appendPaths(geometry, paths) {
  if (!geometry || typeof geometry !== "object") return;
  const append = (coordinates) => coordinates?.forEach((path) => {
    const usable = path?.filter(finiteCoordinate);
    if (usable?.length >= 2) paths.push(usable);
  });
  if (geometry.type === "LineString") append([geometry.coordinates]);
  else if (geometry.type === "MultiLineString" || geometry.type === "Polygon") append(geometry.coordinates);
  else if (geometry.type === "MultiPolygon") geometry.coordinates?.forEach(append);
  else if (geometry.type === "GeometryCollection") geometry.geometries?.forEach((item) => appendPaths(item, paths));
}

/**
 * Return drawable paths without modifying coordinates. Bounds prevent a
 * cumulative timeline from exhausting the GPU on a large record set.
 */
export function observedBoundaryPaths(features = [], { maxPaths = 1200, maxVertices = 50000 } = {}) {
  const paths = [];
  let vertices = 0;
  for (const feature of features) {
    const candidate = [];
    appendPaths(feature?.geometry || feature, candidate);
    for (const path of candidate) {
      if (paths.length >= maxPaths || vertices + path.length > maxVertices) return paths;
      paths.push(path);
      vertices += path.length;
    }
  }
  return paths;
}

/**
 * Make a ThreeHost item. MapLibre's shared WebGL context cannot reliably draw
 * wide lines, so a translucent outer stroke plus a narrow inner stroke gives a
 * restrained glow using standard materials (and no independent animation loop).
 */
export function buildObservedBoundaryGlow(THREE, features, { color = "#ff8136" } = {}) {
  const paths = observedBoundaryPaths(features);
  const origin = paths[0]?.[0];
  if (!origin) return null;
  const frame = localFrame(origin);
  const scene = new THREE.Scene();
  for (const path of paths) {
    const points = path.map(([longitude, latitude]) => new THREE.Vector3(...frame.toLocal(longitude, latitude, 0)));
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const halo = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false });
    const core = new THREE.LineBasicMaterial({ color: "#fff3e8", transparent: true, opacity: 0.9, depthWrite: false });
    const haloLine = new THREE.Line(geometry, halo);
    const coreLine = new THREE.Line(geometry.clone(), core);
    coreLine.position.z = 0.15;
    scene.add(haloLine, coreLine);
  }
  return { scene, origin: frame.mercatorOrigin, scale: frame.mercatorScale, lngLat: { lng: origin[0], lat: origin[1] }, onTerrain: true };
}
