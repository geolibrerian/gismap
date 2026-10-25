import test from "node:test";
import assert from "node:assert/strict";
import { createEffectsClock, normalizeTiming, trackTime } from "../js/cinematic/clock.js";
import { importCinematicSpec } from "../js/cinematic/state.js";

function fakeNow() {
  let ms = 0;
  const now = () => ms;
  now.advance = (seconds) => { ms += seconds * 1000; };
  return now;
}

test("two tracks with 6 s and 12 s cycles look the same after seek(30) as after playing to 30 s", () => {
  const pulse = { cycleSeconds: 6, policy: "loop" };
  const sway = { cycleSeconds: 12, offsetSeconds: 2, policy: "loop" };
  const now = fakeNow();
  const played = createEffectsClock({ now });
  for (let step = 0; step < 300; step += 1) now.advance(0.1);
  const seeked = createEffectsClock({ now: fakeNow(), playing: false }).seek(30);
  for (const timing of [pulse, sway]) {
    const a = trackTime(played.seconds(), timing), b = trackTime(seeked.seconds(), timing);
    assert.ok(Math.abs(a.seconds - b.seconds) < 1e-9 && Math.abs(a.phase - b.phase) < 1e-9, JSON.stringify({ a, b }));
  }
  assert.deepEqual(trackTime(30, pulse), { seconds: 0, phase: 0, settled: false });
  assert.deepEqual(trackTime(30, sway), { seconds: 8, phase: 8 / 12, settled: false });
  // frameAt gives every track at once, for export.
  assert.deepEqual(played.frameAt(30, [pulse, sway]).tracks.map((track) => track.seconds), [0, 8]);
});

test("pause holds the moment, play resumes from it, and speed scales what follows", () => {
  const now = fakeNow();
  const clock = createEffectsClock({ now });
  now.advance(5);
  clock.pause();
  now.advance(100);
  assert.equal(clock.seconds(), 5);
  assert.equal(clock.playing, false);
  clock.play().setRate(2);
  now.advance(3);
  assert.equal(clock.seconds(), 11);
  clock.reset();
  assert.equal(clock.seconds(), 0);
});

test("track policies: loop, once, ping-pong, hold and continuous", () => {
  assert.equal(trackTime(7, { cycleSeconds: 6 }).seconds, 1);
  assert.deepEqual(trackTime(7, { cycleSeconds: 6, policy: "once" }), { seconds: 6, phase: 1, settled: true });
  assert.equal(trackTime(4, { cycleSeconds: 6, policy: "once" }).settled, false);
  assert.equal(trackTime(8, { cycleSeconds: 6, policy: "pingPong" }).seconds, 4);
  assert.deepEqual(trackTime(99, { cycleSeconds: 6, offsetSeconds: 3, policy: "hold" }), { seconds: 3, phase: 0.5, settled: true });
  assert.equal(trackTime(10, { rate: 2 }).seconds, 20, "no cycle: continuous time at the track's rate");
  assert.deepEqual(normalizeTiming({ rate: 99, cycleSeconds: -4, policy: "sideways" }), { rate: 8, cycleSeconds: 0, offsetSeconds: 0, policy: "loop" });
});

test("scene specs keep each track's timing, visibility and provenance, and old specs still load", () => {
  const legacy = importCinematicSpec({ cinematic: { layers: [{ layerRef: "fires", temporal: { startField: "ALARM_DATE" } }, { layerRef: "lines", temporal: { kind: "none" } }] } });
  assert.deepEqual(legacy.cinematic.layers.map((layer) => layer.provenance.status), ["observed", "illustrative"]);
  assert.deepEqual(legacy.cinematic.layers[0].animation.timing, { rate: 1, cycleSeconds: 0, offsetSeconds: 0, policy: "loop" });
  assert.equal(legacy.cinematic.layers[0].animation.visible, true);
  assert.deepEqual([legacy.cinematic.clock.effectsRate, legacy.cinematic.clock.effectsPlaying], [1, true]);
  const authored = importCinematicSpec({ cinematic: { clock: { effectsRate: 2, effectsPlaying: false }, layers: [{ layerRef: "lines", temporal: { kind: "none" }, provenance: { status: "modeled" }, animation: { visible: false, timing: { cycleSeconds: 6, policy: "pingPong" } } }] } });
  const layer = authored.cinematic.layers[0];
  assert.deepEqual([layer.provenance.status, layer.animation.visible, layer.animation.timing.cycleSeconds, layer.animation.timing.policy], ["modeled", false, 6, "pingPong"]);
  assert.deepEqual([authored.cinematic.clock.effectsRate, authored.cinematic.clock.effectsPlaying], [2, false]);
});

test("re-normalizing a saved spec keeps an unset opacity unset (it used to drop to 5%)", async () => {
  const { exportCinematicSpec } = await import("../js/cinematic/state.js");
  const once = importCinematicSpec({ cinematic: { layers: [{ layerRef: "a", temporal: { kind: "none" } }] } });
  assert.equal(once.cinematic.layers[0].animation.opacity, null);
  assert.equal(exportCinematicSpec(exportCinematicSpec(once)).cinematic.layers[0].animation.opacity, null);
});
