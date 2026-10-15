import {
  BRIEFING_SCHEMA_VERSION,
  MAX_SLIDES,
  SLIDE_TEMPLATES,
  STAT_TYPES,
  addSlide,
  computeStat,
  createSlide,
  duplicateSlide,
  matchesFilter,
  moveSlide,
  normalizeBriefing,
  normalizeFilter,
  removeSlide,
  safeUrl,
  updateBlock,
  updateSlide,
  validateBriefing,
} from "./briefing-document.js?v=0.19.0";
import {
  BRIEFING_SHARE_LIMITS,
  BRIEFING_SHARE_VERSION,
  createBriefingUrl,
  decodeBriefing,
  encodeBriefing,
  readBriefingHash,
} from "./briefing-share.js?v=0.23.0";
import { inspectSource } from "./source-inspector.js?v=0.23.0";
import {
  SMART_IMAGE_CHUNK,
  SMART_IMAGE_FORMAT,
  SMART_IMAGE_LIMITS,
  SMART_IMAGE_VERSION,
  embedProjectInPng,
  readProjectFromPng,
} from "./smart-image.js?v=0.23.0";

export const GISMAP_CORE_VERSION = "0.21.0";

export const capabilities = Object.freeze({
  apiVersion: GISMAP_CORE_VERSION,
  briefingSchemaVersion: BRIEFING_SCHEMA_VERSION,
  briefingSchema: "https://gismap.online/schemas/briefing-v1.schema.json",
  execution: "client",
  sourceTypes: ["arcgis-rest", "geojson", "loaded-records"],
  outputs: ["briefing-json", "briefing-link", "gmo-project", "smart-image-png"],
  filters: ["eq", "neq", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "starts_with", "is_null", "is_not_null", "and", "or", "not", "feature_ids"],
  limits: { maxSlides: MAX_SLIDES, ...BRIEFING_SHARE_LIMITS },
  unavailableWithoutHost: ["hosted-links", "private-access-control", "background-jobs", "webhooks", "scheduled-runs"],
});

/** Return both the normalized document and actionable validation issues. */
export function validateBriefingDocument(value, options = {}) {
  const document = normalizeBriefing(value);
  const issues = validateBriefing(document, options);
  return { valid: !issues.some((issue) => issue.level === "error"), document, issues };
}

export const briefing = Object.freeze({
  schemaVersion: BRIEFING_SCHEMA_VERSION,
  templates: SLIDE_TEMPLATES,
  statTypes: STAT_TYPES,
  create: normalizeBriefing,
  migrate: normalizeBriefing,
  validate: validateBriefingDocument,
  createSlide,
  addSlide,
  updateSlide,
  moveSlide,
  duplicateSlide,
  removeSlide,
  updateBlock,
  encode: encodeBriefing,
  decode: decodeBriefing,
  createLink: createBriefingUrl,
  readHash: readBriefingHash,
});

export const queries = Object.freeze({
  normalize: normalizeFilter,
  matches: matchesFilter,
  statistic: computeStat,
});

export const sources = Object.freeze({ inspect: inspectSource });

export const smartImages = Object.freeze({
  format: SMART_IMAGE_FORMAT,
  version: SMART_IMAGE_VERSION,
  chunk: SMART_IMAGE_CHUNK,
  limits: SMART_IMAGE_LIMITS,
  embed: embedProjectInPng,
  read: readProjectFromPng,
});

export const utilities = Object.freeze({ safeUrl });

export default Object.freeze({ version: GISMAP_CORE_VERSION, capabilities, briefing, queries, sources, smartImages, utilities });

export {
  BRIEFING_SCHEMA_VERSION,
  BRIEFING_SHARE_LIMITS,
  BRIEFING_SHARE_VERSION,
  MAX_SLIDES,
  SLIDE_TEMPLATES,
  STAT_TYPES,
  addSlide,
  computeStat,
  createBriefingUrl,
  createSlide,
  decodeBriefing,
  duplicateSlide,
  encodeBriefing,
  inspectSource,
  embedProjectInPng,
  matchesFilter,
  moveSlide,
  normalizeBriefing,
  normalizeFilter,
  readBriefingHash,
  readProjectFromPng,
  removeSlide,
  safeUrl,
  updateBlock,
  updateSlide,
  validateBriefing,
};
