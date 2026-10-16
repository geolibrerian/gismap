// Open basemaps for the MapLibre engine. GIS Map basemap ids (the ArcGIS names
// links and projects carry, such as "topo-3d" or "dark-gray-vector") map to
// OpenFreeMap vector styles, which need no API key and allow browser access.
// The engine keeps reporting the requested id, so links round-trip unchanged.
// Attribution comes with each style and shows in the map's attribution control.

const OPENFREEMAP = "https://tiles.openfreemap.org/styles";

export const OPEN_BASEMAPS = Object.freeze({
  liberty: { label: "OpenFreeMap Liberty", style: `${OPENFREEMAP}/liberty` },
  bright: { label: "OpenFreeMap Bright", style: `${OPENFREEMAP}/bright` },
  positron: { label: "OpenFreeMap Positron", style: `${OPENFREEMAP}/positron` },
  dark: { label: "OpenFreeMap Dark", style: `${OPENFREEMAP}/dark` },
});

/**
 * The open style for a GIS Map basemap id: { key, label, style, approximate }.
 * `approximate` is true when the id names something there is no open match
 * for (satellite imagery), so the closest open style stands in.
 */
export function openBasemapFor(id = "topo-3d") {
  const name = String(id || "").toLowerCase();
  const pick = (key, approximate = false) => ({ key, ...OPEN_BASEMAPS[key], approximate });
  if (OPEN_BASEMAPS[name]) return pick(name);
  if (/dark/.test(name)) return pick("dark");
  if (/gray|grey|light|positron/.test(name)) return pick("positron");
  if (/streets|navigation|osm/.test(name)) return pick("bright");
  if (/satellite|hybrid|imagery/.test(name)) return pick("liberty", true);
  return pick("liberty");
}
