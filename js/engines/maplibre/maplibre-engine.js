// The MapLibre engine (experimental): a flat web map drawn with MapLibre GL JS
// on open OpenFreeMap basemaps. It implements the renderer contract in
// ../engine-interface.js for GeoJSON layers held in the browser, which it
// filters, queries and identifies itself. Capabilities it lacks (3D ground,
// ArcGIS and OGC services, geocoding, drawing, widgets) are left out of
// getCapabilities(), and MapController falls back or reports them.
//
// Zoom: GIS Map zoom levels follow ArcGIS (256-pixel tiles); MapLibre's are
// one lower for the same scale (512-pixel tiles). Everything that crosses the
// boundary uses GIS Map levels, so links and projects mean the same view.
import { GisMapError } from "../../gismap-errors.js?v=0.28.0";
import { unsupported } from "../engine-interface.js?v=0.40.0";
import { openBasemapFor } from "./basemaps.js?v=0.40.0";
import { applyBasemapTheme } from "./basemap-theme.js?v=0.40.0";
import { compileWhere } from "./where.js?v=0.39.0";
import { OBJECT_ID_FIELD, boundsIntersect, boundsOf, expandBounds, geometryTypeOf, inferFields, normalizeFeatures, representativePoint } from "./geojson.js?v=0.39.0";
import { loadMaplibre } from "./maplibre-loader.js?v=0.39.0";

export const MAPLIBRE_CAPABILITIES = Object.freeze(["view-2d", "basemaps", "basemap-themes", "layers-files", "query", "feature-filter", "identify", "capture", "native"]);

const ZOOM_OFFSET = 1;
const SCALE_AT_ZOOM_0 = 591657527.591555;
// GIS Map green, until a skin's theme gives the data its accent colour.
const DEFAULT_COLOR = "#1b7f6a";
const MAX_PITCH = 60;
const toEngineZoom = (zoom) => Number(zoom) - ZOOM_OFFSET;
const toGisZoom = (zoom) => Number(zoom) + ZOOM_OFFSET;
const zoomForScale = (scale) => Math.log2(SCALE_AT_ZOOM_0 / Math.max(1, Number(scale)));
const normalizeHeading = (bearing) => ((Number(bearing) % 360) + 360) % 360;
const round = (value, digits) => Number(Number(value).toFixed(digits));

