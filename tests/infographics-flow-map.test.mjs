import test from "node:test";
import assert from "node:assert/strict";
import { COUNTRY_POINTS, countryPointLookup, pointLayerLookup } from "../js/infographics/country-points.js";
import { BEVERAGE_FIXTURE_FIELDS, beverageFixtureRecipe, beverageFixtureRows } from "../js/infographics/flow-fixtures.js";
import { FLOW_MAP_MAX_LINKS, buildFlowMapModel, endpointExtent, flowGeometry, normalizeFlowRecipe, pointInExtent, rankFlows, resolveFlows, splitAtAntimeridian, suggestFlowBindings, validateFlowRecipe, widthScale } from "../js/infographics/flow-map.js";
import { arrowhead, escapeXml, formatValue, offsetPolyline, projectFlow, renderFlowMapSvg } from "../js/infographics/flow-map-svg.js";

const lookup = countryPointLookup();
const fixtureRecipe = () => normalizeFlowRecipe(beverageFixtureRecipe());
const coordinateRecipe = () => {
  const recipe = beverageFixtureRecipe();
  return normalizeFlowRecipe({ ...recipe, bindings: { ...recipe.bindings, mode: "coordinates", lookup: null } });
};
// A plain equirectangular projection into the map box, for tests without d3.
const plainGeo = { credit: "Test boundaries", create: (box) => ({ project: ([lon, lat]) => [box.x + ((lon + 180) / 360) * box.width, box.y + ((90 - lat) / 180) * box.height], sphere: null, land: null, borders: null }) };

test("binding suggestions find origin, destination, weight, category and period by name and type", () => {
  const suggested = suggestFlowBindings(BEVERAGE_FIXTURE_FIELDS);
  assert.equal(suggested.mode, "ids");
  assert.equal(suggested.origin.idField, "exporter_iso3");
  assert.equal(suggested.destination.idField, "importer_iso3");
  assert.equal(suggested.weight.field, "net_weight_kt");
  assert.equal(suggested.categoryField, "commodity");
  assert.equal(suggested.periodField, "year");
  assert.equal(suggested.origin.lonField, "origin_lon");
  assert.equal(suggested.destination.latField, "destination_lat");
  assert.equal(suggested.weight.unit, "", "the unit is always the author's explicit choice");
});

test("a recipe needs an explicit unit and complete bindings for its mode", () => {
  const missingUnit = normalizeFlowRecipe({ ...beverageFixtureRecipe(), bindings: { ...beverageFixtureRecipe().bindings, weight: { field: "net_weight_kt", unit: "" } } });
  assert.ok(validateFlowRecipe(missingUnit).errors.some((error) => error.path === "bindings.weight.unit"));
  const coordinates = normalizeFlowRecipe({ bindings: { mode: "coordinates", origin: { lonField: "a" }, weight: { field: "w", unit: "t" } } });
  assert.deepEqual(validateFlowRecipe(coordinates).errors.map((error) => error.path), ["bindings.origin", "bindings.destination"]);
  assert.equal(validateFlowRecipe(fixtureRecipe()).valid, true);
  const unknown = { ...fixtureRecipe(), schemaVersion: 9 };
  assert.equal(validateFlowRecipe(unknown).valid, false);
});

test("duplicate pairs sum, reverse pairs stay distinct and categories stay apart", () => {
  const result = resolveFlows(beverageFixtureRows(), fixtureRecipe(), { lookup });
  const byKey = new Map(result.flows.map((flow) => [flow.key, flow]));
  assert.equal(byKey.get("CIV>NLD|cocoa").weight, 560);
  assert.equal(byKey.get("CIV>NLD|cocoa").rowCount, 2);
  assert.equal(byKey.get("DEU>USA|coffee").weight, 40);
  assert.equal(byKey.get("USA>DEU|coffee").weight, 15);
  assert.equal(byKey.get("DEU>USA|coffee").hasReverse, true);
  assert.equal(byKey.get("BRA>USA|coffee").hasReverse, false);
  assert.deepEqual(result.categories.map((category) => category.name), ["coffee", "cocoa", "tea"]);
});

