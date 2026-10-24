// Provider-neutral Charting Tools model. Chart configurations belong to
// GISMap; ECharts is only the lazy-loaded renderer for a configuration.

import { fieldKind, featureFilterFor } from "./presentation-query.js";

export const CHART_SCHEMA_VERSION = 1;
export const ECHARTS_URL = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
export const CHART_TYPES = Object.freeze([
  { id: "bar", label: "Bar chart", dimension: true, measure: true },
  { id: "line", label: "Line chart", dimension: true, measure: true },
  { id: "area", label: "Area chart", dimension: true, measure: true },
  { id: "histogram", label: "Histogram", dimension: false, measure: true },
  { id: "scatter", label: "Scatterplot", dimension: true, measure: true },
  { id: "donut", label: "Donut chart", dimension: true, measure: true },
  { id: "kpi", label: "Metric card", dimension: false, measure: true },
]);
export const AGGREGATIONS = Object.freeze(["count", "sum", "avg", "min", "max"]);

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const id = () => globalThis.crypto?.randomUUID?.() || `chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const numeric = (value) => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const label = (value) => value == null || value === "" ? "(No value)" : String(value);

export function chartFields(fields = []) {
  const usable = fields.filter((field) => field?.name);
  // IDs and temporal keys can be numeric but are not meaningful default sums.
  const numericFields = usable.filter((field) => fieldKind(field) === "number" && !/^(?:object)?id$/i.test(field.name) && !/(?:^|[_\s-])(year|date|time)(?:$|[_\s-])/i.test(`${field.name} ${field.alias || ""}`));
  // Real date metadata is unambiguous and is preferred over a YEAR-like
  // numeric field. YEAR remains a suggestion, never an implicit conversion.
  const dated = usable.filter((field) => fieldKind(field) === "date");
  const namedTemporal = usable.filter((field) => fieldKind(field) !== "date" && /(?:^|[_\s-])(year|date|time|month|day)(?:$|[_\s-])/i.test(`${field.name} ${field.alias || ""}`));
  const temporalFields = [...dated, ...namedTemporal];
  const categoricalFields = usable.filter((field) => fieldKind(field) === "text" || fieldKind(field) === "boolean");
  return { usable, numericFields, temporalFields, categoricalFields };
}

export function recommendCharts(fields = []) {
  const { numericFields, temporalFields, categoricalFields } = chartFields(fields);
  const numeric = numericFields[0]?.name || null;
  const temporal = temporalFields[0]?.name || null;
  const category = categoricalFields[0]?.name || null;
  const recommendations = [];
  if (temporal && numeric) recommendations.push({ type: "line", dimension: temporal, measure: numeric, aggregation: "sum", label: "Trend over time" });
  if (category && numeric) recommendations.push({ type: "bar", dimension: category, measure: numeric, aggregation: "sum", label: "Compare categories" });
  if (numeric) recommendations.push({ type: "histogram", dimension: null, measure: numeric, aggregation: "count", label: "Value distribution" });
  if (category) recommendations.push({ type: "donut", dimension: category, measure: null, aggregation: "count", label: "Category composition" });
  if (numeric) recommendations.push({ type: "kpi", dimension: null, measure: numeric, aggregation: "sum", label: "Total metric" });
  return recommendations;
}

export function createChartSpec(input = {}) {
  const type = CHART_TYPES.some((entry) => entry.id === input.type) ? input.type : "bar";
  const aggregation = AGGREGATIONS.includes(input.measure?.aggregation || input.aggregation) ? (input.measure?.aggregation || input.aggregation) : "count";
  return {
    schemaVersion: CHART_SCHEMA_VERSION,
    id: input.id || id(),
    title: String(input.title || "Untitled chart").slice(0, 160),
    type,
    source: { layerId: input.source?.layerId || input.layerId || null, scope: ["all", "filtered", "viewport", "selected"].includes(input.source?.scope || input.scope) ? (input.source?.scope || input.scope) : "filtered" },
    dimension: input.dimension?.field || input.dimension ? { field: input.dimension?.field || input.dimension, interpretation: input.dimension?.interpretation || "category" } : null,
    measure: { field: input.measure?.field ?? input.measureField ?? null, aggregation },
    interaction: { mapHighlight: input.interaction?.mapHighlight !== false, crossFilter: input.interaction?.crossFilter === true },
    style: { palette: input.style?.palette || "inherit", legend: input.style?.legend !== false },
  };
}

export function normalizeCharts(value) {
  return Array.isArray(value) ? value.filter((chart) => chart && typeof chart === "object").slice(0, 60).map(createChartSpec) : [];
}

function aggregateValue(records, field, aggregation) {
  if (aggregation === "count") return records.length;
  const values = records.map((record) => numeric(record.attributes?.[field])).filter((value) => value != null);
  if (!values.length) return null;
  if (aggregation === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (aggregation === "avg") return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (aggregation === "min") return Math.min(...values);
  if (aggregation === "max") return Math.max(...values);
  return null;
}

export function aggregateChart(records = [], spec = {}) {
  const chart = createChartSpec(spec);
  const quality = { status: "complete", processedRecords: records.length, excludedNullMeasures: 0, excludedInvalidDimensions: 0, warning: null };
  const measure = chart.measure.field;
  if (chart.type === "scatter") {
    const xField = chart.dimension?.field;
    const points = records.map((record) => ({ x: numeric(record.attributes?.[xField]), y: numeric(record.attributes?.[measure]), record })).filter((point) => point.x != null && point.y != null);
    quality.excludedInvalidDimensions = records.length - points.length;
    return { chart, rows: points, quality, selection: (row) => [row.record] };
  }
  if (chart.type === "histogram") {
    const values = records.map((record) => ({ value: numeric(record.attributes?.[measure]), record })).filter((item) => item.value != null);
    quality.excludedNullMeasures = records.length - values.length;
    if (!values.length) return { chart, rows: [], quality, selection: () => [] };
    const min = Math.min(...values.map((item) => item.value)); const max = Math.max(...values.map((item) => item.value)); const bins = 10;
    const width = (max - min || 1) / bins;
    const rows = Array.from({ length: bins }, (_, index) => ({ min: min + index * width, max: index === bins - 1 ? max : min + (index + 1) * width, value: 0, records: [] }));
    values.forEach((item) => { const index = max === min ? 0 : Math.min(bins - 1, Math.floor((item.value - min) / width)); rows[index].value += 1; rows[index].records.push(item.record); });
    return { chart, rows, quality, selection: (row) => row.records };
  }
  if (chart.type === "kpi") {
    const value = aggregateValue(records, measure, chart.measure.aggregation);
    quality.excludedNullMeasures = chart.measure.aggregation === "count" ? 0 : records.length - records.filter((record) => numeric(record.attributes?.[measure]) != null).length;
    return { chart, rows: value == null ? [] : [{ label: chart.measure.aggregation, value, records }], quality, selection: (row) => row.records };
  }
  const dimension = chart.dimension?.field;
  if (!dimension) return { chart, rows: [], quality: { ...quality, warning: "Choose a field to group this chart." }, selection: () => [] };
  const groups = new Map();
  records.forEach((record) => {
    const value = record.attributes?.[dimension];
    if (value == null || value === "") { quality.excludedInvalidDimensions += 1; return; }
    const key = label(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  });
  const rows = [...groups.entries()].map(([key, group]) => ({ label: key, value: aggregateValue(group, measure, chart.measure.aggregation), records: group })).filter((row) => row.value != null);
  quality.excludedNullMeasures = chart.measure.aggregation === "count" ? 0 : records.length - records.filter((record) => numeric(record.attributes?.[measure]) != null).length;
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { chart, rows, quality, selection: (row) => row.records };
}

export async function queryChart(mapController, layer, spec) {
  const chart = createChartSpec(spec);
  if (!layer?.queryable) throw new Error("Choose a queryable feature layer.");
  const loaded = await mapController.loadLayer(layer.uid, { allowTruncated: false });
  const fields = [chart.dimension?.field, chart.measure?.field, loaded.objectIdField].filter(Boolean);
  const params = { where: chart.source.scope === "all" ? "1=1" : undefined, outFields: [...new Set(fields)], returnGeometry: chart.interaction.mapHighlight === true };
  if (chart.source.scope === "viewport") params.geometry = "view";
  const response = await mapController.queryFeatures(loaded.uid, params, { layerDefaults: chart.source.scope !== "all" });
  const result = aggregateChart(response.features, chart);
  if (response.exceededTransferLimit) result.quality = { ...result.quality, status: "partial", warning: "The source limited this query. Refine its filter before using this chart." };
  return { ...result, layer: loaded, features: response.features };
}

export function chartOption(result, { palette = ["#1b7f6a", "#e0ad35", "#2f7f9d", "#b23f62", "#667085"] } = {}) {
  const { chart, rows } = result;
  const common = { color: palette, animation: !globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches, tooltip: { trigger: chart.type === "donut" ? "item" : "axis" } };
  if (chart.type === "kpi") return null;
  if (chart.type === "scatter") return { ...common, xAxis: { type: "value", name: chart.dimension?.field || "X" }, yAxis: { type: "value", name: chart.measure.field || "Y" }, series: [{ type: "scatter", data: rows.map((row) => [row.x, row.y]) }] };
  if (chart.type === "donut") return { ...common, tooltip: { trigger: "item" }, series: [{ type: "pie", radius: ["45%", "75%"], data: rows.map((row) => ({ name: row.label, value: row.value })) }] };
  const categories = rows.map((row) => chart.type === "histogram" ? `${row.min.toLocaleString(undefined, { maximumFractionDigits: 2 })}–${row.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : row.label);
  const type = chart.type === "histogram" || chart.type === "bar" ? "bar" : "line";
  return { ...common, grid: { left: 48, right: 18, top: 22, bottom: 55 }, xAxis: { type: "category", data: categories, axisLabel: { rotate: categories.length > 7 ? 35 : 0 } }, yAxis: { type: "value" }, series: [{ type, areaStyle: chart.type === "area" ? {} : undefined, data: rows.map((row) => row.value) }] };
}

