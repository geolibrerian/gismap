const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const string = (value, fallback = "") => typeof value === "string" ? value : fallback;
const EFFECTS = Object.freeze(["auto", "none", "glow", "fire", "pulse", "wind", "water", "flow"]);

export const CINEMATIC_SCHEMA_VERSION = "0.1";
export const CINEMATIC_TEMPLATES = Object.freeze(["step-perimeter", "moving-track"]);

export function normalizeCinematicSpec(input = {}) {
  const source = input?.cinematic || input;
  const clock = source.clock || {};
  const start = string(clock.start);
  const end = string(clock.end);
  if (start && end && Date.parse(end) < Date.parse(start)) throw new Error("Cinematic clock end must not precede its start.");
  const layers = Array.isArray(source.layers) ? source.layers.map((layer) => {
    if (!string(layer?.layerRef)) throw new Error("Every cinematic layer needs a layerRef.");
    if (!string(layer?.temporal?.startField)) throw new Error("Every cinematic layer needs temporal.startField.");
    const template = CINEMATIC_TEMPLATES.includes(layer?.animation?.template) ? layer.animation.template : "step-perimeter";
    return {
      layerRef: layer.layerRef,
      temporal: {
        startField: layer.temporal.startField,
        groupField: string(layer.temporal.groupField) || null,
        featureIdField: string(layer.temporal.featureIdField) || null,
        timezone: string(layer.temporal.timezone, "UTC") || "UTC",
        missingTime: layer.temporal.missingTime === "include" ? "include" : "exclude",
      },
      animation: {
        template,
        transition: layer.animation?.transition === "crossfade" ? "crossfade" : "step",
        opacity: finite(layer.animation?.opacity) == null ? null : Math.min(1, Math.max(0.05, finite(layer.animation.opacity))),
        outline: layer.animation?.outline && typeof layer.animation.outline === "object" ? { color: string(layer.animation.outline.color, "#ff8136"), glow: layer.animation.outline.glow === true } : undefined,
        effect: normalizeEffect(layer.animation),
        provenanceLabel: string(layer.animation?.provenanceLabel),
      },
    };
  }) : [];
  return {
    schemaVersion: CINEMATIC_SCHEMA_VERSION,
    mode: "cinematic",
    cinematic: {
      id: string(source.id) || `cinematic-${Date.now()}`,
      title: string(source.title) || "Cinematic map",
      intent: ["explore", "investigate", "present"].includes(source.intent) ? source.intent : "explore",
      preferredEngine: ["maplibre", "arcgis"].includes(source.preferredEngine) ? source.preferredEngine : "maplibre",
      clock: { start, end, current: string(clock.current) || start, timeMode: clock.timeMode === "cumulative" ? "cumulative" : "instant", durationSeconds: Math.min(600, Math.max(1, finite(clock.durationSeconds, 120))), rate: Math.min(4, Math.max(0.1, finite(clock.rate, 0.25))), loop: clock.loop === true },
      layers,
      events: Array.isArray(source.events) ? source.events.slice(0, 200) : [],
      scenes: Array.isArray(source.scenes) ? source.scenes.slice(0, 50) : [],
      provenance: { synthetic: source.provenance?.synthetic === true, sourceUrls: Array.isArray(source.provenance?.sourceUrls) ? source.provenance.sourceUrls.filter((url) => /^https:\/\//i.test(url)).slice(0, 50) : [], interpolated: false },
    },
  };
}

/**
 * A layer's decorative effect: { type, color?, intensity }. v0.1 specs only had
 * `outline.glow`, which maps to the glow effect.
 */
function normalizeEffect(animation = {}) {
  const effect = animation?.effect && typeof animation.effect === "object" ? animation.effect : {};
  const type = EFFECTS.includes(effect.type) ? effect.type : animation?.outline?.glow === true ? "glow" : "none";
  const color = /^#[0-9a-f]{6}$/i.test(string(effect.color)) ? effect.color : null;
  return { type, color, intensity: Math.min(2, Math.max(0.25, finite(effect.intensity, 1))) };
}

export function exportCinematicSpec(spec) { return structuredClone(normalizeCinematicSpec(spec)); }
export function importCinematicSpec(spec) { return normalizeCinematicSpec(spec); }