test("unresolved IDs, zeros, nulls and negatives follow distinct, visible rules", () => {
  const rows = [
    ...beverageFixtureRows(),
    { commodity: "tea", exporter_iso3: "KEN", importer_iso3: "GBR", net_weight_kt: null, year: 2024 },
    { commodity: "tea", exporter_iso3: "KEN", importer_iso3: "GBR", net_weight_kt: -5, year: 2024 },
    { commodity: "tea", exporter_iso3: "KEN", importer_iso3: "GBR", net_weight_kt: "n/a", year: 2024 },
    { commodity: "tea", exporter_iso3: "KEN", importer_iso3: "KEN", net_weight_kt: 9, year: 2024 },
    { commodity: "tea", exporter_iso3: " ken ", importer_iso3: "gbr", net_weight_kt: "5", year: 2024 },
  ];
  const result = resolveFlows(rows, fixtureRecipe(), { lookup });
  const reasons = result.summary.byReason;
  assert.equal(reasons["unmatched-origin"], 1, "the retired SCG code is reported, not guessed");
  assert.equal(reasons["zero-weight"], 1);
  assert.equal(reasons["missing-weight"], 1);
  assert.equal(reasons["negative-weight"], 1);
  assert.equal(reasons["invalid-weight"], 1);
  assert.equal(reasons["same-location"], 1);
  assert.equal(result.summary.zeroRows, 1);
  assert.equal(result.summary.excludedRows, 5, "zero rows are counted apart from excluded rows");
  assert.equal(result.summary.excludedWeightComplete, false, "a missing weight makes the excluded total a lower bound");
  assert.equal(result.flows.find((flow) => flow.key === "KEN>GBR|tea").weight, 80, "IDs normalise case and whitespace; numeric strings count");
  assert.ok(!result.flows.some((flow) => flow.key.startsWith("SCG")));
  const unmatched = result.diagnostics.find((row) => row.reason === "unmatched-origin");
  assert.equal(unmatched.origin, "SCG");
  assert.equal(unmatched.weight, 12);
});

test("both binding modes resolve the same fixture to the same drawable flows", () => {
  const ids = resolveFlows(beverageFixtureRows(), fixtureRecipe(), { lookup });
  const coordinates = resolveFlows(beverageFixtureRows(), coordinateRecipe());
  assert.equal(coordinates.blocking, null);
  assert.equal(coordinates.flows.length, ids.flows.length);
  assert.equal(coordinates.summary.validWeight, ids.summary.validWeight);
  assert.equal(coordinates.summary.byReason["missing-origin"], 1, "the unresolved row has empty coordinates");
  assert.equal(coordinates.flows[0].origin.lon, COUNTRY_POINTS.get("CIV").lon);
});

test("coordinate mode rejects out-of-range WGS84 values", () => {
  const recipe = normalizeFlowRecipe({ bindings: { mode: "coordinates", origin: { lonField: "ox", latField: "oy" }, destination: { lonField: "dx", latField: "dy" }, weight: { field: "w", unit: "trips" } } });
  const result = resolveFlows([{ ox: 500000, oy: 4000000, dx: 1, dy: 1, w: 3 }, { ox: 0, oy: 0, dx: 10, dy: 10, w: 3 }], recipe);
  assert.equal(result.summary.byReason["invalid-origin-coordinates"], 1);
  assert.equal(result.flows.length, 1);
});

test("several periods require a choice or an explicit aggregate", () => {
  const rows = beverageFixtureRows().concat(beverageFixtureRows().map((row) => ({ ...row, year: 2023, net_weight_kt: row.net_weight_kt / 2 })));
  const blocked = resolveFlows(rows, fixtureRecipe(), { lookup });
  assert.equal(blocked.blocking.code, "choose-period");
  assert.deepEqual(blocked.periods, ["2023", "2024"]);
  const chosen = resolveFlows(rows, normalizeFlowRecipe({ ...beverageFixtureRecipe(), query: { period: 2024 } }), { lookup });
  assert.equal(chosen.flows.find((flow) => flow.key === "BRA>USA|coffee").weight, 520);
  assert.equal(chosen.summary.byReason["outside-period"], 33);
  assert.equal(chosen.summary.outOfScopeRows, 33);
  assert.equal(chosen.summary.excludedRows, 1, "only the unresolved code is excluded; other periods are out of scope");
  const summed = resolveFlows(rows, normalizeFlowRecipe({ ...beverageFixtureRecipe(), query: { aggregatePeriods: true } }), { lookup });
  assert.equal(summed.flows.find((flow) => flow.key === "BRA>USA|coffee").weight, 780);
});

test("ranking breaks ties by stable key, caps at 100 links and discloses its share", () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ ox: -100 + index, oy: 10, dx: 50, dy: 20, w: index < 2 ? 7 : 1 }));
  const recipe = normalizeFlowRecipe({ bindings: { mode: "coordinates", origin: { lonField: "ox", latField: "oy" }, destination: { lonField: "dx", latField: "dy" }, weight: { field: "w", unit: "t" } }, design: { topN: 500 } });
  assert.equal(recipe.design.topN, FLOW_MAP_MAX_LINKS);
  const resolved = resolveFlows(rows, recipe);
  const ranking = rankFlows(resolved, { topN: recipe.design.topN });
  assert.equal(ranking.displayedCount, 100);
  assert.equal(ranking.resolvedCount, 150);
  assert.ok(ranking.displayed[0].key < ranking.displayed[1].key, "equal weights order by key");
  assert.equal(ranking.displayedShare, (14 + 98) / (14 + 148));
  assert.equal(rankFlows(resolved, { topN: 30, complete: false }).displayedShare, null, "no share without a complete denominator");
});

