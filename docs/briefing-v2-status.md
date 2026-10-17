# Briefing generation v2 — development status

This branch is an **incomplete development build**, not a production-ready briefing generator.

## Implemented so far

- Complete briefing links retain the briefing document (including hidden slides), source layers, the selected primary layer, filter, renderer, engine and ground preference. Old slide-only links remain readable.
- Full-link creation rejects a local or unshareable briefing layer, an oversized custom renderer or filter, an over-limit selection, and credential-bearing layer URLs instead of silently discarding state. Use a portable project export for these cases. An agent can explicitly request a slides-only link with `documentOnly: true`.
- Shared layers are awaited before their renderer is restored. A failed or truncated MapLibre load fails the restore; a shared briefing no longer starts after a required layer fails. Unsupported MapLibre renderers and unsupported extrusion expressions produce errors rather than a misleading default style.
- MapLibre recognizes ArcGIS WebMap `Extrude` symbols and `sizeInfo` in addition to the SDK-style renderer names.

## Reproduce the verified USDA service check

Run `GISMAP_LIVE_TESTS=1 node --test tests/usda-grape-live.test.mjs` with network access. The test reads the service metadata, queries the matching count, pages through the matching features and verifies every result. On the date of this development check the service reported **26** matching counties; this is a live service, so the test does not hard-code that count.

## Still required before completion

The requested provider-neutral extrusion spec and schema, assisted authoring wizard, structured AI generation and verification, full mobile browser presentation tests, comprehensive renderer verification, five-slide example, QR/export end-to-end checks, and fresh-session desktop/mobile rendered round trip are not implemented or verified. In particular, the existing 3D style editor is not yet the requested new extrusion workflow. Links still use the existing v1 sharing format with backward-compatible additional fields; this document does not claim a new briefing schema.
