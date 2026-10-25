// The master clock for animated effects, and how each track reads it.
//
// One clock drives every effect (no per-effect animation loops), so pause,
// seek and movie export see the same moment the same way. A track maps the
// master seconds to its own time with a rate, an offset and a cycle policy:
// a 6 s pulse and a 12 s sway can run side by side, and seek(30) shows the
// same state as playing for 30 s. This is animation time only; observation
// dates (a Timeline) and scenario values (a Scenario) are separate.

export const TRACK_POLICIES = Object.freeze(["loop", "once", "pingPong", "hold"]);
// What a track's displayed progression is: shown to viewers beside the effect.
export const PROVENANCE_STATUSES = Object.freeze(["observed", "interpolated", "modeled", "forecast", "illustrative"]);

const finite = (value, fallback) => (Number.isFinite(Number(value)) && value !== null && value !== "" ? Number(value) : fallback);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const mod = (value, length) => ((value % length) + length) % length;

/**
 * A track's timing: `rate` (× master speed), `cycleSeconds` (0 = continuous),
 * `offsetSeconds` and `policy` (loop, once, pingPong or hold — hold is a still
 * frame at the offset).
 */
export function normalizeTiming(timing = {}) {
  const source = timing && typeof timing === "object" ? timing : {};
  return {
    rate: clamp(finite(source.rate, 1), 0.1, 8),
    cycleSeconds: clamp(finite(source.cycleSeconds, 0), 0, 600),
    offsetSeconds: clamp(finite(source.offsetSeconds, 0), -600, 600),
    policy: TRACK_POLICIES.includes(source.policy) ? source.policy : "loop",
  };
}

/**
 * The track's own time at master time `seconds`: { seconds, phase (0–1 of its
 * cycle), settled (no further motion: a finished "once" or a "hold") }.
 */
export function trackTime(seconds, timing) {
  const { rate, cycleSeconds: cycle, offsetSeconds, policy } = normalizeTiming(timing);
  if (policy === "hold") return { seconds: offsetSeconds, phase: cycle > 0 ? mod(offsetSeconds, cycle) / cycle : 0, settled: true };
  const t = finite(seconds, 0) * rate + offsetSeconds;
  if (!(cycle > 0)) return { seconds: t, phase: 0, settled: false };
  if (policy === "once") {
    const local = clamp(t, 0, cycle);
    return { seconds: local, phase: local / cycle, settled: t >= cycle };
  }
  if (policy === "pingPong") {
    const m = mod(t, 2 * cycle);
    const local = m <= cycle ? m : 2 * cycle - m;
    return { seconds: local, phase: local / cycle, settled: false };
  }
  const local = mod(t, cycle);
  return { seconds: local, phase: local / cycle, settled: false };
}

/**
 * The master effects clock. Time is computed when read (from `now`), so it
 * needs no animation loop of its own; whatever draws reads `seconds()` each
 * frame and stops repainting while `playing` is false.
 */
export function createEffectsClock({ now = () => globalThis.performance?.now?.() ?? Date.now(), playing: startPlaying = true } = {}) {
  let base = 0, startedAt = now(), rate = 1, playing = startPlaying;
  const listeners = new Set();
  const emit = () => listeners.forEach((listener) => listener(clock.state()));
  const current = () => (playing ? base + ((now() - startedAt) / 1000) * rate : base);
  const clock = {
    seconds: current,
    get playing() { return playing; },
    get rate() { return rate; },
    state: () => ({ seconds: current(), playing, rate }),
    play() { if (!playing) { startedAt = now(); playing = true; emit(); } return clock; },
    pause() { if (playing) { base = current(); playing = false; emit(); } return clock; },
    toggle() { return playing ? clock.pause() : clock.play(); },
    seek(seconds) { base = Math.max(0, finite(seconds, 0)); startedAt = now(); emit(); return clock; },
    setRate(value) { base = current(); startedAt = now(); rate = clamp(finite(value, 1), 0.1, 8); emit(); return clock; },
    reset() { base = 0; startedAt = now(); emit(); return clock; },
    /** Every track's time at master time `seconds`, for frame-exact export. */
    frameAt: (seconds, tracks = []) => ({ seconds, tracks: tracks.map((timing) => trackTime(seconds, timing)) }),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return clock;
}
