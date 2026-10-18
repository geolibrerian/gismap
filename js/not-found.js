// Suggestions are a fixed allowlist of real public pages, never a URL derived
// from the request. Missing asset requests still retain their HTTP 404 status.
export const DESTINATIONS = Object.freeze([
  { label: "Agent skills", path: "/skills/", keywords: ["skill", "skills", "agent", "agents", "codex", "claude"] },
  { label: "Examples", path: "/examples/", keywords: ["example", "examples", "maps", "map"] },
  { label: "Guides", path: "/guides/", keywords: ["guide", "guides", "help", "documentation", "docs"] },
  { label: "AI agent guide", path: "/guides/ai-agents/", keywords: ["ai", "agent", "agents", "api"] },
  { label: "GeoJSON viewer", path: "/geojson-viewer/", keywords: ["geojson", "geojsonviewer"] },
  { label: "ArcGIS REST viewer", path: "/arcgis-rest-service-viewer/", keywords: ["arcgis", "rest", "service"] },
]);

function distance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = next;
  }
  return previous[b.length];
}

export function suggestDestinations(pathname, limit = 3) {
  // Bound work and avoid interpreting untrusted URL text as markup or a link.
  const parts = String(pathname || "").toLowerCase().slice(0, 200).split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && p.length <= 40).slice(0, 8);
  return DESTINATIONS.map((destination, order) => {
    const score = Math.min(Infinity, ...parts.flatMap((part) => destination.keywords.map((keyword) => {
      if (part === keyword) return 0;
      if (part.length >= 4 && (keyword.startsWith(part) || part.startsWith(keyword))) return 1;
      const d = distance(part, keyword);
      return d <= (Math.max(part.length, keyword.length) >= 7 ? 2 : 1) ? d + 1 : Infinity;
    })));
    return { destination, score, order };
  }).filter((item) => Number.isFinite(item.score)).sort((a, b) => a.score - b.score || a.order - b.order).slice(0, limit).map((item) => item.destination);
}

if (typeof document !== "undefined") {
  const list = document.querySelector("#suggested-pages");
  const section = document.querySelector("#suggestions");
  if (list && section) {
    const suggestions = suggestDestinations(window.location.pathname);
    for (const { label, path } of suggestions) {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.href = path;
      link.textContent = label;
      item.append(link);
      list.append(item);
    }
    section.hidden = suggestions.length === 0;
  }
}
