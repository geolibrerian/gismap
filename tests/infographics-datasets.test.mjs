import test from "node:test";
import assert from "node:assert/strict";
import { countryPointLookup } from "../js/infographics/country-points.js";
import { addUserTable, demoTables, inferColumnType, isTableSource, readTableFile, readTableUrl, tableById, tableFromCells, tableFromJson, tableFromText, userTables } from "../js/infographics/flow-datasets.js";
import { LOCAL_ROW_LIMIT, buildFlowMapModel, flowGeometry, normalizeFlowRecipe, suggestFlowBindings } from "../js/infographics/flow-map.js";

const lookup = countryPointLookup();

test("column types: numbers, integers, and codes that keep their leading zeros", () => {
  assert.equal(inferColumnType(["1", "2", "", "30"]), "integer");
  assert.equal(inferColumnType(["1.5", "2", "-3e2"]), "double");
  assert.equal(inferColumnType(["BRA", "USA"]), "string");
  assert.equal(inferColumnType(["004", "076"]), "string", "ISO numeric codes stay text");
  assert.equal(inferColumnType(["0", "0.5"]), "double");
  assert.equal(inferColumnType(["", " "]), "string");
});

test("a CSV of country-code flows becomes a typed table that renders", () => {
  const csv = "exporter,importer,product,tonnes,year\nBRA,USA,coffee,520,2024\nBRA,DEU,coffee,480,2024\nVNM,USA,coffee,,2024\nKEN,GBR,tea,75,2024\n";
  const table = tableFromText(csv, { id: "table:test", name: "trade" });
  assert.deepEqual(table.fields.map((field) => [field.name, field.type]), [["exporter", "string"], ["importer", "string"], ["product", "string"], ["tonnes", "integer"], ["year", "integer"]]);
  assert.equal(table.rows[2].tonnes, null, "an empty cell is missing, never zero");
  const suggested = suggestFlowBindings(table.fields);
  assert.equal(suggested.origin.idField, "exporter");
  assert.equal(suggested.destination.idField, "importer");
  assert.equal(suggested.weight.field, "tonnes");
  assert.equal(suggested.categoryField, "product");
  const model = buildFlowMapModel(table.rows, { bindings: { ...suggested, lookup: { id: "country-points", revision: "v1" }, weight: { field: "tonnes", unit: "t" } } }, { lookup });
  assert.equal(model.resolved.flows.length, 3);
  assert.equal(model.resolved.summary.byReason["missing-weight"], 1);
});

test("headers are made unique and blank headers are named", () => {
  const table = tableFromCells({ headers: ["a", "a", ""], rows: [["1", "2", "x"]] });
  assert.deepEqual(table.fields.map((field) => field.name), ["a", "a_2", "Column 3"]);
});

test("JSON arrays, wrapped rows and GeoJSON properties are tables", () => {
  const array = tableFromJson([{ from: "BRA", to: "USA", w: 5 }, { from: "VNM", to: "DEU", w: 2.5, note: { x: 1 } }]);
  assert.deepEqual(array.fields.map((field) => field.type), ["string", "string", "double", "string"]);
  assert.equal(array.rows[1].note, '{"x":1}');
  assert.equal(tableFromJson({ data: [{ a: 1 }] }).rows[0].a, 1);
  const geo = tableFromText(JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { o: "A", d: "B", n: 3 }, geometry: null }] }));
  assert.deepEqual(geo.rows, [{ o: "A", d: "B", n: 3 }]);
  assert.throws(() => tableFromJson({ hello: "world" }), /not a table/);
  assert.throws(() => tableFromText("only a header\n"), /header row and at least one row/);
});

