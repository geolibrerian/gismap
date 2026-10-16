// RendererSpec: a small declarative style format that people and language
// models can write reliably, compiled here to ArcGIS renderer JSON. Pure
// functions only, shared by the in-page API and headless callers.
//
//   { type: "service" }                                   the publisher's own style
//   { type: "simple", color, outline, size }
//   { type: "choropleth", field, classes, method, breaks, ramp, normalizeBy, exclude }
//   { type: "graduated-symbols", field, classes, method, breaks, color, minSize, maxSize, exclude }
//   { type: "categories", field, maxCategories, colors }
//   { type: "heatmap", field }
//   { type: "arcgis", json }                              raw ArcGIS renderer JSON
//   { type: "auto", field, ramp, classes, exclude }       chosen from the data when the map opens
//
// method "auto" picks natural breaks, quantile or equal interval from the
// field's distribution. `breaks` (class upper bounds) fixes the classes exactly.
// The app resolves "auto" when it draws the layer, and records the resolved
// style with its breaks, so saved projects and shared links look the same for
// everyone. suggestRenderers lists the styles that suit a field, ranked.

export const RENDERER_TYPES = Object.freeze(["service", "simple", "choropleth", "graduated-symbols", "categories", "heatmap", "arcgis", "auto"]);
export const BREAK_METHODS = Object.freeze(["natural-breaks", "quantile", "equal-interval", "auto"]);

/** Named colour ramps, light to dark (diverging ramps run low to high). */
export const RAMPS = Object.freeze({
  greens: ["#edf8e9", "#c7e9c0", "#a1d99b", "#74c476", "#41ab5d", "#238b45", "#005a32"],
  blues: ["#eff3ff", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#084594"],
  reds: ["#fee5d9", "#fcbba1", "#fc9272", "#fb6a4a", "#ef3b2c", "#cb181d", "#99000d"],
  oranges: ["#feedde", "#fdd0a2", "#fdae6b", "#fd8d3c", "#f16913", "#d94801", "#8c2d04"],
  purples: ["#f2f0f7", "#dadaeb", "#bcbddc", "#9e9ac8", "#807dba", "#6a51a3", "#4a1486"],
  viridis: ["#fde725", "#a0da39", "#4ac16d", "#1fa187", "#277f8e", "#365c8d", "#46327e"],
  magma: ["#fcfdbf", "#fec488", "#fc8961", "#e75263", "#b5367a", "#7e2482", "#3b0f70"],
  "red-blue-diverging": ["#2166ac", "#67a9cf", "#d1e5f0", "#f7f7f7", "#fddbc7", "#ef8a62", "#b2182b"],
  "brown-teal-diverging": ["#8c510a", "#d8b365", "#f6e8c3", "#f5f5f5", "#c7eae5", "#5ab4ac", "#01665e"],
});
const CATEGORY_COLORS = ["#1b7f6a", "#3d7db8", "#d9951e", "#ab5d8d", "#728b3f", "#8054a0", "#bf6545", "#287b83", "#a36d26", "#656fb0", "#9a4b5a", "#4c8f73"];
const NO_DATA_COLOR = "#c9cdd2";
const MAX_CLASSES = 9;

const isColor = (value) => typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value);
const isNumericField = (field) => /integer|double|single|small|long|number|oid/i.test(String(field?.type || "")) || field?.role === "numeric";

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The field name closest to `name` (case-insensitive, prefix-aware), for "did you mean" hints. */
export function closestField(name, fields = []) {
  const target = String(name || "").toLowerCase();
  if (!target || !fields.length) return null;
  const scored = fields.map((field) => {
    const candidate = String(field.name || field).toLowerCase();
    // A name that contains what was typed (CORN_SALES -> CORN_SALES_IN_DOLLARS) beats a near-spelling.
    const contained = candidate.includes(target) || target.includes(candidate);
    const score = contained ? Math.abs(candidate.length - target.length) / 100 : 1 + levenshtein(target, candidate);
    return { name: field.name || field, score };
  }).sort((a, b) => a.score - b.score);
  return scored[0]?.name || null;
}

/**
 * Checks a RendererSpec against the layer's fields and geometry. Returns the
 * normalized spec and issues like { level, code, path, message, hint }.
 */
