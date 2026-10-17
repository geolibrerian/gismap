import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { MOBILE_PANEL_QUERY, MobilePanelManager } from "../js/mobile-panel-manager.js";

class ClassList {
  constructor() { this.values = new Set(); }
  add(...values) { values.forEach((value) => this.values.add(value)); }
  remove(...values) { values.forEach((value) => this.values.delete(value)); }
  toggle(value, force) {
    if (force === undefined) force = !this.values.has(value);
    force ? this.values.add(value) : this.values.delete(value);
    return force;
  }
  contains(value) { return this.values.has(value); }
}

const PANEL_IDS = ["places-panel", "bookmarks-panel", "draw-panel", "layers-panel", "intelligence-panel"];

function fixture() {
  const panels = new Map(PANEL_IDS.map((id) => [id, { id, hidden: false, open: false, classList: new ClassList() }]));
  const buttons = PANEL_IDS.map((id) => ({
    dataset: { mobilePanel: id },
    classList: new ClassList(),
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
  }));
  const documentRef = {
    body: { classList: new ClassList() },
    getElementById: (id) => panels.get(id),
    querySelectorAll: (selector) => selector === "[data-mobile-panel]" ? buttons : [],
  };
  const restored = [];
  const manager = new MobilePanelManager({
    documentRef,
    panelManager: { restore: (id) => restored.push(id) },
    media: { matches: true },
  });
  return { manager, documentRef, panels, buttons, restored };
}

test("compact breakpoint includes portrait tablets", () => {
  assert.match(MOBILE_PANEL_QUERY, /880px/);
  assert.match(MOBILE_PANEL_QUERY, /orientation: portrait/);
});

test("mobile manager restores shared tools and starts with every drawer closed", () => {
  const { manager, documentRef, panels, restored } = fixture();
  manager.enter();
  assert.equal(documentRef.body.classList.contains("mobile-panel-mode"), true);
  assert.equal(restored.filter((id) => id === "workspace:intelligence").length, 1);
  assert.equal(restored.filter((id) => id === "content:intelligence").length, 1);
  assert.equal([...panels.values()].every((panel) => panel.hidden), true);
});

test("mobile manager makes exactly one tool panel active", () => {
  const { manager, panels, buttons } = fixture();
  manager.enter();
  assert.equal(manager.activate("places-panel"), "places-panel");
  assert.equal(panels.get("places-panel").hidden, false);
  assert.equal(PANEL_IDS.filter((id) => !panels.get(id).hidden).length, 1);
  assert.equal(manager.activate("intelligence-panel"), "intelligence-panel");
  assert.equal(panels.get("places-panel").hidden, true);
  assert.equal(panels.get("intelligence-panel").hidden, false);
  assert.equal(buttons.filter((button) => button.classList.contains("is-active")).length, 1);
});

test("refreshing an active mobile panel does not toggle it closed", () => {
  const { manager, panels } = fixture();
  manager.enter();
  manager.activate("intelligence-panel");
  manager.activate("intelligence-panel", { toggle: false });
  assert.equal(manager.activePanelId, "intelligence-panel");
  assert.equal(panels.get("intelligence-panel").hidden, false);
});

test("tapping each active mobile tool again closes its panel and clears its button", () => {
  const { manager, panels, buttons } = fixture();
  manager.enter();
  for (const [index, id] of PANEL_IDS.entries()) {
    assert.equal(manager.activate(id), id);
    assert.equal(manager.activate(id), null);
    assert.equal(manager.activePanelId, null);
    assert.equal([...panels.values()].every((panel) => panel.hidden), true);
    assert.equal(buttons[index].attributes["aria-pressed"], "false");
  }
});

test("mobile UI collapses the drawer when the panel manager returns null", () => {
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const handler = ui.slice(ui.indexOf("  #activateMobilePanel("), ui.indexOf("\n  #", ui.indexOf("  #activateMobilePanel(") + 3));
  assert.match(handler, /this\.mobilePanelManager\s*\?\s*this\.mobilePanelManager\.activate\(panelId\)\s*:\s*panelId/);
  assert.match(handler, /#setSidebarCollapsed\(!activePanelId\)/);
  assert.match(handler, /panelId:\s*activePanelId\s*\|\|\s*null/);
});
