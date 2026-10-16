import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AI_EXAMPLES, CORN_EXAMPLE_SPEC, aiExampleLinks } from "../scripts/ai-examples.mjs";
import { CORN_LINK } from "../scripts/agent-docs.mjs";
import { briefing, mapSpec } from "../js/gismap-core.js";
import { normalizeBriefing } from "../js/briefing-document.js";
import { readShareLocation } from "../js/map-share.js";

const text = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const json = async (path) => JSON.parse(await text(path));
const example = (slug) => AI_EXAMPLES.find((item) => item.slug === slug);
const links = await aiExampleLinks(text);
// Specs compare without the block IDs normalizing assigns, and regardless of key order.
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).filter((key) => !(key === "id" && /^b-/.test(value.id))).sort().map((key) => [key, canonical(value[key])]))
  : value;

test("every AI example has its files, a gismap.online link and a QR code", async () => {
  for (const item of AI_EXAMPLES) {
    assert.match(links[item.slug], /^https:\/\/gismap\.online\//, item.slug);
    for (const file of item.files) await text(`examples/ai/${item.slug}/${file.file}`);
    const png = await readFile(new URL(`../examples/ai/${item.slug}/${item.qr.file}`, import.meta.url));
    assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], `${item.slug} QR is a PNG`);
    assert.ok(item.chat.prompt.length > 100 && item.agent.code.length > 100);
  }
  const index = await text("examples/index.html");
  assert.match(index, /href="\/examples\/ai\/"/);
  assert.match(await text("llms.txt"), /## Worked examples for chatbots and agents/);
});

test("the Philadelphia link opens the tested briefing on the divisions layer, and the agent recipe rebuilds it", async () => {
  const doc = await json("examples/ai/philadelphia-police-divisions/briefing.json");
  const url = new URL(links["philadelphia-police-divisions"]);
  const layer = url.searchParams.get("layer");
  assert.equal(layer, doc.layerId);
  assert.match(layer, /Philadelphia_Crime_Map_WFL1\/FeatureServer\/1$/, "divisions (layer 1), not crime incidents (layer 0)");
  const opened = await readShareLocation(url);
  assert.equal(opened.kind, "briefing-document");
  assert.deepEqual(opened.briefing, normalizeBriefing(doc));
  assert.equal(opened.briefing.slides.length, 7);

  // The code-running recipe on the page.
  assert.equal(briefing.validate(doc).valid, true);
  const rebuilt = await briefing.createLink({ baseUrl: `https://gismap.online/?layer=${encodeURIComponent(layer)}`, briefing: doc, qrSafe: true });
  const reopened = await readShareLocation(new URL(rebuilt));
  assert.deepEqual(reopened.briefing, normalizeBriefing(doc));
  assert.match(example("philadelphia-police-divisions").agent.code, /briefing\.createLink\(\{\n  baseUrl: `https:\/\/gismap\.online\/\?layer=\$\{encodeURIComponent\(LAYER\)\}`/);
});

test("the ballparks link is the committed spec: two layers, one contains query per state, Ohio grown by a mile", async () => {
  const file = await json("examples/ai/mlb-ballparks-by-state/map.json");
  const { valid, issues, spec } = mapSpec.validate(file);
  assert.equal(valid, true, JSON.stringify(issues));
  const decoded = await mapSpec.decode(links["mlb-ballparks-by-state"].split("#map=")[1]);
  assert.deepEqual(canonical(mapSpec.validate(decoded).spec), canonical(spec));
  const [states, parks] = spec.layers.map((layer) => layer.url);
  assert.equal(spec.briefing.layerId, states);
  assert.equal(spec.briefing.transition, "cut");
  assert.equal(spec.layers[0].renderer.method, "auto");
  const stateSlides = spec.briefing.slides.filter((slide) => slide.template === "feature");
  assert.deepEqual(stateSlides.map((slide) => slide.featureId), spec.briefing.selection.ids);
  for (const slide of stateSlides) {
    const [entry] = slide.layers;
    assert.equal(entry.layer, parks);
    assert.equal(entry.relation.type, "contains");
    // Verified against the services: only Ohio needs growing; Illinois grown by a mile would take St. Louis's ballpark.
    assert.deepEqual(entry.relation.distance ? [slide.title, entry.relation.distance, entry.relation.units] : [slide.title], slide.title === "Ohio" ? ["Ohio", 1, "miles"] : [slide.title]);
  }
});

test("the corn example is the documented readable link a chat-only model can write", async () => {
  assert.equal(links["corn-sales-one-link"], CORN_LINK);
  assert.deepEqual(await json("examples/ai/corn-sales-one-link/map.json"), CORN_EXAMPLE_SPEC);
  assert.match(CORN_LINK, /#map=json:/);
  assert.equal(mapSpec.validate(CORN_EXAMPLE_SPEC).valid, true);
});
