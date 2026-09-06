const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);
const SENSITIVE_PARAMETER = /^(?:token|oauth[_-]?token|access[_-]?token|api[_-]?key|apikey|key|client[_-]?secret|password|passwd|pwd|authorization|auth|signature|sig)$/i;
const SUPPORTED_TYPES = new Set(["arcgis-auto", "feature", "map-image", "imagery", "geojson", "wms", "wfs", "kml"]);
const SUPPORTED_BASEMAPS = new Set([
  "topo-3d", "navigation-3d", "navigation-dark-3d", "osm-3d", "gray-3d",
  "dark-gray-3d", "streets-3d", "streets-dark-3d", "topo-vector",
  "streets-vector", "navigation", "gray-vector", "dark-gray-vector", "osm",
  "satellite", "hybrid",
]);
const MAX_LAYERS = 10;
const MAX_URL_LENGTH = 4096;

export function sanitizeSharedResourceUrl(value, { allowHttp = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value ?? "").trim());
  } catch {
    throw new Error("A shared layer contains an invalid URL.");
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol) || (parsed.protocol === "http:" && !allowHttp)) {
    throw new Error("Shared layers must use HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Shared layer URLs cannot contain a username or password.");
  }
  const sensitive = [...parsed.searchParams.keys()].find((key) => SENSITIVE_PARAMETER.test(key));
  if (sensitive) {
    throw new Error(`Remove the credential parameter “${sensitive}” before sharing this layer.`);
  }
  parsed.hash = "";
  if (parsed.href.length > MAX_URL_LENGTH) throw new Error("A shared layer URL is too long.");
  return parsed.href;
}

export function parseShareParameters(search, catalog = [], options = {}) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const rawLayers = params.getAll("layer");
  const rawTypes = params.getAll("layerType");
  if (rawLayers.length > MAX_LAYERS) throw new Error(`A shared map can load at most ${MAX_LAYERS} layers.`);

  const layers = rawLayers.map((url, index) => {
    const serviceType = rawTypes[index] || "arcgis-auto";
    if (!SUPPORTED_TYPES.has(serviceType)) throw new Error(`Unsupported shared layer type: ${serviceType}.`);
    return { url: sanitizeSharedResourceUrl(url, options), serviceType };
  });
  const example = params.get("example")?.trim() || null;
  if (example) {
    const entry = catalog.find((item) => (item.slug || item.id) === example);
    if (!entry) throw new Error(`Unknown GISMap example: ${example}.`);
    layers.push({
      url: sanitizeSharedResourceUrl(entry.url, options),
      serviceType: entry.serviceType || "arcgis-auto",
      title: entry.title,
      refreshInterval: entry.refreshInterval,
    });
  }
  if (layers.length > MAX_LAYERS) throw new Error(`A shared map can load at most ${MAX_LAYERS} layers.`);
  const basemap = params.get("basemap")?.trim() || null;
  if (basemap && !SUPPORTED_BASEMAPS.has(basemap)) throw new Error(`Unsupported shared basemap: ${basemap}.`);
  return { layers, basemap, example };
}

export function createShareUrl({ baseUrl, layers = [], basemap = null }) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  const remoteLayers = layers.filter((layer) => layer?.url && !layer.local);
  if (!remoteLayers.length) throw new Error("Add at least one public remote layer before creating a share link.");
  if (remoteLayers.length > MAX_LAYERS) throw new Error(`A shared map can include at most ${MAX_LAYERS} layers.`);
  for (const layer of remoteLayers) {
    url.searchParams.append("layer", sanitizeSharedResourceUrl(layer.url));
    url.searchParams.append("layerType", SUPPORTED_TYPES.has(layer.sourceType) ? layer.sourceType : "arcgis-auto");
  }
  if (basemap) {
    if (!SUPPORTED_BASEMAPS.has(basemap)) throw new Error(`Unsupported shared basemap: ${basemap}.`);
    url.searchParams.set("basemap", basemap);
  }
  return url.href;
}

export const SHARE_LIMITS = Object.freeze({ maxLayers: MAX_LAYERS, maxUrlLength: MAX_URL_LENGTH });
