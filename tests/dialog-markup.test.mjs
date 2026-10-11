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
assert.match(ui, /QRCode\.toCanvas\(qrCanvas, url/, "Tour QR cards must encode the complete URL in the browser.");
