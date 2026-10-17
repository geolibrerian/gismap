import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ToolRegistry } from "../js/application-registry.js";
import { AUTHORING_TOOL_DEFINITIONS, registerAuthoringTools } from "../js/agent-authoring-tools.js";
import { arcgisMetadata, inspectSource } from "../js/source-inspector.js";
import { createAssistantTools } from "../js/map-assistant.js";

const url = "https://example.org/FeatureServer/0";
test("read-only shared commands are discoverable, validated and delegate to existing APIs", async () => {
  const registry = new ToolRegistry();
  const calls = [];
  registerAuthoringTools(registry, {
    sources: { inspect: async (...args) => { calls.push(args); return { kind: "arcgis-layer", fields: [] }; } },
    layers: { list: () => [{ id: "layer-1" }] },
    camera: { get: () => ({ zoom: 4 }) },
    briefing: { get: () => ({ slides: [] }), validate: (doc) => ({ valid: true, document: doc, issues: [] }) },
  });
  assert.deepEqual(registry.list().map(({ id }) => id), AUTHORING_TOOL_DEFINITIONS.map(({ id }) => id));
  assert.equal((await registry.execute("source.inspect", { url, sample: false })).kind, "arcgis-layer");
  assert.deepEqual(calls, [[url, { sample: false }]]);
  assert.deepEqual(await registry.execute("layer.list", {}), [{ id: "layer-1" }]);
  assert.deepEqual(await registry.execute("map.camera.inspect", {}), { zoom: 4 });
  assert.deepEqual(await registry.execute("briefing.inspect", {}), { slides: [] });
  assert.equal((await registry.execute("briefing.validate", { document: { slides: [] } })).valid, true);
  for (const input of [{}, { url: "" }, { url: "   " }, { url, sample: "false" }, { url, token: "x" }, null]) {
    await assert.rejects(registry.execute("source.inspect", input), (error) => error.code === "INVALID_SPEC");
  }
});

test("assistant uses the shared source command", async () => {
  const calls = [];
  const handlers = createAssistantTools({ api: { application: { runTool: async (...args) => { calls.push(args); return { kind: "geojson", fields: [] }; } } } });
  await handlers.inspect_source({ url });
  assert.deepEqual(calls, [["source.inspect", { url }]]);
});

test("source profile does not invent pagination, CORS or authentication capabilities", async () => {
  const a = arcgisMetadata({ name: "A", capabilities: "Query" }, url);
  assert.equal(a.supportsPagination, null);
  assert.equal(a.access.authentication, "unknown");
  assert.equal(a.access.cors, "not-verified");
  assert.equal(arcgisMetadata({ advancedQueryCapabilities: { supportsPagination: true }, copyrightText: "Publisher" }, url).supportsPagination, true);
  const meta = await inspectSource("https://example.org/data.geojson", { fetchImpl: async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [] }) }) });
  assert.equal(meta.supportsPagination, false);
  assert.equal(meta.access.cors, "not-verified");
});

test("published command metadata matches the registered contract", async () => {
  const published = JSON.parse(await readFile(new URL("../api/capabilities.json", import.meta.url), "utf8"));
  assert.deepEqual(published.authoringCommands, AUTHORING_TOOL_DEFINITIONS);
});
