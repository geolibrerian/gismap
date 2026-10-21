import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { normalizeBriefing } from "../js/briefing-document.js";
import { compactBriefing, createShareLink, readShareLocation } from "../js/map-share.js";
import { combineConditions } from "../js/presentation-query.js";

const text = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const LAYER = "https://services9.arcgis.com/abc/arcgis/rest/services/Stadiums/FeatureServer/0";

test("a briefing can cut between slides; pan stays the default and is not written", () => {
  assert.equal(normalizeBriefing({ transition: "cut", slides: [] }).transition, "cut");
  for (const value of ["pan", "fade", undefined]) assert.equal("transition" in normalizeBriefing({ transition: value, slides: [] }), false, String(value));
  assert.equal(compactBriefing({ transition: "cut", slides: [] }).transition, "cut");
  assert.equal("transition" in compactBriefing({ slides: [] }), false, "older links stay the same size");
});

test("cut survives a briefing link and QR, and the player jumps instead of flying", async () => {
  const link = await createShareLink({ baseUrl: "https://gismap.online/", kind: "briefing", layers: [{ url: LAYER }], briefing: { transition: "cut", slides: [{ id: "s-1", template: "title", title: "MLB Stadiums" }] } });
  const opened = await readShareLocation(new URL(link.url));
  assert.equal(opened.briefing.transition, "cut");
  const slides = await text("js/briefing-slides.js");
  assert.match(slides, /const animate = this\.briefing\.transition !== "cut";/);
  assert.match(slides, /setView\(\{ center: slide\.camera\.center[^)]*\}, \{ animate \}\)/);
  assert.match(slides, /goToFeature\(record, \{ animate \}\)/);
  assert.match(slides, /data-slides-transition/);
  assert.match(await text("js/engines/arcgis/arcgis-engine.js"), /async goToFeature\(feature, \{ animate = true \} = \{\}\)/);
  const schema = JSON.parse(await text("schemas/briefing-v1.schema.json"));
  assert.deepEqual(schema.properties.transition.enum, ["pan", "cut"]);
});

test("filter conditions combine with AND or OR, each parenthesised", () => {
  assert.equal(combineConditions([]), null);
  assert.equal(combineConditions(["POP > 10", " "]), "POP > 10");
  assert.equal(combineConditions(["v001_numerator < 9", "STATE = 'GA'"]), "(v001_numerator < 9) AND (STATE = 'GA')");
  assert.equal(combineConditions(["STATE = 'GA'", "STATE = 'AL'"], "OR"), "(STATE = 'GA') OR (STATE = 'AL')");
});

test("the filter dialog builds several conditions; Map Insight pins the tabs, not the title", async () => {
  const ui = await text("js/ui.js");
  // The layer filter dialog uses the shared builder and compiles through filter-sql.
  assert.match(ui, /host: this\.dialog\.querySelector\("\[data-layer-filter-builder\]"\)/);
  assert.match(ui, /const expression = conditionsToWhere\(conditions, logic, fields\)/);
  assert.match(ui, /this\.filterConditions\.set\(uid, \{ conditions, logic, expression \}\)/);
  const css = await text("css/app.css");
  assert.doesNotMatch(css, /\.insights-overlay > header \{ position: sticky/);
  assert.match(css, /#insights-content > \.insight-tabs \{ position: sticky; top: 0;/);
});

test("filter values: coded domains by name, distinct service values sorted, a sample when distinct fails", async () => {
  const { ArcGISEngine: MapController } = await import("../js/engines/arcgis/arcgis-engine.js");
  const map = new MapController({ publish() {} });
  const queries = [];
  const layer = (fields, queryFeatures) => ({ fields, createQuery: () => ({}), queryFeatures: async (query) => { queries.push(query); return queryFeatures(query); } });
  const ranked = layer([{ name: "county_ranked", type: "small-integer", domain: { type: "coded-value", codedValues: [{ code: 1, name: "Yes" }, { code: 0, name: "No" }] } }], () => ({ features: [] }));
  assert.deepEqual(await map.distinctValues(ranked, "county_ranked"), { values: [{ value: 1, label: "Yes" }, { value: 0, label: "No" }], complete: true });
  assert.equal(queries.length, 0, "a domain needs no query");
  const states = layer([{ name: "STATE", type: "string" }], () => ({ features: ["GA", "AL", null, "GA", ""].map((STATE) => ({ attributes: { STATE } })) }));
  assert.deepEqual(await map.distinctValues(states, "STATE"), { values: [{ value: "AL", label: "AL" }, { value: "GA", label: "GA" }], complete: true });
  assert.equal(queries.at(-1).returnDistinctValues, true);
  assert.equal(queries.at(-1).where, "1=1", "values from every feature, not just the current filter");
  const many = layer([{ name: "n", type: "integer" }], () => ({ features: [10, 2, 33, 4].map((n) => ({ attributes: { n } })) }));
  assert.deepEqual(await map.distinctValues(many, "n", { limit: 3 }), { values: [2, 4, 10].map((value) => ({ value, label: String(value) })), complete: false });
  const noDistinct = layer([{ name: "kind", type: "string" }], (query) => { if (query.returnDistinctValues) throw new Error("not supported"); return { features: [{ attributes: { kind: "b" } }, { attributes: { kind: "a" } }] }; });
  assert.deepEqual((await map.distinctValues(noDistinct, "kind")).values.map((item) => item.value), ["a", "b"]);
  assert.deepEqual(await map.distinctValues(layer([{ name: "when", type: "date" }], () => ({ features: [] })), "when"), { values: [], complete: true });
  const ui = await text("js/ui.js");
  // Values reach the shared builder as a type-to-search list labelled with domain names and counts.
  const builder = await text("js/filter-builder.js");
  assert.match(builder, /list="fb-\$\{id\}-values-\$\{index\}"/);
  assert.match(builder, /label="\$\{escapeHtml\(label\)\}"/);
  assert.match(ui, /this\.mapController\.distinctValues\(layer, name\)/);
});
