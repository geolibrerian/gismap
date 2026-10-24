// Normalizes timestamped layer features without modifying the layer or its data.
// The initial cinematic renderer intentionally uses observed snapshots only.

const dateLike = (field = {}) => /date|time|timestamp/i.test(`${field.name || ""} ${field.alias || ""}`)
  || /^(date|timestamp)$/i.test(String(field.type || ""));

export function temporalFieldCandidates(layer) {
  return (layer?.fields || []).filter(dateLike).map((field) => ({
    name: field.name,
    label: field.alias || field.name,
    type: field.type || "unknown",
  }));
}

export function parseTemporalValue(value) {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value === "number") {
    // ArcGIS date fields are milliseconds; numeric years are deliberately not
    // inferred as dates because that would fabricate a time interpretation.
    return Math.abs(value) >= 10 ** 11 && Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function observationId(feature, index, objectIdField) {
  const value = feature?.attributes?.[objectIdField];
  return value == null || value === "" ? null : value;
}

/**
 * Return a bounded, deterministic timeline model for already-queried features.
 * Rows lacking a valid timestamp or stable object ID are reported, never guessed.
 */
export function normalizeTemporalFeatures(features = [], { timeField, groupField = "", objectIdField } = {}) {
  if (!timeField) throw new Error("Choose a timestamp field.");
  if (!objectIdField) throw new Error("This layer needs a stable object ID field for cinematic playback.");
  const invalid = [];
  const observations = [];
  features.forEach((feature, index) => {
    const time = parseTemporalValue(feature?.attributes?.[timeField]);
    const id = observationId(feature, index, objectIdField);
    if (time == null || id == null) {
      invalid.push({ index, reason: time == null ? "invalid-time" : "missing-id" });
      return;
    }
    const group = groupField && feature.attributes?.[groupField] != null && feature.attributes[groupField] !== ""
      ? String(feature.attributes[groupField]) : "__all__";
    observations.push({ id, group, time, feature, index });
  });
  observations.sort((a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id)) || a.index - b.index);
  const ticks = [...new Set(observations.map((item) => item.time))];
  return {
    timeField,
    groupField: groupField || null,
    objectIdField,
    observations,
    ticks,
    start: ticks[0] ?? null,
    end: ticks.at(-1) ?? null,
    invalid,
  };
}

/**
 * Instant semantics retain the newest observed state per group. Cumulative
 * semantics retain every observation through the current instant. Neither
 * mode interpolates or invents geometry.
 */
export function observedFeatureIdsAt(model, time, { timeMode = "instant" } = {}) {
  return observedFeaturesAt(model, time, { timeMode }).map((observation) => observation.id)
    .filter((id, index, ids) => ids.findIndex((value) => String(value) === String(id)) === index)
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
}

/** The source observations selected by the renderer at a given instant. */
export function observedFeaturesAt(model, time, { timeMode = "instant" } = {}) {
  if (!model?.observations?.length || !Number.isFinite(Number(time))) return [];
  const byId = (items) => items.sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }) || a.index - b.index);
  if (timeMode === "cumulative") {
    return byId(model.observations.filter((observation) => observation.time <= time));
  }
  const selectedTimes = new Map();
  for (const observation of model.observations) {
    if (observation.time > time) break;
    selectedTimes.set(observation.group, observation.time);
  }
  return byId(model.observations
    .filter((observation) => selectedTimes.get(observation.group) === observation.time));
}

export function nearestObservationIndex(ticks = [], time) {
  if (!ticks.length) return -1;
  let index = 0;
  for (let current = 1; current < ticks.length; current += 1) {
    if (ticks[current] > time) break;
    index = current;
  }
  return index;
}
