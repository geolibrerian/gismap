import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { chooseBreakMethod, chooseStyleField, compileRenderer, describeValues, resolveRendererSpec, suggestRenderers, validateRendererSpec } from "../js/renderer-spec.js";
import { rendererSpecFromParameters } from "../js/map-spec.js";
import { parseShareParameters } from "../js/share.js";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const { values: CORN } = await json("./fixtures/corn-sales-values.json");
const cornLayer = await json("./fixtures/corn-layer.json");
const FIELD = "CORN_SALES_IN_DOLLARS";

test("corn sales are skewed, so quantile classes are chosen, with -1 left out", () => {
  const stats = describeValues(CORN, { exclude: [-1] });
  assert.equal(stats.excluded, 546);
  assert.equal(stats.count, 3074 - 546);
  assert.equal(stats.min, 0);
  assert.ok(stats.skew > 1, `skew ${stats.skew}`);
  assert.equal(chooseBreakMethod(stats).method, "quantile");
  assert.equal(chooseBreakMethod(describeValues([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).method, "equal-interval");
});

test("the style field is a measurement, never an ID, code or shape field", () => {
  assert.equal(chooseStyleField(cornLayer.fields), FIELD);
  assert.equal(chooseStyleField([{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "Shape__Area", type: "esriFieldTypeDouble" }, { name: "FIPS", type: "esriFieldTypeInteger" }, { name: "depth", type: "double" }]), "depth");
  assert.equal(chooseStyleField([{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "status", type: "esriFieldTypeString" }]), "status");
  assert.equal(chooseStyleField([{ name: "OBJECTID", type: "esriFieldTypeOID" }]), null);
});

test("polygon suggestions: three colour styles, quantile first, each with valid pinned breaks", () => {
  const { stats, options } = suggestRenderers({ field: FIELD, fieldType: "esriFieldTypeInteger", geometryType: "esriGeometryPolygon", values: CORN, exclude: [-1] });
  assert.equal(stats.excluded, 546);
  assert.deepEqual(options.map((option) => option.id), ["choropleth-quantile", "choropleth-natural-breaks", "choropleth-equal-interval"]);
  assert.deepEqual(options.map((option) => option.recommended), [true, false, false]);
  assert.match(options[0].reason, /skewed/);
  assert.match(options[0].reason, /546 features with -1 are drawn as "No data"/);
  for (const option of options) {
    assert.deepEqual(option.spec.exclude, [-1]);
    assert.equal(option.spec.ramp, "greens");
    assert.ok(option.breaks.every((value, index) => !index || value > option.breaks[index - 1]), "breaks increase");
    const { valid, spec } = validateRendererSpec(option.pinnedSpec, { fields: cornLayer.fields.map((field) => ({ name: field.name, type: field.type })) });
    assert.equal(valid, true);
    assert.deepEqual(spec.breaks, option.breaks);
  }
  // Quantile classes hold about the same number of counties each.
  const kept = CORN.filter((value) => value !== -1);
  const counts = options[0].breaks.map((upper, index) => kept.filter((value) => value <= upper && (index === 0 || value > options[0].breaks[index - 1])).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) < kept.length * 0.1, `class sizes ${counts}`);
});

test("points, lines, text, constant, signed and coded fields get suitable options", () => {
  const points = suggestRenderers({ field: "mag", geometryType: "point", values: [1, 2, 2, 3, 3, 3, 4, 5, 6, 9, 1.5, 2.5, 4.4, 7.1, 3.3, 2.2, 1.1, 5.5, 6.6, 8.8, 2.9] });
  assert.equal(points.options[0].spec.type, "graduated-symbols");
  assert.ok(points.options.some((option) => option.id === "heatmap" && option.spec.field === "mag"));
  assert.ok(points.options.some((option) => option.spec.type === "choropleth"));
  const lines = suggestRenderers({ field: "flow", geometryType: "polyline", values: [1, 5, 9, 20, 40, 80, 160] });
  assert.equal(lines.options[0].spec.type, "choropleth");
  assert.ok(lines.options.some((option) => option.spec.type === "graduated-symbols"));
  const text = suggestRenderers({ field: "state", fieldType: "esriFieldTypeString", geometryType: "polygon", values: ["Iowa", "Ohio", "Iowa", null] });
  assert.deepEqual(text.options.map((option) => option.spec), [{ type: "categories", field: "state", maxCategories: 2 }]);
  assert.equal(text.options[0].recommended, true);
  const constant = suggestRenderers({ field: "x", values: [4, 4, 4] });
  assert.deepEqual(constant.options.map((option) => option.spec.type), ["simple"]);
  const signed = suggestRenderers({ field: "change", values: [-30, -10, -2, 0, 3, 12, 40] });
  assert.equal(signed.options[0].spec.ramp, "red-blue-diverging");
  const coded = suggestRenderers({ field: "rating", values: [1, 2, 3, 3, 4, 5, 5, 5, 2, 1] });
  assert.ok(coded.options.some((option) => option.spec.type === "categories"));
  assert.equal(coded.options[0].spec.classes, 3, "few features get fewer classes");
  assert.deepEqual(suggestRenderers({ field: "empty", values: [null, undefined] }).options, []);
});

test("auto and breaks validate; bad breaks are reported", () => {
  assert.equal(validateRendererSpec({ type: "auto" }).valid, true);
  assert.equal(validateRendererSpec({ type: "auto", field: "NOPE" }, { fields: [{ name: FIELD, type: "integer" }] }).issues[0].code, "FIELD_NOT_FOUND");
  assert.equal(validateRendererSpec({ type: "choropleth", field: FIELD, method: "auto" }).spec.method, "auto");
  const fixed = validateRendererSpec({ type: "graduated-symbols", field: FIELD, classes: 7, breaks: [10, 100, 1000] });
  assert.equal(fixed.valid, true);
  assert.equal(fixed.spec.classes, 3, "breaks set the class count");
  for (const breaks of [[], [5, 5], [3, 2], ["1"], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]]) {
    assert.equal(validateRendererSpec({ type: "choropleth", field: FIELD, breaks }).issues[0]?.path, "renderer.breaks", JSON.stringify(breaks));
  }
});

