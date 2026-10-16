// One basemap catalog for both engines, the links and the schema; and the
// menus that pick an engine and a basemap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { BASEMAPS, BASEMAP_IDS, basemapLabel, basemapOnEngine, basemapsForEngine } from "../js/basemap-catalog.js";
import { SHARE_BASEMAPS } from "../js/share.js";
import { openBasemapFor } from "../js/engines/maplibre/basemaps.js";
import { MaplibreEngine } from "../js/engines/maplibre/maplibre-engine.js";
import { ArcGISEngine } from "../js/engines/arcgis/arcgis-engine.js";

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("every basemap has a home engine and an equivalent on the other one", () => {
  assert.equal(new Set(BASEMAP_IDS).size, BASEMAP_IDS.length, "ids are unique");
  for (const entry of BASEMAPS) {
    if (entry.engine === "any") continue;
    const other = entry.engine === "arcgis" ? "maplibre" : "arcgis";
    assert.equal(basemapsForEngine(other).some(({ id }) => id === entry[other]), true, `${entry.id} → ${entry[other]} on ${other}`);
  }
  assert.equal(basemapOnEngine("topo-3d", "maplibre"), "open-liberty");
  assert.equal(basemapOnEngine("dark-gray-vector", "maplibre"), "open-dark");
  assert.equal(basemapOnEngine("open-positron", "arcgis"), "gray-vector");
  assert.equal(basemapOnEngine("skin", "arcgis"), "skin", "skin is on both engines");
  assert.equal(basemapLabel("open-bright"), "Bright — streets");
});

test("links and the map-v1 schema accept exactly the catalogued basemaps", async () => {
  assert.deepEqual([...SHARE_BASEMAPS], [...BASEMAP_IDS]);
  const schema = JSON.parse(await read("schemas/map-v1.schema.json"));
  assert.deepEqual(schema.properties.basemap.enum, [...BASEMAP_IDS]);
  const capabilities = JSON.parse(await read("api/capabilities.json"));
  assert.deepEqual(capabilities.basemaps, [...BASEMAP_IDS]);
});

test("each engine lists only its own basemaps and selects the one it draws", () => {
  const maplibre = new MaplibreEngine({ publish() {} });
  maplibre.basemapId = "topo-3d";
  const open = maplibre.getBasemapOptions();
  assert.deepEqual(open.options.map(({ id }) => id), ["open-liberty", "open-bright", "open-positron", "open-dark", "skin"]);
  assert.equal(open.selected, "open-liberty", "an ArcGIS id from a link shows as what MapLibre draws");
  assert.equal(openBasemapFor("open-bright").key, "bright");
  assert.equal(openBasemapFor("navigation-dark-3d").key, "dark");
  const arcgis = new ArcGISEngine({ publish() {} });
  arcgis.basemapId = "open-dark";
  const esri = arcgis.getBasemapOptions();
  assert.ok(esri.options.every(({ id }) => !id.startsWith("open-")));
  assert.equal(esri.selected, "dark-gray-vector");
  arcgis.map = { basemap: null, allLayers: [] };
  arcgis.basemapId = "topo-3d";
  arcgis.setBasemap("open-positron");
  assert.deepEqual([arcgis.getBasemapId(), arcgis.map.basemap], ["open-positron", "gray-vector"], "ArcGIS draws the equivalent and keeps the id for links");
});

test("menus: Modes, map tools in Tools, settings in Project, an engine choice and dropdowns that fit the panel", async () => {
  const [html, css, ui] = await Promise.all([read("index.html"), read("css/app.css"), read("js/ui.js")]);
  const menu = (name) => html.match(new RegExp(`aria-expanded="false">${name} <span>⌄</span></button>\\s*<div class="menu__content" role="menu">([\\s\\S]*?)\\n            </div>`))[1];
  assert.doesNotMatch(html, />Workflows </);
  assert.match(menu("Modes"), /data-mobile-workflow="briefing"/);
  for (const widget of ["legend", "measurement", "elevationProfile", "compass", "basemapGallery"]) assert.match(menu("Tools"), new RegExp(`data-widget="${widget}"`), widget);
  for (const action of ["tools-display", "tools-connections", "tools-ai", "tools-custom", "tools-about"]) assert.match(menu("Project"), new RegExp(`data-action="${action}"`), action);
  assert.match(menu("Map"), /data-engine-picker/);
  assert.match(menu("Map"), /<select data-basemap-picker><\/select>/, "the basemap list comes from the engine");
  assert.match(menu("Map"), /data-requires-capability="ground"/);
  assert.doesNotMatch(menu("Map"), /data-widget=/);
  assert.match(css, /\.menu \{ position: static; \}/, "dropdowns hang from the menu bar");
  assert.match(css, /\.menu__content \{[^}]*left: 8px; right: 8px;/);
  assert.match(ui, /mobile-workflows-menu.*>Modes </s);
  assert.match(ui, /#syncMapMenu\(\)/);
});
