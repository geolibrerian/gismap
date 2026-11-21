// The one GISMap SI connection a tab holds. Signing in opens SI's connect page as a
// popup, which hands back a scoped, expiring connection token by postMessage. The
// token lives in page memory and this tab's sessionStorage only: never localStorage,
// a .gis/.gisx file, a share link, a Smart Map Image or a URL (the rule
// data-connections.js sets for credentials). Every SI call carries it as a bearer token.

export const SI_ORIGIN = "https://gismap.si";
export const SI_API_BASE = "https://online-api.gismap.si/api/v1";
export const SI_SCOPES = Object.freeze(["stored:read", "maps:read", "maps:write"]);
const SESSION_KEY = "gismap-online:si-connection:v1";
// Local development only: `?siApi=` / `?siOrigin=` on localhost, remembered for the tab.
const DEV_KEY = "gismap-online:si-endpoints:v1";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

const httpUrl = (value, { allowHttp }) => {
  try {
    const url = new URL(String(value || ""));
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.protocol === "https:" || (allowHttp && url.protocol === "http:")) return url;
  } catch { /* Not a URL. */ }
  return null;
};

/**
 * Where SI's API and connect page are. Production always uses SI's own hosts; only a page
 * served from localhost may point them elsewhere, so a crafted link can't send the token away.
 */
export function siEndpoints({ location = globalThis.location, storage = globalThis.sessionStorage } = {}) {
  const defaults = { apiBase: SI_API_BASE, siOrigin: SI_ORIGIN };
  if (!LOOPBACK.has(location?.hostname)) return defaults;
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(DEV_KEY) || "{}") || {}; } catch { /* Ignore. */ }
  const params = new URLSearchParams(location.search || "");
  const api = httpUrl(params.get("siApi") || saved.apiBase, { allowHttp: true });
  const origin = httpUrl(params.get("siOrigin") || saved.siOrigin, { allowHttp: true });
  const endpoints = { apiBase: api ? api.href.replace(/\/+$/, "") : defaults.apiBase, siOrigin: origin ? origin.origin : defaults.siOrigin };
  try { if (params.has("siApi") || params.has("siOrigin")) storage?.setItem(DEV_KEY, JSON.stringify(endpoints)); } catch { /* Ignore. */ }
  return endpoints;
}

/** The connection a `message` event carries, `{ cancelled: true }`, or null when it isn't one from SI. */
export function readConnectionMessage(event, siOrigin = SI_ORIGIN) {
  const data = event?.data;
  if (event?.origin !== siOrigin || data?.type !== "gismap.si.connection" || data.version !== 1) return null;
  if (data.cancelled === true) return { cancelled: true };
  if (typeof data.token !== "string" || !data.token || data.token.length > 512) return null;
  const expiresAt = Date.parse(data.expiresAt);
  if (!Number.isFinite(expiresAt)) return null;
  return {
    token: data.token,
    expiresAt: new Date(expiresAt).toISOString(),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope) => typeof scope === "string").slice(0, 20) : [],
    user: { email: String(data.user?.email || "").slice(0, 320), displayName: String(data.user?.displayName || "").slice(0, 200) },
  };
}

/** An SI response that wasn't a success: `status`, SI's `code` (`error`) and the parsed `body`. */
export class SiError extends Error {
  constructor(message, { status = 0, code = null, body = null } = {}) {
    super(message);
    this.name = "SiError";
    Object.assign(this, { status, code, body });
  }
}

export class SiConnection {
  /**
   * `storage`: this tab's sessionStorage (or null for memory only). `open(url)`: opens the
   * sign-in popup. `listen(handler)`: subscribes to window `message` events, returning an unsubscribe.
   */
  constructor({
    storage = globalThis.sessionStorage ?? null,
    fetchImpl = (...args) => globalThis.fetch(...args),
    apiBase = SI_API_BASE,
    siOrigin = SI_ORIGIN,
    origin = globalThis.location?.origin || "https://gismap.online",
    open = (url) => globalThis.open?.(url, "gismap-si-connect", "popup,width=520,height=720"),
    listen = (handler) => { globalThis.addEventListener?.("message", handler); return () => globalThis.removeEventListener?.("message", handler); },
    now = () => Date.now(),
  } = {}) {
    Object.assign(this, { storage, fetchImpl, apiBase: apiBase.replace(/\/+$/, ""), siOrigin, origin, open, listen, now });
    this.listeners = new Set();
    this.current = this.#restore();
  }

