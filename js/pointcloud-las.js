// LAS 1.0–1.4 reading (point formats 0–10), with no dependencies. LAZ uses the
// same record layout once decompressed (see js/engines/three/point-cloud.js).
// Coordinates stay in the file's CRS; reprojection happens elsewhere.

const VLR_HEADER = 54;
// Offset of the red channel in each point format's record, when it has colour.
const RGB_OFFSET = { 2: 20, 3: 28, 5: 28, 7: 30, 8: 30, 10: 30 };

/** ASPRS LAS 1.4 standard classes, with colours chosen for utility and vegetation work. */
export const ASPRS_CLASSES = Object.freeze({
  0: ["Never classified", "#9e9e9e"], 1: ["Unclassified", "#bdbdbd"], 2: ["Ground", "#a1764a"],
  3: ["Low vegetation", "#b5d96b"], 4: ["Medium vegetation", "#5fae45"], 5: ["High vegetation", "#1f7a2e"],
  6: ["Building", "#d9534f"], 7: ["Low point (noise)", "#ff00ff"], 9: ["Water", "#2f7fd8"], 10: ["Rail", "#7a5c99"],
  11: ["Road surface", "#5b5b5b"], 13: ["Wire – guard (shield)", "#ffd23f"], 14: ["Wire – conductor (phase)", "#ff8c00"],
  15: ["Transmission tower", "#e0218a"], 16: ["Wire-structure connector", "#00c2c7"], 17: ["Bridge deck", "#8d6e63"], 18: ["High noise", "#ff00ff"],
});

const text = (view, offset, length) => {
  let value = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (!code) break;
    value += String.fromCharCode(code);
  }
  return value.trim();
};
const u64 = (view, offset) => Number(view.getBigUint64(offset, true));

/** The public header and variable-length records of a LAS or LAZ file. */
export function readLasHeader(buffer) {
  const view = new DataView(buffer);
  if (buffer.byteLength < 227 || text(view, 0, 4) !== "LASF") throw new Error("This is not a LAS or LAZ file.");
  const major = view.getUint8(24), minor = view.getUint8(25);
  const formatByte = view.getUint8(104);
  const header = {
    version: `${major}.${minor}`,
    headerSize: view.getUint16(94, true),
    pointOffset: view.getUint32(96, true),
    vlrCount: view.getUint32(100, true),
    // LAZ sets the top bits of the format byte.
    compressed: (formatByte & 0xc0) !== 0,
    pointFormat: formatByte & 0x3f,
    pointLength: view.getUint16(105, true),
    count: view.getUint32(107, true),
    scale: [view.getFloat64(131, true), view.getFloat64(139, true), view.getFloat64(147, true)],
    offset: [view.getFloat64(155, true), view.getFloat64(163, true), view.getFloat64(171, true)],
    min: [view.getFloat64(187, true), view.getFloat64(203, true), view.getFloat64(219, true)],
    max: [view.getFloat64(179, true), view.getFloat64(195, true), view.getFloat64(211, true)],
    vlrs: [],
  };
  if (header.pointFormat > 10) throw new Error(`LAS point format ${header.pointFormat} is not supported.`);
  if (minor >= 4 && buffer.byteLength >= 255 && header.headerSize >= 375) header.count = u64(view, 247) || header.count;
  let offset = header.headerSize;
  for (let i = 0; i < header.vlrCount && offset + VLR_HEADER <= buffer.byteLength; i++) {
    const length = view.getUint16(offset + 20, true);
    header.vlrs.push({ userId: text(view, offset + 2, 16), recordId: view.getUint16(offset + 18, true), data: new DataView(buffer, offset + VLR_HEADER, Math.min(length, buffer.byteLength - offset - VLR_HEADER)) });
    offset += VLR_HEADER + length;
  }
  return header;
}

