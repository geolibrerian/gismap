import { MobileFeedStore } from "./mobile-feed-store.js?v=0.17.0";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateLabel = (value) => value ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value)) : "Recently";

export class MobileWorkflowRouter {
  constructor({ events, projectManager, mapController, prepareWorkflow, openWorkflow, shareWorkflow }) {
    Object.assign(this, { events, projectManager, mapController, prepareWorkflow, openWorkflow, shareWorkflow });
    this.media = matchMedia("(max-width: 640px), (max-width: 880px) and (orientation: portrait)");
    this.store = new MobileFeedStore({ projectManager, events });
    this.root = document.querySelector("#mobile-workflow-root");
    this.route = "map";
    this.activePanelId = null;
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
      document.body.classList.remove("mobile-workflow-open");
      this.#closeMenu();
      this.#syncNav();
    });
    this.events.subscribe?.("mobile:panel-active", ({ panelId }) => {
      this.activePanelId = panelId || null;
      this.#syncNav();
    });
    this.events.subscribe?.("mobile:menu-toggled", () => this.#syncNav());
    this.media.addEventListener?.("change", ({ matches }) => { if (!matches) this.navigate("map"); else this.#syncNav(); });
    this.#syncNav();
    this.#importSharedTask();
  }

  navigate(route) {
    if (!this.media.matches) return;
    if (!["map", "briefing", "tours", "tasks", "more"].includes(route)) route = "more";
    this.#closeMenu();
    this.prepareWorkflow?.(route);
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
      document.body.classList.remove("mobile-workflow-open");
      this.#syncNav();
      this.openWorkflow(route);
      return;
    }
    this.route = route;
    this.root.hidden = false;
    document.body.classList.add("mobile-workflow-open");
    this.render();
    this.#syncNav();
  }

  render() {
    if (!this.root || this.root.hidden) return;
    const renderer = { tasks: () => this.#tasks(), more: () => this.#more() }[this.route] || (() => this.#more());
    this.root.innerHTML = `<header class="mobile-workflow__header"><div><span class="mobile-workflow__brand">GISMap Online</span><h1>${escapeHtml(this.#title())}</h1></div><button type="button" data-workflow-close aria-label="Return to map">×</button></header><div class="mobile-workflow__body">${renderer()}</div>`;
  }

  #title() { return ({ tasks: "Field tasks", more: "Workflows" })[this.route] || "Workflows"; }

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
    return `<p class="mobile-workflow__subtitle">Assignments and drafts for work in the field. Share a task link or QR code with another device.</p><button class="mobile-primary" data-new-task>+ New field task</button><div class="feed-list">${tasks.map((task) => `<article class="feed-card"><span class="status-pill">${escapeHtml(task.status || "draft")}</span><h2>${escapeHtml(task.title || "Untitled task")}</h2><p>${escapeHtml(task.location || "No location set")}</p>${task.capturedAt ? `<span class="feed-card__meta">Captured ${dateLabel(task.capturedAt)}${Number.isFinite(task.latitude) ? ` · ${Number(task.latitude).toFixed(5)}, ${Number(task.longitude).toFixed(5)}` : ""}</span>` : ""}<div class="feed-card__actions"><button data-open-task="${escapeHtml(task.id)}">Open task →</button><button data-share-task="${escapeHtml(task.id)}">Share QR</button></div></article>`).join("") || `<div class="mobile-empty"><h2>No field tasks</h2><p>Create a client-side draft with a location, checklist, notes, and capture time.</p></div>`}</div>`;
  }

  #taskEditor(task = {}) {
    return `<form class="mobile-card task-editor" data-task-form data-task-id="${escapeHtml(task.id || "")}"><label>Task title<input name="title" required value="${escapeHtml(task.title || "")}" placeholder="Inspect shoreline access" /></label><label>Location<input name="location" value="${escapeHtml(task.location || "")}" placeholder="Place or address" /></label><input type="hidden" name="longitude" value="${escapeHtml(task.longitude ?? "")}"><input type="hidden" name="latitude" value="${escapeHtml(task.latitude ?? "")}"><input type="hidden" name="capturedAt" value="${escapeHtml(task.capturedAt || "")}"><div class="task-location-status" data-task-location-status>${task.capturedAt ? `Captured ${escapeHtml(dateLabel(task.capturedAt))}${Number.isFinite(task.latitude) ? ` · ${Number(task.latitude).toFixed(5)}, ${Number(task.longitude).toFixed(5)}` : ""}` : "Location and time have not been captured."}</div><button type="button" data-capture-task-location>Capture current map location &amp; time</button><fieldset><legend>Checklist</legend>${["Access is clear", "Signage is readable", "Site condition documented"].map((label, index) => `<label class="check-row"><input type="checkbox" name="check${index}" ${task.checklist?.[index] ? "checked" : ""}/> ${label}</label>`).join("")}</fieldset><label>Field notes<textarea name="notes" rows="4">${escapeHtml(task.notes || "")}</textarea></label><label>Photos<input name="photos" type="file" accept="image/*" capture="environment" multiple /></label>${task.photos?.length ? `<p>${task.photos.length} photo${task.photos.length === 1 ? "" : "s"} attached</p>` : ""}<div class="feed-card__actions"><button type="submit">Save draft</button><button type="button" data-cancel-task>Cancel</button></div></form>`;
  }

  #watchlist() {
    const state = this.store.snapshot();
    return `<p class="mobile-workflow__subtitle">Your places. Your thresholds.</p><div class="feed-list">${state.watchRules.map((rule) => `<article class="feed-card"><span class="status-pill">${state.acknowledgements.includes(rule.id) ? "Acknowledged" : escapeHtml(rule.status || "Monitoring")}</span><h2>${escapeHtml(rule.title || "Watch rule")}</h2><p class="metric">${escapeHtml(rule.current ?? "—")} <small>${escapeHtml(rule.units || "")}</small></p><p>Notify when ${escapeHtml(rule.field || "value")} is ${escapeHtml(rule.operator || "above")} ${escapeHtml(rule.threshold ?? "—")}.</p><div class="feed-card__actions"><button data-ack-rule="${escapeHtml(rule.id)}">Acknowledge</button><button data-route="briefing">Open briefing →</button></div></article>`).join("") || `<div class="mobile-empty"><h2>No watched places</h2><p>Watch rules stored in the project will surface thresholds and delayed sources here.</p></div>`}</div>`;
  }

  #more() {
    return `<p class="mobile-workflow__subtitle">The mobile app keeps the map and three shareable workflows focused and easy to reach.</p><div class="workflow-grid"><button data-route="briefing"><strong>Briefing</strong><span>Selected features and context · share by QR</span></button><button data-route="tours"><strong>Tours</strong><span>Guided places and chapters · share by QR</span></button><button data-route="tasks"><strong>Field tasks</strong><span>Assignments and drafts · share by QR</span></button><button data-route="map"><strong>Map tools</strong><span>Places, bookmarks, draw, layers, and intelligence</span></button></div><section class="account-workflows"><span>With an account · coming soon</span><p>Updates, Compare, Watchlist, custom dashboards, and their desktop authoring tools.</p></section>`;
  }

  async #click(event) {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-workflow-close]")) return this.navigate("map");
    if (button.dataset.route) return this.navigate(button.dataset.route);
    if (button.dataset.feedScope) { this.store.setScope(button.dataset.feedScope); return; }
    if (button.matches("[data-new-task]")) { this.root.querySelector(".mobile-workflow__body").innerHTML = this.#taskEditor(); await this.#captureTaskLocation(this.root.querySelector("[data-task-form]")); return; }
    if (button.dataset.openTask) { const task = this.store.snapshot().fieldTasks.find((item) => item.id === button.dataset.openTask); this.root.querySelector(".mobile-workflow__body").innerHTML = this.#taskEditor(task); return; }
    if (button.matches("[data-cancel-task]")) return this.render();
    if (button.matches("[data-capture-task-location]")) return this.#captureTaskLocation(button.closest("form"));
    if (button.dataset.shareTask) return this.#shareTask(button.dataset.shareTask);
    if (button.dataset.ackRule) { this.store.acknowledge(button.dataset.ackRule); return; }
    if (button.matches("[data-open-mobile-menu]")) { this.navigate("map"); document.querySelector("#mobile-menu-toggle")?.click(); }
  }

  #change() {}

  async #submit(event) {
    event.preventDefault();
    const form = event.target;
    const data = new FormData(form);
    if (form.matches("[data-task-form]")) {
      const existing = this.store.snapshot().fieldTasks.find((item) => item.id === form.dataset.taskId);
      const uploaded = await Promise.all([...form.querySelector('[name="photos"]')?.files || []].slice(0, 6).map((file) => this.#fileDataUrl(file)));
      this.store.saveTask({
        id: form.dataset.taskId || undefined,
        title: data.get("title"), location: data.get("location"), notes: data.get("notes"),
        longitude: Number(data.get("longitude")), latitude: Number(data.get("latitude")), capturedAt: data.get("capturedAt") || new Date().toISOString(),
        photos: [...(existing?.photos || []), ...uploaded], checklist: [0, 1, 2].map((index) => data.has(`check${index}`)), status: "draft",
      });
      this.render();
    }
    if (form.matches("[data-compare-form]")) {
      this.store.update((state) => state.comparisons.unshift({ id: globalThis.crypto?.randomUUID?.() || `compare-${Date.now()}`, title: data.get("title"), left: data.get("left"), right: data.get("right"), createdAt: new Date().toISOString() }));
      this.render();
    }
  }

  #syncNav() {
    const menuOpen = document.body.classList.contains("mobile-menu-open");
    document.querySelectorAll("[data-mobile-workflow]").forEach((button) => {
      button.classList.toggle("is-active", !menuOpen && !this.activePanelId && button.dataset.mobileWorkflow === this.route);
    });
    const menuToggle = document.querySelector("#mobile-menu-toggle");
    menuToggle?.classList.toggle("is-active", menuOpen);
    menuToggle?.setAttribute("aria-expanded", String(menuOpen));
    document.body.classList.toggle("mobile-map-route", this.media.matches && this.route === "map");
  }

  #closeMenu() {
    const drawer = document.querySelector("#mobile-menu-drawer");
    if (drawer) drawer.hidden = true;
    document.body.classList.remove("mobile-menu-open");
    const menuToggle = document.querySelector("#mobile-menu-toggle");
    menuToggle?.classList.remove("is-active");
    menuToggle?.setAttribute("aria-expanded", "false");
  }

  async #captureTaskLocation(form) {
    if (!form || !this.mapController.view?.center) return;
    const point = this.mapController.view.center;
    const location = this.mapController.geographicCoordinates(point);
    const capturedAt = new Date().toISOString();
    form.elements.longitude.value = location?.longitude ?? point.longitude ?? point.x ?? "";
    form.elements.latitude.value = location?.latitude ?? point.latitude ?? point.y ?? "";
    form.elements.capturedAt.value = capturedAt;
    let address = "";
    try { address = (await this.mapController.reverseGeocode(location?.point || point))?.address || ""; } catch { /* coordinates remain useful offline */ }
    if (address) form.elements.location.value = address;
    const status = form.querySelector("[data-task-location-status]");
    if (status) status.textContent = `Captured ${dateLabel(capturedAt)} · ${Number(form.elements.latitude.value).toFixed(5)}, ${Number(form.elements.longitude.value).toFixed(5)}`;
  }

  #fileDataUrl(file) {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
  }

  async #shareTask(id) {
    const task = this.store.snapshot().fieldTasks.find((item) => item.id === id);
    if (!task) return;
    return this.shareWorkflow?.("tasks", { task: { ...task, photos: [] } });
  }

  #importSharedTask() {
    const encoded = new URLSearchParams(location.hash.replace(/^#/, "")).get("fieldTask");
    if (!encoded) return;
    try {
      const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
      const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
      const task = JSON.parse(new TextDecoder().decode(bytes));
      if (!task?.title || typeof task !== "object") throw new Error("Invalid field task");
      this.store.saveTask({ ...task, id: task.id || globalThis.crypto?.randomUUID?.() || `task-${Date.now()}`, status: task.status || "shared" });
    } catch { /* A malformed shared task must not interrupt map startup. */ }
  }
}
