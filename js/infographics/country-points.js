// Country point lookup for Flow Map origin–destination IDs.
//
// One representative point per country, keyed by ISO 3166-1 alpha-3 code.
// Points are approximate interior locations chosen for legibility at world
// scale (usually near the main population or trade centre), not centroids or
// capitals. Connections drawn from them are schematic.

export const COUNTRY_POINTS_ID = "country-points";
export const COUNTRY_POINTS_REVISION = "v1";
export const COUNTRY_POINTS_CREDIT = "Country points: GISMap Online country-points v1 (approximate representative points)";

// [iso3, name, longitude, latitude]
const ROWS = [
  ["AFG", "Afghanistan", 67.7, 33.9], ["AGO", "Angola", 17.9, -11.2], ["ALB", "Albania", 20.0, 41.1],
  ["ARE", "United Arab Emirates", 54.4, 24.4], ["ARG", "Argentina", -63.6, -34.6], ["ARM", "Armenia", 44.9, 40.2],
  ["AUS", "Australia", 134.5, -25.7], ["AUT", "Austria", 14.6, 47.6], ["AZE", "Azerbaijan", 47.6, 40.1],
  ["BDI", "Burundi", 29.9, -3.4], ["BEL", "Belgium", 4.5, 50.6], ["BEN", "Benin", 2.3, 9.3],
  ["BFA", "Burkina Faso", -1.6, 12.3], ["BGD", "Bangladesh", 90.4, 23.7], ["BGR", "Bulgaria", 25.5, 42.7],
  ["BHR", "Bahrain", 50.6, 26.0], ["BIH", "Bosnia and Herzegovina", 17.8, 44.2], ["BLR", "Belarus", 28.0, 53.7],
  ["BLZ", "Belize", -88.7, 17.2], ["BOL", "Bolivia", -64.7, -16.3], ["BRA", "Brazil", -51.9, -14.2],
  ["BRN", "Brunei", 114.7, 4.5], ["BTN", "Bhutan", 90.4, 27.5], ["BWA", "Botswana", 24.7, -22.3],
  ["CAF", "Central African Republic", 20.9, 6.6], ["CAN", "Canada", -79.4, 45.4], ["CHE", "Switzerland", 8.2, 46.8],
  ["CHL", "Chile", -70.7, -33.4], ["CHN", "China", 112.0, 32.0], ["CIV", "Côte d'Ivoire", -5.5, 7.5],
  ["CMR", "Cameroon", 12.4, 5.7], ["COD", "DR Congo", 23.7, -2.9], ["COG", "Republic of the Congo", 15.8, -0.7],
  ["COL", "Colombia", -74.3, 4.6], ["CRI", "Costa Rica", -84.0, 9.9], ["CUB", "Cuba", -79.5, 21.5],
  ["CYP", "Cyprus", 33.4, 35.1], ["CZE", "Czechia", 15.5, 49.8], ["DEU", "Germany", 10.4, 51.2],
  ["DJI", "Djibouti", 42.6, 11.8], ["DNK", "Denmark", 9.5, 56.0], ["DOM", "Dominican Republic", -70.2, 18.7],
  ["DZA", "Algeria", 3.0, 28.0], ["ECU", "Ecuador", -78.2, -1.8], ["EGY", "Egypt", 30.8, 26.8],
  ["ERI", "Eritrea", 39.0, 15.2], ["ESP", "Spain", -3.7, 40.4], ["EST", "Estonia", 25.0, 58.6],
  ["ETH", "Ethiopia", 40.5, 9.1], ["FIN", "Finland", 25.7, 61.9], ["FJI", "Fiji", 178.1, -17.7],
  ["FRA", "France", 2.2, 46.2], ["GAB", "Gabon", 11.6, -0.8], ["GBR", "United Kingdom", -1.5, 52.4],
  ["GEO", "Georgia", 43.4, 42.3], ["GHA", "Ghana", -1.0, 7.9], ["GIN", "Guinea", -9.7, 9.9],
  ["GMB", "Gambia", -15.3, 13.4], ["GNB", "Guinea-Bissau", -15.2, 12.0], ["GNQ", "Equatorial Guinea", 10.3, 1.6],
  ["GRC", "Greece", 21.8, 39.1], ["GTM", "Guatemala", -90.2, 15.8], ["GUY", "Guyana", -58.9, 4.9],
  ["HND", "Honduras", -86.2, 15.2], ["HRV", "Croatia", 15.2, 45.1], ["HTI", "Haiti", -72.3, 19.0],
  ["HUN", "Hungary", 19.5, 47.2], ["IDN", "Indonesia", 110.0, -6.5], ["IND", "India", 78.9, 21.0],
  ["IRL", "Ireland", -8.2, 53.4], ["IRN", "Iran", 53.7, 32.4], ["IRQ", "Iraq", 43.7, 33.2],
  ["ISL", "Iceland", -19.0, 64.9], ["ISR", "Israel", 34.9, 31.5], ["ITA", "Italy", 12.6, 42.5],
  ["JAM", "Jamaica", -77.3, 18.1], ["JOR", "Jordan", 36.2, 31.2], ["JPN", "Japan", 138.3, 36.2],
  ["KAZ", "Kazakhstan", 66.9, 48.0], ["KEN", "Kenya", 37.9, -0.0], ["KGZ", "Kyrgyzstan", 74.8, 41.2],
  ["KHM", "Cambodia", 104.9, 12.6], ["KOR", "South Korea", 127.8, 36.5], ["KWT", "Kuwait", 47.5, 29.3],
  ["LAO", "Laos", 102.5, 19.9], ["LBN", "Lebanon", 35.9, 33.9], ["LBR", "Liberia", -9.4, 6.4],
  ["LBY", "Libya", 17.2, 26.3], ["LKA", "Sri Lanka", 80.8, 7.9], ["LTU", "Lithuania", 23.9, 55.2],
  ["LUX", "Luxembourg", 6.1, 49.8], ["LVA", "Latvia", 24.6, 56.9], ["MAR", "Morocco", -7.1, 31.8],
  ["MDA", "Moldova", 28.4, 47.4], ["MDG", "Madagascar", 46.9, -18.8], ["MEX", "Mexico", -102.6, 23.6],
  ["MKD", "North Macedonia", 21.7, 41.6], ["MLI", "Mali", -4.0, 17.6], ["MMR", "Myanmar", 96.0, 21.9],
  ["MNG", "Mongolia", 103.8, 46.9], ["MOZ", "Mozambique", 35.5, -18.7], ["MRT", "Mauritania", -10.9, 21.0],
  ["MUS", "Mauritius", 57.6, -20.3], ["MWI", "Malawi", 34.3, -13.3], ["MYS", "Malaysia", 101.9, 4.2],
  ["NAM", "Namibia", 18.5, -22.6], ["NER", "Niger", 8.1, 17.6], ["NGA", "Nigeria", 8.7, 9.1],
  ["NIC", "Nicaragua", -85.2, 12.9], ["NLD", "Netherlands", 5.3, 52.1], ["NOR", "Norway", 8.5, 60.5],
  ["NPL", "Nepal", 84.1, 28.4], ["NZL", "New Zealand", 174.9, -40.9], ["OMN", "Oman", 55.9, 21.5],
  ["PAK", "Pakistan", 69.3, 30.4], ["PAN", "Panama", -80.8, 8.5], ["PER", "Peru", -75.0, -9.2],
  ["PHL", "Philippines", 121.8, 12.9], ["PNG", "Papua New Guinea", 143.9, -6.3], ["POL", "Poland", 19.1, 51.9],
  ["PRT", "Portugal", -8.2, 39.4], ["PRY", "Paraguay", -58.4, -23.4], ["QAT", "Qatar", 51.2, 25.4],
  ["ROU", "Romania", 25.0, 45.9], ["RUS", "Russia", 37.6, 55.8], ["RWA", "Rwanda", 29.9, -1.9],
  ["SAU", "Saudi Arabia", 45.1, 23.9], ["SDN", "Sudan", 30.2, 12.9], ["SEN", "Senegal", -14.5, 14.5],
  ["SGP", "Singapore", 103.8, 1.35], ["SLE", "Sierra Leone", -11.8, 8.5], ["SLV", "El Salvador", -88.9, 13.8],
  ["SOM", "Somalia", 46.2, 5.2], ["SRB", "Serbia", 21.0, 44.0], ["SSD", "South Sudan", 31.3, 6.9],
  ["SVK", "Slovakia", 19.7, 48.7], ["SVN", "Slovenia", 14.9, 46.2], ["SWE", "Sweden", 18.6, 60.1],
  ["SYR", "Syria", 38.9, 34.8], ["TCD", "Chad", 18.7, 15.5], ["TGO", "Togo", 0.8, 8.6],
  ["THA", "Thailand", 101.0, 15.9], ["TJK", "Tajikistan", 71.3, 38.9], ["TKM", "Turkmenistan", 59.6, 38.97],
  ["TUN", "Tunisia", 9.5, 33.9], ["TUR", "Türkiye", 35.2, 39.0], ["TWN", "Taiwan", 121.0, 23.7],
  ["TZA", "Tanzania", 34.9, -6.4], ["UGA", "Uganda", 32.3, 1.4], ["UKR", "Ukraine", 31.2, 48.4],
  ["URY", "Uruguay", -55.8, -32.5], ["USA", "United States", -95.7, 37.1], ["UZB", "Uzbekistan", 64.6, 41.4],
  ["VEN", "Venezuela", -66.6, 6.4], ["VNM", "Vietnam", 106.0, 14.5], ["YEM", "Yemen", 48.5, 15.6],
  ["ZAF", "South Africa", 24.7, -28.5], ["ZMB", "Zambia", 27.8, -13.1], ["ZWE", "Zimbabwe", 29.2, -19.0],
];

