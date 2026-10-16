// Application tools for layers, so application.runTool and application.plan
// can add, style, filter and zoom to layers. Each delegates to the `layers`
// API. The definitions (with JSON Schema inputs) are plain data, listed in
// api/capabilities.json.

const layerRef = { type: "string", description: "The layer's id (from layers.list()), service URL or title." };
const rendererRef = { type: "object", description: "A RendererSpec, such as { \"type\": \"choropleth\", \"field\": \"POP\", \"ramp\": \"greens\" }. See schemas/renderer-v1.schema.json." };
const whereRef = { type: ["string", "null"], description: "A read-only SQL where clause on the layer's fields, such as \"POP > 1000\". null clears it." };

export const LAYER_TOOL_DEFINITIONS = Object.freeze([
  {
    id: "layer.add",
    displayName: "Add layer",
    description: "Add a public layer by HTTPS URL (ArcGIS REST, GeoJSON, WMS, WFS or KML) and wait until it has loaded.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "HTTPS URL of a layer, service or GeoJSON file." },
        type: { enum: ["arcgis-auto", "feature", "map-image", "imagery", "geojson", "wms", "wfs", "kml"], description: "Layer type; arcgis-auto detects it." },
        title: { type: "string" },
        where: whereRef,
        renderer: rendererRef,
        opacity: { type: "number", minimum: 0, maximum: 1 },
        visible: { type: "boolean" },
        ignoreServiceScaleRange: { type: "boolean", description: "Draw at every zoom level, ignoring the publisher's scale range." },
        zoomTo: { type: "boolean", description: "Fit the view to the data; default true for the first data layer." },
      },
    },
  },
  { id: "layer.remove", displayName: "Remove layer", description: "Remove a layer from the map.", inputSchema: { type: "object", required: ["layer"], properties: { layer: layerRef } } },
  {
    id: "layer.update",
    displayName: "Update layer",
    description: "Change a layer's title, filter, style, opacity, visibility or scale range.",
    inputSchema: { type: "object", required: ["layer"], properties: { layer: layerRef, title: { type: "string" }, where: whereRef, renderer: rendererRef, opacity: { type: "number", minimum: 0, maximum: 1 }, visible: { type: "boolean" }, ignoreServiceScaleRange: { type: "boolean" } } },
  },
  { id: "layer.style", displayName: "Style layer", description: "Style a layer with a RendererSpec.", inputSchema: { type: "object", required: ["layer", "renderer"], properties: { layer: layerRef, renderer: rendererRef } } },
  { id: "layer.filter", displayName: "Filter layer", description: "Show only the features matching a where clause.", inputSchema: { type: "object", required: ["layer", "where"], properties: { layer: layerRef, where: whereRef } } },
  { id: "map.zoomToLayer", displayName: "Zoom to layer", description: "Fit the view to a layer's filtered data, or to every data layer when no layer is given.", inputSchema: { type: "object", properties: { layer: layerRef } } },
]);

const runners = {
  "layer.add": (layers, { url, ...options }) => layers.add(url, options),
  "layer.remove": (layers, { layer }) => layers.remove(layer),
  "layer.update": (layers, { layer, ...patch }) => layers.update(layer, patch),
  "layer.style": (layers, { layer, renderer }) => layers.update(layer, { renderer }),
  "layer.filter": (layers, { layer, where }) => layers.update(layer, { where }),
  "map.zoomToLayer": (layers, { layer } = {}) => layers.zoomTo(layer ?? null),
};

/** Checks the required properties and simple types of a tool's input against its schema. */
export function checkToolInput(schema, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "The tool input must be an object.";
  for (const key of schema.required || []) {
    if (input[key] === undefined || input[key] === "") return `"${key}" is required.`;
  }
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties?.[key];
    if (!property || value === undefined) continue;
    const types = [].concat(property.type || []);
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (types.length && !types.includes(actual)) return `"${key}" must be ${types.join(" or ")}.`;
    if (property.enum && !property.enum.includes(value)) return `"${key}" must be one of: ${property.enum.join(", ")}.`;
  }
  return true;
}

export function registerLayerTools(registry, layers) {
  for (const definition of LAYER_TOOL_DEFINITIONS) {
    registry.register({
      ...definition,
      validate: (input) => checkToolInput(definition.inputSchema, input),
      execute: (input) => runners[definition.id](layers, input),
    });
  }
}
