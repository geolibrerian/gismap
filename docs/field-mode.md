# Field Mode

Field Mode is GISMap's dedicated, mobile-first collector at `/field/`. It is a
separate installable PWA so a person can create and retain observations without
opening a map, loading a service, or having a network connection.

The initial local-only release stores records and attachment blobs in IndexedDB.
It supports text, manual or device-GPS point locations, photos, voice recordings,
and freehand screen-space sketches. Sketches are explicitly not presented as
georeferenced geometry. Location permission is requested only after the person
taps **Use device GPS**.

## Data and transfer

Records use `gismap.field-record.v1` and retain the observation's geometry,
properties, notes, attachment references, relationships, and `local-only` sync
state. `.gisfield` packages use `gismap.field-package.v1`; they include local
record attachments. GeoJSON export deliberately contains only geometry and text
properties. Compact QR records carry one text/location observation and never
include audio, photos, or sketches.

No account, upload, background synchronization, or offline speech transcription
is implied by this phase. Map-backed collection, cached map areas, sync conflict
handling, configurable forms, and a bridge to project notes remain later phases.
