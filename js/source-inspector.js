import { sanitizeSharedResourceUrl } from "./share.js?v=0.21.0";

const MAX_FIELDS = 500;
const MAX_SAMPLE_FEATURES = 25;

const fieldRole = (field = {}) => {
  const type = String(field.type || "").toLowerCase();
  if (type.includes("date")) return "timestamp";
  if (/integer|double|single|small|oid|long/.test(type)) return "numeric";
  return "text";
};

function arcgisMetadata(raw, url) {
  const fields = (raw.fields || []).slice(0, MAX_FIELDS).map((field) => ({
    name: String(field.name),
    alias: String(field.alias || field.name),
    type: String(field.type || "unknown"),
    role: fieldRole(field),
    nullable: field.nullable !== false,
  }));
  return {
    kind: Array.isArray(raw.layers) ? "arcgis-service" : "arcgis-layer",
    url,
    title: String(raw.name || raw.mapName || raw.documentInfo?.Title || "ArcGIS source"),
    description: String(raw.description || raw.serviceDescription || ""),
    geometryType: raw.geometryType || null,
    objectIdField: raw.objectIdField || raw.objectIdFieldName || fields.find((field) => /oid/i.test(field.type))?.name || null,
    maxRecordCount: Number.isFinite(raw.maxRecordCount) ? raw.maxRecordCount : null,
    capabilities: String(raw.capabilities || "").split(",").map((item) => item.trim()).filter(Boolean),
    fields,
    layers: (raw.layers || []).map((layer) => ({ id: layer.id, name: String(layer.name || `Layer ${layer.id}`) })),
  };
}

function geoJsonMetadata(raw, url) {
  const features = Array.isArray(raw.features) ? raw.features.slice(0, MAX_SAMPLE_FEATURES) : [];
  const names = [...new Set(features.flatMap((feature) => Object.keys(feature?.properties || {})))].slice(0, MAX_FIELDS);
  const fields = names.map((name) => {
    const values = features.map((feature) => feature?.properties?.[name]).filter((value) => value != null);
    const numeric = values.length > 0 && values.every((value) => typeof value === "number" && Number.isFinite(value));
    return { name, alias: name, type: numeric ? "number" : "string", role: numeric ? "numeric" : "text", nullable: values.length < features.length };
  });
  const geometryTypes = [...new Set(features.map((feature) => feature?.geometry?.type).filter(Boolean))];
  return {
    kind: "geojson",
    url,
    title: String(raw.name || "GeoJSON source"),
    description: String(raw.description || ""),
    geometryType: geometryTypes.length === 1 ? geometryTypes[0] : geometryTypes.length ? "Mixed" : null,
    objectIdField: null,
    maxRecordCount: Array.isArray(raw.features) ? raw.features.length : null,
    capabilities: ["loaded-query", "loaded-statistics"],
    fields,
    layers: [],
  };
}

/** Inspect public ArcGIS REST or GeoJSON metadata without loading it into the map. */
export async function inspectSource(value, { fetchImpl = globalThis.fetch, signal, allowHttp = false } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Source inspection requires fetch().");
  const url = sanitizeSharedResourceUrl(value, { allowHttp });
  const target = new URL(url);
  const looksArcGis = /\/rest\/services\//i.test(target.pathname) || /\/(?:Feature|Map|Image)Server(?:\/\d+)?\/?$/i.test(target.pathname);
  if (looksArcGis) target.searchParams.set("f", "json");
  let response;
  try {
    response = await fetchImpl(target.href, { headers: { Accept: "application/json, application/geo+json" }, signal });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new Error("The source could not be read. Check its URL, CORS policy, and network availability.", { cause: error });
  }
  if (!response.ok) throw new Error(`The source returned HTTP ${response.status}.`);
  let raw;
  try { raw = await response.json(); } catch (error) { throw new Error("The source did not return JSON metadata.", { cause: error }); }
  if (raw?.error) throw new Error(String(raw.error.message || "The ArcGIS service rejected the metadata request."));
  if (looksArcGis || raw?.currentVersion || raw?.geometryType || Array.isArray(raw?.layers)) return arcgisMetadata(raw, url);
  if (raw?.type === "FeatureCollection" && Array.isArray(raw.features)) return geoJsonMetadata(raw, url);
  throw new Error("The source is neither supported ArcGIS REST metadata nor a GeoJSON FeatureCollection.");
}
