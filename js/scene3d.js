// Portable options for 3D layers drawn with three.js: point clouds (LAS, LAZ,
// XYZ) and models (glTF, GLB, OBJ, PLY). The same bounded object travels in
// map-v1 (layers[].scene3d), share links and projects.

export const SCENE3D_TYPES = Object.freeze(["pointcloud", "model"]);
export const POINT_CLOUD_EXTENSIONS = Object.freeze(["las", "laz", "xyz", "pts", "txt", "csv"]);
export const MODEL_EXTENSIONS = Object.freeze(["glb", "gltf", "obj", "ply"]);
export const COLOR_MODES = Object.freeze(["auto", "rgb", "classification", "elevation", "intensity"]);

const bounded = (value, fallback, min, max) => {
  const number = Number(value);
  return value === undefined || value === null || value === "" || !Number.isFinite(number) ? fallback : Math.min(max, Math.max(min, number));
};

/** "pointcloud", "model", or null, from a URL or file name. */
export function scene3dTypeFor(name) {
  const extension = String(name || "").split(/[?#]/)[0].split(".").pop().toLowerCase();
  if (POINT_CLOUD_EXTENSIONS.includes(extension) && !["txt", "csv"].includes(extension)) return "pointcloud";
  if (MODEL_EXTENSIONS.includes(extension)) return "model";
  return null;
}

/** Validates and bounds scene3d options for a layer type. Throws on unusable input. */
export function normalizeScene3d(input = {}, type = "pointcloud") {
  if (!SCENE3D_TYPES.includes(type)) throw new Error(`3D options apply to pointcloud and model layers, not ${type}.`);
  if (input == null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new Error("scene3d must be an object.");
  const crs = input.crs == null || input.crs === "" ? undefined : String(input.crs).trim();
  if (crs && (crs.length > 6000 || !/^(EPSG:\d{4,6}|\+proj=|(PROJCS|GEOGCS|COMPD_CS|PROJCRS|GEOGCRS|COMPOUNDCRS)\[)/i.test(crs))) throw new Error("crs must be EPSG:<code>, a proj4 string or WKT.");
  const common = {
    ...(crs ? { crs } : {}),
    // ground: heights above the data's own ground, set on the map's terrain; absolute: heights as surveyed.
    heightReference: input.heightReference === "absolute" ? "absolute" : "ground",
    zOffset: bounded(input.zOffset, 0, -10000, 10000),
    verticalExaggeration: bounded(input.verticalExaggeration, 1, 0.1, 20),
  };
  if (type === "pointcloud") {
    const classes = Array.isArray(input.classes) ? [...new Set(input.classes.map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 255))].slice(0, 64) : null;
    const animate = input.animate?.type === "reveal" ? { type: "reveal", durationMs: bounded(input.animate.durationMs, 8000, 1000, 120000), loop: input.animate.loop === true } : undefined;
    return {
      ...common,
      colorBy: COLOR_MODES.includes(input.colorBy) ? input.colorBy : "auto",
      pointSize: bounded(input.pointSize, 2, 1, 12),
      maxPoints: Math.round(bounded(input.maxPoints, 1_500_000, 1000, 5_000_000)),
      ...(classes?.length ? { classes } : {}),
      ...(animate ? { animate } : {}),
    };
  }
  const anchor = Array.isArray(input.anchor) ? input.anchor.map(Number) : null;
  if (anchor && !(anchor.length >= 2 && anchor.length <= 3 && anchor.every(Number.isFinite) && Math.abs(anchor[0]) <= 180 && Math.abs(anchor[1]) <= 90)) throw new Error("anchor must be [longitude, latitude] or [longitude, latitude, altitude].");
  if (!anchor && !crs) throw new Error("Place the model with anchor [longitude, latitude, altitude], or give the CRS of its coordinates.");
  return {
    ...common,
    ...(anchor ? { anchor: [anchor[0], anchor[1], anchor[2] ?? 0] } : {}),
    heading: bounded(input.heading, 0, -360, 360),
    scale: bounded(input.scale, 1, 1e-6, 1e6),
    upAxis: input.upAxis === "z" ? "z" : "y",
    ...(typeof input.color === "string" && /^#[0-9a-f]{6}$/i.test(input.color) ? { color: input.color } : {}),
  };
}
