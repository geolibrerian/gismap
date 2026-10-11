import assert from "node:assert/strict";
import { createEmbeddedTourUrl, decodeEmbeddedTour } from "../js/tour-share.js";

const basemaps = new Set(["topo-3d", "satellite"]);
const presentation = { title: "Lakes & cafés", skin: "portolan", playbackMode: "auto", chapters: [{ title: "São Paulo: café", lingerSeconds: 12, transitionMode: "instant", basemapId: "satellite", viewState: { center: [-46.6333, -23.5505], zoom: 8.25, tilt: 35, heading: 15 } }] };
const url = createEmbeddedTourUrl({ baseUrl: "https://gismap.online/?old=1", presentation, allowedBasemaps: basemaps, chapter: 1, autoplay: false });
const payload = new URL(url).hash.replace("#tour=", "");
const decoded = decodeEmbeddedTour(payload, basemaps);
assert.equal(decoded.title, "Lakes & cafés");
assert.equal(decoded.chapters[0].title, "São Paulo: café");
assert.deepEqual(decoded.chapters[0].viewState.center, [-46.6333, -23.5505]);
assert.equal(decoded.chapters[0].transitionMode, "instant");
assert.equal(new URL(url).searchParams.get("chapter"), "1");
assert.throws(() => decodeEmbeddedTour("not-a-tour", basemaps), /not valid/);
const invalid = btoa(JSON.stringify({ v: 1, chapters: [{ name: "Nope", lat: 91, lon: 0, zoom: 1, tilt: 0, heading: 0, linger: 4 }] })).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
assert.throws(() => decodeEmbeddedTour(invalid, basemaps), /invalid camera/);
