import { MobileFeedStore } from "./mobile-feed-store.js?v=0.17.0";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateLabel = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Recently";

export class MobileWorkflowRouter {
  constructor({ events, projectManager, mapController, openWorkflow }) {
    Object.assign(this, { events, projectManager, mapController, openWorkflow });
    this.media = matchMedia("(max-width: 640px), (max-width: 880px) and (orientation: portrait)");
    this.store = new MobileFeedStore({ projectManager, events });
    this.root = document.querySelector("#mobile-workflow-root");
    this.route = "map";
  }

  initialize() {
    document.querySelectorAll("[data-mobile-workflow]").forEach((button) => button.addEventListener("click", () => this.navigate(button.dataset.mobileWorkflow)));
    this.root?.addEventListener("click", (event) => this.#click(event));
    this.root?.addEventListener("change", (event) => this.#change(event));
    this.root?.addEventListener("submit", (event) => this.#submit(event));
    this.events.subscribe?.("project:loaded", () => { if (this.route !== "map") this.render(); });
    this.events.subscribe?.("mobile:workflow-changed", () => { if (this.route !== "map") this.render(); });
    this.events.subscribe?.("mobile:workflow-route", ({ route }) => {
      if (!this.media.matches || !route) return;
      this.route = route;
      this.root.hidden = true;
      document.body.classList.remove("mobile-workflow-open", "mobile-menu-open");
      this.#syncNav();
    });
    this.media.addEventListener?.("change", ({ matches }) => { if (!matches) this.navigate("map"); });
  }

  navigate(route) {
    if (!this.media.matches) return;
    if (route === "more") route = "more";
    if (route === "map") {
      this.route = "map";
      this.root.hidden = true;
      document.body.classList.remove("mobile-workflow-open");
      this.#syncNav();
      return;
    }
    if (route === "tours" || route === "briefing") {
      this.route = route;
      this.root.hidden = true;
      document.body.classList.remove("mobile-workflow-open", "mobile-menu-open");
      this.#syncNav();
      this.openWorkflow(route);
      return;
    }
    this.route = route;
    this.root.hidden = false;
    document.body.classList.add("mobile-workflow-open");
    document.body.classList.remove("mobile-menu-open");
    this.render();
    this.#syncNav();
  }

  render() {
    if (!this.root || this.root.hidden) return;
    const renderer = { updates: () => this.#updates(), compare: () => this.#compare(), tasks: () => this.#tasks(), watchlist: () => this.#watchlist(), more: () => this.#more() }[this.route] || (() => this.#more());
    this.root.innerHTML = `<header class="mobile-workflow__header"><div><span class="mobile-workflow__brand">GISMap Online</span><h1>${escapeHtml(this.#title())}</h1></div><button type="button" data-workflow-close aria-label="Return to map">×</button></header><div class="mobile-workflow__body">${renderer()}</div>`;
  }

  #title() { return ({ updates: "Updates", compare: "Compare", tasks: "Field tasks", watchlist: "Watchlist", more: "Workflows" })[this.route] || "Workflows"; }

  #updates() {
    const mobile = this.store.snapshot();
    const scope = mobile.feedPreferences.scope;
    const tasks = mobile.fieldTasks;
    const rules = mobile.watchRules;
    const chapters = this.projectManager.current.presentation?.chapters || [];
    const observations = mobile.observations;
    const cards = [];
    if (tasks.length) cards.push(...tasks.slice(0, 4).map((task) => `<article class="feed-card"><span class="feed-card__meta">Field task · ${dateLabel(task.updatedAt)}</span><h2>${escapeHtml(task.title || "Untitled field task")}</h2><p>${escapeHtml(task.location || task.notes || "Ready for field review.")}</p><div class="feed-card__actions"><button data-open-task="${escapeHtml(task.id)}">Open task →</button></div></article>`));
    if (rules.length) cards.push(...rules.slice(0, 3).map((rule) => `<article class="feed-card${mobile.acknowledgements.includes(rule.id) ? " is-muted" : ""}"><span class="feed-card__meta">Watchlist · ${escapeHtml(rule.status || "Monitoring")}</span><h2>${escapeHtml(rule.title || rule.field || "Saved threshold")}</h2><p><strong>${escapeHtml(rule.current ?? "—")}</strong> ${escapeHtml(rule.units || "")} · threshold ${escapeHtml(rule.operator || "above")} ${escapeHtml(rule.threshold ?? "—")}</p><div class="feed-card__actions"><button data-route="watchlist">View rule →</button></div></article>`));
    if (observations.length) cards.push(...observations.slice(0, 4).map((item) => `<article class="feed-card"><span class="feed-card__meta">${escapeHtml(item.source || "Project update")} · ${dateLabel(item.observedAt)}</span><h2>${escapeHtml(item.title || "Map update")}</h2><p>${escapeHtml(item.summary || "New project activity is available.")}</p></article>`));
    if (!cards.length && chapters.length) cards.push(`<article class="feed-card"><span class="feed-card__meta">Guided tour · ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}</span><h2>${escapeHtml(this.projectManager.current.presentation?.title || "Guided places")}</h2><p>Your tour is ready to view or share.</p><div class="feed-card__actions"><button data-route="tours">Open tour →</button></div></article>`);
    if (!cards.length) cards.push(`<div class="mobile-empty"><h2>No updates yet</h2><p>Updates from field tasks, watched values, comparisons, and project observations will appear here.</p><button data-route="more">Choose a workflow</button></div>`);
    return `<p class="mobile-workflow__subtitle">Your places. What changed.</p><div class="segmented">${[["projects","My projects"],["nearby","Nearby"],["attention","Needs attention"]].map(([id,label]) => `<button data-feed-scope="${id}" class="${scope === id ? "is-active" : ""}">${label}</button>`).join("")}</div><div class="feed-list">${cards.join("")}</div>`;
  }

  #compare() {
    const comparisons = this.store.snapshot().comparisons;
    const layers = this.projectManager.current.layers || [];
    return `<p class="mobile-workflow__subtitle">Review two observations, dates, or layers side by side.</p><form class="mobile-card" data-compare-form><label>Comparison name<input name="title" required placeholder="Before and after" /></label><label>First layer<select name="left">${layers.map((item) => `<option>${escapeHtml(item.title || item.url || "Layer")}</option>`).join("")}</select></label><label>Second layer<select name="right">${layers.map((item) => `<option>${escapeHtml(item.title || item.url || "Layer")}</option>`).join("")}</select></label><button type="submit">Save comparison</button></form><div class="feed-list">${comparisons.map((item) => `<article class="feed-card"><span class="feed-card__meta">Saved comparison</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.left)} ↔ ${escapeHtml(item.right)}</p></article>`).join("") || `<div class="mobile-empty"><h2>No comparisons</h2><p>Save a comparison to revisit a change without rebuilding it.</p></div>`}</div>`;
  }

