const clone = (value) => structuredClone(value);

export const MOBILE_WORKFLOW_DEFAULTS = Object.freeze({
  schemaVersion: 1,
  defaultRoute: "updates",
  feedPreferences: { scope: "projects", sort: "recent" },
  comparisons: [],
  fieldTasks: [],
  observations: [],
  watchRules: [],
  acknowledgements: [],
});

const array = (value) => Array.isArray(value) ? value : [];

export function normalizeMobileWorkflow(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: 1,
    defaultRoute: ["updates", "map", "tours", "tasks", "compare", "watchlist", "briefing"].includes(source.defaultRoute)
      ? source.defaultRoute : "updates",
    feedPreferences: {
      scope: ["projects", "nearby", "attention"].includes(source.feedPreferences?.scope) ? source.feedPreferences.scope : "projects",
      sort: source.feedPreferences?.sort === "priority" ? "priority" : "recent",
    },
    comparisons: clone(array(source.comparisons)),
    fieldTasks: clone(array(source.fieldTasks)),
    observations: clone(array(source.observations)),
    watchRules: clone(array(source.watchRules)),
    acknowledgements: clone(array(source.acknowledgements)),
  };
}

export class MobileFeedStore {
  constructor({ projectManager, events }) {
    this.projectManager = projectManager;
    this.events = events;
  }

  snapshot() {
    return normalizeMobileWorkflow(this.projectManager.current.mobile);
  }

  update(mutator) {
    const next = this.snapshot();
    mutator(next);
    return this.projectManager.setMobileWorkflow(next);
  }

  setScope(scope) {
    return this.update((state) => { state.feedPreferences.scope = scope; });
  }

  saveTask(task) {
    return this.update((state) => {
      const index = state.fieldTasks.findIndex((item) => item.id === task.id);
      if (index >= 0) state.fieldTasks[index] = { ...state.fieldTasks[index], ...clone(task), updatedAt: new Date().toISOString() };
      else state.fieldTasks.unshift({ status: "draft", ...clone(task), id: task.id || globalThis.crypto?.randomUUID?.() || `task-${Date.now()}`, updatedAt: new Date().toISOString() });
    });
  }

  acknowledge(ruleId) {
    return this.update((state) => {
      if (!state.acknowledgements.includes(ruleId)) state.acknowledgements.push(ruleId);
    });
  }
}
