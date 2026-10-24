import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_SLIDES,
  addSlide,
  computeStat,
  createSlide,
  duplicateSlide,
  matchesFilter,
  moveSlide,
  normalizeBriefing,
  normalizeFilter,
  removeSlide,
  safeUrl,
  updateBlock,
  updateSlide,
  validateBriefing,
} from "../js/briefing-document.js";

test("a briefing with no slides normalizes to an empty, versioned document", () => {
  const briefing = normalizeBriefing(undefined);
  assert.equal(briefing.schemaVersion, 1);
  assert.deepEqual(briefing.slides, []);
  assert.deepEqual(briefing.queries, {});
});

test("slides can be added, reordered, duplicated, hidden and removed by stable ID", () => {
  const title = createSlide("title", { title: "Oakland update" });
  const numbers = createSlide("key-numbers", { title: "At a glance" });
  let briefing = addSlide(addSlide({}, numbers), title);
  briefing = moveSlide(briefing, title.id, -10);
  assert.deepEqual(briefing.slides.map((slide) => slide.id), [title.id, numbers.id], "moves past the start stop at the start");
  briefing = duplicateSlide(briefing, numbers.id);
  assert.equal(briefing.slides.length, 3);
  assert.notEqual(briefing.slides[2].id, numbers.id);
  assert.notEqual(briefing.slides[2].blocks[0].id, numbers.blocks[0].id, "a duplicate gets its own block IDs");
  briefing = updateSlide(briefing, numbers.id, { hidden: true, title: "Numbers" });
  assert.equal(briefing.slides[1].hidden, true);
  briefing = removeSlide(briefing, title.id);
  assert.deepEqual(briefing.slides.map((slide) => slide.title), ["Numbers", "At a glance (copy)"]);
});

test("unknown fields and block types survive a round trip; unsafe content does not", () => {
  const briefing = normalizeBriefing({
    futureSetting: { keep: true },
    slides: [{ id: "s-1", template: "actions", blocks: [{ id: "b-1", type: "chart", spec: { kind: "bar" } }, { id: "b-2", type: "links", links: [{ label: "Bad", url: "javascript:alert(1)" }, { label: "Good", url: "https://example.org" }] }] }],
    queries: { ok: { op: "eq", field: "status", value: "Active" }, bad: { op: "sql", sql: "DROP TABLE" } },
  });
  assert.deepEqual(briefing.futureSetting, { keep: true });
  assert.deepEqual(briefing.slides[0].blocks[0], { id: "b-1", type: "chart", spec: { kind: "bar" } });
  assert.deepEqual(briefing.slides[0].blocks[1].links, [{ label: "Good", url: "https://example.org/" }]);
  assert.deepEqual(Object.keys(briefing.queries), ["ok"], "filters are data with known operators, never code");
  assert.equal(safeUrl("data:text/html,hi"), "");
});

test("filters evaluate against loaded records and statistics say when they are a sample", () => {
  const records = [
    { attributes: { id: 1, status: "Active", budget: 100 } },
    { attributes: { id: 2, status: "Active", budget: 300 } },
    { attributes: { id: 3, status: "Done", budget: 50 } },
  ];
  const queries = { active: normalizeFilter({ op: "and", args: [{ op: "eq", field: "status", value: "active" }, { op: "gte", field: "budget", value: 100 }] }) };
  assert.equal(matchesFilter(queries.active, records[0].attributes), true);
  assert.equal(matchesFilter(queries.active, records[2].attributes), false);
  assert.equal(matchesFilter({ op: "feature_ids", ids: ["3"] }, {}, 3), true);
  const count = computeStat({ stat: "count", queryRef: "active" }, records, { queries, total: 3 });
  assert.deepEqual([count.value, count.sample], [2, false]);
  const sum = computeStat({ stat: "sum", field: "budget", queryRef: "active" }, records, { queries, total: 1800 });
  assert.deepEqual([sum.value, sum.sample, sum.loaded], [400, true, 3]);
  assert.equal(computeStat({ stat: "average", field: "missing" }, records).value, null);
});

