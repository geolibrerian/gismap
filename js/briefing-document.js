// The briefing document: an ordered set of slides kept in the project under
// presentation.briefing. Pure functions only, so the app, custom tools and
// agents all edit the same JSON the same way.

export const BRIEFING_SCHEMA_VERSION = 1;
export const MAX_SLIDES = 60;
const MAX_TITLE = 160;
const MAX_TEXT = 4000;
const MAX_NOTES = 4000;

/** The first-release templates, all on a fixed grid. */
export const SLIDE_TEMPLATES = Object.freeze([
  { id: "title", label: "Title", description: "Opening slide: briefing title, subtitle and date" },
  { id: "feature", label: "Feature", description: "One selected feature: map, overview facts and source" },
  { id: "map-narrative", label: "Map and narrative", description: "A map view with explanatory text" },
  { id: "key-numbers", label: "Key numbers", description: "Two to four statistics from the briefing data" },
  { id: "actions", label: "Actions", description: "Next steps and links to close the briefing" },
]);
const TEMPLATE_IDS = new Set(SLIDE_TEMPLATES.map((template) => template.id));

export const STAT_TYPES = Object.freeze(["count", "sum", "average", "min", "max"]);
const FILTER_OPERATORS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "starts_with", "is_null", "is_not_null", "and", "or", "not", "feature_ids"]);

const text = (value, max) => String(value ?? "").slice(0, max);
const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : null);

/** A short random ID, stable once saved. */
export function newId(prefix) {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 8) || Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

function normalizeCamera(camera) {
  if (!camera || typeof camera !== "object") return null;
  const center = array(camera.center).map(Number);
  if (center.length !== 2 || !center.every(Number.isFinite) || Math.abs(center[0]) > 180 || Math.abs(center[1]) > 90) return null;
  return {
    center,
    zoom: Math.min(24, Math.max(0, finite(camera.zoom) ?? 12)),
    heading: finite(camera.heading) ?? 0,
    tilt: Math.min(90, Math.max(0, finite(camera.tilt) ?? 0)),
  };
}

/** Filters are a typed tree (never code). Unknown operators are rejected, not run. */
export function normalizeFilter(filter, depth = 0) {
  if (!filter || typeof filter !== "object" || depth > 6 || !FILTER_OPERATORS.has(filter.op)) return null;
  if (["and", "or"].includes(filter.op)) {
    const args = array(filter.args).map((arg) => normalizeFilter(arg, depth + 1)).filter(Boolean).slice(0, 20);
    return args.length ? { op: filter.op, args } : null;
  }
  if (filter.op === "not") {
    const arg = normalizeFilter(filter.arg, depth + 1);
    return arg ? { op: "not", arg } : null;
  }
  if (filter.op === "feature_ids") return { op: "feature_ids", ids: array(filter.ids).map(String).slice(0, 2000) };
  if (typeof filter.field !== "string" || !filter.field) return null;
  if (["is_null", "is_not_null"].includes(filter.op)) return { op: filter.op, field: filter.field };
  if (["in", "not_in"].includes(filter.op)) return { op: filter.op, field: filter.field, values: array(filter.values).slice(0, 200) };
  return { op: filter.op, field: filter.field, value: filter.value ?? null };
}

function normalizeBlock(block) {
  if (!block || typeof block !== "object") return null;
  const id = typeof block.id === "string" && block.id ? block.id : newId("b");
  if (block.type === "text") return { ...block, id, type: "text", markdown: text(block.markdown, MAX_TEXT) };
  if (block.type === "stat") {
    return {
      ...block,
      id,
      type: "stat",
      stat: STAT_TYPES.includes(block.stat) ? block.stat : "count",
      field: typeof block.field === "string" ? block.field : null,
      queryRef: typeof block.queryRef === "string" && block.queryRef ? block.queryRef : null,
      label: text(block.label, 80),
    };
  }
  if (block.type === "facts") return { ...block, id, type: "facts", fields: array(block.fields).map(String).slice(0, 12) };
  if (block.type === "list") return { ...block, id, type: "list", items: array(block.items).map((item) => text(item, 300)).filter(Boolean).slice(0, 12) };
  if (block.type === "links") {
    return { ...block, id, type: "links", links: array(block.links).map((link) => ({ label: text(link?.label, 120), url: safeUrl(link?.url) })).filter((link) => link.url).slice(0, 8) };
  }
  // Unknown block types survive a round trip untouched, for newer versions of the app.
  return { ...block, id };
}

