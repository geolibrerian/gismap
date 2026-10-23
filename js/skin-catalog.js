/**
 * Interface skins are complete visual systems. Exactly one skin is active for
 * the whole document — map workspace, presentations, mobile navigation,
 * sheets and dialogs — so the interface never mixes two looks at once.
 *
 * Every skin renders light or dark. "gismap" (Fieldwork / Observatory)
 * follows the Light/Dark/System appearance setting; every other skin opens in
 * its native tone and remembers its own light/dark choice. The counterpart
 * palettes live in css/fieldwork.css.
 */
export const DEFAULT_SKIN = "gismap";

export const INTERFACE_SKINS = Object.freeze([
  Object.freeze({ id: "gismap", label: "Fieldwork / Observatory", description: "Chalk and pine · light / dark studio", tone: "auto" }),
  Object.freeze({ id: "clean-light", label: "Clean Light", description: "Modern analytical workspace", tone: "light" }),
  Object.freeze({ id: "dark-analytical", label: "Midnight", description: "Quiet professional night interface", tone: "dark" }),
  Object.freeze({ id: "tidal-95", label: "Pacific ’94", description: "Classic digital cartography", tone: "light" }),
  Object.freeze({ id: "portolan", label: "Copperplate", description: "Historical atlas and field journal", tone: "light" }),
  Object.freeze({ id: "velvet-orbit", label: "Velvet Orbit", description: "Editorial presentation", tone: "dark" }),
  Object.freeze({ id: "violet-circuit", label: "Violet Circuit", description: "Operational console", tone: "dark" }),
  Object.freeze({ id: "highway", label: "Highway", description: "Clean technical map console", tone: "light" }),
  Object.freeze({ id: "steeler", label: "Steeler", description: "Soft striped field journal", tone: "light" }),
  Object.freeze({ id: "slice", label: "Slice", description: "Geological pink and warm brown", tone: "light" }),
  Object.freeze({ id: "wavelength", label: "Wavelength", description: "Warm signal lines on charcoal", tone: "dark" }),
  Object.freeze({ id: "connect", label: "Connect", description: "Bright yellow and playful teal", tone: "light" }),
]);

const SKIN_IDS = new Set(INTERFACE_SKINS.map(({ id }) => id));

export const normalizeSkin = (value) => {
  const id = value === "retro-print" ? "portolan" : value;
  return SKIN_IDS.has(id) ? id : DEFAULT_SKIN;
};

export const skinOptionsMarkup = (selected = DEFAULT_SKIN) => INTERFACE_SKINS
  .map(({ id, label }) => `<option value="${id}"${id === selected ? " selected" : ""}>${label}</option>`)
  .join("");

export const skinTone = (skin) => INTERFACE_SKINS.find(({ id }) => id === normalizeSkin(skin))?.tone || "light";

/** The light/dark rendering of a skin: house appearance for "gismap", otherwise the skin's saved choice or native tone. */
export const resolveSkinTheme = (skin, { houseTheme = "light", choices = {} } = {}) => {
  const id = normalizeSkin(skin);
  const tone = skinTone(id);
  if (tone === "auto") return houseTheme === "dark" ? "dark" : "light";
  return choices?.[id] === "dark" || choices?.[id] === "light" ? choices[id] : tone;
};

// The app registers how skins resolve (it owns the saved settings); without it,
// skins render in their native tone and the house skin follows data-theme.
let themeResolver = null;
// Without a resolver, data-theme holds the house appearance until another skin
// replaces it; keep it so returning to the house skin restores it.
const houseThemes = new WeakMap();
export const setSkinThemeResolver = (resolver) => { themeResolver = typeof resolver === "function" ? resolver : null; };

/** Resolve whether a skin renders dark, given the user's appearance theme. */
export const skinIsDark = (skin, theme = "light") => (themeResolver ? themeResolver(normalizeSkin(skin)) : resolveSkinTheme(skin, { houseTheme: theme })) === "dark";

/**
 * Apply one skin to the whole document. Tokens live on :root so elements
 * outside #app (bottom navigation, dialogs, toasts) share the same look.
 */
export const normalizeSkinColors = (colors) => {
  if (!colors || typeof colors !== "object") return null;
  const result = {};
  for (const key of ["primary", "secondary", "tertiary"]) {
    if (typeof colors[key] === "string" && /^#[0-9a-f]{6}$/i.test(colors[key])) result[key] = colors[key];
  }
  return Object.keys(result).length ? result : null;
};

export const applyInterfaceSkin = (skin, { documentRef = globalThis.document, colors = null } = {}) => {
  const root = documentRef?.documentElement;
  if (!root) return normalizeSkin(skin);
  const id = normalizeSkin(skin);
  const previous = root.dataset.skin;
  if (!previous || skinTone(previous) === "auto") houseThemes.set(root, root.dataset.theme);
  root.dataset.skin = id;
  const palette = normalizeSkinColors(colors);
  for (const [key, token] of [["primary", "--green"], ["secondary", "--green-2"], ["tertiary", "--amber"]]) {
    if (palette?.[key]) root.style.setProperty?.(token, palette[key]);
    else root.style.removeProperty?.(token);
  }
  const theme = themeResolver ? themeResolver(id) : resolveSkinTheme(id, { houseTheme: houseThemes.get(root) ?? root.dataset.theme });
  root.dataset.theme = theme;
  const dark = theme === "dark";
  root.style.colorScheme = dark ? "dark" : "light";
  documentRef.body?.classList?.toggle("calcite-mode-dark", dark);
  const app = documentRef.querySelector?.("#app");
  if (app) app.dataset.presentationSkin = id;
  return id;
};
