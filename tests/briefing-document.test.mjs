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
  assert.match(css, /\.briefing-stage__frame \{[^}]*aspect-ratio:16 \/ 9/);
  assert.match(css, /\.briefing-cards__deck \{[^}]*scroll-snap-type:y mandatory/);
  assert.match(css, /body\.briefing-exploring \.briefing-cards__deck/, "exploring hands gestures to the map");
  assert.match(player, /params\.set\("slide", slideId\)/, "slides are deep-linked by ID");
  assert.match(player, /requestFullscreen/);
  assert.match(player, /setViewPadding\(/, "the camera centres in the visible part of the map");
  assert.match(player, /Reset slide/);
  assert.match(player, /Tap the map to explore/, "mobile briefing cards use direct map-first guidance");
});