/** Only http(s) links are kept; anything else (javascript:, data:) is dropped. */
export function safeUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function normalizeSlide(slide) {
  if (!slide || typeof slide !== "object") return null;
  return {
    ...slide,
    id: typeof slide.id === "string" && slide.id ? slide.id : newId("s"),
    template: TEMPLATE_IDS.has(slide.template) ? slide.template : "map-narrative",
    title: text(slide.title, MAX_TITLE),
    subtitle: text(slide.subtitle, MAX_TITLE),
    featureId: slide.featureId != null && slide.featureId !== "" ? String(slide.featureId) : null,
    camera: normalizeCamera(slide.camera),
    fit: ["feature", "selection"].includes(slide.fit) ? slide.fit : null,
    blocks: array(slide.blocks).map(normalizeBlock).filter(Boolean).slice(0, 12),
    notes: text(slide.notes, MAX_NOTES),
    hidden: slide.hidden === true,
  };
}

/** A complete, valid briefing document from whatever was saved (or nothing). */
export function normalizeBriefing(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const queries = {};
  for (const [name, filter] of Object.entries(source.queries && typeof source.queries === "object" ? source.queries : {})) {
    const normalized = normalizeFilter(filter);
    if (normalized && /^[\w-]{1,40}$/.test(name)) queries[name] = normalized;
  }
  const seen = new Set();
  const slides = array(source.slides).map(normalizeSlide).filter((slide) => slide && !seen.has(slide.id) && seen.add(slide.id)).slice(0, MAX_SLIDES);
  return { ...source, schemaVersion: BRIEFING_SCHEMA_VERSION, queries, slides };
}

/** A new slide from a template, prefilled from what the briefing already knows. */
export function createSlide(template, { title = "", subtitle = "", featureId = null, camera = null, fields = [], date = new Date() } = {}) {
  const base = { id: newId("s"), template, title, subtitle, featureId, camera, fit: null, blocks: [], notes: "", hidden: false };
  if (template === "title") {
    base.subtitle = subtitle || date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }
  if (template === "feature") {
    base.fit = camera ? null : "feature";
    base.blocks = [{ id: newId("b"), type: "facts", fields: fields.slice(0, 5) }, { id: newId("b"), type: "text", markdown: "" }];
  }
  if (template === "map-narrative") base.blocks = [{ id: newId("b"), type: "text", markdown: "" }];
  if (template === "key-numbers") {
    base.blocks = [
      { id: newId("b"), type: "stat", stat: "count", field: null, queryRef: null, label: "Features" },
      { id: newId("b"), type: "text", markdown: "" },
    ];
  }
  if (template === "actions") base.blocks = [{ id: newId("b"), type: "list", items: [] }, { id: newId("b"), type: "links", links: [] }];
  return normalizeSlide(base);
}

// Edits return a new briefing; they never change the one passed in.
const withSlides = (briefing, slides) => normalizeBriefing({ ...briefing, slides });

export function addSlide(briefing, slide, afterId = null) {
  const slides = [...normalizeBriefing(briefing).slides];
  if (slides.length >= MAX_SLIDES) throw new Error(`A briefing can hold at most ${MAX_SLIDES} slides.`);
  const index = afterId ? slides.findIndex((item) => item.id === afterId) : -1;
  slides.splice(index >= 0 ? index + 1 : slides.length, 0, slide);
  return withSlides(briefing, slides);
}

export function updateSlide(briefing, id, patch) {
  return withSlides(briefing, normalizeBriefing(briefing).slides.map((slide) => (slide.id === id ? { ...slide, ...patch, id } : slide)));
}

export function removeSlide(briefing, id) {
  return withSlides(briefing, normalizeBriefing(briefing).slides.filter((slide) => slide.id !== id));
}

export function moveSlide(briefing, id, offset) {
  const slides = [...normalizeBriefing(briefing).slides];
  const from = slides.findIndex((slide) => slide.id === id);
  // Moves past either end stop at the first or last place.
  const to = Math.min(slides.length - 1, Math.max(0, from + offset));
  if (from < 0 || to === from) return normalizeBriefing(briefing);
  const [slide] = slides.splice(from, 1);
  slides.splice(to, 0, slide);
  return withSlides(briefing, slides);
}