export function validateRendererSpec(input, { fields = null, geometryType = null } = {}) {
  const issues = [];
  const problem = (code, path, message, hint, level = "error") => issues.push({ level, code, path, message, ...(hint ? { hint } : {}) });
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    problem("INVALID_SPEC", "renderer", "A renderer must be an object with a type.", `Use one of: ${RENDERER_TYPES.join(", ")}.`);
    return { valid: false, issues, spec: { type: "service" } };
  }
  const type = String(input.type || "");
  if (!RENDERER_TYPES.includes(type)) {
    problem("INVALID_SPEC", "renderer.type", `Unknown renderer type "${type}".`, `Use one of: ${RENDERER_TYPES.join(", ")}.`);
    return { valid: false, issues, spec: { type: "service" } };
  }
  const spec = { type };
  const field = (key, { numeric = false, required = true } = {}) => {
    const name = input[key];
    if (name == null || name === "") {
      if (required) problem("INVALID_SPEC", `renderer.${key}`, `"${type}" needs a ${key}.`, "Name a field from sources.inspect(url).fields.");
      return;
    }
    if (typeof name !== "string") return problem("INVALID_SPEC", `renderer.${key}`, `${key} must be a field name.`);
    if (fields) {
      const match = fields.find((item) => item.name === name) || fields.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (!match) {
        const suggestion = closestField(name, fields);
        return problem("FIELD_NOT_FOUND", `renderer.${key}`, `Field \`${name}\` does not exist${suggestion ? `; did you mean \`${suggestion}\`?` : "."}`, suggestion ? `Use "${suggestion}".` : "Use a field name exactly as sources.inspect(url) lists it.");
      }
      if (numeric && !isNumericField(match)) return problem("INVALID_SPEC", `renderer.${key}`, `Field \`${match.name}\` is not numeric, so it cannot be classed.`, 'Use a numeric field, or { "type": "categories" } for text.');
      spec[key] = match.name;
      return;
    }
    spec[key] = name;
  };
  const color = (key, fallback) => {
    if (input[key] === undefined) { if (fallback) spec[key] = fallback; return; }
    if (!isColor(input[key])) return problem("INVALID_SPEC", `renderer.${key}`, `${key} must be a hex colour such as "#1b7f6a".`);
    spec[key] = input[key];
  };
  const number = (key, { min, max, fallback, integer = false }) => {
    const value = input[key] === undefined ? fallback : Number(input[key]);
    if (value === undefined) return;
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
      return problem("INVALID_SPEC", `renderer.${key}`, `${key} must be ${integer ? "a whole number" : "a number"} from ${min} to ${max}.`);
    }
    spec[key] = value;
  };
  const exclude = () => {
    if (input.exclude === undefined) return;
    if (!Array.isArray(input.exclude) || !input.exclude.every((item) => ["number", "string"].includes(typeof item))) {
      return problem("INVALID_SPEC", "renderer.exclude", "exclude must be a list of values such as [-1].");
    }
    spec.exclude = input.exclude.slice(0, 20);
  };
  const method = () => {
    spec.method = input.method === undefined ? "natural-breaks" : input.method;
    if (!BREAK_METHODS.includes(spec.method)) problem("INVALID_SPEC", "renderer.method", `Unknown method "${input.method}".`, `Use one of: ${BREAK_METHODS.join(", ")}.`);
  };
  const breaks = () => {
    if (input.breaks === undefined) return;
    const list = input.breaks;
    if (!Array.isArray(list) || !list.length || list.length > MAX_CLASSES || !list.every((value) => typeof value === "number" && Number.isFinite(value)) || list.some((value, index) => index && value <= list[index - 1])) {
      return problem("INVALID_SPEC", "renderer.breaks", `breaks must be 1 to ${MAX_CLASSES} increasing numbers: the upper bound of each class, such as [1000, 50000, 250000].`);
    }
    spec.breaks = list.slice();
    spec.classes = list.length;
  };
  switch (type) {
    case "simple":
      color("color", "#1b7f6a");
      color("outline");
      number("size", { min: 1, max: 64, fallback: 8 });
      break;
    case "choropleth":
      field("field", { numeric: true });
      field("normalizeBy", { numeric: true, required: false });
      number("classes", { min: 2, max: MAX_CLASSES, fallback: 5, integer: true });
      method();
      breaks();
      spec.ramp = input.ramp === undefined ? "greens" : input.ramp;
      if (!RAMPS[spec.ramp]) problem("INVALID_SPEC", "renderer.ramp", `Unknown ramp "${input.ramp}".`, `Use one of: ${Object.keys(RAMPS).join(", ")}.`);
      exclude();
      break;
    case "graduated-symbols":
      field("field", { numeric: true });
      number("classes", { min: 2, max: MAX_CLASSES, fallback: 5, integer: true });
      method();
      breaks();
      color("color", "#d9951e");
      number("minSize", { min: 2, max: 48, fallback: 6 });
      number("maxSize", { min: 4, max: 96, fallback: 28 });
      exclude();
      if (geometryType && /polygon/i.test(geometryType)) problem("INVALID_SPEC", "renderer.type", "Graduated symbols need point or line features; this layer has polygons, so a choropleth is drawn instead.", 'Use { "type": "choropleth" } for polygons.', "warning");
      break;
    case "categories":
      field("field");
      number("maxCategories", { min: 2, max: 12, fallback: 10, integer: true });
      if (input.colors !== undefined) {
        if (!input.colors || typeof input.colors !== "object" || Array.isArray(input.colors) || !Object.values(input.colors).every(isColor)) problem("INVALID_SPEC", "renderer.colors", 'colors must map values to hex colours, such as { "Active": "#d9951e" }.');
        else spec.colors = { ...input.colors };
      }
      break;
    case "heatmap":
      field("field", { numeric: true, required: false });
      if (geometryType && !/point/i.test(geometryType)) problem("INVALID_SPEC", "renderer.type", "A heat map needs point features.", 'Use { "type": "choropleth" } or "simple" for lines and polygons.');
      break;
    case "auto":
      field("field", { required: false });
      number("classes", { min: 2, max: MAX_CLASSES, integer: true });
      if (input.ramp !== undefined) {
        spec.ramp = input.ramp;
        if (!RAMPS[spec.ramp]) problem("INVALID_SPEC", "renderer.ramp", `Unknown ramp "${input.ramp}".`, `Use one of: ${Object.keys(RAMPS).join(", ")}.`);
      }
      exclude();
      break;
    case "arcgis":
      if (!input.json || typeof input.json !== "object") problem("INVALID_SPEC", "renderer.json", '"arcgis" needs the renderer JSON in json.');
      else if (JSON.stringify(input.json).length > 200000) problem("INVALID_SPEC", "renderer.json", "The renderer JSON is too large (over 200 KB).");
      else spec.json = input.json;
      break;
    default:
      break;
  }
  return { valid: !issues.some((issue) => issue.level === "error"), issues, spec };
}

