import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  FIELD_TASK_LIMITS,
  addressDetails,
  addressPlace,
  createFieldTaskUrl,
  decodeFieldTask,
  encodeFieldTask,
  featureLayerUrl,
  locationUrl,
  readFieldTaskHash,
  readFocus,
  taskSteps,
  withFocus,
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

test("a task can rely on its latitude and longitude alone", () => {
  const { task: decoded } = decodeFieldTask(encodeFieldTask({ id: "loc", title: "Check sign", location: "Trailhead", latitude: 45.57617, longitude: -122.11576, steps: [{ text: "Photograph sign" }] }));
  assert.deepEqual([decoded.latitude, decoded.longitude, decoded.location], [45.57617, -122.11576, "Trailhead"]);
  assert.deepEqual(decoded.features, []);
});

test("addresses and the field check-in travel in the links", () => {
  const address = { label: "1 Harrison St, Oakland, California, 94612, USA", city: "Oakland", latitude: 37.8091, longitude: -122.2633 };
  const assigned = decodeFieldTask(encodeFieldTask({ ...task, latitude: 37.8091, longitude: -122.2633, address }, "assign")).task;
  assert.deepEqual(assigned.address, { label: address.label });
  assert.equal(assigned.checkIn, undefined);
  const checkIn = { latitude: 37.80912, longitude: -122.26338, accuracy: 12.4, at: "2026-10-14T18:30:00.000Z", address: { label: "Snow Park, Oakland, California" } };
  const returned = decodeFieldTask(encodeFieldTask({ ...task, address, checkIn, completedAt: "2026-10-14T18:40:00.000Z" }, "return")).task;
  assert.deepEqual(returned.checkIn, { latitude: 37.80912, longitude: -122.26338, accuracy: 12, at: "2026-10-14T18:30:00.000Z", address: { label: "Snow Park, Oakland, California" } });
  assert.deepEqual(returned.address, { label: address.label });
});

test("address details keep the parts Location Intelligence returns", () => {
  const details = addressDetails({ address: "1 Harrison St", attributes: { LongLabel: "1 Harrison St, Oakland, CA, 94612, USA", Neighborhood: "Adams Point", City: "Oakland", Subregion: "Alameda County", Region: "California", Postal: "94612", CntryName: "United States" } }, { latitude: 37.8, longitude: -122.26 });
  assert.equal(details.label, "1 Harrison St, Oakland, CA, 94612, USA");
  assert.equal(addressPlace(details), "Adams Point, Oakland, Alameda County, California 94612, United States");
  assert.deepEqual([details.latitude, details.longitude], [37.8, -122.26]);
  assert.equal(addressDetails(null), null);
});

test("report links can focus on a place or an attached feature", () => {
  const link = createFieldTaskUrl({ baseUrl: "https://gismap.online/", task });
  const focused = withFocus(link, { latitude: 37.7818661, longitude: -122.1969583, feature: 1 });
  assert.equal(readFieldTaskHash(new URL(focused).hash), readFieldTaskHash(new URL(link).hash), "the task payload is untouched");
  assert.deepEqual(readFocus(new URL(focused).hash), { at: { latitude: 37.781866, longitude: -122.196958 }, feature: 1 });
  assert.deepEqual(readFocus("#fieldTask=abc"), { at: null, feature: null });
  assert.deepEqual(readFocus("#at=95,10&feature=x"), { at: null, feature: null }, "out-of-range places and bad indexes are ignored");
  const place = new URL(locationUrl("https://gismap.online/?layer=x#tour=y", { latitude: 45.5, longitude: -122.6 }));
  assert.equal(place.search, "");
  assert.deepEqual(readFocus(place.hash).at, { latitude: 45.5, longitude: -122.6 });
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
  assert.match(router, /openSharedTask\(\{ kind, task: shared \}, focus = \{\}\)/);
  assert.match(router, /kind: "return"/);
  assert.match(app, /readFieldTaskHash\(location\.hash\)/);
  assert.match(app, /mobileWorkflowRouter\.openSharedTask\(shared, readFocus\(location\.hash\)\)/);
});

test("a hand-written json: field task decodes as an assignment, never a report", async () => {
  const { decodeFieldTask, createFieldTaskUrl, readFieldTaskHash } = await import("../js/field-task-share.js");
  const written = { title: "Park check", location: "Dolores Park", lat: 37.75972, lon: -122.42713, notes: "Check in first.", steps: ["Playground", { text: "Fountains" }], k: "r", checkIn: { lat: 1, lon: 1 } };
  const url = `https://gismap.online/?workflow=tasks#fieldTask=json:${encodeURIComponent(JSON.stringify(written))}`;
  const { kind, task } = decodeFieldTask(readFieldTaskHash(new URL(url).hash));
  assert.equal(kind, "assign");
  assert.deepEqual(task.steps.map((step) => step.text), ["Playground", "Fountains"]);
  assert.deepEqual([task.latitude, task.longitude, task.checkIn], [37.75972, -122.42713, undefined]);
  assert.throws(() => decodeFieldTask(`json:${encodeURIComponent(JSON.stringify({ title: "Too many", steps: Array(11).fill("x") }))}`), /at most 10 steps/);
  const readable = createFieldTaskUrl({ baseUrl: "https://gismap.online/", task, readable: true });
  assert.match(readable, /#fieldTask=json:%7B/);
  assert.equal(decodeFieldTask(readFieldTaskHash(new URL(readable).hash)).task.title, "Park check");
});
