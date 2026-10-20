// Integer-year timeline frames. Dates and timestamps need engine-specific date
// semantics and are intentionally not interpreted as years.
import { MAX_SLIDES, addSlide, createSlide, normalizeBriefing } from './briefing-document.js?v=0.35.0';

export function isYearField(field) {
  const type = String(field?.type || '').toLowerCase();
  return Boolean(/^[A-Za-z_][\w.]*$/.test(field?.name || "") && /integer|long|short/.test(type) && !/date|time/.test(type));
}

export function previewTimeline({ field, fields, records, start, end, step = 1, mode = 'interval', availableSlides = MAX_SLIDES } = {}) {
  if (!Array.isArray(fields) || !fields.some(item => item.name === field && isYearField(item))) throw new Error('Choose an integer year field from the current layer.');
  if (!Array.isArray(records)) throw new Error('Loaded features are unavailable.');
  if ([start, end, step].some(value => value === '' || value == null || !Number.isInteger(Number(value)))) throw new Error('Enter whole-number start, end, and interval years.');
  start = Number(start); end = Number(end); step = Number(step);
  if (start < 0 || end > 9999 || end < start || step < 1 || step > 10000) throw new Error('Choose years from 0 to 9999, with the end after the start and an interval of at least one year.');
  if (!['interval', 'cumulative'].includes(mode)) throw new Error('Choose an interval or cumulative timeline.');
  const count = Math.ceil((end - start + 1) / step);
  if (count > MAX_SLIDES || count > Math.max(0, availableSlides)) throw new Error(`${count} frames exceed the ${Math.max(0, availableSlides)} available slide slots; no slides were added.`);
  const years = records.map(record => record?.attributes?.[field]);
  const missing = years.filter(value => value == null || value === '').length;
  const invalid = years.filter(value => value != null && value !== '' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 9999)).length;
  const frames = Array.from({length:count}, (_, index) => {
    const from = start + index * step, to = Math.min(from + step, end + 1);
    const lower = mode === 'cumulative' ? start : from;
    const matching = years.filter(year => typeof year === 'number' && Number.isInteger(year) && year >= lower && year < to).length;
    const label = from === to - 1 ? String(from) : `${from}–${to - 1}`;
    return { title: mode === 'cumulative' ? `${start}–${to - 1} (cumulative)` : label, count:matching, filter:{op:'year-range', field, start:lower, end:to}, intervalStart:from, intervalEnd:to };
  });
  const warnings = ['Counts are from loaded, included features only; the full dataset may differ.', 'Empty frames are retained so the timeline has no gaps.'];
  if (missing) warnings.push(`${missing} loaded features have missing years.`);
  if (invalid) warnings.push(`${invalid} loaded features have invalid or non-numeric years.`);
  return {frames, warnings, missing, invalid, recordCount:records.length};
}

export function generateTimeline({briefing, layerRef, camera, ...options} = {}) {
  const original = normalizeBriefing(briefing);
  if (!layerRef) throw new Error('The current layer cannot be identified for sharing.');
  if (!camera) throw new Error('A map view is needed before generating timeline slides.');
  const preview = previewTimeline({...options, availableSlides: MAX_SLIDES - original.slides.length});
  let result = original;
  for (const frame of preview.frames) {
    const slide = createSlide('map-narrative', {title:frame.title, camera});
    slide.dataView = {layer:layerRef, filter:frame.filter};
    slide.generatedBy = {template:'timeline', version:1, intervalStart:frame.intervalStart, intervalEnd:frame.intervalEnd, mode:options.mode || 'interval'};
    result = addSlide(result, slide);
  }
  return {briefing:result, preview};
}
