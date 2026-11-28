// Flow Map engine: the data-to-visual half of the Flow Map infographic.
//
// Everything here is pure and DOM-free: binding suggestions, recipe
// validation, row validation, aggregation, ranking, the ribbon width scale and
// great-circle link geometry split at the antimeridian. The SVG composition
// lives in flow-map-svg.js and the editor in infographics-editor.js.

export const FLOW_MAP_TEMPLATE = "flow-map";
export const RECIPE_SCHEMA_VERSION = 1;
export const FLOW_MAP_DEFAULT_TOP_N = 30;
export const FLOW_MAP_MAX_LINKS = 100;
export const MAX_ANNOTATIONS = 3;
export const LOCAL_ROW_LIMIT = 50000;
export const LAYOUTS = ["wide", "square", "portrait"];
export const THEMES = ["editorial-light", "editorial-dark"];
export const PROJECTIONS = ["world", "regional"];
export const SCOPES = ["all", "filtered", "extent", "selected"];

/** Why a row is left out of the ribbons, in the order the diagnostics table lists them. */
export const EXCLUSION_REASONS = Object.freeze({
  "unmatched-origin": "Origin ID not found in the lookup",
  "unmatched-destination": "Destination ID not found in the lookup",
  "ambiguous-origin": "Origin ID matches more than one location",
  "ambiguous-destination": "Destination ID matches more than one location",
  "missing-origin": "Origin is empty",
  "missing-destination": "Destination is empty",
  "invalid-origin-coordinates": "Origin coordinates are not valid WGS84 longitude and latitude",
  "invalid-destination-coordinates": "Destination coordinates are not valid WGS84 longitude and latitude",
  "same-location": "Origin and destination are the same place",
  "missing-weight": "Weight is empty",
  "invalid-weight": "Weight is not a number",
  "negative-weight": "Weight is negative",
  "zero-weight": "Weight is zero",
  "outside-period": "Row is outside the chosen period",
  "outside-extent": "Neither endpoint is inside the map extent",
});

const isBlank = (value) => value === null || value === undefined || (typeof value === "string" && value.trim() === "");
const text = (value) => (isBlank(value) ? "" : String(value).trim());
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** A direction-sensitive key: A→B and B→A are different flows; category keeps commodities apart. */
export function flowKey(originId, destinationId, category = "") {
  return `${originId}>${destinationId}${category ? `|${category}` : ""}`;
}

// ---------------------------------------------------------------- bindings

const NAME_HINTS = {
  origin: /(^|_|\b)(origin|orig|from|source|src|exporter|export|reporter|home)(_|\b|$)/i,
  destination: /(^|_|\b)(dest|destination|to|target|importer|import|partner|work)(_|\b|$)/i,
  weight: /(weight|value|count|qty|quantity|volume|trade|flow|amount|tonnes|tons|total|trips|_t$|_kt$)/i,
  category: /(commodity|category|product|type|mode|class|kind|group)/i,
  period: /(year|period|date|month|quarter)/i,
  lon: /(lon|lng|long|longitude|x)$/i,
  lat: /(lat|latitude|y)$/i,
};

const isNumericType = (type) => ["integer", "double", "single", "small-integer", "long", "big-integer", "number", "esriFieldTypeInteger", "esriFieldTypeDouble", "esriFieldTypeSingle", "esriFieldTypeSmallInteger"].includes(type);
const isTextType = (type) => ["string", "esriFieldTypeString", "text"].includes(type);

/**
 * Suggest field bindings from field names and types. Suggestions are only a
 * starting point: the editor shows them for the author to confirm.
 */
