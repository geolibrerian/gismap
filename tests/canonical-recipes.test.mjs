// The six canonical agent workflows as permanent regression scenarios. Each keeps
// its request, dataset, expected artifact, rendered behavior, exports, checks and
// limits. Offline tests decode the published links; GISMAP_LIVE_TESTS=1 also
// checks the public sources. Rendering is checked in a browser (see each
// recipe example's `checks`), not here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateMapSpec } from "../js/map-spec.js";
import { readShareLocation } from "../js/map-share.js";
import { decodeEmbeddedTour, TOUR_SHARE_LIMITS } from "../js/tour-share.js";
import { decodeFieldTask, FIELD_TASK_LIMITS } from "../js/field-task-share.js";
import { BASEMAP_IDS } from "../js/basemap-catalog.js";
import { INTERFACE_SKINS } from "../js/skin-catalog.js";
import { COLLEGES_URL, GRAPE_3D, GRAPE_MAP, GRAPE_URL, HALLOWEEN_COLLEGES, PARK_TASK, SF_TOUR } from "../scripts/agent-recipes.mjs";

const json = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
const recipe = (id) => json(`api/agent-recipes/${id}.json`);
const exampleFor = async (id, title) => (await recipe(id)).examples.find((item) => item.title.startsWith(title));
const specOf = async (url) => (await readShareLocation(new URL(url))).spec;
const live = { skip: process.env.GISMAP_LIVE_TESTS !== "1", timeout: 60000 };
const query = async (url, params) => (await fetch(`${url}/query?${new URLSearchParams({ f: "json", ...params })}`)).json();

export const SCENARIOS = Object.freeze({
  grape: { request: "Create a California grape production map, counties over 1,000 acres, purple choropleth; give me a link, PDF, QR card and Smart Map PNG.", dataset: GRAPE_URL, rendered: "26 counties in a five-class purple quantile choropleth with a legend", exports: "Link from the spec; Smart Map PNG via smartImages.downloadCurrent; PDF and QR card in the app UI", limits: "No in-page map PDF or map QR method" },
  philly: { request: "Build a Philadelphia police briefing: one slide per area, highlighted, with context from a second layer.", dataset: "Philadelphia Police Divisions and Districts", rendered: "Nine-slide deck; each slide frames and highlights its feature", exports: "briefing.createLink, exportPdf, exportQrCard", limits: "Crime-incident points per district are not yet in the published example" },
  sfTour: { request: "Tour Golden Gate Bridge, Palace of Fine Arts, Coit Tower, Ferry Building and Bay Bridge on satellite imagery.", dataset: "OpenStreetMap Nominatim coordinates", rendered: "Five chapters in order over aerial imagery, tilted cameras", exports: "Tour-only link under 2,800 characters", limits: "Camera-only; MapLibre satellite is a street map, so usgs-imagery is used" },
  park: { request: "Create five inspection tasks for a city park.", dataset: "OpenStreetMap Nominatim coordinates", rendered: "Task panel with the park location, five steps and check-in", exports: "Assignment link; report link comes back from the field", limits: "Tasks are steps without per-step evidence rules; photos stay on the device" },
  grape3d: { request: "Extrude California grape counties over 1,000 acres by acres × 0.01 with a purple ramp and a tilted camera.", dataset: GRAPE_URL, rendered: "Purple class-break extrusions, tallest about 1.6 km, camera tilted 60°", exports: "Link from the spec", limits: "MapLibre accepts only field × number expressions" },
  halloween: { request: "Halloween-themed map of California colleges with a matching skin.", dataset: COLLEGES_URL, rendered: "Velvet Orbit skin and skin basemap; amber, pumpkin and green college symbols", exports: "Link from the spec", limits: "Only preset skins travel in links; labels are not configurable" },
});

test("1. grape production map: filter, purple choropleth, link round trip", async () => {
  const example = await exampleFor("interactive-map", "California grape production");
  const { valid, issues } = validateMapSpec(GRAPE_MAP);
  assert.ok(valid, JSON.stringify(issues));
  assert.deepEqual(await specOf(example.url), GRAPE_MAP);
  const [layer] = GRAPE_MAP.layers;
  assert.equal(layer.where, "STATE_ABBR = 'CA' AND GRAPES_ACRES_BEAR_NON_BEAR_TOT > 1000");
  assert.deepEqual([layer.renderer.type, layer.renderer.field, layer.renderer.ramp], ["choropleth", "GRAPES_ACRES_BEAR_NON_BEAR_TOT", "purples"]);
  const outputs = (await recipe("interactive-map")).outputs.map((item) => item.format).join(" | ");
  for (const format of [/link/i, /Smart Map PNG/, /PDF/, /QR/]) assert.match(outputs, format);
});

