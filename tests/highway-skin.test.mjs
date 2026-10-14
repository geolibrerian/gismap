import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectManager } from "../js/project.js";

test("Highway is a persisted presentation skin", () => {
  const manager = new ProjectManager({ publish() {} }, { getDefaultBasemapId: () => "topo-3d" });
  const presentation = manager.setPresentation({ template: "atlas", skin: "highway", chapters: [] });
  assert.equal(presentation.skin, "highway");
});

test("Highway provides a technical-console treatment and appears in each skin selector", () => {
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const catalog = fs.readFileSync(new URL("../js/skin-catalog.js", import.meta.url), "utf8");
  assert.match(css, /data-presentation-skin="highway"[^}]*--amber:#ff4b0b/);
  assert.match(css, /data-presentation-skin="highway"[^\n]*atlas-chapter-overlay/);
  assert.match(css, /skin-card--highway/);
  assert.match(ui, /INTERFACE_SKINS/);
  assert.match(catalog, /id: "highway"/);
  assert.match(catalog, /Clean technical map console/);
});
