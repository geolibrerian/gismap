// A readable default name for a layer added by URL, taken from the service's
// own name: …/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0
// becomes "California Historic Fire Perimeters".

const SERVER_TYPES = "FeatureServer|MapServer|ImageServer|SceneServer|VectorTileServer|GeocodeServer|GPServer";

const tidy = (value) => {
  let text = String(value || "");
  try { text = decodeURIComponent(text); } catch { /* Keep the raw text. */ }
  return text.replace(/[_+]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
};

/** The service's name from an ArcGIS REST or GeoJSON URL, or "" when there is none to use. */
export function serviceNameFromUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    return "";
  }
  const path = url.pathname.replace(/\/+$/, "");
  // ArcGIS: the segment just before …Server; folders ahead of it are left out.
  const arcgis = path.match(new RegExp(`/([^/]+)/(?:${SERVER_TYPES})(?:/|$)`, "i"));
  if (arcgis && !/^services$/i.test(arcgis[1])) return tidy(arcgis[1]);
  // A data file: its name without the extension (all_month.geojson -> "all month").
  const file = path.split("/").pop() || "";
  const stem = file.match(/^(.+)\.(?:geo)?json$/i)?.[1];
  return stem ? tidy(stem.replace(/[-]+/g, " ")) : "";
}