/** The lookup as a Map from upper-case ISO3 code to { id, name, lon, lat }. */
export const COUNTRY_POINTS = new Map(ROWS.map(([id, name, lon, lat]) => [id, Object.freeze({ id, name, lon, lat })]));

/** A lookup object the Flow Map engine accepts. */
export function countryPointLookup() {
  return {
    id: COUNTRY_POINTS_ID,
    revision: COUNTRY_POINTS_REVISION,
    credit: COUNTRY_POINTS_CREDIT,
    normalizeKey: (value) => String(value ?? "").trim().toUpperCase(),
    resolve(key) {
      const point = COUNTRY_POINTS.get(key);
      return point ? { status: "ok", point } : { status: "unmatched" };
    },
  };
}

/**
 * A lookup built from a loaded point layer's rows: [{ key, name, lon, lat }].
 * Keys that appear more than once are reported as ambiguous, never guessed.
 */
export function pointLayerLookup(points, { id = "point-layer", revision = null, credit = "" } = {}) {
  const byKey = new Map();
  for (const point of points || []) {
    const key = String(point?.key ?? "").trim();
    if (!key) continue;
    const list = byKey.get(key) || [];
    list.push(point);
    byKey.set(key, list);
  }
  return {
    id, revision, credit,
    normalizeKey: (value) => String(value ?? "").trim(),
    resolve(key) {
      const matches = byKey.get(key);
      if (!matches?.length) return { status: "unmatched" };
      if (matches.length > 1) return { status: "ambiguous", count: matches.length };
      const [match] = matches;
      return { status: "ok", point: { id: key, name: match.name || key, lon: Number(match.lon), lat: Number(match.lat) } };
    },
  };
}
