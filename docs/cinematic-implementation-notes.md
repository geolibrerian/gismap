# Cinematic Mode implementation notes

## Architecture checkpoint — 2026-10-23

- Presentation modes are normalized in `js/project.js` and rendered by `UIController` in `js/ui.js`; the current mode list is template-based rather than a standalone registry.
- `js/animation-clock.js` already owns an engine-neutral requestAnimationFrame clock. Cinematic wraps it rather than allowing a renderer-specific clock.
- Both current renderers expose the same transient `setFeatureFilter()`/`getFeatureFilter()` contract through `MapController`. MapLibre filters loaded vector features; ArcGIS sets `LayerView.filter`. This is the Phase 1 rendering seam.
- Existing time code is briefing-specific (`js/briefing-timeline*.js`) and produces slides. It is not reused for cinematic playback because Cinematic needs timestamped observation steps, not generated intervals.
- Projects persist `presentation` via `ProjectManager`; the initial cinematic spec is deliberately separate and versioned under `presentation.cinematic` in the next UI integration step. It references existing layer IDs and does not duplicate layer bytes.

## Chosen first slice

`js/cinematic/temporal-adapter.js` validates explicit time-field selection and creates a bounded normalized observation model from queried features. It declines numeric-year inference and rows without valid time or stable identity. `timeline-controller.js` maps a shared clock over the observed range. `mode.js` applies only transient object-ID filters, restoring the prior filter on destroy. Polygon snapshots step between observed states; no geometry interpolation is performed.

The initial UI is available from **Modes → Cinematic mode**: it requires a queryable layer with a stable ID, makes the author choose a detected date/timestamp field, and offers an optional grouping field. The compact mode dashboard supports play/pause, step, and scrub; leaving it restores the prior transient layer filters. The normalized spec is persisted in `presentation.cinematic` with the project. The in-page API exposes `gisMapOnline.cinematic.importCinematicSpec()` and `exportCinematicSpec()`.
