// Loads MapLibre GL JS only when the MapLibre engine is selected, from a
// pinned CDN build, so the ArcGIS engine never downloads it (and vice versa).
const VERSION = "5.24.0";
const SCRIPT_URL = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.js`;
const CSS_URL = `https://unpkg.com/maplibre-gl@${VERSION}/dist/maplibre-gl.css`;
let loading = null;

export async function loadMaplibre() {
  if (globalThis.maplibregl?.Map) return globalThis.maplibregl;
  if (loading) return loading;
  if (typeof document === "undefined") throw new Error("The MapLibre map engine needs a browser document.");
  if (!document.querySelector(`link[href="${CSS_URL}"]`)) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_URL;
    link.dataset.gismapMaplibre = "";
    document.head.append(link);
  }
  loading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.dataset.gismapMaplibre = "";
    script.addEventListener("load", () => globalThis.maplibregl?.Map
      ? resolve(globalThis.maplibregl)
      : reject(new Error("MapLibre GL JS loaded without exposing maplibregl.")), { once: true });
    script.addEventListener("error", () => reject(new Error("MapLibre GL JS did not load. Check the network connection.")), { once: true });
    document.head.append(script);
  }).catch((error) => { loading = null; throw error; });
  return loading;
}
