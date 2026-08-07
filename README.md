# GIS Map Online

A browser-only 3D GIS viewer targeting ArcGIS Maps SDK for JavaScript 5.0. It uses `SceneView`, native ES modules, a small topic-based event bus, local browser project storage, and portable project packages—no application login or database required.

## Run locally

The SDK and browser module security require HTTP; do not open `index.html` directly from the filesystem.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Modules

- `js/map.js` — 3D scene/camera lifecycle, elevation ground, layer adapters, drawing, refresh, rendering, navigation
- `js/identify.js` — popup-free hit testing and query fallback normalized across layer types
- `js/ui.js` — sidebar, menus, dialogs, layer controls, places, and insight rendering
- `js/project.js` — local projects plus `.gmo` project and `.gmop` package import/export (legacy JSON/ZIP files remain supported)
- `js/attribute-table.js` — searchable, paginated queryable layer table in a non-modal map drawer
- `js/ai.js` — optional Ollama, OpenAI, Anthropic, and OpenAI-compatible adapters; online tokens stay in memory only
- `js/tool-manager.js` — opt-in local JavaScript tool registration
- `js/events.js` — pub/sub event bus
- `js/catalog.js` — editable starter list of public data services
- `js/enterprise-catalog.js` — live ArcGIS Enterprise service-directory browser

## Browser and service constraints

- Remote GIS/AI services must allow this site's origin through CORS.
- GeoJSON URLs load as native, queryable `GeoJSONLayer` instances and retain refresh, styling, and table settings in project files.
- ArcGIS MapServer sublayer URLs are detected automatically, including raster sublayers that must be loaded through their parent `MapImageLayer`.
- Vector operational layers are explicitly draped on the scene ground so Z-enabled feeds such as USGS earthquake data do not fall beneath terrain.
- AI controls appear in Intelligence only while a provider is fully configured. Online API tokens are never persisted or included in exports.
- Browser access to local Ollama is connection-tested before enabling AI. On macOS, allow only this site's origin with `launchctl setenv OLLAMA_ORIGINS "https://gismap.online"`, fully quit Ollama, and reopen it.
- Local KML/KMZ is converted to GeoJSON in the browser; uncommon KML extensions may not be preserved.
- A zipped shapefile must include its `.shp`, `.shx`, and `.dbf` components.
- Local project saves cannot reopen local files after a browser restart. Export a project package to bundle them.
- Public service URLs and provider usage terms should be reviewed before production deployment.
- Loading a custom JavaScript tool executes that file in the page origin. Only load trusted code.
