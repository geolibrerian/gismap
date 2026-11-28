import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { countryPointLookup } from "../js/infographics/country-points.js";
import { beverageFixtureRecipe, beverageFixtureRows } from "../js/infographics/flow-fixtures.js";
import { buildFlowMapModel } from "../js/infographics/flow-map.js";
import { flowReportFileStem, flowReportPdf, flowReportSections } from "../js/infographics/flow-map-pdf.js";
import { INTERFACE_SKINS, normalizeSkin, skinTone } from "../js/skin-catalog.js";
import { PRINT_PALETTES, printPalette } from "../js/pdf-document.js";

const lookup = countryPointLookup();
const model = (recipe = {}) => buildFlowMapModel(beverageFixtureRows(), { ...beverageFixtureRecipe(), ...recipe }, { lookup });
const generatedAt = new Date("2026-11-27T18:30:00Z");

test("the report lists every resolved flow, drawn or not, with shares of all valid weight", () => {
  const sections = flowReportSections(model({ design: { topN: 5, hiddenCategories: ["tea"] } }), { generatedAt });
  assert.equal(sections.flows.length, 30, "hidden and below-Top-N flows stay in the table");
  assert.deepEqual(sections.flows[0], ["1", "Côte d'Ivoire", "Netherlands", "cocoa", "560", "2", "11.9%", "Drawn"]);
  assert.equal(sections.flows.filter((row) => row[7] === "Drawn").length, 5);
  assert.ok(sections.flows.some((row) => row[3] === "tea" && row[7] === "Category hidden"));
  assert.ok(sections.flows.some((row) => row[3] !== "tea" && row[7] === "Below Top N"));
  const shares = sections.flows.reduce((total, row) => total + Number(row[6].replace("%", "")), 0);
  assert.ok(Math.abs(shares - 100) < 0.5, "shares add up to all valid weight");
});

test("the report keeps excluded rows with their reasons and states provenance", () => {
  const sections = flowReportSections(model(), { boundaryCredit: "Boundaries: test", generatedAt });
  assert.deepEqual(sections.diagnostics.map((row) => row[1]), ["Weight is zero", "Origin ID not found in the lookup"]);
  assert.deepEqual(sections.diagnostics[1].slice(2), ["SCG", "Netherlands", "12"]);
  const facts = Object.fromEntries(sections.facts);
  assert.equal(facts.Scope, "All records - Complete");
  assert.equal(facts.Period, "2024");
  assert.equal(facts.Unit, "kt");
  assert.match(facts.Endpoints, /exporter_iso3.*importer_iso3.*country-points v1/);
  assert.match(facts["Excluded rows"], /^1, carrying 12 kt$/);
  assert.equal(facts["Zero-weight rows"], "1");
  assert.match(facts.Map, /Equal Earth.*Boundaries: test/);
  assert.match(facts.Source, /Illustrative demo data/);
  assert.equal(facts.Generated, "2026-11-27 18:30 UTC");
  assert.ok(sections.notes[0].startsWith("(1) Côte d'Ivoire → Netherlands (cocoa): Two shipment records"));
  assert.ok(sections.method.some((paragraph) => /starts at zero/.test(paragraph)));
});

test("the PDF carries the graphic page, both tables and the provenance page", async () => {
  const graphic = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), width: 2400, height: 1350 };
  const blob = flowReportPdf(model(), { graphic, skin: "trade-desk", boundaryCredit: "Boundaries: test", generatedAt });
  assert.equal(blob.type, "application/pdf");
  const text = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  assert.ok(text.startsWith("%PDF-1.4"));
  assert.match(text, /\(FLOW REPORT\)/);
  assert.match(text, /\(All resolved flows \\\(30\\\)\)/);
  assert.match(text, /\(Excluded rows \\\(2\\\)\)/);
  assert.match(text, /\(Provenance and method\)/);
  assert.match(text, /\(Cote d'Ivoire\)/, "accents are made PDF-safe");
  assert.match(text, /\/Subtype \/Image \/Width 2400 \/Height 1350/);
  assert.match(text, /MediaBox \[0 0 792 612\]/, "a wide graphic gets a landscape page");
  const pages = Number(text.match(/\/Type \/Pages .*\/Count (\d+)/)[1]);
  assert.ok(pages >= 3);
  assert.match(text, new RegExp(`page ${pages} of ${pages}`));
  const portrait = Buffer.from(await flowReportPdf(model({ design: { layout: "portrait" } }), { graphic: { ...graphic, width: 2160, height: 2700 }, generatedAt }).arrayBuffer()).toString("latin1");
  assert.match(portrait, /MediaBox \[0 0 612 792\]/, "a portrait graphic gets a portrait first page");
  const noGraphic = Buffer.from(await flowReportPdf(model(), { generatedAt }).arrayBuffer()).toString("latin1");
  assert.match(noGraphic, /the tables that follow are complete/);
  assert.equal(flowReportFileStem("Bean to cup: where beverage crops travel"), "bean-to-cup-where-beverage-crops-travel-flow-report");
});

test("Trade Desk is a complete light skin with a print palette and both renderings", () => {
  assert.ok(INTERFACE_SKINS.some((skin) => skin.id === "trade-desk" && skin.label === "Trade Desk"));
  assert.equal(normalizeSkin("trade-desk"), "trade-desk");
  assert.equal(skinTone("trade-desk"), "light");
  assert.equal(printPalette("trade-desk"), PRINT_PALETTES["trade-desk"]);
  const app = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const fieldwork = fs.readFileSync(new URL("../css/fieldwork.css", import.meta.url), "utf8");
  assert.match(app, /:root\[data-skin="trade-desk"\] \{[^}]*--paper:#f6f3ec/);
  assert.match(app, /\.skin-card--trade-desk \{/);
  assert.match(fieldwork, /:root\[data-skin="trade-desk"\]\[data-theme="dark"\] \{/);
  const schema = JSON.parse(fs.readFileSync(new URL("../schemas/map-v1.schema.json", import.meta.url), "utf8"));
  assert.ok(JSON.stringify(schema).includes('"trade-desk"'));
});
