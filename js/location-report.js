// Location reports: a PDF about one place, in fixed sections. The app writes the
// sections that come from the map (location, the data at the place, sources, the
// map and its links); an AI or an agent writes the ones that need reading the data
// and general knowledge (summary, inferences, context, next steps). Limitations
// come from both. Every source of report text (the in-app AI, the in-page API, a
// map link's "report") fills the same sections, so reports read the same way.
import { PdfDocument, SITE_URL } from "./pdf-document.js?v=0.83.0-infographics";

export const LOCATION_REPORT_VERSION = 1;

/**
 * The report's sections, in order. `source` says who writes it: "data" (the app,
 * from the map), "inference" (the AI or agent) or "both". `kind` is the shape an
 * author supplies: "text", "list", or "app" for sections only the app writes.
 */
export const LOCATION_REPORT_SECTIONS = Object.freeze([
  { id: "summary", title: "Summary", source: "inference", kind: "text", guidance: "Two to four sentences: the main finding first, citing the values it rests on." },
  { id: "location", title: "Location", source: "data", kind: "app", guidance: "Address, coordinates, census geography and map extent, from the geocoder and the map." },
  { id: "observations", title: "What the map data shows", source: "both", kind: "text", guidance: "The app lists each layer's features at the place with their attributes. Optional text explains what the values mean, citing layer names and exact values." },
  { id: "inferences", title: "Inferences from the layers together", source: "inference", kind: "list", guidance: "Conclusions that need two or more layers, or the data plus general knowledge. Each names its basis (layer names) and a confidence: high, medium or low." },
  { id: "context", title: "Geographic context", source: "inference", kind: "text", guidance: "General knowledge about the place: setting, history, land use, hazards. Not map data; no claims about current conditions." },
  { id: "limitations", title: "Limitations", source: "both", kind: "list", guidance: "What the data cannot show or settle. The app adds its own caveats, such as layers read only in part." },
  { id: "nextSteps", title: "Suggested next steps", source: "inference", kind: "list", guidance: "Optional: layers, field checks or analyses that would settle open questions." },
  { id: "sources", title: "Sources", source: "data", kind: "app", guidance: "Each map layer's title and source address." },
  { id: "map", title: "Map", source: "data", kind: "app", guidance: "A full landscape page with a snapshot of the map that opens the whole map with its layers, and a link to this place." },
]);

const SECTION = Object.fromEntries(LOCATION_REPORT_SECTIONS.map((section) => [section.id, section]));
/** Sections an author (AI, agent or link) may write. */
export const AUTHORED_SECTIONS = Object.freeze(LOCATION_REPORT_SECTIONS.filter((section) => section.kind !== "app").map((section) => section.id));
export const CONFIDENCE_LEVELS = Object.freeze(["high", "medium", "low"]);

const LIMITS = { title: 160, text: 4000, summary: 1200, item: 600, items: 12, basis: 8 };
const clip = (value, max) => String(value ?? "").replace(/\s+\n/g, "\n").trim().slice(0, max);

/**
 * A report as an author supplies it, checked and trimmed:
 * { version: 1, title?, at?: [longitude, latitude], author?, sections: { summary, observations, inferences, context, limitations, nextSteps } }.
 * `inferences` items are { statement, basis: [layer names], confidence } or plain strings.
 * Returns { report, issues: [{ path, message }] }; nothing is thrown for bad parts, they are left out.
 */
