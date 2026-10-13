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

test("mobile Atlas authoring uses a sixty-percent bottom workspace", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(ui, /presentationSheet:\s*true/);
  assert.match(ui, /compactAtlas \? "Present" : "Present tour"/);
  assert.match(css, /body\.mobile-presentation-panel-open \.utility-panel[\s\S]*?height:60dvh/);
  assert.match(css, /\.app-dialog--presentation-sheet[\s\S]*?height:60dvh/);
  assert.match(css, /#app\[data-presentation="atlas"\] \.sidebar \{ height:60dvh; max-height:60dvh; \}/);
  assert.match(css, /#app\[data-presentation="atlas"\] \.mode-dashboard--atlas \{ align-content:start; grid-auto-rows:max-content/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.atlas-actions button \{ height:40px; min-height:0; max-height:40px/);
});

test("Clean Light keeps the full-screen mobile menu legible", async () => {
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /data-presentation-skin="clean-light"\] \.mobile-menu-drawer \{ color:var\(--ink\); background:var\(--surface\); \}/);
  assert.match(css, /data-presentation-skin="clean-light"\] \.mobile-menu-drawer \.menu__trigger/);
});
