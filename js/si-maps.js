// Saved maps in GISMap SI (docs: SI's MAP-REST-API.md). `/m/<id>` opens a saved map or
// Brief for editing; `/m/<id>?p=<pid>` opens a publication in the viewer. This module
// converts between the editor's state (a map-v1 spec, schemas/map-v1.schema.json) and
// SI's `state` block, and talks to SI through the tab's SiConnection. No DOM here.

import { SiError } from "./si-connection.js?v=0.72.0-si-maps";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const KINDS = new Set(["map", "brief"]);
// map-v1 layer settings SI has no standard name for travel in the layer's `extras`.
const LAYER_EXTRAS = ["spatialChart", "subsurface", "animatedEffect", "scene3d", "ignoreServiceScaleRange", "popup", "outFields", "refreshInterval"];
// …and the map's own, in `state.extras`.
const MAP_EXTRAS = ["skin", "underground", "charts", "analysis"];

/** The `/m/<id>` route in this address: `{ mapId, publicationId, app }`, or null. */
export function parseSiMapRoute(location = globalThis.location) {
  const match = String(location?.pathname || "").match(/\/m\/([^/]+)\/?$/);
  if (!match || !ID.test(match[1])) return null;
  const params = new URLSearchParams(location.search || "");
  const publicationId = params.get("p");
  return {
    mapId: match[1],
    publicationId: publicationId && ID.test(publicationId) ? publicationId : null,
    app: params.get("app") === "ai-map" ? "ai-map" : null,
  };
}

/** SI's name for where a layer comes from, or null when SI has none (SI then reports the layer). */
export function sourceKind(type, url) {
  const path = (() => { try { return new URL(url).pathname.toLowerCase(); } catch { return ""; } })();
  if (path.includes("/featureserver")) return "featureserver";
  if (path.includes("/mapserver")) return "mapserver";
  if (path.includes("/imageserver")) return "rastertiles";
  return ({ geojson: "geojson-url", wms: "wms", wmts: "wmts", "vector-tiles": "vectortiles", cog: "cog-url" })[type] || null;
}

function layerType(source = {}) {
  if (typeof source.layerType === "string" && source.layerType) return source.layerType;
  return ({ featureserver: "arcgis-auto", mapserver: "arcgis-auto", "geojson-url": "geojson", wms: "wms", vectortiles: "vector-tiles", "si-service": "arcgis-auto" })[source.kind] || "arcgis-auto";
}

const RENDERER_TYPES = new Set(["service", "simple", "choropleth", "graduated-symbols", "categories", "heatmap", "arcgis", "auto"]);
// SI stores Online's renderer as written; maps imported from old links hold Esri renderer JSON.
function rendererFromStyle(style) {
  if (!style || typeof style !== "object") return undefined;
  const esri = !RENDERER_TYPES.has(style.type) || (style.type === "simple" && style.symbol) || (style.type === "heatmap" && style.colorStops);
  return esri ? { type: "arcgis", json: style } : style;
}

const finite = (value) => (Number.isFinite(value) ? value : undefined);
const defined = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

/**
 * The editor's map-v1 spec for an SI document (`kind` map or brief). SI layer ids are
 * kept beside the spec, so a save matches each layer back to its id and SI-only settings.
 */
