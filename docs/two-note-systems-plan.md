# Map Notes and Field Notes: revised implementation plan

These are independent products. Field Notes are place-based observations and messages; Map Notes are knowledge and review of geographic data. Neither note text nor an imported record grants an agent permission to perform an action. This document supersedes the product naming and phase order in the earlier field-report roadmap; its export and reconstruction requirements remain relevant to Field Notes.

## Phase 1: separate foundations (started, not complete)

The existing field-session workflow is now labelled **Field Notes** in the Modes menu. Existing `project.notes`, the `projectManager.notes` API, IndexedDB sessions, version-1 field JSON, single-note links and reports are preserved. `projectManager.fieldNotes` is an alias to the legacy registry; it is not a migration or a claim that every historical `project.notes` record was originally a field observation. Existing records stay in place without guessing intent. A future explicit, reversible, previewed conversion can let people classify or copy legacy records, but must never delete them or silently change IDs and relationships.

A new, separate project-local `project.mapNotes` array and `projectManager.mapNotes` registry hold data-review notes, using `data-map-note-v1.schema.json`. Project load validates both collections before changing the map; old projects get an empty new collection. Data notes have feature, dataset, service or coordinate targets and editable human categories/status. This first schema intentionally rejects unknown fields, attachments and proposed actions rather than discarding them. Its events include identifiers and counts, not note text. Saved projects can include both collections; the field-only JSON/link/report paths still export only the legacy observation records.

A separate **Map Notes** workspace now creates and reviews dataset, feature, service and location notes, independently of the Field Notes tab. The Map Insights feature action can start a note with its available stable identifiers. Notes belong to the current project; users must save an unsaved project to retain them. Field Notes remain the existing location-observation workflow.

Project-local, typed note relationships can link a Field Note to a Map Note as related, supporting, or contradicting. They are independent records: deleting a note does not cascade-delete the link, and links to missing notes remain unresolved rather than being discarded. Both note workspaces can create, view, and remove these links; relationship views update without replacing an unfinished note draft. They persist in project snapshots, not in field-only JSON, QR links or reports; importing a field note does not automatically transfer project links. Links themselves grant no authority and do not publish or expose either note to AI.

**Not yet delivered:** the broader shared geographic identity, provenance, attachments and access-control core, standalone Field Notes schema and independent persistence implementation, API/agent permission scopes, or migration tooling. The new registries are not exposed as an agent API. Field Notes can still reference an identified feature but do not execute edits. No new public sharing or automatic AI exposure is introduced.

## Phase 2: Field Notes MVP

Continue local field collection and existing JSON, QR and basic PDF work, then add photos, foreground nearby discovery against **locally available** notes, and location-accuracy handling. GPS discovery, acknowledgment and check-in are separate actions. Proximity-based concealment in the client is convenience only, never confidentiality; enforced reveal and cross-user discovery require a later service. Offline application-shell support and real-device tests remain outstanding. The existing report limitations and reconstruction plan remain in `map-notes-reconstruction-plan.md`.

## Phase 3: Map Notes MVP

Expand the initial data-review editor with richer data-target exploration and links to Field Notes. Introduce a separately validated Proposed Change entity; preview and validation must not apply edits. Check schema, permissions, conflicts, source revision, explicit approval and auditability before any eventual execution. Read-only services must not be modified; export/stage patches instead.

## Phases 4–5: AI and shared services

Only after separate authorized read/propose/execute scopes and explicit user consent, add validated classification, suggested links and proposed changes. Treat all human, imported and machine-authored note content as untrusted data. MapSi or another authorized backend may later provide publication, authenticated agents, shared discovery, server-enforced access and synchronization; an offline device cannot discover records it has not received or cached.
