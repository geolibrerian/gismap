// Stable application-facing map facade. It owns engine selection and the
// higher-level workflows that can be expressed with provider-neutral
// primitives. Renderer adapters stay focused on drawing and interaction.
import { createEngine, getEngineDefinition, listEngines } from "./engines/engine-registry.js?v=0.63.10-text-boxes";
import { MAP_CONTROLLER_METHODS, METHOD_CAPABILITIES, unsupported } from "./engines/engine-interface.js?v=0.62.4-silent-engine-handoff";
import { GisMapError } from "./gismap-errors.js?v=0.28.0";
import { TextBoxLayer } from "./text-boxes.js?v=0.63.10-text-boxes";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const nothing = () => undefined;

/**
 * What the app gets when the engine lacks an optional capability whose
 * absence is harmless (no click marker, no tour pins, no address lookup).
 * Anything not listed reports the missing capability instead.
 */
const FALLBACKS = Object.freeze({
  configureInteractionFeedback: nothing,
  clearClickMarker: nothing,
  highlightFeature: async () => false,
  clearFeatureHighlight: nothing,
  setTaskPin: nothing,
  setTourMarkers: nothing,
  setActiveTourMarker: nothing,
  clearTourMarkers: nothing,
  hasDrawings: () => false,
  clearDrawings: nothing,
  getDrawGraphicsForExport: () => [],
  getDrawingsStyle: () => ({}),
  setDrawingsStyle: nothing,
  widgetOpen: () => false,
  setBasemapTheme: nothing,
  setBuildings3d: nothing,
  getBasemapOptions: () => ({ selected: null, options: [] }),
  restoreRenderer: nothing,
  recordRendererSpec: nothing,
  layerMetadata: () => null,
  getLocalAsset: () => null,
  ignoreScaleRange: () => false,
  reverseGeocode: async () => null,
});

export class MapController {
  constructor(events, authController = null, { engineId = "arcgis", engineFactory = createEngine } = {}) {
    this.events = events;
    this.authController = authController;
    this.engineId = engineId;
    this.engineFactory = engineFactory;
    this.engine = null;
    this.container = null;
    this.initialBasemapId = null;
    this.defaultBasemapId = null;
    this.groundId = "world-elevation";
    this.geoParquetSources = new Map();
    this.textBoxes = new TextBoxLayer({
      events,
      project: {
        mapToScreen: (coordinates) => this.engine?.mapToScreen?.(coordinates) ?? null,
        screenToMap: (x, y) => this.engine?.screenToMap?.(x, y) ?? null,
        container: () => this.#containerElement(),
        zoom: () => { try { return this.engine?.getCamera?.()?.zoom ?? null; } catch { return null; } },
      },
    });
    this.events?.subscribe?.("layer:removed", ({ uid }) => this.geoParquetSources.delete(uid));
  }

  availableEngines() { return listEngines(); }
  getEngineId() { return this.engine?.id || this.engineId; }

  async prepare() {
    if (!this.engine) {
      this.engine = await this.engineFactory(this.engineId, { events: this.events, authController: this.authController });
      if (this.defaultBasemapId) this.engine.setDefaultBasemap?.(this.defaultBasemapId);
      if (this.initialBasemapId) this.engine.setInitialBasemap?.(this.initialBasemapId);
    }
    return this.engine;
  }

  async initialize(container = "viewDiv") {
    this.container = container;
    await this.prepare();
    return this.engine.initialize(container);
  }

