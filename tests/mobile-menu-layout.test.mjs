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
