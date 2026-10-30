import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createEmbedIframe, createEmbedUrl } from "../js/embed-share.js";

test("embed links retain the shared payload and declare a focused viewer", () => {
  const source = "https://gismap.online/#map=zPayload";
  const embedded = new URL(createEmbedUrl(source, { kind: "map" }));
  assert.equal(embedded.hash, "#map=zPayload");
  assert.equal(embedded.searchParams.get("embed"), "1");
  assert.equal(embedded.searchParams.get("embedKind"), "map");
  assert.match(createEmbedIframe(source, { title: "<Map>", kind: "briefing", height: 480 }), /title="&lt;Map&gt;"/);
  assert.match(createEmbedIframe(source, { kind: "briefing" }), /embedKind=briefing/);
});

test("map and briefing sharing expose a reusable website embed, while tours retain theirs", async () => {
  const [ui, app, css] = await Promise.all([
    readFile(new URL("../js/ui.js", import.meta.url), "utf8"),
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../css/app.css", import.meta.url), "utf8"),
  ]);
  assert.match(ui, /Embed on a website/);
  assert.match(ui, /data-workflow-copy-embed/);
  assert.match(ui, /kind: "briefing"/);
  assert.match(ui, /createEmbedIframe\(embedUrl, \{ title: `\$\{title\} guided map tour`, kind: "tour" \}\)/);
  assert.match(app, /const sharedEmbed = launchParams\.get\("embed"\) === "1"/);
  assert.match(app, /openSharedState\(sharedState, \{ loadLayer: loadUnifiedLayer, embed: sharedEmbed \}\)/);
  assert.match(css, /body\.shared-embed :is\([^}]*\.sidebar/s);
  assert.match(css, /body\.shared-embed :is\([^}]*\.workspace-rail/s);
});

test("SI private previews use the focused GISMap Online viewer without a URL payload", async () => {
  const [app, css] = await Promise.all([
    readFile(new URL("../js/app.js", import.meta.url), "utf8"),
    readFile(new URL("../css/app.css", import.meta.url), "utf8"),
  ]);
  assert.match(app, /embedKind"\) === "si-preview"/);
  assert.match(app, /gismap\.si\.preview/);
  assert.match(app, /gismap\.preview\.loaded/);
  assert.match(app, /data\.features\.length > 2000/);
  assert.match(app, /event\.source !== window\.parent/);
  assert.match(app, /mapController\.goToLayers\(\[layer\], \{ animate: false \}\)/);
  assert.match(app, /let pendingPrivatePreview = null/);
  assert.match(app, /await mapController\.initialize\(\);[\s\S]*await loadPrivatePreview\(preview\)/);
  assert.match(css, /body\.si-preview-embed \.map-workspace/);
  assert.match(css, /body\.si-preview-embed \.si-embed-rail/);
});

test("private Dataset Studio embeds expose compact print, brief, and cinematic controls", async () => {
  const markup = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(markup, /class="si-embed-rail"/);
  assert.match(markup, /data-action="map-pdf"/);
  assert.match(markup, /data-action="share-export"/);
  assert.match(markup, /data-action="mode-cinematic"/);
});
