# Map-v1

Canonical schema: https://gismap.online/schemas/map-v1.schema.json. Example:

```json
{"version":1,"title":"Example","basemap":"gray-vector","camera":{"center":[-75.16,39.95],"zoom":10},"layers":[{"url":"https://example.org/data.geojson","type":"geojson"}]}
```

Coordinates are `[longitude, latitude]` in degrees. Camera can instead use `{"fit":"layers"}` or `{"fit":"none"}`. A layer can include `where`, `renderer`, `opacity`, `visible` and popup fields. An optional top-level `charts` list (at most 6) opens linked chart panels beside the map: `{"type":"bar","title":"Incidents by state","layer":0,"dimension":"POOState","measure":{"field":"DailyAcres","aggregation":"sum"},"placement":"right","style":{"topN":10,"other":"group","palette":"inherit","theme":"futuristic","hidden":[]}}`. `layer` is a position in `layers` or one of their URLs (default 0); leave `measure` out to count features; `placement` is `right` or `bottom`. A chart carries field names only, never records or credentials; the numbers are computed from the layer when the link opens, and the sidebar is left as it is. A chart with an unknown type, a bad field name or a layer that does not load is left out with a warning. Worked example: https://gismap.online/examples/ai/wildfires-by-state-chart/. The example URL is illustrative, not a working dataset. See `assets/examples/` for published GISMap Online examples. The current map-v1 contract is not a complete project-v2, tour or task model. Unknown properties may be ignored with warnings; do not assume they survived. Run the core validator and inspect normalized state.

## Analysis steps

An optional top-level `analysis` list (at most 5 steps) runs spatial analysis in the viewer's browser after the layers load, and adds each result as a layer. `input` and `overlay` are a position in `layers`, `{"step": n}` for the layer an earlier step made, or GeoJSON; `"visible": false` adds a step's layer hidden. Operations are listed in `/api/capabilities.json` under `map.analysisOperations`. A hexagon map from census blocks:

```json
{"version":1,"layers":[{"url":"https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/California_Census_2020_Redistricting_Blocks/FeatureServer/0","type":"feature","where":"County_Name = 'Ventura County' AND P0010001 > 0","visible":false}],"analysis":[{"operation":"random-points","input":0,"options":{"field":"P0010001","unitsPerPoint":20,"seed":1},"visible":false},{"operation":"hexbin","input":{"step":0},"options":{"method":"h3","resolution":8,"statistic":"sum","field":"represents","extrude":true}}]}
```

Options for `hexbin` and `random-points` are in the [hexagon-binning](agent-recipes.md#hexagon-binning) and [dot-density](agent-recipes.md#dot-density) recipes.
