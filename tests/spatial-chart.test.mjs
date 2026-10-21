import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpatialChart, spatialChartAxis, spatialChartLayerSpecs } from "../js/spatial-chart.js";
import { generateSpatialChartBrief } from "../js/briefing-spatial-chart.js";
import { normalizeBriefing } from "../js/briefing-document.js";
import { validateMapSpec } from "../js/map-spec.js";
import { readShare, serializeShare } from "../js/map-share.js";

const fields = [
  { name: "YEAR_", type: "integer" },
  { name: "GIS_ACRES", type: "double" },
];
const records = [2019, 2022, 2025, 2022].map((year, index) => ({ attributes: { YEAR_: year, GIS_ACRES: (index + 1) * 10 } }));

test("normalizes temporal strata with explicit virtual-Z semantics", () => {
  const chart = normalizeSpatialChart({ type:"spatial-3d-chart", mode:"temporal-strata", groupBy:"YEAR_", height:{ slotMeters:400, gapMeters:100 } }, { fields, geometryType:"polygon", groupValues:records.map((record) => record.attributes.YEAR_) });
  assert.deepEqual(chart.groups, [2019, 2022, 2025]);
  assert.deepEqual(chart.geometry, { strategy:"source-footprints", aggregation:"none" });
  assert.match(spatialChartAxis(chart).detail, /not physical altitude/);
  const specs = spatialChartLayerSpecs({ chart, idPrefix:"fire", source:"source", polygonFilter:["==", ["geometry-type"], "Polygon"] });
  assert.equal(specs.length, 3);
  assert.equal(specs[1].paint["fill-extrusion-base"], 500);
  assert.equal(specs[1].paint["fill-extrusion-height"], 620);
  assert.deepEqual(specs[2].filter.at(-1), ["==", ["get", "YEAR_"], 2025]);
});

test("attribute extrusion uses a numeric field and rejects invented or non-polygon inputs", () => {
  const chart = normalizeSpatialChart({ type:"spatial-3d-chart", mode:"attribute-extrusion", height:{ field:"GIS_ACRES", scale:20 } }, { fields, geometryType:"polygon" });
  const [spec] = spatialChartLayerSpecs({ chart, idPrefix:"fire", source:"source", polygonFilter:true });
  assert.deepEqual(spec.paint["fill-extrusion-height"], ["max", 0, ["*", ["to-number", ["get", "GIS_ACRES"], 0], 20]]);
  assert.throws(() => normalizeSpatialChart({ mode:"attribute-extrusion", height:{ field:"MISSING" } }, { fields, geometryType:"polygon" }), /numeric height field/);
  assert.throws(() => normalizeSpatialChart({ mode:"attribute-extrusion", height:{ field:"GIS_ACRES" } }, { fields, geometryType:"point" }), /polygon/);
});

test("3D Spatial Chart Brief creates five portable, editable stages", () => {
  const camera = { center:[-120, 38], zoom:7, heading:0, tilt:35 };
  const result = generateSpatialChartBrief({ briefing:{ slides:[] }, layerRef:"https://example.test/FeatureServer/0", camera, fields, records, geometryType:"polygon", groupBy:"YEAR_", heightField:"GIS_ACRES", scale:20 });
  assert.deepEqual(result.briefing.slides.map((slide) => slide.title), ["Overview", "Magnitude", "History", "Accumulation", "Return to geography"]);
  assert.equal(result.briefing.slides[0].spatialChart, null);
  assert.equal(result.briefing.slides[2].spatialChart.mode, "temporal-strata");
  assert.equal(result.briefing.slides[3].spatialChart.geometry.aggregation, "none");
  const roundtrip = normalizeBriefing(JSON.parse(JSON.stringify(result.briefing)));
  assert.equal(roundtrip.slides[1].generatedBy.template, "spatial-3d-chart");
  assert.equal(result.preview.groups, 3);
});

test("map-v1 keeps the portable chart configuration", () => {
  const spatialChart = { type:"spatial-3d-chart", mode:"temporal-strata", groupBy:"YEAR_", groups:[2019,2022], height:{ mode:"fixed-slot", slotMeters:400, gapMeters:100, thicknessMeters:120, scale:1 }, geometry:{ strategy:"source-footprints", aggregation:"none" } };
  const result = validateMapSpec({ version:1, layers:[{ url:"https://example.test/fires.geojson", type:"geojson", spatialChart }] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.spec.layers[0].spatialChart, spatialChart);
});

test("full share links preserve spatial chart settings without changing false interaction flags", () => {
  const spatialChart = { type:"spatial-3d-chart", mode:"exploded-timeline", groupBy:"YEAR_", groups:[2019,2022], height:{ mode:"fixed-slot", slotMeters:400, gapMeters:300, thicknessMeters:120, scale:1 }, color:{ field:"YEAR_", strategy:"sequential" }, geometry:{ strategy:"source-footprints", aggregation:"none" }, interaction:{ hover:false, select:true, explode:true, scrubTimeline:true } };
  const payload = serializeShare({ layers:[{ url:"https://example.test/fires.geojson", sourceType:"geojson", spatialChart }] });
  assert.deepEqual(readShare(payload).layers[0].spatialChart, spatialChart);
});

test("Brief playback restores the chart that was active before the presentation", async () => {
  const { BriefingSlides } = await import("../js/briefing-slides.js");
  const original = { type:"spatial-3d-chart", mode:"attribute-extrusion", height:{ field:"GIS_ACRES", scale:1 } };
  const layer = { uid:"fire", id:"fire", queryable:true };
  let current = original;
  const mapController = {
    getLayers:() => [layer], getLayerConfig:() => ({ spatialChart:current }),
    setSpatialChart:async (_uid, chart) => { current = chart; }, setVisibility() {},
  };
  const slides = new BriefingSlides({ mapController, data:() => ({ layer, fields:{ fields }, records:[] }), getBriefing:() => ({}) });
  const history = { type:"spatial-3d-chart", mode:"temporal-strata", groupBy:"YEAR_", groups:[2019], height:{ slotMeters:400, gapMeters:100, thicknessMeters:120, scale:1 } };
  await slides.applySlideLayers({ spatialChart:history });
  assert.equal(current.mode, "temporal-strata");
  await slides.restoreLayers();
  assert.equal(current.mode, "attribute-extrusion");
});


test("more than 40 groups is an explicit error, never a silent slice", () => {
  const fields = [{ name:"YEAR_", type:"integer" }];
  const groupValues = Array.from({ length:41 }, (_, i) => 1980 + i);
  assert.throws(() => normalizeSpatialChart({ type:"spatial-3d-chart", mode:"temporal-strata", groupBy:"YEAR_" }, { fields, geometryType:"polygon", groupValues }), /41 distinct values/);
});

test("magnitude slabs are capped at their slot so they cannot cover the next group", () => {
  const fields = [{ name:"YEAR_", type:"integer" }, { name:"ACRES", type:"double" }];
  const chart = normalizeSpatialChart({ type:"spatial-3d-chart", mode:"stacked-footprints", groupBy:"YEAR_", height:{ field:"ACRES", slotMeters:400, gapMeters:100, scale:10 } }, { fields, geometryType:"polygon", groupValues:[2019, 2020] });
  const [, second] = spatialChartLayerSpecs({ chart, idPrefix:"x", source:"x", polygonFilter:true });
  const height = second.paint["fill-extrusion-height"];
  assert.equal(height[1], 500);
  assert.equal(height[2][0], "min");
  assert.equal(height[2][1], 400);
  assert.match(spatialChartAxis(chart).detail, /capped at the 400 m slot/);
});
