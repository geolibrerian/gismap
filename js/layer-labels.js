// Layer labels: text drawn from feature attributes, styled like text boxes and
// drawn by the same renderer, so they appear on screen, in PDFs, Smart Images
// and every Print Editor template. A label comes from one field, the same text
// for every feature, or a template of text or simple HTML with {FIELD} wildcards.
import { TEXT_BOX_FONTS, normalizeRun } from "./text-boxes.js?v=0.64.2-labels";

export const LABEL_MODES = Object.freeze(["field", "template", "single"]);
const MAX_QUERY = 3000;
const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const optionalZoom = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : clamp(value, 0, 24, null));

export function normalizeLabeling(spec = {}) {
  const frame = spec.frame || {};
  return {
    enabled: spec.enabled === true,
    mode: LABEL_MODES.includes(spec.mode) ? spec.mode : "field",
    field: String(spec.field || ""),
    template: String(spec.template ?? "").slice(0, 4000),
    style: normalizeRun({ text: "", font: "sans", size: 13, bold: true, color: "#1f2933", haloColor: "#ffffff", haloWidth: 2, ...(spec.style || {}) }),
    align: ["left", "center", "right"].includes(spec.align) ? spec.align : "center",
    frame: {
      enabled: frame.enabled === true,
      fill: HEX.test(frame.fill || "") ? frame.fill : "#ffffff",
      fillOpacity: clamp(frame.fillOpacity, 0, 1, 0.85),
      outline: HEX.test(frame.outline || "") ? frame.outline : "#1f2933",
      outlineWidth: clamp(frame.outlineWidth, 0, 12, 1),
      padding: clamp(frame.padding, 0, 40, 4),
      radius: clamp(frame.radius, 0, 30, 3),
    },
    // Height: on the ground, a height above it, the feature's own Z, a field, or a fixed height above sea level (metres).
    zMode: ["ground", "above", "geometry", "field", "constant"].includes(spec.zMode) ? spec.zMode : "ground",
    zFieldAboveGround: spec.zFieldAboveGround === true,
    zField: String(spec.zField || ""),
    zValue: clamp(spec.zValue, -12000, 1e7, 0),
    minZoom: optionalZoom(spec.minZoom),
    maxZoom: optionalZoom(spec.maxZoom),
    maxLabels: clamp(spec.maxLabels, 1, 2000, 300),
    avoidOverlap: spec.avoidOverlap !== false && spec.avoidOverlap !== 0,
  };
}