export function siDocumentToMapSpec(document) {
  const state = document?.state && typeof document.state === "object" ? document.state : {};
  const extras = state.extras && typeof state.extras === "object" ? state.extras : {};
  const spec = { version: 1 };
  if (document?.title) spec.title = String(document.title);
  if (typeof document?.description === "string" && document.description) spec.description = document.description;
  if (typeof state.basemap?.id === "string" && state.basemap.id) spec.basemap = state.basemap.id;
  // Older saves name the skin `s`; it is read as the skin and saved back under its own name.
  const skin = typeof extras.skin === "string" ? extras.skin : typeof extras.s === "string" ? extras.s : null;
  if (skin) spec.skin = skin;
  for (const key of MAP_EXTRAS.slice(1)) if (extras[key] !== undefined) spec[key] = extras[key];
  if (state.legend && typeof state.legend === "object") spec.legend = state.legend;
  const view = state.view || {};
  spec.camera = Array.isArray(view.center) && view.center.length === 2 && view.center.every(Number.isFinite) && Number.isFinite(view.zoom)
    ? defined({ center: view.center, zoom: view.zoom, heading: finite(view.bearing), tilt: finite(view.pitch) })
    : { fit: "layers" };
  const layerIds = [];
  spec.layers = (Array.isArray(state.layers) ? state.layers : []).filter((layer) => typeof layer?.source?.url === "string").map((layer) => {
    layerIds.push(layer.id);
    const layerExtras = layer.extras && typeof layer.extras === "object" ? layer.extras : {};
    return defined({
      url: layer.source.url,
      type: layerType(layer.source),
      title: typeof layer.name === "string" && layer.name ? layer.name : undefined,
      where: typeof layer.where === "string" && layer.where ? layer.where : undefined,
      renderer: rendererFromStyle(layer.style),
      opacity: Number.isFinite(layer.opacity) && layer.opacity < 1 ? layer.opacity : undefined,
      visible: layer.visible === false ? false : undefined,
      ...Object.fromEntries(LAYER_EXTRAS.filter((key) => layerExtras[key] !== undefined).map((key) => [key, layerExtras[key]])),
    });
  });
  if (document?.kind === "brief" && state.briefing && typeof state.briefing === "object") spec.briefing = state.briefing;
  return { spec, layerIds };
}

/**
 * SI's `state` block for the editor's spec. `previous` is the state last loaded or saved:
 * unchanged layers keep their ids and the settings Online doesn't edit (effects, labels,
 * SI's own extras), and unknown properties are kept, as SI's API asks.
 */
export function mapSpecToSiState(spec, { kind = "map", previous = null } = {}) {
  const before = previous && typeof previous === "object" ? previous : {};
  const oldLayers = Array.isArray(before.layers) ? before.layers.filter((layer) => layer?.source?.url) : [];
  const used = new Set();
  const claim = (url) => {
    const match = oldLayers.find((layer) => !used.has(layer) && layer.source.url === url);
    if (match) used.add(match);
    return match || null;
  };
  const ids = new Set(oldLayers.map((layer) => layer.id));
  let next = 1;
  const freshId = () => { while (ids.has(`l${next}`)) next += 1; ids.add(`l${next}`); return `l${next}`; };
  const layers = (spec.layers || []).map((layer) => {
    const old = claim(layer.url);
    const oldExtras = old?.extras && typeof old.extras === "object" ? old.extras : {};
    const extras = { ...Object.fromEntries(Object.entries(oldExtras).filter(([key]) => !LAYER_EXTRAS.includes(key))) };
    for (const key of LAYER_EXTRAS) if (layer[key] !== undefined) extras[key] = layer[key];
    return defined({
      ...(old || {}),
      id: old?.id || freshId(),
      name: layer.title || null,
      source: { ...(old?.source || {}), kind: old?.source?.kind || sourceKind(layer.type, layer.url), url: layer.url, layerType: layer.type || null },
      style: layer.renderer && layer.renderer.type !== "service" ? layer.renderer : null,
      where: layer.where || null,
      opacity: Number.isFinite(layer.opacity) ? layer.opacity : 1,
      visible: layer.visible !== false,
      extras: Object.keys(extras).length ? extras : undefined,
    });
  });
  const camera = spec.camera || {};
  const view = Array.isArray(camera.center)
    ? { center: camera.center, zoom: camera.zoom ?? null, bearing: Number(camera.heading) || 0, pitch: Number(camera.tilt) || 0 }
    : before.view || { center: null, zoom: null, bearing: 0, pitch: 0 };
  const extras = { ...(before.extras || {}) };
  delete extras.s;
  for (const key of MAP_EXTRAS) {
    if (spec[key] !== undefined) extras[key] = spec[key];
    else delete extras[key];
  }
  const state = {
    ...before,
    view,
    basemap: { ...(before.basemap || {}), id: spec.basemap || null },
    layers,
    annotations: before.annotations || { type: "FeatureCollection", features: [] },
    extras,
  };
  if (spec.legend) state.legend = spec.legend;
  if (kind === "brief") state.briefing = spec.briefing || { schemaVersion: 1, slides: [] };
  else delete state.briefing;
  return state;
}

