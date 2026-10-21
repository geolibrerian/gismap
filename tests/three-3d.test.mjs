// three.js 3D layers: LAS parsing, colours, coordinate frames, the animation
// clock and the portable scene3d options. Rendering is checked in a browser.
import test from "node:test";
import assert from "node:assert/strict";
import { ASPRS_CLASSES, lasCrs, parseLas, readLasHeader } from "../js/pointcloud-las.js";
import { parseXyz, pointColors, resolveColorMode } from "../js/pointcloud-color.js";
import { INTERNATIONAL_FOOT, US_SURVEY_FOOT, builtinProjection, localFrame, unitFactor } from "../js/geo-frame.js";
import { createAnimationClock } from "../js/animation-clock.js";
import { normalizeScene3d, scene3dTypeFor } from "../js/scene3d.js";
import { validateMapSpec } from "../js/map-spec.js";
import { packLayer, readShare, serializeShare } from "../js/map-share.js";

/** A small LAS file: format 3 (1.2) or 6 (1.4), optional GeoKey EPSG or WKT VLR. */
function makeLas({ format = 3, points = [], epsg = null, wkt = null, verticalUnits = null } = {}) {
  const v14 = format >= 6;
  const headerSize = v14 ? 375 : 227;
  const pointLength = { 3: 34, 6: 30 }[format];
  const vlrs = [];
  if (epsg || verticalUnits) {
    const keys = [[1, 1, 0, 0]];
    if (epsg) keys.push([3072, 0, 1, epsg]);
    if (verticalUnits) keys.push([4099, 0, 1, verticalUnits]);
    keys[0][3] = keys.length - 1;
    const data = new Uint8Array(keys.length * 8);
    const view = new DataView(data.buffer);
    keys.flat().forEach((value, index) => view.setUint16(index * 2, value, true));
    vlrs.push({ userId: "LASF_Projection", recordId: 34735, data });
  }
  if (wkt) vlrs.push({ userId: "LASF_Projection", recordId: 2112, data: new TextEncoder().encode(`${wkt}\0`) });
  const vlrBytes = vlrs.reduce((sum, vlr) => sum + 54 + vlr.data.length, 0);
  const pointOffset = headerSize + vlrBytes;
  const buffer = new ArrayBuffer(pointOffset + points.length * pointLength);
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("LASF"), 0);
  view.setUint8(24, 1); view.setUint8(25, v14 ? 4 : 2);
  view.setUint16(94, headerSize, true); view.setUint32(96, pointOffset, true); view.setUint32(100, vlrs.length, true);
  view.setUint8(104, format); view.setUint16(105, pointLength, true); view.setUint32(107, v14 ? 0 : points.length, true);
  [0.01, 0.01, 0.01].forEach((value, i) => view.setFloat64(131 + i * 8, value, true));
  [500000, 4000000, 0].forEach((value, i) => view.setFloat64(155 + i * 8, value, true));
  if (v14) view.setBigUint64(247, BigInt(points.length), true);
  let at = headerSize;
  for (const vlr of vlrs) {
    bytes.set(new TextEncoder().encode(vlr.userId), at + 2);
    view.setUint16(at + 18, vlr.recordId, true); view.setUint16(at + 20, vlr.data.length, true);
    bytes.set(vlr.data, at + 54);
    at += 54 + vlr.data.length;
  }
  points.forEach(([x, y, z, intensity, classification, rgb], index) => {
    const p = pointOffset + index * pointLength;
    view.setInt32(p, Math.round((x - 500000) / 0.01), true); view.setInt32(p + 4, Math.round((y - 4000000) / 0.01), true); view.setInt32(p + 8, Math.round(z / 0.01), true);
    view.setUint16(p + 12, intensity, true);
    if (format >= 6) view.setUint8(p + 16, classification); else view.setUint8(p + 15, classification);
    if (rgb) rgb.forEach((value, c) => view.setUint16(p + 28 + c * 2, value, true));
  });
  return buffer;
}

const POINTS = [[500010, 4000020, 100, 200, 2, [65535, 0, 0]], [500030, 4000040, 112.5, 900, 5, [0, 65535, 0]], [500050, 4000060, 125, 50, 14, [0, 0, 65535]]];

