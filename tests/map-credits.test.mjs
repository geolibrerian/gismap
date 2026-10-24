import test from "node:test";
import assert from "node:assert/strict";
import { hostCredit, joinCredits, legendSwatch, plainAttribution } from "../js/engines/map-credits.js";
import { drawClipComposition } from "../js/cinematic/clip-export.js";

test("map credits read as one plain line without duplicates", () => {
  assert.equal(plainAttribution('<a href="https://openmaptiles.org/">&copy; OpenMapTiles</a> Data from <a href="#">OpenStreetMap</a>'), "© OpenMapTiles Data from OpenStreetMap");
  assert.equal(hostCredit("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_week.geojson"), "Data: earthquake.usgs.gov");
  assert.equal(hostCredit("blob:local"), "");
  assert.equal(joinCredits(["© Mapterhorn | OpenFreeMap", "openfreemap", "", "Data: earthquake.usgs.gov"]), "© Mapterhorn | OpenFreeMap | Data: earthquake.usgs.gov");
  assert.deepEqual(legendSwatch({ label: "4.6 – 5.5", geometry: "point", paint: { circle: "#d6402b", stroke: "#fff", radius: 9 } }), { label: "4.6 – 5.5", geometry: "point", fill: "#d6402b", stroke: "#fff", radius: 9 });
  assert.equal(legendSwatch({ geometry: "polygon", paint: { fill: "#0a0" } }).fill, "#0a0");
});

function recordingContext() {
  const texts = [];
  const noop = () => {};
  return {
    texts,
    font: "", fillStyle: "", strokeStyle: "", lineWidth: 1, lineCap: "",
    measureText: (text) => ({ width: String(text).length * 7 }),
    fillText: (text, x, y) => texts.push({ text, x, y }),
    fillRect: noop, drawImage: noop, beginPath: noop, arc: noop, fill: noop, stroke: noop, moveTo: noop, lineTo: noop, arcTo: noop, closePath: noop, save: noop, restore: noop,
  };
}

test("movie frames carry the real credit, the Clip layers' legend and an effect disclaimer", () => {
  const context = recordingContext();
  const legend = [{ uid: "q", title: "Earthquakes", field: "mag", entries: [{ label: "2.5 – 3.7", geometry: "point", fill: "#f0a" }, { label: "3.7 – 7.7", geometry: "point", fill: "#a00" }] }];
  drawClipComposition(context, { width: 1280, height: 720 }, { width: 1280, height: 720, title: "Quakes", caption: "Activity spreads south", attributionText: "© Mapterhorn | OpenFreeMap | Data: earthquake.usgs.gov", legend, effectNote: "Seismic pulse: decorative, not data" });
  const shown = context.texts.map((item) => item.text);
  for (const text of ["Quakes", "Earthquakes", "MAG", "2.5 – 3.7", "3.7 – 7.7", "Seismic pulse: decorative, not data", "Activity spreads south", "© Mapterhorn | OpenFreeMap | Data: earthquake.usgs.gov"]) assert.ok(shown.includes(text), text);
  // A credit too long for the frame is shortened with an ellipsis, never dropped.
  const narrow = recordingContext();
  drawClipComposition(narrow, { width: 640, height: 360 }, { width: 640, height: 360, title: "Q", attributionText: "x".repeat(400) });
  const credit = narrow.texts.at(-1).text;
  assert.ok(credit.endsWith("…") && credit.length < 400);
});
