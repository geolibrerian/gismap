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
  assert.match(source, /const layers = this\.applySlideLayers\(slide, record\)\.catch/, "layers change alongside the camera move, not after it");
  assert.match(source, /: \[\];\n    await this\.restoreLayers\(\);/, "the PDF puts the layers back after capturing the maps");
});

test("Features offers to add the included features as slides, in the same double-wide workspace as Slides", async () => {
  const { BriefingSlides } = await import("../js/briefing-slides.js");
  const records = [1, 2, 3].map((id) => ({ attributes: { OBJECTID: id, NAME: `Park ${id}` } }));
  let saved = { slides: [{ id: "s-1", template: "feature", featureId: "2", title: "Park 2" }] };
  const slides = new BriefingSlides({
    getBriefing: () => saved,
    saveBriefing: (briefing) => { saved = briefing; },
    notify() {},
    data: () => ({ layer: { objectIdField: "OBJECTID" }, records, visibleRecords: records, selectedIds: new Set(["1", "2"]), useAll: false, fields: { fields: [] }, label: (record) => record.attributes.NAME }),
    mapController: { getOperationalLayers: () => [] },
  });
  assert.deepEqual(slides.pendingIncluded().map((record) => record.attributes.OBJECTID), [1], "features that already have a slide are not offered again");
  assert.equal(slides.addIncluded(), 1);
  assert.deepEqual(saved.slides.map((slide) => slide.title), ["Park 2", "Park 1"]);
  assert.equal(slides.pendingIncluded().length, 0);
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /data-include-slides>Add \$\{pendingSlides\.toLocaleString\(\)\} included feature/);
  assert.match(ui, /if \(!this\.briefingSlides\.addIncluded\(\)\) return;/);
  assert.match(ui, /document\.body\.classList\.toggle\("briefing-features-tab", !slidesTab/);
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /body\.briefing-features-tab:not\(\.presentation-workspace-panels-open\) #app\[data-presentation="briefing"\] \{ --sidebar:clamp\(720px,58vw,980px\); \}/);
  assert.match(css, /\.mode-dashboard--briefing > \.briefing-records-fold \{ grid-column:2;/);
});

test("slides leave IDs and geometry measurements out of their facts by default", async () => {
  const { isRoutineField } = await import("../js/briefing-document.js");
  const { generateBriefing } = await import("../js/briefing-generator.js");
  const { BriefingSlides } = await import("../js/briefing-slides.js");
  for (const name of ["OBJECTID", "OBJECTID_1", "FID", "GlobalID", "Shape", "Shape__Area", "Shape__Length", "SHAPE_Leng", "Shape_Area", "st_area(shape)", "PERIMETER"]) assert.equal(isRoutineField(name), true, name);
  for (const name of ["DIV_NAME", "AREA_SQMI", "POPULATION", "LENGTH_MI", "STATE"]) assert.equal(isRoutineField(name), false, name);
  assert.equal(isRoutineField({ name: "ROW_KEY", type: "esriFieldTypeOID" }), true, "by type");
  assert.equal(isRoutineField({ name: "PARCEL_GUID", type: "esriFieldTypeGUID" }), true);
  assert.equal(isRoutineField("CASE_NO", { idField: "CASE_NO" }), true);

  // A Philadelphia division, as the service returns it.
  const record = { attributes: { OBJECTID: 1, PERIMETER: 61234.5, DIV_NAME: "CPD", SHAPE_Leng: 61234.5, Shape__Area: 0.0011, Shape__Length: 0.21 } };
  const fields = Object.keys(record.attributes).map((name) => ({ name, type: name === "OBJECTID" ? "esriFieldTypeOID" : name === "DIV_NAME" ? "esriFieldTypeString" : "esriFieldTypeDouble" }));
  let saved = { slides: [] };
  const slides = new BriefingSlides({
    getBriefing: () => saved,
    saveBriefing: (briefing) => { saved = briefing; },
    notify() {},
    data: () => ({ layer: { objectIdField: "OBJECTID" }, records: [record], visibleRecords: [record], selectedIds: new Set(["1"]), useAll: false, fields: { fields }, label: (item) => item.attributes.DIV_NAME }),
    mapController: { getOperationalLayers: () => [] },
  });
  slides.addIncluded();
  assert.deepEqual(saved.slides[0].blocks.find((block) => block.type === "facts").fields, ["DIV_NAME"]);
  const generated = generateBriefing({ layerTitle: "Police Divisions", records: [record], fields, idField: "OBJECTID", selectedIds: ["1"], label: (item) => item.attributes.DIV_NAME });
  const facts = generated.slides.find((slide) => slide.template === "feature").blocks.find((block) => block.type === "facts").fields;
  assert.deepEqual(facts, ["DIV_NAME"]);
});