export function duplicateSlide(briefing, id) {
  const slide = normalizeBriefing(briefing).slides.find((item) => item.id === id);
  if (!slide) return normalizeBriefing(briefing);
  const copy = structuredClone(slide);
  copy.id = newId("s");
  copy.title = slide.title ? `${slide.title} (copy)` : "";
  copy.blocks = copy.blocks.map((block) => ({ ...block, id: newId("b") }));
  return addSlide(briefing, copy, id);
}

export function updateBlock(briefing, slideId, blockId, patch) {
  const slide = normalizeBriefing(briefing).slides.find((item) => item.id === slideId);
  if (!slide) return normalizeBriefing(briefing);
  return updateSlide(briefing, slideId, { blocks: slide.blocks.map((block) => (block.id === blockId ? { ...block, ...patch, id: blockId } : block)) });
}

/** Evaluates a filter tree against one record's attributes (for loaded data). */
export function matchesFilter(filter, attributes = {}, id = null) {
  if (!filter) return true;
  const value = attributes[filter.field];
  const comparable = (left, right) => {
    const a = Number(left);
    const b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) && left !== "" && right !== "" ? [a, b] : [String(left ?? "").toLowerCase(), String(right ?? "").toLowerCase()];
  };
  switch (filter.op) {
    case "and": return filter.args.every((arg) => matchesFilter(arg, attributes, id));
    case "or": return filter.args.some((arg) => matchesFilter(arg, attributes, id));
    case "not": return !matchesFilter(filter.arg, attributes, id);
    case "feature_ids": return id != null && filter.ids.includes(String(id));
    case "is_null": return value == null || value === "";
    case "is_not_null": return !(value == null || value === "");
    case "in": return filter.values.some((item) => String(item) === String(value));
    case "not_in": return !filter.values.some((item) => String(item) === String(value));
    case "contains": return String(value ?? "").toLowerCase().includes(String(filter.value ?? "").toLowerCase());
    case "starts_with": return String(value ?? "").toLowerCase().startsWith(String(filter.value ?? "").toLowerCase());
    default: {
      if (value == null) return false;
      const [a, b] = comparable(value, filter.value);
      if (filter.op === "eq") return a === b;
      if (filter.op === "neq") return a !== b;
      if (filter.op === "gt") return a > b;
      if (filter.op === "gte") return a >= b;
      if (filter.op === "lt") return a < b;
      if (filter.op === "lte") return a <= b;
      return false;
    }
  }
}

/**
 * A statistic over loaded records. `total` is the source's full count when known;
 * if fewer records are loaded, the result says it is a sample of them.
 */
export function computeStat(block, records = [], { queries = {}, idField = null, total = null } = {}) {
  const filter = block.queryRef ? queries[block.queryRef] : null;
  const matching = records.filter((record) => matchesFilter(filter, record.attributes || {}, idField ? record.attributes?.[idField] : null));
  const sample = Number.isFinite(total) && total > records.length;
  if (block.stat === "count") {
    return { value: matching.length, sample, loaded: records.length, total, matched: matching.length };
  }
  const values = matching.map((record) => Number(record.attributes?.[block.field])).filter(Number.isFinite);
  if (!block.field || !values.length) return { value: null, sample, loaded: records.length, total, matched: matching.length };
  const sum = values.reduce((acc, item) => acc + item, 0);
  const value = { sum, average: sum / values.length, min: Math.min(...values), max: Math.max(...values) }[block.stat];
  return { value, sample, loaded: records.length, total, matched: matching.length };
}

export function formatStat(value) {
  if (value == null) return "—";
  if (Math.abs(value) >= 1e6) return `${(value / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 });
}

/** Checks the author should see before presenting: empty titles, missing features, empty numbers. */
export function validateBriefing(briefing, { featureIds = null } = {}) {
  const issues = [];
  normalizeBriefing(briefing).slides.forEach((slide, index) => {
    const where = `Slide ${index + 1}`;
    if (!slide.title.trim()) issues.push({ slideId: slide.id, level: "warning", message: `${where} has no title.` });
    if (slide.template === "feature" && !slide.featureId) issues.push({ slideId: slide.id, level: "error", message: `${where} is a feature slide with no feature.` });
    if (slide.featureId && featureIds && !featureIds.has(slide.featureId)) issues.push({ slideId: slide.id, level: "warning", message: `${where}: its feature is not in the loaded data.` });
    if (["map-narrative", "feature", "title"].includes(slide.template) && !slide.camera && !slide.fit) issues.push({ slideId: slide.id, level: "warning", message: `${where} has no saved map view.` });
  });
  return issues;
}