  get connected() { return Boolean(this.current) && Date.parse(this.current.expiresAt) > this.now(); }
  get user() { return this.connected ? { ...this.current.user } : null; }
  get scopes() { return this.connected ? [...this.current.scopes] : []; }
  get expiresAt() { return this.connected ? this.current.expiresAt : null; }
  can(scope) { return this.scopes.includes(scope); }

  /** `listener({ connected, user, reason })` on every change; returns an unsubscribe. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The sign-in page's address. Only this page's origin is in it: nothing private. */
  connectUrl() {
    return `${this.siOrigin}/connect/online/?origin=${encodeURIComponent(this.origin)}`;
  }

  /** Opens SI's connect popup; resolves with the user once approved, or null if they cancel or close it. */
  signIn() {
    const popup = this.open(this.connectUrl());
    if (!popup) return Promise.reject(new SiError("The browser blocked the GISMap SI sign-in window. Allow pop-ups for this site and try again."));
    return new Promise((resolve) => {
      let closedTimer = null;
      const finish = (value) => { stop(); clearInterval(closedTimer); resolve(value); };
      const stop = this.listen((event) => {
        if (popup && event.source && event.source !== popup) return;
        const message = readConnectionMessage(event, this.siOrigin);
        if (!message) return;
        if (message.cancelled) return finish(null);
        this.#set(message, "signed-in");
        try { popup.close?.(); } catch { /* Already closed. */ }
        finish(this.user);
      });
      // Closing the window without answering counts as cancelling.
      if (typeof popup.closed === "boolean") closedTimer = setInterval(() => { if (popup.closed) finish(null); }, 500);
    });
  }

  /** Revokes the token in SI (best effort) and forgets it here. */
  async signOut() {
    if (this.connected) {
      try { await this.request("/connections/current", { method: "DELETE" }); } catch { /* Forgotten here either way. */ }
    }
    this.#set(null, "signed-out");
  }

  /**
   * One SI call: `{ status, data, headers }` for a success, otherwise an SiError. `auth: false`
   * sends no token (public reads such as a publication). A 401 forgets the connection.
   */
  async request(path, { method = "GET", body, headers = {}, auth = true, signal } = {}) {
    const sendHeaders = { Accept: "application/json", ...headers };
    if (body !== undefined) sendHeaders["Content-Type"] = "application/json";
    if (auth) {
      if (!this.connected) {
        if (this.current) this.#set(null, "expired");
        throw new SiError("Sign in to GISMap SI to continue.", { status: 401, code: "signin_required" });
      }
      sendHeaders.Authorization = `Bearer ${this.current.token}`;
    }
    let response;
    try {
      response = await this.fetchImpl(`${this.apiBase}${path}`, { method, headers: sendHeaders, body: body === undefined ? undefined : JSON.stringify(body), signal, credentials: "omit", redirect: "error" });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new SiError("GISMap SI could not be reached. Check your connection and try again.", { code: "network" });
    }
    let data = null;
    if (response.status !== 204) {
      try { data = await response.json(); } catch { data = null; }
    }
    if (response.ok) return { status: response.status, data, headers: response.headers };
    const code = typeof data?.error === "string" ? data.error : null;
    if (response.status === 401 && auth) {
      this.#set(null, "expired");
      throw new SiError("Your GISMap SI connection expired or was revoked. Sign in to GISMap SI again.", { status: 401, code: code || "signin_required", body: data });
    }
    if (response.status === 403) throw new SiError("Your GISMap SI connection doesn't allow that action.", { status: 403, code: code || "forbidden", body: data });
    const detail = typeof data?.message === "string" ? data.message : typeof data?.detail === "string" ? data.detail : `GISMap SI returned HTTP ${response.status}.`;
    throw new SiError(detail, { status: response.status, code, body: data });
  }

  #set(connection, reason) {
    this.current = connection;
    try {
      if (connection) this.storage?.setItem(SESSION_KEY, JSON.stringify(connection));
      else this.storage?.removeItem(SESSION_KEY);
    } catch { /* Memory only. */ }
    const change = { connected: this.connected, user: this.user, reason };
    for (const listener of this.listeners) {
      try { listener(change); } catch (error) { console.warn(error); }
    }
  }

  #restore() {
    try {
      const saved = JSON.parse(this.storage?.getItem(SESSION_KEY) || "null");
      if (saved && typeof saved.token === "string" && Date.parse(saved.expiresAt) > this.now()) return saved;
      if (saved) this.storage?.removeItem(SESSION_KEY);
    } catch { /* Nothing usable. */ }
    return null;
  }
}
