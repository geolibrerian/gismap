import test from "node:test";
import assert from "node:assert/strict";
import { ThreeHost } from "../js/engines/three/three-host.js";
import { effectParts, partsBounds } from "../js/cinematic/cinematic-effects.js";

function fakeThree(rendered) {
  class Matrix4 { fromArray() { return this; } clone() { return this; } multiply() { return this; } makeTranslation() { return this; } scale() { return this; } }
  return {
    Matrix4, Vector3: class {}, Camera: class {},
    WebGLRenderer: class { resetState() {} render(scene) { rendered.push(scene.name); } dispose() {} },
  };
}

function fakeMap(view) {
  const map = {
    repaints: 0, layer: null,
    addLayer(layer) { map.layer = layer; }, getLayer: () => map.layer,
    triggerRepaint() { map.repaints += 1; }, getCanvas: () => ({}), getProjection: () => ({ type: "mercator" }),
    getBounds: () => ({ getWest: () => view[0], getSouth: () => view[1], getEast: () => view[2], getNorth: () => view[3] }),
  };
  return map;
}

const item = (name, bounds) => ({ scene: { name, traverse() {} }, origin: [0, 0], scale: 1, bounds, animated: true });

test("effect parts report their geographic bounds", () => {
  const parts = effectParts([{ geometry: { type: "LineString", coordinates: [[-120, 35], [-118, 37]] } }, { geometry: { type: "Point", coordinates: [-121, 34] } }]);
  assert.deepEqual(partsBounds(parts), [-121, 34, -118, 37]);
  assert.equal(partsBounds({ paths: [], points: [] }), null);
});

test("off-screen effects are skipped and stop the map repainting", () => {
  const rendered = [];
  const map = fakeMap([-122, 36, -120, 38]);
  const host = new ThreeHost({ map, THREE: fakeThree(rendered) });
  map.layer.onAdd(map, {});
  host.add("near", item("near", [-121, 37, -120.5, 37.5]));
  host.add("far", item("far", [10, 40, 11, 41]));
  map.repaints = 0;
  map.layer.render({}, new Array(16).fill(0));
  assert.deepEqual(rendered, ["near"]);
  assert.equal(map.repaints, 1, "the on-screen effect keeps animating");
  host.remove("near");
  rendered.length = 0; map.repaints = 0;
  map.layer.render({}, new Array(16).fill(0));
  assert.deepEqual(rendered, []);
  assert.equal(map.repaints, 0, "nothing on screen moves, so the map goes idle");
  assert.equal(host.stats().items, 1);
});
