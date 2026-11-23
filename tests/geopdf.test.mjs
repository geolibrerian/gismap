import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildLocationReportPdf } from "../js/location-report.js";
import { PdfDocument, geoExtent, geoViewport } from "../js/pdf-document.js";

const pdfText = async (pdf) => Buffer.from(await (pdf.toBlob ? pdf.toBlob() : pdf).arrayBuffer()).toString("latin1");
const numbers = (text) => text.trim().split(/\s+/).map(Number);
const viewports = (text) => [...text.matchAll(/\/Type \/Viewport \/BBox \[([^\]]+)\][\s\S]*?\/GPTS \[([^\]]+)\] \/LPTS \[([^\]]+)\]/g)]
  .map(([, box, gpts, lpts]) => ({ box: numbers(box), gpts: numbers(gpts), lpts: numbers(lpts) }));

// Reads a viewport the way a GIS reader does: GPTS projected to Web Mercator, fitted to LPTS in the BBox.
const mercatorY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
function pageToLonLat({ box, gpts, lpts }, [px, py]) {
  const [x1, y1, x2, y2] = box;
  const u = (px - x1) / (x2 - x1);
  const v = (py - y1) / (y2 - y1);
  const corner = (index) => ({ u: lpts[index * 2], v: lpts[index * 2 + 1], lat: gpts[index * 2], lon: gpts[index * 2 + 1] });
  const [lowerLeft, , upperRight] = [0, 1, 2].map(corner);
  assert.deepEqual([lowerLeft.u, lowerLeft.v, upperRight.u, upperRight.v], [0, 0, 1, 1]);
  const lon = lowerLeft.lon + u * (upperRight.lon - lowerLeft.lon);
  const y = mercatorY(lowerLeft.lat) + v * (mercatorY(upperRight.lat) - mercatorY(lowerLeft.lat));
  return [lon, (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * (180 / Math.PI)];
}

test("only a north-up extent a Web Mercator map can show georeferences a page", () => {
  assert.deepEqual(geoExtent({ west: -119.3, south: 34.1, east: -119.1, north: 34.3 }), { west: -119.3, south: 34.1, east: -119.1, north: 34.3 });
  assert.deepEqual(geoExtent({ west: 179, south: -18, east: -179, north: -16 }), { west: 179, south: -18, east: 181, north: -16 }, "across the antimeridian");
  assert.equal(geoExtent(null), null);
  assert.equal(geoExtent({ west: -119.3, south: 34.3, east: -119.1, north: 34.1 }), null, "south above north");
  assert.equal(geoExtent({ west: 0, south: 80, east: 10, north: 89 }), null, "beyond Web Mercator");
  assert.equal(geoExtent({ west: Number.NaN, south: 0, east: 1, north: 1 }), null);
  assert.equal(geoViewport({ x: 0, y: 0, width: 0, height: 10 }, { west: 0, south: 0, east: 1, north: 1 }), null);
});

test("a georeferenced page carries an ISO 32000 geospatial viewport in EPSG:3857", async () => {
  const pdf = new PdfDocument({ heading: "MAP", header: false, homeUrl: null });
  const extent = { west: -119.3, south: 34.1, east: -119.1, north: 34.3 };
  assert.equal(pdf.georeference({ x: 36, y: 72, width: 720, height: 480 }, extent, { name: "Oxnard (west)" }), true);
  assert.equal(pdf.georeference({ x: 0, y: 0, width: 10, height: 10 }, null), false);
  const text = await pdfText(pdf);
  assert.match(text, /^%PDF-1\.7\n/);
  assert.match(text, /\/Extensions << \/ADBE << \/BaseVersion \/1\.7 \/ExtensionLevel 3 >> >>/);
  assert.match(text, /\/Measure << \/Type \/Measure \/Subtype \/GEO \/Bounds \[0 0 0 1 1 1 1 0\]/);
  assert.match(text, /\/GCS << \/Type \/PROJCS \/EPSG 3857 \/WKT \(PROJCS\["WGS 84 \/ Pseudo-Mercator"[^)]*AUTHORITY\["EPSG","3857"\]\]\)/);
  assert.match(text, /\/Name \(Oxnard \\\(west\\\)\)/, "the name is a safe PDF string");
  const [viewport] = viewports(text);
  assert.deepEqual(viewport.box, [36, 72, 756, 552]);
  assert.deepEqual(viewport.gpts, [34.1, -119.3, 34.3, -119.3, 34.3, -119.1, 34.1, -119.1], "latitude, longitude at each corner");
  const [lon, lat] = pageToLonLat(viewport, [396, 312]);
  assert.ok(Math.abs(lon - -119.2) < 1e-9);
  assert.ok(Math.abs(lat - 34.2) < 0.001 && lat > 34.2, `the middle of the page is the Mercator middle, a little north of 34.2 (${lat})`);
});

