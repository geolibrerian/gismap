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
  for (const route of ["briefing", "map", "tours", "tasks", "more"]) {
    assert.match(html, new RegExp(`data-mobile-workflow="${route}"`));
  }
  assert.doesNotMatch(html, /data-mobile-workflow="updates"/);
  assert.match(html, /id="mobile-workflow-root"/);
});

test("mobile tours own the active nav state instead of highlighting Map", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(router, /if \(route === "tours" \|\| route === "briefing"\) \{\s*this\.route = route;/);
  assert.match(router, /"mobile:workflow-route"/);
  assert.match(ui, /publish\("mobile:workflow-route", \{ route: "tours" \}\)/);
});

test("mobile chapter editing hides advanced fields in a fold by default", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /class="atlas-chapter-advanced"\$\{this\.mobileMedia\.matches \? "" : " open"\}/);
  assert.match(ui, /<summary>More chapter options<\/summary>/);
});

test("mobile menu exposes only free workflows and hides desktop authoring", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /dashboard-builder.*map-presentation/s);
  assert.match(ui, /Free workflows.*Briefing.*Tours.*Field tasks.*Map tools/s);
  assert.doesNotMatch(ui.match(/workflows\.innerHTML[^;]+/s)?.[0] || "", /Updates|Compare|Watchlist/);
  assert.match(ui, /skin: returningToTour \? \(current\.skin \|\| "clean-light"\) : "clean-light"/);
});

test("map tool strip is mobile-only and limited to the Map route", async () => {
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /mobile-panel-nav, \.mobile-map-tool-strip \{ display: none; \}/);
  assert.match(css, /body\.mobile-map-route \.mobile-map-tool-strip[\s\S]*?display: flex/);
});

test("free workflows provide QR sharing while account workflows remain gated", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(router, /share by QR/);
  assert.match(router, /With an account · coming soon/);
  assert.match(ui, /QRCode\.toCanvas\(canvas, url/);
  assert.match(ui, /shareMobileWorkflow\("briefing"\)/);
});

test("mobile Atlas authoring uses a sixty-percent bottom workspace", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(ui, /presentationSheet:\s*true/);
  assert.match(ui, /compactAtlas \? "Present" : "Present tour"/);
  assert.match(css, /body\.mobile-presentation-panel-open \.utility-panel[\s\S]*?height:60dvh/);
  assert.match(css, /\.app-dialog--presentation-sheet[\s\S]*?height:60dvh/);
  assert.match(css, /\.app-dialog--presentation-sheet \.dialog__shell \{ grid-template-rows:minmax\(0,1fr\) auto/);
  assert.match(css, /\.app-dialog--presentation-sheet \.dialog__actions button \{ flex:0 0 auto; width:auto; min-width:88px; height:40px/);
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
