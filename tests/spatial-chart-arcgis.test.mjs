// The portable spatialChart drawn by ArcGIS SceneView: renderer, Arcade and elevation.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSpatialChart, spatialChartColor } from "../js/spatial-chart.js";
import { spatialChartArcgis } from "../js/spatial-chart-arcgis.js";

const fields = [{ name: "YEAR_", type: "small-integer" }, { name: "GIS_ACRES", type: "double" }, { name: "AGENCY", type: "string" }];
const chart = (input, groupValues = []) => normalizeSpatialChart({ type: "spatial-3d-chart", ...input }, { fields, geometryType: "polygon", groupValues });

test("attribute extrusion keeps the layer's classes and drives height with Arcade", () => {
  const palette = { type: "class-breaks", field: "GIS_ACRES", classBreaks: [{ minValue: 0, maxValue: 1000, label: "Small", color: [255, 200, 150, 1] }, { minValue: 1000, maxValue: 1e6, label: "Large", color: [160, 40, 10, 1] }], visualVariables: [{ type: "opacity", field: "GIS_ACRES" }, { type: "size", field: "X" }] };
  const { renderer, elevationInfo } = spatialChartArcgis(chart({ mode: "attribute-extrusion", height: { field: "GIS_ACRES", scale: 0.05 } }), palette);
  assert.equal(renderer.type, "class-breaks");
  assert.deepEqual(renderer.classBreakInfos.map((info) => [info.label, info.symbol.type, info.symbol.symbolLayers[0].type, info.symbol.symbolLayers[0].material.color]), [["Small", "polygon-3d", "extrude", [255, 200, 150, 1]], ["Large", "polygon-3d", "extrude", [160, 40, 10, 1]]]);
  assert.deepEqual(renderer.visualVariables.map((variable) => variable.type), ["opacity", "size"], "the old size variable is replaced by the height");
  assert.equal(renderer.visualVariables[1].valueExpression, 'Max(0, DefaultValue($feature["GIS_ACRES"], 0)) * 0.05');
  assert.equal(renderer.visualVariables[1].valueUnit, "meters");
  assert.deepEqual(elevationInfo, { mode: "on-the-ground" });
});

test("temporal strata: one colour per group and each group lifted to its slot", () => {
  const strata = chart({ mode: "temporal-strata", groupBy: "YEAR_", height: { slotMeters: 400, gapMeters: 100, thicknessMeters: 120 } }, [2021, 2019, 2020]);
  const { renderer, elevationInfo } = spatialChartArcgis(strata);
  assert.equal(renderer.type, "unique-value");
  assert.equal(renderer.field, "YEAR_");
  assert.deepEqual(renderer.uniqueValueInfos.map((info) => [info.value, info.symbol.symbolLayers[0].material.color, info.symbol.symbolLayers[0].size]), [[2019, spatialChartColor(0, 3), 120], [2020, spatialChartColor(1, 3), 120], [2021, spatialChartColor(2, 3), 120]]);
  assert.equal(renderer.visualVariables, undefined);
  assert.deepEqual(elevationInfo, { mode: "relative-to-ground", featureExpressionInfo: { expression: 'Decode($feature["YEAR_"], 2019, 0, 2020, 500, 2021, 1000, 0)' }, unit: "meters" });
});

test("stacks with a magnitude field cap thickness at the slot; text groups are quoted", () => {
  const stacked = chart({ mode: "stacked-footprints", groupBy: "AGENCY", height: { field: "GIS_ACRES", scale: 0.01, slotMeters: 300, gapMeters: 0, thicknessMeters: 40 } }, ["USF", 'CA "Fire"']);
  const { renderer, elevationInfo } = spatialChartArcgis(stacked);
  assert.equal(renderer.visualVariables[0].valueExpression, 'Min(300, Max(40, Max(0, DefaultValue($feature["GIS_ACRES"], 0)) * 0.01))');
  assert.equal(elevationInfo.featureExpressionInfo.expression, 'Decode($feature["AGENCY"], "CA \\"Fire\\"", 0, "USF", 300, 0)');
});

test("the original colour strategy keeps the layer's style and still stacks", () => {
  const strata = chart({ mode: "temporal-strata", groupBy: "YEAR_", color: { strategy: "original" } }, [2019, 2020]);
  const { renderer, elevationInfo } = spatialChartArcgis(strata, { type: "simple", defaultColor: "#aa3300" });
  assert.equal(renderer.type, "simple");
  assert.equal(renderer.symbol.symbolLayers[0].material.color, "#aa3300");
  assert.match(elevationInfo.featureExpressionInfo.expression, /^Decode\(\$feature\["YEAR_"\], 2019, 0, 2020, 480, 0\)$/);
  assert.throws(() => spatialChartArcgis({ ...strata, groupBy: "YEAR_; x" }), /Unsafe field/);
});
