const finite = (value, fallback = null) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const string = (value, fallback = "") => typeof value === "string" ? value : fallback;

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
        outline: layer.animation?.outline && typeof layer.animation.outline === "object" ? { color: string(layer.animation.outline.color, "#ff8136"), glow: layer.animation.outline.glow === true } : undefined,
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
      clock: { start, end, current: string(clock.current) || start, timeMode: "instant", durationSeconds: Math.min(600, Math.max(1, finite(clock.durationSeconds, 20))), loop: clock.loop === true },
      layers,
      events: Array.isArray(source.events) ? source.events.slice(0, 200) : [],
      scenes: Array.isArray(source.scenes) ? source.scenes.slice(0, 50) : [],
      provenance: { synthetic: source.provenance?.synthetic === true, sourceUrls: Array.isArray(source.provenance?.sourceUrls) ? source.provenance.sourceUrls.filter((url) => /^https:\/\//i.test(url)).slice(0, 50) : [], interpolated: false },
    },
  };
}

export function exportCinematicSpec(spec) { return structuredClone(normalizeCinematicSpec(spec)); }
export function importCinematicSpec(spec) { return normalizeCinematicSpec(spec); }
