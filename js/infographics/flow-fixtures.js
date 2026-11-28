// Launch demo for the Flow Map template.
//
// ILLUSTRATIVE DATA, NOT TRADE STATISTICS. The values are invented, rounded
// and redistributable; they exist to exercise the template: three commodities,
// a duplicate pair that must sum, a reciprocal pair, Pacific crossings, a zero
// row and an unresolved country code (SCG, a retired ISO code).

import { COUNTRY_POINTS } from "./country-points.js";

export const BEVERAGE_FIXTURE_ID = "fixture:beverage-trade";
export const BEVERAGE_FIXTURE_NAME = "Beverage trade demo (illustrative)";
export const BEVERAGE_FIXTURE_CREDIT = "Illustrative demo data bundled with GISMap Online; not real trade statistics";

// [commodity, exporter, importer, thousand tonnes]
const FLOWS = [
  ["coffee", "BRA", "USA", 520], ["coffee", "BRA", "DEU", 480], ["coffee", "BRA", "ITA", 210], ["coffee", "BRA", "JPN", 120],
  ["coffee", "VNM", "DEU", 260], ["coffee", "VNM", "USA", 210], ["coffee", "COL", "USA", 330], ["coffee", "COL", "JPN", 60],
  ["coffee", "ETH", "DEU", 70], ["coffee", "ETH", "SAU", 55], ["coffee", "IDN", "USA", 90], ["coffee", "HND", "DEU", 90],
  ["coffee", "UGA", "ITA", 75], ["coffee", "DEU", "USA", 40], ["coffee", "USA", "DEU", 15],
  ["tea", "KEN", "PAK", 190], ["tea", "KEN", "EGY", 95], ["tea", "KEN", "GBR", 75], ["tea", "CHN", "MAR", 75],
  ["tea", "IND", "RUS", 45], ["tea", "LKA", "IRQ", 35], ["tea", "LKA", "RUS", 30], ["tea", "LKA", "JPN", 0],
  ["cocoa", "CIV", "NLD", 330], ["cocoa", "CIV", "NLD", 230], ["cocoa", "CIV", "USA", 240], ["cocoa", "GHA", "NLD", 230],
  ["cocoa", "CIV", "MYS", 120], ["cocoa", "NGA", "NLD", 140], ["cocoa", "CMR", "NLD", 120], ["cocoa", "GHA", "MYS", 70],
  ["cocoa", "ECU", "IDN", 50], ["cocoa", "SCG", "NLD", 12],
];

export const BEVERAGE_FIXTURE_FIELDS = Object.freeze([
  { name: "flow_id", alias: "Flow ID", type: "integer" },
  { name: "commodity", alias: "Commodity", type: "string" },
  { name: "exporter_iso3", alias: "Exporter (ISO3)", type: "string" },
  { name: "importer_iso3", alias: "Importer (ISO3)", type: "string" },
  { name: "net_weight_kt", alias: "Net weight (kt)", type: "double" },
  { name: "year", alias: "Year", type: "integer" },
  { name: "origin_lon", alias: "Origin longitude", type: "double" },
  { name: "origin_lat", alias: "Origin latitude", type: "double" },
  { name: "destination_lon", alias: "Destination longitude", type: "double" },
  { name: "destination_lat", alias: "Destination latitude", type: "double" },
]);

/** Fresh fixture rows. Coordinate columns are empty where the code does not resolve. */
export function beverageFixtureRows() {
  return FLOWS.map(([commodity, exporter, importer, weight], index) => {
    const origin = COUNTRY_POINTS.get(exporter);
    const destination = COUNTRY_POINTS.get(importer);
    return {
      flow_id: index + 1, commodity, exporter_iso3: exporter, importer_iso3: importer, net_weight_kt: weight, year: 2024,
      origin_lon: origin?.lon ?? null, origin_lat: origin?.lat ?? null,
      destination_lon: destination?.lon ?? null, destination_lat: destination?.lat ?? null,
    };
  });
}

/** The recipe the demo opens with. */
export function beverageFixtureRecipe() {
  return {
    title: "Bean to cup: where beverage crops travel",
    subtitle: "Largest export flows of coffee, tea and cocoa by net weight. Illustrative demo data.",
    source: { layerId: BEVERAGE_FIXTURE_ID, name: BEVERAGE_FIXTURE_NAME, credit: BEVERAGE_FIXTURE_CREDIT },
    query: { scope: { type: "all" } },
    bindings: {
      mode: "ids",
      origin: { idField: "exporter_iso3", lonField: "origin_lon", latField: "origin_lat" },
      destination: { idField: "importer_iso3", lonField: "destination_lon", latField: "destination_lat" },
      lookup: { id: "country-points", revision: "v1" },
      weight: { field: "net_weight_kt", unit: "kt" },
      categoryField: "commodity",
      periodField: "year",
    },
    design: { layout: "wide", theme: "editorial-light", topN: 30 },
    annotations: [{ id: "note-1", anchor: { type: "flow", key: "CIV>NLD|cocoa" }, text: "Two shipment records sum to the single largest corridor." }],
  };
}
