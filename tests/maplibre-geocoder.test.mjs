import assert from "node:assert/strict";
import test from "node:test";
import { OpenGeocoder, inUnitedStates, looksLikeUsAddress } from "../js/engines/maplibre/geocoder.js";

const census = {
  result: { addressMatches: [{ matchedAddress: "1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500", coordinates: { x: -77.0352, y: 38.8987 } }] },
};
const geographies = {
  result: { geographies: { States: [{ NAME: "District of Columbia", STATE: "11" }], Counties: [{ NAME: "District of Columbia", GEOID: "11001" }], "Census Tracts": [{ NAME: "Census Tract 62.02", GEOID: "11001006202" }] } },
};
const osmSearch = [
  { display_name: "White House, Washington", lon: "-77.03520", lat: "38.89870", boundingbox: ["38.8970", "38.8990", "-77.0370", "-77.0340"] },
  { display_name: "Berlin, Germany", lon: "13.4", lat: "52.5", boundingbox: ["52.3", "52.7", "13.0", "13.8"] },
];
const osmReverse = { name: "White House", type: "government", addresstype: "office", display_name: "White House, 1600, Pennsylvania Avenue Northwest, Washington, 20500, United States", address: { office: "White House", house_number: "1600", road: "Pennsylvania Avenue Northwest", city: "Washington", state: "District of Columbia", postcode: "20500", country: "United States", country_code: "us" } };

function geocoder() {
  const calls = { fetch: [], jsonp: [], waits: [] };
  let clock = 0;
  const instance = new OpenGeocoder({
    fetch: async (url) => { calls.fetch.push(url); return { ok: true, json: async () => (url.includes("/reverse") ? osmReverse : osmSearch) }; },
    jsonp: async (url) => { calls.jsonp.push(url); return url.includes("geographies") ? geographies : census; },
    now: () => clock,
    wait: async (ms) => { calls.waits.push(ms); clock += ms; },
  });
  return { instance, calls };
}

test("US street addresses and points are recognised", () => {
  assert.ok(looksLikeUsAddress("1600 Pennsylvania Ave NW, Washington DC"));
  assert.ok(looksLikeUsAddress("350 5th Ave New York NY 10118"));
  assert.ok(!looksLikeUsAddress("Berlin"));
  assert.ok(!looksLikeUsAddress("Mount Rainier"));
  assert.ok(inUnitedStates({ longitude: -77, latitude: 38.9 }));
  assert.ok(inUnitedStates({ longitude: -150, latitude: 61 }));
  assert.ok(!inUnitedStates({ longitude: 13.4, latitude: 52.5 }));
});

test("search puts Census matches first and drops the same place from Nominatim", async () => {
  const { instance, calls } = geocoder();
  const places = await instance.search("1600 Pennsylvania Ave NW, Washington DC");
  assert.equal(calls.jsonp.length, 1);
  assert.match(calls.jsonp[0], /locations\/onelineaddress/);
  assert.deepEqual(places.map((place) => place.source), ["census", "osm"]);
  assert.equal(places[0].label, "1600 Pennsylvania Ave NW, Washington, DC, 20500");
  assert.deepEqual(places[0].location, [-77.0352, 38.8987]);
  assert.deepEqual(places[1].extent, { xmin: 13, ymin: 52.3, xmax: 13.8, ymax: 52.7, spatialReference: { wkid: 4326 } });
});

test("other places use Nominatim only, cached", async () => {
  const { instance, calls } = geocoder();
  await instance.search("Berlin");
  await instance.search("Berlin");
  assert.equal(calls.jsonp.length, 0);
  assert.equal(calls.fetch.length, 1);
  assert.match(calls.fetch[0], /nominatim\.openstreetmap\.org\/search\?q=Berlin/);
});

test("Nominatim requests are at least a second apart", async () => {
  const { instance, calls } = geocoder();
  await Promise.all([instance.search("Paris"), instance.search("Rome"), instance.search("Oslo")]);
  assert.equal(calls.fetch.length, 3);
  assert.deepEqual(calls.waits, [1100, 1100]);
});

test("reverse geocoding adds census geographies in the US", async () => {
  const { instance } = geocoder();
  const result = await instance.reverse({ longitude: -77.0365, latitude: 38.8977 });
  assert.equal(result.address, "White House, 1600 Pennsylvania Avenue Northwest, Washington, District of Columbia, 20500");
  assert.equal(result.attributes.PlaceName, "White House");
  assert.equal(result.attributes.CensusTractGEOID, "11001006202");
  assert.equal(result.attributes.CountyFIPS, "11001");
  const abroad = geocoder();
  await abroad.instance.reverse({ longitude: 13.4, latitude: 52.5 });
  assert.equal(abroad.calls.jsonp.length, 0);
  assert.equal(await abroad.instance.reverse({}), null);
});

test("a failed place search is reported; a failed reverse is null", async () => {
  const failing = new OpenGeocoder({ fetch: async () => ({ ok: false, status: 429 }), jsonp: async () => ({}), wait: async () => {} });
  await assert.rejects(failing.search("Berlin"), /429/);
  assert.equal(await failing.reverse({ longitude: 13.4, latitude: 52.5 }), null);
});