test("validation points at slides that need attention", () => {
  const feature = createSlide("feature", { title: "", featureId: "9" });
  const orphan = { ...createSlide("feature", { title: "Lost" }), featureId: null };
  const issues = validateBriefing({ slides: [feature, orphan] }, { featureIds: new Set(["1"]) });
  assert.ok(issues.some((issue) => issue.slideId === feature.id && /no title/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.slideId === feature.id && /not in the loaded data/.test(issue.message)));
  assert.ok(issues.some((issue) => issue.slideId === orphan.id && issue.level === "error"));
  const blocks = updateBlock({ slides: [feature] }, feature.id, feature.blocks[0].id, { fields: ["a", "b"] });
  assert.deepEqual(blocks.slides[0].blocks[0].fields, ["a", "b"]);
  assert.throws(() => addSlide({ slides: Array.from({ length: MAX_SLIDES }, () => createSlide("title")) }, createSlide("title")), /at most/);
});

test("the project keeps the briefing and the Briefing panel has a Slides tab", async () => {
  const project = await readFile(new URL("../js/project.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(project, /briefing: normalizeBriefing\(value\.briefing\)/);
  assert.match(ui, /data-briefing-tab="slides"/);
  assert.match(ui, /data-briefing-add-slide/);
});

test("the player has a 16:9 desktop stage and swipeable phone cards that never pan the map", async () => {
  const player = await readFile(new URL("../js/briefing-player.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  const fieldwork = await readFile(new URL("../css/fieldwork.css", import.meta.url), "utf8");
  assert.match(css, /\.briefing-stage__frame \{[^}]*aspect-ratio:16 \/ 9/);
  assert.match(css, /\.briefing-cards__deck \{[^}]*scroll-snap-type:y mandatory/);
  assert.match(css, /body\.briefing-exploring \.briefing-cards__deck/, "exploring hands gestures to the map");
  assert.match(fieldwork, /body\.fieldwork-desktop\.briefing-presenting #app \.map-workspace\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/, "the live map occupies the single presentation column");
  assert.match(fieldwork, /body\.briefing-presenting #app #viewDiv\s*\{[^}]*inset:\s*0/, "hidden docks do not leave the map inset");
  assert.match(player, /params\.set\("slide", slideId\)/, "slides are deep-linked by ID");
  assert.match(player, /requestFullscreen/);
  assert.match(player, /setViewPadding\(/, "the camera centres in the visible part of the map");
  assert.match(player, /Reset slide/);
  assert.match(player, /Tap the map to explore/, "mobile briefing cards use direct map-first guidance");
});

test("briefing presentation actions float above the data dock", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(ui, /dock\.prepend\(actions\)/);
  assert.match(ui, /list\.append\(\.\.\.\[scope, records\]/);
  assert.match(css, /\.briefing-data-dock__actions \{[^}]*bottom:calc\(100% \+ 12px\)/);
  assert.match(css, /\.briefing-data-dock__actions button \{[^}]*min-height:48px/);
});

test("slide types: templates convert in place, series kinds generate, planned kinds are announced", async () => {
  const { SLIDE_TYPES, slideTypeOf, convertSlide, createSlide, normalizeBriefing, addSlide } = await import("../js/briefing-document.js");
  assert.deepEqual(SLIDE_TYPES.filter((type) => type.kind === "template").map((type) => type.template), ["map-narrative", "title", "key-numbers", "actions", "media", "cinematic"]);
  assert.deepEqual(SLIDE_TYPES.filter((type) => type.kind === "generator").map((type) => type.generator).sort(), ["filter-series", "grid-atlas", "spatial-3d-chart", "timeline"]);
  assert.deepEqual(SLIDE_TYPES.filter((type) => type.kind === "planned").map((type) => type.id), ["tour", "animation", "bim", "realtime", "dashboard"]);
  const camera = { center: [-100, 40], zoom: 5, heading: 0, tilt: 0 };
  const map = { ...createSlide("map-narrative", { title: "Coast", camera }), notes: "say this" };
  map.blocks[0].markdown = "Why it matters";
  map.generatedBy = { template: "grid-atlas", bounds: [0, 0, 1, 1] };
  let doc = addSlide(normalizeBriefing({}), map);
  assert.equal(slideTypeOf(doc.slides[0]).id, "grid");
  doc = convertSlide(doc, map.id, "key-numbers");
  const numbers = doc.slides[0];
  assert.equal(numbers.id, map.id);
  assert.equal(numbers.template, "key-numbers");
  assert.equal(numbers.title, "Coast");
  assert.equal(numbers.notes, "say this");
  assert.deepEqual(numbers.camera, map.camera);
  assert.equal(numbers.generatedBy, undefined, "a converted slide leaves its generated series");
  assert.ok(numbers.blocks.some((block) => block.type === "stat"));
  assert.equal(numbers.blocks.find((block) => block.type === "text").markdown, "Why it matters", "narrative text carries across");
  assert.equal(slideTypeOf(numbers).id, "numbers");
  assert.throws(() => convertSlide(doc, map.id, "nope"), /Unknown slide template/);
  assert.throws(() => convertSlide(doc, "missing", "title"), /Unknown slide/);
});

test("Image & text slides: http(s) images with alt text, a slideshow cap, a linked place, and checks", async () => {
  const { createSlide, normalizeBriefing, addSlide, convertSlide, validateBriefing, slideTypeOf, MAX_IMAGES } = await import("../js/briefing-document.js");
  const slide = createSlide("media", { title: "Valley" });
  assert.deepEqual(slide.blocks.map((block) => block.type), ["images", "text", "place"]);
  assert.equal(slideTypeOf(slide).id, "media");
  let doc = addSlide(normalizeBriefing({}), slide);
  assert.deepEqual(validateBriefing(doc).map((issue) => issue.message), ["Slide 1 has no images or text yet."]);
  const images = [
    { url: "https://example.com/a.jpg", alt: "Granite cliffs", caption: "Half Dome" },
    { url: "javascript:alert(1)", alt: "bad" },
    { url: "data:image/png;base64,AAAA", alt: "inline" },
    { url: "http://example.com/b.jpg", alt: "" },
    ...Array.from({ length: 20 }, (_, index) => ({ url: `https://example.com/${index}.jpg`, alt: `Photo ${index}` })),
  ];
  doc = normalizeBriefing({ slides: [{ ...slide, blocks: [{ type: "images", images }, { type: "place", label: "x".repeat(500) }] }] });
  const kept = doc.slides[0].blocks[0].images;
  assert.equal(kept.length, MAX_IMAGES, "slideshows are capped");
  assert.deepEqual(kept.slice(0, 2).map((image) => image.url), ["https://example.com/a.jpg", "http://example.com/b.jpg"], "only http(s) images survive");
  assert.equal(doc.slides[0].blocks[1].label.length, 120);
  assert.ok(validateBriefing(doc).some((issue) => /description for screen readers/.test(issue.message)));
  // A map slide becomes Image & text, keeping its view as the linked place and its narrative.
  const map = createSlide("map-narrative", { title: "Coast", camera: { center: [-120, 36], zoom: 8, heading: 0, tilt: 0 } });
  map.blocks[0].markdown = "Why it matters";
  const converted = convertSlide(addSlide(normalizeBriefing({}), map), map.id, "media").slides[0];
  assert.equal(converted.template, "media");
  assert.deepEqual(converted.camera.center, [-120, 36]);
  assert.equal(converted.blocks.find((block) => block.type === "text").markdown, "Why it matters");
});
