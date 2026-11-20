// Random points from a polygon value: each polygon gets one point per `unitsPerPoint`
// of its field (one per 100 people, say), placed at random inside it. A dot-density
// layer, and points that Hexagon binning can summarise again.
//
// The generator is seeded, so a map link redraws the same points. Points are
// spread evenly by area: latitude is drawn by the sine of its value, so a large
// polygon's poleward part does not get too many. A fractional remainder (2.6
// points) becomes a point with that probability, so totals stay unbiased.
import { GisMapError } from "./gismap-errors.js?v=0.54.0-print";

export const MAX_RANDOM_POINTS = 100000;
const AUTO_TARGET = 10000;
const ATTEMPTS_PER_POINT = 200;

const invalid = (message) => new GisMapError("INVALID_SPEC", message);
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
const RADIANS = Math.PI / 180;

/** A small seeded generator (mulberry32), returning numbers in [0, 1). */
export function seededRandom(seed) {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** 1, 2 or 5 times a power of ten, at least `value`: a readable "one point per" amount. */
export function niceUnits(value) {
  if (!(value > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 5, 10].map((step) => step * power).find((step) => step >= value);
}

const numeric = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * `polygons` is a FeatureCollection of Polygon and MultiPolygon features. With no
 * `unitsPerPoint`, one is chosen that makes about 10,000 points.
 * Returns { collection, summary, metadata }.
 */
export function randomPointsByValue({ turf, polygons, field, unitsPerPoint = null, seed = 1 }) {
  field = String(field || "").trim();
  if (!field) throw invalid("Random points need a numeric field, such as population.");
  if (!polygons.features.some((feature) => Object.hasOwn(feature.properties || {}, field))) throw invalid(`No polygon has the field "${field}".`);
  const skipped = { missingValue: 0, notPositive: 0 };
  const sources = [];
  polygons.features.forEach((feature, index) => {
    const value = numeric(feature.properties?.[field]);
    if (value === null) skipped.missingValue += 1;
    else if (value <= 0) skipped.notPositive += 1;
    else sources.push({ feature, index, value });
  });
  if (!sources.length) throw invalid(`No polygon has a positive number in ${field}.`);
  const total = sources.reduce((sum, item) => sum + item.value, 0);
  const auto = unitsPerPoint === null || unitsPerPoint === undefined || unitsPerPoint === "";
  const units = auto ? niceUnits(total / AUTO_TARGET) : Number(unitsPerPoint);
  if (!Number.isFinite(units) || units <= 0) throw invalid("Units per point must be a positive number.");
  if (total / units > MAX_RANDOM_POINTS) throw invalid(`That makes too many points: about ${Math.round(total / units).toLocaleString("en-US")}, over the ${MAX_RANDOM_POINTS.toLocaleString("en-US")} limit. Use at least ${niceUnits(total / MAX_RANDOM_POINTS).toLocaleString("en-US")} ${field} per point.`);

  const random = seededRandom(seed);
  const features = [];
  let unplaced = 0;
  for (const { feature, index, value } of sources) {
    const exact = value / units;
    const count = Math.floor(exact) + (random() < exact - Math.floor(exact) ? 1 : 0);
    if (!count) continue;
    const [west, south, east, north] = turf.bbox(feature);
    const low = Math.sin(south * RADIANS); const high = Math.sin(north * RADIANS);
    let placed = 0;
    for (let attempt = 0; placed < count && attempt < count * ATTEMPTS_PER_POINT; attempt += 1) {
      const x = west + random() * (east - west);
      const y = Math.asin(low + random() * (high - low)) / RADIANS;
      if (!turf.booleanPointInPolygon([x, y], feature)) continue;
      features.push({ type: "Feature", properties: { polygon_index: index, represents: units }, geometry: { type: "Point", coordinates: [x, y] } });
      placed += 1;
    }
    unplaced += count - placed;
  }
  const notes = [
    skipped.missingValue && `${plural(skipped.missingValue, "polygon")} had no number in ${field}`,
    skipped.notPositive && `${plural(skipped.notPositive, "polygon")} had zero or less`,
    unplaced && `${plural(unplaced, "point")} could not be placed in very thin polygons`,
  ].filter(Boolean);
  const summary = `${plural(features.length, "random point")} in ${plural(sources.length, "polygon")}, one per ${units.toLocaleString("en-US")} ${field}${auto ? " (chosen to make about 10,000)" : ""}.`
    + (notes.length ? ` Skipped: ${notes.join("; ")}.` : "")
    + " Each point records the polygon it came from and how much it represents; the positions inside each polygon are random.";
  return {
    collection: { type: "FeatureCollection", features },
    summary,
    metadata: { field, unitsPerPoint: units, seed: Number(seed), polygons: polygons.features.length, used: sources.length, total, points: features.length, skipped: { ...skipped, unplaced } },
  };
}
