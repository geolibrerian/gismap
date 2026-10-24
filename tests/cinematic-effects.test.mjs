import test from "node:test";
import assert from "node:assert/strict";
import { buildObservedBoundaryGlow, observedBoundaryPaths } from "../js/cinematic/maplibre-boundary-glow.js";

test("boundary glow keeps only valid observed line and polygon coordinates within its budget", () => {
  const paths = observedBoundaryPaths([
    { geometry: { type: "Polygon", coordinates: [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]] } },
    { geometry: { type: "LineString", coordinates: [[181, 0], [-120, 40], [-119, 40]] } },
  ]);
  assert.deepEqual(paths, [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]], [[-120, 40], [-119, 40]]]);
  assert.equal(observedBoundaryPaths([{ geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]]} }], { maxPaths: 1 }).length, 1);
});

test("boundary glow builds a disposable shared-host item from observed GeoJSON", () => {
  class BufferGeometry { setAttribute(name, attribute) { this[name] = attribute; return this; } }
  class Float32BufferAttribute { constructor(values, size) { this.values = values; this.size = size; } }
  class MeshBasicMaterial { constructor(options) { this.options = options; } }
  class Mesh { constructor(geometry, material) { this.geometry = geometry; this.material = material; } }
  class Scene { constructor() { this.items = []; } add(...items) { this.items.push(...items); } }
  const item = buildObservedBoundaryGlow({ BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh, Scene, AdditiveBlending: "add" }, [
    { geometry: { type: "LineString", coordinates: [[-122, 38], [-121, 38]] } },
  ]);
  assert.deepEqual(item.lngLat, { lng: -122, lat: 38 });
  assert.equal(item.onTerrain, true);
  assert.equal(item.scene.items.length, 2);
  assert.equal(item.scene.items[0].material.options.depthTest, false);
  assert.equal(buildObservedBoundaryGlow({ BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Mesh, Scene }, []), null);
});
