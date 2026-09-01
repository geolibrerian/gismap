import assert from "node:assert/strict";
import { AuthController } from "../js/auth.js";

const settings = new Map();
globalThis.localStorage = {
  getItem: (key) => settings.get(key) ?? null,
  setItem: (key, value) => settings.set(key, value),
};

const published = [];
const auth = new AuthController({
  publish: (topic, payload) => published.push({ topic, payload }),
});

class FakeInfo {
  constructor(properties) {
    Object.assign(this, properties);
  }
}

const registrations = { oauth: [], servers: [], destroyed: 0 };
auth.OAuthInfo = FakeInfo;
auth.ServerInfo = FakeInfo;
auth.identityManager = {
  registerOAuthInfos: (items) => registrations.oauth.push(...items),
  registerServers: (items) => registrations.servers.push(...items),
  getCredential: async () => ({ userId: "test-user", token: "must-not-export", expires: 123 }),
  checkSignInStatus: async () => ({ userId: "test-user", token: "must-not-export", expires: 123 }),
  destroyCredentials: () => { registrations.destroyed += 1; },
};

const portal = auth.addPortal({
  name: "Acme GIS",
  portalUrl: "https://gis.acme.example/portal/home/",
  clientId: "public-client-id",
});
assert.equal(portal.portalUrl, "https://gis.acme.example/portal");
assert.equal(portal.loginMode, "popup");
assert.equal(registrations.oauth[0].flowType, "auto");
assert.equal(registrations.oauth[0].popup, true);
assert.equal(registrations.oauth[0].popupCallbackUrl, "oauth-callback.html");

// Re-importing a project definition must not register the same OAuthInfo twice.
auth.importConnections([portal]);
assert.equal(registrations.oauth.length, 1);

const server = auth.addServer({
  name: "Parcels",
  serverUrl: "https://gis.acme.example/server/rest/services/Parcels/FeatureServer",
  tokenServiceUrl: "",
});
assert.equal(server.serverUrl, "https://gis.acme.example/server");
assert.equal(server.authMode, "token");
assert.equal(server.tokenServiceUrl, "https://gis.acme.example/server/tokens/generateToken");
assert.equal(registrations.servers[0].hasServer, true);

const webServer = auth.addServer({
  name: "Internal GIS",
  serverUrl: "https://internal.acme.example/arcgis/rest/services",
  authMode: "web-tier",
});
assert.equal(webServer.authMode, "web-tier");
assert.equal(webServer.tokenServiceUrl, null);
assert.equal(registrations.servers[1].webTierAuth, true);

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes("/sharing/rest/info")) {
    return { ok: true, json: async () => ({ currentVersion: "11.4", authInfo: { supportsOAuth: true, tokenServicesUrl: "https://gis.acme.example/portal/sharing/rest/generateToken" } }) };
  }
  if (String(url).includes("/sharing/rest/portals/self")) {
    return { ok: true, json: async () => ({ name: "Acme GIS" }) };
  }
  assert.equal(options.credentials, "same-origin");
  return { ok: true, json: async () => ({ currentVersion: 11.4, owningSystemUrl: "https://gis.acme.example/portal", authInfo: { tokenServicesUrl: "https://gis.acme.example/portal/sharing/rest/generateToken" } }) };
};

const portalReport = await auth.inspectPortal(portal.portalUrl);
assert.equal(portalReport.authentication, "OAuth 2.0 / PKCE");
assert.equal(portalReport.organization, "Acme GIS");

const serverReport = await auth.inspectServer("https://gis.acme.example/server/rest/services/Parcels/FeatureServer/0");
assert.equal(serverReport.federated, true);
assert.equal(serverReport.owningSystemUrl, portal.portalUrl);
assert.equal(serverReport.portalConnectionId, portal.id);
globalThis.fetch = originalFetch;

const status = await auth.connect(portal.id);
assert.deepEqual(status, { signedIn: true, userId: "test-user", expires: 123 });

const serialized = JSON.stringify(auth.exportConnections());
assert.match(serialized, /public-client-id/);
assert.doesNotMatch(serialized, /must-not-export|password|clientSecret/i);
assert.ok(published.some(({ topic }) => topic === "auth:status-changed"));

console.log("ArcGIS connection tests passed");
