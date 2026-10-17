// Open basemaps for the MapLibre engine: OpenFreeMap vector styles, which need
// no API key and allow browser access ("open-liberty", "open-bright",
// "open-positron", "open-dark"). An ArcGIS id from a link or project ("topo-3d")
// draws its catalogued equivalent (basemap-catalog.js); the engine keeps
// reporting the requested id, so links round-trip unchanged.
// Attribution comes with each style and shows in the map's attribution control.
// The "skin" basemap is Positron restyled with the active skin's theme
// (basemap-theme.js), so it has the fewest layers to recolour.
import { SKIN_BASEMAP } from "../../basemap-themes.js?v=0.40.0";
import { basemapEntry, basemapOnEngine } from "../../basemap-catalog.js?v=0.41.0";

const OPENFREEMAP = "https://tiles.openfreemap.org/styles";

export const OPEN_BASEMAPS = Object.freeze({
  liberty: { label: "OpenFreeMap Liberty", style: `${OPENFREEMAP}/liberty` },
  bright: { label: "OpenFreeMap Bright", style: `${OPENFREEMAP}/bright` },
  positron: { label: "OpenFreeMap Positron", style: `${OPENFREEMAP}/positron` },
  dark: { label: "OpenFreeMap Dark", style: `${OPENFREEMAP}/dark` },
});

/**
 * The open style for a GIS Map basemap id: { key, label, style, approximate, themed }.
 * `approximate` is true when the id names something there is no open match
 * for (satellite imagery), so the closest open style stands in.
 */
export function openBasemapFor(id = "topo-3d") {
  const name = String(id || "").toLowerCase();
  const pick = (key, approximate = false) => ({ key, ...OPEN_BASEMAPS[key], approximate, themed: false });
  if (name === SKIN_BASEMAP) return { ...pick("positron"), themed: true };
  if (OPEN_BASEMAPS[name]) return pick(name);
  const shown = basemapOnEngine(name, "maplibre").replace(/^open-/, "");
  return pick(OPEN_BASEMAPS[shown] ? shown : "liberty", basemapEntry(name)?.group === "Imagery");
}
