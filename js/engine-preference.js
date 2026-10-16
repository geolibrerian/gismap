// Which map engine draws the map. ArcGIS is the default; MapLibre is an
// opt-in preview, chosen for one visit with ?engine=maplibre or saved in
// Display settings. Pure apart from the storage it is handed.
export const DEFAULT_ENGINE = "arcgis";
export const ENGINE_PREFERENCE_KEY = "gismap-online:map-engine:v1";

function read(storage) {
  try {
    return storage?.getItem?.(ENGINE_PREFERENCE_KEY) || null;
  } catch {
    return null;
  }
}

/** The saved choice, or the default. */
export function savedEngine(storage, available = [DEFAULT_ENGINE]) {
  const saved = String(read(storage) || "").toLowerCase();
  return available.includes(saved) ? saved : DEFAULT_ENGINE;
}

/** The engine for this visit: the link's ?engine= when it names an available engine, then the saved choice. */
export function chooseEngine({ search = "", storage = null, available = [DEFAULT_ENGINE] } = {}) {
  const requested = String(new URLSearchParams(search).get("engine") || "").toLowerCase();
  return available.includes(requested) ? requested : savedEngine(storage, available);
}

/** Saves the choice (the default is saved as no choice). */
export function saveEngine(storage, id) {
  try {
    if (!id || id === DEFAULT_ENGINE) storage?.removeItem?.(ENGINE_PREFERENCE_KEY);
    else storage?.setItem?.(ENGINE_PREFERENCE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the choice then lasts this visit only.
  }
}
