// Preview only: no slide, project or layer is mutated. Counts describe the
// supplied records, not the publisher's complete dataset.
import { MAX_SLIDES } from './briefing-document.js?v=0.35.0';

export function previewFilterSeries({ field, fields, records, availableSlides = MAX_SLIDES } = {}) {
  if (!Array.isArray(fields) || !fields.some(item => item?.name === field)) throw new Error('Choose a field from the current layer.');
  if (!Array.isArray(records)) throw new Error('Loaded features are unavailable.');
  const values = new Map();
  let missing = 0, unsupported = 0;
  for (const record of records) {
    const value = record?.attributes?.[field];
    if (value == null || value === '') { missing++; continue; }
    if (!(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))) { unsupported++; continue; }
    // `in` in the existing briefing filter evaluator compares values as strings.
    // Combine equivalent keys so preview counts match that executor.
    const key = String(value);
    if (!values.has(key)) values.set(key, { value, count: 0 });
    values.get(key).count++;
  }
  const subsets = [...values.values()].sort((a, b) => {
    if (typeof a.value === 'number' && typeof b.value === 'number') return a.value - b.value;
    return String(a.value).localeCompare(String(b.value), undefined, { numeric: true });
  }).map(({ value, count }) => ({ title: `${field}: ${value}`, filter: { op: 'in', field, values: [value] }, count }));
  const warnings = ['Counts and categories use loaded, included features only; they may not represent the complete source.'];
  if (missing) warnings.push(`${missing} loaded feature${missing === 1 ? ' has' : 's have'} a missing value and would not be included.`);
  if (unsupported) warnings.push(`${unsupported} loaded feature${unsupported === 1 ? ' has' : 's have'} an unsupported value and would not be included.`);
  if (subsets.length > Math.max(0, availableSlides)) warnings.push(`${subsets.length} subsets exceed the ${Math.max(0, availableSlides)} available slide slots; none will be silently discarded.`);
  if (!subsets.length) warnings.push('No nonempty values were found in the loaded features.');
  return { field, method: 'unique-values', subsets, recordCount: records.length, missing, unsupported, warnings, canGenerate: false };
}