test("the width scale is zero-based and does not change when categories are hidden", () => {
  const resolved = resolveFlows(beverageFixtureRows(), fixtureRecipe(), { lookup });
  const scale = widthScale(resolved, { maxWidth: 20 });
  assert.equal(scale(0), 0);
  assert.equal(scale(560), 20);
  assert.equal(scale(280), 10);
  assert.ok(scale.legend.every((step) => step.value <= 560));
  const hidden = buildFlowMapModel(beverageFixtureRows(), { ...beverageFixtureRecipe(), design: { hiddenCategories: ["cocoa"] } }, { lookup, maxWidth: 20 });
  assert.equal(hidden.scale(560), 20, "hiding cocoa keeps the cocoa-driven domain");
  assert.ok(hidden.ranking.displayed.every((flow) => flow.category !== "cocoa"));
  assert.equal(hidden.ranking.resolvedCount, 30, "hidden categories stay in the denominator");
  assert.equal(hidden.ranking.displayedCount, 22);
  assert.equal(hidden.ranking.displayedShare, 3170 / 4700);
  const { svg } = renderFlowMapSvg(hidden, { geo: plainGeo });
  assert.ok(svg.includes("Showing 22 of 30 flows · 67% of valid weight · Hidden: cocoa"));
});

test("an Aleutians-to-Asia link splits at the seam with direction on the destination segment", () => {
  const flow = { origin: { lon: -175, lat: 52 }, destination: { lon: 140, lat: 36 } };
  const geometry = flowGeometry(flow);
  assert.equal(geometry.crossesAntimeridian, true);
  assert.equal(geometry.segments.length, 2);
  const [first, second] = geometry.segments;
  assert.equal(first[first.length - 1][0], -180);
  assert.equal(second[0][0], 180);
  assert.equal(first[first.length - 1][1], second[0][1], "both sides meet at the same latitude");
  assert.deepEqual(second[second.length - 1], [140, 36]);
  assert.equal(geometry.directionSegment, 1);
  // The fixture's Pacific crossing (Vietnam to the United States) splits too.
  const vietnam = resolveFlows(beverageFixtureRows(), fixtureRecipe(), { lookup }).flows.find((item) => item.key === "VNM>USA|coffee");
  assert.equal(flowGeometry(vietnam).crossesAntimeridian, true);
  assert.equal(splitAtAntimeridian([[10, 0], [20, 0]]).length, 1);
});

test("zoom extent and map-extent scope handle the antimeridian", () => {
  const extent = endpointExtent([{ lon: 170, lat: -40 }, { lon: -170, lat: 60 }]);
  assert.equal(extent.crossesAntimeridian, true);
  assert.equal(extent.xmin, 168);
  assert.equal(extent.xmax, -168);
  assert.equal(pointInExtent({ lon: 179, lat: 0 }, extent), true);
  assert.equal(pointInExtent({ lon: 0, lat: 0 }, extent), false);
  const europe = { xmin: -10, ymin: 35, xmax: 30, ymax: 60 };
  const scoped = resolveFlows(beverageFixtureRows(), fixtureRecipe(), { lookup, extent: europe });
  assert.ok(scoped.flows.every((flow) => pointInExtent(flow.origin, europe) || pointInExtent(flow.destination, europe)));
  assert.ok(!scoped.flows.some((flow) => flow.key === "BRA>USA|coffee"));
  assert.ok(scoped.flows.some((flow) => flow.key === "BRA>DEU|coffee"), "either endpoint inside qualifies");
});

test("point-layer lookups report ambiguous keys instead of picking one", () => {
  const layerLookup = pointLayerLookup([{ key: "A", lon: 0, lat: 0 }, { key: "B", lon: 1, lat: 1 }, { key: "B", lon: 2, lat: 2 }, { key: "C", lon: 3, lat: 3 }]);
  const recipe = normalizeFlowRecipe({ bindings: { mode: "ids", origin: { idField: "o" }, destination: { idField: "d" }, lookup: { id: "point-layer" }, weight: { field: "w", unit: "trips" } } });
  const result = resolveFlows([{ o: "A", d: "B", w: 1 }, { o: "A", d: "C", w: 2 }], recipe, { lookup: layerLookup });
  assert.equal(result.summary.byReason["ambiguous-destination"], 1);
  assert.equal(result.flows.length, 1);
});

