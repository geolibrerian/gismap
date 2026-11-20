// Browser-side spatial analysis on the version-pinned Turf bundle. Everything runs
// on the viewer's device: results are local GeoJSON layers, and nothing is uploaded.
import { graphicToGeoJSONFeature } from "./export/export-core.js?v=0.18.2";
import { GisMapError } from "./gismap-errors.js?v=0.54.0-print";
import { BIN_STATISTICS, binPoints } from "./hex-binning.js?v=0.1.0";

export const MAX_ANALYSIS_FEATURES = 20000;
/** Binning only counts, so it reads more of a layer. */
export const MAX_BINNING_FEATURES = 100000;
const MAX_GRID_CELLS = 50000;
const PAGE_SIZE = 1000;
const TURF_URL = new URL("./vendor/turf-7.4.0.min.js", import.meta.url).href;
const H3_URL = new URL("./vendor/h3-js-4.5.0.umd.js", import.meta.url).href;

const distance = (name, label, value) => ({ name, label, type: "number", default: value, min: 0.001, max: 40000, unit: "km" });

const STATISTIC_LABELS = { count: "Point count", density: "Points per km²", sum: "Sum of a field", mean: "Mean of a field", min: "Minimum of a field", max: "Maximum of a field" };
const FIELD_STATISTICS = BIN_STATISTICS.filter((name) => !["count", "density"].includes(name));

/**
 * Every operation. `input` and `overlay` are the geometry each accepts; no `overlay` means one source,
 * and `overlayOptional` means the overlay may be left out. Option types are number, field, choice and
 * boolean; `when` shows an option only while other options have one of the listed values.
 */
export const SPATIAL_OPERATIONS = Object.freeze([
  { id: "measure", label: "Measure area and length", group: "Measure", input: "any", description: "Adds area_km2 and length_km to each feature and reports the totals.", options: [] },
  { id: "buffer", label: "Buffer", group: "Shape", input: "any", description: "A zone around each feature.", options: [distance("distanceKm", "Distance", 1)] },
  { id: "dissolve", label: "Dissolve", group: "Shape", input: "polygon", description: "Merges polygons, optionally only those sharing a field value.", options: [{ name: "field", label: "Field (optional)", type: "field" }] },
  { id: "centroid", label: "Centroids", group: "Shape", input: "any", description: "The centre point of each feature.", options: [] },
  { id: "convex-hull", label: "Convex hull", group: "Shape", input: "any", description: "The smallest convex polygon around all features.", options: [] },
  { id: "envelope", label: "Bounding box", group: "Shape", input: "any", description: "The rectangle around all features.", options: [] },
  { id: "simplify", label: "Simplify", group: "Shape", input: "any", description: "Removes vertices. Tolerance is in degrees.", options: [{ name: "tolerance", label: "Tolerance (degrees)", type: "number", default: 0.01, min: 0.00001, max: 10 }] },
  { id: "voronoi", label: "Voronoi polygons", group: "Points", input: "point", description: "The area closest to each point.", options: [] },
  { id: "kmeans", label: "K-means clusters", group: "Points", input: "point", description: "Assigns each point a cluster number.", options: [{ name: "clusters", label: "Clusters", type: "number", default: 5, min: 2, max: 100 }] },
  { id: "dbscan", label: "Density clusters", group: "Points", input: "point", description: "Groups nearby points; the rest are marked as noise.", options: [distance("maxDistanceKm", "Maximum distance", 10), { name: "minPoints", label: "Minimum points", type: "number", default: 3, min: 1, max: 1000 }] },
  {
    id: "hexbin", label: "Hexagon binning", group: "Points", input: "point", overlay: "polygon", overlayOptional: true, maxInput: MAX_BINNING_FEATURES,
    description: "Summarises points in hexagons: H3 cells or a grid of a chosen size. The optional overlay is a study area.",
    options: [
      { name: "method", label: "Method", type: "choice", default: "h3", choices: [["h3", "H3 global grid"], ["turf", "Custom hexagon size"]] },
      { name: "resolution", label: "H3 resolution", type: "number", integer: true, default: 7, min: 0, max: 15, when: { method: ["h3"] } },
      { ...distance("cellKm", "Hexagon side", 10), when: { method: ["turf"] } },
      { name: "statistic", label: "Statistic", type: "choice", default: "count", choices: BIN_STATISTICS.map((name) => [name, STATISTIC_LABELS[name]]) },
      { name: "field", label: "Numeric field", type: "field", when: { statistic: FIELD_STATISTICS } },
      { name: "keepEmpty", label: "Keep empty cells", type: "boolean", default: false },
      { name: "extrude", label: "Show in 3D", type: "boolean", default: false },
    ],
  },
  { id: "nearest", label: "Nearest feature", group: "Overlay", input: "point", overlay: "point", description: "Adds the nearest overlay point and its distance.", options: [] },
  { id: "select", label: "Select by location", group: "Overlay", input: "any", overlay: "any", description: "Keeps features that touch the overlay.", options: [] },
  { id: "join", label: "Spatial join", group: "Overlay", input: "any", overlay: "any", description: "Copies the fields of the first overlay feature each feature touches.", options: [] },
  { id: "count", label: "Count points in polygons", group: "Overlay", input: "polygon", overlay: "point", description: "Adds point_count to each polygon.", options: [] },
  { id: "clip", label: "Clip", group: "Overlay", input: "polygon", overlay: "polygon", description: "Keeps the parts of polygons inside the overlay.", options: [] },
  { id: "erase", label: "Erase", group: "Overlay", input: "polygon", overlay: "polygon", description: "Removes the parts of polygons inside the overlay.", options: [] },
]);

