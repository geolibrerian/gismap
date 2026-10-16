// Worked examples for chatbots and AI agents (/examples/ai/), as data, so the
// web pages and llms-full.txt say the same thing. Every link, briefing and map
// spec here was opened in GIS Map Online and checked slide by slide; the
// committed files beside each page (link.txt, map.json, briefing.json, qr.png)
// are what the pages offer, and tests/ai-examples.test.mjs keeps them in step.
import { CORN_LINK, CORN_SPEC, CORN_URL } from "./agent-docs.mjs";

const SITE = "https://gismap.online";
const PHILLY_DIVISIONS = "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Philadelphia_Crime_Map_WFL1/FeatureServer/1";
const STATES = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/USA_States_Generalized_Boundaries/FeatureServer/0";
const BALLPARKS = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Major_League_Baseball_Stadiums/FeatureServer/0";

export const AI_EXAMPLES = Object.freeze([
  {
    slug: "philadelphia-police-divisions",
    openLabel: "Present the finished briefing",
    title: "A seven-slide briefing from one chatbot prompt",
    short: "Philadelphia police divisions briefing",
    kind: "Chatbot",
    eyebrow: "Chatbot · briefing link and QR code",
    description: "A chatbot turned one public ArcGIS layer into a seven-slide interactive briefing of Philadelphia's police divisions, shared as one link and a QR code.",
    intro: "This briefing came from a single prompt to a chatbot that can run code. It found the right layer, wrote seven slides with map views and captions, and returned a link and a QR code that open the whole presentation. No account, server or desktop GIS was involved.",
    shows: [
      "A briefing document (slides, map views, captions, a key number) written by a model and opened from a link",
      "A slides-only link: ?layer= loads the data, #briefing= carries the slides",
      "A QR code that opens the exact same presentation on a phone",
      "Honest framing: division boundaries, not crime statistics",
    ],
    linkFile: "link.txt",
    files: [{ label: "Briefing document (JSON)", file: "briefing.json" }],
    qr: { file: "qr.png", caption: "Scan to present the seven slides on a phone." },
    chat: {
      intro: "Paste this into a chatbot that can run code (so it can compress the briefing into a link). It names the layer, the slides, what not to load and what not to claim.",
      prompt: `Use GISMap.online to make a seven-slide interactive briefing from the Philadelphia Police Divisions polygon layer at ${PHILLY_DIVISIONS}. Include a title slide; a citywide view; North/Northeast, Center City and West/Southwest views; a slide explaining the DIV_NAME field; and a slide about the source and its limitations. Load only the Police_Divisions layer, not the crime incident points (layer 0). Follow the briefing schema at ${SITE}/schemas/briefing-v1.schema.json and the guide at ${SITE}/guides/ai-agents/. Output a GISMap briefing link, the editable briefing JSON, and a QR code that opens the same link. Do not invent crime totals or imply the boundaries are current.`,
    },
    agent: {
      heading: "For a code-running agent",
      intro: "An agent with Node, Deno or a browser can skip the chat and build the same link with the GISMap core: validate the briefing document, then make the slides-only link with the layer in its query string.",
      lang: "js",
      code: `import { briefing } from "https://gismap.online/js/gismap-core.js";

const LAYER = "${PHILLY_DIVISIONS}";
const doc = await (await fetch("https://gismap.online/examples/ai/philadelphia-police-divisions/briefing.json")).json();

const { valid, issues } = briefing.validate(doc);    // check before sharing
const url = await briefing.createLink({
  baseUrl: \`https://gismap.online/?layer=\${encodeURIComponent(LAYER)}\`, // the layer travels in the query string
  briefing: doc,
  qrSafe: true,                                      // fails if the link is too long for a QR code
});`,
    },
    caveats: [
      "The layer shows police division boundaries, not reported crime. No slide shows crime rates or incident counts.",
      "The source layer was last edited on September 22, 2021; check for newer boundaries before operational use.",
      "The slides-only link is long (about 1,700 characters); print the QR code large and test it on a phone first.",
    ],
    sources: [{ label: "Police_Divisions (layer 1), Philadelphia_Crime_Map_WFL1", url: PHILLY_DIVISIONS }],
  },
  {
    slug: "mlb-ballparks-by-state",
    openLabel: "Present the finished briefing",
    title: "A two-layer briefing with spatial queries, built by an agent",
    short: "Major League ballparks by state",
    kind: "AI agent",
    eyebrow: "AI agent · two layers · spatial relationships",
    description: "An AI agent built a ten-slide briefing that shows each state with only the Major League ballparks inside it, using a spatial query per slide, an automatic style and cut transitions.",
    intro: "U.S. states are the briefing's main layer; Major League ballparks are a second layer. On each state slide the ballparks layer is limited to the ballparks the state contains, answered by the ballparks service itself. The agent checked those answers before writing the slides, and found two places where geography needed care.",
    shows: [
      "Other layers on each slide: the ballparks are shown with the states and limited per slide",
      "Spatial relationships as the ArcGIS REST API defines them (contains), with a distance where needed",
      "\"method\": \"auto\": the states' population density classes are chosen from the data",
      "\"transition\": \"cut\": slides jump between states instead of flying across the country",
      "A whole map and briefing in one map-v1 spec, opened from one link or QR code",
    ],
    linkFile: "link.txt",
    files: [{ label: "Map spec with the briefing (JSON)", file: "map.json" }],
    qr: { file: "qr.png", caption: "Scan to present the ten slides on a phone." },
    chat: {
      intro: "The same request to a chatbot that can run code:",
      prompt: `Make a GISMap.online briefing of Major League ballparks by state. Main layer: ${STATES} (shade POP_SQMI as a choropleth with method "auto"). Second layer: ${BALLPARKS} (colour by LEAGUE). Add a title slide, one feature slide for each state with two or more teams, and a closing "how this was built" slide. On each state slide show only the ballparks the state contains (slide layers with relation type "contains"); use transition "cut". Before writing the slides, query the ballparks service with each state's geometry and compare the result with each ballpark's STATE field; fix any mismatch and say how. Put it all in one map-v1 spec (${SITE}/schemas/map-v1.schema.json) and return the link and a QR code.`,
    },
    agent: {
      heading: "For an AI agent: check the relationship, then write the spec",
      intro: "The agent asked the ballparks service the same question each slide will ask, before relying on it. Ohio's generalized outline leaves Cincinnati's ballpark (on the Ohio River, the state line) in Kentucky, so the Ohio slide grows Ohio by 1 mile; growing Illinois the same way would wrongly pick up St. Louis's Busch Stadium across the Mississippi, so only Ohio is grown.",
      lang: "js",
      code: `import { mapSpec } from "https://gismap.online/js/gismap-core.js";

const STATES = "${STATES}";
const PARKS = "${BALLPARKS}";

// The same query a slide runs: which ballparks does this state contain?
async function ballparksIn(stateId, miles = 0) {
  const state = await (await fetch(\`\${STATES}/query?objectIds=\${stateId}&returnGeometry=true&f=json\`)).json();
  const body = new URLSearchParams({
    geometry: JSON.stringify(state.features[0].geometry), geometryType: "esriGeometryPolygon",
    inSR: JSON.stringify(state.spatialReference), spatialRel: "esriSpatialRelContains",
    outFields: "NAME,STATE", returnGeometry: "false", f: "json",
    ...(miles ? { distance: String(miles), units: "esriSRUnit_StatuteMile" } : {}),
  });
  const result = await (await fetch(\`\${PARKS}/query\`, { method: "POST", body })).json();
  return result.features.map((feature) => feature.attributes.NAME);
}
await ballparksIn(36);    // Ohio: ["Progressive Field"], Cincinnati's park is missing
await ballparksIn(36, 1); // Ohio grown by 1 mile: both Ohio ballparks
await ballparksIn(14, 1); // Illinois grown by 1 mile: also Busch Stadium (Missouri), so don't

// Two layers, and slides that limit the ballparks per state (see map.json).
const spec = await (await fetch("https://gismap.online/examples/ai/mlb-ballparks-by-state/map.json")).json();
const { valid, issues } = mapSpec.validate(spec);
const { url, qr } = await mapSpec.createLink(spec); // compressed #map= link; qr: true when it fits a QR code`,
      after: "Each state slide's layer setting is one line of the spec:",
      extra: { lang: "json", code: JSON.stringify({ layers: [{ layer: BALLPARKS, visible: true, relation: { type: "contains", distance: 1, units: "miles" } }] }, null, 2) },
    },
    caveats: [
      "Rogers Centre (Toronto Blue Jays) is in Canada, so no state slide shows it.",
      "Public data has small errors (this source spells Chase Field's city \"Phoeniz\"); check a field before quoting it on a slide.",
      "State outlines are generalized; spatial answers near rivers and coasts are worth checking, as above.",
      "Ballpark data last edited May 30, 2025.",
    ],
    sources: [
      { label: "USA States Generalized Boundaries", url: STATES },
      { label: "Major League Baseball Stadiums", url: BALLPARKS },
    ],
  },
  {
    slug: "corn-sales-one-link",
    openLabel: "Open the finished map",
    title: "A styled map in one link, written by a chatbot",
    short: "U.S. corn sales by county",
    kind: "Chatbot",
    eyebrow: "Chatbot · no code · readable link",
    description: "Any chatbot, even one that cannot run code, can make a styled county map by writing one JSON object into a link: corn sales by county, with \"Not Disclosed\" counties kept out of the colour classes.",
    intro: "The whole map is one JSON object after #map=json: in the address. A model that can only write text can produce it; GIS Map Online validates it, opens whatever is valid and lists anything it skipped. Two details make the map honest: -1 means \"Not Disclosed\" in this data, so it is excluded, and \"method\": \"auto\" lets the app choose class breaks that suit the skewed values.",
    shows: [
      "A readable #map=json: link that a chat-only model can write by hand",
      "\"exclude\": [-1]: the publisher's \"Not Disclosed\" code is drawn as No data instead of distorting the classes",
      "\"method\": \"auto\": the app picks quantile classes because corn sales are heavily skewed",
    ],
    link: CORN_LINK,
    files: [{ label: "Map spec (JSON)", file: "map.json" }],
    qr: { file: "qr.png", caption: "Scan to open the map on a phone." },
    chat: {
      intro: "This works in any chatbot, with or without tools:",
      prompt: `Make a GIS Map Online link for U.S. corn sales by county. The layer is ${CORN_URL}; look at its fields with ?f=pjson and use CORN_SALES_IN_DOLLARS. Write a map-v1 spec (${SITE}/schemas/map-v1.schema.json) with a choropleth renderer, ramp "greens", method "auto" and a gray basemap. The publisher codes undisclosed counties as -1, so exclude -1. URI-encode the JSON and put it after ${SITE}/#map=json: and give me the link.`,
    },
    agent: {
      heading: "For a code-running agent",
      intro: "An agent can find the -1 code itself instead of being told: sources.inspect reads the publisher's own style and reports it as a sentinel.",
      lang: "js",
      code: `import { sources, mapSpec } from "https://gismap.online/js/gismap-core.js";

const url = "${CORN_URL}";
const meta = await sources.inspect(url);
const exclude = meta.sentinels.filter((code) => code.field === "CORN_SALES_IN_DOLLARS" && code.source !== "heuristic").map((code) => code.value); // [-1]
const spec = { version: 1, basemap: "gray-vector", layers: [{ url, renderer: { type: "choropleth", field: "CORN_SALES_IN_DOLLARS", method: "auto", ramp: "greens", exclude } }] };
const { valid } = mapSpec.validate(spec);
const { url: link } = await mapSpec.createLink(spec, { compress: false }); // the readable #map=json: form`,
    },
    caveats: [
      "546 of 3,074 counties are \"Not Disclosed\" (-1); they appear grey, as No data.",
      "Corn sales data last edited in August 2022.",
      "The layer hides itself when zoomed in past 1:144,447; add \"ignoreServiceScaleRange\": true to draw it at every zoom.",
    ],
    sources: [{ label: "Corn (USDA Census of Agriculture), Esri Living Atlas", url: CORN_URL }],
  },
]);

export const aiExamplePath = (example) => `/examples/ai/${example.slug}/`;

/** The finished link of each example: written inline, or read from its committed link.txt. */
export async function aiExampleLinks(readText) {
  const links = {};
  for (const example of AI_EXAMPLES) {
    links[example.slug] = example.link || (await readText(`examples/ai/${example.slug}/${example.linkFile}`)).trim();
  }
  return links;
}

export function aiExamplesMarkdown(links) {
  return AI_EXAMPLES.map((example) => [
    `### ${example.title}`,
    `${example.kind}. ${example.description}`,
    `Open it: ${links[example.slug]}`,
    `Page: ${SITE}${aiExamplePath(example)}`,
    "What it shows:",
    example.shows.map((item) => `- ${item}`).join("\n"),
    `Prompt for a chatbot:\n\n> ${example.chat.prompt}`,
    `${example.agent.heading}: ${example.agent.intro}`,
    `\`\`\`${example.agent.lang}\n${example.agent.code}\n\`\`\``,
    "Caveats:",
    example.caveats.map((item) => `- ${item}`).join("\n"),
  ].join("\n\n")).join("\n\n");
}

// Kept as an export for tests: the corn example is the documented worked example.
export const CORN_EXAMPLE_SPEC = CORN_SPEC;