test("LAS 1.2 format 3: coordinates, classes, colour and GeoKey EPSG", () => {
  const cloud = parseLas(makeLas({ points: POINTS, epsg: 32610, verticalUnits: 9001 }));
  assert.deepEqual([cloud.header.version, cloud.header.pointFormat, cloud.count], ["1.2", 3, 3]);
  assert.deepEqual([...cloud.positions.slice(0, 3)], [500010, 4000020, 100]);
  assert.deepEqual([...cloud.classification], [2, 5, 14]);
  assert.deepEqual([...cloud.rgb.slice(0, 3)], [65535, 0, 0]);
  assert.deepEqual([cloud.crs.epsg, cloud.crs.verticalUnits], [32610, "m"]);
  assert.equal(ASPRS_CLASSES[14][0], "Wire – conductor (phase)");
});

test("LAS 1.4 format 6 uses the 64-bit count, the full class byte and a WKT CRS", () => {
  const wkt = 'PROJCS["NAD83 / UTM zone 10N",GEOGCS["NAD83"],UNIT["metre",1],AUTHORITY["EPSG","26910"]]';
  const cloud = parseLas(makeLas({ format: 6, points: POINTS.map(([x, y, z, i, c]) => [x, y, z, i, c === 14 ? 64 : c]), wkt }));
  assert.equal(cloud.header.count, 3);
  assert.deepEqual([...cloud.classification], [2, 5, 64]);
  assert.equal(cloud.rgb, null);
  assert.equal(cloud.crs.epsg, 26910);
});

test("thinning keeps every step-th point, and bad input is refused", () => {
  const many = Array.from({ length: 10 }, (_, i) => [500000 + i, 4000000, i, 0, 1, [0, 0, 0]]);
  const cloud = parseLas(makeLas({ points: many }), { maxPoints: 4 });
  assert.deepEqual([cloud.step, cloud.count, cloud.total], [3, 4, 10]);
  assert.throws(() => readLasHeader(new ArrayBuffer(300)), /not a LAS/);
  const truncated = makeLas({ points: POINTS }).slice(0, 260);
  assert.throws(() => parseLas(truncated), /truncated/);
  const laz = makeLas({ points: POINTS });
  new DataView(laz).setUint8(104, 3 | 0x80);
  assert.equal(readLasHeader(laz).compressed, true);
  assert.throws(() => parseLas(laz), /LAZ decoder/);
});

test("colours: auto prefers RGB, then classes, then elevation; legends name ASPRS classes", () => {
  const cloud = parseLas(makeLas({ points: POINTS }));
  assert.equal(resolveColorMode(cloud), "rgb");
  assert.deepEqual([...pointColors(cloud, "rgb").colors.slice(0, 3)], [1, 0, 0]);
  const classes = pointColors({ ...cloud, rgb: null }, "auto");
  assert.equal(classes.mode, "classification");
  assert.deepEqual(classes.legend.map((entry) => entry.label), ["2 · Ground", "5 · High vegetation", "14 · Wire – conductor (phase)"]);
  assert.equal(pointColors({ ...cloud, rgb: null, classification: null }, "classification").mode, "elevation");
  const xyz = parseXyz("x y z\n1 2 3\n4,5,6,255,0,0\n");
  assert.deepEqual([xyz.count, xyz.rgb !== null, [...xyz.positions]], [2, true, [1, 2, 3, 4, 5, 6]]);
});

test("coordinate helpers: built-in UTM, unit factors and a metre frame", () => {
  assert.equal(builtinProjection("EPSG:32610"), "+proj=utm +zone=10 +datum=WGS84 +units=m +no_defs");
  assert.match(builtinProjection("EPSG:32733"), /zone=33 \+south/);
  assert.match(builtinProjection("EPSG:6339"), /zone=10 /);
  assert.equal(builtinProjection("EPSG:2992"), null, "state plane comes from epsg.io");
  assert.equal(unitFactor("+proj=lcc +units=us-ft"), US_SURVEY_FOOT);
  assert.equal(unitFactor('PROJCS["x",GEOGCS["y",UNIT["degree",0.0174532925199433]],UNIT["Foot",0.3048]]'), INTERNATIONAL_FOOT);
  assert.equal(unitFactor("+proj=utm +zone=10"), 1);
  const frame = localFrame([-123, 44]);
  assert.deepEqual(frame.toLocal(-123, 44, 5).map((value) => value + 0), [0, 0, 5]);
  const [east, north] = frame.toLocal(-123 + 1 / (111320 * Math.cos((44 * Math.PI) / 180)) * 100, 44 + 100 / 111132);
  assert.ok(Math.abs(east - 100) < 0.5 && Math.abs(north - 100) < 0.6, `${east}, ${north}`);
});