export const SPATIAL_OPERATION_IDS = Object.freeze(SPATIAL_OPERATIONS.map(({ id }) => id));

const family = (geometry) => /Polygon/.test(geometry?.type) ? "polygon" : /Line/.test(geometry?.type) ? "line" : /Point/.test(geometry?.type) ? "point" : null;
const invalid = (message) => new GisMapError("INVALID_SPEC", message);

/** Any GeoJSON object as a FeatureCollection of located features. */
export function toFeatureCollection(value) {
  const list = value?.type === "FeatureCollection" ? value.features
    : value?.type === "Feature" ? [value]
      : value?.type && value.coordinates ? [{ type: "Feature", properties: {}, geometry: value }]
        : null;
  if (!Array.isArray(list)) throw invalid("Give a layer, drawings, or GeoJSON.");
  return { type: "FeatureCollection", features: list.filter((feature) => family(feature?.geometry)) };
}

/** Only the geometry an operation accepts; polygons are flattened to single parts where it needs them. */
function usable(turf, collection, wanted, label) {
  const features = wanted === "any" ? collection.features : collection.features.filter((feature) => family(feature.geometry) === wanted);
  if (!features.length) throw invalid(`${label} needs ${wanted === "any" ? "features with geometry" : `${wanted} features`}.`);
  return wanted === "point" ? turf.flatten(turf.featureCollection(features)) : turf.featureCollection(features);
}

function number(option, value) {
  const parsed = Number(value ?? option.default);
  if (!Number.isFinite(parsed) || parsed < option.min || parsed > option.max) throw invalid(`${option.label} must be between ${option.min} and ${option.max}.`);
  if (option.integer && !Number.isInteger(parsed)) throw invalid(`${option.label} must be a whole number.`);
  return parsed;
}

function optionValue(option, value) {
  if (option.type === "number") return number(option, value);
  if (option.type === "boolean") return value === undefined || value === null || value === "" ? option.default : value === true || value === "true";
  if (option.type === "choice") {
    const chosen = value ?? option.default;
    if (!option.choices.some(([id]) => id === chosen)) throw invalid(`${option.label} must be one of: ${option.choices.map(([id]) => id).join(", ")}.`);
    return chosen;
  }
  return value;
}

