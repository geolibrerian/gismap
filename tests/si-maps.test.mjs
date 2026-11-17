import assert from "node:assert/strict";
import test from "node:test";
import { SiConnection } from "../js/si-connection.js";
import { SiMapSession, SiMapsClient, describeSiError, mapSpecToSiState, parseSiMapRoute, siDocumentToMapSpec } from "../js/si-maps.js";

const NOW = Date.parse("2026-11-17T12:00:00Z");
const FIRES = "https://services.arcgis.com/x/arcgis/rest/services/Fires/FeatureServer/0";
const KOOP = "https://koop.gismap.si/koop/abc/FeatureServer/0";

function storageWith(connection) {
  const map = new Map(connection ? [["gismap-online:si-connection:v1", JSON.stringify(connection)]] : []);
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
}
const signedIn = () => storageWith({ token: "gsoc_t", expiresAt: "2026-11-17T20:00:00Z", scopes: ["maps:read", "maps:write", "stored:read"], user: { email: "ana@example.org" } });

/** A fake SI: `routes["GET /maps/m_1"] = (request) => [status, body]`. Records each request. */
function fakeSi(routes) {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace("https://online-api.gismap.si/api/v1", "");
    const request = { method: options.method, path, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    const handler = routes[`${options.method} ${path}`];
    const [status, body] = handler ? handler(request) : [404, { detail: "Not found." }];
    return { ok: status < 300, status, json: async () => body };
  };
  return { requests, connection: new SiConnection({ storage: signedIn(), fetchImpl, now: () => NOW }) };
}

const savedMap = () => ({
  schemaVersion: 1, kind: "map", id: "m_1", title: "Current fires", version: 4, canEdit: true, workspaceId: "w1",
  state: {
    view: { center: [-119.09, 43.76], zoom: 9.74, bearing: 0, pitch: 40.2 },
    basemap: { id: "gray-vector" },
    layers: [{
      id: "l1", name: "Perimeters", source: { kind: "featureserver", url: FIRES, layerType: "arcgis-auto" },
      style: { type: "categories", field: "FeatureCategory" }, where: "FireDiscoveryAge <= 7",
      effect: { type: "fire", intensity: 1 }, opacity: 0.9, visible: true, extras: { s: 1, scene3d: { kind: "extrusion" } },
    }],
    annotations: { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: {} }] },
    extras: { s: "highway", future: { kept: true } },
    somethingNew: 7,
  },
});

test("the /m/ route: editor, viewer and AI Map", () => {
  assert.deepEqual(parseSiMapRoute({ pathname: "/m/m_uRaPhRLdZH26", search: "" }), { mapId: "m_uRaPhRLdZH26", publicationId: null, app: null });
  assert.deepEqual(parseSiMapRoute({ pathname: "/m/m_1/", search: "?app=ai-map" }), { mapId: "m_1", publicationId: null, app: "ai-map" });
  assert.deepEqual(parseSiMapRoute({ pathname: "/gismap/m/m_1", search: "?p=7d0c0a52-3c1e-4c43-8d61-0d1b1d8c9b0e" }).publicationId, "7d0c0a52-3c1e-4c43-8d61-0d1b1d8c9b0e");
  assert.equal(parseSiMapRoute({ pathname: "/", search: "" }), null);
  assert.equal(parseSiMapRoute({ pathname: "/m/<script>", search: "" }), null);
  assert.equal(parseSiMapRoute({ pathname: "/m/m_1", search: "?p=../../x" }).publicationId, null);
});

test("SI's state becomes the editor's map spec, keeping what Online can't name", () => {
  const { spec, layerIds } = siDocumentToMapSpec(savedMap());
  assert.deepEqual(layerIds, ["l1"]);
  assert.deepEqual(spec.camera, { center: [-119.09, 43.76], zoom: 9.74, heading: 0, tilt: 40.2 });
  assert.equal(spec.basemap, "gray-vector");
  assert.equal(spec.skin, "highway", "the old `s` key is the skin");
  assert.deepEqual(spec.layers[0], { url: FIRES, type: "arcgis-auto", title: "Perimeters", where: "FireDiscoveryAge <= 7", renderer: { type: "categories", field: "FeatureCategory" }, opacity: 0.9, scene3d: { kind: "extrusion" } });
  // Esri renderer JSON from old links is drawn as an ArcGIS renderer.
  const old = savedMap();
  old.state.layers[0].style = { type: "uniqueValue", field1: "FeatureCategory" };
  assert.deepEqual(siDocumentToMapSpec(old).spec.layers[0].renderer, { type: "arcgis", json: { type: "uniqueValue", field1: "FeatureCategory" } });
});

