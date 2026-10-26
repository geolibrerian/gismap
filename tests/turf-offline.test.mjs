import assert from "node:assert/strict";
import test from "node:test";
import { createOfflineAnalysis, formatOfflineDistance, TURF_VERSION } from "../js/turf-offline.js";

function fakeTurf() {
  return {
    point: (coordinates, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates } }),
    distance: (from, to) => Math.abs(to.geometry.coordinates[0] - from.geometry.coordinates[0]),
    bearing: () => -20,
    midpoint: (from, to) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [(from.geometry.coordinates[0] + to.geometry.coordinates[0]) / 2, (from.geometry.coordinates[1] + to.geometry.coordinates[1]) / 2] } }),
    buffer: (feature, radius, options) => ({ type: "Feature", properties: { radius, units: options.units }, geometry: { type: "Polygon", coordinates: [[feature.geometry.coordinates, feature.geometry.coordinates, feature.geometry.coordinates, feature.geometry.coordinates]] } }),
    area: () => 1_500_000,
    bbox: () => [-123, 37, -122, 38],
    booleanPointInPolygon: () => true,
  };
}

test("the Turf adapter validates coordinates and exposes local measurement results", () => {
  const analysis = createOfflineAnalysis(fakeTurf());
  const measured = analysis.measure([-122, 37], [-120, 38], "miles");
  assert.equal(analysis.version, TURF_VERSION);
  assert.equal(measured.distance, 2);
  assert.equal(measured.bearing, -20);
  assert.deepEqual(measured.midpoint.geometry.coordinates, [-121, 37.5]);
  assert.throws(() => analysis.measure([-181, 37], [-120, 38]), /valid longitude and latitude/);
  assert.equal(formatOfflineDistance(12.3456, "miles"), "12.3 miles");
});

test("the Turf adapter can make portable buffers and rank saved point observations", () => {
  const analysis = createOfflineAnalysis(fakeTurf());
  const buffer = analysis.buffer([-122, 37], 3, "kilometers");
  assert.equal(buffer.properties.radius, 3);
  assert.equal(buffer.properties.units, "kilometers");
  const nearby = analysis.nearestRecords([-122, 37], [
    { id: "far", geometry: { type: "Point", coordinates: [-118, 37] } },
    { id: "near", geometry: { type: "Point", coordinates: [-121, 37] } },
    { id: "unlocated", geometry: null },
  ], { units: "kilometers" });
  assert.deepEqual(nearby.map(({ record }) => record.id), ["near", "far"]);
  assert.equal(analysis.summarize({ type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} }).areaSquareMeters, 1_500_000);
  assert.equal(analysis.containsPoint([-122, 37], { type: "Feature", geometry: { type: "Polygon", coordinates: [] }, properties: {} }), true);
});

