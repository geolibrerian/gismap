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

test("cinematic playback advances uniformly through observations, not uneven calendar gaps", () => {
  let options;
  const timeline = createCinematicTimeline({ ticks: [100, 101, 9_000_000], durationSeconds: 12, rate: 0.25, clockFactory: (input) => {
    options = input;
    let time = input.start;
    return { get time() { return time; }, get playing() { return false; }, state: () => ({ time, start: input.start, end: input.end, playing: false }), onTick: () => () => {}, seek: (value) => { time = value; }, play() {}, pause() {}, setSpeed() {}, setLoop() {}, destroy() {} };
  } });
  // There are two equally timed steps, despite the large gap before the third timestamp.
  assert.equal(options.start, 0);
  assert.equal(options.end, 2);
  assert.equal(options.speed, 2 / 12_000 * 0.25);
  timeline.setRate(1);
  assert.equal(timeline.state().playbackRate, 1);
  timeline.destroy();
});
