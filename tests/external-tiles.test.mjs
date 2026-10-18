import test from "node:test";
import assert from "node:assert/strict";
import { detectTileType, inspectExternalTiles, registerPmtiles, tileUrl } from "../js/engines/maplibre/external-tiles.js";

test("URLs are sanitized and tile templates stay usable", () => {
  assert.equal(tileUrl("https://tiles.example/{z}/{x}/{y}.pbf"), "https://tiles.example/{z}/{x}/{y}.pbf");
  assert.throws(() => tileUrl("javascript:alert(1)"), /HTTPS/);
  assert.throws(() => tileUrl("https://user:pass@tiles.example/data"), /username or password/);
  assert.throws(() => tileUrl("https://tiles.example/data?token=secret"), /credential/);
  assert.equal(detectTileType("https://example.com/a.pmtiles?v=1"), "pmtiles");
  assert.equal(detectTileType("https://example.com/{z}/{x}/{y}.mvt"), "vector-xyz");
  assert.equal(detectTileType("https://example.com/{z}/{x}/{y}.png"), "raster-xyz");
  assert.equal(detectTileType("https://example.com/data.json"), null);
});

test("PMTiles registration is once per MapLibre instance, even concurrently", async () => {
  let calls = 0;
  class Protocol { tile() {} }
  class PMTiles {}
  const maplibre = { addProtocol: (name) => { calls++; assert.equal(name, "pmtiles"); } };
  const options = { globalRef: { pmtiles: { Protocol, PMTiles } } };
  const [a, b] = await Promise.all([registerPmtiles(maplibre, options), registerPmtiles(maplibre, options)]);
  assert.equal(a, b);
  assert.equal(calls, 1);
});

test("PMTiles inspection discovers vector metadata and rejects ignored byte ranges", async () => {
  let added;
  class Protocol { tile() {} add(value) { added = value; } }
  class PMTiles {
    constructor(url) { this.url = url; }
    async getHeader() { return { tileType: 1, minZoom: 3, maxZoom: 14, minLon: -10, minLat: 1, maxLon: 12, maxLat: 20 }; }
    async getMetadata() { return { name: "Example", attribution: "OSM", vector_layers: [{ id: "buildings", fields: { height: "Number" } }] }; }
  }
  const opts = { maplibre: { addProtocol() {} }, pmtilesOptions: { globalRef: { pmtiles: { Protocol, PMTiles } } }, fetchImpl: async (_url, options) => { assert.equal(options.headers.Range, "bytes=0-126"); return new Response("", { status: 206 }); } };
  const result = await inspectExternalTiles("https://tiles.example/test.pmtiles", opts);
  assert.equal(result.kind, "vector");
  assert.deepEqual(result.bounds, [-10, 1, 12, 20]);
  assert.deepEqual(result.layers, [{ id: "buildings", fields: [{ name: "height", type: "Number" }] }]);
  assert.equal(added.url, result.url);
  await assert.rejects(inspectExternalTiles(result.url, { ...opts, fetchImpl: async () => new Response("no ranges") }), /Range/);
});

test("vector and raster XYZ and TileJSON fixtures are discovered safely", async () => {
  const vector = await inspectExternalTiles("https://tiles.example/{z}/{x}/{y}.mvt");
  const raster = await inspectExternalTiles("https://tiles.example/{z}/{x}/{y}.png");
  assert.equal(vector.kind, "vector");
  assert.equal(raster.kind, "raster");
  const response = { tiles: ["../{z}/{x}/{y}.pbf"], vector_layers: [{ id: "roads", fields: { class: "String" } }], bounds: [-3, 1, 3, 4], attribution: "Example" };
  const discovered = await inspectExternalTiles("https://tiles.example/dir/tiles.json", { fetchImpl: async () => Response.json(response) });
  assert.equal(discovered.kind, "vector");
  assert.equal(discovered.tiles[0], "https://tiles.example/{z}/{x}/{y}.pbf");
  assert.equal(discovered.layers[0].id, "roads");
  await assert.rejects(inspectExternalTiles("https://tiles.example/tiles.json", { fetchImpl: async () => Response.json({ tiles: ["javascript:alert(1)"] }) }), /HTTPS/);
});

test("authentication, unreachable providers, and ambiguous data give actionable errors", async () => {
  const url = "https://tiles.example/data.json";
  await assert.rejects(inspectExternalTiles(url, { fetchImpl: async () => new Response("", { status: 403 }) }), /denied access/);
  await assert.rejects(inspectExternalTiles(url, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), /CORS/);
  await assert.rejects(inspectExternalTiles(url, { fetchImpl: async () => Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}"] }) }), /Choose vector or raster/);
});

test("raster PMTiles and manual TileJSON format overrides are recognized", async () => {
  class Protocol { tile() {} add() {} }
  class PMTiles { async getHeader() { return { tileType: 2, minZoom: 0, maxZoom: 8, minLon: -180, minLat: -90, maxLon: 180, maxLat: 90 }; } async getMetadata() { return {}; } }
  const result = await inspectExternalTiles("https://tiles.example/archive", { type: "pmtiles", maplibre: { addProtocol() {} }, pmtilesOptions: { globalRef: { pmtiles: { Protocol, PMTiles } } }, fetchImpl: async () => new Response("", { status: 206 }) });
  assert.equal(result.kind, "raster");
  const tilejson = await inspectExternalTiles("https://tiles.example/meta", { type: "raster-tilejson", fetchImpl: async () => Response.json({ tiles: ["https://tiles.example/{z}/{x}/{y}"] }) });
  assert.equal(tilejson.kind, "raster");
});
