// Provider-neutral Charting Tools model. Chart configurations belong to
// GISMap; ECharts is only the lazy-loaded renderer for a configuration.

import { fieldKind, featureFilterFor } from "./presentation-query.js";

export const CHART_SCHEMA_VERSION = 1;
export const ECHARTS_URL = "https://cdn.jsdelivr.net/npm/echarts@5.5.1/dist/echarts.min.js";
export const PRESENTATION_TARGETS = Object.freeze(["panel", "dashboard", "map", "brief"]);
export const CHART_FAMILIES = Object.freeze([
  { id: "line-area", label: "Line & Area" },
  { id: "bar-column", label: "Bar & Column" },
  { id: "scatter-bubble", label: "Scatter & Bubble" },
  { id: "distribution-composition", label: "Distribution & Composition" },
  { id: "3d", label: "3D Charts" },
  { id: "map", label: "Map Charts" },
  { id: "custom", label: "Custom Chart Builder" },
]);
export const CHART_TYPES = Object.freeze([
  { id: "bar", label: "Bar chart", dimension: true, measure: true },
  { id: "column", label: "Column chart", dimension: true, measure: true },
  { id: "line", label: "Line chart", dimension: true, measure: true },
  { id: "area", label: "Area chart", dimension: true, measure: true },
  { id: "histogram", label: "Histogram", dimension: false, measure: true },
  { id: "scatter", label: "Scatterplot", dimension: true, measure: true },
  { id: "bubble", label: "Bubble chart", dimension: true, measure: true },
  { id: "boxplot", label: "Box plot", dimension: true, measure: true },
  { id: "donut", label: "Donut chart", dimension: true, measure: true },
  { id: "kpi", label: "Metric card", dimension: false, measure: true },
]);
export const AGGREGATIONS = Object.freeze(["count", "sum", "avg", "min", "max"]);

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const id = () => globalThis.crypto?.randomUUID?.() || `chart-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const numeric = (value) => value !== "" && value != null && Number.isFinite(Number(value)) ? Number(value) : null;
const label = (value) => value == null || value === "" ? "(No value)" : String(value);
const allowed = (value, values, fallback) => values.includes(value) ? value : fallback;
const unique = (values) => [...new Set(values)];

export function chartFields(fields = []) {
  const usable = fields.filter((field) => field?.name);
  // IDs and temporal keys can be numeric but are not meaningful default sums.
  const numericFields = usable.filter((field) => fieldKind(field) === "number" && !/^(?:object)?id$/i.test(field.name) && !/(?:^|[_\s-])(year|date|time)(?:$|[_\s-])/i.test(`${field.name} ${field.alias || ""}`));
  // Real date metadata is unambiguous and is preferred over a YEAR-like
  // numeric field. YEAR remains a suggestion, never an implicit conversion.
  const dated = usable.filter((field) => fieldKind(field) === "date");
  const namedTemporal = usable.filter((field) => fieldKind(field) !== "date" && /(?:^|[_\s-])(year|date|time|month|day)(?:$|[_\s-])/i.test(`${field.name} ${field.alias || ""}`));
  const temporalFields = unique([...dated, ...namedTemporal].map((field) => field.name)).map((name) => usable.find((field) => field.name === name));
  const categoricalFields = usable.filter((field) => fieldKind(field) === "text" || fieldKind(field) === "boolean");
  return { usable, numericFields, temporalFields, categoricalFields };
}

export function recommendCharts(fields = [], { family = "all" } = {}) {
  const { numericFields, temporalFields, categoricalFields } = chartFields(fields);
  const numeric = numericFields[0]?.name || null;
  const secondNumeric = numericFields[1]?.name || null;
  const temporal = temporalFields[0]?.name || null;
  const category = categoricalFields[0]?.name || null;
  const recommendations = [];
  const add = (item, families) => { if (family === "all" || family === "custom" || families.includes(family)) recommendations.push(item); };
  if (temporal && numeric) {
    add({ preset: "trend-line", type: "line", dimension: temporal, measure: numeric, aggregation: "sum", label: "Trend over time", description: "A time-based trend from the first temporal and numeric fields." }, ["line-area"]);
    add({ preset: "cumulative-area", type: "area", dimension: temporal, measure: numeric, aggregation: "sum", label: "Cumulative area", description: "A filled trend for change over time." }, ["line-area"]);
  }
  if (category && numeric) {
    add({ preset: "category-bar", type: "bar", dimension: category, measure: numeric, aggregation: "sum", label: "Compare categories", description: "A horizontal comparison of category totals." }, ["bar-column"]);
    add({ preset: "category-column", type: "column", dimension: category, measure: numeric, aggregation: "sum", label: "Category columns", description: "A vertical category comparison." }, ["bar-column"]);
    add({ preset: "boxplot", type: "boxplot", dimension: category, measure: numeric, aggregation: "avg", label: "Distribution by category", description: "Quartiles and outliers for each category." }, ["distribution-composition"]);
  }
  if (numeric) add({ preset: "histogram", type: "histogram", dimension: null, measure: numeric, aggregation: "count", label: "Value distribution", description: "A binned distribution of a numeric field." }, ["distribution-composition"]);
  if (category) add({ preset: "donut", type: "donut", dimension: category, measure: null, aggregation: "count", label: "Category composition", description: "A share-of-total view." }, ["distribution-composition"]);
  if (numeric && secondNumeric) {
    add({ preset: "scatter", type: "scatter", dimension: numeric, measure: secondNumeric, aggregation: "count", label: "Numeric relationship", description: "Compare two numeric fields feature by feature." }, ["scatter-bubble"]);
    add({ preset: "bubble", type: "bubble", dimension: numeric, measure: secondNumeric, size: numericFields[2]?.name || null, aggregation: "count", label: "Bubble comparison", description: "A relationship with bubble size as a third measure." }, ["scatter-bubble"]);
  }
  if (numeric) add({ preset: "metric", type: "kpi", dimension: null, measure: numeric, aggregation: "sum", label: "Total metric", description: "One headline value." }, ["custom"]);
  if (family === "map") {
    if (category && numeric) recommendations.push({ preset: "map-bars", type: "bar", dimension: category, measure: numeric, aggregation: "sum", label: "Map mini bars", description: "Compact SVG bars, ready for geographic feature anchors.", target: "map", renderMode: "svg" });
    if (temporal && numeric) recommendations.push({ preset: "map-sparkline", type: "line", dimension: temporal, measure: numeric, aggregation: "sum", label: "Map sparklines", description: "Compact SVG trends, ready for geographic feature anchors.", target: "map", renderMode: "svg" });
    if (category) recommendations.push({ preset: "map-donut", type: "donut", dimension: category, measure: numeric, aggregation: numeric ? "sum" : "count", label: "Map donuts", description: "Compact geographic donuts, ready for feature anchors.", target: "map", renderMode: "svg" });
  }
  if (family === "map") return recommendations.map((item) => ({ ...item, target: "map", renderMode: "svg" }));
  return recommendations;
}

export function createChartSpec(input = {}) {
  const type = CHART_TYPES.some((entry) => entry.id === (input.type || input.chartType)) ? (input.type || input.chartType) : "bar";
  const aggregation = AGGREGATIONS.includes(input.measure?.aggregation || input.aggregation) ? (input.measure?.aggregation || input.aggregation) : "count";
  const target = allowed(input.presentation?.target || input.target, PRESENTATION_TARGETS, "panel");
  const targets = unique([...(Array.isArray(input.presentation?.targets) ? input.presentation.targets : Array.isArray(input.targets) ? input.targets : []), target]).filter((item) => PRESENTATION_TARGETS.includes(item));
  const source = input.source || input.data || {};
  const dimensionInput = input.dimension?.field || input.dimension || source.groupBy || null;
  const measureInput = input.measure?.field ?? input.measureField ?? input.data?.series?.[0]?.field ?? null;
  const sizeField = input.encoding?.sizeField || input.size?.field || input.size || null;
  return {
    schemaVersion: CHART_SCHEMA_VERSION,
    id: input.id || id(),
    title: String(input.title || "Untitled chart").slice(0, 160),
    type,
    // chartType/data are aliases for the portable contract; type/source remain
    // for existing dashboard panels and saved projects.
    chartType: type,
    preset: typeof input.preset === "string" ? input.preset.slice(0, 80) : null,
    source: { layerId: source.layerId || input.layerId || null, scope: ["all", "filtered", "viewport", "selected"].includes(source.scope || input.scope) ? (source.scope || input.scope) : "filtered" },
    data: { layerId: source.layerId || input.layerId || null, scope: ["all", "filtered", "viewport", "selected"].includes(source.scope || input.scope) ? (source.scope || input.scope) : "filtered", groupBy: dimensionInput || null, series: [{ field: measureInput, aggregation }] },
    dimension: dimensionInput ? { field: dimensionInput, interpretation: input.dimension?.interpretation || (input.preset?.includes("trend") ? "temporal" : "category") } : null,
    measure: { field: measureInput, aggregation },
    encoding: { ...(sizeField ? { sizeField: String(sizeField) } : {}) },
    presentation: {
      target,
      targets: targets.length ? targets : ["panel"],
      renderMode: allowed(input.presentation?.renderMode || input.renderMode, ["standard", "svg", "html", "engine-3d"], "standard"),
      size: allowed(input.presentation?.size || input.size, ["compact", "regular", "expanded"], "regular"),
      anchor: allowed(input.presentation?.anchor || input.anchor, ["point", "line-midpoint", "polygon-interior", "polygon-centroid", "feature"], "feature"),
      collision: allowed(input.presentation?.collision || input.collision, ["hide-overlap", "cluster", "reposition"], "hide-overlap"),
      display: allowed(input.presentation?.display || input.display, ["all", "progressive", "clustered"], "progressive"),
      minZoom: Number.isFinite(Number(input.presentation?.minZoom)) ? Number(input.presentation.minZoom) : null,
      maxZoom: Number.isFinite(Number(input.presentation?.maxZoom)) ? Number(input.presentation.maxZoom) : null,
    },
    interaction: { mapHighlight: input.interaction?.mapHighlight !== false, crossFilter: input.interaction?.crossFilter === true },
    style: { palette: input.style?.palette || "inherit", legend: input.style?.legend !== false, stacked: input.style?.stacked === true },
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
  if (["scatter", "bubble"].includes(chart.type)) {
    const xField = chart.dimension?.field;
    const sizeField = chart.encoding?.sizeField;
    const points = records.map((record) => ({ x: numeric(record.attributes?.[xField]), y: numeric(record.attributes?.[measure]), size: numeric(record.attributes?.[sizeField]), record })).filter((point) => point.x != null && point.y != null);
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
  const percentile = (values, fraction) => {
    if (!values.length) return null;
    const index = (values.length - 1) * fraction;
    const low = Math.floor(index); const high = Math.ceil(index);
    return values[low] + (values[high] - values[low]) * (index - low);
  };
  const rows = [...groups.entries()].map(([key, group]) => {
    if (chart.type === "boxplot") {
      const values = group.map((record) => numeric(record.attributes?.[measure])).filter((value) => value != null).sort((a, b) => a - b);
      return { label: key, value: values.length ? [values[0], percentile(values, .25), percentile(values, .5), percentile(values, .75), values.at(-1)] : null, records: group };
    }
    return { label: key, value: aggregateValue(group, measure, chart.measure.aggregation), records: group };
  }).filter((row) => row.value != null);
  quality.excludedNullMeasures = chart.measure.aggregation === "count" ? 0 : records.length - records.filter((record) => numeric(record.attributes?.[measure]) != null).length;
  rows.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  return { chart, rows, quality, selection: (row) => row.records };
}

export async function queryChart(mapController, layer, spec) {
  const chart = createChartSpec(spec);
  if (!layer?.queryable) throw new Error("Choose a queryable feature layer.");
  const loaded = await mapController.loadLayer(layer.uid, { allowTruncated: false });
  const fields = [chart.dimension?.field, chart.measure?.field, chart.encoding?.sizeField, loaded.objectIdField].filter(Boolean);
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
  if (["scatter", "bubble"].includes(chart.type)) return { ...common, xAxis: { type: "value", name: chart.dimension?.field || "X" }, yAxis: { type: "value", name: chart.measure.field || "Y" }, series: [{ type: "scatter", symbolSize: chart.type === "bubble" ? (value) => Math.max(7, Math.min(42, Math.sqrt(Math.abs(Number(value[2]) || 0)) * 2.5 || 10)) : 9, data: rows.map((row) => chart.type === "bubble" ? [row.x, row.y, row.size] : [row.x, row.y]) }] };
  if (chart.type === "donut") return { ...common, tooltip: { trigger: "item" }, series: [{ type: "pie", radius: ["45%", "75%"], data: rows.map((row) => ({ name: row.label, value: row.value })) }] };
  if (chart.type === "boxplot") return { ...common, grid: { left: 48, right: 18, top: 22, bottom: 55 }, xAxis: { type: "category", data: rows.map((row) => row.label) }, yAxis: { type: "value" }, series: [{ type: "boxplot", data: rows.map((row) => row.value) }] };
  const categories = rows.map((row) => chart.type === "histogram" ? `${row.min.toLocaleString(undefined, { maximumFractionDigits: 2 })}–${row.max.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : row.label);
  if (chart.type === "bar") return { ...common, grid: { left: 95, right: 18, top: 22, bottom: 30 }, xAxis: { type: "value" }, yAxis: { type: "category", data: categories, axisLabel: { interval: 0 } }, series: [{ type: "bar", data: rows.map((row) => row.value) }] };
  const type = chart.type === "histogram" || chart.type === "column" ? "bar" : "line";
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
  const scalar = (row) => Array.isArray(row.value) ? row.value[2] : Number(row.value ?? row.y) || 0;
  const max = Math.max(...rows.map(scalar), 1);
  const rowLabel = (row) => row.label || (row.min != null ? `${Number(row.min).toLocaleString(undefined, { maximumFractionDigits: 2 })}–${Number(row.max).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : row.x);
  return `<div class="chart-fallback" aria-label="${escape(chart.title)}">${rows.map((row, index) => `<button type="button" data-chart-row="${index}" title="${escape(rowLabel(row) || `${row.x}, ${row.y}`)}: ${Array.isArray(row.value) ? row.value[2].toLocaleString() : Number(row.value ?? row.y).toLocaleString()}"><i style="height:${Math.max(4, scalar(row) / max * 100)}%"></i><span>${escape(rowLabel(row))}</span></button>`).join("")}</div>`;
}

export function mapSelectionForRows(result, rows) {
  const selected = rows.flatMap((row) => result.selection(row));
  return featureFilterFor(selected, result.features?.length || selected.length, result.layer?.objectIdField);
}

export function rowsAsCsv(result) {
  const headings = ["scatter", "bubble"].includes(result.chart.type) ? [result.chart.dimension?.field || "x", result.chart.measure.field || "y", ...(result.chart.type === "bubble" ? [result.chart.encoding?.sizeField || "size"] : [])] : ["category", "value", "record_count"];
  const values = result.rows.map((row) => ["scatter", "bubble"].includes(result.chart.type) ? [row.x, row.y, ...(result.chart.type === "bubble" ? [row.size] : [])] : [row.label || `${row.min}–${row.max}`, Array.isArray(row.value) ? row.value.join("–") : row.value, row.records?.length || 0]);
  return [headings, ...values].map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
}