/** The fields a label specification reads. */
export function labelFields(spec) {
  const fields = new Set();
  if (spec.mode === "field" && spec.field) fields.add(spec.field);
  if (spec.mode === "template") for (const [, name] of String(spec.template).matchAll(/\{([^{}:]+)(?::[^{}]*)?\}/g)) fields.add(name.trim());
  if (spec.zMode === "field" && spec.zField) fields.add(spec.zField);
  return [...fields];
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

function formatValue(value, format) {
  if (value === null || value === undefined) return "";
  if (format && Number.isFinite(Number(value))) {
    const digits = /^\d$/.test(format) ? Number(format) : null;
    if (digits !== null) return Number(value).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }
  if (typeof value === "number") return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
  return String(value);
}

/** The template with {FIELD} (or {FIELD:2} for two decimals) filled in; values are escaped, never markup. */
export function fillTemplate(template, attributes = {}) {
  return String(template).replace(/\{([^{}:]+)(?::([^{}]*))?\}/g, (_, name, format) => escapeHtml(formatValue(attributes[name.trim()], format)));
}

const CSS_COLOR = /color\s*:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i;
const CSS_SIZE = /font-size\s*:\s*(\d+(?:\.\d+)?)px/i;
const expandHex = (hex) => (hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex).toLowerCase();

/**
 * Text or simple HTML as text-box runs. Understands <b>/<strong>, <i>/<em>,
 * <br>, <p>/<div> (new lines), <small>/<big>, <font color> and <span style>
 * with color, font-size, font-weight, font-style and font-family. Other tags
 * keep their text; nothing is ever rendered as live HTML.
 */
export function htmlRuns(markup, base) {
  const runs = [];
  const push = (text, style) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    const same = last && ["font", "size", "bold", "italic", "color", "haloColor", "haloWidth"].every((key) => last[key] === style[key]);
    if (same) last.text += text; else runs.push({ ...style, text });
  };
  if (!/[<&]/.test(markup) || typeof DOMParser === "undefined") {
    push(String(markup).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&"), base);
    return runs;
  }
  const document = new DOMParser().parseFromString(`<body>${markup}</body>`, "text/html");
  const walk = (node, style) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { push(child.textContent.replace(/\s+/g, " "), style); continue; }
      if (child.nodeType !== 1) continue;
      const tag = child.tagName.toLowerCase();
      if (["script", "style"].includes(tag)) continue;
      if (tag === "br") { push("\n", style); continue; }
      const next = { ...style };
      if (tag === "b" || tag === "strong") next.bold = true;
      if (tag === "i" || tag === "em") next.italic = true;
      if (tag === "small") next.size = Math.max(6, style.size * 0.8);
      if (tag === "big") next.size = style.size * 1.25;
      if (/^h[1-3]$/.test(tag)) { next.bold = true; next.size = style.size * (1.6 - Number(tag[1]) * 0.15); }
      const color = child.getAttribute("color");
      if (color && /^#[0-9a-f]{3,6}$/i.test(color)) next.color = expandHex(color);
      const css = child.getAttribute("style") || "";
      const cssColor = css.match(CSS_COLOR);
      if (cssColor) next.color = expandHex(cssColor[1]);
      const cssSize = css.match(CSS_SIZE);
      if (cssSize) next.size = Number(cssSize[1]);
      if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(css)) next.bold = true;
      if (/font-weight\s*:\s*(normal|[1-4]00)/i.test(css)) next.bold = false;
      if (/font-style\s*:\s*italic/i.test(css)) next.italic = true;
      const family = css.match(/font-family\s*:\s*([a-z-]+)/i)?.[1]?.toLowerCase();
      const font = { serif: "serif", monospace: "mono", mono: "mono", "sans-serif": "sans", sans: "sans", cursive: "script" }[family];
      if (font && TEXT_BOX_FONTS.some((item) => item.id === font)) next.font = font;
      const block = ["p", "div", "h1", "h2", "h3", "li"].includes(tag);
      if (block && runs.length && !runs[runs.length - 1].text.endsWith("\n")) push("\n", style);
      walk(child, next);
      if (block) push("\n", style);
    }
  };
  walk(document.body, base);
  const last = runs[runs.length - 1];
  if (last) last.text = last.text.replace(/\n+$/, "");
  return runs.map((run) => ({ ...run, text: run.text.replace(/ *\n */g, "\n") })).filter((run) => run.text);
}

/** The text of one feature's label, as runs; empty when the feature has nothing to show. */
export function labelRuns(spec, attributes) {
  const base = { ...spec.style };
  if (spec.mode === "field") {
    const value = formatValue(attributes?.[spec.field]);
    return value ? [{ ...base, text: value }] : [];
  }
  const source = spec.mode === "single" ? spec.template : fillTemplate(spec.template, attributes);
  const runs = htmlRuns(source, base).map(normalizeRun).filter((run) => run.text);
  return runs.some((run) => run.text.trim()) ? runs : [];
}

function ringArea(ring) {
  let area = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) area += (ring[previous][0] - ring[index][0]) * (ring[previous][1] + ring[index][1]);
  return area / 2;
}

function ringCentroid(ring) {
  let x = 0; let y = 0; let weight = 0;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [x0, y0] = ring[previous]; const [x1, y1] = ring[index];
    const cross = x0 * y1 - x1 * y0;
    x += (x0 + x1) * cross; y += (y0 + y1) * cross; weight += cross;
  }
  if (!weight) return ring[0];
  return [x / (3 * weight), y / (3 * weight)];
}

function lineMiddle(line) {
  let total = 0;
  const lengths = line.slice(1).map((point, index) => { const length = Math.hypot(point[0] - line[index][0], point[1] - line[index][1]); total += length; return length; });
  let walked = 0;
  for (const [index, length] of lengths.entries()) {
    if (walked + length >= total / 2) {
      const t = length ? (total / 2 - walked) / length : 0;
      const [a, b] = [line[index], line[index + 1]];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] != null && b[2] != null ? a[2] + (b[2] - a[2]) * t : a[2]];
    }
    walked += length;
  }
  return line[0];
}

