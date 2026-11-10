// The "terraced-surface" spatial chart: a polygon layer's values smoothed into a
// continuous surface and cut into nested terraces, like a layer cake. Each
// polygon spreads its value over the grid cells it covers (weighted by a field
// such as population, else by area); a Gaussian kernel smooths the grid; and
// each terrace is the region at or above one break, so terraces nest and stack
// without gaps. Runs on the viewer's device with the vendored Turf bundle.

const KM_PER_DEGREE = 111.32;
export const MAX_SURFACE_CELLS = 250_000;
export const DEFAULT_TERRACE_CLASSES = 7;

const round = (value, digits = 5) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Every outer and inner ring of a polygon or multipolygon geometry. */
const ringsOf = (geometry) => geometry?.type === "Polygon" ? geometry.coordinates : geometry?.type === "MultiPolygon" ? geometry.coordinates.flat() : [];

/** A value rounded to two significant figures of the step between breaks, so legends read 38.5 rather than 38.4721. */
export function niceBreak(value, span) {
  const digits = Math.max(0, 1 - Math.floor(Math.log10(Math.max(span, 1e-9))));
  return Number(value.toFixed(Math.min(digits, 8)));
}

/** Ascending lower bounds for `classes` terraces, at equal-area quantiles of the surface values. */
export function terraceBreaks(values, classes = DEFAULT_TERRACE_CLASSES) {
  const sorted = Float64Array.from(values.filter(Number.isFinite)).sort();
  if (!sorted.length) return [];
  const span = (sorted.at(-1) - sorted[0]) / classes;
  const breaks = Array.from({ length: classes }, (_, index) => niceBreak(sorted[Math.floor(index * (sorted.length - 1) / classes)], span));
  return [...new Set(breaks)].sort((a, b) => a - b);
}

/**
 * Visits the index of every grid cell whose centre falls inside the rings
 * (even-odd rule), with x and y already in grid units.
 */
function rasterize(rings, nx, ny, visit) {
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  for (let j = Math.max(0, Math.ceil(minY - 0.5)); j <= Math.min(ny - 1, Math.floor(maxY - 0.5)); j += 1) {
    const y = j + 0.5;
    const crossings = [];
    for (const ring of rings) {
      for (let at = 1; at < ring.length; at += 1) {
        const [ax, ay] = ring[at - 1], [bx, by] = ring[at];
        if ((ay <= y) !== (by <= y)) crossings.push(ax + (y - ay) * (bx - ax) / (by - ay));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let at = 0; at + 1 < crossings.length; at += 2) {
      for (let i = Math.max(0, Math.ceil(crossings[at] - 0.5)); i <= Math.min(nx - 1, Math.floor(crossings[at + 1] - 0.5)); i += 1) visit(j * nx + i);
    }
  }
}

/** A separable Gaussian blur of a row-major grid, in place. */
function blur(grid, nx, ny, sigma) {
  const radius = Math.ceil(3 * sigma);
  const kernel = Float64Array.from({ length: 2 * radius + 1 }, (_, at) => Math.exp(-((at - radius) ** 2) / (2 * sigma * sigma)));
  const line = new Float64Array(Math.max(nx, ny));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) line[i] = grid[j * nx + i];
    for (let i = 0; i < nx; i += 1) {
      let sum = 0;
      for (let k = Math.max(0, i - radius); k <= Math.min(nx - 1, i + radius); k += 1) sum += line[k] * kernel[k - i + radius];
      grid[j * nx + i] = sum;
    }
  }
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) line[j] = grid[j * nx + i];
    for (let j = 0; j < ny; j += 1) {
      let sum = 0;
      for (let k = Math.max(0, j - radius); k <= Math.min(ny - 1, j + radius); k += 1) sum += line[k] * kernel[k - j + radius];
      grid[j * nx + i] = sum;
    }
  }
}

/**
 * Builds the terraces for a polygon layer.
 * features: GeoJSON polygon features. options: { field, weightField, breaks, classes, bandwidthKm, cellKm, smoothing }.
 * Returns { collection, breaks, bandwidthKm, cellKm }: one MultiPolygon per terrace, with properties
 * { band, value }, where terrace `band` covers everything at or above breaks[band].
 */
