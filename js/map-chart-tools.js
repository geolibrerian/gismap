// Renderer-neutral primitives for the future Map Charts layer.  This module
// intentionally has no MapLibre, ArcGIS, or ECharts imports: adapters project
// its anchor/display plans into their native overlay APIs.

export const MAP_CHART_MARKS = Object.freeze(["bar", "sparkline", "donut"]);
export const MAP_CHART_ANCHORS = Object.freeze(["point", "line-midpoint", "polygon-interior", "polygon-centroid", "feature"]);
export const MAP_CHART_DISPLAYS = Object.freeze(["all", "progressive", "clustered"]);
export const MAP_CHART_COLLISIONS = Object.freeze(["hide-overlap", "cluster", "reposition"]);

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const point = (value) => Array.isArray(value) && finite(value[0]) != null && finite(value[1]) != null ? [Number(value[0]), Number(value[1])] : null;
const text = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const allowed = (value, values, fallback) => values.includes(value) ? value : fallback;

/** Normalizes only the geographic presentation portion of a common chart spec. */
export function normalizeMapChartPresentation(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    target: "map",
    mark: allowed(source.mark || source.renderMode, MAP_CHART_MARKS, "bar"),
    renderMode: allowed(source.renderMode, ["svg", "html", "webgl"], "svg"),
    anchor: allowed(source.anchor, MAP_CHART_ANCHORS, "feature"),
    display: allowed(source.display, MAP_CHART_DISPLAYS, "progressive"),
    collision: allowed(source.collision, MAP_CHART_COLLISIONS, "hide-overlap"),
    size: allowed(source.size, ["compact", "regular", "expanded"], "compact"),
    minZoom: finite(source.minZoom),
    maxZoom: finite(source.maxZoom),
    maxVisible: Math.max(1, Math.min(2000, Math.floor(finite(source.maxVisible) ?? 250))),
    expandOnClick: source.expandOnClick !== false,
  };
}

const average = (coordinates) => {
  const points = coordinates.map(point).filter(Boolean);
  if (!points.length) return null;
  return [points.reduce((total, item) => total + item[0], 0) / points.length, points.reduce((total, item) => total + item[1], 0) / points.length];
};

const lineMidpoint = (coordinates) => {
  const vertices = coordinates.map(point).filter(Boolean);
  if (!vertices.length) return null;
  if (vertices.length === 1) return vertices[0];
  const lengths = vertices.slice(1).map((item, index) => Math.hypot(item[0] - vertices[index][0], item[1] - vertices[index][1]));
  const halfway = lengths.reduce((total, length) => total + length, 0) / 2;
  let passed = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    if (passed + lengths[index] >= halfway) {
      const ratio = lengths[index] ? (halfway - passed) / lengths[index] : 0;
      return [vertices[index][0] + (vertices[index + 1][0] - vertices[index][0]) * ratio, vertices[index][1] + (vertices[index + 1][1] - vertices[index][1]) * ratio];
    }
    passed += lengths[index];
  }
  return vertices.at(-1);
};

const ringArea = (ring) => Math.abs(ring.slice(1).reduce((area, current, index) => area + ring[index][0] * current[1] - current[0] * ring[index][1], 0) / 2);
const largestRing = (rings) => [...rings].sort((a, b) => ringArea(b) - ringArea(a))[0] || [];

/** A stable geographic anchor for GeoJSON-style point, line, and polygon data. */
export function mapChartAnchor(geometry, requested = "feature") {
  if (!geometry || typeof geometry !== "object") return null;
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "Point") return point(coordinates);
  if (type === "MultiPoint") return point(coordinates?.[0]) || average(coordinates || []);
  if (type === "LineString") return lineMidpoint(coordinates || []);
  if (type === "MultiLineString") return lineMidpoint((coordinates || []).flat());
  const rings = type === "Polygon" ? coordinates : type === "MultiPolygon" ? largestRing((coordinates || []).map((polygon) => largestRing(polygon)).filter(Boolean)) : [];
  if (rings?.length) {
    const ring = type === "Polygon" ? largestRing(rings) : rings;
    // The vertex-average is deterministic; adapters may replace it with a true
    // interior point when their geometry library is available.
    return average(ring);
  }
  return requested === "feature" ? null : null;
}

