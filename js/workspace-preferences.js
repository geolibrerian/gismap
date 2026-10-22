const VALID = new Set(["layers", "explore", "notes", "draw"]);
const PANELS = new Set(["layers-panel", "places-panel", "bookmarks-panel", "intelligence-panel", "observations-panel", "draw-panel"]);
const KEY = "gismap:workspace-layout:v1";

export function createWorkspacePreferences(storage, fallback = "layers") {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) || "{}") || {}; } catch { /* Storage is optional. */ }
  const state = {
    selected: VALID.has(saved.selected) ? saved.selected : VALID.has(fallback) ? fallback : "layers",
    previous: VALID.has(saved.previous) ? saved.previous : null,
    pinned: new Set(Array.isArray(saved.pinned) ? saved.pinned.filter((id) => PANELS.has(id)) : []),
    resetPins: Array.isArray(saved.resetPins) ? saved.resetPins.filter((id) => PANELS.has(id)) : null,
  };
  const persist = () => { try { storage?.setItem(KEY, JSON.stringify({ selected: state.selected, previous: state.previous, pinned: [...state.pinned], resetPins: state.resetPins })); } catch { /* Keep the layout in memory. */ } };
  return {
    snapshot: () => ({ selected: state.selected, previous: state.previous, pinned: [...state.pinned] }),
    select(id) { if (!VALID.has(id) || id === state.selected) return false; state.previous = state.selected; state.selected = id; state.resetPins = null; persist(); return true; },
    restore() { if (!state.previous) return false; const old = state.selected; state.selected = state.previous; state.previous = old; if (state.resetPins) { state.pinned = new Set(state.resetPins); state.resetPins = null; } persist(); return true; },
    pin(id, value) { if (!PANELS.has(id)) return false; value ? state.pinned.add(id) : state.pinned.delete(id); state.resetPins = null; persist(); return true; },
    reset() { state.previous = state.selected; state.selected = "layers"; state.resetPins = [...state.pinned]; state.pinned.clear(); persist(); },
  };
}
