# GIS Map Online

[![GitHub release](https://img.shields.io/github/v/release/geolibrerian/gismap)](https://github.com/geolibrerian/gismap/releases/latest)
[![Tests](https://github.com/geolibrerian/gismap/actions/workflows/test.yml/badge.svg)](https://github.com/geolibrerian/gismap/actions/workflows/test.yml)
[![License](https://img.shields.io/github/license/geolibrerian/gismap)](LICENSE)

A browser-only 3D GIS viewer targeting ArcGIS Maps SDK for JavaScript 5.0. It uses `SceneView`, native ES modules, a small topic-based event bus, local browser project storage, and portable project packages—no application login or database required.

The interface uses a layered globe-and-analysis mark with an editable HTML wordmark and the descriptor “Spatial intelligence studio.”

## Explore and learn

- [Browse public GIS data examples](https://gismap.online/examples/), including
  curated ArcGIS REST services and GeoJSON feeds that open directly in GISMap.
- Browse the [viewer guide index](https://gismap.online/guides/) or read about [ArcGIS REST services](https://gismap.online/arcgis-rest-service-viewer/),
  [FeatureServers](https://gismap.online/arcgis-feature-service-viewer/),
  [MapServers](https://gismap.online/arcgis-map-service-viewer/),
  [GeoJSON](https://gismap.online/geojson-viewer/), and
  [3D GIS](https://gismap.online/3d-gis-viewer/).
- Follow the [AI connection guide](https://gismap.online/ai-connection-guide/) to configure local Ollama or an API-key provider.

The examples index and featured dataset pages are generated from `js/catalog.js`:

```bash
node scripts/build-examples.mjs
```

CI runs the same script with `--check` to keep the committed pages and sitemap in
sync with the application catalog.

## Share remote layers

Choose **Project > Copy share link** to copy a URL that reopens the current public
remote layers and basemap. Local files and credentials are never included. Shared
URLs use repeatable `layer` and `layerType` parameters; curated catalog entries may
also be opened with `?example=<slug>`. Only HTTPS resources are accepted in
production (HTTP is permitted for localhost development).

## Run locally

The SDK and browser module security require HTTP; do not open `index.html` directly from the filesystem.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

### Composable application preview

Feature branches under `codex/**` run `.github/workflows/development-preview.yml`. Every run produces a 14-day static preview artifact after the complete test suite and JavaScript syntax checks pass. An isolated Cloudflare Pages development deployment is enabled only when the `development` GitHub environment defines `CLOUDFLARE_PAGES_PROJECT_DEV`, `CLOUDFLARE_API_TOKEN_DEV`, and `CLOUDFLARE_ACCOUNT_ID_DEV`. These names deliberately do not reuse production credentials or destinations, and the workflow has no production trigger.

The production site remains unchanged until its separate release process is explicitly invoked.

## Releases

The current application version is recorded in [`VERSION`](VERSION). Releases use
[Semantic Versioning](https://semver.org/) and `vX.Y.Z` Git tags. See the
[`CHANGELOG.md`](CHANGELOG.md) for feature-level history and the
[GitHub Releases page](https://github.com/geolibrerian/gismap/releases) for
published builds and generated release notes.

## Modules

- `js/map.js` — 3D scene/camera lifecycle, elevation ground, layer adapters, drawing, refresh, rendering, navigation
- `js/identify.js` — popup-free hit testing and query fallback normalized across layer types
- `js/ui.js` — sidebar, menus, tabbed workspace tools, layer controls, places, and insight rendering
- `js/project.js` — local projects plus `.gmo` project and `.gmop` package import/export (legacy JSON/ZIP files remain supported)
- `js/attribute-table.js` — searchable, paginated queryable layer table in a non-modal map drawer
- `js/ai.js` — optional Ollama, OpenAI, Anthropic, and OpenAI-compatible adapters; online tokens stay in memory only
- `js/tool-manager.js` — opt-in local JavaScript tool registration
- `js/events.js` — pub/sub event bus
- `js/application-state.js` — authoritative selections, filters, active layer, time, styling, navigation, bookmarks, and chapters
- `js/application-registry.js` — validated panel and tool extension contracts with lifecycle cleanup
- `js/application-config.js` — versioned application configuration, presets, and legacy presentation migration
- `js/layout-manager.js` — constrained dock placement and reversible previews around one map instance
- `js/application-runtime.js` — registered workspace/data/presentation panels and approved builder operations
- `js/data-catalog.js` — portable catalog schema, read-only SQL validation, and deterministic natural-language query planning
- `js/duckdb-client.js` — optional, lazily loaded DuckDB-Wasm execution for browser feature records and HTTPS analytical sources
- `js/catalog.js` — public data services plus categories, stable slugs, source
  metadata, reuse guidance, tags, and featured-example controls
- `scripts/build-examples.mjs` — generates the searchable examples index,
  featured dataset pages, viewer guides, and sitemap
- `js/share.js` — safe parsing and creation of shareable remote-layer URLs
- `js/markdown.js` — sanitized Markdown rendering for intelligence responses
- `js/enterprise-catalog.js` — live ArcGIS Enterprise service-directory browser
- `js/auth.js` — ArcGIS Online/Enterprise OAuth, standalone Server token/web-tier registration, federation discovery, and connection diagnostics
- `js/export/` — paginated vector retrieval and background-worker GeoJSON/KML/KMZ/Shapefile conversion

## Browser and service constraints

- Remote GIS/AI services must allow this site's origin through CORS.
- DuckDB-Wasm is loaded only when a user runs SQL. The project stores catalog definitions and pinned source versions, not source credentials or downloaded rows. Remote Parquet, JSON, and CSV sources must use HTTPS and permit browser CORS requests. A view-only catalog is an analytical recipe, not an authorization boundary.
- SQL panels accept one read-only `SELECT`, `WITH`, `DESCRIBE`, `EXPLAIN`, `SHOW`, or `SUMMARIZE` statement at a time. Data-changing statements, extension loading, arbitrary attachment, imports, and exports are rejected before execution. AI-assisted requests always produce a visible plan for review and use the same validator.
- ArcGIS Online and Enterprise Portal connections use the Portal-hosted OAuth experience (PKCE where supported), so built-in, SAML, OIDC, and social logins remain controlled by the organization. Register both the displayed popup callback and full-page redirect URI in the Portal application.
- Federated ArcGIS Servers are discovered from `/rest/info` and associated with their owning Portal. Standalone Servers can use either a discovered token endpoint or explicitly configured browser-managed web-tier authentication (IWA, PKI, or reverse proxy).
- ArcGIS connection tests report version, authentication model, token endpoint, CORS reachability, federation, and owning Portal. Only connection metadata is exported with projects; credentials and tokens are never serialized.
- Map Insight and attribute tables can float over the map or dock to its left, right, or bottom as dashboard panels. Docked layouts resize the ArcGIS view and provide draggable, keyboard-accessible dividers whose sizes are remembered by the browser.
- The resizable Workspace Panel hosts independent, closable tabs for Basemap Gallery, Elevation Profile, Legend, Draw, layer Style, and Intelligence. Draw returns to the left sidebar when its workspace tab closes, and its graphics remain exportable as GeoJSON, KML, KMZ, or zipped Shapefiles.
- On phones, a fixed bottom bar offers Menu, Places, Bookmarks, Draw, Layers, and Details. Tap a button to show its controls above the bar, tap again to close, or tap another to switch. Map navigation stays in a collapsible side rail.
- Places and Bookmarks are independent workspace panels, keeping search and saved views directly accessible without an internal mode switcher.
- GeoJSON URLs load as native, queryable `GeoJSONLayer` instances and retain refresh, styling, and table settings in project files.
- ArcGIS MapServer sublayer URLs are detected automatically, including raster sublayers that must be loaded through their parent `MapImageLayer`.
- ArcGIS FeatureServer `/query` URLs are accepted and normalized to their layer endpoint; `where` and `outFields` are applied to the native feature layer. Layer zoom uses a live, filter-aware feature extent when supported, avoiding stale or malformed service extents.
- WFS 2.0 services with advertised GeoJSON output can be added from either a service endpoint or a full GetFeature URL; feature type names and nonstandard custom parameters are retained automatically.
- Queryable vector layers and user drawings can be downloaded as EPSG:4326 GeoJSON, KML, KMZ, or zipped Shapefiles. Layer exports can honor the active filter, use the current map extent, or retrieve the entire source; pagination, progress, and cancellation are handled without blocking the map.
- Vector operational layers are explicitly draped on the scene ground so Z-enabled feeds such as USGS earthquake data do not fall beneath terrain.
- AI controls appear in Intelligence only while a provider is fully configured. Intelligence can also be opened as a persistent right-panel tab alongside map tools such as the Basemap Gallery. The assistant uses map evidence and detailed reverse-geocoder context first, and may supplement it with clearly labeled general model knowledge. Map Insight selections are sent as bounded, in-memory feature JSON alongside the clicked location and are never saved in projects or browser storage. AI responses remain visible while exploring the map until another query starts or the user clears them. It does not have live web research unless a future research provider is explicitly configured. Online API tokens are never persisted or included in exports.
- Browser access to local Ollama is connection-tested before enabling AI. On macOS, allow only this site's origin with `launchctl setenv OLLAMA_ORIGINS "https://gismap.online"`, fully quit Ollama, and reopen it.
- Local KML/KMZ is converted to GeoJSON in the browser; uncommon KML extensions may not be preserved.
- A zipped shapefile must include its `.shp`, `.shx`, and `.dbf` components.
- Local project saves cannot reopen local files after a browser restart. Export a project package to bundle them.
- Public service URLs and provider usage terms should be reviewed before production deployment.
- Loading a custom JavaScript tool executes that file in the page origin. Only load trusted code.
