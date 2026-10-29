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
    // After a switch from ArcGIS, its AMD loader's global `define` would make the
    // UMD build register as an AMD module instead of setting `maplibregl`.
    const amdDefine = globalThis.define?.amd ? globalThis.define : null;
    if (amdDefine) globalThis.define = undefined;
    const restore = () => { if (amdDefine && globalThis.define === undefined) globalThis.define = amdDefine; };
    const script = document.createElement("script");
    script.src = SCRIPT_URL;
    script.dataset.gismapMaplibre = "";
    script.addEventListener("load", () => {
      restore();
      if (globalThis.maplibregl?.Map) resolve(globalThis.maplibregl);
      else reject(new Error("MapLibre GL JS loaded without exposing maplibregl."));
    }, { once: true });
    script.addEventListener("error", () => { restore(); reject(new Error("MapLibre GL JS did not load. Check the network connection.")); }, { once: true });
    document.head.append(script);
  }).catch((error) => { loading = null; throw error; });
  return loading;
}
