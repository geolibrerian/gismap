import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serviceNameFromUrl } from "../js/service-name.js";

test("a layer added by URL gets a readable default name from its service", () => {
  assert.equal(serviceNameFromUrl("https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0"), "California Historic Fire Perimeters");
  assert.equal(serviceNameFromUrl("https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/USA_Wildfires_v1/FeatureServer/0/query?where=1%3D1"), "USA Wildfires v1");
  assert.equal(serviceNameFromUrl("https://gis.example.gov/arcgis/rest/services/Hydrology/Streams%20and%20Rivers/MapServer"), "Streams and Rivers", "folders are left out");
  assert.equal(serviceNameFromUrl("https://example.org/arcgis/rest/services/Elevation/ImageServer/"), "Elevation");
  assert.equal(serviceNameFromUrl("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson"), "all month");
  assert.equal(serviceNameFromUrl("https://example.org/arcgis/rest/services"), "");
  assert.equal(serviceNameFromUrl("not a url"), "");
});

test("the service dialog fills the suggested title without overwriting one typed by hand", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /serviceNameFromUrl\(urlInput\.value\)/);
  assert.match(ui, /titleInput\.value !== suggested/);
});
