// Tables for the Flow Map editor that are not map layers: the bundled demos,
// and tables the author adds from a file or a link. Origin–destination tables
// rarely have one point per row, so they are read as plain rows here rather
// than through the map's point-layer import (which drops rows without
// coordinates). Added tables stay on this device for this page session.

import { BEVERAGE_FIXTURE_CREDIT, BEVERAGE_FIXTURE_FIELDS, BEVERAGE_FIXTURE_ID, BEVERAGE_FIXTURE_NAME, beverageFixtureRecipe, beverageFixtureRows } from "./flow-fixtures.js";
import { LOCAL_ROW_LIMIT } from "./flow-map.js";
import { googleSheetCsvUrl, isSpreadsheetName, parseDelimited, readSpreadsheet } from "../spreadsheet-import.js?v=0.65.8-made-with";

export const TABLE_FILE_ACCEPT = ".csv,.tsv,.tab,.txt,.xlsx,.xlsm,.ods,.json,.geojson";
export const MAX_TABLE_BYTES = 30 * 1024 * 1024;

// ---------------------------------------------------------------- inference

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;
// "007" or "0412" are codes, not numbers: keep their leading zeros.
const CODE_LIKE = /^[-+]?0\d/;

/** A column's type from its non-empty values: integer, double or string. */
export function inferColumnType(values) {
  let sawValue = false, integer = true;
  for (const raw of values) {
    const value = String(raw ?? "").trim();
    if (!value) continue;
    sawValue = true;
    if (!NUMBER.test(value) || CODE_LIKE.test(value)) return "string";
    if (!Number.isInteger(Number(value))) integer = false;
  }
  return sawValue ? (integer ? "integer" : "double") : "string";
}

const uniqueHeaders = (headers) => {
  const seen = new Map();
  return headers.map((header, index) => {
    const base = String(header ?? "").trim() || `Column ${index + 1}`;
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count ? `${base}_${count + 1}` : base;
  });
};

/**
 * { headers, rows } of cell text to a table: typed fields and attribute
 * objects. Empty cells become null, so a missing weight is never read as zero.
 */
export function tableFromCells({ headers, rows }, { id, name, credit = "", kind = "file" } = {}) {
  const names = uniqueHeaders(headers);
  const types = names.map((_, column) => inferColumnType(rows.map((row) => row[column])));
  const fields = names.map((field, column) => ({ name: field, alias: field, type: types[column] }));
  const records = rows.map((row) => Object.fromEntries(names.map((field, column) => {
    const value = String(row[column] ?? "").trim();
    if (!value) return [field, null];
    return [field, types[column] === "string" ? value : Number(value)];
  })));
  return { id, name, credit, kind, fields, rows: records, truncated: false };
}

/** JSON to a table: an array of objects, { data | rows | records: [...] }, or GeoJSON features' properties. */
export function tableFromJson(value, options = {}) {
  const list = Array.isArray(value) ? value
    : Array.isArray(value?.features) ? value.features.map((feature) => feature?.properties || {})
    : Array.isArray(value?.data) ? value.data : Array.isArray(value?.rows) ? value.rows : Array.isArray(value?.records) ? value.records : null;
  if (!list) throw new Error("This JSON is not a table. Use an array of objects or a GeoJSON FeatureCollection.");
  const objects = list.filter((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!objects.length) throw new Error("This JSON has no rows.");
  const headers = [...new Set(objects.slice(0, 2000).flatMap((item) => Object.keys(item)))];
  const cell = (item) => (item === null || item === undefined ? "" : typeof item === "object" ? JSON.stringify(item) : String(item));
  return tableFromCells({ headers, rows: objects.map((item) => headers.map((header) => cell(item[header]))) }, options);
}

/** Text that is either JSON or delimited text, by its first character. */
export function tableFromText(text, options = {}) {
  const trimmed = String(text ?? "").replace(/^﻿/, "").trimStart();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    let parsed;
    try { parsed = JSON.parse(trimmed); } catch { throw new Error("This JSON could not be read."); }
    return tableFromJson(parsed, options);
  }
  const cells = parseDelimited(trimmed);
  if (cells.length < 2) throw new Error("The table needs a header row and at least one row of data.");
  return tableFromCells({ headers: cells[0], rows: cells.slice(1) }, options);
}

const limitRows = (table) => (table.rows.length > LOCAL_ROW_LIMIT ? { ...table, rows: table.rows.slice(0, LOCAL_ROW_LIMIT), truncated: true, totalRows: table.rows.length } : table);
const fileStem = (name) => String(name || "table").replace(/\.[^.]+$/, "");