/** The file's coordinate system: { epsg, verticalEpsg, wkt, horizontalUnits, verticalUnits }, any of them null. */
export function lasCrs(header) {
  const crs = { epsg: null, verticalEpsg: null, wkt: null, horizontalUnits: null, verticalUnits: null };
  const units = { 9001: "m", 9002: "ft", 9003: "us-ft" };
  for (const vlr of header.vlrs) {
    if (vlr.userId !== "LASF_Projection") continue;
    if (vlr.recordId === 2112) {
      crs.wkt = text(vlr.data, 0, vlr.data.byteLength);
      const projected = /^\s*COMPD_CS\[/i.test(crs.wkt) ? (crs.wkt.match(/PROJCS\[[\s\S]*?AUTHORITY\["EPSG","(\d+)"\]\]/i) || []) : (crs.wkt.match(/AUTHORITY\["EPSG","(\d+)"\]\]\s*$/i) || crs.wkt.match(/ID\["EPSG",(\d+)\]\]\s*$/i) || []);
      if (projected[1]) crs.epsg ??= Number(projected[1]);
    }
    if (vlr.recordId === 34735 && vlr.data.byteLength >= 8) {
      const keys = vlr.data.getUint16(6, true);
      for (let i = 0; i < keys && 8 + i * 8 + 8 <= vlr.data.byteLength; i++) {
        const at = 8 + i * 8;
        const [id, location, , value] = [0, 2, 4, 6].map((delta) => vlr.data.getUint16(at + delta, true));
        if (location !== 0) continue;
        if (id === 3072 && value > 0 && value < 32767) crs.epsg = value;
        if (id === 2048 && value > 0 && value < 32767) crs.epsg ??= value;
        if (id === 4096 && value > 0 && value < 32767) crs.verticalEpsg = value;
        if (id === 3076) crs.horizontalUnits = units[value] || null;
        if (id === 4099) crs.verticalUnits = units[value] || null;
      }
    }
  }
  return crs;
}

/**
 * Point attributes from point records, keeping every `step`-th point.
 * `record(index)` returns a DataView of one point record (sequential calls).
 */
export function readLasPoints(header, record, { maxPoints = 2_000_000 } = {}) {
  const step = Math.max(1, Math.ceil(header.count / maxPoints));
  const kept = Math.ceil(header.count / step);
  const positions = new Float64Array(kept * 3);
  const intensity = new Uint16Array(kept);
  const classification = new Uint8Array(kept);
  const rgbOffset = RGB_OFFSET[header.pointFormat];
  const rgb = rgbOffset ? new Uint16Array(kept * 3) : null;
  const extended = header.pointFormat >= 6;
  const [sx, sy, sz] = header.scale, [ox, oy, oz] = header.offset;
  let n = 0;
  for (let i = 0; i < header.count; i++) {
    const view = record(i);
    if (i % step) continue;
    positions[n * 3] = view.getInt32(0, true) * sx + ox;
    positions[n * 3 + 1] = view.getInt32(4, true) * sy + oy;
    positions[n * 3 + 2] = view.getInt32(8, true) * sz + oz;
    intensity[n] = view.getUint16(12, true);
    classification[n] = extended ? view.getUint8(16) : view.getUint8(15) & 0x1f;
    if (rgb) for (let c = 0; c < 3; c++) rgb[n * 3 + c] = view.getUint16(rgbOffset + c * 2, true);
    n++;
  }
  return { count: n, total: header.count, step, positions, intensity, classification, rgb };
}

/** Uncompressed LAS: header, CRS and points from the file's bytes. */
export function parseLas(buffer, options = {}) {
  const header = readLasHeader(buffer);
  if (header.compressed) throw new Error("This is a compressed LAZ file; it needs the LAZ decoder.");
  if (header.pointOffset + header.count * header.pointLength > buffer.byteLength) throw new Error("The LAS file is truncated.");
  const points = readLasPoints(header, (i) => new DataView(buffer, header.pointOffset + i * header.pointLength, header.pointLength), options);
  return { header, crs: lasCrs(header), ...points };
}
