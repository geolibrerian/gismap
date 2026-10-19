# Discoverability baseline and next steps

Repository audit: 2026-10-19, based on `main`. This describes repository contents, not proof of production indexing, crawler access, or search recommendations.

## Existing foundation

- The viewer has readable initial HTML, a canonical URL, description and SoftwareApplication/WebApplication JSON-LD. JavaScript and WebGL are needed for the interactive map.
- `/examples/`, `/guides/`, the viewer guides and AI examples are generated static HTML, with semantic landmarks, canonical URLs and page/breadcrumb JSON-LD. `scripts/site-outputs.mjs` is authoritative for these generated pages and the sitemap; `scripts/agent-docs.mjs` generates agent documentation.
- `robots.txt` already allowed all crawlers. Agent documentation, schemas, `/skills/`, `/api/capabilities.json`, `/api/manifest.json` and `/api/explorer/` exist in the repository. These are browser/client-side resources, not a hosted map-creation API.
- The main document includes accessible names for several symbol-only map and panel controls; this is not a complete accessibility-tree or keyboard audit. Existing browser-specific widget controls and dynamically generated controls still need testing.

## Changes in this pass

The FeatureServer, GeoJSON and 3D guides have direct answers and realistic limitations in their initial HTML. The viewer and generated agent summary use a clearer product definition. The AI connection guide now points to Tools → Connect to AI. The sitemap includes the skills and API explorer, and no longer assigns an unverified blanket update date. Explicit search crawler groups retain the existing public access policy; this does not change training crawler permissions or bypass Cloudflare controls. A local CI test checks targeted metadata and JSON-LD, sitemap targets, linked local paths, and crawler declarations. Generated content remains checked by the existing build verification.

## Outstanding, in priority order

1. Verify production status codes, canonical redirects, 404 status, sitemap and static resources from an external network. The web reader could not access the live site during this audit; no inference about Cloudflare configuration or blocking is possible. Check verified bot traffic and firewall rules in Cloudflare without relaxing protections or trusting user-agent alone.
2. Run automated and manual accessibility and keyboard tests across desktop and mobile, both engines, dialogs, dynamically generated layer controls and map widgets. The static tests added here are not an accessibility certification.
3. Reproduce the FeatureServer, GeoJSON and 3D example links against their publishers, then build more substantive PMTiles, GeoParquet, sharing and briefing guides as their behaviors are verified. Public service availability and licensing can change.
4. Confirm the live manifest and documented actions match the deployed build; test end-to-end external agent map and briefing workflows. Record actual pass/fail results, not inferred success.
5. Measure indexing, verified search-crawler access, referrals where available and completed artifact workflows separately. Bot hits do not establish recommendation, attribution, or successful map creation. Baseline anonymous-agent recommendations require independent observations.

Avoid fabricated reviews or dates, broad promises about all data formats and map engines, and changes made solely to appear fresh. Search policies and indexing are controlled by providers, not guaranteed by these changes.