test("the animation clock plays, loops, seeks and respects reduced motion", () => {
  let now = 0;
  const frames = [];
  const clock = createAnimationClock({ start: 0, end: 1000, loop: true, now: () => now, requestFrame: (callback) => frames.push(callback), cancelFrame: () => {} });
  const seen = [];
  clock.onTick((state) => seen.push(Math.round(state.time)));
  clock.play();
  now = 400; frames.shift()();
  now = 1200; frames.shift()();
  assert.deepEqual(seen, [400, 200]);
  // Reverse playback wraps from the start back to the end.
  clock.setSpeed(-1).seek(30);
  now = 1250; frames.shift()();
  assert.equal(Math.round(clock.time), 980);
  clock.pause();
  assert.equal(clock.playing, false);
  const reduced = createAnimationClock({ end: 500, reducedMotion: true, now: () => 0, requestFrame: () => assert.fail("no frames"), cancelFrame: () => {} });
  assert.equal(reduced.play().time, 500);
  assert.throws(() => createAnimationClock({ start: 5, end: 5 }), /start before its end/);
});

test("scene3d options are bounded and typed by layer kind", () => {
  assert.deepEqual([scene3dTypeFor("https://x.org/a.laz?x=1"), scene3dTypeFor("tower.glb"), scene3dTypeFor("data.csv"), scene3dTypeFor("a.geojson")], ["pointcloud", "model", null, null]);
  assert.deepEqual(normalizeScene3d({ colorBy: "nope", pointSize: 99, classes: [5, 5, 14, -1, "x"] }, "pointcloud"), { heightReference: "ground", zOffset: 0, verticalExaggeration: 1, colorBy: "auto", pointSize: 12, maxPoints: 1500000, classes: [5, 14] });
  assert.equal(normalizeScene3d({ anchor: [-122, 37], heightReference: "absolute" }, "model").anchor[2], 0);
  assert.throws(() => normalizeScene3d({}, "model"), /anchor/);
  assert.throws(() => normalizeScene3d({ crs: "DROP TABLE" }, "pointcloud"), /crs must be/);
  assert.throws(() => normalizeScene3d({ anchor: [200, 0] }, "model"), /anchor must be/);
});

test("map-v1 and share links carry pointcloud and model layers with their options", () => {
  const spec = { version: 1, layers: [
    { url: "https://example.org/lidar/span-12.laz", type: "pointcloud", scene3d: { crs: "EPSG:26910", classes: [5, 14], colorBy: "classification" } },
    { url: "https://example.org/assets/pole.glb", scene3d: { anchor: [-122.4, 37.7, 0], heading: 90 } },
  ] };
  const { valid, issues, spec: checked } = validateMapSpec(spec);
  assert.ok(valid, JSON.stringify(issues));
  assert.deepEqual(checked.layers[0].scene3d.classes, [5, 14]);
  assert.equal(checked.layers[1].scene3d.heading, 90);
  const bad = validateMapSpec({ version: 1, layers: [{ url: "https://example.org/pole.glb", scene3d: {} }] });
  assert.ok(bad.issues.some((item) => item.path === "layers[0].scene3d"));
  const packed = packLayer({ url: spec.layers[0].url, sourceType: "pointcloud", scene3d: checked.layers[0].scene3d });
  assert.deepEqual(packed.v, checked.layers[0].scene3d);
  const shared = readShare(serializeShare({ layers: [{ url: spec.layers[0].url, sourceType: "pointcloud", scene3d: checked.layers[0].scene3d }] }));
  assert.deepEqual(shared.layers[0].scene3d, checked.layers[0].scene3d);
  assert.equal(shared.layers[0].serviceType, "pointcloud");
});
