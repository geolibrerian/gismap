import test from "node:test";
import assert from "node:assert/strict";
import { deriveWorkspace, profileLayer } from "../js/contextual-workspace.js";

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
