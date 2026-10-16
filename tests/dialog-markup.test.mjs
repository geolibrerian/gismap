import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");

assert.match(
  html,
  /<button class="icon-button" value="cancel" formnovalidate aria-label="Close">/,
  "The shared dialog close control must bypass validation.",
);
assert.doesNotMatch(
  ui,
  /id="server-directory-url"[^>]*\srequired(?:\s|>)/,
  "The optional GIS Server Directory field must not block dialog dismissal.",
);
assert.match(html, /data-utility-pane="dialog"/, "Docked dialogs need a real workspace-panel host.");
assert.match(ui, /#utility-dialog-content/, "The dialog dock action must target the workspace panel host.");
assert.ok(ui.indexOf('class="atlas-geocoder"') < ui.indexOf('id="atlas-editor-title"'), "The chapter geocoder must appear before the title field.");
assert.match(ui, /id="atlas-chapter-transition"/, "Chapter authoring must expose camera transition speed.");
assert.match(ui, /#atlas-use-current-view[^\n]*#syncAtlasEditorToCurrentView\("", true\)/, "Using the current map view must also offer its location details as the default chapter title.");
assert.match(ui, /titleInput\.value = locationDetails/, "The reverse-geocoded location must populate a generic chapter title.");
assert.match(ui, /brandedQrCanvas\(url, \{ canvas/, "Tour and workflow shares must use the shared branded QR renderer.");
assert.match(html, /\.\/js\/vendor\/qrcode-1\.5\.4\.js/, "The QR encoder must be served locally instead of depending on a third-party CDN at runtime.");
assert.match(html, /id="dashboard-settings-open"/, "Configured dashboards need one central settings entry point.");
assert.doesNotMatch(html, />Workspace panel</, "The right utility panel must not carry redundant workspace chrome.");
assert.match(ui, /Choose a dashboard view/, "Dashboard settings must offer recognizable layout choices.");
assert.equal((ui.match(/preview: "(?:left|three|briefing|atlas|operations|right)"/g) || []).length, 6, "Dashboard settings must offer six visual starting views.");
assert.match(ui, /data-builder-drag draggable="true"/, "Dashboard panel rows must expose real draggable controls.");
assert.match(ui, /addEventListener\("pointerdown"/, "Dashboard reordering must work with pointer and touch input.");
assert.match(ui, /Unavailable and planned panels/, "Non-working panels must stay in a folded section.");
