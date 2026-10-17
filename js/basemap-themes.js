// Basemap themes: the colours a map engine gives its basemap so the map
// matches the interface skin. A theme is plain data derived from a skin's
// design tokens (the CSS custom properties in css/app.css): the basemap is
// drawn in the skin's neutrals (paper, ink, muted, line, surface) and the
// skin's accent is kept for the data on top of it. Engine-neutral and pure.

/** The basemap id that follows the active skin ("Skin" in the basemap menu). */
export const SKIN_BASEMAP = "skin";

/** The CSS custom properties a theme is derived from. */
export const THEME_TOKENS = Object.freeze(["paper", "surface", "ink", "muted", "line", "green-2"]);

/**
 * Small per-skin adjustments on top of the derived theme. Phase 1 keeps these
 * to label treatment; colours always come from the skin's own tokens.
 */
export const SKIN_THEME_OVERRIDES = Object.freeze({
  highway: { labelTransform: "uppercase", labelLetterSpacing: 0.08 },
  "violet-circuit": { labelTransform: "uppercase", labelLetterSpacing: 0.06 },
});

/** #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() (comma or space separated) as { r, g, b, a }, or null. */
export function parseColor(value) {
  const text = String(value ?? "").trim().toLowerCase();
  let match = /^#([0-9a-f]{3,8})$/.exec(text);
  if (match) {
    let hex = match[1];
    if (hex.length === 3 || hex.length === 4) hex = [...hex].map((char) => char + char).join("");
    if (hex.length !== 6 && hex.length !== 8) return null;
    const channel = (index) => parseInt(hex.slice(index, index + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: hex.length === 8 ? channel(6) / 255 : 1 };
  }
  match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(text);
  if (match) {
    const alpha = match[4] == null ? 1 : match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
  }
  return null;
}

const hex = ({ r, g, b }) => `#${[r, g, b].map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`;

/** `a` moved `amount` (0–1) of the way towards `b`, as #rrggbb. */
export function mix(a, b, amount) {
  const from = parseColor(a);
  const to = parseColor(b);
  if (!from || !to) return hex(from || to || { r: 128, g: 128, b: 128 });
  return hex({ r: from.r + (to.r - from.r) * amount, g: from.g + (to.g - from.g) * amount, b: from.b + (to.b - from.b) * amount });
}

/** WCAG relative luminance (0–1). */
export function luminance(color) {
  const { r, g, b } = parseColor(color) || { r: 0, g: 0, b: 0 };
  const linear = (value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return (0.2126 * linear(r)) + (0.7152 * linear(g)) + (0.0722 * linear(b));
}

/** WCAG contrast ratio between two colours (1–21). */
export function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

/** The first of `candidates` with at least `ratio` contrast against `background`, else the one with the most. */
function readable(background, candidates, ratio = 4.5) {
  return candidates.find((color) => contrast(color, background) >= ratio)
    || [...candidates].sort((a, b) => contrast(b, background) - contrast(a, background))[0];
}

/**
 * A basemap theme from a skin's tokens ({ paper, surface, ink, muted, line,
 * "green-2" }: CSS colours). `dark` says whether the skin renders dark.
 * Every colour is #rrggbb. Labels keep at least 4.5:1 contrast with the land.
 */
export function themeFromTokens(tokens = {}, { dark = false, skin = null } = {}) {
  const paper = hex(parseColor(tokens.paper) || (dark ? { r: 12, g: 18, b: 23 } : { r: 244, g: 241, b: 232 }));
  const ink = hex(parseColor(tokens.ink) || (dark ? { r: 237, g: 244, b: 247 } : { r: 23, g: 34, b: 31 }));
  const muted = hex(parseColor(tokens.muted) || parseColor(mix(paper, ink, 0.55)));
  const line = hex(parseColor(tokens.line) || parseColor(mix(paper, ink, 0.18)));
  const surface = hex(parseColor(tokens.surface) || parseColor(paper));
  const accent = hex(parseColor(tokens["green-2"]) || parseColor(dark ? "#52c4d1" : "#1b6b59"));
  const land = paper;
  // Roads read as lighter-than-land channels on light skins and as faint light strokes on dark ones.
  const roadMinor = dark ? mix(paper, muted, 0.3) : (contrast(surface, paper) > 1.04 ? surface : mix(paper, "#ffffff", 0.7));
  const roadMajor = dark ? mix(paper, muted, 0.48) : mix(roadMinor, "#ffffff", 0.4);
  const water = mix(paper, muted, dark ? 0.3 : 0.27);
  const theme = {
    skin,
    dark,
    accent,
    land,
    water,
    waterLine: mix(paper, muted, dark ? 0.42 : 0.34),
    landcover: mix(paper, muted, dark ? 0.1 : 0.07),
    landcoverBare: mix(paper, dark ? ink : "#ffffff", dark ? 0.04 : 0.35),
    landuse: mix(paper, ink, dark ? 0.05 : 0.035),
    park: mix(paper, muted, dark ? 0.14 : 0.1),
    building: mix(paper, line, dark ? 0.45 : 0.6),
    buildingOutline: mix(paper, line, dark ? 0.7 : 0.9),
    roadMinor,
    roadMajor,
    roadCasing: dark ? mix(paper, "#000000", 0.25) : mix(paper, line, 0.85),
    rail: mix(paper, muted, dark ? 0.45 : 0.4),
    // Boundaries are dashed in the base styles; kept faint so they do not compete with data.
    boundary: mix(paper, muted, dark ? 0.42 : 0.32),
    label: readable(land, [muted, mix(muted, ink, 0.4), ink]),
    labelStrong: readable(land, [ink], 7),
    labelHalo: land,
    waterLabel: readable(water, [mix(water, ink, 0.55), mix(water, ink, 0.7), ink]),
    showPoi: false,
    labelTransform: "none",
    labelLetterSpacing: 0,
  };
  return { ...theme, ...(SKIN_THEME_OVERRIDES[skin] || {}) };
}

/**
 * The theme of the skin a document shows now: its tokens read from computed
 * styles (`getComputedStyle(document.documentElement)`).
 */
export function themeFromComputedStyle(style, { dark = false, skin = null } = {}) {
  const tokens = Object.fromEntries(THEME_TOKENS.map((name) => [name, style?.getPropertyValue?.(`--${name}`)?.trim() || null]));
  return themeFromTokens(tokens, { dark, skin });
}