test("explicit breaks draw exactly, stretched to take in every value", () => {
  const renderer = compileRenderer({ type: "choropleth", field: "v", breaks: [10, 100, 1000], ramp: "blues" }, { values: [1, 50, 500, 5000] });
  assert.deepEqual(renderer.classBreakInfos.map((info) => [info.minValue, info.maxValue]), [[1, 10], [10, 100], [100, 5000]]);
  // method "auto" without a resolve step still classes sensibly.
  const auto = compileRenderer({ type: "choropleth", field: FIELD, method: "auto", classes: 5, exclude: [-1] }, { values: CORN });
  const quantile = compileRenderer({ type: "choropleth", field: FIELD, method: "quantile", classes: 5, exclude: [-1] }, { values: CORN });
  assert.deepEqual(auto.classBreakInfos.map((info) => info.maxValue), quantile.classBreakInfos.map((info) => info.maxValue));
});

test("resolve decides auto and pins the breaks", () => {
  const method = resolveRendererSpec({ type: "choropleth", field: FIELD, method: "auto", classes: 5, ramp: "greens", exclude: [-1] }, { values: CORN });
  assert.equal(method.method, "quantile");
  assert.equal(method.breaks.length, method.classes);
  const whole = resolveRendererSpec({ type: "auto", field: FIELD, exclude: [-1] }, { values: CORN, fieldType: "esriFieldTypeInteger", geometryType: "polygon" });
  assert.equal(whole.type, "choropleth");
  assert.equal(whole.method, "quantile");
  assert.deepEqual(whole.exclude, [-1]);
  assert.equal(validateRendererSpec(whole).valid, true);
  assert.deepEqual(resolveRendererSpec(whole, { values: [] }), whole, "a resolved spec is left alone");
  assert.equal(resolveRendererSpec({ type: "auto", field: "x" }, { values: [] }).type, "simple");
});

test("?layer= links take style=auto, method and breaks", () => {
  const shared = parseShareParameters("?layer=https%3A%2F%2Fexample.org%2Farcgis%2Frest%2Fservices%2FA%2FFeatureServer%2F0&style=auto&field=POP&method=&breaks=&layer=https%3A%2F%2Fexample.org%2Farcgis%2Frest%2Fservices%2FB%2FFeatureServer%2F0&style=choropleth&field=POP&method=auto&breaks=10,100,1000");
  // Styling parameters are matched to layers by position; an empty value keeps a place.
  assert.deepEqual(rendererSpecFromParameters(shared.layers[0].style), { type: "auto", field: "POP" });
  assert.deepEqual(rendererSpecFromParameters(shared.layers[1].style), { type: "choropleth", field: "POP", method: "auto", breaks: [10, 100, 1000] });
});

test("the map resolves an auto style once, from one read of the data, and records it pinned", async () => {
  const { ArcGISEngine: MapController } = await import("../js/engines/arcgis/arcgis-engine.js");
  const map = new MapController({ publish() {} });
  const layer = { uid: "corn", title: "Corn", renderer: null, geometryType: "polygon", fields: cornLayer.fields.map((field) => ({ name: field.name, type: field.type })), load: async () => {} };
  map.map = { allLayers: [layer] };
  let reads = 0;
  map.fieldValues = async (_, field) => { reads += 1; assert.equal(field, FIELD); return CORN; };
  const sentinels = [{ field: FIELD, value: -1, label: "Not Disclosed", source: "renderer" }];
  const { spec } = await map.applyRendererSpec("corn", { type: "auto" }, { sentinels });
  assert.equal(reads, 1);
  assert.equal(spec.type, "choropleth");
  assert.equal(spec.field, FIELD);
  assert.equal(spec.method, "quantile");
  assert.deepEqual(spec.exclude, [-1]);
  assert.ok(spec.breaks.length >= 2);
  assert.deepEqual(map.layerConfigs.get("corn").rendererSpec, spec, "projects and links record the pinned style");
  assert.deepEqual(layer.renderer.classBreakInfos.map((info) => info.maxValue).slice(0, -1), spec.breaks.slice(0, -1));
  // Suggestions use the same data and the layer's sentinels.
  map.layerMetadata = () => ({ sentinels });
  layer.queryFeatures = async () => ({ features: [] });
  const suggestion = await map.suggestRenderers("corn");
  assert.equal(suggestion.field, FIELD);
  assert.equal(suggestion.stats.excluded, 546);
  assert.equal(suggestion.options[0].id, "choropleth-quantile");
});
