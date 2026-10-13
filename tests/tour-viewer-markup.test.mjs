import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");

assert.match(html, /data-action="map-guided-tours">Guided tours…</, "The Map menu must expose Guided Tours directly.");
assert.match(ui, /case "map-guided-tours":[\s\S]*?#openGuidedTours\(\)/, "The direct Map menu route must open the existing Guided Tours workflow.");
assert.match(ui, /#openGuidedTours\(\)[\s\S]*?template: "atlas"[\s\S]*?chapters: Array\.isArray\(current\.chapters\)/, "Opening Guided Tours directly must preserve existing chapters.");
const app = await readFile(new URL("../js/app.js", import.meta.url), "utf8");

assert.match(html, /id="atlas-tour-exit"[^>]*aria-label="Exit tour"/, "The chapter overlay must expose an Exit tour control.");
assert.match(html, /GISMap Online Guided Places/, "The mobile chapter heading must carry the Guided Places brand.");
assert.match(html, /data-mobile-atlas-control[^>]*>Control tour</, "Mobile Atlas must provide a dedicated tour control.");
assert.match(html, /data-mobile-atlas-settings[^>]*>Presentation settings</, "Mobile Atlas must provide presentation settings.");
assert.match(ui, /#exitAtlasTour\(\)[\s\S]*template:\s*"standard"/, "Exiting a tour must restore the standard workspace.");
assert.match(ui, /template === "standard"[\s\S]*#syncPresentationMobileControls\(presentation\)/, "Restoring Standard mode must immediately remove mobile tour controls.");
assert.match(ui, /title:\s*"Control tour"[\s\S]*Save locally[\s\S]*End tour/, "Tour control must offer local save and confirmed exit actions.");
assert.match(ui, /data-tour-embed-code/, "The share dialog must provide embeddable iframe HTML.");
assert.match(ui, /Tour only[\s\S]*Hide authoring menus/, "The share dialog must explain tour-only access.");
assert.match(app, /tourOnly:\s*launch\.get\("tourOnly"\) === "1"/, "Shared launches must recognize tour-only URLs.");
assert.match(app, /embed:\s*launch\.get\("embed"\) === "1"/, "Shared launches must recognize embedded URLs.");