test("2. Philadelphia briefing: slides, primary and context layers survive the link", async () => {
  const example = await exampleFor("interactive-briefing", "Philadelphia");
  const shared = await readShareLocation(new URL(example.url));
  const briefing = shared.briefing || shared.payload?.briefing || shared.document;
  assert.ok(briefing?.slides?.length >= 2, "briefing slides decode");
  assert.ok(JSON.stringify(shared).includes("Police"), "layers decode");
  assert.ok(example.checks.some((line) => /crime/i.test(line)), "the missing crime-incident example is disclosed");
});

test("3. San Francisco tour: ordered stops, cameras and imagery basemap", async () => {
  const example = await exampleFor("geographic-tour", "San Francisco");
  assert.ok(example.url.length <= TOUR_SHARE_LIMITS.maxUrlLength);
  const tour = decodeEmbeddedTour(new URL(example.url).hash.slice("#tour=".length), new Set(BASEMAP_IDS));
  assert.deepEqual(tour.chapters.map((chapter) => chapter.title), ["Golden Gate Bridge", "Palace of Fine Arts", "Coit Tower", "Ferry Building", "Bay Bridge"]);
  tour.chapters.forEach((chapter, index) => {
    assert.equal(chapter.basemapId, "usgs-imagery");
    assert.ok(chapter.viewState.tilt >= 45);
    assert.deepEqual(chapter.viewState.center, SF_TOUR.chapters[index].viewState.center);
  });
  assert.equal(new URL(example.url).searchParams.get("tourOnly"), "1");
});

test("4. park inspection: five location-specific tasks in one package", async () => {
  const example = await exampleFor("field-tasks", "Mission Dolores Park");
  const { kind, task } = decodeFieldTask(new URL(example.url).hash.slice("#fieldTask=".length));
  assert.equal(kind, "assign");
  assert.deepEqual([task.latitude, task.longitude], [PARK_TASK.latitude, PARK_TASK.longitude]);
  assert.deepEqual(task.steps.map((step) => step.text), PARK_TASK.steps.map((step) => step.text));
  assert.equal(task.steps.length, 5);
  assert.ok(FIELD_TASK_LIMITS.maxSteps >= 5 && task.steps.every((step) => !step.done), "an assignment carries no completion");
});

test("5. 3D grape production: field × 0.01 extrusion, tilted camera, serialization", async () => {
  const example = await exampleFor("3d-extrusion", "California grape acreage in 3D");
  assert.ok(validateMapSpec(GRAPE_3D).valid);
  assert.deepEqual(await specOf(example.url), GRAPE_3D);
  const { json: renderer } = GRAPE_3D.layers[0].renderer;
  // The only Arcade form MapLibre compiles (js/engines/maplibre/maplibre-engine.js).
  assert.match(renderer.visualVariables[0].valueExpression, /^\$feature\["GRAPES_ACRES_BEAR_NON_BEAR_TOT"\]\s*\*\s*0\.01$/);
  assert.ok(renderer.classBreakInfos.every((info) => info.symbol.symbolLayers[0].type === "Extrude"));
  assert.ok(GRAPE_3D.camera.tilt >= 45);
});

test("6. Halloween colleges: preset skin, skin basemap and themed symbols persist", async () => {
  const example = await exampleFor("vibe-map", "Halloween");
  assert.ok(validateMapSpec(HALLOWEEN_COLLEGES).valid);
  const spec = await specOf(example.url);
  assert.deepEqual([spec.skin, spec.basemap], ["velvet-orbit", "skin"]);
  assert.ok(INTERFACE_SKINS.some((skin) => skin.id === spec.skin && skin.tone === "dark"));
  assert.deepEqual(Object.values(spec.layers[0].renderer.colors), ["#ffb000", "#ff7518", "#7cfc00"]);
  assert.ok((await recipe("vibe-map")).limitations.some((line) => /preset skins/.test(line)), "custom palette limits are disclosed");
});

test("every scenario keeps its request, data, expected behavior, exports and limits", () => {
  for (const [name, scenario] of Object.entries(SCENARIOS)) for (const key of ["request", "dataset", "rendered", "exports", "limits"]) assert.ok(scenario[key], `${name}.${key}`);
});

test("live: scenario sources still have their fields and matching features", live, async () => {
  const grape = await query(GRAPE_URL, { where: GRAPE_MAP.layers[0].where, returnCountOnly: "true" });
  assert.equal(grape.count, 26);
  const colleges = await query(COLLEGES_URL, { where: HALLOWEEN_COLLEGES.layers[0].where, returnCountOnly: "true" });
  assert.ok(colleges.count > 200);
  const meta = await (await fetch(`${COLLEGES_URL}?f=json`)).json();
  for (const field of ["STABBR", "ICLEVEL", "CONTROL"]) assert.ok(meta.fields.some((item) => item.name === field), field);
});