test("files are read by type, size-limited and capped at the local row limit", async () => {
  const file = (name, text, size = text.length) => ({ name, size, lastModified: 1, text: async () => text });
  const csv = await readTableFile(file("flows.csv", "o,d,w\nBRA,USA,1\n"));
  assert.equal(csv.name, "flows");
  assert.equal(csv.kind, "file");
  assert.ok(isTableSource(csv.id));
  const json = await readTableFile(file("flows.geojson", JSON.stringify({ type: "FeatureCollection", features: [{ properties: { o: "A" } }] })));
  assert.equal(json.rows.length, 1);
  await assert.rejects(readTableFile(file("huge.csv", "", 40 * 1024 * 1024)), /limit is 30 MB/);
  await assert.rejects(readTableFile(file("map.shp", "")), /not a table/);
  const big = `o,d,w\n${Array.from({ length: LOCAL_ROW_LIMIT + 5 }, () => "BRA,USA,1").join("\n")}`;
  const capped = await readTableFile(file("big.csv", big));
  assert.equal(capped.rows.length, LOCAL_ROW_LIMIT);
  assert.equal(capped.truncated, true);
  assert.equal(capped.totalRows, LOCAL_ROW_LIMIT + 5);
});

test("links read CSV or JSON, and Google Sheets go through their CSV export", async () => {
  const requested = [];
  const fetchText = async (address) => { requested.push(address); return "o,d,w\nBRA,USA,1\n"; };
  const sheet = await readTableUrl("https://docs.google.com/spreadsheets/d/abc123/edit#gid=7", { fetchText });
  assert.equal(requested[0], "https://docs.google.com/spreadsheets/d/abc123/gviz/tq?tqx=out:csv&gid=7");
  assert.equal(sheet.name, "Google Sheet");
  const csv = await readTableUrl("https://example.org/data/trade%20flows.csv", { fetchText });
  assert.equal(csv.name, "trade flows");
  assert.equal(csv.kind, "url");
  await assert.rejects(readTableUrl("not a link", { fetchText }), /full link/);
  await assert.rejects(readTableUrl("ftp://example.org/a.csv", { fetchText }), /http and https/);
});

test("added tables are listed newest first and found by id", () => {
  const first = addUserTable(tableFromText("a,b\n1,2", { id: "table:one", name: "one" }));
  addUserTable(tableFromText("a,b\n1,2", { id: "table:two", name: "two" }));
  assert.deepEqual(userTables().slice(0, 2).map((table) => table.name), ["two", "one"]);
  assert.equal(tableById("table:one"), first);
});

test("the three demos render: country codes, coordinates in a region, and two periods across the Pacific", () => {
  const demos = demoTables();
  assert.deepEqual(demos.map((table) => table.id), ["fixture:beverage-trade", "demo:randstad-commutes", "demo:pacific-air"]);
  for (const table of demos) {
    assert.ok(/illustrative/i.test(table.name) && /not real/i.test(table.credit), `${table.id} is labelled illustrative`);
    const model = buildFlowMapModel(table.rows, normalizeFlowRecipe(table.recipe), { lookup });
    assert.equal(model.resolved.blocking, null, `${table.id} renders`);
    assert.ok(model.ranking.displayedCount > 10);
  }
  const commutes = buildFlowMapModel(demos[1].rows, demos[1].recipe, { lookup });
  assert.equal(commutes.resolved.flows.find((flow) => flow.key === "Almere>Amsterdam|rail").weight, 21000);
  assert.equal(commutes.annotations[0].status, "shown");
  assert.equal(commutes.recipe.design.projection, "regional");
  const pacific = demos[2];
  const all = buildFlowMapModel(pacific.rows, { ...pacific.recipe, query: {} }, { lookup });
  assert.equal(all.resolved.blocking.code, "choose-period", "two years ask for a choice");
  const chosen = buildFlowMapModel(pacific.rows, pacific.recipe, { lookup });
  const tokyo = chosen.resolved.flows.find((flow) => flow.key === "Los Angeles>Tokyo");
  assert.equal(tokyo.weight, 1900);
  assert.equal(flowGeometry(tokyo).crossesAntimeridian, true);
});
