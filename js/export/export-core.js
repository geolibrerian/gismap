function coordinatesOf(point) {
  const values = [point.x, point.y];
  if (Number.isFinite(point.z)) values.push(point.z);
  return values;
}

function signedRingArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += (ring[index][0] * ring[index + 1][1]) - (ring[index + 1][0] * ring[index][1]);
  }
  return area / 2;
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const first = ring[0];
  const last = ring.at(-1);
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, [...first]];
}

function pointInRing(point, ring) {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [x, y] = ring[current];
    const [previousX, previousY] = ring[previous];
    const crosses = (y > point[1]) !== (previousY > point[1])
      && point[0] < ((previousX - x) * (point[1] - y)) / (previousY - y) + x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function orientRing(ring, counterClockwise) {
  const isCounterClockwise = signedRingArea(ring) > 0;
  return isCounterClockwise === counterClockwise ? ring : [...ring].reverse();
}

function polygonCoordinates(rings = []) {
  const valid = rings.map(closeRing).filter((ring) => ring.length >= 4);
  if (!valid.length) return { type: "Polygon", coordinates: [] };
  const largest = valid.reduce((winner, ring) =>
    Math.abs(signedRingArea(ring)) > Math.abs(signedRingArea(winner)) ? ring : winner,
  );
  const outerSign = Math.sign(signedRingArea(largest)) || 1;
  const polygons = valid
    .filter((ring) => (Math.sign(signedRingArea(ring)) || outerSign) === outerSign)
    .map((ring) => [orientRing(ring, true)]);
  const holes = valid.filter((ring) => (Math.sign(signedRingArea(ring)) || outerSign) !== outerSign);

  holes.forEach((hole) => {
    const candidates = polygons
      .filter(([outer]) => pointInRing(hole[0], outer))
      .sort((a, b) => Math.abs(signedRingArea(a[0])) - Math.abs(signedRingArea(b[0])));
    if (candidates[0]) candidates[0].push(orientRing(hole, false));
    else polygons.push([orientRing(hole, true)]);
  });

  return polygons.length === 1
    ? { type: "Polygon", coordinates: polygons[0] }
    : { type: "MultiPolygon", coordinates: polygons };
}

export function geometryToGeoJSON(geometry) {
  if (!geometry) return null;
  const source = geometry.toJSON?.() ?? geometry;
  switch (source.type) {
    case "point":
      return { type: "Point", coordinates: coordinatesOf(source) };
    case "multipoint":
      return { type: "MultiPoint", coordinates: source.points ?? [] };
    case "polyline":
      return (source.paths?.length ?? 0) === 1
        ? { type: "LineString", coordinates: source.paths[0] }
        : { type: "MultiLineString", coordinates: source.paths ?? [] };
    case "polygon":
      return polygonCoordinates(source.rings);
    default:
      if (source.type && source.coordinates) return structuredClone(source);
      throw new Error(`Unsupported export geometry: ${source.type || "unknown"}.`);
  }
}

export function graphicToGeoJSONFeature(graphic) {
  return {
    type: "Feature",
    geometry: geometryToGeoJSON(graphic?.geometry),
    properties: structuredClone(graphic?.attributes ?? {}),
  };
}

export function createFeatureCollection(features, metadata = {}) {
  return {
    type: "FeatureCollection",
    name: metadata.name || undefined,
    features,
  };
}

export function safeExportName(value, fallback = "layer") {
  const name = String(value || fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  return name || fallback;
}
