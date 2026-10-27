import test from "node:test";
import assert from "node:assert/strict";
import {
  GEOPAYLOAD_PREFIX,
  addAnimatedQrFrame,
  assembleAnimatedQrFrames,
  createAnimatedQrFrames,
  createGeoPayload,
  createReturnReceipt,
  decodeGeoPayload,
  encodeGeoPayload,
  estimateTransportSize,
  fieldRecordFromGeoPayload,
  fieldTaskFromGeoPayload,
  geoPayloadFromFieldRecord,
  geoPayloadFromFieldTask,
  recommendTransports,
} from "../js/geopayload.js";
import { createFieldRecord } from "../js/field-records.js";
import { createSitePack, normalizeSitePack, sitePackEstimate } from "../js/field-site-pack.js";

test("a GeoPayload QR envelope round-trips and detects damage", () => {
  const payload = createGeoPayload({ type: "return-receipt", id: "receipt-1", createdAt: "2026-10-25T12:00:00Z", data: { payloadId: "work-1", status: "accepted" } });
  const text = encodeGeoPayload(payload);
  assert.match(text, new RegExp(`^${GEOPAYLOAD_PREFIX}`));
  assert.deepEqual(decodeGeoPayload(text), payload);
  assert.throws(() => decodeGeoPayload(`${text.slice(0, -1)}x`), /damaged|valid/);
});

test("transport advice keeps large messages out of a dense QR", () => {
  const small = createGeoPayload({ type: "return-receipt", id: "small", data: { payloadId: "work", status: "accepted" } });
  assert.equal(recommendTransports(small, { qr: true }).qr.recommended, true);
  const large = createGeoPayload({ type: "return-receipt", id: "large", data: { payloadId: "work", details: "x".repeat(2900) } });
  assert.equal(recommendTransports(large, { qr: true }).qr.recommended, false);
  assert.ok(estimateTransportSize(large).jsonBytes > 2000);
});

test("observation payloads retain field identity but never carry assets", () => {
  const record = createFieldRecord({ collectionId: "shoreline", properties: { title: "Railing", category: "safety" }, notes: { text: "Bent", transcript: null }, attachments: [{ id: "a", type: "photo", localAssetId: "asset-a" }] }, { recordId: "field-1", createdAt: "2026-10-25T12:00:00Z" });
  const portable = geoPayloadFromFieldRecord(record);
  assert.equal(portable.data.record.attachments.length, 0);
  const restored = fieldRecordFromGeoPayload(portable);
  assert.equal(restored.id, "field-1");
  assert.equal(restored.notes.text, "Bent");
});

test("work cards use the existing safe task normalizer", () => {
  const payload = geoPayloadFromFieldTask({ id: "task-1", title: "Inspect", steps: [{ text: "Photograph" }], latitude: 45.5, longitude: -122.6 });
  const task = fieldTaskFromGeoPayload(payload);
  assert.equal(task.id, "task-1");
  assert.equal(task.steps[0].done, false);
  const receipt = createReturnReceipt({ payloadId: payload.id });
  assert.equal(receipt.data.payloadId, payload.id);
  const completion = createReturnReceipt({ payloadId: payload.id, taskId: task.id, recordIds: ["note-1", "note-1"], completion: { completedAt: "2026-10-25T14:00:00.000Z", steps: [{ text: "Photograph", done: true }] } });
  assert.deepEqual(completion.data.recordIds, ["note-1"]);
  assert.equal(completion.data.taskId, "task-1");
});

test("animated QR restores a single missed frame and validates the completed payload", () => {
  const payload = createGeoPayload({ type: "return-receipt", id: "animated-receipt", data: { payloadId: "work-1", details: "x".repeat(5_000) } });
  const transfer = createAnimatedQrFrames(payload, { transferId: "animated-smoke", chunkSize: 200 });
  let received = {};
  transfer.frames.filter((_, index) => index !== 1).forEach((frame) => { received = addAnimatedQrFrame(received, frame); });
  assert.equal(assembleAnimatedQrFrames(received).id, "animated-receipt");
  assert.throws(() => addAnimatedQrFrame(received, createAnimatedQrFrames(payload, { transferId: "other-transfer", chunkSize: 200 }).frames[0]), /different animated transfer/);
});

test("Site Packs preserve validated tasks and observations with a transparent size estimate", () => {
  const record = createFieldRecord({ collectionId: "shoreline", properties: { title: "Railing" }, notes: { text: "Bent" } }, { recordId: "site-note", createdAt: "2026-10-25T12:00:00Z" });
  const pack = createSitePack({ id: "site-1", name: "Shoreline check", tasks: [{ id: "site-task", title: "Inspect", steps: [{ text: "Photograph" }] }], records: [record], basemap: { id: "map-1", name: "shore.pmtiles", format: "PMTiles", bytes: 5_000, included: false } });
  assert.equal(normalizeSitePack(pack).tasks[0].id, "site-task");
  assert.equal(sitePackEstimate(pack).recordCount, 1);
});
