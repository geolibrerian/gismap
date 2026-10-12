import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ProjectManager } from "../js/project.js";

test("Steeler is a persisted presentation skin", () => {
  const manager = new ProjectManager({ publish() {} }, { getDefaultBasemapId: () => "topo-3d" });
  const presentation = manager.setPresentation({ template: "atlas", skin: "steeler", chapters: [] });
  assert.equal(presentation.skin, "steeler");
});

test("Steeler provides its striped slate treatment in every skin selector", () => {
  const css = fs.readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(css, /data-presentation-skin="steeler"[^}]*--green:#4f5d73/);
  assert.match(css, /data-presentation-skin="steeler"[^\n]*repeating-linear-gradient/);
  assert.match(css, /skin-card--steeler/);
  assert.ok((ui.match(/"steeler"/g) || []).length >= 4);
  assert.match(ui, /Soft striped field journal/);
});
