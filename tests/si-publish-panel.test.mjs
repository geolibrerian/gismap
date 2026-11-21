import assert from "node:assert/strict";
import test from "node:test";
import { SiConnection } from "../js/si-connection.js";
import { SiMapSession, SiMapsClient } from "../js/si-maps.js";
import { SiPublishPanel, pinFigures, publishPanelModel, renderPublishPanel, unpinFigures } from "../js/si-publish-panel.js";

const KOOP = "https://koop.gismap.si/koop/abc/FeatureServer/0";
const EXTERNAL = "https://services.arcgis.com/x/arcgis/rest/services/Roads/FeatureServer/0";
const layers = [{ url: KOOP, title: "Inspections" }, { url: EXTERNAL, title: "Roads" }];
const datasets = [{ id: "d1", title: "Inspections 2026", featureServerUrl: `${KOOP}/`, freshness: { last_changed_at: "2026-11-10T08:00:00Z" } }];
const verification = {
  status: "warning",
  ranAt: "2026-11-17T12:00:00Z",
  checks: [
    { id: "audience", status: "passed", message: "The link opens for anyone with it.", layerId: null },
    { id: "source", status: "not_checked", message: "Roads is an external layer, so it wasn't tested.", layerId: "l2" },
    { id: "data_changed", status: "warning", message: "<b>Inspections</b> changed since publishing.", layerId: "l1" },
  ],
};
const publication = (dataMode) => ({ id: "p1", mapId: "m_1", dataMode, mapVersion: 5, shareUrl: "https://gismap.online/m/m_1?p=p1", createdAt: "2026-11-17T12:00:00Z", updatedAt: "2026-11-17T12:00:00Z", revokedAt: null, verification });

test("the panel's states: signed out, read-only, empty, ready, publishing, published and error", () => {
  assert.equal(publishPanelModel({}).state, "signed-out");
  assert.equal(publishPanelModel({ connected: true }).state, "read-only");
  assert.equal(publishPanelModel({ connected: true, canEdit: true }).state, "empty");
  const ready = publishPanelModel({ connected: true, canEdit: true, layers, datasets });
  assert.equal(ready.state, "ready");
  assert.deepEqual(ready.actions, { signIn: false, publish: true, republish: false, verify: false });
  assert.equal(publishPanelModel({ connected: true, canEdit: true, layers, busy: true }).state, "publishing");
  const live = publishPanelModel({ connected: true, canEdit: true, layers, publication: publication("live") });
  assert.equal(live.state, "published");
  assert.deepEqual(live.actions, { signIn: false, publish: true, republish: true, verify: true }, "a live publication can be republished");
  const pinned = publishPanelModel({ connected: true, canEdit: true, layers, publication: publication("pinned") });
  assert.equal(pinned.actions.republish, false, "a pinned one can't");
  const failed = publishPanelModel({ connected: true, canEdit: true, layers, error: { message: "GISMap SI couldn't accept this map.", issues: [{ message: "Bad layer", layerId: "l2" }] } });
  assert.equal(failed.state, "error");
  assert.equal(failed.actions.publish, true, "the user can try again");
});

test("the panel says who can open the link, live or pinned, the layers and the figures", () => {
  const figures = [{ slideId: "s1", blockId: "b1", slide: "Overview", label: "Open inspections", value: 128, sample: false }];
  const live = publishPanelModel({ connected: true, canEdit: true, layers, datasets, figures, unsaved: true });
  assert.equal(live.audience, "Anyone with the link");
  assert.deepEqual(live.modes.map((mode) => [mode.id, mode.selected]), [["live", true], ["pinned", false]]);
  assert.deepEqual(live.layers.map((layer) => layer.source), ["GISMap SI dataset: Inspections 2026", "External source"]);
  assert.equal(live.layers[0].lastChange, "2026-11-10T08:00:00Z");
  assert.equal(live.figures[0].pinned, false);
  assert.ok(live.notes.some((note) => /saved to GISMap SI first/.test(note)));
  assert.ok(live.notes.some((note) => /only its figures recompute/.test(note)));
  const pinned = publishPanelModel({ connected: true, canEdit: true, layers, datasets, figures, dataMode: "pinned" });
  assert.equal(pinned.figures[0].pinned, true);
  const html = renderPublishPanel(pinned);
  assert.match(html, /Anyone with the link/);
  assert.match(html, /name="si-data-mode" value="pinned" checked/);
  assert.match(html, /Pinned figures/);
  assert.match(html, /Open inspections/);
  assert.match(html, /data-si-action="publish"/);
  assert.doesNotMatch(html, /data-si-action="republish"/);
});

