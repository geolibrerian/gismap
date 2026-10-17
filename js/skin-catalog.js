/**
 * Interface skins are complete visual systems. Exactly one skin is active for
 * the whole document — map workspace, presentations, mobile navigation,
 * sheets and dialogs — so the interface never mixes two looks at once.
 *
 * "gismap" is the house look; it alone follows the Light/Dark/System
 * appearance setting. Every other skin carries its own fixed light or dark
 * palette.
 */
export const DEFAULT_SKIN = "gismap";

export const INTERFACE_SKINS = Object.freeze([
  Object.freeze({ id: "gismap", label: "GISMap", description: "Field green · follows light/dark setting", tone: "auto" }),
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

/** Resolve whether a skin renders dark, given the user's appearance theme. */
export const skinIsDark = (skin, theme = "light") => {
  const entry = INTERFACE_SKINS.find(({ id }) => id === normalizeSkin(skin));
  return entry?.tone === "auto" ? theme === "dark" : entry?.tone === "dark";
};

/**
 * Apply one skin to the whole document. Tokens live on :root so elements
 * outside #app (bottom navigation, dialogs, toasts) share the same look.
 */
export const applyInterfaceSkin = (skin, { documentRef = globalThis.document } = {}) => {
  const root = documentRef?.documentElement;
  if (!root) return normalizeSkin(skin);
  const id = normalizeSkin(skin);
  root.dataset.skin = id;
  const dark = skinIsDark(id, root.dataset.theme);
  root.style.colorScheme = dark ? "dark" : "light";
  documentRef.body?.classList?.toggle("calcite-mode-dark", dark);
  const app = documentRef.querySelector?.("#app");
  if (app) app.dataset.presentationSkin = id;
  return id;
};