/** The hexbin method; links from before H3 gave only cellKm, and keep their Turf grid. */
export const hexbinMethod = (options = {}) => options.method ?? (options.cellKm !== undefined ? "turf" : "h3");

const located = (turf, feature) => ({ feature, box: turf.bbox(feature) });
const boxesTouch = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const touching = (turf, feature, overlay) => {
  const box = turf.bbox(feature);
  return overlay.filter((item) => boxesTouch(box, item.box) && turf.booleanIntersects(feature, item.feature));
};

/** Keeps a ring that crosses the 180° meridian continuous, so it does not smear across the map. */
function unwrapped(feature) {
  const ring = (points) => {
    let shift = 0;
    return points.map(([x, y], index) => {
      const previous = points[index - 1]?.[0];
      if (previous !== undefined && Math.abs(x - previous) > 180) shift += x > previous ? -360 : 360;
      return [x + shift, y];
    });
  };
  const { type, coordinates } = feature.geometry;
  const geometry = type === "Polygon" ? { type, coordinates: coordinates.map(ring) } : { type, coordinates: coordinates.map((part) => part.map(ring)) };
  return { ...feature, geometry };
}

function mergeAll(turf, polygons) {
  if (polygons.features.length === 1) return polygons.features[0];
  return turf.union(polygons);
}

