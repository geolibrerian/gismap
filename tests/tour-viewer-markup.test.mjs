import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

assert.match(html, /id="atlas-tour-exit"[^>]*aria-label="Exit tour"/, "The chapter overlay must expose an Exit tour control.");
assert.match(ui, /#exitAtlasTour\(\)[\s\S]*template:\s*"standard"/, "Exiting a tour must restore the standard workspace.");
assert.match(ui, /data-tour-embed-code/, "The share dialog must provide embeddable iframe HTML.");
assert.match(ui, /Tour only[\s\S]*Hide authoring menus/, "The share dialog must explain tour-only access.");
assert.match(app, /tourOnly:\s*launch\.get\("tourOnly"\) === "1"/, "Shared launches must recognize tour-only URLs.");
assert.match(app, /embed:\s*launch\.get\("embed"\) === "1"/, "Shared launches must recognize embedded URLs.");
