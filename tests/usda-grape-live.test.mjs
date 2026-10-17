// Opt-in integration check against the public service; normal test runs stay offline.
import test from "node:test";
import assert from "node:assert/strict";
import { describeArcGIS, fetchFeatures } from "../js/engines/maplibre/arcgis-service.js";
import { compileWhere } from "../js/engines/maplibre/where.js";

const url = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USDA_Census_of_Agriculture_2022_Grape_Production/FeatureServer/0";
const where = "STATE_ABBR = 'CA' AND GRAPES_ACRES_BEAR_NON_BEAR_TOT > 1000";

test("live USDA grape metadata, filter and complete feature pages", { skip: process.env.GISMAP_LIVE_TESTS !== "1", timeout: 120000 }, async () => {
  const layer = await describeArcGIS(url);
  assert.equal(layer.geometryType, "polygon");
  assert.equal(layer.fields.find((field) => field.name === "STATE_ABBR")?.type, "string");
  assert.equal(layer.fields.find((field) => field.name === "GRAPES_ACRES_BEAR_NON_BEAR_TOT")?.type, "double");
  const query = new URL(`${url}/query`);
  query.search = new URLSearchParams({ f: "json", where, returnCountOnly: "true" });
  const response = await fetch(query);
  assert.ok(response.ok, `Count request failed: HTTP ${response.status}`);
  const { count, error } = await response.json();
  if (error) throw new Error(error.message);
  assert.ok(Number.isInteger(count) && count > 0);
  const result = await fetchFeatures(layer, { where, simplify: { maxAllowableOffset: 0.0005, geometryPrecision: 5 } });
  assert.equal(result.truncated, false);
  assert.equal(result.features.length, count);
  const matches = compileWhere(where);
  assert.ok(result.features.every((feature) => matches(feature.properties)));
  assert.ok(result.features.every((feature) => feature.properties.STATE_ABBR === "CA" && feature.properties.GRAPES_ACRES_BEAR_NON_BEAR_TOT > 1000));
});
