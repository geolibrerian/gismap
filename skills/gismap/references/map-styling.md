# Styling and 3D

See https://gismap.online/schemas/renderer-v1.schema.json and https://gismap.online/api/capabilities.json. Inspect source fields and their types first; build a renderer with supported types such as `choropleth`, using the real field and an advertised classification method/ramp. `renderers.validate` can check a renderer and field compatibility when supplied fields; `layers.suggestStyles` can recommend styles for a loaded layer. Preserve pinned class breaks when reproducibility matters.

## Layer styles (Cartography Lab)

A layer style ([schema](https://gismap.online/schemas/layer-style-v1.schema.json)) is a reusable layer file: a `renderer`, an optional 3D `spatialChart`, a `where` filter and `opacity` for one source. People make them in Tools › Cartography Lab; agents use `gisMapOnline.layerStyles` in the page:

```js
const style = gisMapOnline.layerStyles.save({ type: "gismap-layer-style", version: 1, name: "Acres in 3D",
  source: { url: layer.url }, renderer: { type: "choropleth", field: "GIS_ACRES", ramp: "oranges" },
  spatialChart: { type: "spatial-3d-chart", mode: "attribute-extrusion", height: { field: "GIS_ACRES", scale: 0.02 } },
  where: "YEAR_ >= 2019" });
await gisMapOnline.layerStyles.apply(layer.id, style.id);      // filter, opacity, renderer, then the 3D chart
const { url } = await gisMapOnline.layerStyles.createLink(style.id); // a #map=json: link (map-v1)
const briefing = gisMapOnline.layerStyles.toBriefing(style.id);      // title, flat map and 3D slides
```

Outside the page, put the same `renderer`, `spatialChart`, `where` and `opacity` on a map-v1 layer: a style is exactly that layer entry plus a name. Styles are saved with the project and in the browser's style library, and download as `.gismap-style.json`. Vector tile export is planned, not available.

3D extrusion and renderer compatibility differ between engines. Do not invent a normalized extrusion schema or claim a renderer works on both engines; verify the actual engine and rendered heights, including null/negative data. Unsupported renderers or dropped configuration require an explicit warning or a verified fallback.
