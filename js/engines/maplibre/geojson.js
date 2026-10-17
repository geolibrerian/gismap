// GeoJSON helpers for the MapLibre engine: features in, the plain shapes the
// engine contract uses out (fields, geometry types, bounds, representative
// points). Pure: no DOM, no map SDK. Coordinates are WGS84 longitude/latitude.

export const OBJECT_ID_FIELD = "__OBJECTID";

const GEOMETRY_TYPES = {
  Point: "point", MultiPoint: "multipoint",
  LineString: "polyline", MultiLineString: "polyline",
  Polygon: "polygon", MultiPolygon: "polygon",
};

/**
 * Features from any GeoJSON object (FeatureCollection, Feature or bare
 * geometry), each with a numeric id. With `objectIdField` (features from an
 * ArcGIS service) the id is that field's value, so IDs match the service;
 * otherwise features are numbered and the number is kept in __OBJECTID, as
 * the ArcGIS GeoJSON layer numbers them.
 */
export function normalizeFeatures(json, { objectIdField = null } = {}) {
  if (!json || typeof json !== "object") throw new Error("The file is not GeoJSON.");
  const list = json.type === "FeatureCollection" ? json.features || []
    : json.type === "Feature" ? [json]
      : json.type === "GeometryCollection" ? (json.geometries || []).map((geometry) => ({ type: "Feature", geometry, properties: {} }))
        : GEOMETRY_TYPES[json.type] ? [{ type: "Feature", geometry: json, properties: {} }]
          : null;
  if (!list) throw new Error("The file is not GeoJSON (no FeatureCollection, Feature or geometry).");
  return list.filter((feature) => feature && typeof feature === "object").map((feature, index) => {
    const own = objectIdField ? Number(feature.properties?.[objectIdField] ?? feature.id) : NaN;
    if (Number.isFinite(own)) return { type: "Feature", id: own, geometry: feature.geometry ?? null, properties: { ...(feature.properties || {}), [objectIdField]: own } };
    const id = index + 1;
    return { type: "Feature", id, geometry: feature.geometry ?? null, properties: { ...(feature.properties || {}), [OBJECT_ID_FIELD]: id } };
  });
}

/** Fields (engine-interface.js Field) from the properties the features carry. */
export function inferFields(features) {
  const kinds = new Map();
  for (const feature of features) {
    for (const [name, value] of Object.entries(feature.properties || {})) {
      if (name === OBJECT_ID_FIELD || value == null || value === "") { if (!kinds.has(name) && name !== OBJECT_ID_FIELD) kinds.set(name, null); continue; }
      const kind = typeof value === "number" ? (Number.isInteger(value) ? "integer" : "double") : "string";
      const known = kinds.get(name);
      kinds.set(name, !known ? kind : known === kind ? known : known !== "string" && kind !== "string" ? "double" : "string");
    }
  }
  return [
    { name: OBJECT_ID_FIELD, alias: OBJECT_ID_FIELD, type: "oid", domain: null },
    ...[...kinds].map(([name, kind]) => ({ name, alias: name, type: kind || "string", domain: null })),
  ];
}

/** The layer's geometry type in the contract's words ("point", "polyline", "polygon"), from its first shaped feature. */
export function geometryTypeOf(features) {
  for (const feature of features) {
    const type = GEOMETRY_TYPES[feature.geometry?.type];
    if (type) return type;
  }
  return null;
}

function eachCoordinate(geometry, visit) {
  if (!geometry) return;
  if (geometry.type === "GeometryCollection") return geometry.geometries?.forEach((part) => eachCoordinate(part, visit));
  const walk = (value) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") visit(value[0], value[1]);
    else value.forEach(walk);
  };
  // ArcGIS JSON geometry (from another engine's saved state) is read too.
  if (geometry.coordinates) walk(geometry.coordinates);
  else if (Number.isFinite(geometry.x)) visit(geometry.x, geometry.y);
  else if (Number.isFinite(geometry.xmin)) { visit(geometry.xmin, geometry.ymin); visit(geometry.xmax, geometry.ymax); }
  else walk(geometry.rings || geometry.paths || geometry.points);
}

