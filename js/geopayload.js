// Portable, transport-neutral handoff messages for Field Mode.  A GeoPayload
// deliberately holds only data: it never tells the receiver to execute code
// or fetch arbitrary resources.  QR, copied text, files and Web Share all use
// this exact envelope.
import { createFieldRecord, normalizeFieldRecord } from "./field-records.js";
import { decodeFieldTask, encodeFieldTask } from "./field-task-share.js";

export const GEOPAYLOAD_SCHEMA = "gismap-geopayload";
export const GEOPAYLOAD_VERSION = 1;
export const GEOPAYLOAD_PREFIX = "gismap-geopayload:v1:";
export const GEOPAYLOAD_TYPES = Object.freeze(["observation", "work-card", "return-receipt"]);
export const EMBEDDED_QR_TARGET = 2200;
export const EMBEDDED_QR_MAXIMUM = 2953;
const MAX_JSON_BYTES = 512 * 1024;

const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const id = (prefix) => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const timestamp = (value) => {
  const parsed = new Date(value || Date.now());
  if (!Number.isFinite(parsed.getTime())) throw new Error("A GeoPayload needs a valid creation time.");
  return parsed.toISOString();
};

function jsonValue(value, depth = 0) {
  if (depth > 24) throw new Error("A GeoPayload is nested too deeply.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("A GeoPayload cannot contain non-finite numbers."); return value; }
  if (Array.isArray(value)) return value.map((item) => jsonValue(item, depth + 1));
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("A GeoPayload must contain plain JSON data only.");
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, jsonValue(value[key], depth + 1)]));
}

const stableJson = (value) => JSON.stringify(jsonValue(value));
const bytes = (value) => new TextEncoder().encode(typeof value === "string" ? value : stableJson(value)).byteLength;
const toBase64Url = (value) => {
  const source = new TextEncoder().encode(value); let binary = "";
  source.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};
