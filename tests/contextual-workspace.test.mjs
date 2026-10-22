import test from "node:test";
import assert from "node:assert/strict";
import { createSuggestionPreferences, deriveWorkspace, profileLayer, suggestionKey, summarizeFeature } from "../js/contextual-workspace.js";

test("empty project offers discovery without a layer", () => {
  assert.deepEqual(deriveWorkspace().actions, ["add-data", "try-example"]);
});

test("metadata profile is conservative and ignores identifiers", () => {
  const layer = { uid: "fires", queryable: true, geometryType: "polygon", fields: [
    { name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "GISAcres", type: "esriFieldTypeDouble" },
    { name: "FireYear", type: "esriFieldTypeInteger" }, { name: "FireType", type: "esriFieldTypeString" },
  ] };
  const profile = profileLayer(layer, ["spatial-chart-3d"]);
  assert.deepEqual(profile.fields.numeric, ["GISAcres", "FireYear"]);
  assert.deepEqual(profile.fields.temporal, ["FireYear"]);
  assert.deepEqual(profile.fields.categorical, ["FireType"]);
  assert.equal(profile.profileStatus, "metadata");
  assert.deepEqual(deriveWorkspace({ layers: [layer], capabilities: ["spatial-chart-3d"] }).actions, ["style-layer", "explore-3d", "view-table"]);
  assert.equal(profileLayer(layer, []).capabilities.extrusion, false);
  assert.equal(profileLayer({ ...layer, geometryType: "point" }, ["spatial-chart-3d"]).capabilities.extrusion, false);
});

test("feature selection defers to the existing inspector", () => {
  const context = deriveWorkspace({ layers: [{ uid: "a", queryable: true }], selection: { features: [{}] } });
  assert.equal(context.rule, "selected-feature");
  assert.deepEqual(context.actions, []);
});

test("missing schema does not promise styling", () => {
  assert.deepEqual(deriveWorkspace({ layers: [{ uid: "a", queryable: true }] }).actions, ["view-table"]);
});

test("feature summaries favor a readable label and retain technical attributes", () => {
  const feature = summarizeFeature({ OBJECTID: 107, county: "Lander County", STATE: "NV", value: 9, another: 3, extra: 4, GlobalID: "abc" }, { title: "Counties" });
  assert.equal(feature.title, "Lander County");
  assert.equal(feature.summary.some(([key]) => key === "OBJECTID"), false);
  assert.deepEqual(feature.remaining.map(([key]) => key), ["OBJECTID", "GlobalID"]);
  assert.equal(summarizeFeature({ label: "Named" }, { displayField: "label" }).title, "Named");
});

test("local statistics are explicitly sampled and bounded", () => {
  const layer = { uid: "a", queryable: true, filterable: true, fields: [{ name: "amount", type: "double" }, { name: "kind", type: "string" }] };
  const records = Array.from({ length: 120 }, (_, index) => ({ attributes: { amount: index === 0 ? null : index, kind: index % 2 ? "a" : "b" } }));
  const profile = profileLayer(layer, [], records);
  assert.deepEqual(profile.coverage, { scope: "local-sample", sampleSize: 100, complete: false });
  assert.deepEqual(profile.statistics.amount, { nullCount: 1, min: 1, max: 99 });
  assert.equal(profile.statistics.kind.distinctInSample, 2);
  assert.deepEqual(deriveWorkspace({ layers: [layer] }).actions, ["style-layer", "view-table", "filter-layer"]);
  assert.equal(deriveWorkspace({ layers: [layer] }).suppressed[0].id, "explore-3d");
});

test("dismissal persists by project and source and can be restored", () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const key = suggestionKey("project-a", "active-layer", { url: "https://example.test/layer?token=secret" });
  const first = createSuggestionPreferences(storage);
  first.dismiss(key);
  const second = createSuggestionPreferences(storage);
  assert.equal(second.has(key), true);
  assert.equal(second.has(suggestionKey("project-b", "active-layer", { url: "https://example.test/layer?token=secret" })), false);
  assert.equal([...values.values()][0].includes("secret"), false);
  second.restore(key);
  assert.equal(createSuggestionPreferences(storage).has(key), false);
  assert.doesNotThrow(() => createSuggestionPreferences({ getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); } }).dismiss(key));
});
