// Coordinate helpers for 3D data on a web map: projection definitions for proj4,
// unit factors, and a local east-north-up frame in metres around an origin.
// proj4 itself loads only when a layer needs it (see loadProj4).

const PROJ4_URL = "https://cdn.jsdelivr.net/npm/proj4@2.12.1/dist/proj4.js";
const EARTH_CIRCUMFERENCE = 40075016.68557849;
export const US_SURVEY_FOOT = 1200 / 3937;
export const INTERNATIONAL_FOOT = 0.3048;

/** A proj4 definition for codes it can be built from without a lookup, else null. */
export function builtinProjection(code) {
  const epsg = Number(String(code).replace(/^EPSG:/i, ""));
  if (epsg === 4326 || epsg === 4269 || epsg === 4979) return "+proj=longlat +datum=WGS84 +no_defs";
  if (epsg === 3857 || epsg === 900913) return "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs";
  if (epsg >= 32601 && epsg <= 32660) return `+proj=utm +zone=${epsg - 32600} +datum=WGS84 +units=m +no_defs`;
  if (epsg >= 32701 && epsg <= 32760) return `+proj=utm +zone=${epsg - 32700} +south +datum=WGS84 +units=m +no_defs`;
  // NAD83 / UTM zones 1–23N, and NAD83(2011) / UTM 59N–60N, 1N–19N.
  if (epsg >= 26901 && epsg <= 26923) return `+proj=utm +zone=${epsg - 26900} +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`;
  if (epsg >= 6328 && epsg <= 6348) return `+proj=utm +zone=${epsg <= 6329 ? epsg - 6269 : epsg - 6329} +ellps=GRS80 +units=m +no_defs`;
  return null;
}

/** Metres per unit of a proj4 definition or WKT ("m", "ft", "us-ft", or a definition string). */
export function unitFactor(definition) {
  const textValue = String(definition || "");
  // WKT: the projected CRS's own UNIT is the last one inside PROJCS.
  const projcs = textValue.match(/PROJCS\[[\s\S]*\]/)?.[0];
  if (projcs) {
    const declared = [...projcs.matchAll(/UNIT\["[^"]*",\s*([\d.]+)/g)].at(-1)?.[1];
    if (declared) return Number(declared);
  }
  if (textValue === "us-ft" || /\+units=us-ft|US survey foot|Foot_US|foot_survey_us/i.test(textValue)) return US_SURVEY_FOOT;
  if (textValue === "ft" || /\+units=ft|"Foot"|Foot\b|"foot"|international foot/i.test(textValue)) return INTERNATIONAL_FOOT;
  const toMeter = textValue.match(/\+to_meter=([\d.]+)/);
  return toMeter ? Number(toMeter[1]) : 1;
}

/** A local frame around `origin` [lon, lat]: toLocal(lon, lat, z) → [east, north, up] in metres. */
export function localFrame([originLon, originLat]) {
  const mercator = (lon, lat) => [(lon + 180) / 360, (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2];
  const [ox, oy] = mercator(originLon, originLat);
  // Mercator units per metre at the origin, as MapLibre's meterInMercatorCoordinateUnits.
  const scale = 1 / (EARTH_CIRCUMFERENCE * Math.cos((originLat * Math.PI) / 180));
  return {
    origin: [originLon, originLat],
    mercatorOrigin: [ox, oy],
    mercatorScale: scale,
    toLocal(lon, lat, z = 0) {
      const [x, y] = mercator(lon, lat);
      return [(x - ox) / scale, -(y - oy) / scale, z];
    },
  };
}

let proj4Loading = null;
/** proj4js from a pinned CDN build, loaded once. */
export function loadProj4() {
  if (globalThis.proj4) return Promise.resolve(globalThis.proj4);
  if (typeof document === "undefined") return Promise.reject(new Error("Reprojection needs a browser."));
  proj4Loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PROJ4_URL;
    script.addEventListener("load", () => (globalThis.proj4 ? resolve(globalThis.proj4) : reject(new Error("proj4 did not load."))), { once: true });
    script.addEventListener("error", () => reject(new Error("proj4 could not be downloaded.")), { once: true });
    document.head.append(script);
  }).catch((error) => { proj4Loading = null; throw error; });
  return proj4Loading;
}

/**
 * A converter from a CRS to longitude/latitude: { forward(x, y) → [lon, lat], definition, unitFactor }.
 * `crs` is "EPSG:<code>", a proj4 string, or WKT. Unknown EPSG codes are looked up on epsg.io.
 */
export async function projectionFor(crs, { fetchImpl = globalThis.fetch } = {}) {
  let definition = String(crs || "").trim();
  if (!definition) throw new Error("This data has no coordinate system. Give its CRS, such as EPSG:26910.");
  const code = definition.match(/^EPSG:(\d+)$/i)?.[1];
  if (code) {
    definition = builtinProjection(code);
    if (!definition) {
      const response = await fetchImpl(`https://epsg.io/${code}.proj4`);
      if (!response.ok) throw new Error(`EPSG:${code} could not be looked up (HTTP ${response.status}).`);
      definition = (await response.text()).trim();
      if (!definition.startsWith("+")) throw new Error(`EPSG:${code} is not a known coordinate system.`);
    }
  }
  if (/^\+proj=longlat/.test(definition)) return { forward: (x, y) => [x, y], definition, unitFactor: 1 };
  const proj4 = await loadProj4();
  const converter = proj4(definition, "EPSG:4326");
  return { forward: (x, y) => converter.forward([x, y]), definition, unitFactor: unitFactor(definition) };
}