test("the editor's spec becomes SI's state, with ids, effects, annotations and unknown keys kept", () => {
  const document = savedMap();
  const { spec } = siDocumentToMapSpec(document);
  spec.layers.push({ url: KOOP, type: "arcgis-auto", title: "Inspections", where: "STATUS = 'open'" });
  spec.camera = { center: [-120, 44], zoom: 8, heading: 10, tilt: 0 };
  const state = mapSpecToSiState(spec, { kind: "map", previous: document.state });
  assert.equal(state.layers[0].id, "l1");
  assert.deepEqual(state.layers[0].effect, { type: "fire", intensity: 1 }, "SI-only settings stay");
  assert.deepEqual(state.layers[0].extras, { s: 1, scene3d: { kind: "extrusion" } });
  assert.deepEqual(state.layers[1], { id: "l2", name: "Inspections", source: { kind: "featureserver", url: KOOP, layerType: "arcgis-auto" }, style: null, where: "STATUS = 'open'", opacity: 1, visible: true });
  assert.deepEqual(state.view, { center: [-120, 44], zoom: 8, bearing: 10, pitch: 0 });
  assert.deepEqual(state.extras, { future: { kept: true }, skin: "highway" }, "the skin gets its own name");
  assert.equal(state.annotations.features.length, 1);
  assert.equal(state.somethingNew, 7, "unknown properties are kept");
  assert.equal(state.briefing, undefined);
  // An unchanged spec is an unchanged state, so nothing looks unsaved.
  const again = mapSpecToSiState(siDocumentToMapSpec({ ...document, state }).spec, { kind: "map", previous: state });
  assert.deepEqual(again, state);
});

test("a Brief round-trips its slides, including pinned figures", () => {
  const brief = { ...savedMap(), kind: "brief" };
  brief.state.briefing = { schemaVersion: 1, layerId: FIRES, slides: [{ id: "s1", template: "key-numbers", title: "Fires", blocks: [{ id: "b1", type: "stat", stat: "count", pinned: { value: 42, computedAt: "2026-11-17T10:00:00Z" } }] }] };
  const { spec } = siDocumentToMapSpec(brief);
  assert.equal(spec.briefing.slides[0].blocks[0].pinned.value, 42);
  const state = mapSpecToSiState(spec, { kind: "brief", previous: brief.state });
  assert.deepEqual(state.briefing, brief.state.briefing);
  assert.deepEqual(mapSpecToSiState({ version: 1, layers: [] }, { kind: "brief" }).briefing, { schemaVersion: 1, slides: [] });
});

test("load and save round trip: GET, then PUT with If-Match, then PUT with the new version", async () => {
  let stored = savedMap();
  const { requests, connection } = fakeSi({
    "GET /maps/m_1": () => [200, stored],
    "PUT /maps/m_1": (request) => {
      if (Number(request.headers["If-Match"]) !== stored.version) return [409, { error: "version_conflict", currentVersion: stored.version }];
      stored = { ...stored, version: stored.version + 1, title: request.body.title, state: request.body.state };
      return [200, { id: "m_1", shareUrl: "https://gismap.online/m/m_1", version: stored.version, warnings: [] }];
    },
  });
  const session = new SiMapSession({ client: new SiMapsClient(connection), route: { mapId: "m_1", publicationId: null, app: null } });
  const opened = await session.open();
  assert.ok(session.canEdit);
  assert.equal(opened.spec.title, "Current fires");
  assert.equal(session.changed(opened.spec), false);
  const edited = { ...opened.spec, layers: [{ ...opened.spec.layers[0], where: "FireDiscoveryAge <= 3" }] };
  assert.equal(session.changed(edited), true);
  const first = await session.save(edited);
  assert.deepEqual(first.warnings, []);
  assert.equal(session.version, 5);
  assert.equal(session.changed(edited), false, "what was saved is what SI holds");
  await session.save({ ...edited, title: "Fires this week" });
  const puts = requests.filter((request) => request.method === "PUT");
  assert.deepEqual(puts.map((request) => request.headers["If-Match"]), ["4", "5"]);
  assert.equal(puts[0].headers.Authorization, "Bearer gsoc_t");
  assert.equal(puts[0].body.kind, "map");
  assert.equal(puts[0].body.state.layers[0].where, "FireDiscoveryAge <= 3");
  assert.deepEqual(puts[0].body.state.layers[0].effect, { type: "fire", intensity: 1 });
  assert.equal(stored.title, "Fires this week");
  assert.ok(!JSON.stringify(puts.map((request) => request.body)).includes("gsoc_t"), "the token never goes into a saved map");
});

