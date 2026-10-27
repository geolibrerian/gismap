import test from "node:test";
import assert from "node:assert/strict";
import {
  FIELD_PACKAGE_SCHEMA,
  FIELD_RECORD_SCHEMA,
  createFieldRecord,
  decodeCompactFieldRecord,
  encodeCompactFieldRecord,
  makeFieldPackage,
  normalizeFieldPackage,
  recordsGeoJSON,
  reviseFieldRecord,
} from "../js/field-records.js";

const record = (overrides = {}) => createFieldRecord({
  collectionId: "shoreline", geometry: { type: "Point", coordinates: [-122.4194, 37.7749] },
  location: { source: "device-gps", accuracyMeters: 7.8 },
  properties: { title: "Damaged railing", category: "safety", priority: "high" },
  notes: { text: "Bent at the north landing.", transcript: null, transcriptStatus: "pending" },
  attachments: [{ id: "attachment_photo", type: "photo", localAssetId: "asset_photo", name: "railing.jpg", mime: "image/jpeg" }], ...overrides,
}, { recordId: "field_sample", createdAt: "2026-10-24T12:00:00.000Z" });

test("field records preserve the documented local-only schema", () => {
  const value = record();
  assert.equal(value.schema, FIELD_RECORD_SCHEMA);
  assert.deepEqual(value.geometry, { type: "Point", coordinates: [-122.4194, 37.7749] });
  assert.equal(value.location.accuracyMeters, 7.8);
  assert.equal(value.sync.status, "local-only");
  assert.equal(value.sync.revision, 1);
  assert.equal(value.attachments[0].localAssetId, "asset_photo");
});

test("GeoJSON exposes field observations without local attachment data", () => {
  const geojson = recordsGeoJSON([record()]);
  assert.equal(geojson.type, "FeatureCollection");
  assert.deepEqual(geojson.features[0].geometry.coordinates, [-122.4194, 37.7749]);
  assert.equal(geojson.features[0].properties.attachmentCount, 1);
  assert.equal("localAssetId" in geojson.features[0].properties, false);
});

test("packages retain records plus binary asset payloads", () => {
  const value = makeFieldPackage([record()], [{ id: "asset_photo", type: "photo", mime: "image/jpeg", name: "railing.jpg", data: "YQ==" }]);
  assert.equal(value.schema, FIELD_PACKAGE_SCHEMA);
  const restored = normalizeFieldPackage(value);
  assert.equal(restored.records[0].id, "field_sample");
  assert.equal(restored.assets[0].id, "asset_photo");
});

test("compact QR records omit binary attachments and round-trip point observations", () => {
  const source = record();
  const payload = encodeCompactFieldRecord(source);
  assert.match(payload, /^gismap-field:v1:/);
  assert.equal(payload.includes("asset_photo"), false);
  const restored = decodeCompactFieldRecord(payload);
  assert.equal(restored.id, source.id);
  assert.deepEqual(restored.geometry, source.geometry);
  assert.equal(restored.notes.text, source.notes.text);
  assert.deepEqual(restored.attachments, []);
});

test("editing preserves the stable identity and collection time while recording a new revision", () => {
  const source = record();
  const revision = reviseFieldRecord(source, { notes: { text: "Corrected field note.", transcript: null, transcriptStatus: "pending" } }, { modifiedAt: "2026-10-24T13:00:00.000Z" });
  assert.equal(revision.id, source.id);
  assert.equal(revision.createdAt, source.createdAt);
  assert.equal(revision.observedAt, source.observedAt);
  assert.equal(revision.modifiedAt, "2026-10-24T13:00:00.000Z");
  assert.equal(revision.sync.revision, 2);
  assert.equal(revision.history.at(-1).revision, 1);
  assert.equal(revision.notes.text, "Corrected field note.");
});

test("invalid coordinates and unsupported package schemas are rejected", () => {
  assert.throws(() => record({ geometry: { type: "Point", coordinates: [181, 0] } }), /valid longitude/);
  assert.throws(() => normalizeFieldPackage({ schema: "other", records: [] }), /supported/);
});