export function suggestFlowBindings(fields = []) {
  const list = fields.filter((field) => field?.name && !["oid", "esriFieldTypeOID", "geometry", "esriFieldTypeGeometry"].includes(field.type));
  const pick = (test, used = []) => list.find((field) => test(field) && !used.includes(field.name))?.name || null;
  const idLike = (field) => /(^|_)(id|fid|oid|objectid)$/i.test(field.name);
  const numeric = (field) => isNumericType(field.type) && !idLike(field);
  const coordinate = (role, axis) => pick((field) => numeric(field) && NAME_HINTS[role].test(field.name) && NAME_HINTS[axis].test(field.name));
  const originLon = coordinate("origin", "lon"), originLat = coordinate("origin", "lat");
  const destinationLon = coordinate("destination", "lon"), destinationLat = coordinate("destination", "lat");
  const coordinateFields = [originLon, originLat, destinationLon, destinationLat].filter(Boolean);
  const originId = pick((field) => !numeric(field) && NAME_HINTS.origin.test(field.name));
  const destinationId = pick((field) => !numeric(field) && NAME_HINTS.destination.test(field.name), [originId]);
  const weight = pick((field) => numeric(field) && NAME_HINTS.weight.test(field.name) && !NAME_HINTS.period.test(field.name), coordinateFields)
    || pick((field) => numeric(field) && !NAME_HINTS.period.test(field.name), coordinateFields);
  const category = pick((field) => (isTextType(field.type) || !field.type) && NAME_HINTS.category.test(field.name), [originId, destinationId]);
  const period = pick((field) => NAME_HINTS.period.test(field.name), [weight]);
  const mode = originId && destinationId ? "ids" : coordinateFields.length === 4 ? "coordinates" : "ids";
  return {
    mode,
    origin: { idField: originId, lonField: originLon, latField: originLat },
    destination: { idField: destinationId, lonField: destinationLon, latField: destinationLat },
    weight: { field: weight, unit: "" },
    categoryField: category,
    periodField: period,
  };
}

// ---------------------------------------------------------------- recipe

const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const oneOf = (value, options, fallback) => (options.includes(value) ? value : fallback);
const cleanText = (value, max = 400) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, max);

/** A complete, typed recipe with defaults. Unknown keys are dropped. */
export function normalizeFlowRecipe(input = {}) {
  const bindings = input.bindings || {};
  const design = input.design || {};
  const end = (value = {}) => ({ idField: value.idField || null, lonField: value.lonField || null, latField: value.latField || null });
  return {
    schemaVersion: RECIPE_SCHEMA_VERSION,
    id: cleanText(input.id || `inf-${Math.random().toString(36).slice(2, 10)}`, 80),
    template: FLOW_MAP_TEMPLATE,
    title: cleanText(input.title, 160),
    subtitle: cleanText(input.subtitle, 400),
    source: { layerId: input.source?.layerId || null, name: cleanText(input.source?.name, 160), credit: cleanText(input.source?.credit, 300) },
    query: {
      scope: { type: oneOf(input.query?.scope?.type, SCOPES, "filtered") },
      filters: Array.isArray(input.query?.filters) ? structuredClone(input.query.filters) : [],
      aggregation: "sum",
      period: input.query?.period ?? null,
      aggregatePeriods: input.query?.aggregatePeriods === true,
    },
    bindings: {
      mode: oneOf(bindings.mode, ["ids", "coordinates"], "ids"),
      origin: end(bindings.origin),
      destination: end(bindings.destination),
      lookup: bindings.lookup?.id ? { id: String(bindings.lookup.id), revision: bindings.lookup.revision || null } : null,
      weight: { field: bindings.weight?.field || null, unit: cleanText(bindings.weight?.unit, 40).trim() },
      categoryField: bindings.categoryField || null,
      periodField: bindings.periodField || null,
    },
    design: {
      layout: oneOf(design.layout, LAYOUTS, "wide"),
      theme: oneOf(design.theme, THEMES, "editorial-light"),
      projection: oneOf(design.projection, PROJECTIONS, "world"),
      topN: clampInt(design.topN, 1, FLOW_MAP_MAX_LINKS, FLOW_MAP_DEFAULT_TOP_N),
      hiddenCategories: Array.isArray(design.hiddenCategories) ? design.hiddenCategories.map(String) : [],
    },
    annotations: (Array.isArray(input.annotations) ? input.annotations : []).slice(0, MAX_ANNOTATIONS)
      .filter((note) => note?.anchor?.key && note.text)
      .map((note, index) => ({ id: cleanText(note.id || `note-${index + 1}`, 40), anchor: { type: "flow", key: String(note.anchor.key) }, text: cleanText(note.text, 240) })),
    links: { selection: "highlight", allowMapFilter: input.links?.allowMapFilter === true },
  };
}