export function terracedSurface(turf, features, { field, weightField = null, breaks = null, classes = DEFAULT_TERRACE_CLASSES, bandwidthKm = null, cellKm = null, smoothing = 2 } = {}) {
  const samples = [];
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const feature of features) {
    const value = Number(feature?.properties?.[field]);
    const rings = ringsOf(feature?.geometry);
    if (!Number.isFinite(value) || feature.properties[field] === null || feature.properties[field] === "" || !rings.length) continue;
    const weight = weightField ? Number(feature.properties[weightField]) : 1;
    if (!(weight > 0)) continue;
    for (const ring of rings) for (const [x, y] of ring) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
    samples.push({ value, weight, rings });
  }
  if (samples.length < 3) throw new Error(`A terraced surface needs at least three polygons with a value in ${field}.`);

  // Kilometres on a local equirectangular projection: close enough for smoothing at country scale.
  const kmX = KM_PER_DEGREE * Math.cos(((south + north) / 2) * Math.PI / 180);
  const widthKm = (east - west) * kmX, heightKm = (north - south) * KM_PER_DEGREE;
  const spacingKm = Math.sqrt((widthKm * heightKm) / samples.length);
  let cell = cellKm > 0 ? cellKm : Math.max(Math.max(widthKm, heightKm) / 400, spacingKm / 4);
  const bandwidth = bandwidthKm > 0 ? bandwidthKm : spacingKm * 1.2;
  const pad = 3;
  while (((widthKm / cell) + 2 * pad) * ((heightKm / cell) + 2 * pad) > MAX_SURFACE_CELLS) cell *= 1.25;
  const dLon = cell / kmX, dLat = cell / KM_PER_DEGREE;
  const lon0 = west - pad * dLon, lat0 = south - pad * dLat;
  const nx = Math.ceil((east - west) / dLon) + 2 * pad, ny = Math.ceil((north - south) / dLat) + 2 * pad;

  // Each polygon spreads its weight evenly over the cells it covers; one smaller than a cell lands on its first vertex's cell.
  const sum = new Float64Array(nx * ny), weights = new Float64Array(nx * ny), inside = new Uint8Array(nx * ny);
  for (const sample of samples) {
    const rings = sample.rings.map((ring) => ring.map(([x, y]) => [(x - lon0) / dLon, (y - lat0) / dLat]));
    const cells = [];
    rasterize(rings, nx, ny, (index) => cells.push(index));
    if (!cells.length) {
      const [x, y] = rings[0][0];
      cells.push(Math.min(ny - 1, Math.max(0, Math.floor(y))) * nx + Math.min(nx - 1, Math.max(0, Math.floor(x))));
    }
    const share = sample.weight / cells.length;
    for (const index of cells) { sum[index] += sample.value * share; weights[index] += share; inside[index] = 1; }
  }
  blur(sum, nx, ny, bandwidth / cell);
  blur(weights, nx, ny, bandwidth / cell);

  const surface = new Float64Array(nx * ny);
  const insideValues = [];
  for (let index = 0; index < surface.length; index += 1) {
    if (!inside[index] || !(weights[index] > 0)) continue;
    surface[index] = sum[index] / weights[index];
    insideValues.push(surface[index]);
  }
  const cuts = breaks?.length ? [...breaks].map(Number).filter(Number.isFinite).sort((a, b) => a - b) : terraceBreaks(insideValues, classes);
  const top = insideValues.reduce((high, value) => Math.max(high, value), cuts.at(-1)) + 1;
  const below = cuts[0] - Math.max(1, top - cuts[0]);
  // Outside the layer the surface drops below the first break, so every terrace closes along the layer's edge.
  for (let index = 0; index < surface.length; index += 1) surface[index] = inside[index] && weights[index] > 0 ? Math.max(surface[index], cuts[0]) : below;

  const points = [];
  for (let j = 0; j < ny; j += 1) for (let i = 0; i < nx; i += 1) points.push(turf.point([lon0 + (i + 0.5) * dLon, lat0 + (j + 0.5) * dLat], { z: surface[j * nx + i] }));
  const grid = turf.featureCollection(points);
  const collection = turf.featureCollection([]);
  cuts.forEach((value, band) => {
    const [terrace] = turf.isobands(grid, [value, top], { zProperty: "z" }).features;
    if (!terrace?.geometry?.coordinates?.length) return;
    let shape = turf.simplify(terrace, { tolerance: Math.min(dLon, dLat) / 3, highQuality: false });
    if (smoothing > 0) shape = turf.polygonSmooth(shape, { iterations: smoothing }).features[0] ?? shape;
    const polygons = (shape.geometry.type === "Polygon" ? [shape.geometry.coordinates] : shape.geometry.coordinates)
      .map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [round(x), round(y)])).filter((ring) => ring.length >= 4))
      .filter((polygon) => polygon.length);
    if (polygons.length) collection.features.push({ type: "Feature", properties: { band, value }, geometry: { type: "MultiPolygon", coordinates: polygons } });
  });
  return { collection, breaks: cuts, bandwidthKm: round(bandwidth, 1), cellKm: round(cell, 2) };
}