  /**
   * Replaces the renderer beneath the existing workspace without navigating
   * away from the application. Remote layers, their GISMap styles, basemap,
   * terrain choice, and camera are rebuilt in the new engine. Callers receive
   * the old-to-new layer IDs so their own selection state can follow along.
   *
   * Local browser files deliberately fail before the old engine is removed:
   * their File handles cannot safely cross an engine boundary.
   */
  async switchEngine(engineId) {
    const target = String(engineId || "").toLowerCase();
    const previousId = this.getEngineId();
    if (!target || target === previousId) return { switched: false, engine: previousId, layers: [] };
    if (!getEngineDefinition(target)) throw new GisMapError("UNKNOWN_ENGINE", `Unknown map engine: ${target}.`);
    if (!this.engine) throw new GisMapError("NOT_READY", "The map engine has not been initialized yet.");

    const configs = this.getAllLayerConfigs();
    const local = configs.find((config) => config.local || this.geoParquetSources.has(config.uid));
    if (local) throw new GisMapError("UNSUPPORTED_LAYER_TYPE", `“${local.title || "A local layer"}” is stored only in this browser and cannot move between map engines.`);

    const container = this.container || this.getContainer?.() || "viewDiv";
    const view = this.getViewState();
    const basemap = this.getBasemapId();
    const ground = this.getGroundId();
    const previousEngine = this.engine;
    const oldEngineId = this.engineId;

    // Destroying only the map view leaves the workspace, player, panels, and
    // route in place. The container is reused, so this is a renderer handoff,
    // not an application reload.
    previousEngine.destroy?.();
    this.engine = null;
    this.engineId = target;
    try {
      const engine = await this.engineFactory(target, { events: this.events, authController: this.authController });
      this.engine = engine;
      await engine.initialize(container);
      if (this.defaultBasemapId) engine.setDefaultBasemap?.(this.defaultBasemapId);
      if (basemap) await Promise.resolve(engine.setBasemap?.(basemap)).catch(() => {});
      if (ground) await Promise.resolve(this.setGround(ground)).catch(() => {});

      const layers = [];
      for (const config of configs) {
        const layer = await this.addService(config);
        // Renderer specs are GISMap's portable styling format. Native renderer
        // JSON is intentionally not replayed across different SDKs.
        if (config.rendererSpec) await Promise.resolve(this.applyRendererSpec(layer.uid, config.rendererSpec)).catch(() => {});
        if (config.ignoreServiceScaleRange) await Promise.resolve(this.ignoreScaleRange(layer.uid, true)).catch(() => {});
        layers.push({ from: config.uid, to: layer.uid, layer, config });
      }
      await this.restoreView(view);
      this.events?.publish?.("layers:reset", {});
      this.textBoxes.reattach();
      this.events?.publish?.("engine:changed", { from: previousId, engine: target, layers });
      return { switched: true, engine: target, layers };
    } catch (error) {
      // The old renderer has already released its WebGL context; restore a
      // working renderer rather than leave the live app without a map.
      this.engine?.destroy?.();
      this.engine = null;
      this.engineId = oldEngineId;
      try {
        const engine = await this.engineFactory(oldEngineId, { events: this.events, authController: this.authController });
        this.engine = engine;
        await engine.initialize(container);
        if (basemap) await Promise.resolve(engine.setBasemap?.(basemap)).catch(() => {});
        if (ground) await Promise.resolve(this.setGround(ground)).catch(() => {});
        for (const config of configs) {
          const layer = await this.addService(config);
          if (config.rendererSpec) await Promise.resolve(this.applyRendererSpec(layer.uid, config.rendererSpec)).catch(() => {});
          if (config.ignoreServiceScaleRange) await Promise.resolve(this.ignoreScaleRange(layer.uid, true)).catch(() => {});
        }
        await this.restoreView(view);
        this.events?.publish?.("layers:reset", {});
      } catch { /* Surface the original error; a failed recovery is handled by the app error boundary. */ }
      throw error;
    }
  }

  destroy() {
    this.engine?.destroy?.();
    this.engine = null;
  }

