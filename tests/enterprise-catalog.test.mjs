import assert from "node:assert/strict";
import { normalizeArcGisDirectoryUrl } from "../js/enterprise-catalog.js";

assert.equal(
  normalizeArcGisDirectoryUrl(" https://gis.example.gov/arcgis/rest/services/?f=pjson#top "),
  "https://gis.example.gov/arcgis/rest/services",
);
assert.equal(
  normalizeArcGisDirectoryUrl("http://gis.example.gov/REST/SERVICES"),
  "http://gis.example.gov/REST/SERVICES",
);
assert.throws(
  () => normalizeArcGisDirectoryUrl("https://gis.example.gov/arcgis/rest/services/Parcels/FeatureServer"),
  /top-level ArcGIS endpoint/,
);
assert.throws(() => normalizeArcGisDirectoryUrl("not a URL"), /valid ArcGIS server directory URL/);

console.log("Enterprise catalog URL tests passed");