export function normalizeLocationReport(input = {}) {
  const issues = [];
  const source = input && typeof input === "object" ? input : {};
  const report = { version: LOCATION_REPORT_VERSION, sections: {} };
  if (source.title) report.title = clip(source.title, LIMITS.title);
  if (source.author) report.author = clip(source.author, 120);
  if (source.at !== undefined) {
    const [longitude, latitude] = Array.isArray(source.at) ? source.at.map(Number) : [];
    if (Number.isFinite(longitude) && Number.isFinite(latitude) && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90) report.at = [longitude, latitude];
    else issues.push({ path: "at", message: "at must be [longitude, latitude] in degrees." });
  }
  const sections = source.sections && typeof source.sections === "object" ? source.sections : {};
  for (const [id, value] of Object.entries(sections)) {
    const section = SECTION[id];
    if (!section) { issues.push({ path: `sections.${id}`, message: `Unknown section. Authored sections: ${AUTHORED_SECTIONS.join(", ")}.` }); continue; }
    if (section.kind === "app") { issues.push({ path: `sections.${id}`, message: `${section.title} is written by the app from the map; it was ignored.` }); continue; }
    if (section.kind === "text") {
      const text = clip(Array.isArray(value) ? value.join("\n") : value, id === "summary" ? LIMITS.summary : LIMITS.text);
      if (text) report.sections[id] = text;
      continue;
    }
    const items = (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== undefined && item !== "");
    if (items.length > LIMITS.items) issues.push({ path: `sections.${id}`, message: `Only the first ${LIMITS.items} items are kept.` });
    const list = items.slice(0, LIMITS.items).map((item, index) => (id === "inferences" ? inference(item, `sections.${id}[${index}]`, issues) : clip(typeof item === "object" ? item.statement ?? item.text : item, LIMITS.item))).filter(Boolean);
    if (list.length) report.sections[id] = list;
  }
  return { report, issues };
}

function inference(item, path, issues) {
  const value = typeof item === "object" ? item : { statement: item };
  const statement = clip(value.statement ?? value.text, LIMITS.item);
  if (!statement) { issues.push({ path, message: "An inference needs a statement." }); return null; }
  const basis = (Array.isArray(value.basis) ? value.basis : value.basis ? [value.basis] : []).map((name) => clip(name, 160)).filter(Boolean).slice(0, LIMITS.basis);
  const confidence = String(value.confidence || "").toLowerCase();
  if (confidence && !CONFIDENCE_LEVELS.includes(confidence)) issues.push({ path: `${path}.confidence`, message: `Confidence is one of ${CONFIDENCE_LEVELS.join(", ")}.` });
  return { statement, ...(basis.length ? { basis } : {}), ...(CONFIDENCE_LEVELS.includes(confidence) ? { confidence } : {}) };
}

