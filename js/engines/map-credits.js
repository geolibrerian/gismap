// Engine-neutral helpers for crediting and keying a map outside its own UI,
// e.g. in an exported movie frame where the map's attribution control and
// legend panel are not drawn.

/** Attribution HTML as one plain-text line. */
export function plainAttribution(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&copy;/gi, "©").replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

/** A credit for a data layer with no attribution of its own: its service host. */
export function hostCredit(url) {
  try {
    const { protocol, hostname } = new URL(String(url || ""));
    return /^https?:$/.test(protocol) ? `Data: ${hostname.replace(/^www\./, "")}` : "";
  } catch { return ""; }
}

/** Distinct, non-empty credits joined into one line. */
export function joinCredits(parts) {
  const seen = new Set();
  const unique = [];
  for (const part of parts.flatMap((item) => String(item || "").split(/\s*\|\s*/))) {
    const text = part.trim();
    const key = text.toLowerCase();
    if (text && !seen.has(key)) { seen.add(key); unique.push(text); }
  }
  return unique.join(" | ");
}

/** A legend entry in canvas terms: { label, geometry, fill, stroke, radius }. */
export function legendSwatch(entry) {
  const paint = entry?.paint || {};
  const geometry = entry?.geometry === "point" || entry?.geometry === "line" ? entry.geometry : "polygon";
  const fill = geometry === "point" ? paint.circle : geometry === "line" ? paint.line : paint.fill;
  return { label: String(entry?.label ?? ""), geometry, fill: fill || null, stroke: paint.stroke || paint.outline || null, radius: Number(paint.radius) || null };
}
