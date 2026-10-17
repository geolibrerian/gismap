import test from "node:test";
import assert from "node:assert/strict";
import { ArcGISEngine as MapController } from "../js/engines/arcgis/arcgis-engine.js";

class TestGraphic {
  constructor(properties) { Object.assign(this, properties); }
}

test("guided tour markers use chapter targets and emphasize the active chapter", () => {
  const added = [];
  const controller = new MapController({ publish() {} });
  controller.modules.Graphic = TestGraphic;
  controller.tourLayer = {
    removeAll() { added.length = 0; },
    addMany(graphics) { added.push(...graphics); },
  };

  controller.setTourMarkers([
    { title: "One", viewState: { center: [-122.4, 37.8] } },
    { title: "Two", viewState: { center: [-73.98, 40.75] } },
    { title: "Invalid", viewState: { center: [999, 999] } },
  ], 1);

  assert.equal(added.length, 2);
  assert.deepEqual(added[0].geometry, { type: "point", longitude: -122.4, latitude: 37.8, spatialReference: { wkid: 4326 } });
  assert.equal(added[0].attributes.chapterIndex, 0);
  assert.equal(added[0].symbol.type, "picture-marker");
  assert.match(added[0].symbol.url, /^data:image\/svg\+xml/);
  assert.equal(added[0].symbol.width, 36);
  assert.equal(added[1].symbol.width, 44);
  assert.ok(!("text" in added[0].symbol));

  controller.setActiveTourMarker(0);
  assert.equal(added[0].symbol.width, 44);
  assert.equal(added[1].symbol.width, 36);
});

test("tour marker graphics remain outside operational layer state", () => {
  const controller = new MapController({ publish() {} });
  const operational = { uid: "data" };
  controller.drawLayer = { uid: "draw" };
  controller.tourLayer = { uid: "tour" };
  controller.clickFeedbackLayer = { uid: "click" };
  controller.map = { layers: { toArray: () => [controller.drawLayer, operational, controller.tourLayer, controller.clickFeedbackLayer] } };
  assert.deepEqual(controller.getLayers().map((layer) => layer.uid), ["data"]);
});
