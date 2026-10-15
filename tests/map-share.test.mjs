import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { decodePayload, encodePayload } from "../js/link-codec.js";
import { QR_SAFE_LENGTH, compactBriefing, createShareLink, hasDataFilter, readShare, readShareLocation, serializeShare } from "../js/map-share.js";
import { createFieldTaskUrl, decodeFieldTask, readFieldTaskHash } from "../js/field-task-share.js";

const LAYER = "https://services9.arcgis.com/abc/arcgis/rest/services/Fires/FeatureServer/0";
const renderer = { type: "classBreaks", field: "acres", classBreakInfos: [{ minValue: 0, maxValue: 10, symbol: { type: "esriSMS", color: [1, 2, 3, 255] } }], legendOptions: { showLegend: false }, visualVariables: [] };

test("links compress, and older uncompressed links still open", async () => {
  const value = { text: "Wildfire update · ✓", numbers: [1, 2, 3] };
  const encoded = await encodePayload(value);
  assert.match(encoded, /^[zj][A-Za-z0-9_-]+$/, "URL-safe with a format prefix");
  assert.deepEqual(await decodePayload(encoded), value);
  assert.deepEqual(await decodePayload(btoa(JSON.stringify({ a: 1 })).replaceAll("=", "")), { a: 1 });
  await assert.rejects(decodePayload("z!!!"), /damaged/);
});

test("a briefing link carries layers with styles and filters, skin, basemap, view and visible slides", async () => {
  const link = await createShareLink({
    baseUrl: "https://gismap.online/?workflow=briefing",
    kind: "briefing",
    title: "Fires",
    skin: "velvet-orbit",
    basemap: "dark-gray-3d",
    camera: { center: [-120.123456789, 38.5], zoom: 7, heading: 10, tilt: 20 },
    layers: [{ uid: "a", url: LAYER, sourceType: "feature", title: "Fires", definitionExpression: "acres > 10", renderer, opacity: 0.8, visible: true }, { uid: "b", url: "blob:local", local: true }],
    primary: 0,
    briefing: { slides: [{ id: "s-1", template: "title", title: "Fires" }, { id: "s-2", template: "feature", featureId: 4, title: "One", blocks: [{ id: "b-1", type: "facts", fields: [] }] }, { id: "s-3", template: "actions", hidden: true }] },
    selection: [4, 5],
    slide: "s-2",
  });
  const url = new URL(link.url);
  assert.equal(url.search, "", "the old ?workflow parameters are dropped");
  assert.ok(link.qr && link.url.length <= QR_SAFE_LENGTH);
  const shared = await readShareLocation(url);
  assert.equal(shared.kind, "briefing");
  assert.equal(shared.slide, "s-2");
  assert.equal(shared.skin, "velvet-orbit");
  assert.equal(shared.basemap, "dark-gray-3d");
  assert.deepEqual(shared.camera.center, [-120.12346, 38.5]);
  assert.equal(shared.layers.length, 1, "files from this device cannot travel");
  assert.deepEqual(shared.layers[0].renderer, renderer, "the renderer arrives exactly as serialized, false values included");
  assert.equal(shared.layers[0].definitionExpression, "acres > 10");
  assert.equal(shared.layers[0].opacity, 0.8);
  assert.deepEqual(shared.briefing.slides.map((slide) => slide.id), ["s-1", "s-2"], "hidden slides are not shared");
  assert.equal(shared.briefing.slides[1].featureId, "4");
  assert.deepEqual(shared.selection, ["4", "5"]);
});

test("shared links are validated: HTTPS layers, known skins and basemaps, no credentials", () => {
  const payload = serializeShare({ kind: "map", skin: "nope", basemap: "made-up", layers: [{ url: LAYER, definitionExpression: "1=1" }] });
  assert.equal(payload.s, "gismap");
  assert.equal(payload.m, undefined);
  assert.equal(payload.L[0].w, undefined, "a do-nothing filter is not sent");
  assert.throws(() => readShare({ v: 1, k: "map", L: [{ u: "http://example.com/FeatureServer/0" }] }), /HTTPS/);
  assert.throws(() => readShare({ v: 1, k: "map", L: [{ u: `${LAYER}?token=abc` }] }), /credential/);
  assert.throws(() => readShare({ v: 2, k: "map", L: [] }), /newer or different/);
  assert.throws(() => serializeShare({ kind: "map", layers: [{ url: "blob:x", local: true }] }), /public web layer/);
  assert.equal(hasDataFilter(" 1 = 1 "), false);
  assert.equal(hasDataFilter("acres > 10"), true);
  assert.deepEqual(compactBriefing({ slides: [{ id: "s", template: "title", title: "", hidden: false, blocks: [] }] }).slides, [{ id: "s", template: "title" }]);
});

test("field task links carry the layer styles when they fit, and drop them when they do not", () => {
  const task = { id: "t1", title: "Visit", features: [{ layerUrl: LAYER, objectId: 3, latitude: 1, longitude: 2, label: "Three" }], layerStyles: { [LAYER]: renderer } };
  const url = createFieldTaskUrl({ baseUrl: "https://gismap.online/", task });
  const decoded = decodeFieldTask(readFieldTaskHash(new URL(url).hash));
  assert.deepEqual(decoded.task.layerStyles[LAYER], renderer);
  const huge = { type: "uniqueValue", field1: "x", uniqueValueInfos: Array.from({ length: 30 }, (_, index) => ({ value: `v${index}`, label: `Value ${index}`, symbol: { type: "esriSMS", color: [index, 2, 3, 255] } })) };
  const tight = createFieldTaskUrl({ baseUrl: "https://gismap.online/", task: { ...task, notes: "n".repeat(500), layerStyles: { [LAYER]: huge } } });
  assert.equal(decodeFieldTask(readFieldTaskHash(new URL(tight).hash)).task.layerStyles, undefined);
});