/** Runs one operation on GeoJSON. Returns { collection, summary } with a plain-language summary. */
export function runSpatialOperation(turf, id, { input, overlay, options = {}, h3 = null } = {}) {
  const operation = SPATIAL_OPERATIONS.find((item) => item.id === id);
  if (!operation) throw invalid(`Unknown analysis "${id}". Use one of: ${SPATIAL_OPERATION_IDS.join(", ")}.`);
  const values = Object.fromEntries(operation.options.map((option) => [option.name, optionValue(option, option.name === "method" && id === "hexbin" ? hexbinMethod(options) : options[option.name])]));
  const source = usable(turf, toFeatureCollection(input), operation.input, operation.label);
  const count = source.features.length;
  let others = null;
  if (operation.overlay && (overlay || !operation.overlayOptional)) {
    if (!overlay) throw invalid(`${operation.label} needs an overlay.`);
    others = usable(turf, toFeatureCollection(overlay), operation.overlay, `The overlay for ${operation.label}`);
  }
  const lookup = others?.features.map((feature) => located(turf, feature));
  const done = (features, summary) => ({ collection: turf.featureCollection(features.filter(Boolean)), summary });
  switch (id) {
    case "measure": {
      let area = 0; let length = 0;
      const features = source.features.map((feature) => {
        const kind = family(feature.geometry);
        const areaKm2 = kind === "polygon" ? turf.area(feature) / 1e6 : 0;
        const lengthKm = kind === "point" ? 0 : turf.length(feature.geometry.type.includes("Polygon") ? turf.polygonToLine(feature) : feature, { units: "kilometers" });
        area += areaKm2; length += lengthKm;
        return { ...feature, properties: { ...feature.properties, area_km2: areaKm2, length_km: lengthKm } };
      });
      return { ...done(features, `${count} features: ${area.toFixed(2)} km² in area, ${length.toFixed(2)} km in length or perimeter.`), totals: { features: count, areaKm2: area, lengthKm: length } };
    }
    case "buffer":
      return done(source.features.map((feature) => {
        const zone = turf.buffer(feature, values.distanceKm, { units: "kilometers", steps: 16 });
        return zone && { ...unwrapped(zone), properties: { ...feature.properties } };
      }), `Buffered ${count} features by ${values.distanceKm} km.`);
    case "dissolve": {
      const flat = turf.flatten(source);
      if (values.field && !flat.features.some((feature) => Object.hasOwn(feature.properties || {}, values.field))) throw invalid(`No feature has the field "${values.field}".`);
      const merged = turf.dissolve(flat, values.field ? { propertyName: values.field } : {});
      return done(merged.features, `Dissolved ${count} polygons into ${merged.features.length}.`);
    }
    case "centroid":
      return done(source.features.map((feature) => turf.centroid(feature, { properties: feature.properties })), `${count} centroids.`);
    case "convex-hull": {
      const hull = turf.convex(source);
      if (!hull) throw invalid("A convex hull needs at least three separate positions.");
      return done([hull], `Convex hull of ${count} features.`);
    }
    case "envelope":
      return done([turf.envelope(source)], `Bounding box of ${count} features.`);
    case "simplify":
      return done(source.features.map((feature) => turf.simplify(feature, { tolerance: values.tolerance, highQuality: false, mutate: false })), `Simplified ${count} features.`);
    case "voronoi": {
      if (count < 2) throw invalid("Voronoi polygons need at least two points.");
      const [west, south, east, north] = turf.bbox(source);
      const padX = Math.max((east - west) * 0.1, 0.01); const padY = Math.max((north - south) * 0.1, 0.01);
      return done(turf.voronoi(source, { bbox: [west - padX, south - padY, east + padX, north + padY] }).features, `Voronoi polygons for ${count} points.`);
    }
    case "kmeans": {
      if (values.clusters > count) throw invalid(`There are only ${count} points, fewer than ${values.clusters} clusters.`);
      const result = turf.clustersKmeans(structuredClone(source), { numberOfClusters: Math.round(values.clusters) });
      return done(result.features.map(({ properties: { centroid, ...properties }, ...feature }) => ({ ...feature, properties })), `${count} points in ${Math.round(values.clusters)} clusters.`);
    }
    case "dbscan": {
      const result = turf.clustersDbscan(structuredClone(source), values.maxDistanceKm, { units: "kilometers", minPoints: Math.round(values.minPoints) });
      const clusters = new Set(result.features.map((feature) => feature.properties.cluster).filter((value) => value !== undefined));
      return done(result.features, `${clusters.size} clusters from ${count} points; ${result.features.filter((feature) => feature.properties.dbscan === "noise").length} are noise.`);
    }
    case "hexbin": {
      const result = binPoints({ turf, h3, points: source, area: others, method: values.method, resolution: values.resolution, cellKm: values.cellKm, statistic: values.statistic, field: values.field, keepEmpty: values.keepEmpty });
      return { ...result, binning: { ...result.metadata, styleField: result.styleField, extrude: values.extrude } };
    }
    case "nearest": {
      const features = source.features.map((feature) => {
        const near = turf.nearestPoint(feature, others, { units: "kilometers" });
        return { ...feature, properties: { ...feature.properties, nearest_km: near.properties.distanceToPoint ?? near.properties.dist, nearest_index: near.properties.featureIndex } };
      });
      return done(features, `Found the nearest of ${others.features.length} overlay points for ${count} points.`);
    }
    case "select": {
      const features = source.features.filter((feature) => touching(turf, feature, lookup).length);
      return done(features, `${features.length} of ${count} features touch the overlay.`);
    }
    case "join": {
      let matched = 0;
      const features = source.features.map((feature) => {
        const [match] = touching(turf, feature, lookup);
        if (!match) return feature;
        matched += 1;
        const joined = Object.fromEntries(Object.entries(match.feature.properties || {}).map(([key, value]) => [Object.hasOwn(feature.properties || {}, key) ? `join_${key}` : key, value]));
        return { ...feature, properties: { ...feature.properties, ...joined } };
      });
      return done(features, `Joined fields to ${matched} of ${count} features.`);
    }
    case "count": {
      let total = 0;
      const features = source.features.map((feature) => {
        const pointCount = touching(turf, feature, lookup).length;
        total += pointCount;
        return { ...feature, properties: { ...feature.properties, point_count: pointCount } };
      });
      return done(features, `Counted ${total} point matches in ${count} polygons.`);
    }
    case "clip": {
      const features = source.features.flatMap((feature) => touching(turf, feature, lookup).map((item) => {
        const part = turf.intersect(turf.featureCollection([feature, item.feature]));
        return part && { ...part, properties: { ...feature.properties } };
      }));
      return done(features, `Clipped ${count} polygons to the overlay.`);
    }
    case "erase": {
      const mask = mergeAll(turf, turf.flatten(others));
      const features = source.features.map((feature) => {
        const part = turf.difference(turf.featureCollection([feature, mask]));
        return part && { ...part, properties: { ...feature.properties } };
      });
      return done(features, `Erased the overlay from ${count} polygons.`);
    }
    default:
      throw invalid(`Unknown analysis "${id}".`);
  }
}

