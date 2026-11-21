# Location reports

A Location Intelligence Report is a PDF about one place, made from the layers on a map. It always has the same sections in the same order, so a reader knows where to look and an agent knows what to write.

## Sections

| # | Section | Written by | What goes in it |
| --- | --- | --- | --- |
| 1 | Summary | Agent or AI | Two to four sentences: the main finding first, citing the values it rests on. |
| 2 | Location | App | Address, coordinates, census geography and map extent, from the geocoder and the map. |
| 3 | What the map data shows | App, plus optional agent text | The app lists every visible layer's features at the place with their attributes. The agent may add text explaining what the values mean, quoting layer names and exact values. |
| 4 | Inferences from the layers together | Agent or AI | Conclusions that need two or more layers, or the data plus general knowledge. Each names its basis (layer names) and a confidence: `high`, `medium` or `low`. |
| 5 | Geographic context | Agent or AI | General knowledge about the area: setting, history, land use, hazards. Printed under "General knowledge about the area, not map data". |
| 6 | Limitations | Both | What the data cannot show. The app adds its own caveats: nothing found at the place, layers held only in part, coded values such as -1 = Not disclosed. |
| 7 | Suggested next steps | Agent or AI | Optional: layers, field checks or analyses that would settle open questions. |
| 8 | Sources | App | Each visible layer's title and source address. |
| 9 | Map | App | A snapshot of the map that links to the whole map with its layers, and a link to the place. |

Authored sections are `summary`, `observations`, `inferences`, `context`, `limitations` and `nextSteps`. `location`, `sources` and `map` are the app's: an authored value for them is ignored and reported. In a running page, `gisMapOnline.reports.sections()` returns this table as data.

## Writing the analysis

Read the layers before writing: query each one at the place (`<layer URL>/query?geometry=<lon>,<lat>&geometryType=esriGeometryPoint&inSR=4326&outFields=*&f=json`) and read its field descriptions.

- **Map evidence first.** Quote layer names and exact attribute values. Never invent attributes or values.
- **Read fields for what they measure.** A count of points, dots or records is not a count of people unless the field says so. In hexagon bins, `density_km2` is points per square kilometre and `point_count` is points; people come from a sum such as `represents_sum`.
- **Inferences combine.** Use the Inferences section for what no single layer says, for example population in a flood zone or growth beside farmland. Give each one its basis and an honest confidence.
- **Keep general knowledge separate.** It belongs in Geographic context and is limited to well-established facts. Don't state current conditions, recent events or exact figures the map does not show. Say so when unsure.
- **No chat.** Leave out greetings, questions and "Would you like me to…" offers.

## In a map link

Add `report` to a map-v1 spec. When the link opens, the map loads, the place is inspected as if clicked, and Intelligence shows a Location report card with **Download this report**. The viewer's browser adds the live data at the place and the map. Nothing is stored on a server.

```json
{"version":1,"title":"Central Oxnard population report","layers":[{"url":"<LAYER URL>","type":"feature"}],
 "report":{"type":"location","at":[-119.177,34.197],"title":"Central Oxnard","author":"Agent",
  "sections":{
   "summary":"…",
   "inferences":[{"statement":"…","basis":["Population per H3 cell"],"confidence":"medium"}],
   "context":"…",
   "limitations":["…"],
   "nextSteps":["…"]}}}
```

- `at` is required: `[longitude, latitude]` in degrees.
- Limits: the summary is up to 1,200 characters; other text sections 4,000. Lists hold up to 12 items of 600 characters, and an inference names up to 8 basis layers.
- Problems are reported as `INVALID_SPEC` warnings on `report.*` paths. The rest of the map still opens.

Worked example: the [location-report recipe](agent-recipes.md#location-report).

## In a running page

```js
await gisMapOnline.ready;
const { file, report, issues, links } = await gisMapOnline.reports.location({
  at: [-119.177, 34.197],
  report: { title: "Central Oxnard", author: "Agent", sections: { summary: "…", inferences: [ … ] } },
});
```

- `reports.location({ at, report, ai, download })` inspects the place, reads every visible layer's features there, and returns the PDF as a `File`.
  - `links.map` opens the whole map and `links.place` opens the place.
  - `ai: true` has the configured AI provider write the sections instead. It is prompted with `reports.prompt()` and the map context.
  - `download: true` also saves the file.
- `reports.validate(report)` returns `{ report, issues }` without making a PDF.
- `reports.prompt({ question })` is the instruction the in-app AI uses. Reuse it for your own model so its answer parses into the same sections.

## In the app

Click a place, then in Intelligence:

- **Download location report** makes the app's sections only.
- **Write report with AI** has the configured AI write the analysis sections first.
- **Download report** on an AI answer turns that answer into sections; its headings are matched to the sections above.
