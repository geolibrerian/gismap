// Metadata-only recommendations. This module never queries a service or changes a map.
const numericType = /^(?:small-integer|integer|single|double|long|number|float|decimal|int(?:16|32|64)?|esriFieldType(?:SmallInteger|Integer|Single|Double|BigInteger))$/i;
const technical = /^(?:objectid|oid|fid|globalid|shape|shape_length|shape_area)$/i;

export function profileLayer(layer, capabilities = [], sample = null) {
  const fields = (layer?.fields || []).filter((field) => field?.name && !technical.test(field.name));
  const numeric = fields.filter((field) => numericType.test(field.type || "")).map((field) => field.name);
  const temporal = fields.filter((field) => /date|time/i.test(field.type || "") || /(?:^|_|[a-z])(?:year|yr)$/i.test(field.name)).map((field) => field.name);
  const categorical = fields.filter((field) => /string|text/i.test(field.type || "") || field.domain?.type === "codedValue").map((field) => field.name);
  const boolean = fields.filter((field) => /^(?:boolean|bool)$/i.test(field.type || "")).map((field) => field.name);
  const identifiers = (layer?.fields || []).filter((field) => technical.test(field.name || "") || /^(?:oid|guid|global-id|esriFieldType(?:OID|GUID|GlobalID))$/i.test(field.type || "")).map((field) => field.name);
  const labels = fields.filter((field) => field.name === layer?.displayField || /(?:name|title|label)$/i.test(field.name)).map((field) => field.name);
  const geometryType = String(layer?.geometryType || "unknown").replace(/^esriGeometry/i, "").toLowerCase();
  const records = Array.isArray(sample) ? sample.slice(0, 100) : null;
  const statistics = {};
  if (records) for (const field of fields) {
    const values = records.map((record) => record?.attributes?.[field.name]);
    const present = values.filter((value) => value !== null && value !== undefined && value !== "");
    const numbers = numeric.includes(field.name) ? present.filter((value) => typeof value === "number" && Number.isFinite(value)) : [];
    const temporalValues = temporal.includes(field.name) ? present.map((value) => {
      if (/(?:year|yr)$/i.test(field.name) && numeric.includes(field.name)) return typeof value === "number" && Number.isInteger(value) && value >= 1000 && value <= 3000 ? value : null;
      const timestamp = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
      return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8640000000000000 ? timestamp : null;
    }).filter((value) => value !== null) : [];
    statistics[field.name] = {
      nullCount: values.length - present.length,
      ...(values.length ? { nullRate: (values.length - present.length) / values.length } : {}),
      ...(numbers.length ? { min: Math.min(...numbers), max: Math.max(...numbers) } : {}),
      ...(categorical.includes(field.name) ? { distinctInSample: new Set(present.map(String)).size } : {}),
      ...(temporalValues.length ? { temporalRange: { min: Math.min(...temporalValues), max: Math.max(...temporalValues), units: /(?:year|yr)$/i.test(field.name) && numeric.includes(field.name) ? "year" : "unix-ms" } } : {}),
    };
  }
  return {
    layerId: layer?.uid || null, geometryType, profileStatus: records ? "sampled" : fields.length ? "metadata" : "unavailable",
    fields: { numeric, temporal, categorical, boolean, identifiers, labels },
    coverage: records ? { scope: "local-sample", sampleSize: records.length, complete: false } : { scope: "metadata", complete: false },
    statistics,
    capabilities: {
      table: !!layer?.queryable,
      style: !!layer?.queryable && fields.length > 0,
      categoricalStyle: !!layer?.queryable && categorical.length > 0,
      continuousStyle: !!layer?.queryable && numeric.length > 0,
      numericSummary: numeric.length > 0,
      filter: !!layer?.queryable && !!layer?.filterable && fields.length > 0,
      timeFilter: !!layer?.queryable && !!layer?.filterable && temporal.length > 0,
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
  "add-data": { label: "Add a service", description: "Connect an ArcGIS REST service", category: "explore", command: "addData", mutatesProject: false },
  "try-example": { label: "Browse examples", description: "Explore a public data service", category: "explore", command: "browseExamples", mutatesProject: false },
  "style-layer": { label: "Style layer", description: "Open this layer in Cartography Lab", category: "style", command: "style", mutatesProject: false },
  "filter-layer": { label: "Filter layer", description: "Choose conditions in Cartography Lab", category: "filter", command: "filter", mutatesProject: false },
  "explore-time": { label: "Filter by time", description: "Choose a date or year condition in Cartography Lab", category: "filter", command: "time", mutatesProject: false },
  "explore-3d": { label: "3D options", description: "Open Cartography Lab to configure a 3D view", category: "visualize", command: "threeDimensional", mutatesProject: false },
  "view-table": { label: "View table", description: "Inspect layer records", category: "inspect", command: "table", mutatesProject: false },
});

export function executeContextAction(id, context, handlers) {
  const action = Object.hasOwn(CONTEXT_ACTIONS, id) ? CONTEXT_ACTIONS[id] : null;
  if (!action || !context.actions.includes(id) || typeof handlers?.[action.command] !== "function") throw new Error("This contextual action is unavailable.");
  return handlers[action.command](context);
}

export function deriveWorkspace({ layers = [], activeLayerId = null, capabilities = [], selection = null, sample = null, workflow = "explore", viewport = "desktop" } = {}) {
  const layer = layers.find((item) => item.uid === activeLayerId) || layers[0] || null;
  const profile = layer ? profileLayer(layer, capabilities, sample) : null;
  if (["draw", "notes", "field-task", "briefing", "presentation"].includes(workflow)) return { rule: `workflow:${workflow}`, layer, profile, viewport, actions: [], suppressed: [{ id: "layer-actions", reason: `The ${workflow} workflow has priority.` }] };
  if (selection?.features?.length) return { rule: "selected-feature", layer, profile, actions: [], suppressed: [{ id: "layer-actions", reason: "Feature inspection is active." }] };
  if (!layer) return { rule: "empty-project", layer, profile, actions: ["add-data", "try-example"], suppressed: [] };
  const actions = [];
  const suppressed = [];
  if (profile.capabilities.style) actions.push("style-layer");
  else suppressed.push({ id: "style-layer", reason: "A queryable layer with known fields is required." });
  if (profile.capabilities.timeFilter) actions.push("explore-time");
  else suppressed.push({ id: "explore-time", reason: "A filterable layer with a date or year field is required." });
  if (profile.capabilities.extrusion) actions.push("explore-3d");
  else suppressed.push({ id: "explore-3d", reason: "A styleable polygon layer and a compatible engine are required." });
  if (profile.capabilities.table) actions.push("view-table");
  else suppressed.push({ id: "view-table", reason: "The layer is not queryable." });
  if (profile.capabilities.filter) actions.push("filter-layer");
  else suppressed.push({ id: "filter-layer", reason: "A filterable layer with known fields is required." });
  return { rule: "active-layer", layer, profile, actions, suppressed };
}

// Persist opaque, bounded keys rather than service URLs, which can contain tokens.
export function suggestionKey(projectId, rule, config = {}) {
  const source = [projectId || "", rule || "", String(config.url || "").split("?")[0], config.fileName || "", config.projectPath || "", config.collectionKey || "", !config.url && !config.fileName && !config.projectPath ? config.uid || "" : ""].join("\u0000");
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

export function createSuggestionPreferences(storage) {
  const key = "gismap-online:dismissed-context:v1";
  let dismissed;
  try { const value = JSON.parse(storage?.getItem(key) || "[]"); dismissed = new Set(Array.isArray(value) ? value.filter((item) => typeof item === "string").slice(-200) : []); }
  catch { dismissed = new Set(); }
  const save = () => { try { storage?.setItem(key, JSON.stringify([...dismissed].slice(-200))); } catch { /* Continue in memory. */ } };
  return {
    has: (id) => dismissed.has(id),
    dismiss: (id) => { dismissed.delete(id); dismissed.add(id); while (dismissed.size > 200) dismissed.delete(dismissed.values().next().value); save(); },
    restore: (id) => { dismissed.delete(id); save(); },
  };
}
