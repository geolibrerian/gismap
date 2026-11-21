// A small bar chart that rides with the cinematic timeline: one bar per
// calendar period (or per equal slice of a number sweep), summarising the
// track's observations in that period. For a magnitude field the default is
// seismic energy released, which a single great quake dominates, as it should.
// Values are computed from the observed records only; nothing is interpolated.

export const TIMELINE_CHART_STATS = Object.freeze(["auto", "energy", "max", "count", "none"]);

const DAY = 86400000;
const UNITS = [
  { unit: "year", label: "year", span: 365.25 * DAY },
  { unit: "month", label: "month", span: 30.44 * DAY },
  { unit: "day", label: "day", span: DAY },
  { unit: "hour", label: "hour", span: DAY / 24 },
];
const MAX_BINS = 120;

/** Joules released by an earthquake of magnitude `m` (Gutenberg–Richter: log10 E = 1.5 M + 4.8). */
export function seismicEnergy(m) {
  return Number.isFinite(m) ? 10 ** (1.5 * m + 4.8) : 0;
}

/** The statistic "auto" stands for: energy for a magnitude field, else the count. */
export function resolveChartStat(stat, { field = null, magnitude = false } = {}) {
  if (stat === "none") return "none";
  if (stat === "energy") return field && magnitude ? "energy" : "count";
  if (stat === "max") return field ? "max" : "count";
  if (stat === "count") return "count";
  return field && magnitude ? "energy" : "count";
}

/** Start of the calendar period (UTC) that holds `time`, and the start of the next one. */
function period(time, unit) {
  const date = new Date(time);
  const y = date.getUTCFullYear(), m = date.getUTCMonth(), d = date.getUTCDate(), h = date.getUTCHours();
  if (unit === "year") return [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
  if (unit === "month") return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
  if (unit === "day") return [Date.UTC(y, m, d), Date.UTC(y, m, d + 1)];
  return [Date.UTC(y, m, d, h), Date.UTC(y, m, d, h + 1)];
}

/**
 * Bars for observations [{ time, feature }]: { bins: [{ start, end, value,
 * count }], max, stat, field, unit, label, start, end } or null when there is
 * nothing to chart. `kind` "time" bins by calendar period (the coarsest that
 * gives at least 8 bars, at most 120); "number" by 40 equal slices.
 */
export function timelineChart(observations = [], { kind = "time", field = null, stat = "auto", magnitude = false } = {}) {
  const resolved = resolveChartStat(stat, { field, magnitude });
  if (resolved === "none" || !observations.length || kind === "none") return null;
  const times = observations.map((item) => item.time).filter(Number.isFinite);
  if (!times.length) return null;
  const first = Math.min(...times), last = Math.max(...times);
  let bins = [], unit = null, years = 1;
  if (kind === "time") {
    const span = Math.max(1, last - first);
    unit = (UNITS.find((candidate) => span / candidate.span >= 8) || UNITS.at(-1)).unit;
    // A very long record groups several years per bar, so there are never more than MAX_BINS.
    years = unit === "year" ? Math.max(1, Math.ceil(span / UNITS[0].span / MAX_BINS)) : 1;
    for (let [start, end] = period(first, unit); start <= last; [start, end] = period(end, unit)) {
      if (years > 1 && end < Date.UTC(new Date(start).getUTCFullYear() + years, 0, 1)) end = Date.UTC(new Date(start).getUTCFullYear() + years, 0, 1);
      bins.push({ start, end, value: 0, count: 0 });
    }
  } else {
    const slices = 40, width = (last - first) / slices || 1;
    bins = Array.from({ length: last > first ? slices : 1 }, (_, i) => ({ start: first + i * width, end: first + (i + 1) * width, value: 0, count: 0 }));
  }
  const binOf = (time) => {
    let low = 0, high = bins.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (bins[mid].start <= time) low = mid; else high = mid - 1; }
    return bins[low];
  };
  const measured = new Set();
  for (const item of observations) {
    if (!Number.isFinite(item.time)) continue;
    const bin = binOf(item.time);
    bin.count += 1;
    if (resolved === "count") { bin.value += 1; continue; }
    const attributes = item.feature?.attributes || item.feature?.properties || {};
    const raw = attributes[field];
    const value = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
    if (!Number.isFinite(value)) continue;
    if (resolved === "energy") bin.value += seismicEnergy(value);
    else { bin.value = measured.has(bin) ? Math.max(bin.value, value) : value; measured.add(bin); }
  }
  const max = Math.max(0, ...bins.map((bin) => bin.value));
  const per = years > 1 ? ` per ${years} years` : unit ? ` per ${UNITS.find((candidate) => candidate.unit === unit).label}` : "";
  const label = resolved === "energy" ? `Energy released${per}` : resolved === "max" ? `Largest ${field}${per}` : `Records${per}`;
  return { bins, max, stat: resolved, field: resolved === "count" ? null : field, unit, label, start: bins[0].start, end: bins.at(-1).end };
}
