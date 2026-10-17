import assert from "node:assert/strict";
import test from "node:test";
import { describeArcgisLayer, plainText, summarizeArcgisField } from "../js/layer-insight.js";
import { buildAssistantInstructions, createAssistantTools } from "../js/map-assistant.js";

const LAYER = "https://services3.arcgis.com/abc/arcgis/rest/services/Fires/FeatureServer/0";
const layerJson = {
  name: "Fire Perimeters", type: "Feature Layer", geometryType: "esriGeometryPolygon", displayField: "IncidentName", objectIdField: "OBJECTID", maxRecordCount: 2000,
  description: "<p>Wildland fire perimeters.</p><p>Updated every 5&nbsp;minutes.</p>", copyrightText: "NIFC",
  editingInfo: { dataLastEditDate: Date.UTC(2026, 9, 15) },
  fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID", alias: "OBJECTID" },
    { name: "IncidentName", type: "esriFieldTypeString", alias: "Incident Name", length: 100, description: "{\"value\":\"The name of the incident.\",\"fieldValueType\":\"nameOrTitle\"}" },
    { name: "GISAcres", type: "esriFieldTypeDouble", alias: "GIS Acres" },
    { name: "Cause", type: "esriFieldTypeString", alias: "Cause", domain: { type: "codedValue", codedValues: [{ code: "H", name: "Human" }, { code: "N", name: "Natural" }] } },
  ],
};

function fakeFetch(calls = []) {
  return async (url) => {
    calls.push(url);
    const { pathname, searchParams } = new URL(url);
    let body = {};
    if (pathname.endsWith("/info/itemInfo")) body = { snippet: "Current fire perimeters", tags: ["fire", "wildfire"], licenseInfo: "Public domain" };
    else if (pathname.endsWith("/FeatureServer")) body = { serviceDescription: "Service text" };
    else if (pathname.endsWith("/0")) body = layerJson;
    else if (searchParams.get("returnCountOnly")) body = { count: /IS NULL/.test(searchParams.get("where")) ? 3 : 42762 };
    else if (searchParams.get("groupByFieldsForStatistics")) body = { features: [{ attributes: { Cause: "H", n: 30000 } }, { attributes: { Cause: "N", n: 12000 } }] };
    else if (searchParams.get("outStatistics")) body = { features: [{ attributes: { s_min: 0.1, s_max: 410203.25, s_avg: 1234.56789, s_stddev: 9000.1, s_count: 42759 } }] };
    return { ok: true, json: async () => body };
  };
}

test("HTML descriptions become plain text", () => {
  assert.equal(plainText("<p>Wildland fire perimeters.</p><p>Updated every 5&nbsp;minutes.</p>"), "Wildland fire perimeters.\nUpdated every 5 minutes.");
  assert.match(plainText("word ".repeat(400), 50), /…$/);
});

test("a layer is described from the layer, its service and its item", async () => {
  const described = await describeArcgisLayer(LAYER, { fetch: fakeFetch() });
  assert.equal(described.title, "Fire Perimeters");
  assert.equal(described.summary, "Current fire perimeters");
  assert.equal(described.description, "Wildland fire perimeters.\nUpdated every 5 minutes.");
  assert.equal(described.credits, "NIFC");
  assert.equal(described.license, "Public domain");
  assert.equal(described.featureCount, 42762);
  assert.equal(described.lastEdited, "2026-10-15");
  assert.equal(described.geometryType, "polygon");
  const name = described.fields.find((field) => field.name === "IncidentName");
  assert.deepEqual(name, { name: "IncidentName", type: "string", alias: "Incident Name", description: "The name of the incident.", valueType: "nameOrTitle", length: 100 });
  assert.deepEqual(described.fields.find((field) => field.name === "Cause").codes, [{ code: "H", name: "Human" }, { code: "N", name: "Natural" }]);
});

test("number fields are summarized with statistics, coded fields with counts", async () => {
  const acres = await summarizeArcgisField(LAYER, "gisacres", { fetch: fakeFetch() });
  assert.deepEqual(acres, { field: "GISAcres", type: "double", alias: "GIS Acres", count: 42759, nulls: 3, min: 0.1, max: 410203, mean: 1234.57, stddev: 9000.1 });
  const cause = await summarizeArcgisField(LAYER, "Cause", { fetch: fakeFetch() });
  assert.deepEqual(cause.top, [{ value: "H", name: "Human", count: 30000 }, { value: "N", name: "Natural", count: 12000 }]);
  await assert.rejects(summarizeArcgisField(LAYER, "Acres", { fetch: fakeFetch() }), /no field "Acres"/);
});

test("the assistant reads layers by title and is told to answer without changing the map", async () => {
  const api = { describe: () => ({ state: { layers: [{ id: "layer-1", title: "Fire Perimeters", url: LAYER }] } }) };
  const tools = createAssistantTools({ api, fetch: fakeFetch() });
  assert.equal((await tools.describe_layer({ layer: "fire perimeters" })).id, "layer-1");
  assert.equal((await tools.summarize_field({ layer: "layer-1", field: "Cause" })).distinct, 2);
  await assert.rejects(tools.describe_layer({ layer: "earthquakes" }), /No layer/);
  assert.match(buildAssistantInstructions(), /answered by reading, not by changing the map/);
});
