import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { aiDescriptionPrompt, applyAiDescriptions, describeWhere, generateBriefing, readAiDescriptions, rendererTheme } from "../js/briefing-generator.js";
import { computeStat } from "../js/briefing-document.js";

const counties = [
  { attributes: { fid: 1, name: "Napa", crop: "Grapes", tons: 150000 } },
  { attributes: { fid: 2, name: "Sonoma", crop: "Grapes", tons: 250000 } },
  { attributes: { fid: 3, name: "Fresno", crop: "Raisins", tons: 600000 } },
  { attributes: { fid: 4, name: "Marin", crop: "Grapes", tons: 1000 } },
];
const fields = [{ name: "fid", type: "oid" }, { name: "name", alias: "County", type: "string" }, { name: "crop", alias: "Crop", type: "string" }, { name: "tons", alias: "Grape tons", type: "double" }];
const classBreaks = { type: "classBreaks", field: "tons", minValue: 0, classBreakInfos: [{ classMaxValue: 100000, label: "Under 100k" }, { classMaxValue: 1000000, label: "100k and over" }] };

test("the style says what the briefing is about", () => {
  assert.deepEqual(rendererTheme(classBreaks).classes.map((item) => [item.min, item.max]), [[0, 100000], [100000, 1000000]]);
  assert.equal(rendererTheme({ type: "uniqueValue", field1: "crop", uniqueValueInfos: [{ value: "Grapes" }] }).kind, "categories");
  assert.equal(rendererTheme({ type: "simple", visualVariables: [{ type: "sizeInfo", field: "tons" }] }).field, "tons");
  assert.equal(rendererTheme(null).kind, "none");
  assert.equal(describeWhere("tons > 1000 AND crop = 'Grapes'", (name) => ({ tons: "Grape tons", crop: "Crop" })[name]), "Grape tons over 1000 and Crop is Grapes");
  assert.equal(describeWhere("1=1"), "");
});

test("a styled, filtered layer becomes a ready briefing: title, numbers, classes, ranked features, sources", () => {
  const briefing = generateBriefing({ layerTitle: "Counties", where: "tons > 500", renderer: classBreaks, url: "https://example.org/FeatureServer/0", records: counties, fields, idField: "fid", label: (record) => record.attributes.name, camera: { center: [-120, 37], zoom: 6, heading: 0, tilt: 0 } });
  assert.deepEqual(briefing.slides.map((slide) => slide.template), ["title", "key-numbers", "map-narrative", "feature", "feature", "feature", "feature", "actions"]);
  assert.match(briefing.slides[0].subtitle, /4 Counties · Grape tons over 500/);
  assert.match(briefing.slides[0].blocks[0].markdown, /styles \*\*Counties\*\* by \*\*Grape tons\*\* in 2 classes/);
  assert.deepEqual(briefing.slides[1].blocks.map((block) => block.stat), ["count", "sum", "average", "max"]);
  assert.deepEqual(briefing.slides[2].blocks[1].items, ["Under 100k: 1 feature", "100k and over: 3 features"]);
  assert.equal(briefing.slides[3].title, "Fresno", "features are ranked by the styled number");
  assert.match(briefing.slides[3].blocks[1].markdown, /#1\*\* of 4 .*600,000.*59\.9% of the total/);
  assert.equal(briefing.slides[3].blocks[0].fields[0], "tons", "the styled field leads the facts");
  assert.equal(briefing.slides.at(-1).blocks[1].links[0].url, "https://example.org/FeatureServer/0");
});

test("chosen features and a Features-tab filter shape the generated briefing", () => {
  const scope = { op: "eq", field: "crop", value: "Grapes" };
  const grapes = counties.filter((record) => record.attributes.crop === "Grapes");
  const briefing = generateBriefing({ layerTitle: "Counties", renderer: { type: "uniqueValue", field1: "crop", uniqueValueInfos: [{ value: "Grapes", label: "Grapes" }, { value: "Raisins", label: "Raisins" }] }, records: grapes, fields, idField: "fid", selectedIds: [4], scope, scopeText: "Crop is Grapes" });
  const featureSlides = briefing.slides.filter((slide) => slide.template === "feature");
  assert.deepEqual(featureSlides.map((slide) => slide.featureId), ["4"], "chosen features replace the top-ranked ones");
  const count = briefing.slides[1].blocks[0];
  assert.equal(count.queryRef, "scope");
  assert.equal(computeStat(count, counties, { queries: briefing.queries, idField: "fid" }).value, 3, "numbers respect the filter");
  const byCrop = briefing.slides[2];
  assert.equal(byCrop.title, "By Crop");
  assert.equal(computeStat(byCrop.blocks[0], counties, { queries: briefing.queries, idField: "fid" }).value, 3);
});

test("AI descriptions are requested as JSON, read defensively and marked for review", () => {
  const briefing = generateBriefing({ layerTitle: "Counties", renderer: classBreaks, records: counties, fields, idField: "fid", label: (record) => record.attributes.name });
  const feature = briefing.slides.find((slide) => slide.template === "feature");
  const prompt = aiDescriptionPrompt({ briefing, layerTitle: "Counties", records: { [feature.id]: counties[2] } });
  assert.match(prompt, /Return JSON only/);
  assert.match(prompt, /Fresno/);
  assert.equal(readAiDescriptions("Sorry, I can't."), null);
  const descriptions = readAiDescriptions(`Here you go: {"summary": "California leads grape production.", "features": {"${feature.id}": "Fresno grows the most.", "x": 4}}`);
  assert.deepEqual(Object.keys(descriptions.features), [feature.id]);
  const described = applyAiDescriptions(briefing, descriptions);
  assert.match(described.slides[0].blocks[0].markdown, /California leads/);
  assert.match(described.slides.find((slide) => slide.id === feature.id).blocks.find((block) => block.type === "text").markdown, /Ranks.*\n\nFresno grows the most\./s);
  assert.match(described.slides[0].notes, /AI-written/);
});

test("the Features tab offers view, map, filter and group selection, and one-click briefings", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const slides = await readFile(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
  const project = await readFile(new URL("../js/project.js", import.meta.url), "utf8");
  for (const hook of ["data-select-view", "data-select-map", "data-cond-add", "data-select-group", "data-group-include", "data-include-shown", "data-generate-briefing", "briefing-share"]) assert.match(ui, new RegExp(hook));
  assert.match(ui, /#loadExtentRecords\(\)/, "in view also fetches features beyond the first page");
  assert.match(ui, /quiet: true/, "AI text goes into slides, not the Intelligence panel");
  assert.match(slides, /data-slides-generate/);
  assert.match(slides, /data-slides-ai/);
  assert.match(project, /conditions: Array\.isArray\(selection\.conditions\)/, "filters are saved with the project");
});
