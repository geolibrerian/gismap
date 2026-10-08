const ACTIONS = new Set([
  "selection:set",
  "filters:set",
  "filters:clear",
  "layer:activate",
  "map:navigate",
  "time:set",
  "layer:visibility",
  "layer:style",
  "bookmark:create",
  "chapter:create",
]);

const clone = (value) => value == null ? value : structuredClone(value);

export class ApplicationState {
  #state;
  #listeners = new Set();
  #history = [];

  constructor(initial = {}) {
    this.#state = {
      activeLayerId: null,
      selection: { layerId: null, objectIds: [], features: [] },
      filters: {},
      timeRange: null,
      layerVisibility: {},
      layerStyles: {},
      navigation: null,
      bookmarks: [],
      chapters: [],
      ...clone(initial),
    };
  }

  get value() {
    return clone(this.#state);
  }

  subscribe(listener, selector = (state) => state) {
    if (typeof listener !== "function" || typeof selector !== "function") {
      throw new TypeError("State subscriptions require listener and selector functions.");
    }
    const entry = { listener, selector, selected: clone(selector(this.#state)) };
    this.#listeners.add(entry);
    return { remove: () => this.#listeners.delete(entry) };
  }

  dispatch(type, payload = {}, meta = {}) {
    if (!ACTIONS.has(type)) throw new Error(`Unknown application action: ${type}`);
    const previous = this.value;
    const next = this.value;
    switch (type) {
      case "selection:set":
        next.selection = {
          layerId: payload.layerId || null,
          objectIds: [...new Set(payload.objectIds || [])],
          features: clone(payload.features || []),
        };
        break;
      case "filters:set": {
        if (!payload.id) throw new Error("A filter action requires a stable filter id.");
        next.filters[payload.id] = {
          id: payload.id,
          layerId: payload.layerId || next.activeLayerId || null,
          expression: clone(payload.expression ?? null),
          owner: payload.owner || null,
          scope: payload.scope === "panel" ? "panel" : "project",
          temporary: payload.temporary === true,
        };
        break;
      }
      case "filters:clear":
        if (payload.id) delete next.filters[payload.id];
        else if (payload.owner) {
          next.filters = Object.fromEntries(Object.entries(next.filters).filter(([, filter]) => filter.owner !== payload.owner));
        } else next.filters = {};
        break;
      case "layer:activate":
        next.activeLayerId = payload.layerId || null;
        break;
      case "map:navigate":
        next.navigation = { ...clone(payload), requestedAt: new Date().toISOString() };
        break;
      case "time:set":
        next.timeRange = payload.start || payload.end ? { start: payload.start || null, end: payload.end || null } : null;
        break;
      case "layer:visibility":
        next.layerVisibility[payload.layerId] = payload.visible !== false;
        break;
      case "layer:style":
        next.layerStyles[payload.layerId] = clone(payload.style || {});
        break;
      case "bookmark:create":
        next.bookmarks.push(clone(payload.bookmark));
        break;
      case "chapter:create":
        next.chapters.push(clone(payload.chapter));
        break;
    }
    if (meta.undoable !== false) this.#history.push(previous);
    this.#state = next;
    this.#notify(type, payload, meta);
    return this.value;
  }

  releasePanel(instanceId) {
    const removed = Object.values(this.#state.filters).filter((filter) =>
      filter.owner === instanceId && filter.scope === "panel" && filter.temporary,
    );
    if (!removed.length) return this.value;
    const next = this.value;
    removed.forEach((filter) => delete next.filters[filter.id]);
    this.#state = next;
    this.#notify("panel:released", { instanceId, clearedFilterIds: removed.map((item) => item.id) }, { undoable: false });
    return this.value;
  }

  replace(next, meta = {}) {
    this.#history.push(this.value);
    this.#state = { ...this.value, ...clone(next) };
    this.#notify("state:replace", next, meta);
    return this.value;
  }

  undo() {
    if (!this.#history.length) return false;
    this.#state = this.#history.pop();
    this.#notify("state:undo", {}, { undoable: false });
    return true;
  }

  #notify(type, payload, meta) {
    for (const entry of this.#listeners) {
      const selected = clone(entry.selector(this.#state));
      if (JSON.stringify(selected) === JSON.stringify(entry.selected)) continue;
      const previous = entry.selected;
      entry.selected = selected;
      entry.listener(selected, { type, payload: clone(payload), meta: clone(meta), previous });
    }
  }
}

export const APPLICATION_ACTIONS = Object.freeze([...ACTIONS]);
