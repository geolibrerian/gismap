> **Status:** 2026-10-21. Phases 0–3 shipped on `codex/data-driven-briefs`. The new layout (Deck, Data dock, Briefing inspector) is the desktop default; `?briefingLayout=1` restores the previous layout. Phase 4 (mobile, keyboard, accessibility) is not started.

# Briefing authoring redesign

## Problems (from use, confirmed in code)

1. **The left panel doubles in width for both tabs** and squeezes the map (`#syncBriefingTabs`, `js/ui.js`: "Both tabs are the same double-wide workspace on desktop"). Most of that width is empty on the Slides tab.
2. **Features | Slides is the wrong split.** Choosing data and making slides are one task. The tabs hide the deck while you choose features, and hide the data while you edit slides. The "1 included" count and the "Add 1 included feature as slides" button connect the two tabs, which shows that the split is artificial.
3. **Template picking is buried.** Four accordions ("Explore data-driven templates", "3D Spatial Chart", "Timeline", "Grid Atlas") sit under the tabs, below "Make from the map", above "Add a slide". The order says nothing about the user's choice.
4. **Filtering is confusing and incomplete.**
   - Operators depend on `fieldKind()` (`js/presentation-query.js`). Text fields get only is, is not, contains, starts with, has a value. Numbers get =, ≠, >, ≥, <, ≤. Dates get nothing date-aware, and there is no "between" or "is one of".
   - There are three filter UIs with different vocabularies: the Briefing conditions (`#briefingSelectTools`, ops `eq/neq/starts_with/is_not_null`), the layer filter dialog (`ui.js` ~5746, ops `equals/ne/starts/null`), and `presentation-query.js` (`equals/starts/missing`). The data-driven briefs spec asks for one safe filter AST.
   - The status line mixes three counts ("500 shown · first 400 listed · 1 included · 1 selected for briefing").
5. **Group by is a chip cloud** with two hidden buttons per chip (filter, +include). Its real job ("one slide per group") is the Filter Series template, which lives elsewhere.
6. **Map Insights are switched off in Briefing mode.** `identify:complete` (`js/ui.js` ~713) closes the insights overlay on every click while the Briefing template is active. Clicks become briefing feature selection, even on other layers or empty map.

## Design

The map stays central and full height. Briefing uses the panels the app already has:

| Region | Content | Built on |
| --- | --- | --- |
| **Left sidebar, normal width: Deck** | Briefing title; **New slides** (the template picker, first); the slide list (drag to reorder, duplicate, hide); Present, Share, PDF | Existing sidebar; `BriefingSlides` list rendering |
| **Right Workspace panel: Inspector** | Tabs: **Slide** (title, narrative, blocks, camera capture, data view, layers and relations); **Feature** (selected feature context, "+ Slide", "+ Tour", "Task"); **Insight** (Map Insight when docked right). Template settings open here when adding slides. | `#syncUtilityPanel` tabs and the existing "Context briefing" presentation tab; resizable |
| **Bottom dock: Data** | Filter chips, group-by, a sortable table of features with selection checkboxes, and the actions "+ Slide" per row, "Slide per group", and "Make slides from N selected" | Attribute table bottom dock (`TABLE_POSITIONS` `dock-bottom`); collapses to a one-line bar |

Rules:
- **Selection is shared.** Map click, table row and slide all select the same feature and highlight it in all three places.
- **Map clicks never lose information.** A click on the briefing layer selects the feature (Feature tab) and still updates Map Insight. A click on any other layer or empty map shows Map Insight as in Standard mode. Only the explicit **Pick on map** toggle captures clicks for include/exclude; it shows a banner and exits with Esc.
- **One count line:** "1,204 of 23,941 features match · 3 selected", with "(loaded sample)" and a "Load all in view" action when the source is truncated.
- **Templates are actions, not sections.** New slides opens a short picker: Title · From selected features · One slide per group (Filter Series) · Timeline · Grid Atlas · 3D chart · Blank map. Picking one opens its settings in the Inspector with a live preview ("will add 8 slides") and an **Add slides** button.
- **Grouping lives in the Data table.** Group by a field to get collapsible group rows with counts. Each group row has "Include all" and "Slide per group", which runs Filter Series with that field.

### Unified filter builder (`js/filter-builder.js`)

One component used by Briefing, the layer filter dialog, the Dataset explorer and the data-driven templates. It produces the safe filter AST that `normalizeFilter` and `seriesWhere` already consume, so the same filter can drive the table, a slide's `dataView`, the layer's `where` and agent links.

| Field kind | Operators | Value control |
| --- | --- | --- |
| Text | is, is not, **is one of**, contains, starts with, is empty, has a value | Distinct values with counts (searchable) |
| Number | =, ≠, >, ≥, <, ≤, **between**, is empty | Number inputs with min/max hint and a small histogram |
| Date | **on, before, after, between, in the last N days/months/years** | Date inputs; respects the timeline timezone |
| Integer year field | Number operators, plus "in year range" | Two year inputs |
| Boolean / coded domain | is, is not, is one of | Domain names, not raw codes |

It also has: a Match all / any toggle; chips that can be edited in place; "Apply to layer" kept separate from "Filter the list"; and filters that are shown as sentences ("Acres between 1,000 and 50,000"), which agents can copy.

## Phases

| Phase | Work | Done when |
| --- | --- | --- |
| **0. Quick fixes** (ships alone) | Stop suppressing Map Insights except in Pick on map; add between and date operators to the current conditions; the single count line | Clicking a road or another layer in Briefing shows Map Insight; Acres between and Date after filter correctly |
| **1. Filter builder** | `js/filter-builder.js` and its AST; replace the three filter UIs; unit tests for every operator and its SQL / JS / MapLibre compilation | One operator vocabulary everywhere; the layer filter dialog and Briefing produce identical ASTs |
| **2. Layout** | Deck in the left sidebar at normal width; Data in the bottom dock; Inspector in the Workspace panel; remove the Features/Slides tabs and the double-wide mode. Use a `?briefingLayout=2` flag until done. | The map keeps its width; all existing briefing tests pass; the Slides tab content is reachable from the Deck and the Inspector |
| **3. Templates as actions** | New slides picker; template settings in the Inspector with preview; grouping in the table with "Slide per group" | No template accordions remain; each template is reachable in two clicks |
| **4. Mobile and polish** | Phone: Deck as cards, Data as a bottom sheet, Inspector as a sheet; keyboard (J/K slides, / to filter, Esc to exit pick); screen reader labels; reduced motion | Browser checks at 375 px and desktop; keyboard-only walk-through recorded |

Keep the document format (`briefing-v1`) and agent APIs unchanged. This is a UI change, so existing links, projects and `generateTemplate` keep working.

## Verification

- Promote the headless Chrome harness used during review (navigate, run a check, screenshot) into `scripts/browser-check.mjs`. Add Briefing scenarios: open with a FeatureServer, filter with between, group by year, slide per group, edit a slide, present, and click another layer to get Map Insight.
- Run each scenario at 1440 and 375 pixels wide and attach screenshots to the PR.
- Keep the current unit tests green, and add filter-builder tests.

## Open questions for you

1. Should the Data dock open by default when Briefing starts, or only once a dataset is chosen?
2. Is "Present" a full-screen deck only, or should it also have a "present in the map" mode (current behaviour) chosen per briefing?
3. Should Pick on map remain, or can table checkboxes plus map selection cover it?