function titleFromUrl(url = "") {
  const name = String(url).split(/[?#]/)[0].replace(/\/+$/, "").split("/").at(-1) || "GeoJSON layer";
  try {
    return decodeURIComponent(name).replace(/\.(geo)?json$/i, "").replaceAll("_", " ") || "GeoJSON layer";
  } catch {
    return name;
  }
}

function isGeoJsonUrl(url) {
  try {
    const parsed = new URL(url, globalThis.location?.href);
    return /\.(geo)?json$/i.test(parsed.pathname) || /^geojson$/i.test(parsed.searchParams.get("f") || "");
  } catch {
    return /\.(geo)?json(?:$|[?#])/i.test(String(url));
  }
}

/** A Web Mercator or WGS84 point as degrees. */
function geographicPoint(x, y, wkid) {
  if ([3857, 102100, 102113, 900913].includes(wkid)) {
    const radius = 6378137;
    return { longitude: (x / radius) * (180 / Math.PI), latitude: (2 * Math.atan(Math.exp(y / radius)) - (Math.PI / 2)) * (180 / Math.PI) };
  }
  return { longitude: x, latitude: y };
}

/** Read-only handle over a layer record (engine-interface.js LayerHandle). */
function layerHandle(record) {
  return Object.freeze({
    get uid() { return record.uid; },
    get id() { return record.id; },
    get title() { return record.title; },
    get url() { return record.url; },
    get layerId() { return null; },
    get type() { return "geojson"; },
    get fields() { return record.fields; },
    get geometryType() { return record.geometryType; },
    get objectIdField() { return OBJECT_ID_FIELD; },
    get displayField() { return null; },
    get visible() { return record.visible; },
    get opacity() { return record.opacity; },
    get where() { return record.where || null; },
    get rendererSpec() { return record.rendererSpec; },
    get renderer() { return null; },
    get minScale() { return 0; },
    get maxScale() { return 0; },
    get refreshInterval() { return 0; },
    get loadStatus() { return "loaded"; },
    get loadError() { return null; },
    get queryable() { return true; },
    get countable() { return true; },
    get objectIdQueryable() { return true; },
    get filterable() { return true; },
    get stylable() { return true; },
    get refreshable() { return false; },
    get maxRecordCount() { return 0; },
    get paginated() { return true; },
    get parentTitle() { return null; },
  });
}

export class MaplibreEngine {
  #records = new Map();
  #count = 0;
  #loaded = null;
  #styleJson = new Map();
  #styleToken = 0;

  constructor(events) {
    this.id = "maplibre";
    this.events = events;
    this.maplibregl = null;
    this.map = null;
    this.defaultView = { center: [-98.5, 39.5], zoom: 4, heading: 0, tilt: 0 };
    this.defaultBasemapId = "topo-3d";
    this.basemapId = "topo-3d";
    this.initialBasemapId = null;
    this.basemapTheme = null;
  }

  /* ---------------- Lifecycle ---------------- */

  async initialize(container = "viewDiv") {
    this.maplibregl = await loadMaplibre();
    const { center, zoom, heading, tilt } = this.defaultView;
    this.map = new this.maplibregl.Map({
      container,
      style: await this.#styleFor(this.basemapId),
      center,
      zoom: toEngineZoom(zoom),
      bearing: heading,
      pitch: tilt,
      maxPitch: MAX_PITCH,
      attributionControl: { compact: true },
      // Captures (Smart images, briefing PDFs) read the canvas after drawing.
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    this.#loaded = new Promise((resolve, reject) => {
      this.map.once("load", resolve);
      this.map.once("error", (event) => { if (!this.map.loaded()) reject(event.error || new Error("The basemap did not load.")); });
    });
    await this.#loaded;
    this.#bindEvents();
    this.events.publish("map:ready", { engine: this.id, zoom: this.#gisZoom() });
  }

  #bindEvents() {
    const point = (lngLat) => ({ longitude: lngLat.lng, latitude: lngLat.lat, x: lngLat.lng, y: lngLat.lat, spatialReference: { wkid: 4326 } });
    this.map.on("click", (event) => this.events.publish("map:click", { x: event.point.x, y: event.point.y, mapPoint: point(event.lngLat) }));
    this.map.on("mousemove", (event) => this.events.publish("view:pointer-move", { longitude: event.lngLat.lng, latitude: event.lngLat.lat, zoom: this.#gisZoom() }));
    this.map.on("zoomend", () => this.events.publish("view:scale-change", { scale: this.getScale() }));
    this.map.on("moveend", () => this.events.publish("view:stationary", {}));
    this.map.on("error", (event) => {
      // Basemap tiles come and go; a failure in a data layer's source is worth reporting.
      if (!String(event.sourceId || "").startsWith("gismap-")) return;
      const record = this.#records.get(String(event.sourceId).slice("gismap-".length));
      this.events.publish("app:error", { message: `Could not draw ${record?.title || "a layer"}: ${event.error?.message || "unknown error"}` });
    });
  }

  destroy() {
    this.map?.remove();
    this.map = null;
    this.#records.clear();
  }

  isReady() {
    return Boolean(this.map);
  }

  async whenReady() {
    await this.#loaded;
  }

  getCapabilities() {
    return [...MAPLIBRE_CAPABILITIES];
  }

  /** The MapLibre map itself, for custom tools (gisMapOnline.map). There is no SceneView. */
  native() {
    return { engine: this.id, map: this.map, view: null, layers: () => [] };
  }

  resize() {
    this.map?.resize();
  }

  getContainer() {
    return this.map?.getContainer() ?? null;
  }

  /* ---------------- Basemap ---------------- */

  setInitialBasemap(id) {
    if (this.map || !id) return;
    this.initialBasemapId = String(id);
    this.basemapId = this.initialBasemapId;
  }

  setDefaultBasemap(id) {
    this.defaultBasemapId = String(id || "topo-3d");
    if (!this.map && !this.initialBasemapId) this.basemapId = this.defaultBasemapId;
  }

  getDefaultBasemapId() {
    return this.defaultBasemapId;
  }

  getBasemapId() {
    return this.basemapId;
  }

  setBasemap(id) {
    const next = id || "topo-3d";
    if (!this.map && this.initialBasemapId) return;
    if (this.map && next === this.basemapId) return;
    const previous = openBasemapFor(this.basemapId);
    this.basemapId = next;
    const upcoming = openBasemapFor(next);
    if (this.map && (upcoming.themed || previous.themed || upcoming.style !== previous.style)) void this.#applyStyle();
    this.events.publish("map:basemap-changed", { id: this.basemapId });
  }

  /**
   * The colours of the active skin (basemap-themes.js themeFromTokens): the
   * "skin" basemap is drawn with them, and data layers without a style of
   * their own take the theme's accent.
   */
  setBasemapTheme(theme) {
    this.basemapTheme = theme || null;
    for (const record of this.#records.values()) if (!record.style.color) this.#refresh(record);
    if (this.map && openBasemapFor(this.basemapId).themed) void this.#applyStyle();
  }

  #dataColor() {
    return this.basemapTheme?.accent || DEFAULT_COLOR;
  }

  /** The style for a basemap id: an OpenFreeMap style URL, or for "skin" that style restyled with the theme. */
  async #styleFor(id) {
    const basemap = openBasemapFor(id);
    if (!basemap.themed || !this.basemapTheme) return basemap.style;
    if (!this.#styleJson.has(basemap.style)) {
      this.#styleJson.set(basemap.style, fetch(basemap.style).then((response) => {
        if (!response.ok) throw new Error(`The basemap style did not load (HTTP ${response.status}).`);
        return response.json();
      }).catch((error) => { this.#styleJson.delete(basemap.style); throw error; }));
    }
    try {
      return applyBasemapTheme(await this.#styleJson.get(basemap.style), this.basemapTheme);
    } catch {
      return basemap.style;
    }
  }

  /** Swaps in the current basemap's style, carrying the data layers over (only what changed is redrawn). */
  async #applyStyle() {
    const token = ++this.#styleToken;
    const style = await this.#styleFor(this.basemapId);
    // A style still loading cannot be diffed (MapLibre would rebuild from scratch); wait for it.
    if (this.map && !this.map.isStyleLoaded()) await new Promise((resolve) => { this.map.once("style.load", resolve); setTimeout(resolve, 10000); });
    if (token !== this.#styleToken || !this.map) return;
    this.map.setStyle(style, {
      diff: true,
      transformStyle: (_previous, incoming) => ({
        ...incoming,
        sources: { ...incoming.sources, ...Object.fromEntries([...this.#records.values()].map((record) => [this.#sourceId(record), this.#sourceSpec(record)])) },
        layers: [...incoming.layers, ...[...this.#records.values()].flatMap((record) => this.#layerSpecs(record))],
      }),
    });
  }

  async whenBasemapLoaded(timeout = 15000) {
    if (!this.map) return;
    await Promise.race([
      this.map.loaded() ? Promise.resolve() : new Promise((resolve) => this.map.once("idle", resolve)),
      new Promise((resolve) => setTimeout(resolve, timeout)),
    ]);
  }

  /* ---------------- Layers ---------------- */

  #record(ref) {
    if (ref == null) return null;
    return this.#records.get(typeof ref === "object" ? ref.uid : String(ref)) ?? null;
  }

  #require(ref) {
    const record = this.#record(ref);
    if (!record) throw new GisMapError("NOT_FOUND", "That layer is not on the map.");
    return record;
  }

  #sourceId(record) { return `gismap-${record.uid}`; }

  #visibleFeatures(record) {
    if (!record.where) return record.features;
    const matches = compileWhere(record.where);
    return record.features.filter((feature) => matches(feature.properties));
  }

  #sourceSpec(record) {
    return { type: "geojson", data: { type: "FeatureCollection", features: this.#visibleFeatures(record) } };
  }

  /** The MapLibre layers that draw one data layer: fill and outline, lines, and points. */
  #layerSpecs(record) {
    const source = this.#sourceId(record);
    const visibility = record.visible ? "visible" : "none";
    const color = record.style.color || this.#dataColor();
    const outline = record.style.outline || color;
    const size = Number(record.style.size);
    const opacity = record.opacity;
    const featureFilter = record.featureFilter ? ["in", ["get", OBJECT_ID_FIELD], ["literal", record.featureFilter]] : null;
    const filtered = (types) => {
      const base = ["match", ["geometry-type"], types, true, false];
      return featureFilter ? ["all", base, featureFilter] : base;
    };
    return [
      { id: `${source}-fill`, type: "fill", source, filter: filtered(["Polygon", "MultiPolygon"]), layout: { visibility }, paint: { "fill-color": color, "fill-opacity": 0.35 * opacity } },
      { id: `${source}-outline`, type: "line", source, filter: filtered(["Polygon", "MultiPolygon"]), layout: { visibility }, paint: { "line-color": outline, "line-width": Number.isFinite(size) ? size : 1.5, "line-opacity": opacity } },
      { id: `${source}-line`, type: "line", source, filter: filtered(["LineString", "MultiLineString"]), layout: { visibility, "line-cap": "round", "line-join": "round" }, paint: { "line-color": color, "line-width": Number.isFinite(size) ? size : 2.5, "line-opacity": opacity } },
      { id: `${source}-circle`, type: "circle", source, filter: filtered(["Point", "MultiPoint"]), layout: { visibility }, paint: { "circle-color": color, "circle-radius": Number.isFinite(size) ? size / 2 : 4.5, "circle-stroke-color": record.style.outline || this.basemapTheme?.labelHalo || "#ffffff", "circle-stroke-width": 1.5, "circle-opacity": opacity, "circle-stroke-opacity": opacity } },
    ];
  }

  #layerIds(record) {
    return ["fill", "outline", "line", "circle"].map((suffix) => `${this.#sourceId(record)}-${suffix}`);
  }

  /** Redraws a layer after its data, filter or style changed. */
  #refresh(record, { data = false } = {}) {
    if (!this.map?.getSource(this.#sourceId(record))) return;
    if (data) this.map.getSource(this.#sourceId(record)).setData(this.#sourceSpec(record).data);
    for (const spec of this.#layerSpecs(record)) {
      if (!this.map.getLayer(spec.id)) continue;
      this.map.setFilter(spec.id, spec.filter);
      for (const [name, value] of Object.entries(spec.layout)) this.map.setLayoutProperty(spec.id, name, value);
      for (const [name, value] of Object.entries(spec.paint)) this.map.setPaintProperty(spec.id, name, value);
    }
  }

  #addCollection(json, config) {
    const features = normalizeFeatures(json);
    this.#count += 1;
    const record = {
      uid: `maplibre-${this.#count}`,
      id: `layer-${this.#count}`,
      title: config.title || "GeoJSON layer",
      url: config.url ?? null,
      features,
      fields: inferFields(features),
      geometryType: geometryTypeOf(features),
      visible: config.visible !== false,
      opacity: Number.isFinite(config.opacity) ? Math.max(0, Math.min(1, config.opacity)) : 1,
      where: null,
      featureFilter: null,
      rendererSpec: null,
      style: {},
      config: { sourceType: config.sourceType || "geojson", fileName: config.fileName ?? null, projectPath: config.projectPath ?? null, local: Boolean(config.local), definitionExpression: null },
      asset: config.asset ?? null,
    };
    if (config.definitionExpression) {
      compileWhere(config.definitionExpression);
      record.where = String(config.definitionExpression).trim() || null;
      record.config.definitionExpression = record.where;
    }
    this.#records.set(record.uid, record);
    this.map.addSource(this.#sourceId(record), this.#sourceSpec(record));
    for (const spec of this.#layerSpecs(record)) this.map.addLayer(spec);
    record.handle = layerHandle(record);
    this.events.publish("layer:added", { layer: record.handle, config: this.getLayerConfig(record) });
    return record.handle;
  }

  async addService(config = {}) {
    const url = String(config.url || "").trim().replace(/\/$/, "");
    if (!url) throw new Error("A service URL is required.");
    if (config.serviceType !== "geojson" && !isGeoJsonUrl(url)) {
      throw unsupported("layers-arcgis", "The MapLibre engine (preview) adds GeoJSON layers only so far. Switch to the ArcGIS engine in Display settings for ArcGIS, WMS, WFS and KML services.");
    }
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The GeoJSON could not be read (HTTP ${response.status}).`);
    const json = await response.json();
    return this.#addCollection(json, { ...config, url, title: config.title?.trim() || titleFromUrl(url), sourceType: "geojson" });
  }

  async addLocalFile(file, projectPath = null) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!["json", "geojson"].includes(extension)) {
      throw unsupported("layers-files", "The MapLibre engine (preview) opens GeoJSON files only so far. Switch to the ArcGIS engine in Display settings for KML, KMZ and shapefiles.");
    }
    const json = JSON.parse(await file.text());
    return this.#addCollection(json, { title: file.name, sourceType: extension, fileName: file.name, projectPath: projectPath || `data/${file.name}`, local: true, asset: file });
  }

  async discoverFeatureServiceLayers() {
    throw unsupported("layers-arcgis", "The MapLibre engine (preview) cannot add ArcGIS feature services yet. Switch to the ArcGIS engine in Display settings.");
  }

  async refreshLayer(uid) {
    const record = this.#record(uid);
    if (!record?.url || record.config.local) return;
    const response = await fetch(record.url);
    if (!response.ok) return;
    record.features = normalizeFeatures(await response.json());
    record.fields = inferFields(record.features);
    this.#refresh(record, { data: true });
    this.events.publish("layer:changed", { uid: record.uid });
  }

  removeLayer(uid) {
    const record = this.#record(uid);
    if (!record) return;
    for (const id of this.#layerIds(record)) if (this.map?.getLayer(id)) this.map.removeLayer(id);
    if (this.map?.getSource(this.#sourceId(record))) this.map.removeSource(this.#sourceId(record));
    this.#records.delete(record.uid);
    this.events.publish("layer:removed", { uid: record.uid });
  }

  async clearOperationalLayers() {
    for (const record of [...this.#records.values()]) {
      for (const id of this.#layerIds(record)) if (this.map?.getLayer(id)) this.map.removeLayer(id);
      if (this.map?.getSource(this.#sourceId(record))) this.map.removeSource(this.#sourceId(record));
    }
    this.#records.clear();
    this.events.publish("layers:reset");
  }

  getLayers() {
    return [...this.#records.values()].map((record) => record.handle);
  }

  getLayer(uid) {
    return this.#record(uid)?.handle ?? null;
  }

  getQueryableLayer(uid) {
    return this.getLayer(uid);
  }

  async loadLayer(uid) {
    return this.getLayer(uid);
  }

  getLocalAsset(uid) {
    return this.#record(uid)?.asset ?? null;
  }

  getLayerConfig(ref) {
    const record = this.#record(ref);
    if (!record) return null;
    return {
      uid: record.uid,
      id: record.id,
      title: record.title,
      type: "geojson",
      url: record.url,
      sourceType: record.config.sourceType,
      fileName: record.config.fileName,
      projectPath: record.config.projectPath,
      local: record.config.local,
      visible: record.visible,
      opacity: record.opacity,
      refreshInterval: 0,
      definitionExpression: record.where || record.config.definitionExpression || null,
      wfsName: null,
      customParameters: null,
      elevationInfo: null,
      renderer: null,
      styled: Boolean(record.rendererSpec),
      rendererSpec: record.rendererSpec,
      ignoreServiceScaleRange: false,
    };
  }

  scaleState() {
    return { minScale: 0, maxScale: 0, visibleAtCurrentScale: true, serviceMinScale: 0, serviceMaxScale: 0, ignored: false };
  }

  setVisibility(uid, visible, { silent = false } = {}) {
    const record = this.#record(uid);
    if (record) {
      record.visible = Boolean(visible);
      this.#refresh(record);
    }
    if (!silent) this.events.publish("layer:changed", { uid });
  }

  setOpacity(uid, opacity, { silent = false } = {}) {
    const record = this.#record(uid);
    if (record) {
      record.opacity = Math.max(0, Math.min(1, Number(opacity)));
      this.#refresh(record);
    }
    if (!silent) this.events.publish("layer:changed", { uid });
  }

  setTitle(uid, title) {
    const record = this.#record(uid);
    if (record) record.title = String(title);
  }

  setOutFields() {
    // Every property of a GeoJSON feature is already in the browser.
  }

  /** The layer's attribute filter, evaluated here against the features' properties. */
  setDefinitionExpression(uid, expression, { persist = true } = {}) {
    const record = this.#require(uid);
    const value = String(expression || "").trim() || null;
    compileWhere(value);
    record.where = value;
    this.#refresh(record, { data: true });
    if (!persist) return expression;
    record.config.definitionExpression = value;
    this.events.publish("layer:changed", { uid: record.uid });
    return value;
  }

  /** Draws only some features without changing the layer's filter: { objectIds } or { where }, or null for all. */
  async setFeatureFilter(uid, filter) {
    const record = this.#record(uid);
    if (!record || !this.map) return false;
    if (!filter) record.featureFilter = null;
    else if (Array.isArray(filter.objectIds)) record.featureFilter = filter.objectIds.map(Number);
    else if (filter.where) {
      const matches = compileWhere(filter.where);
      record.featureFilter = record.features.filter((feature) => matches(feature.properties)).map((feature) => feature.id);
    } else record.featureFilter = null;
    this.#refresh(record);
    return true;
  }

  /* ---------------- Styling ---------------- */

  /** Single-colour styles ({ type: "simple", color, outline, size }) and the default ({ type: "service" }). */
  async applyRendererSpec(uid, input) {
    const record = this.#require(uid);
    const spec = typeof input === "string" ? { type: input } : { ...(input || {}) };
    if (spec.type === "service") {
      record.style = {};
      record.rendererSpec = null;
    } else if (spec.type === "simple") {
      if (spec.color && !/^#[0-9a-f]{6}$/i.test(spec.color)) throw new GisMapError("INVALID_SPEC", "color must be a #rrggbb colour.");
      record.style = { color: spec.color || null, outline: spec.outline || null, size: spec.size };
      record.rendererSpec = spec;
    } else {
      throw unsupported("renderer-spec", `The MapLibre engine (preview) draws single-colour styles only so far; “${spec.type}” styles need the ArcGIS engine.`);
    }
    this.#refresh(record);
    this.events.publish("layer:changed", { uid: record.uid });
    return { issues: [], spec };
  }

  /* ---------------- Queries ---------------- */

  #viewBounds() {
    const bounds = this.map?.getBounds();
    return bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null;
  }

  #matching(record, params = {}, layerDefaults = true) {
    let features = record.features;
    const keep = (predicate) => { features = features.filter(predicate); };
    if (layerDefaults && record.where) {
      const matches = compileWhere(record.where);
      keep((feature) => matches(feature.properties));
    }
    if (params.where) {
      const matches = compileWhere(params.where);
      keep((feature) => matches(feature.properties));
    }
    if (Array.isArray(params.objectIds)) {
      const ids = new Set(params.objectIds.map(Number));
      keep((feature) => ids.has(feature.id));
    }
    if (params.geometry) {
      const relation = params.spatialRelationship || "intersects";
      const area = params.geometry === "view" ? this.#viewBounds() : Number.isFinite(params.geometry?.xmin) ? boundsOf(params.geometry) : null;
      // Bounding-box tests only: exact spatial relationships need the ArcGIS engine for now.
      if (!area || !["intersects", "envelope-intersects", "index-intersects"].includes(relation) || params.distance) {
        throw unsupported("spatial-query", "The MapLibre engine (preview) can only find features within the map view or a box so far.");
      }
      keep((feature) => boundsIntersect(boundsOf(feature.geometry), area));
    }
    return features;
  }

  async queryFeatures(uid, params = {}, { layerDefaults = true } = {}) {
    const record = this.#require(uid);
    let features = this.#matching(record, params, layerDefaults);
    const fields = Array.isArray(params.outFields) && !params.outFields.includes("*") ? params.outFields : null;
    const pick = (properties) => (fields ? Object.fromEntries(fields.map((name) => [name, properties[name] ?? null])) : { ...properties });
    if (Array.isArray(params.orderByFields) && params.orderByFields.length) {
      const orders = params.orderByFields.map((entry) => { const [name, direction] = String(entry).trim().split(/\s+/); return { name, sign: /^desc$/i.test(direction || "") ? -1 : 1 }; });
      features = [...features].sort((a, b) => {
        for (const { name, sign } of orders) {
          const x = a.properties[name]; const y = b.properties[name];
          if (x === y) continue;
          if (x == null) return 1;
          if (y == null) return -1;
          return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sign;
        }
        return 0;
      });
    }
    if (params.returnDistinctValues) {
      const seen = new Set();
      features = features.filter((feature) => {
        const key = JSON.stringify(pick(feature.properties));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    const start = Math.max(0, Number(params.start) || 0);
    const end = Number.isFinite(Number(params.num)) && Number(params.num) > 0 ? start + Number(params.num) : features.length;
    const page = features.slice(start, end);
    return {
      features: page.map((feature) => ({ attributes: pick(feature.properties), geometry: params.returnGeometry === false ? null : feature.geometry })),
      exceededTransferLimit: end < features.length,
    };
  }

  async queryFeatureCount(uid, params = {}, { layerDefaults = true } = {}) {
    return this.#matching(this.#require(uid), params, layerDefaults).length;
  }

  async queryObjectIds(uid, params = {}, { layerDefaults = true } = {}) {
    return this.#matching(this.#require(uid), params, layerDefaults).map((feature) => feature.id);
  }

  /* ---------------- Identify ---------------- */

  async identify(click) {
    if (!this.map || !Number.isFinite(click?.x)) return [];
    const layers = [...this.#records.values()].filter((record) => record.visible).flatMap((record) => this.#layerIds(record)).filter((id) => this.map.getLayer(id));
    if (!layers.length) return [];
    const box = [[click.x - 5, click.y - 5], [click.x + 5, click.y + 5]];
    const seen = new Set();
    const results = [];
    for (const hit of this.map.queryRenderedFeatures(box, { layers })) {
      const record = this.#records.get(String(hit.source).slice("gismap-".length));
      const id = Number(hit.properties?.[OBJECT_ID_FIELD] ?? hit.id);
      if (!record || seen.has(`${record.uid}:${id}`)) continue;
      seen.add(`${record.uid}:${id}`);
      const feature = record.features.find((item) => item.id === id);
      if (!feature) continue;
      results.push({
        kind: "feature",
        layerUid: record.uid,
        layerTitle: record.title || "Layer",
        attributes: { ...feature.properties },
        geometry: feature.geometry,
        source: { url: record.url, layerId: null, title: record.title, objectIdField: OBJECT_ID_FIELD, displayField: null },
      });
    }
    return results;
  }

  /* ---------------- View ---------------- */

  #gisZoom() {
    return toGisZoom(this.map?.getZoom() ?? toEngineZoom(this.defaultView.zoom));
  }

  getViewState() {
    if (!this.map) return { type: "map", camera: null, center: null, zoom: undefined, heading: 0, tilt: 0 };
    const center = this.map.getCenter();
    return { type: "map", camera: null, center: [center.lng, center.lat], zoom: this.#gisZoom(), heading: normalizeHeading(this.map.getBearing()), tilt: this.map.getPitch() };
  }

  getCamera() {
    if (!this.map) throw new GisMapError("NOT_READY", "The map is not ready yet.");
    const center = this.map.getCenter();
    return {
      center: [round(center.lng, 6), round(center.lat, 6)],
      zoom: round(this.#gisZoom(), 2),
      scale: Math.round(this.getScale()),
      heading: round(normalizeHeading(this.map.getBearing()), 1),
      tilt: round(this.map.getPitch(), 1),
    };
  }

  getScale() {
    if (!this.map) return null;
    // The scale ArcGIS reports for a zoom level (Web Mercator at the equator), so scales mean the same in links.
    return SCALE_AT_ZOOM_0 / 2 ** this.#gisZoom();
  }

  getViewpoint() {
    return null;
  }

  getViewExtent() {
    const bounds = this.#viewBounds();
    return bounds ? { xmin: bounds[0], ymin: bounds[1], xmax: bounds[2], ymax: bounds[3], spatialReference: { wkid: 4326 } } : null;
  }

  viewExtentFilter() {
    const view = this.#viewBounds();
    return view ? (geometry) => boundsIntersect(boundsOf(geometry), view) : null;
  }

  getCurrentExtentDetails() {
    const bounds = this.#viewBounds();
    if (!bounds) return null;
    const center = this.map.getCenter();
    return {
      west: round(bounds[0], 6), south: round(bounds[1], 6), east: round(bounds[2], 6), north: round(bounds[3], 6),
      center: { longitude: round(center.lng, 6), latitude: round(center.lat, 6) },
      zoom: round(this.#gisZoom(), 2),
    };
  }

  getViewPadding() {
    return this.map ? { ...this.map.getPadding() } : null;
  }

  setViewPadding(padding) {
    this.map?.setPadding(padding || { top: 0, right: 0, bottom: 0, left: 0 });
  }

  geographicCoordinates(geometry) {
    const point = representativePoint(geometry);
    if (!point) return null;
    const wkid = geometry?.spatialReference?.latestWkid ?? geometry?.spatialReference?.wkid;
    return wkid ? geographicPoint(point.longitude, point.latitude, wkid) : point;
  }

  /** A saved ArcGIS camera (eye position, heading, tilt) as the centre and zoom it looks at. */
  #fromCamera(camera) {
    const position = camera?.position;
    if (!position || !Number.isFinite(position.x)) return null;
    const eye = geographicPoint(position.x, position.y, position.spatialReference?.latestWkid ?? position.spatialReference?.wkid);
    const heading = Number(camera.heading) || 0;
    const tilt = Math.min(MAX_PITCH, Number(camera.tilt) || 0);
    const altitude = Math.max(1, Number(position.z) || 10000);
    const reach = altitude * Math.tan((tilt * Math.PI) / 180);
    const latitude = eye.latitude + (reach * Math.cos((heading * Math.PI) / 180)) / 111320;
    const longitude = eye.longitude + (reach * Math.sin((heading * Math.PI) / 180)) / (111320 * Math.cos((eye.latitude * Math.PI) / 180));
    // A SceneView about 1,200 pixels wide shows a map scale of roughly 3.3 times the slant distance.
    const slant = altitude / Math.cos((tilt * Math.PI) / 180);
    return { center: [longitude, latitude], zoom: zoomForScale(slant * 3.28), heading, tilt };
  }

  #centerOf(value) {
    if (Array.isArray(value)) return [Number(value[0]), Number(value[1])];
    if (value && Number.isFinite(value.longitude)) return [value.longitude, value.latitude];
    if (value && Number.isFinite(value.x)) {
      const point = geographicPoint(value.x, value.y, value.spatialReference?.latestWkid ?? value.spatialReference?.wkid);
      return [point.longitude, point.latitude];
    }
    return null;
  }

  async #move(camera, { animate = true, duration, padding } = {}) {
    if (!this.map) return;
    const options = { ...camera, ...(padding !== undefined ? { padding: typeof padding === "number" ? { top: padding, right: padding, bottom: padding, left: padding } : padding } : {}) };
    if (animate === false) {
      this.map.jumpTo(options);
      return;
    }
    await this.#untilMoved(() => this.map.easeTo({ ...options, ...(duration !== undefined ? { duration } : {}) }));
  }

  /** Runs a camera move and waits for it to end (or a few seconds, when the map is not drawing). */
  async #untilMoved(start) {
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 5000);
      this.map.once("moveend", () => { clearTimeout(timer); resolve(); });
      start();
    });
  }

  async #fit(bounds, { animate = true, padding = 40, maxZoom, heading, tilt } = {}) {
    if (!this.map || !bounds) return;
    const [west, south, east, north] = bounds;
    const options = { padding: typeof padding === "number" ? padding : { top: 0, right: 0, bottom: 0, left: 0, ...padding }, animate: animate !== false, ...(Number.isFinite(maxZoom) ? { maxZoom: toEngineZoom(maxZoom) } : {}), ...(Number.isFinite(heading) ? { bearing: heading } : {}), ...(Number.isFinite(tilt) ? { pitch: tilt } : {}) };
    if (animate === false) {
      this.map.fitBounds([[west, south], [east, north]], options);
      return;
    }
    await this.#untilMoved(() => this.map.fitBounds([[west, south], [east, north]], options));
  }

  /** Moves the camera (engine-interface.js ViewTarget). */
  async setView(target, options = {}) {
    if (!this.map || !target) return;
    const animation = { animate: options?.animate, duration: options?.duration, padding: options?.padding };
    if (target.camera || target.viewpoint) {
      const viewpoint = target.viewpoint;
      const camera = this.#fromCamera(target.camera || viewpoint?.camera);
      if (camera) return this.#move({ center: camera.center, zoom: toEngineZoom(camera.zoom), bearing: camera.heading, pitch: camera.tilt }, animation);
      const center = this.#centerOf(representativePoint(viewpoint?.targetGeometry) || viewpoint?.targetGeometry);
      if (center) return this.#move({ center, ...(Number.isFinite(viewpoint.scale) ? { zoom: toEngineZoom(zoomForScale(viewpoint.scale)) } : {}), bearing: -(Number(viewpoint.rotation) || 0) }, animation);
      return;
    }
    if (Array.isArray(target.features)) {
      const bounds = boundsOf(target.features.map((feature) => feature?.geometry).filter(Boolean));
      return bounds ? this.#fit(expandBounds(bounds, 1.1), { ...animation, padding: options?.padding ?? 40 }) : undefined;
    }
    if (Array.isArray(target.bounds)) return this.#fit(target.bounds, { ...animation, padding: options?.padding ?? 0, heading: target.heading, tilt: target.tilt });
    if (target.geometry) {
      const bounds = boundsOf(target.geometry);
      if (!bounds) return;
      const isPoint = bounds[0] === bounds[2] && bounds[1] === bounds[3];
      if (target.fit === "feature" || !Number.isFinite(target.zoom)) {
        if (isPoint) return this.#move({ center: [bounds[0], bounds[1]], zoom: toEngineZoom(target.fit === "feature" ? 15 : this.#gisZoom()), pitch: 0 }, animation);
        return this.#fit(expandBounds(bounds, 1.25), { ...animation, padding: options?.padding ?? 0, tilt: target.fit === "feature" ? 0 : target.tilt });
      }
      const point = representativePoint(target.geometry);
      return this.#move({ center: [point.longitude, point.latitude], zoom: toEngineZoom(target.zoom) }, animation);
    }
    const camera = {};
    const center = this.#centerOf(target.center);
    if (center) camera.center = center;
    if (Number.isFinite(Number(target.zoom)) && target.zoom !== null && target.zoom !== undefined) camera.zoom = toEngineZoom(target.zoom);
    else if (Number.isFinite(Number(target.scale)) && target.scale) camera.zoom = toEngineZoom(zoomForScale(target.scale));
    if (Number.isFinite(Number(target.heading)) && target.heading !== null && target.heading !== undefined) camera.bearing = Number(target.heading);
    if (Number.isFinite(Number(target.tilt)) && target.tilt !== null && target.tilt !== undefined) camera.pitch = Math.min(MAX_PITCH, Number(target.tilt));
    return this.#move(camera, animation);
  }

  async navigate(action) {
    if (!this.map) return null;
    if (action === "home") return this.setView(this.defaultView);
    if (action === "in") return this.#move({ zoom: this.map.getZoom() + 1 });
    if (action === "out") return this.#move({ zoom: this.map.getZoom() - 1 });
    if (action === "north") return this.#move({ bearing: 0 }, { duration: 350 });
    if (action === "rotate-left") return this.#move({ bearing: this.map.getBearing() - 20 }, { duration: 350 });
    if (action === "rotate-right") return this.#move({ bearing: this.map.getBearing() + 20 }, { duration: 350 });
    if (action === "tilt-up") return this.#move({ pitch: Math.min(MAX_PITCH, this.map.getPitch() + 10) }, { duration: 350 });
    if (action === "tilt-down") return this.#move({ pitch: Math.max(0, this.map.getPitch() - 10) }, { duration: 350 });
    if (action === "locate") return this.locateUser({ move: true });
    return null;
  }

  async locateUser({ move = true } = {}) {
    if (!navigator.geolocation) throw new Error("Geolocation is not supported by this browser.");
    const position = await new Promise((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }),
    );
    if (!move) return position.coords;
    return this.setView({ center: [position.coords.longitude, position.coords.latitude], zoom: 15, tilt: 0 });
  }

  /** [west, south, east, north] of the layers' filtered data (all data layers when none are given), or null. */
  async dataBounds(layers = null) {
    const records = (layers ? layers.map((ref) => this.#record(ref)) : [...this.#records.values()]).filter(Boolean);
    return boundsOf(records.flatMap((record) => this.#visibleFeatures(record).map((feature) => feature.geometry)));
  }

  async layerExtent(ref) {
    const bounds = await this.dataBounds([ref]);
    return bounds ? { xmin: bounds[0], ymin: bounds[1], xmax: bounds[2], ymax: bounds[3], spatialReference: { wkid: 4326 } } : null;
  }

  async goToLayers(layers = null, { animate = true } = {}) {
    const bounds = await this.dataBounds(layers);
    if (!bounds) return false;
    await this.#fit(expandBounds(bounds, 1.08), { animate, padding: 24, tilt: 0 });
    return true;
  }

  async goToLayer(ref) {
    return this.goToLayers([ref]);
  }

  async goToLayerOnInitialLoad(ref) {
    if (this.#gisZoom() > 5.5) return false;
    return this.goToLayer(ref);
  }

  async goToSearchResult(result) {
    if (result?.extent && Number.isFinite(result.extent.xmin)) {
      const { xmin, ymin, xmax, ymax } = result.extent;
      const wkid = result.extent.spatialReference?.latestWkid ?? result.extent.spatialReference?.wkid;
      const southwest = geographicPoint(xmin, ymin, wkid);
      const northeast = geographicPoint(xmax, ymax, wkid);
      return this.#fit([southwest.longitude, southwest.latitude, northeast.longitude, northeast.latitude], { padding: 0, tilt: 0 });
    }
    return this.setView({ center: result.location, zoom: 14, tilt: 0 });
  }

  async goToTaskPlaces(points = [], { animate = true } = {}) {
    const places = points.filter((point) => Number.isFinite(point?.longitude) && Number.isFinite(point?.latitude));
    if (!this.map || !places.length) return;
    if (places.length === 1) return this.setView({ center: [places[0].longitude, places[0].latitude], zoom: 16, tilt: 0, heading: 0 }, { animate });
    const bounds = boundsOf(places.map((point) => ({ type: "Point", coordinates: [point.longitude, point.latitude] })));
    return this.#fit(expandBounds(bounds, 1.4), { animate, padding: 0, tilt: 0, heading: 0 });
  }

  /* ---------------- Capture ---------------- */

  /**
   * The map as an image: { dataUrl, width, height }. `aspect` crops around the
   * centre; `height` with `width` sets the output size (cropped to its shape).
   */
  async captureImage({ format = "jpg", quality = 82, width = 1200, height = null, aspect = null } = {}) {
    if (!this.map) return null;
    await Promise.race([
      this.map.loaded() ? Promise.resolve() : new Promise((resolve) => this.map.once("idle", resolve)),
      new Promise((resolve) => setTimeout(resolve, 8000)),
    ]);
    const canvas = this.map.getCanvas();
    const shape = Number.isFinite(aspect) && aspect > 0 ? aspect : Number.isFinite(height) && height > 0 ? width / height : canvas.width / canvas.height;
    const cropWidth = Math.min(canvas.width, Math.round(canvas.height * shape));
    const cropHeight = Math.min(canvas.height, Math.round(cropWidth / shape));
    const outputWidth = Math.max(1, Math.round(Math.min(width, Number.isFinite(aspect) ? cropWidth : width)));
    const outputHeight = Number.isFinite(height) && height > 0 && !Number.isFinite(aspect) ? Math.round(height) : Math.max(1, Math.round(outputWidth / shape));
    const output = document.createElement("canvas");
    output.width = outputWidth;
    output.height = outputHeight;
    const context = output.getContext("2d");
    if (format !== "png") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, outputWidth, outputHeight);
    }
    context.drawImage(canvas, Math.round((canvas.width - cropWidth) / 2), Math.round((canvas.height - cropHeight) / 2), cropWidth, cropHeight, 0, 0, outputWidth, outputHeight);
    const dataUrl = output.toDataURL(format === "png" ? "image/png" : "image/jpeg", Math.max(0, Math.min(1, quality / 100)));
    return { dataUrl, width: outputWidth, height: outputHeight };
  }
}

export default MaplibreEngine;