const fromBase64Url = (value) => {
  const binary = atob(String(value).replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - String(value).length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
};

// A short checksum detects transcription/scanning damage. It is not a
// signature and must not be mistaken for an authenticity guarantee.
function checksum(value) {
  let hash = 0x811c9dc5;
  for (const character of stableJson(value)) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function envelope(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("This is not a GeoPayload.");
  if (value.schema !== GEOPAYLOAD_SCHEMA || value.version !== GEOPAYLOAD_VERSION) throw new Error("This GeoPayload version is not supported.");
  if (!GEOPAYLOAD_TYPES.includes(value.type)) throw new Error("This GeoPayload has an unsupported type.");
  const clean = {
    schema: GEOPAYLOAD_SCHEMA,
    version: GEOPAYLOAD_VERSION,
    type: value.type,
    id: text(value.id, 160),
    createdAt: timestamp(value.createdAt),
    data: jsonValue(value.data),
  };
  if (!clean.id) throw new Error("A GeoPayload needs a stable ID.");
  if (bytes(clean) > MAX_JSON_BYTES) throw new Error("This GeoPayload is too large. Share it as a field package instead.");
  const expected = checksum(clean);
  if (value.checksum != null && value.checksum !== expected) throw new Error("This GeoPayload appears damaged or was changed after it was created.");
  return { ...clean, checksum: expected };
}

/** Create a canonical GeoPayload envelope. */
export function createGeoPayload({ type, data, id: payloadId = id("payload"), createdAt = new Date().toISOString() } = {}) {
  return envelope({ schema: GEOPAYLOAD_SCHEMA, version: GEOPAYLOAD_VERSION, type, id: payloadId, createdAt, data });
}

export const validateGeoPayload = (payload) => envelope(payload);

/** Encode a GeoPayload as QR/copyable text or standalone JSON file text. */
export function encodeGeoPayload(payload, transport = "qr") {
  const clean = validateGeoPayload(payload);
  const json = stableJson(clean);
  if (transport === "file") return json;
  if (transport !== "qr" && transport !== "text") throw new Error("Unsupported GeoPayload transport.");
  return `${GEOPAYLOAD_PREFIX}${toBase64Url(json)}`;
}

/** Decode a prefixed QR/text message or a JSON GeoPayload file. */
export function decodeGeoPayload(input) {
  const source = String(input || "").trim();
  if (!source) throw new Error("No GeoPayload was provided.");
  let raw;
  try {
    raw = source.startsWith(GEOPAYLOAD_PREFIX) ? JSON.parse(fromBase64Url(source.slice(GEOPAYLOAD_PREFIX.length))) : JSON.parse(source);
  } catch {
    throw new Error("This GeoPayload is not valid JSON or QR text.");
  }
  return validateGeoPayload(raw);
}

export function estimateTransportSize(payload) {
  const file = encodeGeoPayload(payload, "file");
  const qr = encodeGeoPayload(payload, "qr");
  return { jsonBytes: bytes(file), qrCharacters: qr.length, embeddedQrTarget: EMBEDDED_QR_TARGET, embeddedQrMaximum: EMBEDDED_QR_MAXIMUM };
}

/** Suggest transports without silently truncating the data. */
export function recommendTransports(payload, capabilities = {}) {
  const size = estimateTransportSize(payload);
  const embedded = size.qrCharacters <= EMBEDDED_QR_TARGET;
  const maximum = size.qrCharacters <= EMBEDDED_QR_MAXIMUM;
  return {
    ...size,
    qr: { supported: capabilities.qr !== false && maximum, recommended: capabilities.qr !== false && embedded, reason: embedded ? "Fits the conservative static-QR target." : maximum ? "Fits only a dense QR; a file or native share is clearer." : "Too large for a reliable single QR." },
    file: { supported: capabilities.file !== false, recommended: !embedded, reason: "Preserves the complete payload without QR density limits." },
    nativeShare: { supported: capabilities.nativeShare === true, recommended: !embedded && capabilities.nativeShare === true, reason: "Useful for nearby devices when a file is available." },
  };
}

/** A compact record adapter. Binary assets and screen sketches remain in .gisfield packages. */
export function geoPayloadFromFieldRecord(record, options = {}) {
  const clean = normalizeFieldRecord(record);
  const portable = {
    schema: clean.schema, id: clean.id, collectionId: clean.collectionId, type: clean.type,
    createdAt: clean.createdAt, observedAt: clean.observedAt, modifiedAt: clean.modifiedAt,
    geometry: clean.geometry, location: clean.location, properties: clean.properties,
    notes: { text: clean.notes.text.slice(0, 600), transcript: null, transcriptStatus: "pending" },
    attachments: [], relations: clean.relations,
    sync: { status: "transferred", revision: clean.sync.revision }, history: [],
  };
  return createGeoPayload({ type: "observation", id: options.id || clean.id, createdAt: clean.createdAt, data: { record: portable } });
}

export function fieldRecordFromGeoPayload(payload) {
  const clean = validateGeoPayload(payload);
  if (clean.type !== "observation") throw new Error("This GeoPayload is not an observation.");
  return createFieldRecord(normalizeFieldRecord(clean.data?.record), { recordId: clean.data.record.id, createdAt: clean.data.record.createdAt });
}

/** Work cards reuse the already-audited Field Task data limits and URL safety rules. */
export function geoPayloadFromFieldTask(task, options = {}) {
  const normalized = decodeFieldTask(encodeFieldTask(task, "assign")).task;
  return createGeoPayload({ type: "work-card", id: options.id || normalized.id || id("work"), createdAt: options.createdAt, data: { task: normalized } });
}

export function fieldTaskFromGeoPayload(payload) {
  const clean = validateGeoPayload(payload);
  if (clean.type !== "work-card") throw new Error("This GeoPayload is not a work card.");
  return decodeFieldTask(encodeFieldTask(clean.data?.task, "assign")).task;
}

export function createReturnReceipt({ operationId = id("receipt"), payloadId, status = "accepted", acknowledgedAt = new Date().toISOString(), details = "" } = {}) {
  const originalPayloadId = text(payloadId, 160);
  if (!originalPayloadId) throw new Error("A return receipt needs the original payload ID.");
  return createGeoPayload({ type: "return-receipt", id: operationId, createdAt: acknowledgedAt, data: { payloadId: originalPayloadId, status: text(status, 48) || "accepted", acknowledgedAt: timestamp(acknowledgedAt), details: text(details, 600) } });
}
