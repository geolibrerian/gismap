import assert from "node:assert/strict";
import test from "node:test";
import { AUTHORED_SECTIONS, LOCATION_REPORT_SECTIONS, automaticLimitations, featuresAtPlace, buildLocationReportPdf, locationReportFileName, locationReportPrompt, normalizeLocationReport, parseReportMarkdown } from "../js/location-report.js";
import { validateMapSpec } from "../js/map-spec.js";
import { pdfSafeText } from "../js/pdf-document.js";

test("a report has fixed sections, each written by the app, the AI or both", () => {
  assert.deepEqual(LOCATION_REPORT_SECTIONS.map((section) => section.id), ["summary", "location", "observations", "inferences", "context", "limitations", "nextSteps", "sources", "map"]);
  assert.deepEqual(AUTHORED_SECTIONS, ["summary", "observations", "inferences", "context", "limitations", "nextSteps"]);
  for (const section of LOCATION_REPORT_SECTIONS) assert.ok(section.guidance.length > 20, section.id);
  const prompt = locationReportPrompt({ question: "Is this a growing area?" });
  for (const id of AUTHORED_SECTIONS) assert.ok(prompt.includes(`## ${LOCATION_REPORT_SECTIONS.find((section) => section.id === id).title}`), id);
  assert.match(prompt, /represents_sum/, "explains that a density of points is not a count of people");
  assert.match(prompt, /No offers, questions or chat/);
});

test("authored reports are checked: app sections, bad places and confidences are left out with a reason", () => {
  const { report, issues } = normalizeLocationReport({
    title: "Oxnard plain", at: [-119.18, 34.2], author: "Agent",
    sections: {
      summary: "Dense housing meets farmland.",
      inferences: [{ statement: "Growth presses on farmland.", basis: ["Population per H3 cell", "Farmland"], confidence: "Medium" }, "Plain text works too.", { statement: "x", confidence: "certain" }],
      limitations: "One caveat",
      sources: ["ignored"],
      weather: "ignored",
    },
  });
  assert.deepEqual(report.at, [-119.18, 34.2]);
  assert.equal(report.sections.summary, "Dense housing meets farmland.");
  assert.deepEqual(report.sections.inferences[0], { statement: "Growth presses on farmland.", basis: ["Population per H3 cell", "Farmland"], confidence: "medium" });
  assert.deepEqual(report.sections.inferences[1], { statement: "Plain text works too." });
  assert.deepEqual(report.sections.limitations, ["One caveat"]);
  assert.equal(report.sections.sources, undefined, "the app writes Sources");
  assert.deepEqual(issues.map((item) => item.path), ["sections.inferences[2].confidence", "sections.sources", "sections.weather"]);
  assert.equal(normalizeLocationReport({ at: [200, 0] }).issues[0].path, "at");
});

test("an AI answer is read into sections, and its closing chat offer is dropped", () => {
  const answer = [
    "## Summary", "Two **sparse** cells near Oxnard.", "",
    "### Key Observations & Patterns", "- Both cells hold one dot each (Basis: Population per H3 cell; Confidence: high)", "- Farmland surrounds them — Confidence: low",
    "**Useful Geographic Context**", "The Oxnard Plain is farmed coastal lowland.", "---",
    "## Important Limitations", "* Counts are dots, not people", "",
    "Would you like me to:", "- Cross-reference other layers?",
  ].join("\n");
  const { sections } = parseReportMarkdown(answer);
  assert.equal(sections.summary, "Two sparse cells near Oxnard.");
  assert.deepEqual(sections.inferences, [
    { statement: "Both cells hold one dot each", basis: ["Population per H3 cell"], confidence: "high" },
    { statement: "Farmland surrounds them", confidence: "low" },
  ]);
  assert.equal(sections.context, "The Oxnard Plain is farmed coastal lowland.");
  assert.deepEqual(sections.limitations, ["Counts are dots, not people"]);
  assert.equal(JSON.stringify(sections).includes("Cross-reference"), false);
  assert.deepEqual(parseReportMarkdown("Just one paragraph.").sections, { summary: "Just one paragraph." });
});