/** A vendored UMD bundle that sets a global, loaded once. */
function loadVendorScript(url, ready, failure, documentRef) {
  if (ready()) return Promise.resolve(ready());
  loadVendorScript.pending ||= new Map();
  if (!loadVendorScript.pending.has(url)) loadVendorScript.pending.set(url, new Promise((resolve, reject) => {
    // The ArcGIS loader defines an AMD `define`, which would keep the bundle off globalThis.
    const amd = globalThis.define?.amd;
    if (amd) delete globalThis.define.amd;
    const restore = () => { if (amd) globalThis.define.amd = amd; };
    const script = documentRef.createElement("script");
    script.src = url;
    script.onload = () => { restore(); resolve(ready()); };
    script.onerror = () => { restore(); loadVendorScript.pending.delete(url); reject(new Error(failure)); };
    documentRef.head.append(script);
  }));
  return loadVendorScript.pending.get(url);
}

/** The Turf bundle, loaded the first time it is needed. */
export function loadTurf(documentRef = globalThis.document) {
  return loadVendorScript(TURF_URL, () => (globalThis.turf?.buffer ? globalThis.turf : null), "The spatial analysis library could not load.", documentRef);
}

/** The h3-js bundle, loaded the first time H3 binning runs. */
export function loadH3(documentRef = globalThis.document) {
  return loadVendorScript(H3_URL, () => (globalThis.h3?.latLngToCell ? globalThis.h3 : null), "The H3 library could not load.", documentRef);
}

/** Up to `limit` features of a layer, under its filter. */
export async function readLayerFeatures(mapController, uid, limit = MAX_ANALYSIS_FEATURES) {
  const layer = mapController.getLayer(uid);
  if (!layer?.queryable) throw invalid(`${layer?.title || "That layer"} cannot be analyzed. Use a vector layer.`);
  const features = [];
  let truncated = false;
  for (let start = 0; ; start += PAGE_SIZE) {
    const params = { where: layer.where || "1=1", outFields: ["*"], returnGeometry: true, outSpatialReference: { wkid: 4326 }, start, num: PAGE_SIZE };
    if (layer.objectIdField) params.orderByFields = [layer.objectIdField];
    const page = (await mapController.queryFeatures(uid, params, { layerDefaults: false })).features || [];
    features.push(...page.map((feature) => graphicToGeoJSONFeature(feature)));
    const more = page.length === PAGE_SIZE && layer.paginated !== false;
    if (features.length >= limit) { truncated = more || features.length > limit; break; }
    if (!more) { truncated = page.length === PAGE_SIZE; break; }
  }
  return { collection: toFeatureCollection({ type: "FeatureCollection", features: features.slice(0, limit) }), truncated };
}

/** gisMapOnline.analysis: the same operations the Tools menu runs. `layers` is the in-page layers API. */
/** Height multiplier that makes the tallest bin a few cells tall, in metres. */
function extrusionScale(collection, field) {
  const values = collection.features.map((feature) => Number(feature.properties[field])).filter((value) => Number.isFinite(value) && value > 0);
  if (!values.length) return null;
  const areas = collection.features.map((feature) => feature.properties.cell_area_km2).sort((a, b) => a - b);
  const across = Math.sqrt(areas[Math.floor(areas.length / 2)]) * 1000;
  return Math.min(40000, Math.max(300, across * 3)) / Math.max(...values);
}

