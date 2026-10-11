const MAX_URL_LENGTH = 4096;
const MAX_CHAPTERS = 50;
const MAX_TEXT = 120;

export const TOUR_SHARE_LIMITS = Object.freeze({ maxUrlLength: MAX_URL_LENGTH, maxChapters: MAX_CHAPTERS });

function base64UrlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlDecode(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

const compact = (value, digits = 5) => Number(Number(value).toFixed(digits));
const text = (value, fallback = "") => String(value ?? fallback).trim().slice(0, MAX_TEXT);

export function serializeEmbeddedTour(presentation, allowedBasemaps) {
  const chapters = (presentation?.chapters || []).map((chapter, index) => {
    const view = chapter.viewState || chapter.viewpoint || {};
    const center = view.center || [];
    return {
      name: text(chapter.title, `Chapter ${index + 1}`),
      caption: text(chapter.body || "").slice(0, 80) || undefined,
      lat: compact(center[1] ?? view.latitude, 5), lon: compact(center[0] ?? view.longitude, 5),
      zoom: compact(view.zoom, 2), tilt: compact(view.tilt ?? 0, 1), heading: compact(view.heading ?? 0, 1),
      basemap: allowedBasemaps.has(chapter.basemapId) ? chapter.basemapId : undefined,
      linger: Math.min(120, Math.max(1, Math.round(Number(chapter.lingerSeconds) || 4))),
    };
  });
  return { v: 1, title: text(presentation?.title, "Guided places"), skin: text(presentation?.skin, "clean-light"), play: presentation?.playbackMode === "auto" ? "auto" : "manual", chapters };
}

export function encodeEmbeddedTour(presentation, allowedBasemaps) {
  const payload = serializeEmbeddedTour(presentation, allowedBasemaps);
  return base64UrlEncode(JSON.stringify(payload));
}

export function decodeEmbeddedTour(value, allowedBasemaps) {
  let raw;
  try { raw = JSON.parse(base64UrlDecode(value)); } catch { throw new Error("This shared tour link is not valid."); }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.chapters) || raw.chapters.length < 1 || raw.chapters.length > MAX_CHAPTERS) throw new Error("This shared tour has an unsupported version or chapter count.");
  const chapters = raw.chapters.map((chapter, index) => {
    const numbers = [chapter.lat, chapter.lon, chapter.zoom, chapter.tilt, chapter.heading, chapter.linger];
    if (!numbers.every(Number.isFinite) || Math.abs(chapter.lat) > 90 || Math.abs(chapter.lon) > 180 || chapter.zoom < 0 || chapter.zoom > 24 || chapter.tilt < 0 || chapter.tilt > 90 || chapter.heading < -360 || chapter.heading > 360 || chapter.linger < 1 || chapter.linger > 120) throw new Error(`Chapter ${index + 1} has invalid camera settings.`);
    const basemapId = allowedBasemaps.has(chapter.basemap) ? chapter.basemap : null;
    return { id: `shared-${index + 1}`, title: text(chapter.name, `Chapter ${index + 1}`), body: text(chapter.caption || "").slice(0, 80), mediaUrl: "", basemapId, lingerSeconds: Math.round(chapter.linger), viewState: { center: [chapter.lon, chapter.lat], zoom: chapter.zoom, tilt: chapter.tilt, heading: chapter.heading }, sharedBasemapFallback: chapter.basemap && !basemapId };
  });
  return { title: text(raw.title, "Guided places"), skin: text(raw.skin, "clean-light"), playbackMode: raw.play === "auto" ? "auto" : "manual", chapters };
}

export function createEmbeddedTourUrl({ baseUrl, presentation, allowedBasemaps, chapter = null, autoplay = null }) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = `tour=${encodeEmbeddedTour(presentation, allowedBasemaps)}`;
  if (chapter != null) url.searchParams.set("chapter", String(chapter));
  if (autoplay != null) url.searchParams.set("autoplay", autoplay ? "1" : "0");
  if (url.href.length > MAX_URL_LENGTH) throw new Error("This camera-only tour link exceeds the 4 KB sharing limit. Export a .gmoatlas file instead.");
  return url.href;
}
