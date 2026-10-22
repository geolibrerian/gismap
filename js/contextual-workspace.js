// Metadata-only recommendations. This module never queries a service or changes a map.
const numericType = /^(?:small-integer|integer|single|double|long|number|float|decimal|int(?:16|32|64)?|esriFieldType(?:SmallInteger|Integer|Single|Double|BigInteger))$/i;
const technical = /^(?:objectid|oid|fid|globalid|shape|shape_length|shape_area)$/i;

export function profileLayer(layer, capabilities = []) {
  const fields = (layer?.fields || []).filter((field) => field?.name && !technical.test(field.name));
  const numeric = fields.filter((field) => numericType.test(field.type || "")).map((field) => field.name);
  const temporal = fields.filter((field) => /date|time/i.test(field.type || "") || /(?:^|_|[a-z])(?:year|yr)$/i.test(field.name)).map((field) => field.name);
  const categorical = fields.filter((field) => /string|text/i.test(field.type || "") || field.domain?.type === "codedValue").map((field) => field.name);
  const geometryType = String(layer?.geometryType || "unknown").replace(/^esriGeometry/i, "").toLowerCase();
  return {
    layerId: layer?.uid || null, geometryType, profileStatus: fields.length ? "metadata" : "unavailable",
    fields: { numeric, temporal, categorical },
    capabilities: {
      table: !!layer?.queryable,
      style: !!layer?.queryable && fields.length > 0,
      extrusion: !!layer?.queryable && fields.length > 0 && geometryType === "polygon" && capabilities.includes("spatial-chart-3d"),
    },
  };
}

// Prefer a readable name and useful attributes, but retain every returned field.
export function summarizeFeature(attributes = {}, layer = {}) {
  const entries = Object.entries(attributes).filter(([, value]) => value !== null && value !== "");
  const name = layer.displayField && entries.find(([key, value]) => key === layer.displayField && typeof value === "string" && value.trim());
  const guessed = entries.find(([key, value]) => /(?:^|_)(?:name|title|county|incident)(?:$|_)/i.test(key) && typeof value === "string" && value.trim());
  const title = name?.[1] || guessed?.[1] || layer.title || "Feature";
  const ordered = [...entries].sort(([a], [b]) => Number(technical.test(a)) - Number(technical.test(b)));
  return { title: String(title), summary: ordered.slice(0, 5), remaining: ordered.slice(5) };
}

export const CONTEXT_ACTIONS = Object.freeze({
  "add-data": { label: "Add a service", description: "Connect an ArcGIS REST service", category: "explore" },
  "try-example": { label: "Browse examples", description: "Explore a public data service", category: "explore" },
  "style-layer": { label: "Style layer", description: "Open this layer in Cartography Lab", category: "style" },
  "explore-3d": { label: "3D options", description: "Open Cartography Lab to configure a 3D view", category: "visualize" },
  "view-table": { label: "View table", description: "Inspect layer records", category: "inspect" },
});

export function deriveWorkspace({ layers = [], activeLayerId = null, capabilities = [], selection = null } = {}) {
  const layer = layers.find((item) => item.uid === activeLayerId) || layers[0] || null;
  const profile = layer ? profileLayer(layer, capabilities) : null;
  if (selection?.features?.length) return { rule: "selected-feature", layer, profile, actions: [] };
  if (!layer) return { rule: "empty-project", layer, profile, actions: ["add-data", "try-example"] };
  const actions = [];
  if (profile.capabilities.style) actions.push("style-layer");
  if (profile.capabilities.extrusion) actions.push("explore-3d");
  if (profile.capabilities.table) actions.push("view-table");
  return { rule: "active-layer", layer, profile, actions };
}
