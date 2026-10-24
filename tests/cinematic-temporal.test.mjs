import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTemporalFeatures, observedFeatureIdsAt, parseTemporalValue, temporalFieldCandidates } from "../js/cinematic/temporal-adapter.js";
import { importCinematicSpec } from "../js/cinematic/state.js";

const features = [
  { attributes: { OBJECTID: 1, fire: "a", observed_at: "2024-08-14T00:00:00Z" } },
  { attributes: { OBJECTID: 2, fire: "a", observed_at: "2024-08-15T00:00:00Z" } },
  { attributes: { OBJECTID: 3, fire: "b", observed_at: "2024-08-14T00:00:00Z" } },
  { attributes: { OBJECTID: 4, fire: "b", observed_at: "2024-08-16T00:00:00Z" } },
  { attributes: { OBJECTID: 5, fire: "a", observed_at: "not a date" } },
];

test("cinematic temporal adapter keeps observed group snapshots and rejects invalid times", () => {
  const model = normalizeTemporalFeatures(features, { timeField: "observed_at", groupField: "fire", objectIdField: "OBJECTID" });
  assert.equal(model.ticks.length, 3);
  assert.equal(model.invalid.length, 1);
  assert.deepEqual(observedFeatureIdsAt(model, Date.parse("2024-08-14T12:00:00Z")), [1, 3]);
  assert.deepEqual(observedFeatureIdsAt(model, Date.parse("2024-08-15T12:00:00Z")), [2, 3]);
  assert.deepEqual(observedFeatureIdsAt(model, Date.parse("2024-08-16T00:00:00Z")), [2, 4]);
});

test("cinematic mode does not guess numeric years as dates", () => {
  assert.equal(parseTemporalValue(2024), null);
  assert.equal(parseTemporalValue(1723593600000), 1723593600000);
  assert.deepEqual(temporalFieldCandidates({ fields: [{ name: "YEAR", type: "integer" }, { name: "observed_at", type: "date" }] }).map((field) => field.name), ["observed_at"]);
});

test("cumulative mode retains every observed record through the selected time", () => {
  const model = normalizeTemporalFeatures(features, { timeField: "observed_at", groupField: "fire", objectIdField: "OBJECTID" });
  assert.deepEqual(observedFeatureIdsAt(model, Date.parse("2024-08-15T12:00:00Z"), { timeMode: "cumulative" }), [1, 2, 3]);
});

test("cinematic specs require explicit layer and time mapping", () => {
  assert.throws(() => importCinematicSpec({ cinematic: { layers: [{ layerRef: "x", temporal: {} }] } }), /startField/);
  const spec = importCinematicSpec({ cinematic: { title: "Observed boundary", layers: [{ layerRef: "x", temporal: { startField: "observed_at", featureIdField: "OBJECTID" } }], provenance: { interpolated: true } } });
  assert.equal(spec.cinematic.provenance.interpolated, false);
  assert.equal(spec.cinematic.layers[0].animation.template, "step-perimeter");
  assert.equal(spec.cinematic.clock.timeMode, "instant");
});