/** What to tell the user about an SI error, by its status (MAP-REST-API.md "Responses Online must handle"). */
export function describeSiError(error) {
  const status = error?.status || 0;
  const body = error?.body || {};
  if (status === 401) return { kind: "signin", message: error.message || "Sign in to GISMap SI." };
  if (status === 402) return { kind: "upgrade", message: `This workspace has reached its plan limit${Number.isFinite(body.maximum) ? ` of ${body.maximum} ${body.limit === "documents" || !body.limit ? "maps" : String(body.limit)}` : ""}. Upgrade the workspace in GISMap SI to save more.` };
  if (status === 403) return { kind: "forbidden", message: error.message || "Your GISMap SI connection doesn't allow that action." };
  if (status === 404) return { kind: "notfound", message: "This map wasn't found. It may be private to its workspace, or the link may be wrong." };
  if (status === 409 && body.error === "version_conflict") return { kind: "conflict", message: "A newer version of this map exists. Reload it to see the changes before saving or publishing.", currentVersion: body.currentVersion };
  if (status === 409 && body.error === "publication_pinned") return { kind: "pinned", message: body.message || "A pinned publication keeps what was presented. Publish a new one." };
  if (status === 410) return { kind: "gone", message: "This map is no longer available." };
  if (status === 422 && Array.isArray(body.issues)) return { kind: "validation", message: "GISMap SI couldn't accept this map.", issues: body.issues.map((issue) => ({ message: String(issue?.message || issue?.code || "Invalid"), layerId: issue?.layerId || null, code: issue?.code || null })) };
  if (status === 422) return { kind: "validation", message: typeof body.detail === "string" ? body.detail : "GISMap SI couldn't read this request.", issues: [] };
  if (status === 428) return { kind: "bug", message: "GISMap Online didn't say which version it was saving. Reload the map and try again." };
  return { kind: "error", message: error?.message || "GISMap SI returned an error." };
}

