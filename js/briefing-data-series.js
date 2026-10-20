// Data-driven slides store a small declarative filter, never executable SQL.
import { MAX_SLIDES, addSlide, createSlide, normalizeBriefing } from './briefing-document.js?v=0.35.0';
import { previewFilterSeries } from './briefing-series-preview.js?v=0.1.0';
import { isYearField } from './briefing-timeline.js?v=0.1.0';

export function seriesWhere(filter, fields) {
  if (!Array.isArray(fields) || !fields.some(f => f?.name === filter?.field) ||
      !/^[A-Za-z_][\w.]*$/.test(filter?.field || '')) throw new Error('This slide has an unsupported or unknown data filter.');
  if (filter.op === 'year-range') {
    if (!fields.some(field => field.name === filter.field && isYearField(field))) throw new Error('This slide needs an integer year field.');
    if (!Number.isInteger(filter.start) || !Number.isInteger(filter.end) || filter.start < 0 || filter.end > 10000 || filter.start >= filter.end) throw new Error('This slide has an invalid year range.');
    return `(${filter.field} >= ${filter.start} AND ${filter.field} < ${filter.end})`;
  }
  if (filter.op !== 'in' || !Array.isArray(filter.values) || filter.values.length !== 1) throw new Error('This slide has an unsupported data filter.');
  const value = filter.values[0];
  if (typeof value !== 'string' && !(typeof value === 'number' && Number.isFinite(value))) throw new Error('This slide has an invalid filter value.');
  return `${filter.field} = ${typeof value === 'number' ? value : "'" + value.replaceAll("'", "''") + "'"}`;
}

export function generateFilterSeries({ briefing, field, fields, records, layerRef, camera } = {}) {
  const original = normalizeBriefing(briefing);
  if (!layerRef) throw new Error('The current layer cannot be identified for sharing.');
  const preview = previewFilterSeries({ field, fields, records, availableSlides: MAX_SLIDES - original.slides.length });
  if (!preview.subsets.length) throw new Error('No nonempty values were found in the loaded features.');
  if (preview.subsets.length > MAX_SLIDES - original.slides.length) throw new Error('There are more subsets than available slide slots; no slides were added.');
  let result = original;
  for (const subset of preview.subsets) {
    seriesWhere(subset.filter, fields);
    const slide = createSlide('map-narrative', { title: subset.title, camera });
    slide.dataView = { layer: layerRef, filter: subset.filter };
    slide.generatedBy = { template: 'filter-series', version: 1 };
    result = addSlide(result, slide);
  }
  return { briefing: result, preview };
}
