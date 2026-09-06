import assert from "node:assert/strict";
import { createShareUrl, parseShareParameters, sanitizeSharedResourceUrl } from "../js/share.js";

const service = "https://example.com/arcgis/rest/services/Fires/FeatureServer/0";
const geojson = "https://example.com/data/feed?format=geojson&limit=100";
const shared = createShareUrl({
  baseUrl: "https://gismap.online/?old=value#map",
  layers: [
    { url: service, sourceType: "feature" },
    { url: geojson, sourceType: "geojson" },
    { url: "blob:https://gismap.online/local", local: true },
  ],
  basemap: "gray-3d",
});
const parsed = parseShareParameters(new URL(shared).search);
assert.deepEqual(parsed.layers, [
  { url: service, serviceType: "feature" },
  { url: geojson, serviceType: "geojson" },
]);
assert.equal(parsed.basemap, "gray-3d");
assert.equal(new URL(shared).hash, "");

const catalog = [{ id: "fires", slug: "active-fires", title: "Active fires", serviceType: "feature", url: service }];
assert.deepEqual(parseShareParameters("?example=active-fires", catalog).layers[0], {
  url: service,
  serviceType: "feature",
  title: "Active fires",
  refreshInterval: undefined,
});

assert.throws(() => sanitizeSharedResourceUrl("javascript:alert(1)"), /HTTPS/);
assert.throws(() => sanitizeSharedResourceUrl("http://example.com/data"), /HTTPS/);
assert.equal(sanitizeSharedResourceUrl("http://localhost/data", { allowHttp: true }), "http://localhost/data");
assert.throws(() => sanitizeSharedResourceUrl("https://user:secret@example.com/data"), /username or password/);
for (const key of ["token", "access_token", "apiKey", "key", "client_secret", "password", "signature"]) {
  assert.throws(() => sanitizeSharedResourceUrl(`https://example.com/data?${key}=secret`), /credential parameter/);
}
assert.throws(() => parseShareParameters("?layer=not-a-url"), /invalid URL/);
assert.throws(() => parseShareParameters(`?layer=${encodeURIComponent(service)}&layerType=executable`), /Unsupported/);
assert.throws(() => parseShareParameters("?example=missing", catalog), /Unknown GISMap example/);
assert.throws(() => parseShareParameters("?basemap=untrusted-style"), /Unsupported shared basemap/);
assert.throws(() => createShareUrl({ baseUrl: "https://gismap.online/", layers: [{ url: `${service}?token=secret` }] }), /credential/);
assert.throws(() => createShareUrl({ baseUrl: "https://gismap.online/", layers: [{ local: true, url: "blob:x" }] }), /public remote layer/);
