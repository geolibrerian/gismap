import test from "node:test";
import assert from "node:assert/strict";
import { CinematicModeController } from "../js/cinematic/mode.js";

test("cinematic mode applies transient observed IDs and restores the prior filter", async () => {
  const applied = [];
  const effects = [];
  const opacity = [];
  const focused = [];
  const layer = { uid: "perimeters", title: "Perimeters", queryable: true, objectIdField: "OBJECTID", maxRecordCount: 100, opacity: 0.8 };
  const mapController = {
    getLayer: (id) => id === "perimeters" ? layer : null,
    getFeatureFilter: async () => ({ objectIds: [99] }),
    getViewExtent: () => ({ xmin: -0.1, ymin: -0.1, xmax: 1.1, ymax: 1.1 }),
    setFeatureFilter: async (_id, filter) => { applied.push(filter); return true; },
    setOpacity: async (_id, value) => { opacity.push(value); },
    goToFeatures: async (features, options) => { focused.push({ features, options }); },
    setCinematicEffect: async (_id, effect) => { effects.push(effect); return true; },
    clearCinematicEffect: () => { effects.push(null); },
    queryFeatures: async () => ({ features: [
      { attributes: { OBJECTID: 1, incident: "a", observed_at: "2024-08-14T00:00:00Z" }, geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] } },
      { attributes: { OBJECTID: 2, incident: "a", observed_at: "2024-08-15T00:00:00Z" }, geometry: { type: "LineString", coordinates: [[1, 1], [2, 2]] } },
    ] }),
  };
  const mode = new CinematicModeController({ mapController });
  await mode.load({ cinematic: { title: "Observed", layers: [{ layerRef: "perimeters", temporal: { startField: "observed_at", groupField: "incident", featureIdField: "OBJECTID" } }] } });
  assert.equal(mode.state().spec.cinematic.intent, "explore");
  mode.setIntent("investigate");
  assert.equal(mode.state().spec.cinematic.intent, "investigate");
  assert.equal(mode.state().layers[0].observedCount, 1);
  assert.deepEqual(applied.at(-1), { objectIds: [1] });
  await mode.focusCurrentObservation();
  assert.equal(focused.at(-1).features[0].attributes.OBJECTID, 1);
  mode.seekObservation(1);
  await mode.renderTask;
  assert.deepEqual(applied.at(-1), { objectIds: [2] });
  mode.setTimeMode("cumulative");
  await mode.renderTask;
  assert.deepEqual(applied.at(-1), { objectIds: [1, 2] });
  mode.setLocalWindow(true);
  await mode.renderTask;
  assert.equal(mode.state().localWindow, true);
  assert.equal(mode.state().timeline.ticks.length, 2);
  // Changing the local window intentionally resets playback to that window's start.
  assert.deepEqual(applied.at(-1), { objectIds: [1] });
  mode.seekObservation(1);
  await mode.renderTask;
  mode.setBoundaryGlow(true);
  await mode.renderTask;
  assert.equal(effects.at(-1).type, "observed-effect");
  assert.equal(effects.at(-1).effect, "glow");
  assert.equal(effects.at(-1).items.length, 2);
  // Only the record first observed at the current tick flares as new.
  assert.deepEqual(effects.at(-1).items.map((item) => item.fresh), [false, true]);
  mode.setEffect("fire");
  await mode.renderTask;
  assert.equal(effects.at(-1).effect, "fire");
  assert.equal(mode.state().layers[0].effect, "fire");
  mode.setBoundaryGlow(false);
  await mode.renderTask;
  assert.equal(effects.at(-1), null);
  await mode.setLayerOpacity(0.4);
  assert.equal(opacity.at(-1), 0.4);
  await mode.destroy();
  assert.deepEqual(applied.at(-1), { objectIds: [99] });
  assert.equal(opacity.at(-1), 0.8);
});

test("cinematic mode loads every page so playback starts at the earliest record", async () => {
  // A newest-first feed of 25 records served 10 at a time.
  const rows = Array.from({ length: 25 }, (_, index) => ({ attributes: { OBJECTID: index + 1, time: Date.UTC(2026, 8, 1 + index) }, geometry: { type: "Point", coordinates: [0, 0] } })).reverse();
  const requests = [];
  const layer = { uid: "quakes", title: "Quakes", queryable: true, objectIdField: "OBJECTID", maxRecordCount: 10 };
  const mapController = {
    getLayer: (id) => id === "quakes" ? layer : null,
    getFeatureFilter: async () => null,
    setFeatureFilter: async () => true,
    setOpacity: async () => {},
    queryFeatures: async (_id, params) => {
      requests.push(params);
      const sorted = params.orderByFields?.[0] === "time ASC" ? [...rows].sort((a, b) => a.attributes.time - b.attributes.time) : rows;
      const page = sorted.slice(params.start || 0, (params.start || 0) + params.num);
      return { features: page, exceededTransferLimit: (params.start || 0) + params.num < rows.length };
    },
  };
  const mode = new CinematicModeController({ mapController });
  await mode.load({ cinematic: { layers: [{ layerRef: "quakes", temporal: { startField: "time" } }] } });
  assert.deepEqual(requests.map((params) => params.start), [0, 10, 20]);
  assert.equal(mode.state().timeline.ticks.length, 25);
  assert.equal(mode.state().timeline.observationTime, Date.UTC(2026, 8, 1));
  assert.equal(mode.state().layers[0].truncated, false);
  await mode.destroy();
});