/** Read a file the author picked. Nothing is uploaded. */
export async function readTableFile(file, { zipLibrary = globalThis.JSZip } = {}) {
  if (file.size > MAX_TABLE_BYTES) throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(0)} MB; the limit is ${MAX_TABLE_BYTES / 1048576} MB. Aggregate it first, or narrow it to the flows you need.`);
  const options = { id: `table:file:${file.name}:${file.size}:${file.lastModified || 0}`, name: fileStem(file.name), credit: file.name, kind: "file" };
  const extension = String(file.name).split(".").pop().toLowerCase();
  if (["json", "geojson"].includes(extension)) return limitRows(tableFromText(await file.text(), options));
  if (!isSpreadsheetName(file.name)) throw new Error(`${file.name} is not a table GISMap can read here. Use CSV, TSV, Excel (.xlsx), OpenDocument (.ods), JSON or GeoJSON.`);
  const sheet = await readSpreadsheet(file, { zipLibrary });
  return limitRows(tableFromCells(sheet, options));
}

/** Read a CSV or JSON link, or a public Google Sheet. */
export async function readTableUrl(value, { fetchText = defaultFetchText } = {}) {
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error("Enter a full link, starting with https://."); }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http and https links can be read.");
  const sheet = googleSheetCsvUrl(url.href);
  const address = sheet || url.href;
  const text = await fetchText(address);
  const name = sheet ? "Google Sheet" : decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || url.hostname);
  return limitRows(tableFromText(text, { id: `table:url:${address}`, name: fileStem(name), credit: `${url.hostname}${url.pathname}`, kind: "url" }));
}

async function defaultFetchText(address) {
  let response;
  try { response = await fetch(address, { credentials: "omit" }); }
  catch { throw new Error("The link could not be read. Its server may not allow other sites to read it (CORS); download the file and use Add a file instead."); }
  if (!response.ok) throw new Error(`The link answered ${response.status}${response.status === 401 || response.status === 403 ? ": it may need a sign-in, or the sheet may not be shared publicly" : ""}.`);
  return response.text();
}

// ---------------------------------------------------------------- demos

const COMMUTE_ID = "demo:randstad-commutes";
const PACIFIC_ID = "demo:pacific-air";
const ILLUSTRATIVE = "Illustrative demo data bundled with GISMap Online; not real statistics";

const RANDSTAD = { Amsterdam: [4.9, 52.37], Rotterdam: [4.48, 51.92], "The Hague": [4.3, 52.08], Utrecht: [5.12, 52.09], Haarlem: [4.64, 52.38], Leiden: [4.49, 52.16], Amersfoort: [5.39, 52.16], Almere: [5.21, 52.37] };
const COMMUTES = [
  ["Almere", "Amsterdam", "rail", 21000], ["Almere", "Amsterdam", "road", 17000], ["Haarlem", "Amsterdam", "rail", 15000], ["Haarlem", "Amsterdam", "road", 9000],
  ["Utrecht", "Amsterdam", "rail", 14000], ["Amsterdam", "Utrecht", "rail", 9000], ["Amersfoort", "Utrecht", "rail", 8000], ["Amersfoort", "Utrecht", "road", 7500],
  ["Leiden", "The Hague", "rail", 7000], ["The Hague", "Rotterdam", "rail", 9500], ["Rotterdam", "The Hague", "rail", 8500], ["Rotterdam", "The Hague", "road", 6000],
  ["Leiden", "Amsterdam", "rail", 6500], ["Utrecht", "Rotterdam", "road", 4500], ["Amersfoort", "Amsterdam", "rail", 5000], ["The Hague", "Amsterdam", "rail", 5500],
];
const PACIFIC = { "Los Angeles": [-118.24, 34.05], "San Francisco": [-122.42, 37.77], Vancouver: [-123.12, 49.28], Honolulu: [-157.86, 21.31], Tokyo: [139.69, 35.69], Seoul: [126.98, 37.57], Sydney: [151.21, -33.87], Auckland: [174.76, -36.85], Manila: [120.98, 14.6] };
const PACIFIC_FLIGHTS = [
  ["Los Angeles", "Tokyo", 1900], ["Tokyo", "Los Angeles", 1850], ["San Francisco", "Tokyo", 1200], ["Los Angeles", "Seoul", 1100], ["Los Angeles", "Sydney", 950],
  ["Sydney", "Los Angeles", 900], ["Vancouver", "Tokyo", 600], ["Honolulu", "Tokyo", 1500], ["Tokyo", "Honolulu", 1450], ["Los Angeles", "Manila", 700],
  ["San Francisco", "Seoul", 650], ["Auckland", "Los Angeles", 500], ["San Francisco", "Sydney", 450], ["Vancouver", "Seoul", 300], ["Honolulu", "Sydney", 250],
];

const field = (name, alias, type) => ({ name, alias, type });

function commuteTable() {
  const rows = COMMUTES.map(([origin, destination, mode, trips]) => ({
    origin_city: origin, origin_lon: RANDSTAD[origin][0], origin_lat: RANDSTAD[origin][1],
    destination_city: destination, destination_lon: RANDSTAD[destination][0], destination_lat: RANDSTAD[destination][1],
    mode, daily_trips: trips,
  }));
  return {
    id: COMMUTE_ID, name: "Randstad commuting demo (illustrative)", credit: ILLUSTRATIVE, kind: "demo", rows,
    fields: [field("origin_city", "Origin city", "string"), field("origin_lon", "Origin longitude", "double"), field("origin_lat", "Origin latitude", "double"), field("destination_city", "Destination city", "string"), field("destination_lon", "Destination longitude", "double"), field("destination_lat", "Destination latitude", "double"), field("mode", "Mode", "string"), field("daily_trips", "Daily trips", "integer")],
    recipe: {
      title: "Who commutes into Amsterdam?",
      subtitle: "Weekday commuting trips between Randstad cities, by mode. Illustrative demo data.",
      bindings: { mode: "coordinates", origin: { idField: "origin_city", lonField: "origin_lon", latField: "origin_lat" }, destination: { idField: "destination_city", lonField: "destination_lon", latField: "destination_lat" }, weight: { field: "daily_trips", unit: "trips/day" }, categoryField: "mode" },
      design: { layout: "wide", theme: "editorial-light", projection: "regional", topN: 30 },
      annotations: [{ id: "note-1", anchor: { type: "flow", key: "Almere>Amsterdam|rail" }, text: "Almere's rail commute is the single largest corridor." }],
    },
  };
}

function pacificTable() {
  const rows = [2023, 2024].flatMap((year) => PACIFIC_FLIGHTS.map(([origin, destination, passengers]) => ({
    from_airport: origin, from_lon: PACIFIC[origin][0], from_lat: PACIFIC[origin][1],
    to_airport: destination, to_lon: PACIFIC[destination][0], to_lat: PACIFIC[destination][1],
    year, passengers_k: year === 2023 ? Math.round(passengers * 0.88) : passengers,
  })));
  return {
    id: PACIFIC_ID, name: "Trans-Pacific air passengers demo (illustrative, 2 years)", credit: ILLUSTRATIVE, kind: "demo", rows,
    fields: [field("from_airport", "From", "string"), field("from_lon", "From longitude", "double"), field("from_lat", "From latitude", "double"), field("to_airport", "To", "string"), field("to_lon", "To longitude", "double"), field("to_lat", "To latitude", "double"), field("year", "Year", "integer"), field("passengers_k", "Passengers (thousands)", "integer")],
    recipe: {
      title: "Across the Pacific",
      subtitle: "Air passengers between Pacific gateway cities, in thousands. Illustrative demo data with two years: choose one, or sum them.",
      bindings: { mode: "coordinates", origin: { idField: "from_airport", lonField: "from_lon", latField: "from_lat" }, destination: { idField: "to_airport", lonField: "to_lon", latField: "to_lat" }, weight: { field: "passengers_k", unit: "k passengers" }, periodField: "year" },
      query: { period: 2024 },
      design: { layout: "wide", theme: "editorial-light", projection: "world", topN: 30 },
    },
  };
}

function beverageTable() {
  return { id: BEVERAGE_FIXTURE_ID, name: BEVERAGE_FIXTURE_NAME, credit: BEVERAGE_FIXTURE_CREDIT, kind: "demo", fields: BEVERAGE_FIXTURE_FIELDS.slice(), rows: beverageFixtureRows(), recipe: beverageFixtureRecipe() };
}

const DEMOS = [beverageTable, commuteTable, pacificTable];

/** Fresh copies of the bundled demos. */
export const demoTables = () => DEMOS.map((build) => build());

// Tables added in this page session, newest first. Kept on this device only.
const added = new Map();

export function addUserTable(table) {
  added.delete(table.id);
  added.set(table.id, table);
  return table;
}
export const userTables = () => [...added.values()].reverse();
export const removeUserTable = (id) => added.delete(id);

/** Every table the editor can offer, demos first. */
export function tableById(id) {
  return added.get(id) || demoTables().find((table) => table.id === id) || null;
}
export const isTableSource = (id) => typeof id === "string" && (id.startsWith("demo:") || id.startsWith("fixture:") || id.startsWith("table:"));
