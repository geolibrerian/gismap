import test from "node:test";
import assert from "node:assert/strict";
import { createCinematicTimeline } from "../js/cinematic/timeline-controller.js";

test("cinematic timeline seeks deterministically by observation", () => {
  const timeline = createCinematicTimeline({ ticks: [100, 200, 500], durationSeconds: 10, clockFactory: ({ start, end }) => {
    let time = start;
    return { get time() { return time; }, get playing() { return false; }, state: () => ({ time, start, end, playing: false }), onTick: () => () => {}, seek: (value) => { time = value; }, play() {}, pause() {}, setSpeed() {}, setLoop() {}, destroy() {} };
  } });
  timeline.seek(350);
  assert.equal(timeline.state().observationTime, 200);
  timeline.nextObservation();
  assert.equal(timeline.state().observationTime, 500);
  timeline.previousObservation();
  assert.equal(timeline.state().observationTime, 200);
  timeline.destroy();
});