/** Upper bounds of `classes` classes (the last is the maximum), and the minimum. */
export function computeBreaks(values, { classes = 5, method = "natural-breaks" } = {}) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return { min: null, breaks: [] };
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const distinct = [...new Set(sorted)];
  const count = Math.max(1, Math.min(classes, distinct.length));
  if (count === 1 || min === max) return { min, breaks: [max] };
  if (method === "equal-interval") return { min, breaks: Array.from({ length: count }, (_, index) => (index === count - 1 ? max : min + ((max - min) * (index + 1)) / count)) };
  if (method === "quantile") {
    const breaks = Array.from({ length: count }, (_, index) => (index === count - 1 ? max : sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * (index + 1)) / count) - 1)]));
    return { min, breaks: [...new Set(breaks)] };
  }
  // Natural breaks (Jenks), on an evenly spaced sample of at most 3,000 values for speed.
  const data = sorted.length > 3000 ? Array.from({ length: 3000 }, (_, index) => sorted[Math.round((index * (sorted.length - 1)) / 2999)]) : sorted;
  const n = data.length;
  const lower = Array.from({ length: n + 1 }, () => new Array(count + 1).fill(0));
  const variance = Array.from({ length: n + 1 }, () => new Array(count + 1).fill(Infinity));
  for (let j = 1; j <= count; j += 1) { lower[1][j] = 1; variance[1][j] = 0; }
  for (let l = 2; l <= n; l += 1) {
    let sum = 0;
    let squares = 0;
    let weight = 0;
    for (let m = 1; m <= l; m += 1) {
      const lowerIndex = l - m + 1;
      const value = data[lowerIndex - 1];
      weight += 1;
      sum += value;
      squares += value * value;
      const v = squares - (sum * sum) / weight;
      if (lowerIndex > 1) {
        for (let j = 2; j <= count; j += 1) {
          if (variance[l][j] >= v + variance[lowerIndex - 1][j - 1]) {
            lower[l][j] = lowerIndex;
            variance[l][j] = v + variance[lowerIndex - 1][j - 1];
          }
        }
      }
    }
    lower[l][1] = 1;
    variance[l][1] = squares - (sum * sum) / weight;
  }
  const breaks = new Array(count);
  breaks[count - 1] = data[n - 1];
  let k = n;
  for (let j = count; j >= 2; j -= 1) {
    const index = lower[k][j] - 2;
    breaks[j - 2] = data[index];
    k = lower[k][j] - 1;
  }
  return { min, breaks: [...new Set(breaks)] };
}

