import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectManager } from "../js/project.js";
import { DEFAULT_SKIN, INTERFACE_SKINS, applyInterfaceSkin, normalizeSkin, skinIsDark } from "../js/skin-catalog.js";
import { featureFilterFor } from "../js/presentation-query.js";
import { COMPACT_QUERY } from "../js/viewport.js";
import { MOBILE_PANEL_QUERY } from "../js/mobile-panel-manager.js";

const manager = () => new ProjectManager({ publish() {} }, { getDefaultBasemapId: () => "topo-3d" });
const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("new projects use the GISMap house skin and unknown skins fall back to it", () => {
  assert.equal(DEFAULT_SKIN, "gismap");
  assert.equal(INTERFACE_SKINS[0].id, "gismap");
  assert.equal(normalizeSkin("retro-print"), "portolan");
  assert.equal(normalizeSkin("not-a-skin"), "gismap");
  assert.equal(manager().setPresentation({ template: "standard" }).skin, "gismap");
});

test("only the house skin follows the light/dark appearance setting", () => {
  assert.equal(skinIsDark("gismap", "dark"), true);
  assert.equal(skinIsDark("gismap", "light"), false);
  assert.equal(skinIsDark("clean-light", "dark"), false, "a light skin stays light in system dark mode");
  assert.equal(skinIsDark("violet-circuit", "light"), true);
});

test("applying a skin marks the whole document, not just #app", () => {
  const classes = new Set();
  const app = { dataset: {} };
  const doc = {
    documentElement: { dataset: { theme: "dark" }, style: {} },
    body: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
    querySelector: (selector) => (selector === "#app" ? app : null),
  };
  assert.equal(applyInterfaceSkin("portolan", { documentRef: doc }), "portolan");
  assert.equal(doc.documentElement.dataset.skin, "portolan");
  assert.equal(doc.documentElement.style.colorScheme, "light");
  assert.equal(classes.has("calcite-mode-dark"), false);
  applyInterfaceSkin("gismap", { documentRef: doc });
  assert.equal(classes.has("calcite-mode-dark"), true);
  assert.equal(app.dataset.presentationSkin, "gismap");
});

test("skin tokens live on :root so navigation and dialogs outside #app share them", () => {
  const css = read("../css/app.css");
  assert.doesNotMatch(css, /#app\[data-presentation-skin=/);
  for (const { id } of INTERFACE_SKINS.filter(({ id }) => id !== "gismap")) {
    assert.match(css, new RegExp(`:root\\[data-skin="${id}"\\] \\{ --ink:`), `${id} defines tokens on :root`);
  }
  // Dark appearance overrides are scoped to the house skin so they never blend into another skin.
  assert.doesNotMatch(css, /:root\[data-theme="dark"\]/);
  // Standard mode no longer forces the house palette over the chosen skin.
  assert.doesNotMatch(css, /#app\[data-presentation="standard"\]:not\(\[data-application-preset\]\) \{ --ink/);
  // Workflow screens use tokens rather than fixed teal colors.
  const workflowRules = css.match(/\.feed-card,\.mobile-card,\.mobile-empty \{[^}]*\}/)[0];
  assert.match(workflowRules, /var\(--surface\)/);
});

test("choosing a mode never changes the skin", () => {
  const ui = read("../js/ui.js");
  assert.doesNotMatch(ui, /skin: returningTo(Tour|Briefing)/);
  assert.doesNotMatch(ui, /chooseSkin\(cards\.find/);
});

test("Briefing and Tour keep separate titles", () => {
  const project = manager();
  project.setPresentation({ template: "briefing", title: "Earthquakes briefing" });
  const current = project.current.presentation;
  const tour = project.setPresentation({ ...current, template: "atlas", title: current.modeTitles.atlas || "Guided places" });
  assert.equal(tour.title, "Guided places");
  assert.equal(tour.modeTitles.briefing, "Earthquakes briefing");
  assert.equal(tour.modeTitles.atlas, "Guided places");
});

test("briefing selection persists through mode switches without re-rendering", () => {
  const events = [];
  const project = new ProjectManager({ publish: (name) => events.push(name) }, { getDefaultBasemapId: () => "topo-3d" });
  project.setPresentation({ template: "briefing" });
  events.length = 0;
  project.patchPresentation({ briefingSelection: { layerId: "layer-1", ids: ["ci1", "ak2", "ci1"], useAll: false } });
  assert.deepEqual(events, [], "patching must not publish presentation:changed");
  const switched = project.setPresentation({ ...project.current.presentation, template: "atlas" });
  const back = project.setPresentation({ ...switched, template: "briefing" });
  assert.deepEqual(back.briefingSelection, { layerId: "layer-1", ids: ["ci1", "ak2"], useAll: false });
});

test("map filters never hide every feature when IDs are text", () => {
  const records = [{ attributes: { __OBJECTID: "ci41347583" } }, { attributes: { __OBJECTID: "o'brien" } }];
  assert.equal(featureFilterFor(records, 2, "__OBJECTID"), null, "no filter when everything matches");
  assert.deepEqual(featureFilterFor(records, 10, "__OBJECTID"), { where: "__OBJECTID IN ('ci41347583','o''brien')" });
  assert.deepEqual(featureFilterFor([{ attributes: { OBJECTID: 4 } }], 10, "OBJECTID"), { objectIds: [4] });
  assert.deepEqual(featureFilterFor([], 10, "OBJECTID"), { objectIds: [] });
});

test("one compact breakpoint is shared by scripts and stylesheet", () => {
  assert.equal(MOBILE_PANEL_QUERY, COMPACT_QUERY);
  const ui = read("../js/ui.js");
  const router = read("../js/mobile-workflow-router.js");
  assert.doesNotMatch(ui, /matchMedia\("\(max-width: 640px\)"\)/);
  assert.doesNotMatch(router, /matchMedia\("\(max-width/);
  const css = read("../css/app.css");
  assert.doesNotMatch(css, /@media \(min-width: ?641px\) \{/, "desktop-only rules must exclude portrait tablets");
});

test("leaving a mode clears its map filter and context overlay", () => {
  const ui = read("../js/ui.js");
  const leave = ui.match(/#leavePresentationMode\(\) \{[\s\S]*?\n  \}/)[0];
  assert.match(leave, /#briefing-context-host"\)\?\.replaceChildren\(\)/);
  assert.match(leave, /layerView\.filter = null/);
  assert.match(ui, /if \(template === "standard" \|\| template !== this\.presentationState\.template\) this\.#leavePresentationMode\(\);/);
});

test("the router follows the active presentation and resets compact-only screens on resize", () => {
  const router = read("../js/mobile-workflow-router.js");
  assert.match(router, /subscribe\?\.\("presentation:changed"/);
  assert.match(router, /if \(!matches && this\.route === "more"\)/);
  assert.doesNotMatch(router, /navigate\(route\) \{\s*if \(!this\.media\.matches\) return;/, "desktop shared links must open their workflow");
});
