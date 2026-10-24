import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("mobile uses a persistent GISMap Online nameplate instead of the inactive logo", () => {
  assert.match(html, /<header class="mobile-map-brand"[^>]*aria-label="GISMap Online"/);
  assert.doesNotMatch(html, /<img class="mobile-map-brand"/);
  assert.match(css, /\.mobile-map-brand \{[\s\S]*position: fixed;[\s\S]*height: calc\(34px \+ env\(safe-area-inset-top\)\)/);
});

test("mobile main menu fills the usable screen below the nameplate", () => {
  assert.match(css, /\.mobile-menu-drawer:not\(\[hidden\]\) \{[\s\S]*top: calc\(34px \+ env\(safe-area-inset-top\)\);[\s\S]*bottom: calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /\.map-workspace \{ position:absolute; inset:calc\(34px \+ env\(safe-area-inset-top\)\) 0 0;/);
  assert.match(ui, /mobile-menu-drawer__header/);
  assert.match(ui, /mobile-menu-close/);
});

test("phones reach Field notes, their location and the map tools menu", () => {
  const router = fs.readFileSync(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const fieldwork = fs.readFileSync(new URL("../css/fieldwork.css", import.meta.url), "utf8");
  // Field notes is on the More screen, and the phone menu drops desktop Map notes.
  assert.match(router, /<button data-open-field-notes><strong>Field notes<\/strong>/);
  assert.match(router, /if \(button\.matches\("\[data-open-field-notes\]"\)\) \{ this\.navigate\("map"\); return this\.openFieldNotes\?\.\(\); \}/);
  assert.match(ui, /mobileMenu\.querySelectorAll\('\[data-action="mode-data-map-notes"\]'\)\.forEach\(\(item\) => item\.remove\(\)\);/);
  // Opening notes from the menu leaves a full-screen workflow (Field tasks) instead of hiding under it.
  assert.match(ui, /case "mode-map-notes":\s*this\.#leaveMobileWorkflowScreen\(\);\s*openMapNotesPanel\(this\);/);
  // Field tasks can use the device's location.
  assert.match(router, /<button type="button" data-capture-task-gps>Use my location<\/button>/);
  assert.match(router, /async #captureTaskGps\(button\) \{[\s\S]*?locateUser\(\{ move: false \}\)/);
  // A GPS button sits in the map controls, outside the Camera & map tools menu.
  assert.match(html, /<button type="button" data-nav="locate" class="map-nav__locate"/);
  // The tools menu escapes the scrolling, blurred control column on phones.
  assert.match(fieldwork, /\.map-nav:has\(\.map-camera-menu\[open\]\) \{ overflow: visible; -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
  assert.match(fieldwork, /\.map-camera-menu__content \{ position: fixed;/);
});
