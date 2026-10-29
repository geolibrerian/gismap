// Version-40 QR codes top out below 3 KB in byte mode. Keep embedded tour
// links within a conservative budget so the complete fragment always fits in
// the branded mobile share card without truncation.
const MAX_URL_LENGTH = 2800;
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
      cut: chapter.transitionMode === "instant" ? 1 : undefined,
    };
  });
  return { v: 1, title: text(presentation?.title, "Guided places"), skin: text(presentation?.skin, "clean-light"), play: presentation?.playbackMode === "auto" ? "auto" : "manual", chapters };
}

export function encodeEmbeddedTour(presentation, allowedBasemaps) {
  const payload = serializeEmbeddedTour(presentation, allowedBasemaps);
  return base64UrlEncode(JSON.stringify(payload));
}

/**
 * A tour a person or chatbot can write by hand: `#tour=json:<URI-encoded JSON>`,
 * { title, skin, autoplay, stops: [{ name, caption, lat, lon, zoom, tilt, heading, basemap, seconds }] }.
 * Returns the compact payload, or null when the value is not a json: link.
 */
export function readableTourPayload(value) {
  let body = String(value || "");
  if (!/^json(?::|%3A)/i.test(body)) return null;
  try { body = decodeURIComponent(body); } catch { /* Already decoded. */ }
  let tour;
  try { tour = JSON.parse(body.replace(/^json:/i, "")); } catch (error) { throw new Error(`This json: tour link is not valid JSON (${error.message}).`); }
  const stops = tour?.stops ?? tour?.chapters;
  if (!tour || typeof tour !== "object" || !Array.isArray(stops)) throw new Error("A json: tour needs a stops array.");
  const number = (value, fallback) => (value === undefined || value === null || value === "" ? fallback : Number(value));
  return {
    v: 1, title: tour.title, skin: tour.skin, play: tour.autoplay === true || tour.play === "auto" ? "auto" : "manual",
    chapters: stops.map((stop) => ({
      name: stop?.name ?? stop?.title, caption: stop?.caption ?? stop?.description,
      lat: number(stop?.lat ?? stop?.latitude), lon: number(stop?.lon ?? stop?.lng ?? stop?.longitude),
      zoom: number(stop?.zoom, 15), tilt: number(stop?.tilt, 0), heading: number(stop?.heading, 0),
      basemap: stop?.basemap, linger: number(stop?.seconds ?? stop?.linger, 6), cut: stop?.transition === "instant" ? 1 : undefined,
    })),
  };
}

export function decodeEmbeddedTour(value, allowedBasemaps) {
  let raw = readableTourPayload(value);
  if (!raw) try { raw = JSON.parse(base64UrlDecode(value)); } catch { throw new Error("This shared tour link is not valid."); }
  if (!raw || raw.v !== 1 || !Array.isArray(raw.chapters) || raw.chapters.length < 1 || raw.chapters.length > MAX_CHAPTERS) throw new Error("This shared tour has an unsupported version or chapter count.");
  const chapters = raw.chapters.map((chapter, index) => {
    const numbers = [chapter.lat, chapter.lon, chapter.zoom, chapter.tilt, chapter.heading, chapter.linger];
    if (!numbers.every(Number.isFinite) || Math.abs(chapter.lat) > 90 || Math.abs(chapter.lon) > 180 || chapter.zoom < 0 || chapter.zoom > 24 || chapter.tilt < 0 || chapter.tilt > 90 || chapter.heading < -360 || chapter.heading > 360 || chapter.linger < 1 || chapter.linger > 120) throw new Error(`Chapter ${index + 1} has invalid camera settings.`);
    const basemapId = allowedBasemaps.has(chapter.basemap) ? chapter.basemap : null;
    return { id: `shared-${index + 1}`, title: text(chapter.name, `Chapter ${index + 1}`), body: text(chapter.caption || "").slice(0, 80), mediaUrl: "", basemapId, lingerSeconds: Math.round(chapter.linger), transitionMode: chapter.cut === 1 ? "instant" : "smooth", viewState: { center: [chapter.lon, chapter.lat], zoom: chapter.zoom, tilt: chapter.tilt, heading: chapter.heading }, sharedBasemapFallback: chapter.basemap && !basemapId };
  });
  return { title: text(raw.title, "Guided places"), skin: text(raw.skin, "clean-light"), playbackMode: raw.play === "auto" ? "auto" : "manual", chapters };
}

export function createEmbeddedTourUrl({ baseUrl, presentation, allowedBasemaps, chapter = null, autoplay = null, tourOnly = false, embed = false, readable = false }) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = readable ? `tour=json:${encodeURIComponent(JSON.stringify(serializeEmbeddedTour(presentation, allowedBasemaps)))}` : `tour=${encodeEmbeddedTour(presentation, allowedBasemaps)}`;
  if (chapter != null) url.searchParams.set("chapter", String(chapter));
  if (autoplay != null) url.searchParams.set("autoplay", autoplay ? "1" : "0");
  if (tourOnly || embed) url.searchParams.set("tourOnly", "1");
  if (embed) url.searchParams.set("embed", "1");
  // Readable links are for chatbots and people, not QR codes: they get the larger map-link budget.
  if (url.href.length > (readable ? 8192 : MAX_URL_LENGTH)) throw new Error("This camera-only tour exceeds the QR-safe link limit. Export a .gisatlas file instead.");
  return url.href;
}
