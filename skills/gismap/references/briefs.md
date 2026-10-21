# Briefings

Use briefing-v1: https://gismap.online/schemas/briefing-v1.schema.json and the `briefing` namespace of the core or in-page API. `briefing.validate` is static; its success does not verify the data, scene, or mobile presentation. A map-v1 can include a briefing document. Existing examples at https://gismap.online/examples/ai/ demonstrate this model. Validate slide layer references, camera and visibility after reopening. Full independent per-slide styling/filter and publishing parity is not guaranteed; test what is retained rather than claiming it.

## Generate data-driven templates in an active GISMap page

`gisMapOnline.briefing.generateTemplate(options)` is an **experimental in-page JavaScript API**, not an HTTP endpoint or a function of the standalone core module. First load a queryable layer in GISMap and await `gisMapOnline.ready`. Supply its loaded `layerId` (UID, ID, URL or title), or use the current primary layer. The method queries at most 500 features using the layer's existing definition filter and appends slides to the current briefing. It does not use the Features tab's selected IDs or search. Use `previewOnly: true` to validate and construct a candidate without saving:

```js
const api = globalThis.gisMapOnline;
await api.ready;
const result = await api.briefing.generateTemplate({
  template: "filter-series", layerId: "your-loaded-layer-id",
  field: "CATEGORY", previewOnly: true
});
console.log(result.preview, result.coverage, result.saved); // saved is false
```

To add slides, repeat with `previewOnly: false` (the default). The result contains `{ document, preview, coverage, saved }`; coverage is always `completeness: "unknown"` because an engine may already hold a partial source even when `exceededTransferLimit` is false. Counts, draft narratives, category discovery and empty-cell decisions are based on the queried sample, not guaranteed complete-source statistics. Results may change as the underlying source or map filter changes. An existing briefing with slides from a different source is rejected rather than silently retargeted.

Supported examples (replace layer IDs and field names with values confirmed from the loaded layer):

```js
const layerId = "your-loaded-layer-id";
await api.briefing.generateTemplate({ template: "filter-series", layerId, field: "CATEGORY" });
await api.briefing.generateTemplate({ template: "timeline", layerId, field: "YEAR_", start: 2015, end: 2024, step: 1, mode: "cumulative", presentationMode: "single-slide" });
await api.briefing.generateTemplate({ template: "grid-atlas", layerId, rows: 3, columns: 3, order: "snake", skipEmpty: true, countMode: "intersecting" });
await api.briefing.generateTemplate({ template: "spatial-3d-chart", layerId, groupBy: "YEAR_", heightField: "GIS_ACRES", slotMeters: 400, gapMeters: 100, scale: 1 });
const link = await api.briefing.createLink();
```

Filter Series and Timeline frame matching features by default as playback advances. Pass `cameraPolicy: "fixed"` to keep the captured map view across generated slides, or `"fit-features"` to follow matching features. Framing uses the included loaded features; when none are available, playback may query up to 500 source features or fall back to the saved view. Verify rendering and source coverage. Date-based Filter Series also expose timeline playback alongside slide navigation. Filter Series supports unique values. Timeline accepts integer years or date fields (date kind is inferred; date inputs use `YYYY-MM-DD`), calendar `unit`, IANA `timeZone`, `interval`/`cumulative`/`rolling`/`validity` modes (date-only values stored as UTC midnight, such as CAL FIRE `ALARM_DATE`, need `timeZone: "UTC"`; the preview warns otherwise), optional numeric `stat` and `statField`, and `slide-series` or `single-slide`. Grid Atlas accepts `rows`/`columns` or `targetCells`, `row-major`/`column-major`/`snake`, and `assigned` or `intersecting` counts. It requires WGS84 points, lines or polygons; non-point features are assigned to the first intersecting cell in row-major order. Boundary touches count as intersections; map features remain visible outside the cell. 3D Spatial Chart requires MapLibre polygons, a valid `groupBy` field, and a numeric `heightField`; it appends Overview, Magnitude, History, Accumulation and Conclusion slides whose `spatialChart` state is restored when presentation ends. It uses original-footprint fast display, not exact overlap partitioning or unique-area aggregation, and rejects group fields with more than 40 distinct values in the bounded query (filter the layer or use a coarser field) rather than dropping groups. Magnitude slabs are capped at the slot height so they never cover the next group. Metric-sized grids, clipping, complete-source aggregation and regeneration are not implemented. The shared briefing has at most 60 slides. Check `result.preview` and reopen the resulting link in GISMap; a returned link is not evidence that rendering or sharing was verified.
