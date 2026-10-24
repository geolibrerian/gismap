import test from "node:test";
import assert from "node:assert/strict";
import { clipToCinematicSpec, createCinematicClip, normalizeCinematicClip, normalizeCinematicClips } from "../js/cinematic/clip-model.js";
import { createSlide, normalizeBriefing } from "../js/briefing-document.js";
import { supportedClipVideoMime } from "../js/cinematic/clip-export.js";

const cinematic = {
  id: "wildfire", title: "Fire perimeter evolution",
  clock: { start: "2026-10-01T00:00:00Z", end: "2026-10-02T00:00:00Z", durationSeconds: 20, timeMode: "cumulative" },
  layers: [{ layerRef: "fire-perimeters", temporal: { startField: "observed_at", groupField: "incident", featureIdField: "OBJECTID" } }],
  provenance: { sourceUrls: ["https://example.org/FeatureServer/0"] },
};

test("a Clip is a portable recipe without credentials or local render output", () => {
  const clip = createCinematicClip({ cinematic, projectId: "project-1", camera: { center: [-118.1, 34.2], zoom: 10, heading: 20, tilt: 65 }, observationTimes: [Date.parse("2026-10-01T00:00:00Z"), Date.parse("2026-10-02T00:00:00Z")] });
  assert.equal(clip.schema, "gismap.cinematicClip");
  assert.equal(clip.cameraTrack.length, 2);
  assert.equal(clip.tracks[0].layerRef, "fire-perimeters");
  assert.equal(clip.dependencies[0].url, "https://example.org/FeatureServer/0");
  assert.deepEqual(clip.renders, []);
  assert.equal(JSON.stringify(clip).includes("token"), false);
  const replay = clipToCinematicSpec(clip).cinematic;
  assert.equal(replay.layers[0].temporal.startField, "observed_at");
  assert.equal(replay.clock.timeMode, "cumulative");
});

test("Clip normalization rejects unsafe dependencies and bounds the recipe", () => {
  const clip = normalizeCinematicClip({ id: "clip-safe", title: "Safe", playback: { durationMs: 999999 }, cameraTrack: [{ atMs: -4, camera: { longitude: -118, latitude: 34 } }], dependencies: [{ url: "javascript:alert(1)" }, { url: "https://safe.example/data?token=not-stored-here" }], tracks: [{ type: "caption", atMs: 999999, text: "A caption" }] });
  assert.equal(clip.playback.durationMs, 120000);
  assert.equal(clip.cameraTrack[0].atMs, 0);
  assert.equal(clip.tracks[0].atMs, 120000);
  assert.equal(clip.dependencies.length, 1);
  assert.equal(clip.dependencies[0].url.includes("token="), false);
  assert.equal(normalizeCinematicClips([clip, clip]).length, 1);
});

test("Briefs retain an interactive Cinematic Clip slide reference", () => {
  const slide = createSlide("cinematic", { title: "Fire clip" });
  slide.clipRef = "clip-fire-001";
  const briefing = normalizeBriefing({ slides: [slide] });
  assert.equal(briefing.slides[0].template, "cinematic");
  assert.equal(briefing.slides[0].clipRef, "clip-fire-001");
  assert.equal(briefing.slides[0].presentation, "interactive");
});

test("video export offers only a WebM MIME the browser reports as supported", () => {
  const Recorder = { isTypeSupported: (type) => type === "video/webm;codecs=vp8" };
  assert.equal(supportedClipVideoMime(Recorder), "video/webm;codecs=vp8");
  assert.equal(supportedClipVideoMime({ isTypeSupported: () => false }), null);
});
