# Changelog

All notable changes to GIS Map Online are documented here. This project follows
[Semantic Versioning](https://semver.org/), and this file follows the
[Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

### Added

- Search-focused homepage metadata, canonical and social-card tags, and truthful
  SoftwareApplication/WebApplication structured data.
- A compact first-use introduction with direct actions for ArcGIS REST, GeoJSON,
  local files, and curated examples.
- Public `robots.txt` and `sitemap.xml` discovery files.
- Safe shareable URLs for public remote layers, catalog examples, and the active
  basemap, including automatic loading when a recipient opens the link.
- A Project menu action that copies the current map's share link.

### Security

- Share links reject non-web URL schemes, embedded usernames and passwords, and
  common token, API-key, and credential query parameters. Local files are never
  included.

### Fixed

- Prevented the optional GIS Server Directory URL field from invoking browser
  validation and trapping users when the Popular Data Services dialog is closed.

## [0.9.0] - 2026-09-04

### Added

- Browser-based GeoJSON downloads for queryable vector layers.
- Filtered-layer, current-map-extent, and entire-source export scopes.
- Paginated feature retrieval with visible progress and cancellation.
- Background Web Worker conversion and packaging to keep the map responsive.
- EPSG:4326 geometry normalization, including multipart lines and polygons.
- USGS NAIP Plus imagery in the Popular data services catalog.
- Recent MODIS hotspots, active hurricanes, PM2.5 observations, USGS seismic
  activity, NDFD wind gusts, and NDFD precipitation in Popular data services.
- A GIS Server Directory link and live ArcGIS server-endpoint browser in Popular
  data services, without copying or indexing the external directory.
- KML, KMZ, and zipped Shapefile downloads for queryable vector layers.
- GeoJSON, KML, KMZ, and zipped Shapefile export for user-drawn points, lines,
  polygons, and rectangles, including an optional current-extent scope.

### Changed

- Separated Bookmarks from Places into its own top-level workspace panel.
- Removed the Places Search/Bookmarks switcher so place search remains directly
  accessible in every navigation layout.
- Added Bookmarks to the compact mobile panel navigation.

### Fixed

- Prevented Popular Data Service buttons from submitting the unrelated GIS
  Server Directory URL field.
- Added FeatureServer-root discovery so multi-layer ArcGIS services open a layer
  picker instead of failing when treated as an individual feature layer.
- Preserved ArcGIS geometry types when SDK `toJSON()` output omits the type,
  preventing valid features from failing export as unknown geometry.
- Versioned nested catalog and export-worker modules so deployments do not retain
  stale data or conversion code from the browser cache.
- Prevented place-search suggestions from being clipped by the inline panel in
  wide top-navigation mode.

## [0.8.0] - 2026-09-04

### Added

- Adaptive side-panel and top-navigation workspace layouts.
- System, light, and dark appearance modes with an optional matching dark basemap.
- Dockable, resizable Map Insight and attribute-table dashboard panels.
- A reusable, resizable utility panel for the 3D basemap gallery.
- Configurable feature highlighting, click-cross feedback, and highlight colors.
- ArcGIS Online and Enterprise Portal OAuth connections, standalone Server token
  and web-tier connections, federation discovery, and connection diagnostics.
- WFS 2.0 service loading with GeoJSON output and retained custom parameters.
- Layer filters for ArcGIS feature services and GeoJSON feeds.
- Search-as-you-type place suggestions.

### Changed

- Consolidated Project, Data, Map, and Tools into a compact menu in top-navigation
  mode.
- ArcGIS query URLs now retain `where` and `outFields` parameters while using the
  native layer endpoint.
- Map Insight and attribute tables share the same layout and docking preferences.

### Fixed

- Corrected spatial-reference handling and extent calculation for ArcGIS features.
- Corrected zoom-to-feature behavior from attribute-table rows.
- Removed stale attribute-table content when its source layer is removed.
- Prevented search suggestions from remaining open after selection.
- Reduced map and panel flicker during feature identification.

[Unreleased]: https://github.com/geolibrerian/gismap/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/geolibrerian/gismap/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/geolibrerian/gismap/releases/tag/v0.8.0
