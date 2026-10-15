import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  SMART_IMAGE_CHUNK,
  SMART_IMAGE_FORMAT,
  embedProjectInPng,
  readProjectFromPng,
} from "../js/smart-image.js";

const transparentPng = () => new Blob([
  Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
], { type: "image/png" });

const project = {
  schema: "https://gismap.online/project/v1",
  version: 1,
  id: "oakland",
  name: "Oakland Development",
  basemap: "topo-3d",
  view: { type: "scene", center: [-122.27, 37.8], zoom: 12, heading: 0, tilt: 35 },
  layers: [{ title: "Projects", sourceType: "feature", url: "https://example.org/arcgis/rest/services/Projects/FeatureServer/0", visible: true }],
  bookmarks: [],
  presentation: { template: "briefing", briefing: { schemaVersion: 1, queries: {}, slides: [] } },
};

test("a Smart Image remains a PNG and restores its complete project", async () => {
  const smartImage = await embedProjectInPng(transparentPng(), project);
  assert.equal(smartImage.type, "image/png");
  assert.ok(smartImage.size > transparentPng().size);
  const bytes = new Uint8Array(await smartImage.arrayBuffer());
  assert.equal(String.fromCharCode(...bytes.slice(1, 4)), "PNG");
  assert.ok(Buffer.from(bytes).includes(Buffer.from(SMART_IMAGE_CHUNK)));
  const manifest = await readProjectFromPng(smartImage);
  assert.equal(manifest.format, SMART_IMAGE_FORMAT);
  assert.deepEqual(manifest.project, project);
});

test("ordinary and damaged PNGs fail with an actionable message", async () => {
  await assert.rejects(() => readProjectFromPng(transparentPng()), /ordinary image/);
  const smartImage = await embedProjectInPng(transparentPng(), project);
  const bytes = new Uint8Array(await smartImage.arrayBuffer());
  const marker = Buffer.from(bytes).indexOf(Buffer.from(SMART_IMAGE_CHUNK));
  bytes[marker + 10] ^= 1;
  await assert.rejects(() => readProjectFromPng(bytes), /damaged/);
});

test("Smart Images reject credentials embedded in remote layer URLs", async () => {
  const unsafe = structuredClone(project);
  unsafe.layers[0].url += "?token=secret";
  await assert.rejects(() => embedProjectInPng(transparentPng(), unsafe), /credential parameter/);
  const unsafeParameters = structuredClone(project);
  unsafeParameters.layers[0].customParameters = { apiKey: "secret" };
  await assert.rejects(() => embedProjectInPng(transparentPng(), unsafeParameters), /credential parameter/);
});

test("Project download and import expose the Smart Image workflow", async () => {
  const [html, projectSource, ui, smartImageSource, pdfSource] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../js/project.js", import.meta.url), "utf8"),
    readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../js/smart-image.js", import.meta.url), "utf8"),
    readFile(new URL("../js/pdf-document.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /Download project…/);
  assert.match(html, /\.png,image\/png/);
  assert.match(projectSource, /async exportSmartImage\(/);
  assert.match(projectSource, /readProjectFromPng\(file\)/);
  assert.match(ui, /Smart map image \(\.png\)/);
  assert.match(ui, /services must remain publicly reachable/i);
  assert.match(smartImageSource, /brandedMapCanvas/);
  assert.doesNotMatch(smartImageSource, /GISMAP SMART IMAGE/);
  assert.match(pdfSource, /export async function brandedMapCanvas/);
  assert.match(pdfSource, /gismap\.online/);
});

