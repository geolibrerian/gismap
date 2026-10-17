/**
 * Open geocoding for the MapLibre engine, all in the browser:
 * - the US Census Geocoder for US street addresses (JSONP: it sends no CORS headers)
 *   and the census geographies of a point;
 * - Nominatim (OpenStreetMap) for everything else and for addresses of points.
 *
 * Nominatim's public server allows one request a second and no search-as-you-type
 * (https://operations.osmfoundation.org/policies/nominatim/), so requests are
 * queued a second apart, answers are cached, and the engine does not offer
 * place suggestions while typing.
 */

export const CENSUS_URL = "https://geocoding.geo.census.gov/geocoder";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org";
const NOMINATIM_INTERVAL = 1100;
const CACHE_SIZE = 100;

/** Text that reads as a US street address: a house number, then a street, then a city, state or ZIP. */
export function looksLikeUsAddress(text) {
  return /^\s*\d+[a-z]?\s+\S+/i.test(text) && /(,|\b\d{5}(-\d{4})?\b|\b[A-Z]{2}\b)/.test(text);
}

/** A point within the US and its territories (a rough box test, enough to choose a geocoder). */
export function inUnitedStates({ longitude, latitude }) {
  const boxes = [[-125, 24, -66, 50], [-170, 51, -129, 72], [-161, 18, -154, 23], [-68, 17, -64, 19], [144, 13, 146, 21]];
  return boxes.some(([xmin, ymin, xmax, ymax]) => longitude >= xmin && longitude <= xmax && latitude >= ymin && latitude <= ymax);
}

