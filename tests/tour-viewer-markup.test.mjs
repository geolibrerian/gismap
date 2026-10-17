import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");

assert.doesNotMatch(html, /data-action="map-guided-tours"/, "The simplified Map menu must not duplicate the Tours workflow.");
assert.match(html, /data-action="map-presentation">Instant presentations…</, "The Modes menu must expose the quick presentation picker.");
const picker = ui.slice(ui.indexOf("  #presentationDialog()"), ui.indexOf("  #openGuidedTours()"));
assert.doesNotMatch(picker, /data-presentation-template|presentation-title|presentation-primary/, "The skin picker must not change the mode, title, or layer.");
assert.match(picker, /applyInterfaceSkin\(skin\.value\)/, "Choosing a skin previews it without changing the mode.");
assert.match(picker, /patchPresentation\(\{ skin \}\)/, "Applying a skin persists only the appearance.");
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
