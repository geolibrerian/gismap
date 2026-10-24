import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { aggregateChart, createChartSpec, normalizeCharts, recommendCharts, rowsAsCsv } from "../js/charting-tools.js";

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
});

test("chart data exports a compact, quoted CSV", () => {
  const result = aggregateChart(records, createChartSpec({ type: "bar", dimension: "FIRE_NAME", measure: { aggregation: "count" } }));
  assert.match(rowsAsCsv(result), /^"category","value","record_count"/);
  assert.match(rowsAsCsv(result), /"Alpha","2","2"/);
});

test("Charts & Analytics is reachable from Tools and persists chart definitions", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const project = fs.readFileSync(new URL("../js/project.js", import.meta.url), "utf8");
  assert.match(html, /data-action="tools-charts-analytics">Charts &amp; Analytics/);
  assert.match(ui, /case "tools-charts-analytics":[\s\S]*?#openChartsAnalytics/);
  assert.match(project, /setCharts\(charts\)/);
});
