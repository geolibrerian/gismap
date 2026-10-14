import test from "node:test";
import assert from "node:assert/strict";
import { FIELD_TASK_STORAGE_KEY, MobileFeedStore, mergeFieldTasks, normalizeMobileWorkflow } from "../js/mobile-feed-store.js";

const assigned = (overrides = {}) => ({ id: "task-1", role: "assignee", title: "Inspect", status: "in-progress", steps: [{ text: "Check cap", done: true }], updatedAt: "2026-10-14T12:00:00.000Z", ...overrides });

test("device field tasks are added to a project that lacks them", () => {
  const authored = { id: "mine", role: "author", title: "Draft" };
  const { tasks, changed } = mergeFieldTasks([authored], [assigned()]);
  assert.equal(changed, true);
  assert.deepEqual(tasks.map((task) => task.id), ["mine", "task-1"]);
});

test("the newer copy of a task wins the merge", () => {
  const older = assigned({ steps: [{ text: "Check cap", done: false }], updatedAt: "2026-10-14T11:00:00.000Z" });
  const restored = mergeFieldTasks([older], [assigned()]);
  assert.equal(restored.changed, true);
  assert.equal(restored.tasks[0].steps[0].done, true);

  const kept = mergeFieldTasks([assigned({ updatedAt: "2026-10-14T13:00:00.000Z", status: "completed" })], [assigned()]);
  assert.equal(kept.changed, false);
  assert.equal(kept.tasks[0].status, "completed");
});

test("only received tasks are restored and bad storage is ignored", () => {
  const { tasks, changed } = mergeFieldTasks([], [{ id: "a", role: "author" }, null, "bad", assigned()]);
  assert.equal(changed, true);
  assert.deepEqual(tasks.map((task) => task.id), ["task-1"]);
  assert.deepEqual(mergeFieldTasks(undefined, "bad"), { tasks: [], changed: false });
});

test("progress survives a fresh unsaved project through device storage", () => {
  const memory = new Map();
  const storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  const listeners = [];
  const events = { subscribe: (topic, listener) => topic === "project:loaded" && listeners.push(listener) };
  const projectManager = (mobile) => ({ current: { mobile: normalizeMobileWorkflow(mobile) }, setMobileWorkflow(next) { this.current.mobile = normalizeMobileWorkflow(next); return structuredClone(this.current.mobile); } });

  const before = new MobileFeedStore({ projectManager: projectManager({ fieldTasks: [{ id: "draft", role: "author" }] }), events, storage });
  before.saveTask(assigned());
  assert.deepEqual(JSON.parse(memory.get(FIELD_TASK_STORAGE_KEY)).map((task) => task.id), ["task-1"]);

  // A reload starts a blank project and announces it.
  const after = new MobileFeedStore({ projectManager: projectManager(), events, storage });
  listeners.at(-1)();
  assert.equal(after.snapshot().fieldTasks[0].steps[0].done, true);

  // Deleting the task removes it from the device copy too.
  after.update((state) => { state.fieldTasks = []; });
  assert.equal(memory.has(FIELD_TASK_STORAGE_KEY), false);
});

test("storage that throws never breaks the store", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); }, removeItem() { throw new Error("blocked"); } };
  const pm = { current: { mobile: normalizeMobileWorkflow() }, setMobileWorkflow(next) { this.current.mobile = normalizeMobileWorkflow(next); return structuredClone(this.current.mobile); } };
  const store = new MobileFeedStore({ projectManager: pm, events: null, storage });
  assert.equal(store.restoreDeviceTasks(), false);
  store.saveTask(assigned());
  assert.equal(store.snapshot().fieldTasks.length, 1);
});
