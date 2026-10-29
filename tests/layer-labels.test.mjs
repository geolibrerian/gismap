import test from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, labelAnchor, labelFields, labelRuns, normalizeLabeling } from "../js/layer-labels.js";
import { packLayer, readShare, serializeShare } from "../js/map-share.js";

test("label settings normalize with safe defaults", () => {
  const spec = normalizeLabeling({ enabled: true, mode: "nope", style: { size: 999, color: "red" }, maxLabels: -4, minZoom: "", maxZoom: "12" });
  assert.equal(spec.mode, "field");
  assert.equal(spec.style.size, 144);
  assert.equal(spec.style.color, "#1f2933");
  assert.equal(spec.maxLabels, 1);
  assert.equal(spec.minZoom, null);
  assert.equal(spec.maxZoom, 12);
  assert.equal(spec.zMode, "ground");
});

test("templates fill {FIELD} wildcards, format numbers and escape data", () => {
  assert.equal(fillTemplate("{NAME} · {ACRES:1} ac", { NAME: "Lake", ACRES: 1234.567 }), `Lake · ${(1234.6).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ac`);
  assert.equal(fillTemplate("<b>{NAME}</b>", { NAME: "<script>x</script>" }), "<b>&lt;script&gt;x&lt;/script&gt;</b>");
  assert.equal(fillTemplate("{MISSING}", {}), "");
});

test("label fields come from the field, the template and the Z field", () => {
  assert.deepEqual(labelFields(normalizeLabeling({ mode: "template", template: "{A} {B:2} {A}", zMode: "field", zField: "H" })).sort(), ["A", "B", "H"]);
  assert.deepEqual(labelFields(normalizeLabeling({ mode: "single", template: "{A}" })), []);
});

test("a field label is the field's text; an empty value draws no label", () => {
  const spec = normalizeLabeling({ mode: "field", field: "NAME" });
  assert.equal(labelRuns(spec, { NAME: "Boise" })[0].text, "Boise");
  assert.equal(labelRuns(spec, { NAME: null }).length, 0);
});

test("labels sit at points, line middles and polygon centres", () => {
  assert.deepEqual(labelAnchor({ type: "Point", coordinates: [1, 2, 30] }), [1, 2, 30]);
  assert.deepEqual(labelAnchor({ type: "LineString", coordinates: [[0, 0], [10, 0]] }).slice(0, 2), [5, 0]);
  const [x, y] = labelAnchor({ type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]] });
  assert.ok(Math.abs(x - 2) < 1e-9 && Math.abs(y - 2) < 1e-9);
  assert.deepEqual(labelAnchor({ x: 3, y: 4, z: 5 }), [3, 4, 5]);
  assert.equal(labelAnchor(null), null);
});

test("layer labels travel in share links", () => {
  const labeling = normalizeLabeling({ enabled: true, mode: "template", template: "<b>{NAME}</b>", avoidOverlap: false });
  const payload = serializeShare({ kind: "map", camera: { center: [0, 0], zoom: 3 }, layers: [{ url: "https://example.com/data.geojson", sourceType: "geojson", labeling }] });
  assert.ok(packLayer({ url: "https://example.com/a", labeling }).l);
  const layer = readShare(payload).layers[0];
  const restored = normalizeLabeling(layer.labeling);
  assert.equal(restored.enabled, true);
  assert.equal(restored.template, "<b>{NAME}</b>");
  assert.equal(restored.avoidOverlap, false);
});
