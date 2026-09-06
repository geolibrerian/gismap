import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { POPULAR_SERVICES } from "../js/catalog.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("examples index is searchable and links every catalog item", async () => {
  const html = await read("examples/index.html");
  assert.match(html, /<link rel="canonical" href="https:\/\/gismap\.online\/examples\/">/);
  assert.match(html, /id="example-search"/);
  for (const item of POPULAR_SERVICES) {
    assert.match(html, new RegExp(`example=${item.slug}`));
    assert.ok(html.includes(item.title));
  }
});

test("featured examples and viewer guides contain canonical pages and map actions", async () => {
  for (const item of POPULAR_SERVICES.filter((entry) => entry.featured)) {
    const html = await read(`examples/${item.slug}/index.html`);
    assert.ok(html.includes(`https://gismap.online/examples/${item.slug}/`));
    assert.ok(html.includes(`example=${item.slug}`));
    assert.match(html, /application\/ld\+json/);
  }
  for (const slug of ["arcgis-rest-service-viewer", "arcgis-feature-service-viewer", "arcgis-map-service-viewer", "geojson-viewer", "3d-gis-viewer"]) {
    const html = await read(`${slug}/index.html`);
    assert.ok(html.includes(`https://gismap.online/${slug}/`));
    assert.match(html, /Browse examples/);
  }
  const guides = await read("guides/index.html");
  assert.match(guides, /GIS viewer guides/);
  assert.match(guides, /arcgis-feature-service-viewer/);
});