  #tasks() {
    const tasks = this.store.snapshot().fieldTasks;
    return `<p class="mobile-workflow__subtitle">Assignments and drafts for work in the field.</p><button class="mobile-primary" data-new-task>+ New field task</button><div class="feed-list">${tasks.map((task) => `<article class="feed-card"><span class="status-pill">${escapeHtml(task.status || "draft")}</span><h2>${escapeHtml(task.title || "Untitled task")}</h2><p>${escapeHtml(task.location || "No location set")}</p><div class="feed-card__actions"><button data-open-task="${escapeHtml(task.id)}">Open task →</button></div></article>`).join("") || `<div class="mobile-empty"><h2>No field tasks</h2><p>Create a client-side draft with a location, checklist, and notes.</p></div>`}</div>`;
  }

  #taskEditor(task = {}) {
    return `<form class="mobile-card task-editor" data-task-form data-task-id="${escapeHtml(task.id || "")}"><label>Task title<input name="title" required value="${escapeHtml(task.title || "")}" placeholder="Inspect shoreline access" /></label><label>Location<input name="location" value="${escapeHtml(task.location || "")}" placeholder="Place or address" /></label><fieldset><legend>Checklist</legend>${["Access is clear", "Signage is readable", "Site condition documented"].map((label, index) => `<label class="check-row"><input type="checkbox" name="check${index}" ${task.checklist?.[index] ? "checked" : ""}/> ${label}</label>`).join("")}</fieldset><label>Field notes<textarea name="notes" rows="4">${escapeHtml(task.notes || "")}</textarea></label><label>Photos<input type="file" accept="image/*" capture="environment" multiple /></label><div class="feed-card__actions"><button type="submit">Save draft</button><button type="button" data-cancel-task>Cancel</button></div></form>`;
  }

  #watchlist() {
    const state = this.store.snapshot();
    return `<p class="mobile-workflow__subtitle">Your places. Your thresholds.</p><div class="feed-list">${state.watchRules.map((rule) => `<article class="feed-card"><span class="status-pill">${state.acknowledgements.includes(rule.id) ? "Acknowledged" : escapeHtml(rule.status || "Monitoring")}</span><h2>${escapeHtml(rule.title || "Watch rule")}</h2><p class="metric">${escapeHtml(rule.current ?? "—")} <small>${escapeHtml(rule.units || "")}</small></p><p>Notify when ${escapeHtml(rule.field || "value")} is ${escapeHtml(rule.operator || "above")} ${escapeHtml(rule.threshold ?? "—")}.</p><div class="feed-card__actions"><button data-ack-rule="${escapeHtml(rule.id)}">Acknowledge</button><button data-route="briefing">Open briefing →</button></div></article>`).join("") || `<div class="mobile-empty"><h2>No watched places</h2><p>Watch rules stored in the project will surface thresholds and delayed sources here.</p></div>`}</div>`;
  }

  #more() {
    return `<p class="mobile-workflow__subtitle">Focused mobile views use one screen at a time. Desktop dashboard layouts are intentionally unavailable here.</p><div class="workflow-grid"><button data-route="briefing"><strong>Briefing</strong><span>Selected features and context</span></button><button data-route="tours"><strong>Tours</strong><span>Guided places and chapters</span></button><button data-route="compare"><strong>Compare</strong><span>Before, after, and change</span></button><button data-route="watchlist"><strong>Watchlist</strong><span>Places and thresholds</span></button><button data-route="tasks"><strong>Field tasks</strong><span>Assignments and drafts</span></button><button data-open-mobile-menu><strong>Map tools</strong><span>Project, data, layers, and tools</span></button></div>`;
  }

  #click(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-workflow-close]")) return this.navigate("map");
    if (button.dataset.route) return this.navigate(button.dataset.route);
    if (button.dataset.feedScope) { this.store.setScope(button.dataset.feedScope); return; }
    if (button.matches("[data-new-task]")) { this.root.querySelector(".mobile-workflow__body").innerHTML = this.#taskEditor(); return; }
    if (button.dataset.openTask) { const task = this.store.snapshot().fieldTasks.find((item) => item.id === button.dataset.openTask); this.root.querySelector(".mobile-workflow__body").innerHTML = this.#taskEditor(task); return; }
    if (button.matches("[data-cancel-task]")) return this.render();
    if (button.dataset.ackRule) { this.store.acknowledge(button.dataset.ackRule); return; }
    if (button.matches("[data-open-mobile-menu]")) { this.navigate("map"); document.querySelector("#mobile-menu-toggle")?.click(); }
  }

  #change() {}

  #submit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.matches("[data-task-form]")) {
      this.store.saveTask({
        id: form.dataset.taskId || undefined,
        title: data.get("title"), location: data.get("location"), notes: data.get("notes"),
        checklist: [0, 1, 2].map((index) => data.has(`check${index}`)), status: "draft",
      });
      this.render();
    }
    if (form.matches("[data-compare-form]")) {
      this.store.update((state) => state.comparisons.unshift({ id: globalThis.crypto?.randomUUID?.() || `compare-${Date.now()}`, title: data.get("title"), left: data.get("left"), right: data.get("right"), createdAt: new Date().toISOString() }));
      this.render();
    }
  }

  #syncNav() {
    document.querySelectorAll("[data-mobile-workflow]").forEach((button) => button.classList.toggle("is-active", button.dataset.mobileWorkflow === this.route));
  }
}
