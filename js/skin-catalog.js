export const INTERFACE_SKINS = Object.freeze([
  Object.freeze({ id: "clean-light", label: "Clean Light", description: "Modern analytical workspace" }),
  Object.freeze({ id: "dark-analytical", label: "Midnight", description: "Quiet professional night interface" }),
  Object.freeze({ id: "tidal-95", label: "Pacific ’94", description: "Classic digital cartography" }),
  Object.freeze({ id: "portolan", label: "Copperplate", description: "Historical atlas and field journal" }),
  Object.freeze({ id: "velvet-orbit", label: "Velvet Orbit", description: "Editorial presentation" }),
  Object.freeze({ id: "violet-circuit", label: "Violet Circuit", description: "Operational console" }),
  Object.freeze({ id: "highway", label: "Highway", description: "Clean technical map console" }),
  Object.freeze({ id: "steeler", label: "Steeler", description: "Soft striped field journal" }),
]);

export const skinOptionsMarkup = (selected = "clean-light") => INTERFACE_SKINS
  .map(({ id, label }) => `<option value="${id}"${id === selected ? " selected" : ""}>${label}</option>`)
  .join("");

