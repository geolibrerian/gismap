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
