import { ApplicationState } from "./application-state.js?v=0.15.40";
import { PanelRegistry, ToolRegistry } from "./application-registry.js?v=0.15.40";
import { LayoutManager } from "./layout-manager.js?v=0.15.40";
import { normalizeApplicationConfig, presetApplication } from "./application-config.js?v=0.15.40";

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
      hosts: {
        left: documentRef.querySelector("#application-left-dock"),
        right: documentRef.querySelector("#application-right-dock"),
        bottom: documentRef.querySelector("#application-bottom-dock"),
        floating: documentRef.querySelector("#application-floating-dock"),
      },
    });
    this.undoStack = [];
  }

  initialize() {
    this.#registerTools();
    this.#registerPanels();
    this.#bridgeState();
  }

  apply(config, { preview = false } = {}) {
    if (preview) this.layout.beginPreview();
    const normalized = normalizeApplicationConfig(config);
    this.document.querySelector("#app").dataset.applicationPreset = normalized.preset;
    this.document.querySelector("#app").dataset.presentationSkin = normalized.skin;
    this.document.body.dataset.applicationMode = normalized.mode;
    this.document.querySelector("#application-edit-return").hidden = normalized.mode !== "present";
    const applied = this.layout.apply(normalized, this.#context());
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
    const preset = ["briefing", "explorer", "atlas", "standard"].find((id) => new RegExp(`\\b${id}\\b`, "i").test(request));
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
      if (!["standard", "explorer", "briefing", "atlas"].includes(input.preset)) throw new Error(`Unknown application preset: ${input.preset}`);
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
    applicationChange("application.skin.change", "Change skin", (config, input) => ({ ...config, skin: input.skin || config.skin }));
    applicationChange("application.chart.create", "Create chart", (config, input) => {
      config.panels.push({ instanceId: input.instanceId || `charts-${config.panels.filter((item) => item.type === "charts").length + 1}`, type: "charts", title: input.title || "Chart", placement: { region: input.region || "bottom", order: config.panels.length }, binding: input.binding || { followActiveLayer: true }, settings: input.settings || {}, audienceVisible: true });
      return config;
    });
    this.tools.register({ id: "project.filter.apply", displayName: "Apply filter", execute: (input) => this.state.dispatch("filters:set", input) });
    this.tools.register({ id: "project.chapter.create", displayName: "Create chapter", execute: (input) => this.state.dispatch("chapter:create", input) });
  }

  #registerPanels() {
    for (const [type, elementId] of Object.entries(STATIC_PANELS)) {
      this.panels.register({
        type,
        displayName: type[0].toUpperCase() + type.slice(1),
        description: `Existing ${type} workspace tools.`,
        category: type === "intelligence" ? "Analysis" : "Workspace",
        placements: type === "places" || type === "layers" ? ["left", "right"] : ["left", "right", "bottom"],
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
      type: "attributes", displayName: "Attributes", description: "Details for the shared selection.", category: "Data", bindings: ["active-layer", "fixed-layer", "shared-selection"], placements: ["left", "right", "bottom", "floating"],
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
      type: "chapters", displayName: "Chapters", description: "Author and play guided map presentations.", category: "Presentation", bindings: ["shared-selection", "shared-time"], placements: ["left", "right", "bottom"],
      mount: (host, context) => {
        const chapters = context.config.settings?.chapters || this.projectManager.current.presentation?.chapters || [];
        host.innerHTML = chapters.length ? `<ol class="composable-chapters">${chapters.map((chapter) => `<li><strong>${escapeHtml(chapter.title || "Chapter")}</strong><small>${escapeHtml(chapter.body || "Saved map view")}</small></li>`).join("")}</ol>` : `<div class="panel-empty"><strong>No chapters yet</strong><p>Capture a map view in Atlas edit mode to add the first chapter.</p></div>`;
      },
    });
    this.panels.register({
      type: "ai-chatbot", displayName: "AI Chatbot", description: "Questions and approved map commands.", category: "Analysis", bindings: ["active-layer", "shared-selection", "shared-time"], placements: ["left", "right", "bottom", "floating"],
      mount: (host) => { host.innerHTML = this.aiController.isConfigured() ? `<div class="panel-empty"><strong>AI assistant ready</strong><p>Ask questions from the Intelligence workspace. Builder commands use validated tools only.</p></div>` : `<div class="panel-empty"><strong>AI is optional</strong><p>Configure a provider from Tools. The application builder works without AI.</p></div>`; },
    });
  }
}