/** Where a feature's label goes, [longitude, latitude, z?], for GeoJSON or ArcGIS JSON geometry in WGS84. */
export function labelAnchor(geometry) {
  if (!geometry) return null;
  if (Number.isFinite(geometry.x) && Number.isFinite(geometry.y)) return [geometry.x, geometry.y, geometry.z];
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "Point") return coordinates;
  if (type === "MultiPoint") return coordinates[0];
  if (type === "LineString") return lineMiddle(coordinates);
  if (type === "MultiLineString") return lineMiddle(coordinates.reduce((a, b) => (b.length > a.length ? b : a), []));
  const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : Array.isArray(geometry.rings) ? [geometry.rings] : null;
  if (polygons) {
    const outer = polygons.map((polygon) => polygon[0]).filter((ring) => ring?.length > 2).reduce((a, b) => (Math.abs(ringArea(b)) > Math.abs(ringArea(a ?? [])) ? b : a), null);
    return outer ? ringCentroid(outer) : null;
  }
  if (Array.isArray(geometry.paths)) return lineMiddle(geometry.paths.reduce((a, b) => (b.length > a.length ? b : a), []));
  if (Array.isArray(geometry.points)) return geometry.points[0];
  return null;
}

/**
 * Keeps each labelled layer's labels: queries its features, builds label boxes,
 * and hands them to the text-box renderer, which draws them on the map and in
 * every capture. Queries follow the map (debounced) and the layer's settings.
 */
export class LayerLabeler {
  constructor({ mapController, events }) {
    this.mapController = mapController;
    this.events = events;
    this.labels = new Map(); // uid -> label boxes
    this.timer = 0;
    this.version = 0;
    for (const topic of ["view:stationary", "layer:added", "layer:changed", "layers:reset", "project:loaded", "engine:changed"]) events?.subscribe?.(topic, () => this.schedule());
    events?.subscribe?.("layer:removed", ({ uid }) => { this.labels.delete(uid); this.#changed(); });
  }

  /** All current label boxes, in layer order. */
  boxes() {
    return [...this.labels.values()].flat();
  }

  schedule(delay = 250) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.refresh().catch(() => {}), delay);
  }

  async refresh() {
    const version = ++this.version;
    const next = new Map();
    const layers = this.mapController.getLayers?.() || [];
    for (const layer of layers) {
      const spec = this.mapController.getLayerLabeling?.(layer.uid);
      if (!spec?.enabled || layer.visible === false || !layer.queryable) continue;
      try {
        next.set(layer.uid, await this.#labelsFor(layer, spec));
      } catch {
        next.set(layer.uid, []);
      }
      if (version !== this.version) return;
    }
    this.labels = next;
    this.#changed();
  }

  async #labelsFor(layer, spec) {
    const fields = labelFields(spec);
    if (spec.mode === "field" && !spec.field) return [];
    const result = await this.mapController.queryFeatures(layer.uid, {
      where: "1=1",
      geometry: "view",
      outFields: fields.length ? fields : ["*"],
      returnGeometry: true,
      outSpatialReference: { wkid: 4326 },
      num: MAX_QUERY,
    });
    const boxes = [];
    for (const [index, feature] of (result?.features || []).entries()) {
      const anchor = labelAnchor(feature.geometry);
      if (!anchor || !Number.isFinite(anchor[0]) || !Number.isFinite(anchor[1])) continue;
      const runs = labelRuns(spec, feature.attributes || {});
      if (!runs.length) continue;
      const z = spec.zMode === "constant" || spec.zMode === "above" ? spec.zValue
        : spec.zMode === "field" ? (Number.isFinite(Number(feature.attributes?.[spec.zField])) ? Number(feature.attributes[spec.zField]) : null)
          : spec.zMode === "geometry" && Number.isFinite(anchor[2]) ? anchor[2] : null;
      boxes.push({
        id: `label-${layer.uid}-${index}`,
        coordinates: [anchor[0], anchor[1], z, z !== null && (spec.zMode === "above" || (spec.zMode === "field" && spec.zFieldAboveGround))],
        align: spec.align,
        runs,
        frame: spec.frame,
        minZoom: spec.minZoom,
        maxZoom: spec.maxZoom,
        collide: spec.avoidOverlap,
        limitKey: layer.uid,
        limit: spec.maxLabels,
      });
    }
    return boxes;
  }

  #changed() {
    this.events?.publish?.("labels:changed", { count: this.boxes().length });
  }
}
