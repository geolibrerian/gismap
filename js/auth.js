const STORAGE_KEY = "gismap-online:arcgis-connections:v1";

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cleanUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new Error(`${label} must be a complete URL.`);
  }
  const isLocalDevelopment = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLocalDevelopment)) {
    throw new Error(`${label} must use HTTPS (HTTP is allowed only for local development).`);
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

function normalizePortalUrl(value) {
  const url = cleanUrl(value, "Portal URL");
  url.pathname = url.pathname
    .replace(/\/(?:home|sharing(?:\/rest)?)$/i, "")
    .replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

function normalizeServerUrl(value) {
  const url = cleanUrl(value, "ArcGIS Server URL");
  url.pathname = url.pathname.replace(/\/rest(?:\/services(?:\/.*)?)?$/i, "").replace(/\/+$/, "");
  return url.href.replace(/\/$/, "");
}

function normalizeTokenServiceUrl(value, serverUrl) {
  return cleanUrl(value || `${serverUrl}/tokens/`, "Token service URL").href.replace(/\/$/, "") + "/";
}

function publicCredentialSummary(credential) {
  return {
    signedIn: true,
    userId: credential?.userId || null,
    expires: Number.isFinite(credential?.expires) ? credential.expires : null,
  };
}

/**
 * Registers ArcGIS identity metadata and delegates credentials entirely to the
 * ArcGIS Maps SDK IdentityManager. Tokens, passwords, and client secrets never
 * enter GIS Map Online project serialization or local settings.
 */
export class AuthController {
  constructor(events) {
    this.events = events;
    this.connections = [];
    this.oauthInfos = new Map();
    this.serverInfos = new Map();
  }

  async initialize() {
    const [identityManager, OAuthInfo, ServerInfo] = await $arcgis.import([
      "@arcgis/core/identity/IdentityManager.js",
      "@arcgis/core/identity/OAuthInfo.js",
      "@arcgis/core/identity/ServerInfo.js",
    ]);
    Object.assign(this, { identityManager, OAuthInfo, ServerInfo });
    this.connections = this.#readStore();
    this.connections.forEach((connection) => this.#register(connection));
    this.events.publish("auth:ready", { connections: this.list() });
  }

  list() {
    return structuredClone(this.connections);
  }

  getCallbackUrl() {
    return new URL("oauth-callback.html", document.baseURI).href;
  }

  addPortal({ name, portalUrl, clientId }) {
    const normalizedUrl = normalizePortalUrl(portalUrl);
    const normalizedClientId = String(clientId || "").trim();
    if (!normalizedClientId) throw new Error("A Portal application Client ID is required.");

    const existing = this.connections.find(
      (item) => item.type === "portal" && item.portalUrl === normalizedUrl && item.clientId === normalizedClientId,
    );
    const connection = {
      id: existing?.id || makeId(),
      type: "portal",
      name: String(name || "").trim() || (normalizedUrl === "https://www.arcgis.com" ? "ArcGIS Online" : new URL(normalizedUrl).hostname),
      portalUrl: normalizedUrl,
      clientId: normalizedClientId,
    };
    this.#upsert(connection);
    return structuredClone(connection);
  }

  addServer({ name, serverUrl, tokenServiceUrl }) {
    const normalizedUrl = normalizeServerUrl(serverUrl);
    const connection = {
      id: this.connections.find((item) => item.type === "server" && item.serverUrl === normalizedUrl)?.id || makeId(),
      type: "server",
      name: String(name || "").trim() || new URL(normalizedUrl).hostname,
      serverUrl: normalizedUrl,
      tokenServiceUrl: normalizeTokenServiceUrl(tokenServiceUrl, normalizedUrl),
    };
    this.#upsert(connection);
    return structuredClone(connection);
  }

  async connect(id) {
    const connection = this.#find(id);
    const resource = this.#resourceUrl(connection);
    const options = connection.type === "portal" ? { oAuthPopupConfirmation: false } : undefined;
    const credential = await this.identityManager.getCredential(resource, options);
    const status = publicCredentialSummary(credential);
    this.events.publish("auth:status-changed", { connection: structuredClone(connection), status });
    return status;
  }

  async getStatus(id) {
    const connection = this.#find(id);
    try {
      const credential = await this.identityManager.checkSignInStatus(this.#resourceUrl(connection));
      return publicCredentialSummary(credential);
    } catch {
      return { signedIn: false, userId: null, expires: null };
    }
  }

  async getStatuses() {
    return Promise.all(this.connections.map(async (connection) => ({
      connection: structuredClone(connection),
      status: await this.getStatus(connection.id),
    })));
  }

  remove(id) {
    const connection = this.#find(id);
    this.connections = this.connections.filter((item) => item.id !== id);
    this.oauthInfos.delete(id);
    this.serverInfos.delete(id);
    this.#writeStore();
    // IdentityManager does not expose per-registration removal. Revoking active
    // credentials prevents a removed connection from remaining usable this tab.
    this.identityManager.destroyCredentials();
    this.events.publish("auth:connections-changed", { connections: this.list(), removed: structuredClone(connection) });
  }

  signOutAll() {
    this.identityManager.destroyCredentials();
    this.events.publish("auth:status-changed", { connection: null, status: { signedIn: false } });
  }

  exportConnections() {
    return this.list();
  }

  importConnections(definitions = []) {
    if (!Array.isArray(definitions)) return this.list();
    for (const definition of definitions) {
      try {
        if (definition?.type === "portal") this.addPortal(definition);
        if (definition?.type === "server") this.addServer(definition);
      } catch (error) {
        this.events.publish("app:error", { message: `Skipped an invalid ArcGIS connection: ${error.message}` });
      }
    }
    return this.list();
  }

  #upsert(connection) {
    const index = this.connections.findIndex((item) => item.id === connection.id);
    if (index >= 0) this.connections[index] = connection;
    else this.connections.push(connection);
    this.#register(connection);
    this.#writeStore();
    this.events.publish("auth:connections-changed", { connections: this.list() });
  }

  #register(connection) {
    if (connection.type === "portal") {
      if (this.oauthInfos.has(connection.id)) return;
      const info = new this.OAuthInfo({
        appId: connection.clientId,
        portalUrl: connection.portalUrl,
        popup: true,
        popupCallbackUrl: "oauth-callback.html",
        flowType: "auto",
        authNamespace: `gismap-online:${connection.id}`,
      });
      this.oauthInfos.set(connection.id, info);
      this.identityManager.registerOAuthInfos([info]);
      return;
    }
    if (connection.type === "server") {
      if (this.serverInfos.has(connection.id)) return;
      const info = new this.ServerInfo({
        server: connection.serverUrl,
        tokenServiceUrl: connection.tokenServiceUrl,
        hasServer: true,
      });
      this.serverInfos.set(connection.id, info);
      this.identityManager.registerServers([info]);
    }
  }

  #resourceUrl(connection) {
    return connection.type === "portal" ? `${connection.portalUrl}/sharing` : connection.serverUrl;
  }

  #find(id) {
    const connection = this.connections.find((item) => item.id === id);
    if (!connection) throw new Error("That ArcGIS connection is no longer configured.");
    return connection;
  }

  #readStore() {
    try {
      const definitions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      if (!Array.isArray(definitions)) return [];
      const valid = [];
      for (const definition of definitions) {
        try {
          if (definition?.type === "portal") {
            const portalUrl = normalizePortalUrl(definition.portalUrl);
            const clientId = String(definition.clientId || "").trim();
            if (clientId) valid.push({ id: definition.id || makeId(), type: "portal", name: definition.name || new URL(portalUrl).hostname, portalUrl, clientId });
          } else if (definition?.type === "server") {
            const serverUrl = normalizeServerUrl(definition.serverUrl);
            valid.push({ id: definition.id || makeId(), type: "server", name: definition.name || new URL(serverUrl).hostname, serverUrl, tokenServiceUrl: normalizeTokenServiceUrl(definition.tokenServiceUrl, serverUrl) });
          }
        } catch {
          // Ignore malformed legacy browser settings instead of preventing startup.
        }
      }
      return valid;
    } catch {
      return [];
    }
  }

  #writeStore() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.connections));
  }
}
