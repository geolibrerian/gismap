# GIS Map Online

[![GitHub release](https://img.shields.io/github/v/release/geolibrerian/gismap)](https://github.com/geolibrerian/gismap/releases/latest)
[![Tests](https://github.com/geolibrerian/gismap/actions/workflows/test.yml/badge.svg)](https://github.com/geolibrerian/gismap/actions/workflows/test.yml)
[![License](https://img.shields.io/github/license/geolibrerian/gismap)](LICENSE)

A browser-only 3D GIS viewer targeting ArcGIS Maps SDK for JavaScript 5.0. It uses `SceneView`, native ES modules, a small topic-based event bus, local browser project storage, and portable project packages—no application login or database required.

The interface uses a layered globe-and-analysis mark with an editable HTML wordmark and the descriptor “Spatial intelligence studio.”

## Explore and learn

- [Browse public GIS data examples](https://gismap.online/examples/), including
  curated ArcGIS REST services and GeoJSON feeds that open directly in GISMap.
- Read the viewer guides for [ArcGIS REST services](https://gismap.online/arcgis-rest-service-viewer/),
  [FeatureServers](https://gismap.online/arcgis-feature-service-viewer/),
  [MapServers](https://gismap.online/arcgis-map-service-viewer/),
  [GeoJSON](https://gismap.online/geojson-viewer/), and
  [3D GIS](https://gismap.online/3d-gis-viewer/).

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

## Releases

The current application version is recorded in [`VERSION`](VERSION). Releases use
[Semantic Versioning](https://semver.org/) and `vX.Y.Z` Git tags. See the
[`CHANGELOG.md`](CHANGELOG.md) for feature-level history and the
[GitHub Releases page](https://github.com/geolibrerian/gismap/releases) for
published builds and generated release notes.

## Modules

- `js/map.js` — 3D scene/camera lifecycle, elevation ground, layer adapters, drawing, refresh, rendering, navigation
- `js/identify.js` — popup-free hit testing and query fallback normalized across layer types
- `js/ui.js` — sidebar, menus, dialogs, layer controls, places, and insight rendering
- `js/project.js` — local projects plus `.gmo` project and `.gmop` package import/export (legacy JSON/ZIP files remain supported)
- `js/attribute-table.js` — searchable, paginated queryable layer table in a non-modal map drawer
- `js/ai.js` — optional Ollama, OpenAI, Anthropic, and OpenAI-compatible adapters; online tokens stay in memory only
- `js/tool-manager.js` — opt-in local JavaScript tool registration
- `js/events.js` — pub/sub event bus
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
- ArcGIS Online and Enterprise Portal connections use the Portal-hosted OAuth experience (PKCE where supported), so built-in, SAML, OIDC, and social logins remain controlled by the organization. Register both the displayed popup callback and full-page redirect URI in the Portal application.
- Federated ArcGIS Servers are discovered from `/rest/info` and associated with their owning Portal. Standalone Servers can use either a discovered token endpoint or explicitly configured browser-managed web-tier authentication (IWA, PKI, or reverse proxy).
- ArcGIS connection tests report version, authentication model, token endpoint, CORS reachability, federation, and owning Portal. Only connection metadata is exported with projects; credentials and tokens are never serialized.
- Map Insight and attribute tables can float over the map or dock to its left, right, or bottom as dashboard panels. Docked layouts resize the ArcGIS view and provide draggable, keyboard-accessible dividers whose sizes are remembered by the browser.
- Places and Bookmarks are independent workspace panels, keeping search and saved views directly accessible without an internal mode switcher.
- GeoJSON URLs load as native, queryable `GeoJSONLayer` instances and retain refresh, styling, and table settings in project files.
- ArcGIS MapServer sublayer URLs are detected automatically, including raster sublayers that must be loaded through their parent `MapImageLayer`.
- ArcGIS FeatureServer `/query` URLs are accepted and normalized to their layer endpoint; `where` and `outFields` are applied to the native feature layer. Layer zoom uses a live, filter-aware feature extent when supported, avoiding stale or malformed service extents.
- WFS 2.0 services with advertised GeoJSON output can be added from either a service endpoint or a full GetFeature URL; feature type names and nonstandard custom parameters are retained automatically.
- Queryable vector layers and user drawings can be downloaded as EPSG:4326 GeoJSON, KML, KMZ, or zipped Shapefiles. Layer exports can honor the active filter, use the current map extent, or retrieve the entire source; pagination, progress, and cancellation are handled without blocking the map.
- Vector operational layers are explicitly draped on the scene ground so Z-enabled feeds such as USGS earthquake data do not fall beneath terrain.
- AI controls appear in Intelligence only while a provider is fully configured. The assistant uses map evidence and detailed reverse-geocoder context first, and may supplement it with clearly labeled general model knowledge. It does not have live web research unless a future research provider is explicitly configured. Online API tokens are never persisted or included in exports.
- Browser access to local Ollama is connection-tested before enabling AI. On macOS, allow only this site's origin with `launchctl setenv OLLAMA_ORIGINS "https://gismap.online"`, fully quit Ollama, and reopen it.
- Local KML/KMZ is converted to GeoJSON in the browser; uncommon KML extensions may not be preserved.
- A zipped shapefile must include its `.shp`, `.shx`, and `.dbf` components.
- Local project saves cannot reopen local files after a browser restart. Export a project package to bundle them.
- Public service URLs and provider usage terms should be reviewed before production deployment.
- Loading a custom JavaScript tool executes that file in the page origin. Only load trusted code.
