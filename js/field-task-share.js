// Field task links carry the whole assignment (or its completed report) in the
// URL fragment, so no server is involved. A paid, database-backed service can
// replace this later; until then the payload stays small enough for a QR code.
import { sanitizeSharedResourceUrl } from "./share.js?v=0.18.2";

const MAX_URL_LENGTH = 2800;
const MAX_FEATURES = 5;
const MAX_STEPS = 10;
const MAX_TITLE = 120;
const MAX_STEP = 120;
const MAX_NOTES = 500;
const MAX_LABEL = 80;
const MAX_NAME = 60;

export const FIELD_TASK_LIMITS = Object.freeze({
  maxUrlLength: MAX_URL_LENGTH,
  maxFeatures: MAX_FEATURES,
  maxSteps: MAX_STEPS,
  maxNotes: MAX_NOTES,
});

export const DEFAULT_TASK_STEPS = Object.freeze(["Access is clear", "Signage is readable", "Site condition documented"]);

function base64UrlEncode(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const coordinate = (value) => Number(Number(value).toFixed(6));
const flag = (value) => (value ? 1 : 0);
const validObjectId = (value) => (Number.isSafeInteger(value) || (typeof value === "string" && value.length > 0 && value.length <= 64));

/** Steps for any stored task, including drafts saved before steps were editable. */
export function taskSteps(task = {}) {
  if (Array.isArray(task.steps)) return task.steps.map((step) => ({ text: text(step?.text, MAX_STEP), done: Boolean(step?.done) })).filter((step) => step.text);
  return DEFAULT_TASK_STEPS.map((label, index) => ({ text: label, done: Boolean(task.checklist?.[index]) }));
}

/** The shareable layer URL for a feature layer or map-service sublayer. */
export function featureLayerUrl(layer) {
  const url = String(layer?.url || "").replace(/\/+$/, "");
  if (!url) return null;
  return Number.isInteger(layer.layerId) && !/\/\d+$/.test(url) ? `${url}/${layer.layerId}` : url;
}

export function serializeFieldTask(task, kind = "assign") {
  if (!["assign", "return"].includes(kind)) throw new Error("Unknown field task link type.");
  const features = (task.features || []).slice(0, MAX_FEATURES + 1);
  if (features.length > MAX_FEATURES) throw new Error(`A shared field task can include at most ${MAX_FEATURES} features.`);
  const layers = [];
  const compactFeatures = features.map((feature) => {
    let layerIndex;
    if (feature.layerUrl) {
      const url = sanitizeSharedResourceUrl(feature.layerUrl);
      layerIndex = layers.indexOf(url);
      if (layerIndex < 0) layerIndex = layers.push(url) - 1;
    }
    return {
      li: layerIndex,
      o: validObjectId(feature.objectId) ? feature.objectId : undefined,
      x: coordinate(feature.longitude),
      y: coordinate(feature.latitude),
      l: text(feature.label, MAX_LABEL) || undefined,
      d: kind === "return" ? flag(feature.done) : undefined,
    };
  });
  const steps = taskSteps(task).slice(0, MAX_STEPS);
  const payload = {
    v: 1,
    k: kind === "return" ? "r" : "a",
    id: text(task.id, 64),
    t: text(task.title, MAX_TITLE) || "Field task",
    p: text(task.location, MAX_TITLE) || undefined,
    n: text(task.notes, MAX_NOTES) || undefined,
    s: steps.map((step) => step.text),
    L: layers.length ? layers : undefined,
    f: compactFeatures.length ? compactFeatures : undefined,
  };
  if (Number.isFinite(task.latitude) && Number.isFinite(task.longitude)) {
    payload.x = coordinate(task.longitude);
    payload.y = coordinate(task.latitude);
  }
  if (kind === "return") {
    payload.d = steps.map((step) => flag(step.done));
    payload.r = text(task.report, MAX_NOTES) || undefined;
    payload.by = text(task.completedBy, MAX_NAME) || undefined;
    payload.at = task.completedAt || new Date().toISOString();
  }
  return payload;
}

export function encodeFieldTask(task, kind = "assign") {
  return base64UrlEncode(JSON.stringify(serializeFieldTask(task, kind)));
}

const inRange = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90;

export function decodeFieldTask(value, options = {}) {
  let raw;
  try { raw = JSON.parse(base64UrlDecode(value)); } catch { throw new Error("This field task link is not valid."); }
  // Links made before versioned payloads held the raw task object.
  if (raw && raw.v === undefined && typeof raw.title === "string") {
    raw = { v: 1, k: "a", id: raw.id, t: raw.title, p: raw.location, n: raw.notes, s: taskSteps(raw).map((step) => step.text), x: raw.longitude, y: raw.latitude };
  }
  if (!raw || raw.v !== 1 || !["a", "r"].includes(raw.k) || typeof raw.t !== "string") throw new Error("This field task link has an unsupported version.");
  const layers = Array.isArray(raw.L) ? raw.L.slice(0, MAX_FEATURES).map((url) => sanitizeSharedResourceUrl(url, options)) : [];
  const rawFeatures = Array.isArray(raw.f) ? raw.f : [];
  if (rawFeatures.length > MAX_FEATURES) throw new Error(`A shared field task can include at most ${MAX_FEATURES} features.`);
  const features = rawFeatures.map((feature, index) => {
    if (!inRange(feature?.x, feature?.y)) throw new Error(`Feature ${index + 1} has an invalid location.`);
    return {
      layerUrl: Number.isInteger(feature.li) ? layers[feature.li] ?? null : null,
      objectId: validObjectId(feature.o) ? feature.o : null,
      longitude: feature.x,
      latitude: feature.y,
      label: text(feature.l, MAX_LABEL) || `Feature ${index + 1}`,
      done: feature.d === 1,
    };
  });
  const rawSteps = Array.isArray(raw.s) ? raw.s.slice(0, MAX_STEPS) : [];
  const done = Array.isArray(raw.d) ? raw.d : [];
  const task = {
    id: text(raw.id, 64) || null,
    title: text(raw.t, MAX_TITLE) || "Field task",
    location: text(raw.p, MAX_TITLE),
    notes: text(raw.n, MAX_NOTES),
    steps: rawSteps.map((step, index) => ({ text: text(step, MAX_STEP), done: done[index] === 1 })).filter((step) => step.text),
    features,
  };
  if (inRange(raw.x, raw.y)) Object.assign(task, { longitude: raw.x, latitude: raw.y });
  if (raw.k === "r") {
    const completedAt = new Date(raw.at);
    Object.assign(task, {
      report: text(raw.r, MAX_NOTES),
      completedBy: text(raw.by, MAX_NAME),
      completedAt: Number.isNaN(completedAt.getTime()) ? new Date().toISOString() : completedAt.toISOString(),
    });
  }
  return { kind: raw.k === "r" ? "return" : "assign", task };
}

export function createFieldTaskUrl({ baseUrl, task, kind = "assign" }) {
  const url = new URL(baseUrl);
  url.search = "";
  url.searchParams.set("workflow", "tasks");
  url.hash = `fieldTask=${encodeFieldTask(task, kind)}`;
  if (url.href.length > MAX_URL_LENGTH) throw new Error("This field task is too long for a QR code. Shorten the instructions, steps, or report.");
  return url.href;
}

export function readFieldTaskHash(hash) {
  return new URLSearchParams(String(hash || "").replace(/^#/, "")).get("fieldTask");
}
