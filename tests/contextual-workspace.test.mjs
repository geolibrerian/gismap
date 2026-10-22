import test from "node:test";
import assert from "node:assert/strict";
import { createSuggestionPreferences, deriveWorkspace, executeContextAction, profileLayer, suggestionKey, summarizeFeature } from "../js/contextual-workspace.js";

test("empty project offers discovery without a layer", () => {
  assert.deepEqual(deriveWorkspace().actions, ["create-briefing", "create-tour", "presentation-skins"]);
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
  assert.deepEqual(deriveWorkspace({ layers: [layer], capabilities: ["spatial-chart-3d"] }).actions, ["create-briefing", "create-tour", "explore-3d", "presentation-skins", "style-layer", "view-table"]);
  assert.equal(profileLayer(layer, []).capabilities.extrusion, false);
  assert.equal(profileLayer({ ...layer, geometryType: "point" }, ["spatial-chart-3d"]).capabilities.extrusion, false);
});

test("feature selection defers to the existing inspector", () => {
  const context = deriveWorkspace({ layers: [{ uid: "a", queryable: true }], selection: { features: [{}] } });
  assert.equal(context.rule, "selected-feature");
  assert.deepEqual(context.actions, []);
});

test("missing schema does not promise styling", () => {
  assert.deepEqual(deriveWorkspace({ layers: [{ uid: "a", queryable: true }] }).actions, ["create-briefing", "create-tour", "presentation-skins", "view-table"]);
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
  assert.deepEqual(profile.statistics.amount, { nullCount: 1, nullRate: 0.01, min: 1, max: 99 });
  assert.equal(profile.statistics.kind.distinctInSample, 2);
  assert.deepEqual(deriveWorkspace({ layers: [layer] }).actions, ["create-briefing", "create-tour", "presentation-skins", "style-layer", "view-table", "filter-layer"]);
  assert.equal(deriveWorkspace({ layers: [layer] }).suppressed.some(({ id }) => id === "explore-3d"), true);
});

test("sampled time ranges retain explicit units and ignore invalid values", () => {
  const layer = { fields: [{ name: "FireYear", type: "integer" }, { name: "started", type: "date" }] };
  const sample = [{ attributes: { FireYear: 2020, started: "2020-01-01T00:00:00Z" } }, { attributes: { FireYear: 2024, started: "not a date" } }];
  const profile = profileLayer(layer, [], sample);
  assert.deepEqual(profile.statistics.FireYear.temporalRange, { min: 2020, max: 2024, units: "year" });
  assert.deepEqual(profile.statistics.started.temporalRange, { min: 1577836800000, max: 1577836800000, units: "unix-ms" });
});

test("time suggestions require an actual filterable temporal field", () => {
  const layer = { uid: "fires", queryable: true, filterable: true, geometryType: "polygon", fields: [{ name: "FireYear", type: "integer" }] };
  assert.deepEqual(deriveWorkspace({ layers: [layer], capabilities: ["spatial-chart-3d"] }).actions, ["create-briefing", "create-tour", "explore-time", "explore-3d", "presentation-skins", "style-layer", "view-table", "filter-layer"]);
  assert.equal(deriveWorkspace({ layers: [{ ...layer, filterable: false }] }).actions.includes("explore-time"), false);
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

test("editing workflows suppress incompatible layer suggestions", () => {
  const layer = { uid: "a", queryable: true, filterable: true, fields: [{ name: "name", type: "string" }] };
  for (const workflow of ["draw", "notes", "field-task", "briefing", "presentation"]) {
    const context = deriveWorkspace({ layers: [layer], workflow, viewport: "mobile" });
    assert.equal(context.rule, `workflow:${workflow}`);
    assert.deepEqual(context.actions, []);
    assert.equal(context.viewport, "mobile");
  }
});

test("action execution only calls a registered and currently offered command", () => {
  const context = deriveWorkspace();
  assert.equal(executeContextAction("create-tour", context, { tour: () => "opened" }), "opened");
  assert.throws(() => executeContextAction("view-table", context, { table: () => {} }), /unavailable/);
  assert.throws(() => executeContextAction("toString", context, {}), /unavailable/);
});