/**
 * The classes for a classed style: the spec's own `breaks` when it has them
 * (stretched to take in values beyond the first and last bound, so nothing
 * falls out of the legend), otherwise computed with its method ("auto" picks one).
 */
function classBreaks(values, spec) {
  const finite = values.filter(Number.isFinite);
  if (spec.breaks?.length) {
    const breaks = spec.breaks.slice();
    const low = finite.length ? Math.min(...finite) : breaks[0];
    const high = finite.length ? Math.max(...finite) : breaks[breaks.length - 1];
    if (high > breaks[breaks.length - 1]) breaks[breaks.length - 1] = high;
    return { min: Math.min(low, breaks[0]), breaks };
  }
  const method = spec.method === "auto" ? chooseBreakMethod(describeValues(finite)).method : spec.method;
  return computeBreaks(finite, { classes: spec.classes || defaultClassCount(finite.length), method });
}

/** `count` colours from a named ramp, spread across its whole range. */
export function rampColors(name, count) {
  const ramp = RAMPS[name] || RAMPS.greens;
  if (count <= 1) return [ramp[ramp.length - 1]];
  return Array.from({ length: count }, (_, index) => ramp[Math.round((index * (ramp.length - 1)) / (count - 1))]);
}

const formatNumber = (value) => (Math.abs(value) >= 1000 ? Math.round(value).toLocaleString("en-US") : Number(value.toFixed(2)).toLocaleString("en-US"));

function symbolFor(geometryType, color, { size = 8, outline = null } = {}) {
  if (/polygon/i.test(geometryType || "")) return { type: "simple-fill", color, outline: { color: outline || "rgba(255,255,255,0.55)", width: 0.4 } };
  if (/line/i.test(geometryType || "")) return { type: "simple-line", color, width: Math.max(1, size / 3) };
  return { type: "simple-marker", color, size, outline: { color: outline || "#ffffff", width: 0.8 } };
}

/** Arcade that turns excluded codes (and division by zero) into nulls, which draw as "No data". */
function valueExpression(field, exclude = [], normalizeBy = null) {
  const quoted = (name) => `$feature[${JSON.stringify(name)}]`;
  const list = JSON.stringify(exclude);
  let body = `var v = ${quoted(field)};\nif (IsEmpty(v)${exclude.length ? ` || Includes(${list}, v)` : ""}) { return null; }\n`;
  if (normalizeBy) body += `var n = ${quoted(normalizeBy)};\nif (IsEmpty(n) || n == 0) { return null; }\nreturn v / n;`;
  else body += "return v;";
  return body;
}

/**
 * ArcGIS renderer JSON (autocast form) for a validated spec. `values` are the
 * field's values for classed styles (codes in `exclude` are left out of the
 * breaks), `categories` are [{ value, count }] for "categories".
 */