/** Lightweight SVG glyphs; adapters can wrap these in a DOM marker or serialize them for export. */
export function renderMapChartSvg({ mark = "bar", values = [], label = "Map chart", width = 84, height = 52 } = {}) {
  const safeValues = values.map(finite).filter((value) => value != null).slice(0, 24);
  const safeWidth = Math.max(28, Math.min(240, Math.round(width)));
  const safeHeight = Math.max(22, Math.min(160, Math.round(height)));
  const max = Math.max(...safeValues.map(Math.abs), 1);
  let body = "";
  if (mark === "donut") {
    const total = safeValues.reduce((sum, value) => sum + Math.max(value, 0), 0) || 1;
    let offset = 0;
    body = safeValues.map((value, index) => { const dash = Math.max(value, 0) / total * 100; const segment = `<circle cx="${safeWidth / 2}" cy="${safeHeight / 2}" r="${Math.min(safeWidth, safeHeight) / 2 - 5}" fill="none" stroke="${["#1b7f6a", "#e0ad35", "#2f7f9d", "#b23f62"][index % 4]}" stroke-width="8" pathLength="100" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${safeWidth / 2} ${safeHeight / 2})"/>`; offset += dash; return segment; }).join("");
  } else if (mark === "sparkline") {
    const step = safeValues.length > 1 ? (safeWidth - 8) / (safeValues.length - 1) : 0;
    const points = safeValues.map((value, index) => `${4 + index * step},${safeHeight - 5 - (value / max) * (safeHeight - 12)}`).join(" ");
    body = `<polyline points="${points}" fill="none" stroke="#1b7f6a" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else {
    const gap = 2; const barWidth = Math.max(2, (safeWidth - 8 - gap * Math.max(0, safeValues.length - 1)) / Math.max(safeValues.length, 1));
    body = safeValues.map((value, index) => { const barHeight = Math.max(2, Math.abs(value) / max * (safeHeight - 10)); return `<rect x="${4 + index * (barWidth + gap)}" y="${safeHeight - 4 - barHeight}" width="${barWidth}" height="${barHeight}" rx="1" fill="#1b7f6a"/>`; }).join("");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${safeWidth} ${safeHeight}" role="img" aria-label="${text(label)}" width="${safeWidth}" height="${safeHeight}"><title>${text(label)}</title>${body || `<text x="${safeWidth / 2}" y="${safeHeight / 2}" text-anchor="middle" fill="#667085" font-size="10">No data</text>`}</svg>`;
}

/**
 * Screen-space display planning shared by MapLibre and ArcGIS adapters. Items
 * supply `screen: {x, y, width, height}`, selection/pinning state, and anchor.
 * The engine adapter performs projection; this function stays engine-neutral.
 */
export function planMapChartDisplay(items = [], presentation = {}) {
  const policy = normalizeMapChartPresentation(presentation);
  const ranked = items.filter((item) => item?.screen).sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)) || Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || Number(b.priority || 0) - Number(a.priority || 0));
  const visible = []; const hidden = []; const boxes = [];
  for (const item of ranked) {
    if (visible.length >= policy.maxVisible && !item.selected && !item.pinned) { hidden.push({ ...item, reason: "budget" }); continue; }
    const screen = item.screen;
    const overlap = boxes.some((box) => screen.x < box.x + box.width && screen.x + screen.width > box.x && screen.y < box.y + box.height && screen.y + screen.height > box.y);
    if (overlap && policy.collision === "hide-overlap" && !item.selected && !item.pinned) { hidden.push({ ...item, reason: "overlap" }); continue; }
    visible.push(item); boxes.push(screen);
  }
  return { policy, visible, hidden, clustered: policy.display === "clustered" || policy.collision === "cluster" };
}

// Adapter contract (implemented in the deferred Map Charts MVP):
// { mount(plan), update(plan), destroy(), project(coordinate), onSelect(callback) }
export const MAP_CHART_ADAPTER_CONTRACT = Object.freeze(["mount", "update", "destroy", "project", "onSelect"]);
