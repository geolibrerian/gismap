# Changelog

All notable changes to GIS Map Online are documented here. This project follows
[Semantic Versioning](https://semver.org/), and this file follows the
[Keep a Changelog](https://keepachangelog.com/) format.

## [Unreleased]

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

[Unreleased]: https://github.com/geolibrerian/gismap/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/geolibrerian/gismap/releases/tag/v0.8.0
