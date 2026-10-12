import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("Orbital Globe has a dedicated accessible map command bar", () => {
  assert.match(html, /id="globe-top-navigation"[^>]*aria-label="Orbital Globe map tools"/);
  for (const action of ["home", "locate", "in", "out", "rotate-left", "rotate-right", "tilt-up", "tilt-down"]) {
    assert.match(html, new RegExp(`globe-top-navigation[\\s\\S]*data-nav="${action}"`));
  }
  assert.match(html, /id="globe-dashboard-settings"/);
});

test("Globe toolbar replaces overlapping map controls only on desktop Globe layout", () => {
  assert.match(css, /@media \(min-width:881px\)[\s\S]*data-application-layout="globe"[^\n]*\.globe-top-nav/);
  assert.match(css, /data-application-layout="globe"[^\n]*:is\(\.map-nav,\.dashboard-settings-open\)/);
  assert.match(ui, /#globe-dashboard-settings/);
});