/** Loads a JSONP URL (the callback name goes in `callback=`). */
export function jsonp(url, { timeout = 10000, document = globalThis.document } = {}) {
  return new Promise((resolve, reject) => {
    const name = `__gismapJsonp${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    const done = () => { clearTimeout(timer); delete globalThis[name]; script.remove(); };
    const timer = setTimeout(() => { done(); reject(new Error("The geocoder did not answer.")); }, timeout);
    globalThis[name] = (data) => { done(); resolve(data); };
    script.onerror = () => { done(); reject(new Error("The geocoder could not be reached.")); };
    const target = new URL(url);
    target.searchParams.set("callback", name);
    script.src = target.href;
    document.head.append(script);
  });
}

export class OpenGeocoder {
  #queue = Promise.resolve();
  #last = -Infinity;
  #cache = new Map();

  constructor({ fetch = globalThis.fetch?.bind(globalThis), jsonp: loadJsonp = jsonp, now = () => Date.now(), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    Object.assign(this, { fetch, jsonp: loadJsonp, now, wait });
  }

  /** Places matching a text, as { label, location: [lon, lat], extent? }: Census matches first for US addresses. */
  async search(text, { limit = 6 } = {}) {
    const query = String(text || "").trim();
    if (!query) return [];
    const [census, osm] = await Promise.all([
      looksLikeUsAddress(query) ? this.#censusSearch(query).catch(() => []) : [],
      this.#nominatim("search", { q: query, format: "jsonv2", limit: String(limit) }).then((items) => (Array.isArray(items) ? items : []).map(nominatimPlace)).catch((error) => (looksLikeUsAddress(query) ? [] : Promise.reject(error))),
    ]);
    const places = [...census];
    for (const place of osm) {
      // The same place from both: keep the Census match.
      if (!places.some((other) => Math.abs(other.location[0] - place.location[0]) < 0.0005 && Math.abs(other.location[1] - place.location[1]) < 0.0005)) places.push(place);
    }
    return places.slice(0, limit);
  }

  /** The address nearest a point: { address, attributes }, or null. In the US, attributes add the census geographies. */
  async reverse(point) {
    const longitude = Number(point?.longitude);
    const latitude = Number(point?.latitude);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null;
    const [osm, census] = await Promise.all([
      this.#nominatim("reverse", { lat: latitude.toFixed(6), lon: longitude.toFixed(6), format: "jsonv2", layer: "address" }).catch(() => null),
      inUnitedStates({ longitude, latitude }) ? this.#censusGeographies(longitude, latitude).catch(() => null) : null,
    ]);
    if (!osm?.display_name && !census) return null;
    const attributes = { ...flatAddress(osm), ...(census || {}) };
    return { address: osm?.display_name ? shortAddress(osm) : census.County || census.State || "", attributes };
  }

  async #censusSearch(address) {
    const url = new URL(`${CENSUS_URL}/locations/onelineaddress`);
    Object.entries({ address, benchmark: "Public_AR_Current", format: "jsonp" }).forEach(([key, value]) => url.searchParams.set(key, value));
    const data = await this.#cached(url.href, () => this.jsonp(url.href));
    return (data?.result?.addressMatches || []).map((match) => ({
      label: titleCase(match.matchedAddress),
      location: [Number(match.coordinates.x), Number(match.coordinates.y)],
      source: "census",
    })).filter((place) => place.location.every(Number.isFinite));
  }

  async #censusGeographies(longitude, latitude) {
    const url = new URL(`${CENSUS_URL}/geographies/coordinates`);
    Object.entries({ x: longitude.toFixed(6), y: latitude.toFixed(6), benchmark: "Public_AR_Current", vintage: "Current_Current", format: "jsonp" }).forEach(([key, value]) => url.searchParams.set(key, value));
    const data = await this.#cached(url.href, () => this.jsonp(url.href));
    const geographies = data?.result?.geographies || {};
    const first = (name) => geographies[name]?.[0];
    const state = first("States");
    const county = first("Counties");
    const tract = first("Census Tracts");
    const block = first("2020 Census Blocks") || first("Census Blocks");
    if (!state && !county) return null;
    return Object.fromEntries(Object.entries({
      State: state?.NAME, StateFIPS: state?.STATE, County: county?.NAME, CountyFIPS: county?.GEOID,
      CensusTract: tract?.NAME, CensusTractGEOID: tract?.GEOID, CensusBlockGEOID: block?.GEOID,
    }).filter(([, value]) => value));
  }

  /** One Nominatim request, at most one a second, cached. */
  #nominatim(path, parameters) {
    const url = new URL(`${NOMINATIM_URL}/${path}`);
    Object.entries(parameters).forEach(([key, value]) => url.searchParams.set(key, value));
    return this.#cached(url.href, () => {
      const run = this.#queue.then(async () => {
        const delay = this.#last + NOMINATIM_INTERVAL - this.now();
        if (delay > 0) await this.wait(delay);
        this.#last = this.now();
        const response = await this.fetch(url.href, { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`The place search answered ${response.status}.`);
        return response.json();
      });
      this.#queue = run.catch(() => {});
      return run;
    });
  }

  #cached(key, load) {
    if (this.#cache.has(key)) return this.#cache.get(key);
    const promise = load();
    this.#cache.set(key, promise);
    promise.catch(() => this.#cache.delete(key));
    if (this.#cache.size > CACHE_SIZE) this.#cache.delete(this.#cache.keys().next().value);
    return promise;
  }
}

function nominatimPlace(item) {
  const place = { label: item.display_name, location: [Number(item.lon), Number(item.lat)], source: "osm" };
  const [south, north, west, east] = (item.boundingbox || []).map(Number);
  if ([south, north, west, east].every(Number.isFinite) && (north - south > 0.0001 || east - west > 0.0001)) {
    place.extent = { xmin: west, ymin: south, xmax: east, ymax: north, spatialReference: { wkid: 4326 } };
  }
  return place;
}

/** "1600 Pennsylvania Avenue Northwest, Washington, District of Columbia, 20500" from a Nominatim address. */
function shortAddress(item) {
  const a = item.address || {};
  const street = [a.house_number, a.road].filter(Boolean).join(" ");
  const locality = a.city || a.town || a.village || a.hamlet || a.municipality || a.county;
  const parts = [a[item.addresstype] && a[item.addresstype] !== a.road ? a[item.addresstype] : null, street, locality, a.state, a.postcode].filter(Boolean);
  return parts.length >= 2 ? [...new Set(parts)].join(", ") : item.display_name;
}

function flatAddress(item) {
  if (!item) return {};
  const a = item.address || {};
  return Object.fromEntries(Object.entries({
    PlaceName: item.name || undefined, Type: item.type, Address: [a.house_number, a.road].filter(Boolean).join(" ") || undefined,
    City: a.city || a.town || a.village || a.hamlet, Region: a.state, Postal: a.postcode, Country: a.country, CountryCode: a.country_code?.toUpperCase(),
    Source: "OpenStreetMap",
  }).filter(([, value]) => value));
}

const titleCase = (text) => String(text || "").toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase()).replace(/\b([A-Z][a-z]),/g, (match, word) => `${word.toUpperCase()},`);
