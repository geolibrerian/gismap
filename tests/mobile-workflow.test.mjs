import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeMobileWorkflow } from "../js/mobile-feed-store.js";
import { APPLICATION_PRESETS } from "../js/application-config.js";

test("mobile workflow state normalizes independently of desktop dashboards", () => {
  const mobile = normalizeMobileWorkflow({
    defaultRoute: "watchlist",
    feedPreferences: { scope: "attention", sort: "priority" },
    fieldTasks: [{ id: "one", title: "Inspect" }],
  });
  assert.equal(mobile.defaultRoute, "watchlist");
  assert.equal(mobile.feedPreferences.scope, "attention");
  assert.equal(mobile.fieldTasks[0].title, "Inspect");
  assert.deepEqual(normalizeMobileWorkflow({ fieldTasks: "bad" }).fieldTasks, []);
});

test("Atlas starts with Clean Light", () => {
  assert.equal(APPLICATION_PRESETS.atlas.skin, "clean-light");
});

test("mobile navigation exposes focused workflows", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const route of ["updates", "map", "tours", "tasks", "more"]) {
    assert.match(html, new RegExp(`data-mobile-workflow="${route}"`));
  }
  assert.match(html, /id="mobile-workflow-root"/);
});

test("mobile menu removes desktop-only builders and adds workflow routes", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /map-customize.*map-globe.*map-presentation/s);
  assert.match(ui, /Updates.*Briefing.*Tours.*Compare.*Field tasks.*Watchlist/s);
  assert.match(ui, /skin: returningToTour \? \(current\.skin \|\| "clean-light"\) : "clean-light"/);
});