export async function loadECharts(documentRef = document) {
  if (globalThis.echarts) return globalThis.echarts;
  const existing = documentRef.querySelector(`script[data-gismap-echarts]`);
  if (existing) return new Promise((resolve, reject) => { existing.addEventListener("load", () => resolve(globalThis.echarts), { once: true }); existing.addEventListener("error", () => reject(new Error("Chart renderer could not load.")), { once: true }); });
  return new Promise((resolve, reject) => {
    const script = documentRef.createElement("script"); script.src = ECHARTS_URL; script.async = true; script.dataset.gismapEcharts = "true";
    script.addEventListener("load", () => globalThis.echarts ? resolve(globalThis.echarts) : reject(new Error("Chart renderer did not initialize.")), { once: true });
    script.addEventListener("error", () => reject(new Error("Chart renderer could not load.")), { once: true });
    documentRef.head.append(script);
  });
}

export function renderChartFallback(result) {
  const { chart, rows } = result;
  if (!rows.length) return `<div class="chart-builder__empty"><strong>No chartable values</strong><p>Change the fields or adjust the current layer filter.</p></div>`;
  if (chart.type === "kpi") return `<div class="chart-kpi"><span>${escape(chart.measure.aggregation)}</span><strong>${Number(rows[0].value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>`;
  const max = Math.max(...rows.map((row) => Number(row.value ?? row.y) || 0), 1);
  const rowLabel = (row) => row.label || (row.min != null ? `${Number(row.min).toLocaleString(undefined, { maximumFractionDigits: 2 })}–${Number(row.max).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : row.x);
  return `<div class="chart-fallback" aria-label="${escape(chart.title)}">${rows.map((row, index) => `<button type="button" data-chart-row="${index}" title="${escape(rowLabel(row) || `${row.x}, ${row.y}`)}: ${Number(row.value ?? row.y).toLocaleString()}"><i style="height:${Math.max(4, (Number(row.value ?? row.y) || 0) / max * 100)}%"></i><span>${escape(rowLabel(row))}</span></button>`).join("")}</div>`;
}

export function mapSelectionForRows(result, rows) {
  const selected = rows.flatMap((row) => result.selection(row));
  return featureFilterFor(selected, result.features?.length || selected.length, result.layer?.objectIdField);
}

export function rowsAsCsv(result) {
  const headings = result.chart.type === "scatter" ? [result.chart.dimension?.field || "x", result.chart.measure.field || "y"] : ["category", "value", "record_count"];
  const values = result.rows.map((row) => result.chart.type === "scatter" ? [row.x, row.y] : [row.label || `${row.min}–${row.max}`, row.value, row.records?.length || 0]);
  return [headings, ...values].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}