/** The SI routes Online uses, through the tab's SiConnection. */
export class SiMapsClient {
  constructor(connection) { this.connection = connection; }
  load(id) { return this.#data(`/maps/${encodeURIComponent(id)}`); }
  /** A publication is public: no token is sent with it. */
  loadPublication(publicationId) { return this.#data(`/maps/publications/${encodeURIComponent(publicationId)}`, { auth: false }); }
  create({ kind, title, state, workspaceId }) { return this.#data("/maps", { method: "POST", body: defined({ schemaVersion: 1, kind, title, state, workspaceId }) }); }
  save(id, { kind, title, state }, version) {
    if (!Number.isInteger(version)) throw new SiError("GISMap Online didn't say which version it was saving.", { status: 428, code: "version_required" });
    return this.#data(`/maps/${encodeURIComponent(id)}`, { method: "PUT", body: defined({ schemaVersion: 1, kind, title, state }), headers: { "If-Match": String(version) } });
  }
  context(id) { return this.#data(`/maps/${encodeURIComponent(id)}/context`); }
  workspaces() { return this.#data("/stored/workspaces"); }
  datasets({ workspaceId, search = "" }) {
    const query = new URLSearchParams({ workspace_id: workspaceId });
    if (search) query.set("search", String(search).slice(0, 120));
    return this.#data(`/stored/datasets?${query}`);
  }
  publications(id) { return this.#data(`/maps/${encodeURIComponent(id)}/publications`); }
  publish(id, dataMode, version) { return this.#data(`/maps/${encodeURIComponent(id)}/publications`, { method: "POST", body: { dataMode }, headers: { "If-Match": String(version) } }); }
  republish(id, publicationId, version) { return this.#data(`/maps/${encodeURIComponent(id)}/publications/${encodeURIComponent(publicationId)}`, { method: "PUT", headers: { "If-Match": String(version) } }); }
  verify(id, publicationId) { return this.#data(`/maps/${encodeURIComponent(id)}/publications/${encodeURIComponent(publicationId)}/verify`, { method: "POST" }); }
  async #data(path, options) { return (await this.connection.request(path, options)).data; }
}

/**
 * The open `/m/` document: what was loaded, its version and whether it may be edited.
 * `open()` and `save()` return `{ spec, warnings }` for the editor to show.
 */
export class SiMapSession {
  constructor({ client, route }) {
    Object.assign(this, { client, route });
    this.document = null;
    this.publication = null;
  }

  get mapId() { return this.document?.id || this.route?.mapId || null; }
  get kind() { return KINDS.has(this.document?.kind) ? this.document.kind : "map"; }
  get version() { return this.document?.version ?? null; }
  get viewer() { return Boolean(this.route?.publicationId); }
  get canEdit() { return !this.viewer && this.document?.canEdit === true; }
  get workspaceId() { return this.document?.workspaceId || null; }

  async open() {
    if (this.viewer) {
      const document = await this.client.loadPublication(this.route.publicationId);
      this.document = { ...document, canEdit: false };
      this.publication = document.publication || null;
    } else {
      this.document = await this.client.load(this.route.mapId);
    }
    if (!["map", "brief"].includes(this.document?.kind)) throw new SiError(`GISMap Online can't open a saved ${this.document?.kind || "document"} yet.`, { code: "unsupported_kind" });
    return { ...siDocumentToMapSpec(this.document), warnings: [] };
  }

  /** The SI state the editor's spec would save as (also how the Publish panel spots unsaved changes). */
  stateFor(spec) { return mapSpecToSiState(spec, { kind: this.kind, previous: this.document?.state || null }); }

  /**
   * True when the editor's spec differs from the version last loaded or saved. Both sides go
   * through the same conversion, so renaming SI's older keys alone isn't a change.
   */
  changed(spec) {
    if (!this.document) return true;
    return JSON.stringify(this.stateFor(spec)) !== JSON.stringify(this.stateFor(siDocumentToMapSpec(this.document).spec));
  }

  /** POST for a new map, otherwise PUT with If-Match. A save SI changed (warnings) is read back fresh. */
  async save(spec, { title = spec.title || this.document?.title || "Untitled map", kind = this.kind } = {}) {
    if (this.viewer || (this.document && !this.canEdit)) throw new SiError("This map is read-only for you.", { status: 403, code: "read_only" });
    const state = mapSpecToSiState(spec, { kind, previous: this.document?.state || null });
    const saved = this.document?.id
      ? await this.client.save(this.document.id, { kind, title, state }, this.document.version)
      : await this.client.create({ kind, title, state, workspaceId: this.workspaceId || undefined });
    const warnings = Array.isArray(saved?.warnings) ? saved.warnings.map(String) : [];
    if (warnings.length) {
      // SI removed something (credentials, for instance): edit what SI kept, not what was sent.
      this.document = await this.client.load(saved.id || this.document.id);
      return { ...siDocumentToMapSpec(this.document), warnings, reloaded: true };
    }
    // SI answers a save with { id, shareUrl, version, warnings }; what it stored is what was sent.
    this.document = { ...this.document, id: saved.id, shareUrl: saved.shareUrl, version: saved.version, kind, title, state, canEdit: true };
    return { ...siDocumentToMapSpec(this.document), warnings, reloaded: false };
  }
}
