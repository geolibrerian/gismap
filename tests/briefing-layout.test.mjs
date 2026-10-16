import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const map = readFileSync(new URL("../js/map.js", import.meta.url), "utf8");
const slides = readFileSync(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../js/briefing-pdf.js", import.meta.url), "utf8");
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

test("briefing PDF maps match the live slide focus and use the branded QR card", () => {
  assert.match(map, /if \(prepare\) await prepare\(index, target\)/, "capture supports slide-specific map preparation");
  assert.match(slides, /prepare: \(index\) => this\.showSlideMap\(mapSlides\[index\]\)/, "the selected feature is highlighted before each snapshot");
  assert.match(slides, /await mapController\.highlightFeature/, "capture waits until the layer highlight exists");
  assert.match(pdf, /brandedQrImage\(link/, "the cover uses the same branded QR card as sharing");
});

test("desktop and globe map controls can collapse and reopen", () => {
  assert.match(html, /id="map-navigation-toggle"/);
  assert.match(html, /id="globe-navigation-close"/);
  assert.match(css, /\.map-nav__toggle/);
  assert.match(css, /body\.map-tools-collapsed/);
});

test("mobile map tools toggle sits in the top bar, separated from the title", () => {
  // The shell drops its stacking context so the toggle can sit in the top bar above the map.
  assert.match(css, /\.map-nav-shell \{ z-index:auto; top:8px; right:8px; justify-items:end; transform:none; \}/);
  assert.match(css, /\.map-nav__toggle,\s*body\.mobile-map-tools-open \.map-nav__toggle \{\s*position:fixed;\s*z-index:69;\s*top:calc\(4px \+ env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.map-nav__toggle::before \{ content:""; position:absolute;[^}]*left:-9px; width:1px;/);
  assert.match(css, /body:not\(\.mobile-map-route\) \.map-nav-shell \{ display:none; \}/);
});
