import { createAnimationClock } from "../animation-clock.js?v=0.1.0";
import { nearestObservationIndex } from "./temporal-adapter.js?v=0.1.0";

/** A shared clock whose values are dataset timestamps, not map-engine time. */
export function createCinematicTimeline({ ticks = [], durationSeconds = 20, loop = false, reducedMotion = false, clockFactory = createAnimationClock } = {}) {
  const orderedTicks = [...new Set(ticks.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!orderedTicks.length) throw new Error("Cinematic playback needs at least one valid observation.");
  const start = orderedTicks[0];
  const end = orderedTicks.at(-1);
  const duration = Math.min(600, Math.max(1, Number(durationSeconds) || 20));
  // A one-observation dataset remains seekable and visible, but cannot animate.
  const span = Math.max(1, end - start);
  const clock = clockFactory({ start, end: start + span, speed: span / (duration * 1000), loop, reducedMotion });
  const listeners = new Set();
  const state = () => {
    const raw = end === start ? start : Math.min(end, Math.max(start, clock.time));
    const observationIndex = nearestObservationIndex(orderedTicks, raw);
    return { ...clock.state(), time: raw, start, end, ticks: orderedTicks, observationIndex, observationTime: orderedTicks[observationIndex] };
  };
  const emit = () => listeners.forEach((listener) => listener(state()));
  const stop = clock.onTick(emit);
  const api = {
    state,
    play: () => { if (start !== end) clock.play(); return api; },
    pause: () => { clock.pause(); return api; },
    toggle: () => (clock.playing ? clock.pause() : clock.play()),
    seek: (time) => { clock.seek(Number(time)); return api; },
    seekObservation: (index) => {
      const tick = orderedTicks[Math.max(0, Math.min(orderedTicks.length - 1, Number(index) || 0))];
      clock.seek(tick);
      return api;
    },
    nextObservation: () => { const current = state().observationIndex; return api.seekObservation(Math.min(orderedTicks.length - 1, current + 1)); },
    previousObservation: () => { const current = state().observationIndex; return api.seekObservation(Math.max(0, current - 1)); },
    setRate: (rate) => { clock.setSpeed((span / (duration * 1000)) * Number(rate)); return api; },
    setLoop: (value) => { clock.setLoop(value); return api; },
    subscribe: (listener) => { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    destroy: () => { stop(); listeners.clear(); clock.destroy(); },
  };
  return api;
}