export function compileRenderer(spec, { geometryType = "polygon", values = [], categories = [], fieldAlias = null } = {}) {
  const noData = (label = "No data") => ({ defaultSymbol: symbolFor(geometryType, NO_DATA_COLOR, { size: 6 }), defaultLabel: label });
  switch (spec.type) {
    case "simple":
      return { type: "simple", symbol: symbolFor(geometryType, spec.color || "#1b7f6a", { size: spec.size, outline: spec.outline }) };
    case "categories": {
      const top = categories.slice().sort((a, b) => b.count - a.count).slice(0, spec.maxCategories || 10);
      return {
        type: "unique-value",
        field: spec.field,
        uniqueValueInfos: top.map((item, index) => ({ value: item.value, label: String(item.value ?? "(empty)"), symbol: symbolFor(geometryType, spec.colors?.[item.value] || CATEGORY_COLORS[index % CATEGORY_COLORS.length]) })),
        ...noData("Other"),
      };
    }
    case "heatmap": {
      const colors = rampColors("magma", 6).reverse();
      return {
        type: "heatmap",
        ...(spec.field ? { field: spec.field } : {}),
        colorStops: [{ ratio: 0, color: "rgba(255,255,255,0)" }, ...colors.map((color, index) => ({ ratio: (index + 1) / colors.length, color }))],
        radius: 14,
        maxDensity: 0.04,
        minDensity: 0,
      };
    }
    case "choropleth":
    case "graduated-symbols": {
      const exclude = (spec.exclude || []).map(Number).filter(Number.isFinite);
      const kept = values.filter((value) => Number.isFinite(value) && !exclude.includes(value));
      const { min, breaks } = classBreaks(kept, spec);
      const asSymbols = spec.type === "graduated-symbols" && !/polygon/i.test(geometryType || "");
      const colors = asSymbols ? breaks.map(() => spec.color || "#d9951e") : rampColors(spec.ramp || "greens", breaks.length);
      const sizes = breaks.map((_, index) => (breaks.length === 1 ? spec.maxSize || 28 : (spec.minSize || 6) + (((spec.maxSize || 28) - (spec.minSize || 6)) * index) / (breaks.length - 1)));
      let lower = min;
      const classBreakInfos = breaks.map((upper, index) => {
        const info = { minValue: lower, maxValue: upper, label: `${formatNumber(lower)} – ${formatNumber(upper)}`, symbol: symbolFor(geometryType, colors[index], { size: asSymbols ? sizes[index] : 8 }) };
        lower = upper;
        return info;
      });
      const expression = exclude.length || spec.normalizeBy;
      return {
        type: "class-breaks",
        ...(expression
          ? { valueExpression: valueExpression(spec.field, exclude, spec.normalizeBy), valueExpressionTitle: fieldAlias || spec.field }
          : { field: spec.field }),
        classBreakInfos,
        ...noData(),
      };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Style suggestions: which styles suit a field, decided from its values.

const SKIP_FIELD = /^(?:objectid\w*|fid|oid|ogc_fid|globalid|guid|shape(?:_\w+)?|shape__\w+|st_area\w*|st_length\w*|id|\w*_id|\w*fips\w*|geoid\w*|zip\w*|postal\w*|lat|latitude|lon|lng|long|longitude|x|y|z|\w*_code|code)$/i;
const MEASURE_WORDS = ["value", "amount", "total", "sales", "dollars", "usd", "count", "pop", "rate", "percent", "pct", "density", "income", "price", "cost", "mag", "acres", "concentration", "pm2", "pm25", "score", "index", "sum", "avg", "mean", "median"];
const isTextField = (field) => /string|text/i.test(String(field?.type || ""));
const roundBreak = (value) => (Number.isInteger(value) ? value : Number(value.toPrecision(8)));

/** Class count that suits n features: fewer classes for small layers. */
export function defaultClassCount(n) {
  return n < 20 ? 3 : n < 60 ? 4 : 5;
}

/**
 * Summary of a numeric field's values, leaving out nulls and the codes in
 * `exclude`: { count, excluded, missing, distinct, min, max, mean, median, skew, integers }.
 */
export function describeValues(values = [], { exclude = [] } = {}) {
  const codes = new Set(exclude.map(Number).filter(Number.isFinite));
  let excluded = 0;
  let missing = 0;
  const kept = [];
  for (const raw of values) {
    if (raw === null || raw === undefined || raw === "") { missing += 1; continue; }
    const value = Number(raw);
    if (!Number.isFinite(value)) { missing += 1; continue; }
    if (codes.has(value)) { excluded += 1; continue; }
    kept.push(value);
  }
  kept.sort((a, b) => a - b);
  const count = kept.length;
  if (!count) return { count, excluded, missing, distinct: 0, min: null, max: null, mean: null, median: null, skew: null, integers: false };
  const mean = kept.reduce((sum, value) => sum + value, 0) / count;
  const variance = kept.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const sd = Math.sqrt(variance);
  const skew = sd ? kept.reduce((sum, value) => sum + ((value - mean) / sd) ** 3, 0) / count : 0;
  const median = count % 2 ? kept[(count - 1) / 2] : (kept[count / 2 - 1] + kept[count / 2]) / 2;
  return { count, excluded, missing, distinct: new Set(kept).size, min: kept[0], max: kept[count - 1], mean, median, skew, integers: kept.every(Number.isInteger) };
}

/** The break method that suits a distribution, with the reason in plain words. */
export function chooseBreakMethod(stats) {
  const skew = Math.abs(stats?.skew ?? 0);
  if (skew >= 1) return { method: "quantile", reason: "The values are skewed (a few are much larger than the rest), so quantile classes give each colour about the same number of features." };
  if (skew >= 0.3) return { method: "natural-breaks", reason: "The values fall in uneven clusters, so natural breaks put the class limits in the gaps between them." };
  return { method: "equal-interval", reason: "The values are spread evenly, so equal intervals make the classes easiest to read." };
}

/**
 * The field to style when none is named: a measurement-like numeric field,
 * never an ID, code or shape field. Returns a field name or null.
 */
export function chooseStyleField(fields = []) {
  const usable = fields.filter((field) => field?.name && !SKIP_FIELD.test(field.name) && !/oid|geometry|guid|global-?id|blob|raster|date/i.test(String(field.type || "")));
  const numeric = usable.filter(isNumericField);
  // The field naming the most measures wins (CORN_SALES_IN_DOLLARS over CORN_OPERATIONS_WITH_SALES).
  const score = (field) => {
    const words = `${field.name} ${field.alias || ""}`.toLowerCase().split(/[^a-z0-9]+/);
    return MEASURE_WORDS.filter((word) => words.includes(word)).length;
  };
  const best = numeric.reduce((top, field) => (score(field) > (top ? score(top) : 0) ? field : top), null);
  return (best || numeric[0] || usable.find(isTextField) || null)?.name ?? null;
}

const METHOD_LABEL = { "natural-breaks": "natural breaks", quantile: "quantile", "equal-interval": "equal interval" };

/**
 * Ranked styles for one field, from its values. Pure: pass the field's values
 * (for the layer's current filter) and its type.
 *
 * Returns { field, stats, options } where each option is
 *   { id, label, reason, recommended, spec, pinnedSpec, breaks }
 * `spec` re-decides its classes from the data each time the map opens;
 * `pinnedSpec` adds the computed `breaks` so everyone sees the same classes.
 */
export function suggestRenderers({ field, fieldType = "double", geometryType = "polygon", values = [], exclude = [], ramp = null, classes = null } = {}) {
  const geometry = String(geometryType || "").toLowerCase();
  const isPoint = /point/.test(geometry);
  const isPolygon = /polygon/.test(geometry);
  const options = [];
  const push = (option) => options.push({ recommended: false, ...option });

  if (isTextField({ type: fieldType })) {
    const counts = new Map();
    values.forEach((value) => { if (value !== null && value !== undefined && value !== "") counts.set(value, (counts.get(value) || 0) + 1); });
    const distinct = counts.size;
    const stats = { count: values.length, distinct, missing: values.length - [...counts.values()].reduce((sum, count) => sum + count, 0) };
    if (distinct) {
      const maxCategories = Math.min(10, Math.max(2, distinct));
      const spec = { type: "categories", field, maxCategories };
      push({ id: "categories", label: `Categories by ${field}`, reason: distinct <= maxCategories ? `${distinct} distinct values, one colour each.` : `${distinct} distinct values: the ${maxCategories} most common get their own colour, the rest are "Other".`, spec, pinnedSpec: spec, breaks: null });
    }
    if (isPoint) push({ id: "heatmap", label: "Heat map of point density", reason: "Shows where points are concentrated; the field is not used.", spec: { type: "heatmap" }, pinnedSpec: { type: "heatmap" }, breaks: null });
    if (options[0]) options[0].recommended = true;
    return { field, stats, options };
  }

  const stats = describeValues(values, { exclude });
  if (!stats.count) return { field, stats, options };
  const excludeList = exclude.length ? { exclude: exclude.slice(0, 20) } : {};
  const finite = values.map(Number).filter((value) => Number.isFinite(value) && !exclude.map(Number).includes(value));
  const count = Math.min(classes || defaultClassCount(stats.count), MAX_CLASSES);
  const diverging = stats.min < 0 && stats.max > 0;
  const rampName = ramp || (diverging ? "red-blue-diverging" : "greens");
  const preferred = chooseBreakMethod(stats);
  const excludedNote = stats.excluded ? ` ${stats.excluded.toLocaleString("en-US")} feature${stats.excluded === 1 ? "" : "s"} with ${exclude.join(", ")} ${stats.excluded === 1 ? "is" : "are"} drawn as "No data".` : "";
  const divergingNote = diverging && !ramp ? " Values run from negative to positive, so a diverging ramp is used." : "";

  if (stats.distinct === 1) {
    push({ id: "simple", label: "Single colour", reason: `Every feature has the value ${stats.min}, so classes would not tell them apart.`, spec: { type: "simple" }, pinnedSpec: { type: "simple" }, breaks: null, recommended: true });
    return { field, stats, options };
  }

  const classed = (type, method, extra = {}) => {
    const { breaks } = computeBreaks(finite, { classes: count, method });
    const spec = { type, field, method, classes: count, ...(type === "choropleth" ? { ramp: rampName } : {}), ...excludeList, ...extra };
    const rounded = breaks.map(roundBreak);
    return { spec, pinnedSpec: rounded.length >= 2 ? { ...spec, classes: rounded.length, breaks: rounded } : spec, breaks: rounded };
  };
  const methods = [preferred.method, ...["quantile", "natural-breaks", "equal-interval"].filter((method) => method !== preferred.method)];
  const otherReason = {
    quantile: "Each colour holds about the same number of features.",
    "natural-breaks": "Class limits fall in the gaps between clusters of values.",
    "equal-interval": "Every class covers the same range of values.",
  };
  // Points read best as sized symbols; lines and polygons as colours.
  const primaryType = isPoint ? "graduated-symbols" : "choropleth";
  methods.forEach((method, index) => push({
    id: `${primaryType}-${method}`,
    label: `${primaryType === "choropleth" ? "Colours" : "Sized symbols"}, ${METHOD_LABEL[method]} (${count} classes)`,
    reason: `${index === 0 ? preferred.reason : otherReason[method]}${excludedNote}${primaryType === "choropleth" ? divergingNote : ""}`,
    recommended: index === 0,
    ...classed(primaryType, method),
  }));
  if (isPoint) {
    push({ id: `choropleth-${preferred.method}`, label: `Coloured points, ${METHOD_LABEL[preferred.method]}`, reason: `Points coloured by class instead of sized.${excludedNote}`, ...classed("choropleth", preferred.method) });
    push({ id: "heatmap", label: `Heat map weighted by ${field}`, reason: "Shows where the largest values are concentrated, rather than individual points.", spec: { type: "heatmap", field }, pinnedSpec: { type: "heatmap", field }, breaks: null });
  } else if (!isPolygon) {
    push({ id: `graduated-symbols-${preferred.method}`, label: `Line widths, ${METHOD_LABEL[preferred.method]}`, reason: `Wider lines for larger values.${excludedNote}`, ...classed("graduated-symbols", preferred.method) });
  }
  if (stats.integers && stats.distinct <= 8) {
    const spec = { type: "categories", field, maxCategories: Math.max(2, stats.distinct) };
    push({ id: "categories", label: `One colour per value (${stats.distinct} values)`, reason: "The field has only a few whole-number values, which may be codes or ratings rather than amounts.", spec, pinnedSpec: spec, breaks: null });
  }
  return { field, stats, options };
}

/**
 * A validated spec with every "auto" decided: type "auto" becomes the top
 * suggestion, method "auto" the method that suits the values. The result
 * carries `breaks`, so it draws the same way wherever it is opened again.
 * `values` are the field's values (numbers, or text for a text field).
 */
export function resolveRendererSpec(spec, { values = [], fieldType = "double", geometryType = "polygon" } = {}) {
  if (spec.type === "auto") {
    const { options } = suggestRenderers({ field: spec.field, fieldType, geometryType, values, exclude: spec.exclude || [], ramp: spec.ramp || null, classes: spec.classes || null });
    const chosen = options.find((option) => option.recommended);
    return chosen ? { ...chosen.pinnedSpec } : { type: "simple", color: "#1b7f6a" };
  }
  if (["choropleth", "graduated-symbols"].includes(spec.type) && spec.method === "auto" && !spec.breaks) {
    const exclude = (spec.exclude || []).map(Number);
    const finite = values.map(Number).filter((value) => Number.isFinite(value) && !exclude.includes(value));
    const { method } = chooseBreakMethod(describeValues(finite));
    const { breaks } = computeBreaks(finite, { classes: spec.classes, method });
    return breaks.length >= 2 ? { ...spec, method, classes: breaks.length, breaks: breaks.map(roundBreak) } : { ...spec, method };
  }
  return spec;
}
