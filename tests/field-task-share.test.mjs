import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FIELD_TASK_LIMITS,
  createFieldTaskUrl,
  decodeFieldTask,
  encodeFieldTask,
  featureLayerUrl,
  readFieldTaskHash,
  taskSteps,
} from "../js/field-task-share.js";

const layer = "https://services.arcgis.com/abc/arcgis/rest/services/Hydrants/FeatureServer/0";
const feature = (index) => ({ layerUrl: layer, objectId: index, longitude: -122.67 + index / 100, latitude: 45.52, label: `Hydrant ${index}`, done: false });
const task = {
  id: "task-1",
  title: "Inspect hydrants",
  location: "Pearl District",
  notes: "Check caps and flow markers.",
  steps: [{ text: "Photograph each hydrant", done: true }, { text: "Note damage", done: false }],
  features: [feature(1), feature(2)],
  photos: ["data:image/png;base64,AAAA"],
};

test("an assignment round-trips without completion state or photos", () => {
  const { kind, task: decoded } = decodeFieldTask(encodeFieldTask(task, "assign"));
  assert.equal(kind, "assign");
  assert.equal(decoded.id, "task-1");
  assert.equal(decoded.title, "Inspect hydrants");
  assert.deepEqual(decoded.steps, [{ text: "Photograph each hydrant", done: false }, { text: "Note damage", done: false }]);
  assert.equal(decoded.features.length, 2);
  assert.equal(decoded.features[1].layerUrl, layer);
  assert.equal(decoded.features[1].objectId, 2);
  assert.equal(decoded.features[1].done, false);
  assert.equal(decoded.photos, undefined);
});

test("a return link carries done flags, the report and who completed it", () => {
  const completed = { ...task, features: [{ ...feature(1), done: true }, feature(2)], report: "Cap missing on #2", completedBy: "Sam", completedAt: "2026-10-14T18:00:00.000Z" };
  const { kind, task: decoded } = decodeFieldTask(encodeFieldTask(completed, "return"));
  assert.equal(kind, "return");
  assert.deepEqual(decoded.steps.map((step) => step.done), [true, false]);
  assert.deepEqual(decoded.features.map((item) => item.done), [true, false]);
  assert.equal(decoded.report, "Cap missing on #2");
  assert.equal(decoded.completedBy, "Sam");
  assert.equal(decoded.completedAt, "2026-10-14T18:00:00.000Z");
});

test("shared tasks are limited to five features", () => {
  assert.equal(FIELD_TASK_LIMITS.maxFeatures, 5);
  const six = { ...task, features: [1, 2, 3, 4, 5, 6].map(feature) };
  assert.throws(() => encodeFieldTask(six), /at most 5 features/);
  const five = { ...task, features: [1, 2, 3, 4, 5].map(feature) };
  assert.equal(decodeFieldTask(encodeFieldTask(five)).task.features.length, 5);
});

test("links are QR-sized, use the fragment, and reject credentials or bad payloads", () => {
  const url = new URL(createFieldTaskUrl({ baseUrl: "https://gismap.online/?layer=x#tour=y", task }));
  assert.equal(url.searchParams.get("workflow"), "tasks");
  assert.equal(url.searchParams.get("layer"), null);
  assert.ok(readFieldTaskHash(url.hash));
  assert.ok(url.href.length <= FIELD_TASK_LIMITS.maxUrlLength);
  assert.throws(() => encodeFieldTask({ ...task, features: [{ ...feature(1), layerUrl: `${layer}?token=secret` }] }), /credential/);
  assert.throws(() => decodeFieldTask("not-base64!"), /not valid/);
  const badLocation = Buffer.from(JSON.stringify({ v: 1, k: "a", t: "x", f: [{ x: 500, y: 0 }] })).toString("base64url");
  assert.throws(() => decodeFieldTask(badLocation), /invalid location/);
});

test("links made before versioned payloads still open", () => {
  const legacy = Buffer.from(JSON.stringify({ id: "old", title: "Old task", checklist: [true, false, false], latitude: 45, longitude: -122 })).toString("base64url");
  const { kind, task: decoded } = decodeFieldTask(legacy);
  assert.equal(kind, "assign");
  assert.equal(decoded.title, "Old task");
  assert.equal(decoded.steps.length, 3);
});

test("steps fall back to the original checklist and layer URLs include the layer id", () => {
  assert.deepEqual(taskSteps({ checklist: [false, true, false] }).map((step) => step.done), [false, true, false]);
  assert.equal(featureLayerUrl({ url: "https://x.test/arcgis/rest/services/A/FeatureServer", layerId: 3 }), "https://x.test/arcgis/rest/services/A/FeatureServer/3");
  assert.equal(featureLayerUrl({ url: "https://x.test/arcgis/rest/services/A/MapServer/2", layerId: 2 }), "https://x.test/arcgis/rest/services/A/MapServer/2");
  assert.equal(featureLayerUrl({}), null);
});

test("the router and app wire assignments, picking and return links", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(router, /data-attach-feature/);
  assert.match(router, /openSharedTask\(\{ kind, task: shared \}\)/);
  assert.match(router, /kind: "return"/);
  assert.match(app, /readFieldTaskHash\(location\.hash\)/);
  assert.match(app, /mobileWorkflowRouter\.openSharedTask\(shared\)/);
});