test("the app opens shared links, shares from one Share & export place, and connects the modes", async () => {
  const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const slides = await readFile(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const pdf = await readFile(new URL("../js/pdf-document.js", import.meta.url), "utf8");
  const manifest = JSON.parse(await readFile(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.match(app, /readShareLocation\(location/);
  assert.match(app, /openSharedState\(sharedState/);
  assert.match(app, /launchQueue\?\.setConsumer/);
  assert.match(ui, /this\.briefingSlides\.openPlayer\(/, "a briefing link starts presenting");
  assert.match(ui, /title: "Share & export"/);
  assert.match(ui, /data-share-export/);
  assert.match(ui, /createBriefingFromLayer\(/);
  assert.match(ui, /createTourFromPlaces\(/);
  assert.match(ui, /data-briefing-add-task/);
  assert.match(slides, /data-list-task/, "briefing action items become field tasks");
  assert.match(slides, /data-slides-tour/);
  assert.match(router, /data-task-tour/);
  assert.match(router, /data-task-briefing/);
  assert.match(pdf, /PRINT_PALETTES/);
  assert.deepEqual(Object.values(manifest.file_handlers[0].accept).flat().sort(), [".gmo", ".gmoatlas", ".gmop"]);
});

test("one reader opens both briefing link forms: full app links and the API's slides-only links", async () => {
  const { createBriefingUrl } = await import("../js/briefing-share.js");
  const slidesOnly = await createBriefingUrl({ baseUrl: `https://gismap.online/?layer=${encodeURIComponent(LAYER)}`, briefing: { slides: [{ id: "s-1", template: "title", title: "From an agent" }] } });
  const url = new URL(slidesOnly);
  assert.equal(url.searchParams.get("layer"), LAYER, "slides-only links keep the layers they load");
  const opened = await readShareLocation(url);
  assert.equal(opened.kind, "briefing-document");
  assert.equal(opened.briefing.slides[0].title, "From an agent");
  const full = await createShareLink({ baseUrl: "https://gismap.online/", kind: "briefing", layers: [{ url: LAYER }], briefing: { slides: [{ id: "s-2", template: "title" }] } });
  assert.equal((await readShareLocation(new URL(full.url))).kind, "briefing");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const api = await readFile(new URL("../js/briefing-api.js", import.meta.url), "utf8");
  assert.match(ui, /card\("smart-image", "Smart map image"/);
  assert.match(api, /documentOnly/);
  assert.match(api, /createShareLink\(/, "the API shares the same full link as the app");
});

test("?briefing= opens a schema briefing document, alone or inside a project, as well as the app's own file", async () => {
  const file = new URL("https://gismap.online/?briefing=https%3A%2F%2Fexample.org%2Fbriefing.json");
  const document = { schemaVersion: 1, layerId: LAYER, selection: { ids: ["4"] }, slides: [{ id: "s-1", template: "title", title: "By hand", hidden: false, blocks: [] }] };
  const fromDocument = await readShareLocation(file, { fetchJson: async () => document });
  assert.equal(fromDocument.kind, "briefing-document");
  assert.equal(fromDocument.briefing.layerId, LAYER, "layerId and selection survive for the app to use");
  assert.deepEqual(fromDocument.briefing.selection, { ids: ["4"] });
  const fromProject = await readShareLocation(file, { fetchJson: async () => ({ version: 1, presentation: { briefing: document } }) });
  assert.equal(fromProject.briefing.slides[0].title, "By hand");
  await assert.rejects(readShareLocation(file, { fetchJson: async () => ({ ...document, schemaVersion: 2 }) }), /newer schema/);
  const payload = serializeShare({ kind: "briefing", layers: [{ url: LAYER }], briefing: document });
  assert.equal((await readShareLocation(file, { fetchJson: async () => payload })).kind, "briefing");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /async openBriefingDocument\(briefing/);
  assert.match(ui, /layerId: briefingLayerRef\(this\.mapController, layer\)/, "the app writes the portable layer and selection into the document");
});

test("links carry styles set in GISMap, not a service's own image-heavy style", () => {
  const serviceStyle = { type: "uniqueValue", field1: "kind", uniqueValueInfos: [{ value: "a", symbol: { type: "esriPMS", imageData: "iVBORw0K".repeat(500) } }] };
  assert.equal(serializeShare({ kind: "map", layers: [{ url: LAYER, renderer: serviceStyle, styled: false }] }).L[0].r, undefined);
  assert.deepEqual(serializeShare({ kind: "map", layers: [{ url: LAYER, renderer: serviceStyle, styled: true }] }).L[0].r, serviceStyle);
  assert.deepEqual(serializeShare({ kind: "map", layers: [{ url: LAYER, renderer }] }).L[0].r, renderer, "small styles travel either way");
});
