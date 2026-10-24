import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { aggregateChart, createChartSpec, normalizeCharts, recommendCharts, rowsAsCsv } from "../js/charting-tools.js";
import { mapChartAnchor, normalizeMapChartPresentation, planMapChartDisplay, renderMapChartSvg } from "../js/map-chart-tools.js";

const fields = [
  { name: "OBJECTID", type: "oid" },
  { name: "YEAR_", alias: "Fire year", type: "integer" },
  { name: "GIS_ACRES", alias: "Recorded acreage", type: "double" },
  { name: "FIRE_NAME", alias: "Fire name", type: "string" },
  { name: "IGNITION_DATE", type: "date" },
];
const records = [
  { attributes: { OBJECTID: 1, YEAR_: 2000, GIS_ACRES: 12, FIRE_NAME: "Alpha" } },
  { attributes: { OBJECTID: 2, YEAR_: 2000, GIS_ACRES: 8, FIRE_NAME: "Beta" } },
  { attributes: { OBJECTID: 3, YEAR_: 2001, GIS_ACRES: 30, FIRE_NAME: "Alpha" } },
  { attributes: { OBJECTID: 4, YEAR_: null, GIS_ACRES: 9, FIRE_NAME: "Gamma" } },
  { attributes: { OBJECTID: 5, YEAR_: 2001, GIS_ACRES: null, FIRE_NAME: "Gamma" } },
];

test("annual sum bars aggregate rows and disclose invalid source values", () => {
  const result = aggregateChart(records, createChartSpec({ type: "bar", dimension: "YEAR_", measure: { field: "GIS_ACRES", aggregation: "sum" } }));
  assert.deepEqual(result.rows.map(({ label, value }) => [label, value]), [["2000", 20], ["2001", 30]]);
  assert.equal(result.quality.excludedInvalidDimensions, 1);
  assert.equal(result.quality.excludedNullMeasures, 1);
});

test("histograms and scatterplots retain the source records for map-linked selection", () => {
  const histogram = aggregateChart(records, createChartSpec({ type: "histogram", measure: { field: "GIS_ACRES", aggregation: "count" } }));
  assert.equal(histogram.rows.reduce((total, row) => total + row.value, 0), 4);
  assert.equal(histogram.selection(histogram.rows[0]).length > 0, true);
  const scatter = aggregateChart(records, createChartSpec({ type: "scatter", dimension: "YEAR_", measure: { field: "GIS_ACRES", aggregation: "count" } }));
  assert.equal(scatter.rows.length, 3);
  assert.deepEqual(scatter.rows[0].x, 2000);
});

test("recommendations prefer temporal trends and safe project persistence only stores specs", () => {
  const recommendations = recommendCharts(fields);
  assert.equal(recommendations[0].type, "line");
  assert.equal(recommendations[0].dimension, "IGNITION_DATE");
  const charts = normalizeCharts([{ type: "donut", layerId: "fires", dimension: "FIRE_NAME", measure: { aggregation: "count" }, result: { rawRecords: records } }]);
  assert.equal(charts.length, 1);
  assert.equal(charts[0].source.layerId, "fires");
  assert.equal(charts[0].result, undefined);
  assert.deepEqual(charts[0].presentation.targets, ["panel"]);
});

test("chart families provide data-aware starters and retain multi-destination definitions", () => {
  const bars = recommendCharts(fields, { family: "bar-column" });
  assert.equal(bars.some((item) => item.type === "bar"), true);
  const scatter = recommendCharts(fields, { family: "scatter-bubble" });
  assert.equal(scatter.some((item) => item.type === "scatter"), false, "one usable numeric value should not invent a scatterplot");
  const mapGallery = recommendCharts(fields, { family: "map" });
  assert.equal(mapGallery.some((item) => item.preset === "map-donut"), true);
  assert.equal(mapGallery.every((item) => item.target === "map" && item.renderMode === "svg"), true);
  const map = createChartSpec({ chartType: "donut", data: { layerId: "fires", groupBy: "FIRE_NAME", series: [{ field: "GIS_ACRES", aggregation: "sum" }] }, presentation: { target: "map", targets: ["map", "dashboard"], renderMode: "svg", anchor: "polygon-interior", collision: "cluster", display: "progressive" } });
  assert.equal(map.type, "donut");
  assert.equal(map.chartType, "donut");
  assert.equal(map.data.groupBy, "FIRE_NAME");
  assert.deepEqual(map.presentation.targets, ["map", "dashboard"]);
  assert.equal(map.presentation.anchor, "polygon-interior");
});

test("Map Charts primitives keep anchors, SVG glyphs, and collision plans engine-neutral", () => {
  assert.deepEqual(mapChartAnchor({ type: "Point", coordinates: [-122.4, 37.8] }), [-122.4, 37.8]);
  assert.deepEqual(mapChartAnchor({ type: "LineString", coordinates: [[0, 0], [10, 0]] }), [5, 0]);
  assert.deepEqual(mapChartAnchor({ type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] }), [1.6, 1.6]);
  assert.match(renderMapChartSvg({ mark: "donut", values: [2, 3], label: "A donut" }), /<svg/);
  const policy = normalizeMapChartPresentation({ collision: "hide-overlap", maxVisible: 1 });
  const plan = planMapChartDisplay([{ id: "ordinary", screen: { x: 0, y: 0, width: 12, height: 12 } }, { id: "selected", selected: true, screen: { x: 2, y: 2, width: 12, height: 12 } }], policy);
  assert.equal(plan.visible[0].id, "selected");
  assert.equal(plan.hidden[0].reason, "budget");
});

test("chart data exports a compact, quoted CSV", () => {
  const result = aggregateChart(records, createChartSpec({ type: "bar", dimension: "FIRE_NAME", measure: { aggregation: "count" } }));
  assert.match(rowsAsCsv(result), /^"category","value","record_count"/);
  assert.match(rowsAsCsv(result), /"Alpha","2","2"/);
});

test("Chart Tools has dedicated family actions which share one persisted builder", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const project = fs.readFileSync(new URL("../js/project.js", import.meta.url), "utf8");
  for (const action of ["tools-chart-line-area", "tools-chart-bar-column", "tools-chart-scatter-bubble", "tools-chart-distribution-composition", "tools-chart-3d", "tools-chart-map", "tools-chart-custom"]) assert.match(html, new RegExp(`data-action="${action}"`));
  assert.ok(html.indexOf('<span class="menu__label">Chart tools</span>') > html.indexOf('<span class="menu__label">Portal tools</span>'), "Chart Tools stays in the lower part of the Tools menu");
  assert.doesNotMatch(html, /data-action="tools-charts-analytics">Charts &amp; Analytics/);
  assert.match(ui, /case "tools-chart-line-area":[\s\S]*?#openChartsAnalytics\(\{ family: "line-area" \}\)/);
  assert.match(ui, /chart-builder__gallery/);
  assert.match(ui, /data-chart-target/);
  assert.match(css, /\.chart-builder \{ container-type:inline-size;[\s\S]*?min-width:0/);
  assert.match(css, /@container \(max-width: 560px\)/);
  assert.match(css, /\.app-dialog:has\(\.chart-builder\)[\s\S]*?overflow-x:hidden/);
  assert.match(project, /setCharts\(charts\)/);
});