export function createSpatialAnalysisApi({ mapController, layers, documentRef = globalThis.document }) {
  const resolve = async (source, limit = MAX_ANALYSIS_FEATURES) => {
    if (source === "drawings") {
      const drawings = mapController.getDrawings();
      if (!drawings.length) throw invalid("There are no drawings on the map.");
      return { collection: toFeatureCollection({ type: "FeatureCollection", features: drawings }), truncated: false, title: "drawings" };
    }
    if (source && typeof source === "object") return { collection: toFeatureCollection(source), truncated: false, title: "GeoJSON" };
    const layer = layers.get(String(source));
    return { ...(await readLayerFeatures(mapController, layer.id, limit)), title: layer.title, where: layer.where || null };
  };
  /** Colours bins by their statistic and, if asked, raises them by it. Returns a note when 3D is unavailable. */
  const styleBins = async (uid, collection, { styleField, extrude }) => {
    await layers.update(uid, { renderer: { type: "choropleth", field: styleField, ramp: "viridis", method: "auto" } });
    if (!extrude) return "";
    const multiplier = extrusionScale(collection, styleField);
    if (!multiplier) return " Nothing to raise in 3D: every value is zero or empty.";
    try {
      await mapController.setLayerSymbology(uid, { mode: "graduated", field: styleField, extrusionEnabled: true, extrusionSource: "field", extrusionField: styleField, extrusionMultiplier: multiplier });
      return " Tilt the map to see the cells in 3D.";
    } catch (error) {
      return ` The cells could not be shown in 3D (${error.message}).`;
    }
  };
  return Object.freeze({
    operations: () => structuredClone(SPATIAL_OPERATIONS),
    /** run(operation, { input, overlay, options, addToMap = true, title }): input and overlay are a layer id or title, "drawings", or GeoJSON. */
    async run(operation, { input, overlay, options = {}, addToMap = true, title } = {}) {
      const turf = await loadTurf(documentRef);
      const definition = SPATIAL_OPERATIONS.find((item) => item.id === operation);
      const limit = definition?.maxInput || MAX_ANALYSIS_FEATURES;
      const h3 = operation === "hexbin" && hexbinMethod(options || {}) === "h3" ? await loadH3(documentRef) : null;
      const source = await resolve(input, limit);
      const mask = overlay === undefined || overlay === null || overlay === "" ? null : await resolve(overlay);
      const { collection, summary, totals, binning } = runSpatialOperation(turf, operation, { input: source.collection, overlay: mask?.collection, options, h3 });
      const truncated = source.truncated || Boolean(mask?.truncated);
      // Binned cells say whether they summarise every source feature, in the map and in exports.
      if (binning) for (const feature of collection.features) feature.properties.complete = !truncated;
      const name = String(title || `${definition.label} of ${source.title}`).slice(0, 120);
      let layer = null;
      let styled = "";
      if (addToMap && collection.features.length) {
        const file = new File([JSON.stringify(collection)], `${name.replace(/[^\w -]+/g, "_")}.geojson`, { type: "application/geo+json" });
        const added = await mapController.addLocalFile(file);
        await layers.update(added.uid, { title: name }).catch(() => {});
        layer = { id: added.uid, title: name };
        if (binning) styled = await styleBins(added.uid, collection, binning).catch((error) => ` The bins could not be styled (${error.message}).`);
      }
      return {
        operation, featureCount: collection.features.length, truncated, layer, ...(totals ? { totals } : {}),
        ...(binning ? { binning: { ...binning, complete: !truncated, source: source.title, where: source.where || null } } : {}),
        summary: `${summary}${collection.features.length ? "" : " The result is empty."}${truncated ? ` Only the first ${limit.toLocaleString("en-US")} features were used, so the result is incomplete.` : ""}${styled}`,
        ...(addToMap ? {} : { collection }),
      };
    },
  });
}
