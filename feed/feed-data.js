export const FEED_API = "https://api.gismap.si/api/v1/social";

const SENSITIVE_PARAMETER = /^(?:token|oauth[_-]?token|access[_-]?token|api[_-]?key|apikey|key|client[_-]?secret|password|passwd|pwd|authorization|auth|signature|sig)$/i;
const MAX_URL_LENGTH = 8192;
const GISMAP_HOSTS = new Set(["gismap.online", "www.gismap.online"]);
const TYPES = new Set(["map", "brief", "tour", "cinematic", "story"]);

export const DEVELOPMENT_POSTS = Object.freeze([
  {
    id: "fixture-historical-quakes",
    title: "Historical earthquakes, told as a map briefing",
    description: "A guided look at major earthquakes through time, built with a public USGS service.",
    post_type: "brief",
    source_url: "https://gismap.online/?briefingExample=historical-quakes&tutorial=1",
    location_label: "Worldwide",
    tags: ["earthquakes", "history", "hazards"],
    author: { display_name: "GISMap examples", handle: "gismapexamples" },
    source_name: "USGS Earthquake Hazards Program",
    published_at: "Development fixture",
    development_fixture: true,
  },
  {
    id: "fixture-classic-ballparks",
    title: "Classic ballparks: a guided tour",
    description: "A camera-led tour across a small collection of historic baseball places.",
    post_type: "tour",
    source_url: "https://gismap.online/examples/tours/classic-ballparks/",
    location_label: "United States",
    tags: ["sports", "places", "tour"],
    author: { display_name: "GISMap examples", handle: "gismapexamples" },
    source_name: "GISMap example collection",
    published_at: "Development fixture",
    development_fixture: true,
  },
  {
    id: "fixture-philly-divisions",
    title: "Philadelphia police divisions",
    description: "An interactive public-service map example with an inspectable source and shareable configuration.",
    post_type: "map",
    source_url: "https://gismap.online/examples/ai/philadelphia-police-divisions/",
    location_label: "Philadelphia, Pennsylvania",
    tags: ["civic", "boundaries", "ai-example"],
    author: { display_name: "GISMap examples", handle: "gismapexamples" },
    source_name: "City of Philadelphia",
    published_at: "Development fixture",
    development_fixture: true,
  },
]);

export function labelForType(type) {
  return ({ map: "Map", brief: "Brief", tour: "Tour", cinematic: "Cinematic", story: "Data story" })[type] || "Map";
}

function decodeJsonMap(hash) {
  const match = String(hash || "").match(/(?:^#|[&#])map=json:([^&]*)/i);
  if (!match?.[1]) return null;
  try { return JSON.parse(decodeURIComponent(match[1])); } catch { return null; }
}

function validatePublicReference(value) {
  let reference;
  try { reference = new URL(value); } catch { throw new Error("A referenced GISMap resource is not a valid URL."); }
  if (reference.protocol !== "https:" || reference.username || reference.password) throw new Error("Referenced GISMap resources must be public HTTPS URLs without credentials.");
  const sensitive = [...reference.searchParams.keys()].find((key) => SENSITIVE_PARAMETER.test(key));
  if (sensitive) throw new Error(`Remove the credential parameter “${sensitive}” before publishing.`);
}

function hasSensitiveObject(value) {
  if (Array.isArray(value)) return value.some(hasSensitiveObject);
  if (value && typeof value === "object") return Object.entries(value).some(([key, item]) => SENSITIVE_PARAMETER.test(key) || hasSensitiveObject(item));
  return false;
}

/**
 * Browser-side convenience validation. The SI API repeats these checks before
 * accepting anything; this function deliberately never fetches the URL.
 */
export function validateSmartMapUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) throw new Error("Paste a GISMap map, Brief, or Tour link.");
  if (raw.length > MAX_URL_LENGTH) throw new Error("This link is too long to publish. Export or host the artifact instead.");
  let url;
  try { url = new URL(raw); } catch { throw new Error("That is not a valid URL."); }
  if (url.protocol !== "https:") throw new Error("Feed links must use HTTPS.");
  if (!GISMAP_HOSTS.has(url.hostname.toLowerCase())) throw new Error("Phase 1 accepts public gismap.online links only.");
  if (url.username || url.password) throw new Error("A link with a username or password cannot be published.");
  const sensitive = [...url.searchParams.keys()].find((key) => SENSITIVE_PARAMETER.test(key));
  if (sensitive) throw new Error(`Remove the credential parameter “${sensitive}” before publishing.`);
  for (const key of ["layer", "spec", "briefing"]) for (const reference of url.searchParams.getAll(key)) validatePublicReference(reference);

  const fragment = new URLSearchParams(url.hash.replace(/^#/, ""));
  const hasMap = fragment.has("map") || /(?:^#|[&#])map=json:/i.test(url.hash);
  const hasBrief = fragment.has("briefing") || url.searchParams.has("briefing") || url.searchParams.has("briefingExample");
  const hasTour = fragment.has("tour") || url.searchParams.has("tourOnly") || /\/examples\/tours\//.test(url.pathname);
  const hasMapSource = url.searchParams.has("layer") || url.searchParams.has("spec") || /\/examples\//.test(url.pathname);
  if (!hasMap && !hasBrief && !hasTour && !hasMapSource) throw new Error("This does not look like a GISMap Smart Map, Brief, Tour, or public example link.");

  const decoded = decodeJsonMap(url.hash);
  if (decoded && hasSensitiveObject(decoded)) throw new Error("A Smart Map containing credentials or tokens cannot be published.");
  const post_type = hasTour ? "tour" : (hasBrief || decoded?.briefing ? "brief" : "map");
  const title = String(decoded?.title || decoded?.t || "").trim().slice(0, 160) || null;
  return { source_url: url.href, post_type, title, source_schema_version: decoded?.version || decoded?.v || null };
}

export function normalizePosts(payload) {
  const list = Array.isArray(payload) ? payload : payload?.posts;
  if (!Array.isArray(list)) return { posts: [], cursor: null };
  return {
    posts: list.filter((post) => post && TYPES.has(post.post_type)).map((post) => ({
      ...post,
      tags: Array.isArray(post.tags) ? post.tags : [],
      author: post.author || { display_name: "GISMap creator", handle: "creator" },
    })),
    cursor: payload?.next_cursor || null,
  };
}

export function filterPosts(posts, { query = "", type = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return posts.filter((post) => {
    if (type !== "all" && post.post_type !== type) return false;
    if (!needle) return true;
    return [post.title, post.description, post.location_label, ...(post.tags || [])].join(" ").toLowerCase().includes(needle);
  });
}