/** Problems that stop a recipe from rendering, each with the field it concerns. */
export function validateFlowRecipe(recipe) {
  const errors = [];
  if (recipe?.schemaVersion !== RECIPE_SCHEMA_VERSION) errors.push({ path: "schemaVersion", message: `Unknown recipe version ${recipe?.schemaVersion}.` });
  if (recipe?.template !== FLOW_MAP_TEMPLATE) errors.push({ path: "template", message: `Unknown template “${recipe?.template}”.` });
  const bindings = recipe?.bindings || {};
  if (bindings.mode === "coordinates") {
    for (const [end, label] of [["origin", "Origin"], ["destination", "Destination"]]) {
      if (!bindings[end]?.lonField || !bindings[end]?.latField) errors.push({ path: `bindings.${end}`, message: `${label} needs a longitude and a latitude field.` });
    }
  } else {
    if (!bindings.origin?.idField) errors.push({ path: "bindings.origin", message: "Choose the origin ID field." });
    if (!bindings.destination?.idField) errors.push({ path: "bindings.destination", message: "Choose the destination ID field." });
    if (!bindings.lookup?.id) errors.push({ path: "bindings.lookup", message: "Choose a location lookup for the IDs." });
  }
  if (!bindings.weight?.field) errors.push({ path: "bindings.weight", message: "Choose the weight field." });
  if (!bindings.weight?.unit) errors.push({ path: "bindings.weight.unit", message: "Enter the weight's unit, such as t or trips." });
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------- resolution

const validLon = (value) => Number.isFinite(value) && value >= -180 && value <= 180;
const validLat = (value) => Number.isFinite(value) && value >= -90 && value <= 90;
const parseNumber = (value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return Number.NaN;
};

function resolveEnd(row, binding, mode, lookup, role) {
  if (mode === "coordinates") {
    const lon = parseNumber(row[binding.lonField]);
    const lat = parseNumber(row[binding.latField]);
    if (isBlank(row[binding.lonField]) && isBlank(row[binding.latField])) return { reason: `missing-${role}` };
    if (!validLon(lon) || !validLat(lat)) return { reason: `invalid-${role}-coordinates` };
    const label = binding.idField && !isBlank(row[binding.idField]) ? text(row[binding.idField]) : null;
    const id = label || `${+lon.toFixed(5)},${+lat.toFixed(5)}`;
    return { point: { id, name: label || formatCoordinate(lon, lat), lon, lat } };
  }
  const raw = row[binding.idField];
  if (isBlank(raw)) return { reason: `missing-${role}` };
  const key = lookup.normalizeKey(raw);
  const match = lookup.resolve(key);
  if (match.status === "ambiguous") return { reason: `ambiguous-${role}`, raw: text(raw) };
  if (match.status !== "ok") return { reason: `unmatched-${role}`, raw: text(raw) };
  if (!validLon(match.point.lon) || !validLat(match.point.lat)) return { reason: `invalid-${role}-coordinates`, raw: text(raw) };
  return { point: match.point };
}

export function formatCoordinate(lon, lat) {
  return `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;
}

/** Is a point inside a WGS84 extent? Handles an extent that crosses the antimeridian (xmin > xmax). */
export function pointInExtent(point, extent) {
  if (!extent) return true;
  const insideLat = point.lat >= extent.ymin && point.lat <= extent.ymax;
  const insideLon = extent.xmin <= extent.xmax ? point.lon >= extent.xmin && point.lon <= extent.xmax : point.lon >= extent.xmin || point.lon <= extent.xmax;
  return insideLat && insideLon;
}

/**
 * Validate and aggregate rows into directional flows.
 *
 * rows: plain attribute objects. Duplicate origin–destination pairs sum within
 * a category; reverse pairs stay distinct. Rows that cannot be drawn are kept
 * as diagnostics with their reason. A zero, a missing weight and an excluded
 * row are three different outcomes and are counted separately.
 */
export function resolveFlows(rows, recipeInput, { lookup = null, extent = null } = {}) {
  const recipe = recipeInput?.schemaVersion ? recipeInput : normalizeFlowRecipe(recipeInput);
  const { bindings, query } = recipe;
  const { mode } = bindings;
  const validation = validateFlowRecipe(recipe);
  const empty = (blocking) => ({ recipe, flows: [], diagnostics: [], categories: [], periods: [], unit: bindings.weight.unit, blocking, summary: summarize([], [], 0) });
  if (!validation.valid) return empty({ code: "invalid-recipe", message: validation.errors[0].message, errors: validation.errors });
  if (mode === "ids" && !lookup) return empty({ code: "missing-lookup", message: "The location lookup is not available." });
  const input = Array.isArray(rows) ? rows : [];
  if (input.length > LOCAL_ROW_LIMIT) return empty({ code: "too-many-rows", message: `This scope has ${input.length.toLocaleString("en")} rows; the local limit is ${LOCAL_ROW_LIMIT.toLocaleString("en")}. Narrow the scope or use service aggregation.` });

  // Periods: one chosen period, or an explicit aggregate across all of them.
  const periodField = bindings.periodField;
  const periods = periodField ? [...new Set(input.map((row) => row?.[periodField]).filter((value) => !isBlank(value)).map(String))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })) : [];
  const period = query.period == null ? null : String(query.period);
  if (periodField && periods.length > 1 && period == null && !query.aggregatePeriods) {
    return { ...empty({ code: "choose-period", message: `The data has ${periods.length} periods. Choose one, or aggregate across periods.` }), periods };
  }

  const diagnostics = [];
  const groups = new Map();
  let zeroRows = 0;
  input.forEach((row, index) => {
    const attributes = row?.attributes || row || {};
    const category = bindings.categoryField ? text(attributes[bindings.categoryField]) || "Uncategorized" : "";
    const rawWeight = attributes[bindings.weight.field];
    const weight = parseNumber(rawWeight);
    const exclude = (reason, extra = {}) => diagnostics.push({
      index, reason, category,
      origin: extra.origin ?? text(attributes[bindings.origin.idField]) ?? "",
      destination: extra.destination ?? text(attributes[bindings.destination.idField]) ?? "",
      weight: Number.isFinite(weight) ? weight : null,
      rawWeight: isBlank(rawWeight) ? null : String(rawWeight),
    });
    if (period != null && !query.aggregatePeriods && String(attributes[periodField]) !== period) return exclude("outside-period");
    const origin = resolveEnd(attributes, bindings.origin, mode, lookup, "origin");
    const destination = resolveEnd(attributes, bindings.destination, mode, lookup, "destination");
    const names = { origin: origin.point?.name ?? origin.raw, destination: destination.point?.name ?? destination.raw };
    if (isBlank(rawWeight)) return exclude("missing-weight", names);
    if (!Number.isFinite(weight)) return exclude("invalid-weight", names);
    if (weight < 0) return exclude("negative-weight", names);
    if (origin.reason) return exclude(origin.reason, names);
    if (destination.reason) return exclude(destination.reason, names);
    if (origin.point.id === destination.point.id || (origin.point.lon === destination.point.lon && origin.point.lat === destination.point.lat)) return exclude("same-location", names);
    if (extent && !pointInExtent(origin.point, extent) && !pointInExtent(destination.point, extent)) return exclude("outside-extent", names);
    if (weight === 0) { zeroRows += 1; return exclude("zero-weight", names); }
    const key = flowKey(origin.point.id, destination.point.id, category);
    const group = groups.get(key) || { key, origin: origin.point, destination: destination.point, category, weight: 0, rowCount: 0, periods: new Set() };
    group.weight += weight;
    group.rowCount += 1;
    if (periodField && !isBlank(attributes[periodField])) group.periods.add(String(attributes[periodField]));
    groups.set(key, group);
  });

  const flows = [...groups.values()].map((group) => ({
    ...group,
    periods: [...group.periods].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    period: period ?? (group.periods.size === 1 ? [...group.periods][0] : group.periods.size ? "All periods" : null),
    reverseKey: flowKey(group.destination.id, group.origin.id, group.category),
  })).sort(byWeight);
  const keys = new Set(flows.map((flow) => flow.key));
  flows.forEach((flow) => { flow.hasReverse = keys.has(flow.reverseKey); });

  const categoryTotals = new Map();
  flows.forEach((flow) => categoryTotals.set(flow.category, (categoryTotals.get(flow.category) || 0) + flow.weight));
  const categories = bindings.categoryField ? [...categoryTotals.entries()].sort((a, b) => b[1] - a[1] || compare(a[0], b[0])).map(([name, weight]) => ({ name, weight })) : [];

  return {
    recipe, flows, diagnostics, categories, periods,
    unit: bindings.weight.unit,
    blocking: null,
    summary: summarize(flows, diagnostics, input.length, zeroRows),
  };
}

/** Wider first; ties break by the stable flow key so order never flickers. */
export function byWeight(a, b) {
  return b.weight - a.weight || compare(a.key, b.key);
}

function summarize(flows, diagnostics, inputRows, zeroRows = 0) {
  const byReason = {};
  diagnostics.forEach((row) => { byReason[row.reason] = (byReason[row.reason] || 0) + 1; });
  // Excluded weight is only meaningful for rows that had a usable, positive
  // weight but no drawable location. If any excluded row's weight is unknown,
  // the total is a lower bound and says so.
  const locationExcluded = diagnostics.filter((row) => !["zero-weight", "outside-period", "outside-extent"].includes(row.reason));
  const excludedWeight = locationExcluded.reduce((total, row) => total + (row.weight > 0 ? row.weight : 0), 0);
  const excludedWeightComplete = locationExcluded.every((row) => row.weight !== null && row.weight >= 0);
  const validWeight = flows.reduce((total, flow) => total + flow.weight, 0);
  return {
    inputRows,
    drawnRows: flows.reduce((total, flow) => total + flow.rowCount, 0),
    resolvedFlows: flows.length,
    validWeight,
    zeroRows,
    // Rows outside the chosen period or extent are out of scope, not invalid.
    outOfScopeRows: (byReason["outside-period"] || 0) + (byReason["outside-extent"] || 0),
    excludedRows: diagnostics.length - zeroRows - (byReason["outside-period"] || 0) - (byReason["outside-extent"] || 0),
    excludedWeight,
    excludedWeightComplete,
    byReason,
  };
}

// ---------------------------------------------------------------- ranking

/**
 * The flows the graphic draws: hidden categories removed, the top N by weight
 * (capped at 100), plus the counts and share the footer discloses.
 */
export function rankFlows(resolved, { topN = FLOW_MAP_DEFAULT_TOP_N, hiddenCategories = [], complete = true } = {}) {
  const hidden = new Set(hiddenCategories);
  const eligible = resolved.flows.filter((flow) => !hidden.has(flow.category)).sort(byWeight);
  const limit = Math.min(FLOW_MAP_MAX_LINKS, Math.max(1, Math.round(topN) || FLOW_MAP_DEFAULT_TOP_N));
  const displayed = eligible.slice(0, limit);
  const displayedWeight = displayed.reduce((total, flow) => total + flow.weight, 0);
  const eligibleWeight = eligible.reduce((total, flow) => total + flow.weight, 0);
  const displayedKeys = new Set(displayed.map((flow) => flow.key));
  // Denominators are every resolved flow, so hiding a category lowers the
  // share instead of making the shown subset look like the whole.
  const validWeight = resolved.flows.reduce((total, flow) => total + flow.weight, 0);
  const presentCategories = new Set(resolved.flows.map((flow) => flow.category));
  return {
    displayed: displayed.map((flow, rank) => ({ ...flow, rank: rank + 1, reverseDisplayed: displayedKeys.has(flow.reverseKey) })),
    eligible,
    displayedCount: displayed.length,
    eligibleCount: eligible.length,
    resolvedCount: resolved.flows.length,
    displayedWeight,
    eligibleWeight,
    validWeight,
    hiddenCategories: [...hidden].filter((category) => presentCategories.has(category)),
    // The share is only stated when the denominator is the whole valid weight.
    displayedShare: complete && validWeight > 0 ? displayedWeight / validWeight : null,
  };
}

// ---------------------------------------------------------------- scales

/** A "nice" round number at or above value (1, 2, 2.5, 5 × 10ⁿ). */
export function niceCeil(value) {
  if (!(value > 0)) return 0;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const step of [1, 2, 2.5, 5, 10]) if (step * base >= value - 1e-9 * base) return step * base;
  return 10 * base;
}

/** A "nice" round number at or below value (1, 2, 2.5, 5 × 10ⁿ). */
export function niceFloor(value) {
  if (!(value > 0)) return 0;
  const exponent = Math.floor(Math.log10(value));
  const base = 10 ** exponent;
  for (const step of [10, 5, 2.5, 2, 1]) if (step * base <= value + 1e-9 * base) return step * base;
  return base;
}

/**
 * Zero-based linear ribbon width. The domain comes from every resolved flow in
 * the query scope, not just the shown ones, so toggling categories or
 * selecting a flow never rescales the legend.
 */
export function widthScale(resolved, { maxWidth = 18 } = {}) {
  const max = Math.max(0, ...resolved.flows.map((flow) => flow.weight));
  const domainMax = max || 1;
  const scale = (weight) => (Math.max(0, weight) / domainMax) * maxWidth;
  scale.domain = [0, domainMax];
  scale.range = [0, maxWidth];
  const top = niceFloor(max);
  scale.legend = top > 0 ? [top / 4, top / 2, top].map((value) => ({ value, width: scale(value) })) : [];
  return scale;
}

// ---------------------------------------------------------------- geometry

const RAD = Math.PI / 180;

/** Points along the great circle from a to b ([lon, lat] in degrees). */
export function greatCircle(a, b, steps = 64) {
  const [lon1, lat1] = [a[0] * RAD, a[1] * RAD];
  const [lon2, lat2] = [b[0] * RAD, b[1] * RAD];
  const v1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
  const v2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];
  const dot = Math.min(1, Math.max(-1, v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-9) return [a.slice(), b.slice()];
  const sin = Math.sin(omega);
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const k1 = Math.sin((1 - t) * omega) / sin;
    const k2 = Math.sin(t * omega) / sin;
    const x = k1 * v1[0] + k2 * v2[0], y = k1 * v1[1] + k2 * v2[1], z = k1 * v1[2] + k2 * v2[2];
    points.push([Math.atan2(y, x) / RAD, Math.atan2(z, Math.hypot(x, y)) / RAD]);
  }
  points[0] = a.slice();
  points[points.length - 1] = b.slice();
  return points;
}

/**
 * Split a lon/lat line where it crosses the ±180° seam. Each crossing ends one
 * segment exactly on the seam and starts the next on the opposite edge, so a
 * projection centred on 0° draws no line across the whole map.
 */
export function splitAtAntimeridian(points) {
  const segments = [];
  let current = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const [lon0, lat0] = points[i - 1];
    const [lon1, lat1] = points[i];
    if (Math.abs(lon1 - lon0) > 180) {
      const east = lon0 > 0; // leaving through the east edge (+180) or the west edge (−180)
      const edge0 = east ? 180 : -180;
      const unwrapped = east ? lon1 + 360 : lon1 - 360;
      const t = (edge0 - lon0) / (unwrapped - lon0);
      const lat = lat0 + (lat1 - lat0) * t;
      current.push([edge0, lat]);
      segments.push(current);
      current = [[-edge0, lat], points[i]];
    } else {
      current.push(points[i]);
    }
  }
  segments.push(current);
  return segments.filter((segment) => segment.length >= 2);
}

/** The geographic link for a flow: its segments and which one carries the direction cue. */
export function flowGeometry(flow, { steps = 64 } = {}) {
  const points = greatCircle([flow.origin.lon, flow.origin.lat], [flow.destination.lon, flow.destination.lat], steps);
  const segments = splitAtAntimeridian(points);
  return { segments, directionSegment: segments.length - 1, crossesAntimeridian: segments.length > 1 };
}

/**
 * The smallest lon/lat box around both endpoints, crossing the antimeridian
 * when that is narrower. Used by Zoom to endpoints.
 */
export function endpointExtent(points, padding = 2) {
  const lons = points.map((point) => point.lon), lats = points.map((point) => point.lat);
  const ymin = Math.max(-85, Math.min(...lats) - padding), ymax = Math.min(85, Math.max(...lats) + padding);
  const sorted = [...lons].sort((a, b) => a - b);
  let gap = 360 - (sorted[sorted.length - 1] - sorted[0]), start = sorted[0], finish = sorted[sorted.length - 1];
  for (let i = 1; i < sorted.length; i += 1) {
    const inner = sorted[i] - sorted[i - 1];
    if (inner > gap) { gap = inner; start = sorted[i]; finish = sorted[i - 1]; }
  }
  const wrap = (value) => ((value + 540) % 360) - 180;
  return { xmin: wrap(start - padding), ymin, xmax: wrap(finish + padding), ymax, crossesAntimeridian: start > finish };
}

// ---------------------------------------------------------------- model

/** Everything the SVG composition needs, from rows and a recipe. */
export function buildFlowMapModel(rows, recipeInput, { lookup = null, extent = null, coverage = { complete: true, label: "Complete" }, maxWidth = 18 } = {}) {
  const recipe = normalizeFlowRecipe(recipeInput);
  const resolved = resolveFlows(rows, recipe, { lookup, extent });
  const ranking = rankFlows(resolved, { topN: recipe.design.topN, hiddenCategories: recipe.design.hiddenCategories, complete: coverage.complete !== false });
  const scale = widthScale(resolved, { maxWidth });
  const displayedKeys = new Set(ranking.displayed.map((flow) => flow.key));
  const resolvedKeys = new Set(resolved.flows.map((flow) => flow.key));
  const annotations = recipe.annotations.map((note, index) => ({
    ...note,
    number: index + 1,
    status: displayedKeys.has(note.anchor.key) ? "shown" : resolvedKeys.has(note.anchor.key) ? "hidden-by-design" : "outside-result",
  }));
  return { recipe, resolved, ranking, scale, annotations, coverage, lookupCredit: lookup?.credit || null };
}
