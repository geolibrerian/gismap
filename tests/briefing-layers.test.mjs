import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DISTANCE_UNITS, SPATIAL_RELATIONSHIPS, normalizeBriefing } from "../js/briefing-document.js";
import { createShareLink, readShareLocation } from "../js/map-share.js";

const STADIUMS = "https://services.arcgis.com/x/arcgis/rest/services/Stadiums/FeatureServer/0";
const PARKING = "https://services.arcgis.com/x/arcgis/rest/services/Parking/FeatureServer/0";
const TRANSIT = "https://services.arcgis.com/x/arcgis/rest/services/Transit/MapServer";

test("slides list other layers with a visibility and an optional REST spatial relationship", () => {
  const [slide] = normalizeBriefing({ slides: [{ id: "s-1", template: "feature", layers: [
    { layer: PARKING, relation: { type: "intersects", distance: 2, units: "miles" } },
    { layer: TRANSIT, visible: false },
    { layer: PARKING, visible: false },
    { layer: "https://x/ugly", relation: { type: "relation", relationParameter: "nope" } },
    { layer: "https://x/de9im", relation: { type: "relation", relationParameter: "t********" } },
    { layer: "https://x/odd", relation: { type: "near", distance: -5 } },
    { layer: "" },
  ] }] }).slides;
  assert.deepEqual(slide.layers, [
    { layer: PARKING, visible: true, relation: { type: "intersects", distance: 2, units: "miles" } },
    { layer: TRANSIT, visible: false },
    { layer: "https://x/ugly", visible: true },
    { layer: "https://x/de9im", visible: true, relation: { type: "relation", relationParameter: "T********" } },
    { layer: "https://x/odd", visible: true },
  ]);
  assert.equal("layers" in normalizeBriefing({ slides: [{ id: "s-2" }] }).slides[0], false, "slides that never set layers change none");
});

test("the schema and the document agree on relationships and units, and links carry slide layers", async () => {
  const schema = JSON.parse(await readFile(new URL("../schemas/briefing-v1.schema.json", import.meta.url), "utf8"));
  const relation = schema.$defs.slide.properties.layers.items.properties.relation.properties;
  assert.deepEqual(relation.type.enum, [...SPATIAL_RELATIONSHIPS]);
  assert.deepEqual(relation.units.enum, [...DISTANCE_UNITS]);
  const link = await createShareLink({ baseUrl: "https://gismap.online/", kind: "briefing", layers: [{ url: STADIUMS }, { url: PARKING }], briefing: { slides: [{ id: "s-1", template: "feature", featureId: "7", layers: [{ layer: PARKING, relation: { type: "within" } }] }] } });
  const opened = await readShareLocation(new URL(link.url));
  assert.deepEqual(opened.briefing.slides[0].layers, [{ layer: PARKING, visible: true, relation: { type: "within" } }]);
});

test("a slide shows its layers, asks each service which features relate, and the presentation puts them back", async () => {
  const { BriefingSlides } = await import("../js/briefing-slides.js");
  const filters = new Map();
  const queries = [];
  const layer = (uid, url, { visible = true, queryable = true } = {}) => ({
    uid, title: uid, url, visible, definitionExpression: uid === "parking" ? "SPACES > 10" : null,
    ...(queryable ? { queryObjectIds: async (query) => { queries.push({ uid, ...query }); return uid === "parking" ? [4, 8] : []; } } : {}),
  });
  const stadiums = layer("stadiums", STADIUMS);
  const parking = layer("parking", PARKING, { visible: false });
  const transit = layer("transit", TRANSIT, { queryable: false });
  const geometry = { type: "polygon", rings: [] };
  const record = { attributes: { OBJECTID: 7 }, geometry };
  const notes = [];
  const slides = new BriefingSlides({
    getBriefing: () => ({}),
    saveBriefing() {},
    notify: (message) => notes.push(message),
    data: () => ({ layer: stadiums, records: [record], fields: { fields: [] } }),
    mapController: {
      getOperationalLayers: () => [stadiums, parking, transit],
      getLayerConfig: (item) => ({ url: item.url }),
      view: { whenLayerView: async (item) => ({ set filter(value) { filters.set(item.uid, value); }, get filter() { return filters.get(item.uid) ?? null; } }) },
    },
  });
  assert.deepEqual(slides.otherLayers().map((item) => item.layer.uid), ["parking", "transit"], "the main layer is not an other layer");

  const slide = { id: "s-1", layers: [
    { layer: PARKING, visible: true, relation: { type: "intersects", distance: 2, units: "miles" } },
    { layer: TRANSIT, visible: false, relation: { type: "within" } },
  ] };
  await slides.applySlideLayers(slide, record);
  assert.equal(parking.visible, true);
  assert.equal(transit.visible, false);
  assert.deepEqual(queries, [{ uid: "parking", where: "SPACES > 10", geometry, spatialRelationship: "intersects", distance: 2, units: "miles" }], "hidden layers are not queried; the layer's own filter still applies");
  assert.deepEqual(filters.get("parking"), { objectIds: [4, 8] });

  // A slide that sets nothing returns the layers to how the map had them.
  await slides.applySlideLayers({ id: "s-2" }, record);
  assert.equal(parking.visible, false);
  assert.equal(transit.visible, true);
  assert.equal(filters.get("parking"), null);

  // No related features draws none, not all; the presentation's end restores everything.
  queries.length = 0;
  await slides.applySlideLayers({ id: "s-3", layers: [{ layer: "transit", visible: true }, { layer: PARKING, visible: true, relation: { type: "relation", relationParameter: "T********" } }] }, record);
  assert.equal(queries[0].relationParameter, "T********");
  parking.queryObjectIds = async () => [];
  await slides.applySlideLayers({ id: "s-4", layers: [{ layer: PARKING, visible: true, relation: { type: "contains" } }] }, record);
  assert.deepEqual(filters.get("parking"), { objectIds: [-1] });
  await slides.restoreLayers();
  assert.equal(parking.visible, false);
  assert.equal(filters.get("parking"), null);
  assert.equal(slides.layerState, null);

  // Without a feature, relationships are skipped and the layer simply shows.
  await slides.applySlideLayers({ id: "s-5", layers: [{ layer: PARKING, visible: true, relation: { type: "intersects" } }] }, null);
  assert.equal(parking.visible, true);
  assert.equal(filters.has("parking") ? filters.get("parking") : null, null);
  assert.deepEqual(notes, []);
});

test("the slide editor offers every relationship and the player restores layers when it closes", async () => {
  const source = await readFile(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
  assert.match(source, /Other layers <small>/);
  assert.match(source, /SPATIAL_RELATIONSHIPS\.map\(\(type\) => `<option value="\$\{type\}"/);
  assert.match(source, /onClose: \(\) => void this\.restoreLayers\(\)/);
  assert.match(source, /await this\.applySlideLayers\(slide, record\);/);
  assert.match(source, /: \[\];\n    await this\.restoreLayers\(\);/, "the PDF puts the layers back after capturing the maps");
});
