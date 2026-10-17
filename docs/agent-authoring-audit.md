# Universal agent authoring — capability audit

Status: **development audit, not a parity claim**. This inventory describes the current repository plus the uncommitted changes on `codex/briefing-v2`; it is not evidence of production behavior. `Yes` means an implementation was found, **not** that all requested end-to-end tests have passed. `Partial` means conditional, incomplete, or dependent on the loaded source or engine; `No` means no corresponding general-purpose operation was found. The external column means the in-page JavaScript API, not a server-side REST API or MCP server. Restore assesses the current portable full map/briefing link path, not every project or export format.

| Capability | Human UI | Internal API | External API | MapLibre | ArcGIS | Share restore |
|---|---|---|---|---|---|---|
| ArcGIS FeatureServer source/add | Yes | Yes | Yes | Yes | Yes | Partial |
| ArcGIS map/image service | Yes | Yes | Yes | Partial | Yes | Partial |
| GeoJSON import/source | Yes | Yes | Yes | Yes | Yes | Partial |
| KML/WFS/WMS and local files | Yes | Partial | Partial | Partial | Partial | Partial |
| Shapefile/GeoPackage, PMTiles, STAC/COG | Partial | Partial | No | Partial | Partial | No |
| Inspect source fields/count/sentinels | Partial | Yes | Yes | Yes | Yes | N/A |
| Pagination/large-feature completeness | Partial | Partial | Partial | Partial | Partial | Partial |
| Layer add/remove/update/visibility | Yes | Yes | Yes | Yes | Yes | Partial |
| Layer order | Yes | Partial | No | Partial | Partial | Partial |
| Attribute definition filter | Yes | Yes | Yes | Partial | Yes | Partial |
| Spatial and slide-specific filters | Partial | Partial | Partial | Partial | Partial | Partial |
| Filter preview/verified count | Partial | Partial | Partial | Partial | Partial | No |
| Simple/category/choropleth styles | Yes | Yes | Yes | Partial | Yes | Partial |
| 3D extrusion | Partial | Partial | Partial | Partial | Partial | Partial |
| Cluster/label/visibility rules | Partial | Partial | No | Partial | Partial | Partial |
| Legends | Yes | Yes | Partial | Partial | Yes | Partial |
| Feature query/identify | Yes | Yes | Partial | Partial | Yes | N/A |
| Feature selection/highlight | Yes | Yes | Partial | Partial | Yes | Partial |
| Address/search/geocoding | Yes | Yes | Partial | Partial | Yes | No |
| Camera/navigation/basemap | Yes | Yes | Yes | Yes | Yes | Partial |
| Terrain / 2D and 3D | Yes | Yes | Partial | Partial | Yes | Partial |
| Attribute table/statistics/charts | Yes | Yes | Partial | Partial | Yes | Partial |
| Drawing/measurement | Yes | Yes | No | Partial | Partial | Partial |
| Briefing slides and player | Yes | Yes | Yes | Partial | Partial | Partial |
| Slide-specific camera/layer visibility | Yes | Yes | Partial | Partial | Partial | Partial |
| Slide-specific filters/styles/charts | Partial | Partial | Partial | Partial | Partial | Partial |
| Tours and chapter editing | Yes | Yes | No | Partial | Partial | Partial |
| Dynamic feature-linked tour stops | Partial | Partial | No | Partial | Partial | Partial |
| Field task location, steps, photos | Yes | Yes | No | Partial | Partial | Partial |
| Task collections, geofences, evidence rules, dependencies | Partial | Partial | No | N/A | N/A | Partial |
| Participant consent and evidence submission API | Partial | Partial | No | N/A | N/A | No |
| Dashboard panels/layout | Yes | Yes | Partial | Partial | Partial | Partial |
| Interactive full map/briefing URL | Yes | Yes | Partial | Partial | Partial | Partial |
| Tour and task URL/QR | Yes | Yes | No | Partial | Partial | Partial |
| Smart image/project file/PDF | Yes | Yes | Partial | Partial | Partial | Partial |
| Embed and hosted documents | Partial | Partial | Partial | Partial | Partial | Partial |
| Public REST authoring / OpenAPI | No | No | No | N/A | N/A | No |
| MCP server/adapter | No | No | No | N/A | N/A | No |
| Atomic batches, revision conflict protection | No | No | No | N/A | N/A | No |

## Evidence and limitations

- Source metadata and inspection: `js/source-inspector.js`, `tests/agent-api.test.mjs`, `tests/usda-grape-live.test.mjs`. Inspecting metadata successfully in one environment does **not** establish browser CORS or public authentication requirements. Count/sample queries can fail independently.
- Existing external layers/camera/map/briefing operations: `js/layers-api.js`, `js/briefing-api.js`, `js/map-spec-api.js`, `js/gismap-core.d.ts`, `api/capabilities.json`, `tests/client-api.test.mjs`, `tests/map-share.test.mjs`.
- Engine coverage: `js/engines/engine-interface.js`, `js/engines/engine-registry.js`, engine adapters, `tests/maplibre-engine.test.mjs`. Most cross-engine claims still need rendered browser tests.
- Tours/tasks/dashboard: `js/tour-share.js`, `js/mobile-workflow-router.js`, `js/field-task-share.js`, `js/application-runtime.js`, `tests/tour-share.test.mjs`, `tests/field-task-share.test.mjs`. Existing task QR encodings are not an agent authoring API or a participant-consent system.
- Existing REST-looking `api/*.json` files are static discovery artifacts, **not** server-side authoring endpoints. No independent-client end-to-end acceptance test is present.
- Portable links are size-limited and cannot embed local files; complete sharing and field/style verification remain incomplete. See `docs/briefing-v2-status.md`.

## First shared commands

The existing `ToolRegistry` is the common in-browser entry point, exposed as `gisMapOnline.application.runTool`. The initial read-only `source.inspect`, `layer.list`, `map.camera.inspect`, `briefing.inspect`, and `briefing.validate` definitions are in `js/agent-authoring-tools.js`; `source.inspect` is also used by the built-in assistant. These read source, layer, camera, and briefing state or statically validate the existing briefing model. Validation does not establish rendering correctness. See `tests/agent-authoring-tools.test.mjs`. Existing `layer.*` tools already delegate to `layers` API methods, but UI and chat do not yet all call the same commands.
