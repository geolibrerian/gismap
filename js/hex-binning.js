// Hexagon binning: points summarised into H3 cells or a Turf hexagon grid. Pure
// functions over the vendored Turf and h3-js bundles, so tests run them headless.
//
// Every cell carries point_count, cell_area_km2 and density_km2. With a numeric
// field it also carries <field>_sum, _mean, _min and _max over the points that had
// a number, and value_count, how many did. A cell with no numbers has null
// statistics, never zero. Density divides by the cell's own area, which is never
// clipped, so H3 cells stay true to their IDs.
import { GisMapError } from "./gismap-errors.js?v=0.54.0-print";

export const BIN_METHODS = Object.freeze(["h3", "turf"]);
export const BIN_STATISTICS = Object.freeze(["count", "density", "sum", "mean", "min", "max"]);
export const BIN_CELL_WARNING = 25000;
export const MAX_BIN_CELLS = 100000;

const invalidMessage = (message) => new GisMapError("INVALID_SPEC", message);
const plural = (count, one, many = `${one}s`) => `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

/** The property a statistic is stored in, which the result is styled by. */
export function statisticField(statistic, field) {
  if (statistic === "count") return "point_count";
  if (statistic === "density") return "density_km2";
  return `${field}_${statistic}`;
}

/** A number from a field value, or null for blanks, text and non-finite values. */
function numeric(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Keeps a ring that crosses the 180° meridian continuous, so it does not smear across the map. */
function unwrapRing(points) {
  let shift = 0;
  return points.map(([x, y], index) => {
    const previous = points[index - 1]?.[0];
    if (previous !== undefined && Math.abs(x - previous) > 180) shift += x > previous ? -360 : 360;
    return [x + shift, y];
  });
}

const polygonParts = (geometry) => geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
const boxesTouch = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const inBox = (x, y, b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];

/** A uniform bucket index over polygon bounding boxes, so a point checks a few cells instead of all of them. */
function bucketIndex(boxes) {
  const [first] = boxes;
  const width = Math.max(first[2] - first[0], 1e-9); const height = Math.max(first[3] - first[1], 1e-9);
  const buckets = new Map();
  const key = (column, row) => `${column},${row}`;
  boxes.forEach((box, index) => {
    for (let column = Math.floor(box[0] / width); column <= Math.floor(box[2] / width); column += 1) {
      for (let row = Math.floor(box[1] / height); row <= Math.floor(box[3] / height); row += 1) {
        const list = buckets.get(key(column, row));
        if (list) list.push(index); else buckets.set(key(column, row), [index]);
      }
    }
  });
  return (x, y) => buckets.get(key(Math.floor(x / width), Math.floor(y / height))) || [];
}

/**
 * Bins point features. `points` is a FeatureCollection of Point features; `area`
 * an optional FeatureCollection of polygons that limits the study area.
 * Returns { collection, summary, styleField, metadata }.
 */
export function binPoints({ turf, h3, points, area = null, method = "h3", resolution = 7, cellKm = 10, statistic = "count", field = "", keepEmpty = false }) {
  if (!BIN_METHODS.includes(method)) throw invalidMessage(`Method must be one of: ${BIN_METHODS.join(", ")}.`);
  if (!BIN_STATISTICS.includes(statistic)) throw invalidMessage(`Statistic must be one of: ${BIN_STATISTICS.join(", ")}.`);
  field = String(field || "").trim();
  if (!field && !["count", "density"].includes(statistic)) throw invalidMessage(`The ${statistic} statistic needs a numeric field.`);
  if (field && !points.features.some((feature) => Object.hasOwn(feature.properties || {}, field))) throw invalidMessage(`No point has the field "${field}".`);
  if (method === "h3" && !h3) throw invalidMessage("The H3 library is not loaded.");
  if (method === "h3" && (!Number.isInteger(resolution) || resolution < 0 || resolution > 15)) throw invalidMessage("H3 resolution must be a whole number from 0 to 15.");

  const studyParts = area ? area.features.filter((feature) => polygonParts(feature.geometry || {}).length).map((feature) => ({ feature, box: turf.bbox(feature) })) : null;
  if (area && !studyParts.length) throw invalidMessage("The study area needs polygon features.");
  const skipped = { invalidCoordinates: 0, outsideArea: 0, outsideGrid: 0, missingValue: 0 };
  let binned = 0;
  const kept = [];
  for (const point of points.features) {
    const [x, y] = point.geometry?.coordinates || [];
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(y) > 90 || Math.abs(x) > 180) { skipped.invalidCoordinates += 1; continue; }
    if (studyParts && !studyParts.some(({ feature, box }) => inBox(x, y, box) && turf.booleanPointInPolygon([x, y], feature))) { skipped.outsideArea += 1; continue; }
    kept.push(point);
  }
  if (!kept.length) throw invalidMessage(skipped.outsideArea ? "No points fall inside the study area." : "No points have valid coordinates.");

  // Cells by key: an H3 index, or a position in the Turf grid.
  const cells = new Map();
  const cellFor = (key) => {
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { count: 0, values: 0, sum: 0, min: Infinity, max: -Infinity }));
    return cell;
  };
  const add = (cell, point) => {
    cell.count += 1; binned += 1;
    if (!field) return;
    const value = numeric(point.properties?.[field]);
    if (value === null) { skipped.missingValue += 1; return; }
    cell.values += 1; cell.sum += value;
    if (value < cell.min) cell.min = value;
    if (value > cell.max) cell.max = value;
  };
  const tooMany = (count) => invalidMessage(`That makes too many cells: about ${count.toLocaleString("en-US")}, over the ${MAX_BIN_CELLS.toLocaleString("en-US")} limit. Use a ${method === "h3" ? "lower resolution" : "larger hexagon"}${keepEmpty ? ", leave out empty cells," : ""} or a smaller study area.`);
  let geometryOf; let identity;
  let cellArea;

  if (method === "h3") {
    for (const point of kept) {
      const [x, y] = point.geometry.coordinates;
      add(cellFor(h3.latLngToCell(y, x, resolution)), point);
    }
    if (cells.size > MAX_BIN_CELLS) throw tooMany(cells.size);
    if (keepEmpty) {
      const cover = studyParts ? studyParts.map(({ feature }) => feature.geometry) : [turf.bboxPolygon(turf.bbox(turf.featureCollection(kept))).geometry];
      const estimate = cover.reduce((total, geometry) => total + turf.area(geometry) / 1e6, 0) / h3.getHexagonAreaAvg(resolution, "km2");
      if (estimate > MAX_BIN_CELLS) throw tooMany(Math.round(estimate));
      for (const geometry of cover) for (const part of polygonParts(geometry)) for (const id of h3.polygonToCells(part, resolution, true)) cellFor(id);
      if (cells.size > MAX_BIN_CELLS) throw tooMany(cells.size);
    }
    geometryOf = (id) => ({ type: "Polygon", coordinates: [unwrapRing(h3.cellToBoundary(id, true))] });
    identity = (id) => ({ h3_id: id, h3_resolution: resolution });
    cellArea = (id) => h3.cellArea(id, "km2");
  } else {
    if (!Number.isFinite(cellKm) || cellKm <= 0) throw invalidMessage("The hexagon side must be a positive number of kilometres.");
    const box = studyParts ? turf.bbox(area) : turf.bbox(turf.featureCollection(kept));
    const width = turf.distance([box[0], box[1]], [box[2], box[1]], { units: "kilometers" });
    const height = turf.distance([box[0], box[1]], [box[0], box[3]], { units: "kilometers" });
    const estimate = ((width + 6 * cellKm) * (height + 6 * cellKm)) / (2.6 * cellKm ** 2);
    if (estimate > MAX_BIN_CELLS) throw tooMany(Math.round(estimate));
    // hexGrid only fills its box, so the box grows by two cells to reach points on the edge.
    const padY = (2 * cellKm) / 111; const padX = padY / Math.max(0.05, Math.cos((Math.max(Math.abs(box[1]), Math.abs(box[3])) * Math.PI) / 180));
    let grid = turf.hexGrid([box[0] - padX, box[1] - padY, box[2] + padX, box[3] + padY], cellKm, { units: "kilometers" }).features;
    // A study area keeps the whole hexagons that touch it; cells are never clipped, so their areas stay whole.
    if (studyParts) grid = grid.filter((cell) => { const cellBox = turf.bbox(cell); return studyParts.some(({ feature, box: partBox }) => boxesTouch(cellBox, partBox) && turf.booleanIntersects(cell, feature)); });
    const boxes = grid.map((cell) => turf.bbox(cell));
    const candidates = bucketIndex(boxes);
    for (const point of kept) {
      const [x, y] = point.geometry.coordinates;
      const index = candidates(x, y).find((at) => inBox(x, y, boxes[at]) && turf.booleanPointInPolygon([x, y], grid[at]));
      if (index === undefined) skipped.outsideGrid += 1; else add(cellFor(index), point);
    }
    if (keepEmpty) grid.forEach((_, index) => cellFor(index));
    geometryOf = (index) => grid[index].geometry;
    identity = (index) => ({ cell_id: `hex-${index}`, cell_side_km: cellKm });
    cellArea = (index) => turf.area(grid[index]) / 1e6;
  }

  const keys = [...cells.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const round = (value, digits = 6) => Number(value.toPrecision(digits + 6));
  const features = keys.map((key) => {
    const cell = cells.get(key);
    const areaKm2 = cellArea(key);
    const properties = { ...identity(key), point_count: cell.count, cell_area_km2: round(areaKm2), density_km2: round(cell.count / areaKm2) };
    if (field) {
      const has = cell.values > 0;
      Object.assign(properties, {
        value_count: cell.values,
        [`${field}_sum`]: has ? cell.sum : null,
        [`${field}_mean`]: has ? cell.sum / cell.values : null,
        [`${field}_min`]: has ? cell.min : null,
        [`${field}_max`]: has ? cell.max : null,
      });
    }
    return { type: "Feature", properties, geometry: geometryOf(key) };
  });
  const emptyCells = features.filter((feature) => feature.properties.point_count === 0).length;
  const scale = method === "h3" ? `H3 resolution ${resolution}, about ${round(h3.getHexagonAreaAvg(resolution, "km2"), 3).toLocaleString("en-US")} km² each` : `side ${cellKm} km`;
  const notes = [
    skipped.invalidCoordinates && `${plural(skipped.invalidCoordinates, "point")} had invalid coordinates`,
    skipped.outsideArea && `${plural(skipped.outsideArea, "point")} fell outside the study area`,
    skipped.outsideGrid && `${plural(skipped.outsideGrid, "point")} fell outside the grid`,
    skipped.missingValue && `${plural(skipped.missingValue, "point")} had no number in ${field} (still counted)`,
  ].filter(Boolean);
  const summary = `${plural(binned, "point")} in ${plural(features.length, "hexagon")} (${scale})${emptyCells ? `, ${plural(emptyCells, "empty cell")}` : ""}.`
    + (notes.length ? ` Skipped: ${notes.join("; ")}.` : "")
    + (features.length > BIN_CELL_WARNING ? ` That is a lot of cells; the map may be slow.` : "");
  return {
    collection: { type: "FeatureCollection", features },
    summary,
    styleField: statisticField(statistic, field),
    metadata: { method, ...(method === "h3" ? { resolution } : { cellKm }), statistic, field: field || null, keepEmpty, studyArea: Boolean(studyParts), points: points.features.length, binned, skipped, cells: features.length, emptyCells },
  };
}