/** [west, south, east, north] of a geometry, or of several; null when there are no coordinates. */
export function boundsOf(geometries) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const geometry of Array.isArray(geometries) ? geometries : [geometries]) {
    eachCoordinate(geometry, (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      west = Math.min(west, x); east = Math.max(east, x);
      south = Math.min(south, y); north = Math.max(north, y);
    });
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

export function boundsIntersect(a, b) {
  return Boolean(a && b) && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Grows [w, s, e, n] by a factor around its centre (a single point gets a small box). */
export function expandBounds([west, south, east, north], factor = 1.25, minimum = 0.002) {
  const halfWidth = Math.max((east - west) * factor, minimum) / 2;
  const halfHeight = Math.max((north - south) * factor, minimum) / 2;
  const x = (west + east) / 2;
  const y = (south + north) / 2;
  return [x - halfWidth, y - halfHeight, x + halfWidth, y + halfHeight];
}

function ringCentroid(ring) {
  let area = 0; let x = 0; let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const [x0, y0] = ring[index];
    const [x1, y1] = ring[index + 1];
    const cross = (x0 * y1) - (x1 * y0);
    area += cross; x += (x0 + x1) * cross; y += (y0 + y1) * cross;
  }
  return area ? { longitude: x / (3 * area), latitude: y / (3 * area), area: Math.abs(area / 2) } : null;
}

/**
 * A point that represents a geometry, in degrees: the point itself, a
 * polygon's (largest part's) centroid, a line's middle vertex, or the centre of its bounds.
 */
export function representativePoint(geometry) {
  if (!geometry) return null;
  if (geometry.type === "Point") return { longitude: geometry.coordinates[0], latitude: geometry.coordinates[1] };
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) return { longitude: geometry.x, latitude: geometry.y };
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : null;
  if (polygons) {
    const best = polygons.map((rings) => ringCentroid(rings?.[0] || [])).filter(Boolean).sort((a, b) => b.area - a.area)[0];
    if (best) return { longitude: best.longitude, latitude: best.latitude };
  }
  const line = geometry.type === "LineString" ? geometry.coordinates : geometry.type === "MultiLineString" ? geometry.coordinates?.[0] : null;
  if (line?.length) {
    const [longitude, latitude] = line[Math.floor(line.length / 2)];
    return { longitude, latitude };
  }
  const bounds = boundsOf(geometry);
  return bounds ? { longitude: (bounds[0] + bounds[2]) / 2, latitude: (bounds[1] + bounds[3]) / 2 } : null;
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) area += (ring[index][0] * ring[index + 1][1]) - (ring[index + 1][0] * ring[index][1]);
  return Math.abs(area / 2);
}

function insideRing([x, y], ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x1, y1] = ring[current];
    const [x0, y0] = ring[previous];
    if ((y1 > y) !== (y0 > y) && x < ((x0 - x1) * (y - y1)) / (y0 - y1) + x1) inside = !inside;
  }
  return inside;
}

/**
 * A polygon whose rings are grouped as they should be: a ring inside another
 * is that ring's hole, any other ring is a part of its own. Some ArcGIS
 * services answer f=geojson with every ring of a multipart polygon (islands
 * included) in one Polygon, which would draw the islands as holes.
 */
export function regroupPolygon(geometry) {
  if (geometry?.type !== "Polygon" || (geometry.coordinates?.length || 0) < 2) return geometry;
  const rings = geometry.coordinates.filter((ring) => ring.length >= 4).map((ring) => ({ ring, area: ringArea(ring) })).sort((a, b) => b.area - a.area);
  const parts = [];
  for (const { ring, area } of rings) {
    // The smallest part that holds this ring's first vertex takes it as a hole; holes are never nested here.
    const container = parts.filter((part) => part.area > area && insideRing(ring[0], part.rings[0])).sort((a, b) => a.area - b.area)[0];
    if (container) container.rings.push(ring);
    else parts.push({ rings: [ring], area });
  }
  return parts.length === 1
    ? { type: "Polygon", coordinates: parts[0].rings }
    : { type: "MultiPolygon", coordinates: parts.map((part) => part.rings) };
}
