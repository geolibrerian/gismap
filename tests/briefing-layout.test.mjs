import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const map = readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

test("briefing context has a map-owned host independent of the sidebar", () => {
  assert.match(html, /id="briefing-context-host"/);
  assert.match(ui, /briefing-context-host/);
  assert.match(css, /\.briefing-context-host:empty/);
  assert.match(css, /sidebar-collapsed\[data-briefing-context-dock="left"\] \.briefing-context[\s\S]*?left:0/);
});

test("briefing supports scoped feature selection and copyable representative coordinates", () => {
  assert.match(ui, /data-briefing-use-all/);
  assert.match(ui, /data-briefing-include/);
  assert.match(ui, /data-copy-briefing-coordinates/);
  assert.match(map, /representativePoint\(geometry\)/);
  assert.match(map, /geographicCoordinates\(geometry\)/);
});

test("desktop and globe map controls can collapse and reopen", () => {
  assert.match(html, /id="map-navigation-close"/);
  assert.match(html, /id="globe-navigation-close"/);
  assert.match(html, /id="map-navigation-open"/);
  assert.match(css, /body\.map-tools-collapsed/);
});
