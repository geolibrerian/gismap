// Shared, browser-first adapter for the version-pinned Turf bundle in vendor/.
// Keep Field Mode and future offline surfaces on this narrow API instead of
// coupling UI code to the global bundle directly.

export const TURF_VERSION = "7.4.0";

const DISTANCE_UNITS = new Set(["kilometers", "meters", "miles"]);
const REQUIRED_METHODS = ["point", "distance", "bearing", "midpoint", "buffer", "area", "bbox", "booleanPointInPolygon"];

function coordinate(value, label = "Coordinate") {
  const [longitude, latitude] = Array.isArray(value) ? value : [];
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180 || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error(`${label} needs a valid longitude and latitude.`);
  }
  return [longitude, latitude];
}

function unit(value) {
  if (!DISTANCE_UNITS.has(value)) throw new Error("Use kilometers, meters, or miles for this offline measurement.");
  return value;
}

function geometryType(geojson) {
  if (!geojson || typeof geojson !== "object") return "unknown";
  if (geojson.type === "Feature") return geojson.geometry?.type || "unlocated feature";
  return geojson.type || "unknown";
}

export function createOfflineAnalysis(turf = globalThis.turf) {
  const missing = REQUIRED_METHODS.filter((method) => typeof turf?.[method] !== "function");
  if (missing.length) throw new Error(`Offline analysis is unavailable because Turf.js did not load (${missing.join(", ")}).`);

  const point = (value, properties = {}) => turf.point(coordinate(value), properties);
  const distance = (from, to, units = "kilometers") => turf.distance(point(from), point(to), { units: unit(units) });

  return {
    version: TURF_VERSION,
    point,
    measure(from, to, units = "kilometers") {
      const normalizedUnits = unit(units);
      const source = point(from);
      const destination = point(to);
      return {
        from: source,
        to: destination,
        units: normalizedUnits,
        distance: turf.distance(source, destination, { units: normalizedUnits }),
        bearing: turf.bearing(source, destination),
        midpoint: turf.midpoint(source, destination),
      };
    },
    buffer(from, radius, units = "kilometers") {
      const value = Number(radius);
      if (!Number.isFinite(value) || value <= 0 || value > 1000) throw new Error("Enter a buffer radius between 0 and 1,000.");
      const normalizedUnits = unit(units);
      const result = turf.buffer(point(from), value, { units: normalizedUnits, steps: 32 });
      if (!result) throw new Error("Turf could not create that buffer.");
      return result;
    },
    summarize(geojson) {
      if (!geojson || typeof geojson !== "object" || !geojson.type) throw new Error("Choose a valid GeoJSON feature, geometry, or feature collection.");
      const type = geometryType(geojson);
      const bbox = turf.bbox(geojson);
      const areaSquareMeters = /Polygon/.test(type) || geojson.type === "FeatureCollection" ? turf.area(geojson) : 0;
      return { type, bbox, areaSquareMeters };
    },
    containsPoint(from, polygon) {
      return turf.booleanPointInPolygon(point(from), polygon);
    },
    nearestRecords(from, records, { limit = 5, units = "kilometers" } = {}) {
      const normalizedUnits = unit(units);
      const origin = coordinate(from, "Starting coordinate");
      return records
        .filter((record) => record?.geometry?.type === "Point")
        .map((record) => ({ record, distance: distance(origin, record.geometry.coordinates, normalizedUnits) }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, Math.max(1, Math.min(25, Number(limit) || 5)));
    },
  };
}

export function formatOfflineDistance(value, units) {
  if (!Number.isFinite(value)) return "Unavailable";
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toLocaleString(undefined, { maximumFractionDigits: digits })} ${units}`;
}
