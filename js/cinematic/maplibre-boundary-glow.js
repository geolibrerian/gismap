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
 * Make a ThreeHost item. WebGL's LineBasicMaterial cannot reliably draw wide
 * lines, so the glow uses two exact-coordinate mesh ribbons instead. The
 * ribbons render above the shared map depth buffer so the terrain cannot hide
 * a selected observed boundary.
 */
export function buildObservedBoundaryGlow(THREE, features, { color = "#ff8136" } = {}) {
  const paths = observedBoundaryPaths(features);
  const origin = paths[0]?.[0];
  if (!origin) return null;
  const frame = localFrame(origin);
  const scene = new THREE.Scene();
  for (const path of paths) {
    const localPath = path.map(([longitude, latitude]) => frame.toLocal(longitude, latitude, 0));
    const ribbon = (halfWidth, elevation) => {
      const positions = [];
      for (let index = 1; index < localPath.length; index += 1) {
        const [x1, y1] = localPath[index - 1];
        const [x2, y2] = localPath[index];
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (!length) continue;
        const offsetX = (-dy / length) * halfWidth;
        const offsetY = (dx / length) * halfWidth;
        positions.push(
          x1 + offsetX, y1 + offsetY, elevation, x1 - offsetX, y1 - offsetY, elevation, x2 + offsetX, y2 + offsetY, elevation,
          x2 + offsetX, y2 + offsetY, elevation, x1 - offsetX, y1 - offsetY, elevation, x2 - offsetX, y2 - offsetY, elevation,
        );
      }
      return positions.length ? new THREE.BufferGeometry().setAttribute("position", new THREE.Float32BufferAttribute(positions, 3)) : null;
    };
    const haloGeometry = ribbon(28, 2);
    const coreGeometry = ribbon(7, 2.2);
    if (!haloGeometry || !coreGeometry) continue;
    const halo = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending });
    const core = new THREE.MeshBasicMaterial({ color: "#fff4e8", transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
    scene.add(new THREE.Mesh(haloGeometry, halo), new THREE.Mesh(coreGeometry, core));
  }
  return { scene, origin: frame.mercatorOrigin, scale: frame.mercatorScale, lngLat: { lng: origin[0], lat: origin[1] }, onTerrain: true };
}
