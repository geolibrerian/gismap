import { exportCinematicSpec, importCinematicSpec } from "./state.js?v=0.2.0";

export const CINEMATIC_CLIP_SCHEMA = "gismap.cinematicClip";
export const CINEMATIC_CLIP_VERSION = 1;
const MAX_CLIPS = 40;
const MAX_CAPTIONS = 80;
const text = (value, max = 240) => String(value ?? "").trim().slice(0, max);
const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clone = (value) => structuredClone(value);

function newId() {
  const value = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 12) || Math.random().toString(36).slice(2, 14);
  return `clip-${value}`;
}

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["https:", "http:"].includes(url.protocol)) return null;
    // Project/clip sharing must never turn an authenticated service URL into a
    // portable credential. Keep ordinary query parameters when useful, but
    // drop names used by ArcGIS and common signed-resource providers.
    url.username = ""; url.password = ""; url.hash = "";
    for (const key of [...url.searchParams.keys()]) if (/^(?:token|access_?token|api_?key|key|signature|sig|client_?secret)$/i.test(key)) url.searchParams.delete(key);
    return url.href;
  } catch { return null; }
}

function camera(value) {
  const center = value?.center || [value?.longitude, value?.latitude];
  const longitude = finite(center?.[0]);
  const latitude = finite(center?.[1]);
  if (longitude == null || latitude == null || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return null;
  return { longitude, latitude, zoom: Math.min(24, Math.max(0, finite(value?.zoom, 12))), pitch: Math.min(85, Math.max(0, finite(value?.pitch ?? value?.tilt, 0))), bearing: finite(value?.bearing ?? value?.heading, 0) };
}

function normalizeTrack(track, durationMs) {
  if (!track || typeof track !== "object") return null;
  if (track.type === "caption") {
    const value = text(track.text, 500);
    return value ? { type: "caption", atMs: Math.min(durationMs, Math.max(0, finite(track.atMs, 0))), text: value } : null;
  }
  if (track.type === "temporalLayer" && text(track.layerRef, 2048)) {
    const animation = track.animation && typeof track.animation === "object" ? track.animation : {};
    const effect = animation.effect && typeof animation.effect === "object" ? animation.effect : null;
    const opacity = finite(animation.opacity);
    return {
      type: "temporalLayer", layerRef: text(track.layerRef, 2048), mode: track.mode === "cumulative" ? "cumulative" : "observed-steps",
      temporal: track.temporal && typeof track.temporal === "object" ? {
        startField: text(track.temporal.startField, 160), groupField: text(track.temporal.groupField, 160) || null,
        featureIdField: text(track.temporal.featureIdField, 160) || null,
      } : null,
      // How the layer looked when captured: its decorative effect and opacity.
      animation: {
        ...(effect ? { effect: { type: text(effect.type, 20) || "none", color: /^#[0-9a-f]{6}$/i.test(effect.color || "") ? effect.color : null, intensity: Math.min(2, Math.max(0.25, finite(effect.intensity, 1))) } } : {}),
        ...(opacity == null ? {} : { opacity: Math.min(1, Math.max(0.05, opacity)) }),
      },
    };
  }
  return null;
}

/** A portable Clip recipe. It intentionally excludes credentials, data bytes and local Blob URLs. */
export function normalizeCinematicClip(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const durationMs = Math.min(120000, Math.max(5000, finite(source.playback?.durationMs, 20000)));
  const cameras = (Array.isArray(source.cameraTrack) ? source.cameraTrack : []).map((item) => {
    const point = camera(item?.camera);
    return point ? { atMs: Math.min(durationMs, Math.max(0, finite(item.atMs, 0))), camera: point } : null;
  }).filter(Boolean).sort((a, b) => a.atMs - b.atMs).slice(0, 24);
  const tracks = (Array.isArray(source.tracks) ? source.tracks : []).map((track) => normalizeTrack(track, durationMs)).filter(Boolean);
  const dependencies = (Array.isArray(source.dependencies) ? source.dependencies : []).map((entry) => {
    const url = safeUrl(entry?.url);
    return url ? { kind: text(entry.kind, 80) || "remote-layer", url, offlineIncluded: false } : null;
  }).filter(Boolean).slice(0, 50);
  const range = source.range && typeof source.range === "object" ? { start: text(source.range.start, 80), end: text(source.range.end, 80) } : { start: "", end: "" };
  if (range.start && range.end && Date.parse(range.end) < Date.parse(range.start)) throw new Error("A Clip range cannot end before it starts.");
  return {
    schema: CINEMATIC_CLIP_SCHEMA, version: CINEMATIC_CLIP_VERSION, id: /^[\w-]{3,80}$/.test(source.id || "") ? source.id : newId(),
    title: text(source.title, 160) || "Cinematic clip", createdAt: text(source.createdAt, 40) || new Date().toISOString(), updatedAt: text(source.updatedAt, 40) || new Date().toISOString(),
    source: { projectId: text(source.source?.projectId, 160) || null, cinematicId: text(source.source?.cinematicId, 160) || null }, range,
    playback: { durationMs, easing: source.playback?.easing === "ease-in-out" ? "ease-in-out" : "linear", loop: source.playback?.loop === true },
    cameraTrack: cameras, tracks,
    // The frame a poster (and a Brief slide before it plays) shows.
    posterMs: Math.min(durationMs, Math.max(0, finite(source.posterMs, 0))),
    composition: { aspectRatio: ["9:16", "1:1"].includes(source.composition?.aspectRatio) ? source.composition.aspectRatio : "16:9", titleOverlay: source.composition?.titleOverlay !== false, attribution: source.composition?.attribution !== false },
    dependencies, renders: [],
  };
}

export function normalizeCinematicClips(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : []).map((clip) => {
    try { return normalizeCinematicClip(clip); } catch { return null; }
  }).filter((clip) => clip && !seen.has(clip.id) && seen.add(clip.id)).slice(0, MAX_CLIPS);
}

/**
 * Creates a clip from a loaded cinematic scene. Without options it captures
 * the whole timeline from the live camera; the capture dialog passes the
 * author's choices: { durationMs, range: { start, end }, startCamera,
 * endCamera, easing, captions: [{ atMs, text }], posterMs, aspectRatio, id }.
 */
export function createCinematicClip({ cinematic, projectId = null, camera: view = null, observationTimes = [], title = null, options = {} } = {}) {
  const spec = exportCinematicSpec(importCinematicSpec({ cinematic })).cinematic;
  const durationMs = Math.min(120000, Math.max(5000, Math.round(finite(options.durationMs, Math.min(30000, Math.max(10000, spec.clock.durationSeconds * 1000))))));
  const at = [...observationTimes].filter(Number.isFinite).sort((a, b) => a - b);
  const startCamera = camera(options.startCamera || view);
  const endCamera = camera(options.endCamera) || startCamera;
  const tracks = spec.layers.map((layer) => ({ type: "temporalLayer", layerRef: layer.layerRef, mode: spec.clock.timeMode === "cumulative" ? "cumulative" : "observed-steps", temporal: layer.temporal, animation: { effect: layer.animation.effect, opacity: layer.animation.opacity } }));
  const captions = (Array.isArray(options.captions) ? options.captions : []).slice(0, MAX_CAPTIONS).map((caption) => ({ type: "caption", atMs: caption.atMs, text: caption.text }));
  return normalizeCinematicClip({
    id: options.id || newId(), title: title || spec.title, source: { projectId, cinematicId: spec.id },
    range: { start: options.range?.start || (at[0] ? new Date(at[0]).toISOString() : spec.clock.start), end: options.range?.end || (at.at(-1) ? new Date(at.at(-1)).toISOString() : spec.clock.end) },
    playback: { durationMs, easing: options.easing === "ease-in-out" ? "ease-in-out" : "linear", loop: spec.clock.loop },
    cameraTrack: startCamera ? [{ atMs: 0, camera: startCamera }, { atMs: durationMs, camera: endCamera }] : [],
    tracks: [...tracks, ...captions],
    posterMs: options.posterMs ?? 0,
    composition: { aspectRatio: options.aspectRatio || "16:9", titleOverlay: true, attribution: true },
    dependencies: spec.provenance.sourceUrls.map((url) => ({ kind: "source", url })),
  });
}

/** Rebuilds the existing cinematic controller spec for interactive playback. */
export function clipToCinematicSpec(clip) {
  const normalized = normalizeCinematicClip(clip);
  const layers = normalized.tracks.filter((track) => track.type === "temporalLayer" && track.temporal?.startField).map((track) => ({
    layerRef: track.layerRef, temporal: { ...track.temporal },
    animation: { template: "step-perimeter", transition: "step", ...(track.animation?.effect ? { effect: { ...track.animation.effect } } : {}), ...(track.animation?.opacity != null ? { opacity: track.animation.opacity } : {}) },
  }));
  if (!layers.length) throw new Error("This Clip does not contain a playable temporal layer.");
  return importCinematicSpec({ cinematic: { id: normalized.source.cinematicId || normalized.id, title: normalized.title, clock: { start: normalized.range.start, end: normalized.range.end, durationSeconds: normalized.playback.durationMs / 1000, rate: 1, loop: normalized.playback.loop, timeMode: layers.some((layer) => normalized.tracks.find((track) => track.layerRef === layer.layerRef)?.mode === "cumulative") ? "cumulative" : "instant" }, layers } });
}

export function exportCinematicClip(clip) { return clone(normalizeCinematicClip(clip)); }
