import assert from "node:assert/strict";
import test from "node:test";
import { previewChain, resultLabel, stepLabel, timeLeft } from "../js/load-progress.js";
import { createMapSpecApi } from "../js/map-spec-api.js";

const URL_A = "https://example.com/arcgis/rest/services/Blocks/FeatureServer/0";

test("time left is judged from the first arrival, not from a slow first response", () => {
  const now = 100_000;
  assert.equal(timeLeft({ loaded: 2000, total: 20000, first: { at: now - 10_000, loaded: 2000 } }, now), null, "one arrival is not a rate");
  assert.equal(timeLeft({ loaded: 6000, total: 20000, first: { at: now - 4_000, loaded: 2000 } }, now), "about 14 s left");
  assert.equal(timeLeft({ loaded: 3000, total: 90000, first: { at: now - 10_000, loaded: 2000 } }, now), "about 15 min left");
  assert.equal(timeLeft({ loaded: 20000, total: 20000, first: { at: now - 4_000, loaded: 2000 } }, now), null);
});

test("stages are named and counted in plain words", () => {
  assert.equal(resultLabel("random-points", 42232), "42,232 dots");
  assert.equal(resultLabel("hexbin", 1), "1 hexagon");
  assert.equal(resultLabel("buffer", 3), "3 features");
  assert.equal(stepLabel({ operation: "hexbin" }), "Hexagons");
  assert.equal(stepLabel({ operation: "convex-hull" }), "Convex hull");
  assert.equal(stepLabel({ operation: "hexbin", title: "People per cell" }), "People per cell");
});

test("a hexagon preview follows a hexbin of a layer, or random points then hexbin", () => {
  const dots = { operation: "random-points", input: 0, options: { field: "pop" } };
  const bins = { operation: "hexbin", input: { step: 0 }, options: { resolution: 8 } };
  assert.deepEqual(previewChain([dots, bins]), { layer: 0, hexbin: 1, chain: [dots, bins] });
  assert.deepEqual(previewChain([{ operation: "buffer", input: 0 }, { operation: "hexbin", input: 1 }]), { layer: 1, hexbin: 1, chain: [{ operation: "hexbin", input: 1 }] });
  assert.equal(previewChain([{ operation: "hexbin", input: 0, overlay: 1 }]), null, "a study area is left to the real step");
  assert.equal(previewChain([{ operation: "buffer", input: 0 }, { operation: "hexbin", input: { step: 0 } }]), null);
});

test("loading a map link reports each layer and step to the progress strip", async () => {
  const calls = [];
  const tracker = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args.map((arg) => (Array.isArray(arg) ? arg.length : arg))]) });
  const layers = {
    list: () => [],
    add: async (url, options) => { if (/missing/.test(url)) throw new Error("no"); return { id: `uid-${options.title}`, url }; },
    update: async () => ({}),
    zoomTo: async () => {},
  };
  const analysis = { run: async (operation) => ({ featureCount: operation === "hexbin" ? 12 : 300, layer: { id: `result-${operation}` } }) };
  let stages = null;
  const api = createMapSpecApi({ layers, camera: { set: async () => ({}) }, mapController: {}, analysis, host: { startProgress: (list) => { stages = list; return tracker; } } });
  await api.load({ version: 1, camera: { center: [0, 0], zoom: 5 }, layers: [{ url: URL_A, title: "Blocks" }, { url: URL_A.replace("Blocks", "missing"), title: "Gone" }], analysis: [
    { operation: "random-points", input: 0, options: { field: "pop" } },
    { operation: "hexbin", input: { step: 0 }, options: { statistic: "sum", field: "represents" } },
  ] }).ready;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(stages.map(({ id, label }) => [id, label]), [["layer-0", "Blocks"], ["layer-1", "Gone"], ["step-0", "Random points"], ["step-1", "Hexagons"]]);
  assert.deepEqual(calls, [
    ["preview", "layer-0", 2],
    ["starting", "layer-0"], ["layer", "layer-0", "uid-Blocks"],
    ["starting", "layer-1"], ["failed", "layer-1"],
    ["step", "step-0", "active"], ["step", "step-0", "done", "300 dots"],
    ["step", "step-1", "active"], ["stopPreview"], ["step", "step-1", "done", "12 hexagons"],
    ["finish"],
  ]);
});