test("a new map is created with POST; a save SI changed is read back fresh", async () => {
  const { requests, connection } = fakeSi({
    "POST /maps": () => [201, { id: "m_new", shareUrl: "https://gismap.online/m/m_new", version: 1, warnings: ["A token was removed from a layer URL."] }],
    "GET /maps/m_new": () => [200, { schemaVersion: 1, kind: "map", id: "m_new", title: "Mine", version: 1, canEdit: true, state: { layers: [{ id: "l1", name: "Fires", source: { kind: "featureserver", url: FIRES } }] } }],
  });
  const session = new SiMapSession({ client: new SiMapsClient(connection), route: null });
  const result = await session.save({ version: 1, title: "Mine", layers: [{ url: `${FIRES}?token=abc`, type: "arcgis-auto", title: "Fires" }] });
  assert.deepEqual(requests.map((request) => `${request.method} ${request.path}`), ["POST /maps", "GET /maps/m_new"]);
  assert.equal(requests[0].body.kind, "map");
  assert.deepEqual(result.warnings, ["A token was removed from a layer URL."]);
  assert.equal(result.reloaded, true);
  assert.equal(result.spec.layers[0].url, FIRES, "the editor shows what SI kept");
  assert.equal(session.mapId, "m_new");
  assert.equal(session.version, 1);
});

test("a share link opens the viewer: the publication is read without the token, and can't be saved", async () => {
  const { requests, connection } = fakeSi({
    "GET /maps/publications/p1": () => [200, { ...savedMap(), kind: "brief", canEdit: false, visibility: "unlisted", publication: { id: "p1", dataMode: "pinned", publishedAt: "2026-11-17T10:00:00Z", sourcesChangedSince: true } }],
  });
  const session = new SiMapSession({ client: new SiMapsClient(connection), route: { mapId: "m_1", publicationId: "p1", app: null } });
  await session.open();
  assert.equal(requests[0].path, "/maps/publications/p1");
  assert.equal(requests[0].headers.Authorization, undefined);
  assert.ok(session.viewer);
  assert.equal(session.canEdit, false);
  assert.equal(session.publication.sourcesChangedSince, true);
  await assert.rejects(session.save({ version: 1, layers: [] }), /read-only/);
});

test("a map without canEdit is read-only", async () => {
  const { connection } = fakeSi({ "GET /maps/m_1": () => [200, { ...savedMap(), canEdit: false }] });
  const session = new SiMapSession({ client: new SiMapsClient(connection), route: { mapId: "m_1", publicationId: null, app: null } });
  await session.open();
  assert.equal(session.canEdit, false);
  await assert.rejects(session.save({ version: 1, layers: [] }), /read-only/);
});

test("each SI response the API lists is explained to the user", async () => {
  const cases = {
    401: [{ detail: "Sign-in is required." }, "signin"],
    402: [{ error: "plan_limit", limit: "documents", maximum: 50 }, "upgrade"],
    404: [{ detail: "Not found." }, "notfound"],
    409: [{ error: "version_conflict", currentVersion: 6 }, "conflict"],
    410: [{ detail: "Gone." }, "gone"],
    422: [{ error: "validation_failed", issues: [{ code: "private_network_source", message: "Layers can't point at a private network.", layerId: "l2" }] }, "validation"],
    428: [{ error: "version_required" }, "bug"],
  };
  for (const [status, [body, kind]] of Object.entries(cases)) {
    const { connection } = fakeSi({ "PUT /maps/m_1": () => [Number(status), body], "GET /maps/m_1": () => [200, savedMap()] });
    const session = new SiMapSession({ client: new SiMapsClient(connection), route: { mapId: "m_1", publicationId: null, app: null } });
    await session.open();
    const error = await session.save(siDocumentToMapSpec(savedMap()).spec).catch((caught) => caught);
    const described = describeSiError(error);
    assert.equal(described.kind, kind, status);
    assert.ok(described.message.length > 10, status);
  }
  assert.match(describeSiError({ status: 402, body: { error: "plan_limit", limit: "documents", maximum: 50 } }).message, /50 maps/);
  assert.equal(describeSiError({ status: 409, body: { error: "version_conflict", currentVersion: 6 } }).currentVersion, 6);
  assert.deepEqual(describeSiError({ status: 422, body: { error: "validation_failed", issues: [{ code: "x", message: "Layer l2 is broken.", layerId: "l2" }] } }).issues, [{ message: "Layer l2 is broken.", layerId: "l2", code: "x" }]);
  assert.throws(() => new SiMapsClient({}).save("m_1", { kind: "map", state: {} }, undefined), (error) => error.status === 428);
});
