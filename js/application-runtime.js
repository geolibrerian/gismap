import { ApplicationState } from "./application-state.js?v=0.16.0";
import { PanelRegistry, ToolRegistry } from "./application-registry.js?v=0.16.0";
import { LayoutManager } from "./layout-manager.js?v=0.16.0";
import { normalizeApplicationConfig, presetApplication } from "./application-config.js?v=0.16.0";
import { DuckDBBrowserClient } from "./duckdb-client.js?v=0.16.0";
import { normalizeDataCatalog, planNaturalLanguageQuery, validateReadOnlySQL } from "./data-catalog.js?v=0.16.0";

const STATIC_PANELS = {
  places: "places-panel",
  bookmarks: "bookmarks-panel",
  draw: "draw-panel",
  intelligence: "intelligence-panel",
  layers: "layers-panel",
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export class ApplicationRuntime {
  constructor({ events, mapController, projectManager, aiController, documentRef = document }) {
    Object.assign(this, { events, mapController, projectManager, aiController, document: documentRef });
    this.state = new ApplicationState();
    this.tools = new ToolRegistry();
    this.panels = new PanelRegistry();
    this.staticHomes = new Map();
    this.layout = new LayoutManager({
      registry: this.panels,
      state: this.state,
      mapController,
      documentRef,
      onConfigChange: (application) => this.projectManager.setApplication(application),
      hosts: {
        left: documentRef.querySelector("#application-left-dock"),
        right: documentRef.querySelector("#application-right-dock"),
        bottom: documentRef.querySelector("#application-bottom-dock"),
        floating: documentRef.querySelector("#application-floating-dock"),
      },
    });
    this.undoStack = [];
    this.mapUndoStack = [];
    this.panelSessions = new Map();
    this.duckdb = new DuckDBBrowserClient();
  }

  initialize() {
    this.#registerTools();
    this.#registerPanels();
    this.#bridgeState();
  }

  apply(config, { preview = false } = {}) {
    if (preview) this.layout.beginPreview();
    const normalized = normalizeApplicationConfig(config);
    const previousLayout = this.layout.current?.layout?.kind;
    this.document.querySelector("#app").dataset.applicationPreset = normalized.preset;
    this.document.querySelector("#app").dataset.presentationSkin = normalized.skin;
    this.document.body.dataset.applicationMode = normalized.mode;
    this.document.querySelector("#application-edit-return").hidden = normalized.mode !== "present";
    const applied = this.layout.apply(normalized, this.#context());
    if (normalized.layout.kind === "globe" && previousLayout !== "globe") this.mapController.navigate("home").catch(() => {});
    const visibleTypes = new Set(normalized.panels
      .filter((panel) => normalized.mode !== "present" || panel.audienceVisible)
      .map((panel) => panel.type));
    for (const [type, elementId] of Object.entries(STATIC_PANELS)) {
      const element = this.document.getElementById(elementId);
      if (element) element.hidden = !visibleTypes.has(type);
    }
    const welcome = this.document.querySelector("#welcome-panel");
    if (welcome && normalized.preset !== "standard") welcome.hidden = true;
    return applied;
  }

  cancelPreview() { return this.layout.cancelPreview(this.#context()); }
  commitPreview() { this.layout.commitPreview(); }

  setMode(mode) {
    const next = { ...(this.layout.current || presetApplication()), mode: mode === "present" ? "present" : "edit" };
    return this.apply(next);
  }

  snapshot() { return normalizeApplicationConfig(this.layout.current || presetApplication()); }

  async runTool(id, input, { preview = false } = {}) {
    if (preview) this.undoStack.push(this.snapshot());
    return this.tools.execute(id, input, this.#context());
  }

  undo() {
    const previousView = this.mapUndoStack.pop();
    if (previousView) {
      this.mapController.restoreView(previousView).catch(() => {});
      return true;
    }
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.apply(previous);
    return true;
  }

  planRequest(prompt) {
    const request = String(prompt || "").trim();
    if (!request) throw new Error("Describe the application you want to build.");
    let config = this.snapshot();
    const operations = [];
    const preset = ["briefing", "explorer", "atlas", "standard", "ai-map"].find((id) => new RegExp(`\\b${id.replace("-", "[ -]")}\\b`, "i").test(request));
    if (preset) {
      config = presetApplication(preset);
      operations.push({ tool: "application.preset.apply", input: { preset } });
    }
    const layer = this.mapController.getOperationalLayers().find((item) => request.toLowerCase().includes(String(item.title || "").toLowerCase()))
      || (/incident/i.test(request) ? this.mapController.getOperationalLayers().find((item) => /incident/i.test(item.title || "")) : null);
    if (/\bchart\b/i.test(request) && !config.panels.some((panel) => panel.type === "charts")) {
      config.panels.push({ instanceId: `charts-${Date.now()}`, type: "charts", title: /category/i.test(request) ? "Category chart" : "Chart", placement: { region: "bottom", order: config.panels.length }, binding: layer ? { layerId: layer.uid, followActiveLayer: false } : { followActiveLayer: true }, settings: { chartType: /category/i.test(request) ? "category" : "histogram" }, audienceVisible: true });
      operations.push({ tool: "application.chart.create", input: { layerId: layer?.uid || null } });
    }
    if (layer) config.panels = config.panels.map((panel) => ({ ...panel, binding: { ...panel.binding, layerId: layer.uid, followActiveLayer: false } }));
    return { summary: `Preview ${config.title}${layer ? ` with ${layer.title}` : ""}.`, operations, config: normalizeApplicationConfig(config) };
  }

  previewPlan(plan) {
    if (!plan?.config) throw new Error("A validated builder plan is required.");
    this.undoStack.push(this.snapshot());
    return this.apply(normalizeApplicationConfig(plan.config), { preview: true });
  }

  #context() {
    return { runtime: this, events: this.events, state: this.state, mapController: this.mapController, projectManager: this.projectManager, aiController: this.aiController };
  }

  #bridgeState() {
    this.events.subscribe("layer:added", ({ layer }) => this.state.dispatch("layer:activate", { layerId: layer?.uid }, { undoable: false }));
    this.events.subscribe("layer:removed", ({ uid }) => {
      if (this.state.value.activeLayerId === uid) this.state.dispatch("layer:activate", { layerId: this.mapController.getOperationalLayers()[0]?.uid || null }, { undoable: false });
    });
    this.events.subscribe("identify:complete", ({ results = [] }) => {
      const feature = results[0];
      this.state.dispatch("selection:set", {
        layerId: feature?.layerUid || null,
        objectIds: feature?.objectId == null ? [] : [feature.objectId],
        features: feature ? [{ attributes: feature.attributes || {}, geometry: feature.geometry || null, layerTitle: feature.layerTitle }] : [],
      }, { undoable: false });
    });
    this.events.subscribe("bookmarks:changed", ({ bookmarks }) => this.state.replace({ bookmarks: bookmarks || [] }, { undoable: false }));
    this.state.subscribe((filters) => {
      const layers = this.mapController.getOperationalLayers();
      for (const layer of layers) {
        const expressions = Object.values(filters)
          .filter((filter) => filter.layerId === layer.uid && typeof filter.expression?.where === "string")
          .map((filter) => `(${filter.expression.where})`);
        this.mapController.setDefinitionExpression?.(layer.uid, expressions.join(" AND ") || "");
      }
      this.events.publish("application:filters-changed", { filters });
    }, (state) => state.filters);
  }

  #registerTools() {
    const applicationChange = (id, displayName, transform) => this.tools.register({
      id, displayName,
      validate: (input) => input && typeof input === "object" ? true : "A configuration object is required.",
      execute: (input) => {
        const current = this.snapshot();
        return this.apply(transform(current, input));
      },
    });
    applicationChange("application.preset.apply", "Apply application preset", (_config, input) => {
      if (!["standard", "explorer", "briefing", "atlas", "ai-map"].includes(input.preset)) throw new Error(`Unknown application preset: ${input.preset}`);
      return presetApplication(input.preset);
    });
    applicationChange("application.panel.add", "Add panel", (config, input) => {
      const type = this.panels.get(input.type);
      if (!type) throw new Error(`Unknown panel type: ${input.type}`);
      const instanceId = input.instanceId || `${input.type}-${crypto.randomUUID?.() || Date.now()}`;
      config.panels.push({ instanceId, type: input.type, title: input.title || type.displayName, placement: { region: input.region || type.placements[0], order: config.panels.length }, binding: input.binding || { followActiveLayer: true }, settings: input.settings || {}, audienceVisible: input.audienceVisible !== false });
      return config;
    });
    applicationChange("application.panel.remove", "Remove panel", (config, input) => ({ ...config, panels: config.panels.filter((panel) => panel.instanceId !== input.instanceId) }));
    applicationChange("application.panel.configure", "Configure panel", (config, input) => ({ ...config, panels: config.panels.map((panel) => panel.instanceId === input.instanceId ? { ...panel, ...input.changes } : panel) }));
    applicationChange("application.panel.bind", "Bind dataset", (config, input) => ({ ...config, panels: config.panels.map((panel) => panel.instanceId === input.instanceId ? { ...panel, binding: { ...panel.binding, ...input.binding } } : panel) }));
    applicationChange("application.layout.change", "Change layout", (config, input) => ({ ...config, panels: config.panels.map((panel) => panel.instanceId === input.instanceId ? { ...panel, placement: { ...panel.placement, ...input.placement } } : panel) }));
    applicationChange("application.layout.mode", "Change layout mode", (config, input) => ({ ...config, layout: { ...config.layout, kind: input.kind || "workspace" } }));
    applicationChange("application.skin.change", "Change skin", (config, input) => ({ ...config, skin: input.skin || config.skin }));
    applicationChange("application.chart.create", "Create chart", (config, input) => {
      config.panels.push({ instanceId: input.instanceId || `charts-${config.panels.filter((item) => item.type === "charts").length + 1}`, type: "charts", title: input.title || "Chart", placement: { region: input.region || "bottom", order: config.panels.length }, binding: input.binding || { followActiveLayer: true }, settings: input.settings || {}, audienceVisible: true });
      return config;
    });
    this.tools.register({ id: "project.filter.apply", displayName: "Apply filter", execute: (input) => this.state.dispatch("filters:set", input) });
    this.tools.register({ id: "project.chapter.create", displayName: "Create chapter", execute: (input) => this.state.dispatch("chapter:create", input) });
    this.tools.register({ id: "map.navigate", displayName: "Navigate map", validate: (input) => ["home", "in", "out", "rotate-left", "rotate-right", "tilt-up", "tilt-down"].includes(input?.action) || "Unsupported map navigation action.", execute: (input) => {
      this.mapUndoStack.push(this.mapController.getViewState());
      return this.mapController.navigate(input.action);
    } });
    this.tools.register({ id: "map.basemap.change", displayName: "Change basemap", validate: (input) => typeof input?.id === "string" && input.id ? true : "Choose a basemap.", execute: (input) => this.mapController.setBasemap(input.id) });
  }

  #registerPanels() {
    for (const [type, elementId] of Object.entries(STATIC_PANELS)) {
      this.panels.register({
        type,
        displayName: type[0].toUpperCase() + type.slice(1),
        description: `Existing ${type} workspace tools.`,
        category: type === "intelligence" ? "Analysis" : "Workspace",
        placements: ["left", "right", "bottom", "floating"],
        multiple: false,
        mount: (host) => {
          const element = this.document.getElementById(elementId);
          if (!element) return;
          if (!this.staticHomes.has(elementId)) this.staticHomes.set(elementId, { parent: element.parentElement, next: element.nextSibling });
          element.hidden = false;
          element.open = true;
          host.append(element);
          return { element };
        },
        unmount: (_host, mounted) => {
          const element = mounted?.element;
          const home = this.staticHomes.get(elementId);
          if (!element || !home?.parent) return;
          home.parent.insertBefore(element, home.next?.isConnected ? home.next : null);
        },
      });
    }
    this.panels.register({
      type: "attributes", displayName: "Attributes", description: "Details for the shared selection.", category: "Data", bindings: ["active-layer", "fixed-layer", "shared-selection"], placements: ["left", "right", "bottom", "floating"], multiple: false,
      mount: (host, context) => {
        const render = (selection) => {
          const feature = selection.features?.[0];
          host.innerHTML = feature ? `<div class="composable-details"><span class="eyebrow">${escapeHtml(feature.layerTitle || "Selected feature")}</span><dl>${Object.entries(feature.attributes || {}).slice(0, 20).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></div>` : `<div class="panel-empty"><strong>No feature selected</strong><p>Select a feature on the map or in a linked panel.</p></div>`;
        };
        render(context.state.value.selection);
        const subscription = context.state.subscribe(render, (state) => state.selection);
        context.onCleanup(() => subscription.remove());
      },
    });
    this.panels.register({
      type: "charts", displayName: "Charts", description: "Computed summaries with linked filters.", category: "Analysis", bindings: ["active-layer", "fixed-layer", "shared-selection", "shared-time"], placements: ["left", "right", "bottom", "floating"],
      mount: (host, context) => {
        const id = context.config.instanceId;
        let bins = [];
        let layer = null;
        let field = null;
        const render = (filters) => {
          if (!bins.length || !layer || !field) return;
          const active = Boolean(filters[`${id}:range`]);
          const max = Math.max(...bins.map((bin) => bin.count), 1);
          host.innerHTML = `<div class="composable-chart"><span class="eyebrow">${escapeHtml(layer.title || "Active layer")}</span><strong>${escapeHtml(field.alias || field.name)} distribution</strong><div class="composable-chart__bars" aria-label="Distribution of ${escapeHtml(field.alias || field.name)}">${bins.map((bin, index) => `<button type="button" data-chart-bin="${index}" title="${bin.min.toLocaleString()}–${bin.max.toLocaleString()}: ${bin.count}"><i style="height:${Math.max(4, bin.count / max * 100)}%"></i></button>`).join("")}</div><p>${bins.reduce((sum, bin) => sum + bin.count, 0).toLocaleString()} loaded values${active ? " · linked range filter active" : ""}</p>${active ? `<button type="button" data-chart-clear>Clear this chart filter</button>` : ""}</div>`;
          host.querySelectorAll("[data-chart-bin]").forEach((button) => button.addEventListener("click", () => {
            const bin = bins[Number(button.dataset.chartBin)];
            const quoted = field.name.replaceAll('"', '""');
            context.dispatch("filters:set", { id: `${id}:range`, owner: id, scope: "project", layerId: layer.uid, expression: { kind: "range", field: field.name, min: bin.min, max: bin.max, where: `\"${quoted}\" >= ${bin.min} AND \"${quoted}\" <= ${bin.max}` } });
          }));
          host.querySelector("[data-chart-clear]")?.addEventListener("click", () => context.dispatch("filters:clear", { id: `${id}:range` }));
        };
        host.innerHTML = `<div class="panel-empty"><strong>Computing chart…</strong><p>Reading numeric values from the bound dataset.</p></div>`;
        void (async () => {
          layer = this.mapController.findLayer(context.config.binding?.layerId) || this.mapController.findLayer(context.state.value.activeLayerId) || this.mapController.getOperationalLayers()[0];
          if (!layer?.queryFeatures) {
            host.innerHTML = `<div class="panel-empty"><strong>Choose a feature layer</strong><p>This chart needs a queryable dataset binding.</p></div>`;
            return;
          }
          await layer.load?.();
          field = layer.fields?.find((item) => item.name === context.config.settings?.field) || layer.fields?.find((item) => /(?:double|integer|small-integer|single|long|short)/i.test(item.type || "") && item.name !== layer.objectIdField);
          if (!field) {
            host.innerHTML = `<div class="panel-empty"><strong>Choose a numeric field</strong><p>${escapeHtml(layer.title || "This layer")} has no automatically detected numeric measure.</p></div>`;
            return;
          }
          const result = await layer.queryFeatures({ where: layer.definitionExpression || "1=1", outFields: [field.name], returnGeometry: false, num: 1000 });
          const values = result.features.map((feature) => Number(feature.attributes?.[field.name])).filter(Number.isFinite);
          if (!values.length) {
            host.innerHTML = `<div class="panel-empty"><strong>No numeric values</strong><p>The selected field has no values in the loaded query.</p></div>`;
            return;
          }
          const min = Math.min(...values); const maxValue = Math.max(...values); const width = (maxValue - min || 1) / 8;
          bins = Array.from({ length: 8 }, (_, index) => ({ min: min + width * index, max: index === 7 ? maxValue : min + width * (index + 1), count: 0 }));
          values.forEach((value) => { bins[Math.min(7, Math.floor((value - min) / width))].count += 1; });
          render(context.state.value.filters);
        })().catch((error) => { host.innerHTML = `<div class="panel-empty"><strong>Chart unavailable</strong><p>${escapeHtml(error.message)}</p></div>`; });
        const subscription = context.state.subscribe(render, (state) => state.filters);
        context.onCleanup(() => subscription.remove());
      },
    });
    this.panels.register({
      type: "chapters", displayName: "Chapters", description: "Author and play guided map presentations.", category: "Presentation", bindings: ["shared-selection", "shared-time"], placements: ["left", "right", "bottom"], multiple: false, status: "conditional",
      availability: () => ({ available: Boolean(this.projectManager.current.presentation?.chapters?.length), reason: "Add an Atlas chapter first." }),
      mount: (host, context) => {
        const chapters = context.config.settings?.chapters || this.projectManager.current.presentation?.chapters || [];
        host.innerHTML = chapters.length ? `<ol class="composable-chapters">${chapters.map((chapter) => `<li><strong>${escapeHtml(chapter.title || "Chapter")}</strong><small>${escapeHtml(chapter.body || "Saved map view")}</small></li>`).join("")}</ol>` : `<div class="panel-empty"><strong>No chapters yet</strong><p>Capture a map view in Atlas edit mode to add the first chapter.</p></div>`;
      },
    });
    this.panels.register({
      type: "ai-chatbot", displayName: "AI Map Assistant", description: "Query data and run approved map actions through the shared tool registry.", category: "Analysis", bindings: ["active-layer", "shared-selection", "shared-time"], placements: ["left", "right", "bottom", "floating"], multiple: false,
      mount: (host, context) => this.#mountAIQueryPanel(host, context),
    });
    this.panels.register({
      type: "data-catalog", displayName: "Data Catalog", description: "Named, versioned analytical relations and source metadata.", category: "Data", bindings: ["active-layer", "fixed-layer"], placements: ["left", "right", "bottom"], multiple: false,
      mount: (host, context) => this.#mountCatalogPanel(host, context),
    });
    this.panels.register({
      type: "sql", displayName: "SQL Workspace", description: "Run validated read-only SQL locally with DuckDB-Wasm.", category: "Analysis", bindings: ["active-layer", "fixed-layer"], placements: ["left", "right", "bottom", "floating"], multiple: true,
      mount: (host, context) => this.#mountSQLPanel(host, context),
    });
  }

  #catalogWithActiveLayer() {
    const stored = normalizeDataCatalog(this.projectManager.current.dataCatalog);
    if (stored.relations.length) return stored;
    const layer = this.mapController.findLayer(this.state.value.activeLayerId) || this.mapController.getOperationalLayers()[0];
    if (!layer) return stored;
    return normalizeDataCatalog({
      ...stored,
      relations: [{
        name: "active_layer", title: layer.title || "Active layer", description: "Browser-loaded feature records from the active map layer.",
        source: { format: "json", layerId: layer.uid },
        schema: (layer.fields || []).map((field) => ({ name: field.name, type: this.#duckType(field.type), unit: null })),
      }],
    });
  }

  #duckType(type) {
    if (/date/i.test(type || "")) return "TIMESTAMP";
    if (/double|single|float/i.test(type || "")) return "DOUBLE";
    if (/integer|small|long|short|oid/i.test(type || "")) return "BIGINT";
    return "VARCHAR";
  }

  async #layerRows(layerId) {
    const layer = this.mapController.findLayer(layerId);
    if (!layer?.queryFeatures) throw new Error("The catalog relation is not bound to a queryable feature layer.");
    const result = await layer.queryFeatures({ where: layer.definitionExpression || "1=1", outFields: ["*"], returnGeometry: false, num: 5000 });
    return result.features.map((feature) => feature.attributes || {});
  }

  #mountCatalogPanel(host, context) {
    const render = () => {
      const catalog = this.#catalogWithActiveLayer();
      host.innerHTML = `<div class="catalog-panel"><div><span class="eyebrow">Versioned data catalog</span><h3>${escapeHtml(catalog.title)}</h3><p>Stable relation names are stored with the project; source data remains external or in the active browser layer.</p></div>${catalog.relations.map((relation) => `<article><strong>${escapeHtml(relation.title)}</strong><code>${escapeHtml(relation.name)}</code><small>${escapeHtml(relation.description || `${relation.source.format} source`)}</small><span>${relation.schema.length} fields · ${escapeHtml(relation.source.format)}</span></article>`).join("") || `<div class="panel-empty"><strong>No catalog relations</strong><p>Add a queryable layer or import a catalog manifest.</p></div>`}<p class="form-note">View-only catalogs are analytical recipes, not access control. Readers still need permission to every referenced source.</p></div>`;
    };
    render();
    const subscription = this.events.subscribe("catalog:changed", render);
    context.onCleanup(() => subscription.remove());
  }

  #mountAIQueryPanel(host, context) {
    const catalog = this.#catalogWithActiveLayer();
    const session = this.panelSessions.get(context.config.instanceId) || { prompt: "", messages: [] };
    this.panelSessions.set(context.config.instanceId, session);
    host.innerHTML = `<form class="ai-query-panel"><div><span class="eyebrow">AI-native map</span><strong>Approved actions only</strong></div><div class="ai-query-panel__quick" aria-label="Quick map actions"><button type="button" data-ai-action="home">Full globe</button><button type="button" data-ai-action="in">Zoom in</button><button type="button" data-ai-action="out">Zoom out</button><button type="button" data-ai-tools>Other tools</button><button type="button" data-ai-undo>Undo</button></div><label class="field"><span>Ask about the map or catalog data</span><textarea rows="4" data-ai-query placeholder="Show active_layer records where value is above 10">${escapeHtml(session.prompt)}</textarea></label><div class="sql-panel__actions"><button type="submit">Build reviewed action</button><button type="button" class="button--quiet" data-ai-cancel disabled>Cancel</button></div><div data-ai-plan class="sql-status">${session.messages.length ? session.messages.map((message) => `<p>${escapeHtml(message)}</p>`).join("") : "Conversation stays available while layouts and themes change. Unsupported requests are explained instead of guessed."}</div></form>`;
    const form = host.querySelector("form");
    host.querySelectorAll("[data-ai-action]").forEach((button) => button.addEventListener("click", async () => {
      const action = button.dataset.aiAction;
      const output = host.querySelector("[data-ai-plan]");
      output.textContent = `Running ${action}…`;
      try { await context.runtime.runTool("map.navigate", { action }); session.messages.push(`Map action completed: ${action}.`); output.textContent = session.messages.at(-1); }
      catch (error) { output.textContent = `Unavailable: ${error.message}`; }
    }));
    host.querySelector("[data-ai-tools]").addEventListener("click", () => context.runtime.runTool("application.layout.mode", { kind: "workspace" }, { preview: true }));
    host.querySelector("[data-ai-undo]").addEventListener("click", () => { host.querySelector("[data-ai-plan]").textContent = context.runtime.undo() ? "Undid the last reversible application change." : "There is no reversible application change to undo."; });
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const output = host.querySelector("[data-ai-plan]");
      const cancel = host.querySelector("[data-ai-cancel]");
      session.prompt = host.querySelector("[data-ai-query]").value;
      cancel.disabled = false;
      output.textContent = "Planning a constrained action…";
      try {
        const plan = planNaturalLanguageQuery(session.prompt, catalog);
        session.messages.push(plan.explanation);
        output.innerHTML = `<strong>${escapeHtml(plan.explanation)}</strong><code>${escapeHtml(plan.sql)}</code><div><button type="button" data-ai-run>Run in SQL workspace</button>${plan.filter ? `<button type="button" class="button--quiet" data-ai-filter>Apply map filter</button>` : ""}</div>`;
        output.querySelector("[data-ai-run]").addEventListener("click", () => context.runtime.runTool("application.panel.add", { type: "sql", title: "AI SQL query", region: "bottom", settings: { sql: plan.sql } }));
        output.querySelector("[data-ai-filter]")?.addEventListener("click", () => {
          const field = String(plan.filter.field).replaceAll('"', '""');
          context.dispatch("filters:set", { id: `${context.config.instanceId}:nlp`, owner: context.config.instanceId, scope: "project", layerId: plan.filter.layerId, expression: { kind: "comparison", ...plan.filter, where: `"${field}" ${plan.filter.operator} ${plan.filter.value}` } });
        });
      } catch (error) { output.textContent = `Unavailable: ${error.message}`; }
      finally { cancel.disabled = true; }
    });
    host.querySelector("[data-ai-cancel]").addEventListener("click", () => { host.querySelector("[data-ai-plan]").textContent = "Request cancelled. No map changes were applied."; });
  }

  #mountSQLPanel(host, context) {
    const initial = context.config.settings?.sql || "SELECT * FROM active_layer LIMIT 25";
    host.innerHTML = `<form class="sql-panel"><div class="sql-panel__heading"><span class="eyebrow">Local DuckDB-Wasm</span><strong>Read-only SQL</strong></div><label class="field"><span>Query</span><textarea data-sql rows="5" spellcheck="false">${escapeHtml(initial)}</textarea></label><div class="sql-panel__actions"><button type="submit">Run query</button><button type="button" class="button--quiet" data-sql-sample>Reset example</button></div><p class="form-note">Only one read-only statement is accepted. Results are capped at 500 rows in the interface.</p><div data-sql-output class="sql-status">DuckDB loads on first run; remote sources remain subject to HTTPS, CORS, and source permissions.</div></form>`;
    const form = host.querySelector("form");
    host.querySelector("[data-sql-sample]").addEventListener("click", () => { host.querySelector("[data-sql]").value = "SELECT * FROM active_layer LIMIT 25"; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const output = host.querySelector("[data-sql-output]");
      const button = form.querySelector("button[type=submit]");
      try {
        const sql = validateReadOnlySQL(host.querySelector("[data-sql]").value);
        button.disabled = true; output.textContent = "Loading catalog and running locally…";
        const catalog = this.#catalogWithActiveLayer();
        await this.duckdb.loadCatalog(catalog, (layerId) => this.#layerRows(layerId));
        const rows = (await this.duckdb.query(sql)).slice(0, 500);
        const fields = Object.keys(rows[0] || {});
        output.innerHTML = rows.length ? `<div class="sql-result"><table><thead><tr>${fields.map((field) => `<th>${escapeHtml(field)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${fields.map((field) => `<td>${escapeHtml(row[field])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><p>${rows.length} rows shown.</p>` : "Query returned no rows.";
      } catch (error) { output.innerHTML = `<strong>Query unavailable</strong><p>${escapeHtml(error.message)}</p>`; }
      finally { button.disabled = false; }
    });
  }
}