test("the verification report shows each check's message as written, safely", () => {
  const html = renderPublishPanel(publishPanelModel({ connected: true, canEdit: true, layers, publication: publication("live") }));
  assert.match(html, /Verified with warnings/);
  assert.match(html, /The link opens for anyone with it\./);
  assert.match(html, /Roads is an external layer, so it wasn&#39;t tested\./);
  assert.match(html, /&lt;b&gt;Inspections&lt;\/b&gt; changed since publishing\./, "SI's text is escaped, not interpreted");
  assert.match(html, /Not checked/);
  assert.match(html, /value="https:\/\/gismap.online\/m\/m_1\?p=p1"/);
  assert.match(html, /data-si-action="republish"/);
  assert.match(html, /data-si-action="verify"/);
  assert.match(renderPublishPanel(publishPanelModel()), /Sign in to GISMap SI/);
  assert.match(renderPublishPanel(publishPanelModel({ connected: true })), /can view this map but not publish/);
});

test("pinning freezes each stat block's figure; a live publication drops them", () => {
  const briefing = { schemaVersion: 1, slides: [{ id: "s1", blocks: [{ id: "b1", type: "stat", stat: "count" }, { id: "b2", type: "text", markdown: "Hi" }] }] };
  const pinned = pinFigures(briefing, [{ slideId: "s1", blockId: "b1", value: 128 }], "2026-11-17T12:00:00.000Z");
  assert.deepEqual(pinned.slides[0].blocks[0].pinned, { value: 128, computedAt: "2026-11-17T12:00:00.000Z" });
  assert.equal(pinned.slides[0].blocks[1].pinned, undefined);
  assert.deepEqual(unpinFigures(pinned), briefing);
});

test("Publish saves what the user sees, then publishes that version; Republish and Verify follow", async () => {
  let stored = { schemaVersion: 1, kind: "brief", id: "m_1", title: "Inspections", version: 4, canEdit: true, state: { layers: [{ id: "l1", name: "Inspections", source: { kind: "featureserver", url: KOOP } }], briefing: { schemaVersion: 1, slides: [{ id: "s1", template: "key-numbers", title: "Numbers", blocks: [{ id: "b1", type: "stat", stat: "count", label: "Open" }] }] } } };
  const requests = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace("https://online-api.gismap.si/api/v1", "");
    const request = { method: options.method, path, headers: options.headers, body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(request);
    const ok = (body, status = 200) => ({ ok: true, status, json: async () => body });
    if (request.method === "GET" && path === "/maps/m_1") return ok(stored);
    if (request.method === "PUT" && path === "/maps/m_1") { stored = { ...stored, version: stored.version + 1, state: request.body.state }; return ok({ id: "m_1", version: stored.version, warnings: [] }); }
    if (request.method === "GET" && path === "/maps/m_1/publications") return ok({ publications: [] });
    if (request.method === "POST" && path === "/maps/m_1/publications") return ok(publication(request.body.dataMode), 201);
    if (request.method === "PUT" && path === "/maps/m_1/publications/p1") return ok({ ...publication("live"), mapVersion: stored.version });
    if (request.method === "POST" && path === "/maps/m_1/publications/p1/verify") return ok({ ...verification, status: "passed" });
    return { ok: false, status: 404, json: async () => ({ detail: "Not found." }) };
  };
  const storage = new Map([["gismap-online:si-connection:v1", JSON.stringify({ token: "gsoc_t", expiresAt: "2099-01-01T00:00:00Z", scopes: ["maps:write"], user: { email: "a@b.c" } })]]);
  const connection = new SiConnection({ storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) }, fetchImpl });
  const client = new SiMapsClient(connection);
  const session = new SiMapSession({ client, route: { mapId: "m_1", publicationId: null, app: null } });
  let { spec } = await session.open();
  const applied = [];
  const panel = new SiPublishPanel({
    connection, session, client,
    currentSpec: () => spec,
    figures: () => [{ slideId: "s1", blockId: "b1", label: "Open", value: 128 }],
    applyBriefing: async (briefing) => { applied.push(briefing); spec = { ...spec, briefing }; },
    context: async () => ({ datasets }),
  });
  const container = { innerHTML: "", querySelectorAll: () => [] };
  await panel.open(container);
  assert.match(container.innerHTML, /data-state="ready"/);

  panel.dataMode = "pinned";
  await panel.publish();
  const put = requests.find((request) => request.method === "PUT" && request.path === "/maps/m_1");
  assert.equal(put.headers["If-Match"], "4");
  assert.equal(put.body.state.briefing.slides[0].blocks[0].pinned.value, 128, "the pinned figure is saved with the version");
  const post = requests.find((request) => request.method === "POST" && request.path === "/maps/m_1/publications");
  assert.deepEqual(post.body, { dataMode: "pinned" });
  assert.equal(post.headers["If-Match"], "5", "the version just saved is the one published");
  assert.equal(applied.length, 1, "the editor shows the pinned figures too");
  assert.match(container.innerHTML, /data-state="published"/);

  // A live publication with nothing pinned and nothing changed publishes without saving.
  const puts = requests.filter((request) => request.method === "PUT").length;
  panel.dataMode = "live";
  spec = { ...spec, briefing: unpinFigures(spec.briefing) };
  await panel.publish();
  assert.equal(requests.filter((request) => request.method === "PUT").length, puts + 1, "unpinning is one save");
  await panel.publish();
  assert.equal(requests.filter((request) => request.method === "PUT").length, puts + 1, "nothing changed: no save");

  // A live publication: figures are unpinned (a save), then the same link moves to that version.
  panel.publication = publication("live");
  await panel.republish();
  const republish = requests.findLast((request) => request.path === "/maps/m_1/publications/p1");
  assert.equal(republish.method, "PUT");
  assert.equal(republish.headers["If-Match"], "6");
  assert.equal(stored.state.briefing.slides[0].blocks[0].pinned, undefined);

  await panel.verify();
  assert.equal(panel.publication.verification.status, "passed");
  assert.match(container.innerHTML, /Verified/);
});

test("a conflict while publishing is shown, not swallowed", async () => {
  const connection = { connected: true, can: () => true, request: async () => { throw Object.assign(new Error("conflict"), { status: 409, body: { error: "version_conflict", currentVersion: 9 } }); } };
  const client = new SiMapsClient(connection);
  const session = new SiMapSession({ client, route: { mapId: "m_1", publicationId: null, app: null } });
  session.document = { id: "m_1", kind: "map", version: 4, canEdit: true, state: { layers: [] } };
  const panel = new SiPublishPanel({ connection, session, client, currentSpec: () => ({ version: 1, layers: [{ url: KOOP }] }), figures: () => [] });
  const container = { innerHTML: "", querySelectorAll: () => [] };
  panel.container = container;
  await panel.publish();
  assert.match(container.innerHTML, /A newer version of this map exists/);
  assert.match(container.innerHTML, /data-state="error"/);
});
