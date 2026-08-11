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
assert.equal(registrations.oauth[0].flowType, "auto");
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
assert.equal(server.tokenServiceUrl, "https://gis.acme.example/server/tokens/");
assert.equal(registrations.servers[0].hasServer, true);

const status = await auth.connect(portal.id);
assert.deepEqual(status, { signedIn: true, userId: "test-user", expires: 123 });

const serialized = JSON.stringify(auth.exportConnections());
assert.match(serialized, /public-client-id/);
assert.doesNotMatch(serialized, /must-not-export|password|clientSecret/i);
assert.ok(published.some(({ topic }) => topic === "auth:status-changed"));

console.log("ArcGIS connection tests passed");
