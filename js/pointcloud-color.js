// Per-point colours for a parsed point cloud, as 0–1 RGB floats, plus a legend.
import { ASPRS_CLASSES } from "./pointcloud-las.js?v=0.1.0";

const ELEVATION_RAMP = ["#30123b", "#4686fb", "#1ae4b6", "#a2fc3c", "#fabb39", "#e4460a", "#7a0403"];
const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

function percentile(values, count, ratio) {
  const sample = [];
  const step = Math.max(1, Math.floor(count / 20000));
  for (let i = 0; i < count; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(ratio * (sample.length - 1)))] ?? 0;
}

/** The colour mode actually used: "auto" picks RGB, then classification, then elevation. */
export function resolveColorMode(cloud, mode = "auto") {
  if (mode !== "auto") return (mode === "rgb" && !cloud.rgb) || (mode === "classification" && !cloud.classification) || (mode === "intensity" && !cloud.intensity) ? "elevation" : mode;
  if (cloud.rgb && cloud.rgb.some((value) => value > 0)) return "rgb";
  if (cloud.classification && cloud.classification.some((value) => value > 1)) return "classification";
  return "elevation";
}

/** { colors: Float32Array, mode, legend: [{ label, color }] } for `cloud` (positions with z in metres). */
export function pointColors(cloud, requested = "auto") {
  const mode = resolveColorMode(cloud, requested);
  const colors = new Float32Array(cloud.count * 3);
  let legend = [];
  if (mode === "rgb") {
    let max = 0;
    for (let i = 0; i < cloud.count * 3; i++) if (cloud.rgb[i] > max) max = cloud.rgb[i];
    const scale = max > 255 ? 65535 : 255;
    for (let i = 0; i < cloud.count * 3; i++) colors[i] = cloud.rgb[i] / scale;
  } else if (mode === "classification") {
    const seen = new Set();
    for (let i = 0; i < cloud.count; i++) {
      const code = cloud.classification[i];
      seen.add(code);
      colors.set(rgbOf(ASPRS_CLASSES[code]?.[1] || "#c8c8c8"), i * 3);
    }
    legend = [...seen].sort((a, b) => a - b).map((code) => ({ label: `${code} · ${ASPRS_CLASSES[code]?.[0] || "User defined"}`, color: ASPRS_CLASSES[code]?.[1] || "#c8c8c8" }));
  } else {
    const values = mode === "intensity" ? cloud.intensity : Float64Array.from({ length: cloud.count }, (_, i) => cloud.positions[i * 3 + 2]);
    const low = percentile(values, cloud.count, 0.02), high = percentile(values, cloud.count, 0.98);
    const span = high - low || 1;
    const stops = ELEVATION_RAMP.map(rgbOf);
    for (let i = 0; i < cloud.count; i++) {
      const t = Math.min(1, Math.max(0, (values[i] - low) / span));
      if (mode === "intensity") { colors.set([0.15 + t * 0.85, 0.15 + t * 0.85, 0.15 + t * 0.85], i * 3); continue; }
      const at = t * (stops.length - 1), index = Math.min(stops.length - 2, Math.floor(at)), f = at - index;
      for (let c = 0; c < 3; c++) colors[i * 3 + c] = stops[index][c] + (stops[index + 1][c] - stops[index][c]) * f;
    }
    const unit = mode === "intensity" ? "" : " m";
    legend = mode === "intensity" ? [{ label: "Low intensity", color: "#262626" }, { label: "High intensity", color: "#ffffff" }] : [{ label: `${low.toFixed(1)}${unit}`, color: ELEVATION_RAMP[0] }, { label: `${high.toFixed(1)}${unit}`, color: ELEVATION_RAMP.at(-1) }];
  }
  return { colors, mode, legend };
}

/** XYZ text ("x y z [r g b] [intensity]", spaces, commas or tabs), keeping every step-th point. */
export function parseXyz(text, { maxPoints = 2_000_000 } = {}) {
  const lines = String(text).split(/\r?\n/).filter((line) => /^\s*-?\d/.test(line));
  const step = Math.max(1, Math.ceil(lines.length / maxPoints));
  const kept = Math.ceil(lines.length / step);
  const positions = new Float64Array(kept * 3), intensity = new Uint16Array(kept), rgb = new Uint16Array(kept * 3);
  let n = 0, hasRgb = false;
  for (let i = 0; i < lines.length; i += step) {
    const values = lines[i].trim().split(/[\s,;]+/).map(Number);
    if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) continue;
    positions.set(values.slice(0, 3), n * 3);
    if (values.length >= 6) { rgb.set(values.slice(3, 6), n * 3); hasRgb = true; }
    if (values.length === 4 || values.length >= 7) intensity[n] = values[values.length === 4 ? 3 : 6] || 0;
    n++;
  }
  return { count: n, total: lines.length, step, positions: positions.subarray(0, n * 3), intensity: intensity.subarray(0, n), classification: null, rgb: hasRgb ? rgb.subarray(0, n * 3) : null, crs: { epsg: null, wkt: null } };
}
