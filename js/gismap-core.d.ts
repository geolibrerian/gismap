export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type BriefingFilter = {
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "not_in" | "contains" | "starts_with" | "is_null" | "is_not_null" | "and" | "or" | "not" | "feature_ids";
  field?: string;
  value?: JsonValue;
  values?: JsonValue[];
  ids?: Array<string | number>;
  args?: BriefingFilter[];
  arg?: BriefingFilter;
};

export type BriefingCamera = {
  center: [longitude: number, latitude: number];
  zoom: number;
  heading: number;
  tilt: number;
};

export type BriefingBlock = {
  id: string;
  type: string;
  [key: string]: unknown;
};

export type BriefingSlide = {
  id: string;
  template: "title" | "feature" | "map-narrative" | "key-numbers" | "actions";
  title: string;
  subtitle?: string;
  featureId?: string | null;
  camera?: BriefingCamera | null;
  fit?: "feature" | "selection" | null;
  blocks: BriefingBlock[];
  notes?: string;
  hidden: boolean;
  [key: string]: unknown;
};

export type BriefingDocument = {
  schemaVersion: 1;
  layerId?: string | null;
  queries: Record<string, BriefingFilter>;
  selection?: { ids?: string[]; useAll?: boolean; [key: string]: unknown };
  slides: BriefingSlide[];
  [key: string]: unknown;
};

export type ValidationIssue = {
  level: "error" | "warning";
  slideId?: string;
  path?: string;
  message: string;
  [key: string]: unknown;
};

export type SourceMetadata = {
  kind: "arcgis-service" | "arcgis-layer" | "geojson";
  url: string;
  title: string;
  description: string;
  geometryType: string | null;
  objectIdField: string | null;
  maxRecordCount: number | null;
  capabilities: string[];
  fields: Array<{ name: string; alias: string; type: string; role: "numeric" | "timestamp" | "text"; nullable: boolean }>;
  layers: Array<{ id: string | number; name: string }>;
};

export type SmartImageManifest = {
  format: "gismap-smart-image";
  version: 1;
  createdAt: string;
  project: Record<string, unknown> & { version: 1; layers: unknown[] };
};

export const GISMAP_CORE_VERSION: string;
export const capabilities: Readonly<Record<string, unknown>>;
export const briefing: Readonly<{
  schemaVersion: number;
  templates: ReadonlyArray<{ id: BriefingSlide["template"]; label: string; description: string }>;
  statTypes: readonly string[];
  create(value?: Partial<BriefingDocument>): BriefingDocument;
  migrate(value?: Partial<BriefingDocument>): BriefingDocument;
  validate(value: unknown, options?: Record<string, unknown>): { valid: boolean; document: BriefingDocument; issues: ValidationIssue[] };
  createSlide(template: BriefingSlide["template"], input?: Partial<BriefingSlide> & { fields?: string[]; date?: Date }): BriefingSlide;
  addSlide(document: unknown, slide: BriefingSlide, afterId?: string | null): BriefingDocument;
  updateSlide(document: unknown, slideId: string, patch: Partial<BriefingSlide>): BriefingDocument;
  moveSlide(document: unknown, slideId: string, offset: number): BriefingDocument;
  duplicateSlide(document: unknown, slideId: string): BriefingDocument;
  removeSlide(document: unknown, slideId: string): BriefingDocument;
  updateBlock(document: unknown, slideId: string, blockId: string, patch: Partial<BriefingBlock>): BriefingDocument;
  encode(document: unknown, options?: { compress?: boolean }): Promise<string>;
  decode(value: string): Promise<BriefingDocument>;
  createLink(options: { baseUrl: string; briefing: unknown; qrSafe?: boolean; compress?: boolean }): Promise<string>;
  readHash(hash: string): Promise<BriefingDocument | null>;
}>;
export const queries: Readonly<{
  normalize(value: unknown): BriefingFilter | null;
  matches(filter: BriefingFilter | null, record: Record<string, unknown>): boolean;
  statistic(block: BriefingBlock, records?: Array<{ attributes?: Record<string, unknown> }>, options?: { queries?: Record<string, BriefingFilter>; idField?: string | null; total?: number | null }): { value: number | null; sample: boolean; loaded: number; total: number | null; matched: number };
}>;
export const sources: Readonly<{
  inspect(url: string, options?: { fetchImpl?: typeof fetch; signal?: AbortSignal; allowHttp?: boolean }): Promise<SourceMetadata>;
}>;
export const smartImages: Readonly<{
  format: "gismap-smart-image";
  version: 1;
  chunk: "giMp";
  limits: Readonly<{ maxImageBytes: number; maxEncodedBytes: number; maxProjectBytes: number }>;
  embed(png: Blob | ArrayBuffer | Uint8Array, project: SmartImageManifest["project"]): Promise<Blob>;
  read(png: Blob | ArrayBuffer | Uint8Array): Promise<SmartImageManifest>;
}>;
export const utilities: Readonly<{ safeUrl(value: unknown): string | null }>;

/**
 * The in-page API at globalThis.gisMapOnline.briefing: everything in `briefing`
 * plus calls bound to the open map and project.
 */
export type InPageBriefingApi = typeof briefing & {
  get(): BriefingDocument;
  /** Opens a document in Briefing; its layerId (a service URL is loaded when missing) and selection apply. */
  load(document: unknown, options?: { activate?: boolean; present?: boolean; slide?: string; allowInvalid?: boolean }): { valid: boolean; document: BriefingDocument; issues: ValidationIssue[]; ready: Promise<void> };
  captureCamera(): BriefingCamera;
  saveCurrentCamera(slideId: string): BriefingDocument;
  /** Slides from the map as it looks: style, filter, Features-tab choices; optional AI descriptions. */
  generate(options?: { layerId?: string; ai?: boolean; share?: boolean }): Promise<BriefingDocument>;
  /** The landscape PDF handout, with a QR code back to the live briefing. */
  exportPdf(options?: { withLink?: boolean }): Promise<File>;
  /** The full share link (layers, styles, filters, skin, view), or a slides-only link with documentOnly. */
  createLink(document?: unknown, options?: { qrSafe?: boolean; documentOnly?: boolean; slide?: string; baseUrl?: string; compress?: boolean }): Promise<string>;
  exportGmo(document?: unknown, options?: { fileName?: string }): { fileName: string; mimeType: string; text: string; blob: Blob };
};

declare const core: Readonly<{
  version: string;
  capabilities: typeof capabilities;
  briefing: typeof briefing;
  queries: typeof queries;
  sources: typeof sources;
  smartImages: typeof smartImages;
  utilities: typeof utilities;
}>;
export default core;