  isReady() { return Boolean(this.engine?.isReady?.()); }
  async whenReady() { return this.#requireEngine().whenReady(); }
  getCapabilities() { return this.engine?.getCapabilities?.() || getEngineDefinition(this.engineId)?.capabilities || []; }

  setInitialBasemap(id) {
    this.initialBasemapId = id || null;
    this.engine?.setInitialBasemap?.(this.initialBasemapId);
  }

  setDefaultBasemap(id) {
    this.defaultBasemapId = id || null;
    this.engine?.setDefaultBasemap?.(this.defaultBasemapId);
  }

  setMapNoteMarkers(points = []) { this.engine?.setMapNoteMarkers?.(points); }

  getDefaultBasemapId() {
    return this.engine?.getDefaultBasemapId?.() || this.defaultBasemapId || this.engine?.getBasemapId?.() || this.initialBasemapId;
  }

  getBasemapId() { return this.engine?.getBasemapId?.() || this.initialBasemapId || this.defaultBasemapId; }

  setGeoParquetSource(uid, source) { this.geoParquetSources.set(uid, source); }

  getLayerConfig(ref) {
    const config = this._delegate("getLayerConfig", [ref]);
    if (!config) return config;
    const source = this.geoParquetSources.get(config.uid);
    if (!source) return config;
    return { ...config, sourceType: "geoparquet", type: "geoparquet", local: Boolean(source.file),
      url: source.url || null, fileName: source.file?.name || null,
      projectPath: source.file ? source.projectPath : null, refreshInterval: 0 };
  }

  getLocalAsset(ref) {
    const uid = typeof ref === "string" ? ref : ref?.uid;
    return this.geoParquetSources.get(uid)?.file || this._delegate("getLocalAsset", [ref]);
  }

  /** Map text boxes: rich labels anchored at [longitude, latitude, z], kept across engines. */
  getTextBoxes() { return this.textBoxes.list(); }
  setTextBoxes(list = []) { this.textBoxes.set(list); }
  addTextBox(box) { return this.textBoxes.add(box); }
  updateTextBox(id, patch) { return this.textBoxes.update(id, patch); }
  removeTextBox(id) { this.textBoxes.remove(id); }
  clearTextBoxes() { this.textBoxes.clear(); }
  selectTextBox(id) { this.textBoxes.select(id); }
  pickMapCoordinate() { return this.textBoxes.pickCoordinate(); }
  /** [longitude, latitude, z] under a map-container pixel, or null. */
  screenToMap(x, y) { return this.engine?.screenToMap?.(x, y) ?? null; }
  /** The map container's size in CSS pixels. */
  getContainerSize() { const element = this.#containerElement(); return element ? { width: element.clientWidth, height: element.clientHeight } : null; }

  /** The engine's capture with text boxes drawn in, so exports match the screen. */
  async captureImage(options = {}) {
    const capture = await this._delegate("captureImage", [options]);
    try {
      return await this.textBoxes.composite(capture, options.format || "jpg", options.quality ?? 82);
    } catch {
      return capture;
    }
  }

  #containerElement() {
    const container = this.engine?.getContainer?.() ?? this.container;
    if (typeof container === "string") return typeof document === "undefined" ? null : document.getElementById(container);
    return container || null;
  }

  getAllLayerConfigs() { return this.getLayers().map((layer) => this.getLayerConfig(layer)); }

  /** Terrain on engines with 3D ground; others keep the choice so projects save it unchanged. */
  setGround(id) {
    this.groundId = id || "world-elevation";
    if (typeof this.engine?.setGround === "function") return this.engine.setGround(this.groundId);
  }

  getGroundId() {
    return typeof this.engine?.getGroundId === "function" ? this.engine.getGroundId() : this.groundId;
  }

  getGroundOptions() {
    return this.engine?.getGroundOptions?.() || { selected: this.getGroundId(), options: [
      { id: "world-elevation", label: "World elevation" },
      { id: "world-topobathymetry", label: "Elevation + bathymetry" },
      { id: "flat", label: "Flat ground" },
    ] };
  }

  async restoreView(state) {
    if (!state) return;
    // A flat map goes to a saved 3D view's centre and zoom when it has them; the camera position is the eye, not the target.
    const flat = !this.getCapabilities().includes("view-3d");
    if (state.camera && !(flat && Array.isArray(state.center))) return this.setView({ camera: state.camera }, { animate: false });
    return this.setView({ center: state.center, zoom: state.zoom, heading: state.heading, tilt: state.tilt }, { animate: false });
  }

  async goToFeature(feature, options = {}) {
    if (!feature?.geometry) throw new Error("This record does not have a geometry to zoom to.");
    return this.setView({ geometry: feature.geometry, fit: "feature" }, { animate: options.animate ?? true, ...options });
  }

  async goToFeatures(features = [], options = undefined) {
    const usable = features.filter((feature) => feature?.geometry);
    if (usable.length) return this.setView({ features: usable }, options);
  }

  /** Every value of a field under the layer's filter, paged and engine-neutral. */
  async fieldValues(ref, field, { limit = 20000 } = {}) {
    const layer = typeof ref === "string" ? this.getLayer(ref) : ref;
    if (!layer?.queryable) return [];
    const values = [];
    const pageSize = Math.max(1, Math.min(layer.maxRecordCount || 2000, 2000));
    for (let start = 0; start < limit; start += pageSize) {
      const result = await this._delegate("queryFeatures", [layer.uid, {
        where: layer.where || "1=1", outFields: [field], returnGeometry: false, num: pageSize,
        ...(layer.paginated ? { start } : {}),
      }]);
      result.features.forEach((feature) => values.push(feature.attributes?.[field]));
      if (!layer.paginated || result.features.length < pageSize) break;
    }
    return values;
  }

  async distinctValues(ref, fieldName, { limit = 200 } = {}) {
    const layer = typeof ref === "string" ? this.getLayer(ref) : ref;
    const field = layer?.fields?.find((item) => item.name === fieldName);
    if (!field) return { values: [], complete: true };
    const coded = field.domain?.type === "coded-value" ? field.domain.codedValues || [] : [];
    if (coded.length) return { values: coded.slice(0, limit).map((item) => ({ value: item.code, label: String(item.name ?? item.code) })), complete: coded.length <= limit };
    if (!layer.queryable || /date|oid|geometry|guid|global-?id|blob/i.test(String(field.type || ""))) return { values: [], complete: true };
    const unique = (list) => [...new Set(list.filter((value) => value !== null && value !== undefined && value !== ""))]
      .sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
    let values;
    let sampled = false;
    try {
      const result = await this._delegate("queryFeatures", [layer.uid, { where: "1=1", outFields: [fieldName], returnGeometry: false, returnDistinctValues: true, orderByFields: [fieldName], num: limit + 1 }, { layerDefaults: false }]);
      values = unique(result.features.map((feature) => feature.attributes?.[fieldName]));
    } catch {
      const result = await this._delegate("queryFeatures", [layer.uid, { where: "1=1", outFields: [fieldName], returnGeometry: false, num: 2000 }, { layerDefaults: false }]).catch(() => ({ features: [] }));
      values = unique(result.features.map((feature) => feature.attributes?.[fieldName]));
      sampled = result.features.length >= 2000;
    }
    return { values: values.slice(0, limit).map((value) => ({ value, label: String(value) })), complete: values.length <= limit && !sampled };
  }

  /** Provider-neutral multi-view capture used by Briefing PDF export. */
  async captureViews(targets = [], { aspect = 4 / 3, width = 1400, onProgress = () => {}, prepare = null } = {}) {
    const previous = this.getViewState();
    const images = [];
    try {
      for (const [index, target] of targets.entries()) {
        onProgress(index, targets.length);
        try {
          if (target) await this.setView(target, { animate: false });
          if (prepare) await prepare(index, target);
          await wait(120);
          images.push(await this.captureImage({ format: "jpg", quality: 84, width, aspect }));
        } catch {
          images.push(null);
        }
      }
    } finally {
      await this.restoreView(previous).catch(() => {});
    }
    return images;
  }

  #requireEngine() {
    if (!this.engine) throw new GisMapError("NOT_READY", "The map engine has not been initialized yet.");
    return this.engine;
  }

  _delegate(name, args) {
    const engine = this.#requireEngine();
    if (typeof engine[name] !== "function" && FALLBACKS[name]) return FALLBACKS[name](...args);
    if (typeof engine[name] !== "function") throw unsupported(METHOD_CAPABILITIES[name] || name, `${engine.id || this.engineId} does not support ${name}.`);
    return engine[name](...args);
  }
}

// Keep the facade explicit and testable without 70 repetitive one-line methods.
for (const name of MAP_CONTROLLER_METHODS) {
  if (typeof MapController.prototype[name] === "function") continue;
  Object.defineProperty(MapController.prototype, name, {
    configurable: false,
    value(...args) { return this._delegate(name, args); },
  });
}