// Headings an AI may use for each authored section, in its own words.
const HEADING_ALIASES = {
  summary: /^(summary|overview|key findings?|in brief|executive summary)$/,
  observations: /^(what the (map )?data shows|map data|observations|data observations|selected features?( analysis)?|what the layers show)$/,
  inferences: /^(inferences?( from the layers( together)?)?|combined (analysis|findings)|key observations( (and|&) patterns)?|patterns|interpretation)$/,
  context: /^(geographic context|context|useful geographic context|background|general knowledge|location context)$/,
  limitations: /^(limitations|important limitations|caveats|data limitations|uncertainties)$/,
  nextSteps: /^((suggested )?next steps|recommendations|further work|follow[- ]?ups?)$/,
};
// The closing offer of a chat reply ("Would you like me to…") is conversation, not report text.
const CHAT_OFFER = /^(would you like|do you want|shall i|let me know|i can also|if you('d| would) like)/i;

/**
 * Reads an AI answer written with the report's section headings (Markdown "##" or
 * bold lines) into { sections }. Inference bullets may end "(Basis: A, B; Confidence: medium)".
 * Text before the first heading becomes the summary when there is no Summary heading.
 */
export function parseReportMarkdown(text) {
  const sections = {};
  let current = "summary";
  const buckets = new Map();
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (/^-{3,}$|^\*{3,}$/.test(line)) continue;
    const heading = line.match(/^#{1,4}\s+(.+?)\s*#*$/) || line.match(/^\*\*(.+?)\*\*:?$/);
    if (heading) {
      const name = heading[1].replace(/[*_:`]/g, "").replace(/^\d+[.)]\s*/, "").trim().toLowerCase();
      const id = Object.keys(HEADING_ALIASES).find((key) => HEADING_ALIASES[key].test(name));
      if (id) { current = id; continue; }
      if (CHAT_OFFER.test(name)) { current = null; continue; }
    }
    if (CHAT_OFFER.test(line)) { current = null; continue; }
    if (!current) continue;
    if (!buckets.has(current)) buckets.set(current, []);
    buckets.get(current).push(raw);
  }
  for (const [id, chunk] of buckets) {
    const body = chunk.join("\n").trim();
    if (!body) continue;
    if (SECTION[id].kind === "text") sections[id] = plainText(body);
    else {
      const items = listItems(body);
      sections[id] = id === "inferences" ? items.map(parseInference) : items;
    }
  }
  return { sections };
}

function listItems(body) {
  const items = [];
  for (const line of body.split("\n")) {
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (bullet) items.push(plainText(bullet[1]));
    else if (line.trim() && items.length && /^\s{2,}/.test(line)) items[items.length - 1] += ` ${plainText(line)}`;
    else if (line.trim()) items.push(plainText(line));
  }
  return items.filter(Boolean);
}

function parseInference(text) {
  const tail = text.match(/\s*[([]?\s*basis:\s*([^;)\]]+?)\s*(?:[;,]\s*confidence:\s*(high|medium|low))?\s*[)\]]?\s*\.?$/i)
    || text.match(/\s*[([]?\s*confidence:\s*(high|medium|low)\s*[)\]]?\s*\.?$/i);
  if (!tail) return { statement: text };
  const statement = text.slice(0, tail.index).trim().replace(/[\s—–-]+$/, "");
  if (/^basis/i.test(tail[0].replace(/^[\s([]+/, ""))) {
    return { statement, basis: tail[1].split(/\s*,\s*|\s+and\s+/).filter(Boolean), ...(tail[2] ? { confidence: tail[2].toLowerCase() } : {}) };
  }
  return { statement, confidence: tail[1].toLowerCase() };
}

/** Markdown emphasis, code and links reduced to their words. */
export function plainText(markdown) {
  return String(markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2").replace(/(\*|_)(\S.*?\S|\S)\1/g, "$2")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The instruction for an AI writing a report from the map context: the sections,
 * what goes in each, and how map evidence and general knowledge stay apart.
 */
export function locationReportPrompt({ question = "" } = {}) {
  const authored = LOCATION_REPORT_SECTIONS.filter((section) => section.kind !== "app");
  return [
    "Write a location report about the clicked place from the map context.",
    question ? `The reader's question: ${question}` : "",
    "Use exactly these Markdown headings, in this order, and nothing before the first or after the last:",
    ...authored.map((section) => `## ${section.title}\n${section.guidance}`),
    "Rules:",
    "- Map evidence first: quote layer names and exact attribute values; never invent attributes or values.",
    "- Read field names for what they measure. A count of points, dots or records is not a count of people unless the field says so; density fields are per unit area as named (for hexagon bins, density_km2 is points per square kilometre, and people come from a sum such as represents_sum).",
    "- Write each inference as one bullet ending with (Basis: layer names; Confidence: high, medium or low).",
    "- Geographic context is general knowledge: keep it to well-established facts about the area, and say so when unsure. Do not state current conditions, recent events or exact figures that the map does not show.",
    "- The app adds the location, attribute tables, sources and map links itself; do not repeat them.",
    "- No offers, questions or chat at the end.",
  ].filter(Boolean).join("\n");
}

/**
 * The identified features that are really at `[longitude, latitude]`: polygons that contain it,
 * and every point or line hit (they are found within a few pixels). Polygons whose geometry
 * cannot be read are kept. When no polygon contains the place, the hits are returned unchanged.
 */
export function featuresAtPlace(results = [], [longitude, latitude] = []) {
  const kept = results.filter((result) => {
    const rings = polygonRings(result.geometry, [longitude, latitude]);
    return rings === null || rings.some((polygon) => containsPoint(polygon, rings.point));
  });
  return kept.length ? kept : results;
}

const MERCATOR = new Set([102100, 102113, 3857, 900913]);
// Polygons as [[outer, ...holes]], with the place in the same coordinates; null for non-polygons.
function polygonRings(geometry, point) {
  if (!geometry) return null;
  let polygons = null;
  let place = point;
  if (geometry.type === "Polygon") polygons = [geometry.coordinates];
  else if (geometry.type === "MultiPolygon") polygons = geometry.coordinates;
  else if (Array.isArray(geometry.rings)) {
    // ArcGIS rings: outer rings clockwise, holes counter-clockwise; treat each outer as a polygon.
    polygons = [];
    for (const ring of geometry.rings) {
      if (signedArea(ring) <= 0 || !polygons.length) polygons.push([ring]);
      else polygons[polygons.length - 1].push(ring);
    }
    const wkid = geometry.spatialReference?.latestWkid ?? geometry.spatialReference?.wkid;
    if (MERCATOR.has(wkid)) place = [point[0] * 20037508.34 / 180, Math.log(Math.tan((90 + point[1]) * Math.PI / 360)) * 6378137];
  }
  if (!polygons) return null;
  return Object.assign(polygons, { point: place });
}

const signedArea = (ring) => ring.reduce((sum, [x1, y1], index) => { const [x2, y2] = ring[(index + 1) % ring.length]; return sum + (x1 * y2 - x2 * y1); }, 0) / 2;

function containsPoint([outer, ...holes], point) {
  return inRing(outer, point) && !holes.some((hole) => inRing(hole, point));
}

function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Caveats the app knows from the data itself: nothing found, layers read in part, coded values. */
export function automaticLimitations({ features = [], layers = [], partialLink = false } = {}) {
  const notes = [];
  if (!features.length) notes.push("No map feature was found at this place; the report rests on the location alone.");
  if (partialLink) notes.push("The map link does not carry layers made in the browser (such as hexagons or dots); it reopens the layers they were made from.");
  for (const layer of layers) {
    if (layer.truncated) notes.push(`${layer.title}: the map holds only part of this layer, so features outside it are not reflected.`);
    if (layer.sentinels?.length) notes.push(`${layer.title}: some values are codes (such as ${layer.sentinels[0].value} = ${layer.sentinels[0].label}), not measurements.`);
  }
  return notes;
}

const attributeValue = (value) => (typeof value === "number" ? (Number.isInteger(value) ? value.toLocaleString("en-US") : Number(value.toPrecision(6)).toLocaleString("en-US", { maximumFractionDigits: 4 })) : typeof value === "object" ? JSON.stringify(value) : String(value));

/**
 * The report as a PDF (Blob). `place` is { longitude, latitude, address, geographies: [{ label, value }] };
 * `features` are identified features { layerTitle, attributes }; `layers` are { title, url, truncated, sentinels, note };
 * `links` are { map, place } URLs (`partial` when the map link leaves out layers made in the browser); `mapImage` and `logo` are PDF image assets.
 * `geo` is the extent { west, south, east, north } of a flat, north-up `mapImage`, which georeferences its page.
 */
export function buildLocationReportPdf({ report = { sections: {} }, place = {}, features = [], layers = [], links = {}, mapImage = null, logo = null, extent = null, geo = null, generatedAt = new Date() } = {}) {
  const pdf = new PdfDocument({ heading: "LOCATION INTELLIGENCE REPORT", logo });
  const colors = pdf.colors;
  const sections = report.sections || {};
  const coordinates = Number.isFinite(place.latitude) ? `${place.latitude.toFixed(6)}, ${place.longitude.toFixed(6)}` : null;
  const heading = (id) => { pdf.gap(10); pdf.heading2(SECTION[id].title); };
  const note = (text) => pdf.addLines(text, { size: 8.5, leading: 13, color: colors.muted });
  const body = (text) => pdf.addLines(text, { size: 10, leading: 15 });
  const bullets = (items) => items.forEach((item) => pdf.addLines(`- ${item}`, { size: 10, leading: 15 }));
  const authored = Boolean(report.author);

  pdf.addLines(report.title || place.address || coordinates || "Location report", { size: 15, leading: 20, bold: true });
  pdf.addLines(`Generated ${generatedAt.toLocaleString()}${authored ? ` · Analysis by ${report.author}` : ""}`, { size: 9, leading: 14, color: colors.muted });
  if (links.map) pdf.addLines("Open this map in GISMap Online", { size: 10, leading: 15, link: links.map });

  if (sections.summary) { heading("summary"); body(sections.summary); }

  heading("location");
  if (place.address) pdf.addLines(place.address, { size: 11, leading: 16, bold: true });
  if (coordinates) pdf.addLines(`Coordinates: ${coordinates}`, { link: links.place || null });
  for (const { label, value } of place.geographies || []) pdf.addLines(`${label}: ${value}`, { size: 9.5, leading: 14 });
  if (extent) note(`Map extent: ${extent.west.toFixed(4)}, ${extent.south.toFixed(4)} to ${extent.east.toFixed(4)}, ${extent.north.toFixed(4)}${extent.zoom != null ? ` (zoom ${extent.zoom})` : ""}`);

  heading("observations");
  if (sections.observations) { body(sections.observations); pdf.gap(4); }
  if (!features.length) body("No map feature was found at this place.");
  features.slice(0, 8).forEach((feature) => {
    pdf.addLines(feature.layerTitle || "Feature", { size: 10.5, leading: 16, bold: true });
    const attributes = Object.entries(feature.attributes ?? {}).filter(([key, value]) => !key.startsWith("_") && value !== null && value !== "");
    attributes.slice(0, 24).forEach(([key, value]) => pdf.addLines(`${key}: ${attributeValue(value)}`, { size: 9.5, leading: 14 }));
    if (attributes.length > 24) note(`${attributes.length - 24} more attributes are in the map.`);
    pdf.gap(4);
  });
  if (features.length > 8) note(`${features.length - 8} more features at this place are in the map.`);

  if (sections.inferences?.length) {
    heading("inferences");
    note("Reasoned from the layers together and general knowledge; check before relying on them.");
    sections.inferences.forEach((item) => {
      pdf.addLines(`- ${item.statement}`, { size: 10, leading: 15 });
      const why = [item.basis?.length ? `Basis: ${item.basis.join(", ")}` : "", item.confidence ? `Confidence: ${item.confidence}` : ""].filter(Boolean).join(" · ");
      if (why) pdf.addLines(`  ${why}`, { size: 8.5, leading: 13, color: colors.muted });
    });
  }
  if (sections.context) {
    heading("context");
    note("General knowledge about the area, not map data.");
    body(sections.context);
  }
  const limitations = [...(sections.limitations || []), ...automaticLimitations({ features, layers, partialLink: links.partial })];
  if (limitations.length) { heading("limitations"); bullets(limitations); }
  if (sections.nextSteps?.length) { heading("nextSteps"); bullets(sections.nextSteps); }

  if (layers.length) {
    heading("sources");
    layers.forEach((layer) => {
      pdf.addLines(layer.title || "Layer", { size: 10, leading: 15, bold: true });
      if (/^https?:\/\//.test(layer.url || "")) pdf.addLines(layer.url, { size: 8.5, leading: 13, link: layer.url, maxChars: 110 });
      if (layer.note) note(layer.note);
    });
  }

  if (mapImage) {
    // The map gets a landscape page of its own, edge to edge, with a slim strip of links below it.
    const [width, height, edge, strip] = [792, 612, 18, 30];
    pdf.newPage({ width, height, header: false });
    pdf.addImageAt(mapImage, { x: edge, y: height - edge, width: width - edge * 2, height: height - edge * 2 - strip, link: links.map || links.place || null, border: "#cfd8d4", geo });
    const y = edge + 10;
    // One line in the strip: a long title is shortened.
    const caption = `${SECTION.map.title} · ${report.title || place.address || coordinates || "Location report"}`;
    pdf.addTextAt(caption.length > 62 ? `${caption.slice(0, 60).trimEnd()}…` : caption, { x: edge, y, width: 320, size: 9, color: colors.muted, bold: true, bottom: 0 });
    if (links.map) pdf.addTextAt("Open this map in GISMap Online", { x: 340, y, width: 170, size: 9, link: links.map, bottom: 0 });
    if (links.place) pdf.addTextAt("Open at this place", { x: 520, y, width: 100, size: 9, link: links.place, bottom: 0 });
    pdf.addTextAt("gismap.online", { x: width - edge - 62, y, width: 62, size: 9, bold: true, color: colors.accent, link: SITE_URL, bottom: 0 });
  } else if (links.map) {
    heading("map");
    pdf.addLines("Open this map in GISMap Online", { size: 10, leading: 15, link: links.map });
    if (links.place) pdf.addLines("Open GISMap Online at this place", { size: 10, leading: 15, link: links.place });
  }
  return pdf.toBlob();
}

/** A file name for a report about `place`. */
export function locationReportFileName(place = {}) {
  const name = String(place.address || (Number.isFinite(place.latitude) ? `${place.latitude.toFixed(4)} ${place.longitude.toFixed(4)}` : "map location"));
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "map-location";
  return `location-intelligence-report-${slug}.pdf`;
}