test("opposing offsets separate reciprocal flows and the arrowhead tip sits on the destination", () => {
  const east = offsetPolyline([[0, 0], [10, 0]], 2);
  const west = offsetPolyline([[10, 0], [0, 0]], 2);
  assert.equal(east[0][1], 2);
  assert.equal(west[0][1], -2);
  const { line, head } = arrowhead([[0, 0], [10, 0], [20, 0]], 5, 3);
  assert.deepEqual(head[0], [20, 0]);
  assert.deepEqual(line[line.length - 1], [15, 0]);
  // A link shorter than its full arrowhead keeps a shaft and a smaller head.
  const short = arrowhead([[0, 0], [10, 0]], 32, 15);
  assert.ok(short.head, "short links keep their direction cue");
  assert.equal(short.line.length, 2);
  assert.ok(Math.abs(short.line[1][0] - 5.5) < 1e-9, "the head takes at most 45% of the line");
  // Neighbouring countries on the world view still draw with an arrowhead.
  const neighbours = projectFlow({ origin: { lon: 4.5, lat: 50.6 }, destination: { lon: 5.3, lat: 52.1 } }, ([lon, lat]) => [(lon + 180) * 2, (90 - lat) * 2], { width: 18 });
  assert.equal(neighbours.segments.length, 1);
  assert.ok(neighbours.segments[0].head && neighbours.segments[0].line.length >= 2);
  // A destination just past the seam keeps the head on its short final segment.
  const fiji = projectFlow({ origin: { lon: 174.9, lat: -40.9 }, destination: { lon: -179.5, lat: -17.7 } }, ([lon, lat]) => [(lon + 180) * 2, (90 - lat) * 2], { width: 6 });
  assert.equal(fiji.crossesAntimeridian, true);
  assert.ok(fiji.segments[fiji.segments.length - 1].head, "direction stays on the destination segment");
});

test("the SVG composition carries labels, legend, units, scope, attribution and escapes text", () => {
  const recipe = { ...beverageFixtureRecipe(), title: "Trade <script>alert(1)</script> & more", annotations: [{ anchor: { type: "flow", key: "CIV>NLD|cocoa" }, text: "Note with \"quotes\" <b>" }, { anchor: { type: "flow", key: "XXX>YYY" }, text: "Gone" }] };
  const model = buildFlowMapModel(beverageFixtureRows(), recipe, { lookup });
  assert.deepEqual(model.annotations.map((note) => note.status), ["shown", "outside-result"]);
  for (const layout of ["wide", "square", "portrait"]) {
    const { svg, width, height } = renderFlowMapSvg({ ...model, recipe: { ...model.recipe, design: { ...model.recipe.design, layout } } }, { geo: plainGeo, selectedKey: "DEU>USA|coffee", generatedAt: new Date("2026-11-27T00:00:00Z") });
    assert.ok(width > 0 && height > 0);
    assert.ok(!svg.includes("<script"), `${layout}: no raw script`);
    assert.ok(svg.includes("Trade &lt;script&gt;alert(1)&lt;/script&gt; &amp; more"));
    assert.ok(svg.includes("Note with &quot;quotes&quot; &lt;b&gt;"));
    assert.ok(svg.includes("Showing 30 of 30 flows · 100% of valid weight"), `${layout}: count disclosure`);
    assert.ok(svg.includes("All records · Complete"));
    assert.ok(svg.includes("Units: kt"));
    assert.ok(svg.includes("Connections are schematic"));
    assert.ok(svg.includes("Test boundaries"));
    assert.ok(svg.includes("Country points: GISMap Online country-points v1"));
    assert.ok(svg.includes("Illustrative demo data"));
    assert.ok(svg.includes("1 row excluded (12 kt)"));
    assert.ok(svg.includes('class="flow is-selected" data-flow-key="DEU&gt;USA|coffee"'));
    assert.ok(svg.includes("<title") && svg.includes("<desc"));
    assert.ok(svg.includes("WIDTH · KT"));
    assert.ok(svg.includes("Côte d&#39;Ivoire → Netherlands"));
    assert.ok(!/href=|@import|url\((?!#)/.test(svg), `${layout}: no external references`);
    assert.ok(svg.indexOf('class="flow is-selected"') > svg.indexOf('class="flow" data-flow-key="CIV&gt;NLD|cocoa"'), "the selection draws on top");
  }
});

test("formatting keeps zeros and missing values distinct", () => {
  assert.equal(formatValue(0, "t"), "0 t");
  assert.equal(formatValue(null, "t"), "—");
  assert.equal(formatValue(1234.5, "t"), "1,235 t");
  assert.equal(formatValue(2.25, "t"), "2.3 t");
  assert.equal(formatValue(4_200_000, "trips"), "4.2M trips");
  assert.equal(escapeXml(`<a href="x">'&`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;");
});