test("the PDF has the sections in order, links back to the map, and prints symbols as text", async () => {
  const blob = buildLocationReportPdf({
    report: { author: "AI (test)", sections: { summary: "About 34.1° north, ≈ 7,260 people 🙂.", inferences: [{ statement: "Dense core.", basis: ["Cells"], confidence: "high" }], context: "Coastal plain.", nextSteps: ["Add farmland."] } },
    place: { longitude: -119.12, latitude: 34.14, address: "East Hueneme Road, Ventura County", geographies: [{ label: "Census tract", value: "47.15" }] },
    features: [{ layerTitle: "Population per H3 cell", attributes: { h3_id: "8829124c47fffff", represents_sum: 7260, density_km2: 1.2233, _internal: 1 } }],
    layers: [{ title: "Population per H3 cell", url: "https://example.org/cells", truncated: true }, { title: "Blocks", url: null, note: "Hidden on the map, so not read at the place." }],
    links: { map: "https://gismap.online/#map=json:%7B%7D", place: "https://gismap.online/#at=34.14,-119.12" },
  });
  const text = Buffer.from(await blob.arrayBuffer()).toString("latin1");
  const order = ["(Summary)", "(Location)", "(What the map data shows)", "(Inferences from the layers together)", "(Geographic context)", "(Limitations)", "(Suggested next steps)", "(Sources)", "(Map)"].map((heading) => text.indexOf(heading));
  assert.ok(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1])), `sections in order: ${order}`);
  assert.match(text, /34\.1 deg north, ~ 7,260 people \./, "degrees and approximations survive; emoji are dropped");
  assert.match(text, /represents_sum: 7,260/);
  assert.doesNotMatch(text, /_internal/, "internal fields stay out");
  assert.match(text, /Basis: Cells - Confidence: high/);
  assert.match(text, /the map holds only part of this layer/, "the app adds its own caveats");
  assert.match(text, /\(Blocks\) Tj[\s\S]*Hidden on the map, so not read at the place\./, "hidden layers are still listed as sources");
  assert.match(text, /\/URI \(https:\/\/gismap\.online\/#map=json:%7B%7D\)/, "links open the whole map");
  assert.match(text, /Analysis by AI \\\(test\\\)/);
});

test("in a tilted view only features that contain the place are reported, not tall neighbours", () => {
  const square = (x, y) => ({ type: "Polygon", coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1], [x, y]]] });
  const hits = [
    { layerTitle: "Cells", attributes: { id: "here" }, geometry: square(0, 0) },
    { layerTitle: "Cells", attributes: { id: "neighbour" }, geometry: square(1, 0) },
    { layerTitle: "Wells", attributes: { id: "point" }, geometry: { type: "Point", coordinates: [0.5, 0.5] } },
    { layerTitle: "Parcels", attributes: { id: "arcgis" }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]], spatialReference: { wkid: 4326 } } },
    { layerTitle: "Donut", attributes: { id: "hole" }, geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]], [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75], [0.25, 0.25]]] } },
  ];
  assert.deepEqual(featuresAtPlace(hits, [0.5, 0.5]).map((hit) => hit.attributes.id), ["here", "point", "arcgis"]);
  const mercator = { layerTitle: "Tracts", attributes: { id: "web" }, geometry: { rings: [[[-13300000, 4000000], [-13300000, 4100000], [-13200000, 4100000], [-13200000, 4000000], [-13300000, 4000000]]], spatialReference: { wkid: 102100 } } };
  assert.equal(featuresAtPlace([mercator], [-119.177, 34.197]).length, 1, "Web Mercator rings are compared in metres");
  assert.deepEqual(featuresAtPlace([hits[1]], [0.5, 0.5]), [hits[1]], "with no containing polygon the hits are kept");
});

test("app caveats, file names and safe PDF text", () => {
  assert.deepEqual(automaticLimitations({ features: [], layers: [{ title: "Codes", sentinels: [{ value: -1, label: "Not disclosed" }] }] }), [
    "No map feature was found at this place; the report rests on the location alone.",
    "Codes: some values are codes (such as -1 = Not disclosed), not measurements.",
  ]);
  assert.match(automaticLimitations({ features: [{}], partialLink: true })[0], /does not carry layers made in the browser/);
  assert.equal(locationReportFileName({ address: "East Hueneme Road, Ventura County" }), "location-intelligence-report-east-hueneme-road-ventura-county.pdf");
  assert.equal(pdfSafeText("Café ⚠️ 5 × 2 → ±1…"), "Cafe  5 x 2 -> +/-1...");
});

test("a map link can carry a location report; it is checked like the rest of the spec", () => {
  const base = { version: 1, layers: [{ url: "https://example.org/arcgis/rest/services/A/FeatureServer/0" }] };
  const { spec, issues } = validateMapSpec({ ...base, report: { type: "location", at: [-119.18, 34.2], title: "Oxnard", sections: { summary: "Dense core.", map: "ignored" } } });
  assert.deepEqual(spec.report, { type: "location", version: 1, title: "Oxnard", at: [-119.18, 34.2], sections: { summary: "Dense core." } });
  assert.deepEqual(issues.map((item) => item.path), ["report.sections.map"]);
  const missing = validateMapSpec({ ...base, report: { sections: { summary: "No place" } } });
  assert.equal(missing.spec.report, undefined);
  assert.equal(missing.issues[0].path, "report.at");
});
