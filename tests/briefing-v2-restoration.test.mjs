import test from "node:test";
import assert from "node:assert/strict";
import { loadSharedLayer } from "../js/shared-layer-loader.js";
import { createShareLink, readShareLocation, serializeShare } from "../js/map-share.js";

const url = "https://example.org/FeatureServer/0";
const filter = "STATE_ABBR = 'CA' AND GRAPES_ACRES_BEAR_NON_BEAR_TOT > 1000";
const renderer = { type: "simple", symbol: { color: "#800080" } };

test("complete briefing links preserve engine, terrain, primary layer, hidden slides, filters and style", async () => {
  const link = await createShareLink({ baseUrl: "https://gismap.online/", kind: "briefing", engine: "maplibre", ground: "flat", layers: [{ url, definitionExpression: filter, renderer, styled: true }], briefing: { layerId: url, slides: [{ id: "one", title: "Overview", template: "title" }, { id: "two", title: "Draft", template: "title", hidden: true }] } });
  const restored = await readShareLocation(new URL(link.url));
  assert.equal(restored.engine, "maplibre");
  assert.equal(restored.ground, "flat");
  assert.equal(restored.layers[0].definitionExpression, filter);
  assert.deepEqual(restored.layers[0].renderer, renderer);
  assert.equal(restored.briefing.layerId, url);
  assert.equal(restored.briefing.slides[1].hidden, true);
});

test("complete links reject state that cannot be safely represented", () => {
  const base = { kind: "briefing", layers: [{ url }], briefing: { slides: [] } };
  assert.throws(() => serializeShare({ ...base, layers: [{ url }, { local: true }] }), /local or non-shareable/);
  assert.throws(() => serializeShare({ ...base, primary: 3 }), /primary layer/);
  assert.throws(() => serializeShare({ ...base, selection: Array.from({ length: 301 }, (_, i) => i) }), /selection exceeds/i);
  assert.throws(() => serializeShare({ ...base, layers: [{ url, styled: true, renderer: { huge: "x".repeat(60001) } }] }), /renderer is too large/);
  assert.throws(() => serializeShare({ ...base, layers: [{ url: `${url}?token=secret` }] }), /credential/);
});

test("shared layers finish loading before styling and reject failures", async () => {
  const events = [];
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const layer = { uid: "one" };
  const state = { definitionExpression: filter, renderer: null };
  const controller = {
    async addService() { events.push("add"); return layer; },
    async loadLayer() { events.push("loading"); await gate; events.push("ready"); },
    restoreRenderer(_ref, style) { events.push("style"); state.renderer = style; },
    getLayerConfig() { return state; },
  };
  const loading = loadSharedLayer(controller, { url, definitionExpression: filter, renderer });
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(events, ["add", "loading"]);
  finish();
  assert.deepEqual(await loading, [layer]);
  assert.deepEqual(events, ["add", "loading", "ready", "style"]);
  await assert.rejects(loadSharedLayer({ ...controller, loadLayer: async () => { throw new Error("CORS unavailable"); } }, { url }), /CORS unavailable/);
  await assert.rejects(loadSharedLayer({ ...controller, getLayerConfig: () => ({ definitionExpression: null }) }, { url, definitionExpression: filter }), /filter could not be restored/);
});