test("a PDF without a map extent stays a plain PDF 1.4", async () => {
  const text = await pdfText(new PdfDocument({ heading: "REPORT" }));
  assert.match(text, /^%PDF-1\.4\n/);
  assert.doesNotMatch(text, /\/VP |\/Extensions/);
});

test("a framed map image georeferences only the map inside its frame", async () => {
  const pdf = new PdfDocument({ heading: "MAP", header: false, homeUrl: null, pageWidth: 792, pageHeight: 612 });
  // A branded frame: 1236 × 1000 with the map at (18, 118), 1200 × 818.
  const asset = { bytes: new Uint8Array([255, 216, 255, 217]), width: 1236, height: 1000, mapBox: { x: 18, y: 118, w: 1200, h: 818 } };
  const drawn = pdf.addImageAt(asset, { x: 0, y: 612, width: 618, height: 500, geo: { west: 10, south: 50, east: 11, north: 51 } });
  const scale = drawn.width / 1236;
  const [viewport] = viewports(await pdfText(pdf));
  const expected = [drawn.x + 18 * scale, drawn.y + (1000 - 118 - 818) * scale, drawn.x + 1218 * scale, drawn.y + (1000 - 118) * scale];
  viewport.box.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.01, `${viewport.box} vs ${expected}`));
});

test("the location report georeferences its map page, not its text pages", async () => {
  const mapImage = { bytes: new Uint8Array([255, 216, 255, 217]), width: 1600, height: 1000 };
  const geo = { west: -119.25, south: 34.15, east: -119.1, north: 34.25 };
  const text = await pdfText(buildLocationReportPdf({ report: { title: "Oxnard" }, place: { longitude: -119.18, latitude: 34.2 }, mapImage, geo }));
  const pages = text.split(/\/Type \/Page /).slice(1);
  assert.equal(pages.filter((page) => /\/VP \[/.test(page.split("/Contents")[0])).length, 1);
  assert.match(pages.at(-1), /\/MediaBox \[0 0 792 612\][^\n]*\/VP \[/, "the landscape map page");
  const untagged = await pdfText(buildLocationReportPdf({ report: { title: "Oxnard" }, place: { longitude: -119.18, latitude: 34.2 }, mapImage }));
  assert.doesNotMatch(untagged, /\/VP \[/, "a tilted or rotated map is not georeferenced");
});

test("the Print Editor and Map PDFs georeference their map frames", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const templates = await readFile(new URL("../js/map-templates.js", import.meta.url), "utf8");
  assert.match(templates, /return \{ canvas, links, template, geo \}/);
  const templatePdf = ui.slice(ui.indexOf("async #templatePdf("), ui.indexOf("async #bookmarkPages("));
  assert.match(templatePdf, /pdf\.georeference\(/);
  const mapPdf = ui.slice(ui.indexOf("async #mapPdfFile("), ui.indexOf("Turns a layer into a briefing"));
  assert.match(mapPdf, /#viewCrop\(1\.45\)/);
  assert.match(mapPdf, /geo: extent/);
});
