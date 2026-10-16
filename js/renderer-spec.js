// RendererSpec: a small declarative style format that people and language
// models can write reliably, compiled here to ArcGIS renderer JSON. Pure
// functions only, shared by the in-page API and headless callers.
//
//   { type: "service" }                                   the publisher's own style
//   { type: "simple", color, outline, size }
//   { type: "choropleth", field, classes, method, ramp, normalizeBy, exclude }
//   { type: "graduated-symbols", field, classes, color, minSize, maxSize, exclude }
//   { type: "categories", field, maxCategories, colors }
//   { type: "heatmap", field }
//   { type: "arcgis", json }                              raw ArcGIS renderer JSON

export const RENDERER_TYPES = Object.freeze(["service", "simple", "choropleth", "graduated-symbols", "categories", "heatmap", "arcgis"]);
export const BREAK_METHODS = Object.freeze(["natural-breaks", "quantile", "equal-interval"]);

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
      spec.method = input.method === undefined ? "natural-breaks" : input.method;
      if (!BREAK_METHODS.includes(spec.method)) problem("INVALID_SPEC", "renderer.method", `Unknown method "${input.method}".`, `Use one of: ${BREAK_METHODS.join(", ")}.`);
      spec.ramp = input.ramp === undefined ? "greens" : input.ramp;
      if (!RAMPS[spec.ramp]) problem("INVALID_SPEC", "renderer.ramp", `Unknown ramp "${input.ramp}".`, `Use one of: ${Object.keys(RAMPS).join(", ")}.`);
      exclude();
      break;
    case "graduated-symbols":
      field("field", { numeric: true });
      number("classes", { min: 2, max: MAX_CLASSES, fallback: 5, integer: true });
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
      const { min, breaks } = computeBreaks(kept, spec);
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
