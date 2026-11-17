import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { SI_API_BASE, SiConnection, readConnectionMessage, siEndpoints } from "../js/si-connection.js";

const TOKEN = "gsoc_secret-token-value";
const HOUR = 3600 * 1000;
const NOW = Date.parse("2026-11-17T12:00:00Z");

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

// A sign-in popup that answers with `reply` once the page starts listening.
function popupHarness(reply, { origin = "https://gismap.si" } = {}) {
  const popup = { closed: false, close() { this.closed = true; } };
  const opened = [];
  let handler = null;
  return {
    opened,
    open: (url) => { opened.push(url); return popup; },
    listen: (fn) => { handler = fn; queueMicrotask(() => handler?.({ origin, source: popup, data: reply })); return () => { handler = null; }; },
  };
}

function connected({ storage = memoryStorage(), fetchImpl, now = () => NOW } = {}) {
  const harness = popupHarness({ type: "gismap.si.connection", version: 1, token: TOKEN, expiresAt: new Date(NOW + 8 * HOUR).toISOString(), scopes: ["stored:read", "maps:read", "maps:write"], user: { email: "ana@example.org", displayName: "Ana" } });
  const connection = new SiConnection({ storage, fetchImpl, origin: "https://gismap.online", now, ...harness });
  return { connection, storage, harness };
}

test("sign-in opens SI's connect page with only this origin in the address", async () => {
  const { connection, harness } = connected();
  const user = await connection.signIn();
  assert.deepEqual(user, { email: "ana@example.org", displayName: "Ana" });
  assert.deepEqual(harness.opened, ["https://gismap.si/connect/online/?origin=https%3A%2F%2Fgismap.online"]);
  assert.ok(connection.connected);
  assert.ok(connection.can("maps:write"));
});

test("only SI's own connection message is accepted", () => {
  const good = { type: "gismap.si.connection", version: 1, token: TOKEN, expiresAt: "2026-11-17T20:00:00Z", scopes: ["maps:read"], user: { email: "a@b.c" } };
  assert.equal(readConnectionMessage({ origin: "https://gismap.si", data: good }).token, TOKEN);
  assert.equal(readConnectionMessage({ origin: "https://evil.example", data: good }), null, "another origin");
  assert.equal(readConnectionMessage({ origin: "https://gismap.si", data: { ...good, version: 2 } }), null, "another version");
  assert.equal(readConnectionMessage({ origin: "https://gismap.si", data: { ...good, type: "gismap.si.preview" } }), null, "another message");
  assert.equal(readConnectionMessage({ origin: "https://gismap.si", data: { ...good, expiresAt: "soon" } }), null, "no expiry");
  assert.deepEqual(readConnectionMessage({ origin: "https://gismap.si", data: { type: "gismap.si.connection", version: 1, cancelled: true } }), { cancelled: true });
});

test("cancelling sign-in leaves the tab signed out", async () => {
  const storage = memoryStorage();
  const harness = popupHarness({ type: "gismap.si.connection", version: 1, cancelled: true });
  const connection = new SiConnection({ storage, ...harness, now: () => NOW });
  assert.equal(await connection.signIn(), null);
  assert.equal(connection.connected, false);
  assert.equal(storage.map.size, 0);
});

test("the connection is kept in sessionStorage only, never localStorage", async () => {
  const local = memoryStorage();
  const realLocal = globalThis.localStorage;
  globalThis.localStorage = local;
  try {
    const { connection, storage } = connected();
    await connection.signIn();
    assert.equal(local.map.size, 0, "nothing in localStorage");
    const saved = [...storage.map.values()].join("");
    assert.match(saved, new RegExp(TOKEN), "this tab's sessionStorage holds it");
    // A new page in the same tab reads it back; an expired one is dropped.
    assert.ok(new SiConnection({ storage, now: () => NOW }).connected);
    const later = new SiConnection({ storage, now: () => NOW + 9 * HOUR });
    assert.equal(later.connected, false);
    assert.equal(storage.map.size, 0, "an expired connection is forgotten");
  } finally {
    globalThis.localStorage = realLocal;
  }
});

test("every SI call sends the bearer token; public reads send none", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const { connection } = connected({ fetchImpl });
  await connection.signIn();
  await connection.request("/maps/m_1");
  await connection.request("/maps/publications/p1", { auth: false });
  assert.equal(calls[0].url, `${SI_API_BASE}/maps/m_1`);
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(calls[1].options.headers.Authorization, undefined);
  assert.ok(calls.every((call) => !call.url.includes(TOKEN)), "the token is never in a URL");
});

test("401 signs the tab out; 403 says the connection doesn't allow it", async () => {
  let status = 403;
  const fetchImpl = async () => ({ ok: false, status, json: async () => ({ detail: "Nope" }) });
  const { connection, storage } = connected({ fetchImpl });
  await connection.signIn();
  const changes = [];
  connection.subscribe((change) => changes.push(change));
  await assert.rejects(connection.request("/maps"), (error) => error.status === 403 && /doesn't allow that action/.test(error.message));
  assert.ok(connection.connected, "a 403 keeps the connection");
  status = 401;
  await assert.rejects(connection.request("/maps"), (error) => error.status === 401 && /Sign in to GISMap SI again/.test(error.message));
  assert.equal(connection.connected, false);
  assert.equal(storage.map.size, 0);
  assert.deepEqual(changes.at(-1), { connected: false, user: null, reason: "expired" });
});

test("sign-out revokes the token in SI and forgets it", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push([options.method, url]); return { ok: true, status: 204, json: async () => null }; };
  const { connection, storage } = connected({ fetchImpl });
  await connection.signIn();
  await connection.signOut();
  assert.deepEqual(calls, [["DELETE", `${SI_API_BASE}/connections/current`]]);
  assert.equal(connection.connected, false);
  assert.equal(storage.map.size, 0);
});

test("only a localhost page can point the token at another SI", () => {
  const storage = memoryStorage();
  assert.deepEqual(siEndpoints({ location: { hostname: "gismap.online", search: "?siApi=https://evil.example/api" }, storage }), { apiBase: SI_API_BASE, siOrigin: "https://gismap.si" });
  assert.deepEqual(siEndpoints({ location: { hostname: "localhost", search: "?siApi=http://localhost:8000/api/v1&siOrigin=http://localhost:5173" }, storage }), { apiBase: "http://localhost:8000/api/v1", siOrigin: "http://localhost:5173" });
  assert.equal(siEndpoints({ location: { hostname: "localhost", search: "" }, storage }).apiBase, "http://localhost:8000/api/v1", "remembered for the tab");
});

test("no project, share link, Smart Map Image or map spec code can reach the connection", async () => {
  // The token lives in SiConnection; only the SI modules import it.
  for (const file of ["project.js", "share.js", "map-share.js", "smart-image.js", "map-spec.js", "map-spec-api.js", "data-connections.js", "embed-share.js", "briefing-share.js", "tour-share.js"]) {
    const source = await readFile(new URL(`../js/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /si-connection|si-map-workspace|SiConnection/, file);
  }
  const workspace = await readFile(new URL("../js/si-map-workspace.js", import.meta.url), "utf8");
  assert.doesNotMatch(workspace, /localStorage/, "the SI workspace never uses localStorage");
});
