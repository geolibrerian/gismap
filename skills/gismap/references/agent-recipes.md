# Six composable agent recipes

Choose every recipe needed for the user's request, not just one. Use **discover → inspect → plan → validate → execute → verify → share**. Inspect the [capabilities](https://gismap.online/api/capabilities.json), [manifest](https://gismap.online/api/manifest.json), schemas and current engine first. Static HTTP documents, declarative URLs, standalone JavaScript utilities and an active, authorized `gisMapOnline` browser session are different execution environments; none implies a hosted authoring API. Report unavailable capabilities rather than inventing an API or silently substituting an output.

<a id="interactive-map"></a>

## interactive-map — filtered, styled interactive map

**Prompt:** “Map this data and color it by population.” **Inputs:** source URL or local file, intended geography, field, filter, renderer, basemap and desired outputs. Inspect source metadata and real field types and values, construct an attribute or supported spatial filter, select a compatible renderer, then build a [map-v1](https://gismap.online/schemas/map-v1.schema.json) specification. `sources.inspect`, `renderers.validate`, `mapSpec.validate`, and `mapSpec.createLink` are standalone utilities; `gisMapOnline.layers` and `mapSpec.load` need a running browser. `mapSpec.prepareVerification` reports offline checks, not a rendered map. Verify source, filter, features, renderer, camera and reopening. Return the actual link and disclose unperformed checks. PDF, QR and Smart Map PNG outputs depend on the applicable UI and export support; a PDF is static, and Smart Map PNG embeds configuration, not all remote data. Keep the original PNG because image processing may strip metadata. See the [corn map example](https://gismap.online/examples/ai/corn-sales-one-link/) and [map spec](map-spec.md).

<a id="interactive-briefing"></a>

## interactive-briefing — map-based briefing

**Prompt:** “Create slides about these districts.” **Inputs:** primary layer, stable feature IDs or selection, slide order, supporting layers, narratives, and desired outputs. Use [briefing-v1](https://gismap.online/schemas/briefing-v1.schema.json) and the documented `briefing` and `mapSpec` namespaces. Validate slide references and verify each slide's camera, selection and narrative in the browser. Verify spatial relationships with an actual supported query; an overlay alone does not establish containment, and sample counts are not complete counts. Test desktop/mobile navigation and link reopening, and inspect any requested PDF. See the [Philadelphia briefing](https://gismap.online/examples/ai/philadelphia-police-divisions/) (boundaries, not crime counts), [ballparks spatial briefing](https://gismap.online/examples/ai/mlb-ballparks-by-state/) and [briefing reference](briefs.md).

<a id="geographic-tour"></a>

## geographic-tour — ordered geographic tour

**Prompt:** “Show me these locations in sequence.” **Inputs:** title, ordered verified locations, descriptions, basemap and optional cameras or duration. Resolve ambiguous places, retain the user's order, and use the guided-tour workflow and its supported link format. A camera flyover is not road routing and does not establish travel time. Verify every stop, transition, basemap, progression and reopening. The [ballparks tour](https://gismap.online/examples/tours/classic-ballparks/) supplies an actual example and link recipe; camera-only tour links do not carry data layers. See [tours](tours.md).

<a id="field-tasks"></a>

## field-tasks — location-based fieldwork

**Prompt:** “Inspect this location and complete these tasks.” **Inputs:** verified location, task title, instructions, requested tasks and evidence. When five tasks are requested, retain all five; for larger requests preserve every task and report how batches relate. Use the existing Field Tasks workflow rather than inventing a batch or hosted authoring API. A task and its steps are not necessarily five independently persisted tasks; disclose model limits. Check the location and task/step content, mobile workflow and reopened assignment. A check-in, photo or returned report is participant evidence, not independently verified completion. The [opening-day assignment and sample report](https://gismap.online/examples/field-tasks/opening-day-wayfinding/) show the current link workflow; never present the sample as real completed work. See [field tasks](field-tasks.md).

<a id="3d-extrusion"></a>

## 3d-extrusion — 3D extruded map

**Prompt:** “Make the county heights represent acreage.” **Inputs:** polygon source, verified numeric field or fixed height, height scaling and units, colors, engine and 3D camera. Inspect geometry, field type, nulls, sentinels, negatives and outliers. Use only the actual engine's supported renderer and 3D settings; do not invent a portable field or assume source units are meters. Verify visible heights and camera in the selected engine, and test whether the shared artifact restores them. Clearly report unsupported settings or dropped height configuration. See [styling and 3D](map-styling.md) and the [3D examples](https://gismap.online/examples/air-quality-pm25-3d-columns/).

<a id="vibe-map"></a>

## vibe-map — coordinated themed map

**Prompt:** “Make the map feel like Halloween in California.” **Inputs:** dataset, geography, subject, intended audience, desired mood, preferred colors and engine. Plan the application skin, basemap colors and data renderer separately, choose readable contrasting colors and distinguish user-provided or official colors from inspired ones. Apply only supported settings and warn if a basemap cannot be recolored. Verify text contrast, legend, rendered colors and persistence on reopening; do not promise that an arbitrary custom theme is portable. Consult [capabilities](https://gismap.online/api/capabilities.json) and [styling](map-styling.md).

## Compose recipes and report evidence

For “a 3D map of California grape production using autumn colors, a five-slide briefing and a QR code,” combine `interactive-map`, `3d-extrusion`, `vibe-map` and `interactive-briefing` in one consistent project. Inspect the real acreage fields and values, validate the map and briefing, apply only compatible engine and theme settings, build five slides, then generate the QR using a supported workflow. Reopen and check the map, heights, theme and slides and scan the QR where possible. A QR code may open the interactive artifact; it does not itself prove the artifact works. State any unsupported output or unavailable verification.

Use **prepared** for a constructed artifact, **validated** for accepted static checks, **loaded** for observed loaded layers, **rendered** for observed visual output, and **verified** only for the intended behavior and reopened artifact actually checked. Also report partial or failed outcomes, warnings, errors, missing capabilities and source provenance. Never claim a later stage solely because a URL was generated.
