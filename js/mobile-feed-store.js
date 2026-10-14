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

// Tasks received from a shared link live on this device, not in one project, so a
// reload or a dropped tab keeps the field worker's progress without a project save.
export const FIELD_TASK_STORAGE_KEY = "gismap-online:field-tasks:v1";

const isDeviceTask = (task) => task?.role === "assignee" && typeof task.id === "string" && task.id;

/**
 * Folds the device copy of field tasks into a project's tasks. A task missing from
 * the project is added; one in both keeps whichever copy was updated last.
 */
export function mergeFieldTasks(projectTasks, deviceTasks) {
  const tasks = clone(array(projectTasks));
  let changed = false;
  for (const stored of array(deviceTasks).filter(isDeviceTask)) {
    const index = tasks.findIndex((task) => task?.id === stored.id);
    if (index < 0) {
      tasks.push(clone(stored));
      changed = true;
    } else if (String(stored.updatedAt || "") > String(tasks[index].updatedAt || "")) {
      tasks[index] = clone(stored);
      changed = true;
    }
  }
  return { tasks, changed };
}

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
  constructor({ projectManager, events, storage }) {
    this.projectManager = projectManager;
    this.events = events;
    this.storage = storage;
    // Subscribed before the router so a loaded project already holds the device tasks when it renders.
    this.events?.subscribe?.("project:loaded", () => this.restoreDeviceTasks());
  }

  #storage() {
    try {
      return this.storage ?? globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  readDeviceTasks() {
    try {
      const parsed = JSON.parse(this.#storage()?.getItem(FIELD_TASK_STORAGE_KEY) || "[]");
      return array(parsed).filter(isDeviceTask);
    } catch {
      return [];
    }
  }

  #writeDeviceTasks(tasks) {
    try {
      const storage = this.#storage();
      if (!storage) return;
      const deviceTasks = array(tasks).filter(isDeviceTask);
      if (deviceTasks.length) storage.setItem(FIELD_TASK_STORAGE_KEY, JSON.stringify(deviceTasks));
      else storage.removeItem(FIELD_TASK_STORAGE_KEY);
    } catch {
      // Storage full or blocked: the project copy still holds the progress for this session.
    }
  }

  /** Brings this device's field tasks into the current project. */
  restoreDeviceTasks() {
    const deviceTasks = this.readDeviceTasks();
    if (!deviceTasks.length) return false;
    const { tasks, changed } = mergeFieldTasks(this.snapshot().fieldTasks, deviceTasks);
    if (!changed) return false;
    const next = this.snapshot();
    next.fieldTasks = tasks;
    this.projectManager.setMobileWorkflow(next);
    return true;
  }

  snapshot() {
    return normalizeMobileWorkflow(this.projectManager.current.mobile);
  }

  update(mutator) {
    const next = this.snapshot();
    mutator(next);
    const saved = this.projectManager.setMobileWorkflow(next);
    // The project now holds every device task (merged on load), so it is the full set to mirror.
    this.#writeDeviceTasks(saved.fieldTasks);
    return saved;
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
