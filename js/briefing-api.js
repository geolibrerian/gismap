import core, { normalizeBriefing, updateSlide, validateBriefingDocument } from "./gismap-core.js?v=0.21.0";

const clone = (value) => structuredClone(value);
const cleanName = (value) => String(value || "briefing").trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "briefing";

/** Bind the pure core to the active GISMap project and camera. */
export function createBriefingApi({ projectManager, mapController, baseUrl = () => globalThis.location?.href || "https://gismap.online/" }) {
  if (!projectManager) throw new Error("The Briefing API requires a project manager.");

  const current = () => normalizeBriefing(projectManager.current?.presentation?.briefing);
  const save = (document, { activate = false } = {}) => {
    const briefing = normalizeBriefing(document);
    const presentation = { ...(projectManager.current?.presentation || {}), briefing };
    if (activate) {
      presentation.template = "briefing";
      projectManager.setPresentation(presentation);
    } else {
      projectManager.patchPresentation({ briefing });
    }
    return clone(briefing);
  };

  const api = {
    ...core.briefing,
    capabilities: () => clone(core.capabilities),
    get: () => clone(current()),
    load(document, options = {}) {
      const result = validateBriefingDocument(document, options);
      if (!result.valid && options.allowInvalid !== true) {
        const error = new Error("The briefing contains validation errors.");
        error.issues = result.issues;
        throw error;
      }
      return { ...result, document: save(result.document, { activate: options.activate !== false }) };
    },
    captureCamera() {
      const state = mapController?.getViewState?.();
      if (!state?.center) throw new Error("The map camera is not ready.");
      return { center: [...state.center], zoom: state.zoom, heading: state.heading ?? 0, tilt: state.tilt ?? 0 };
    },
    saveCurrentCamera(slideId) {
      const document = updateSlide(current(), slideId, { camera: api.captureCamera(), fit: null });
      if (!document.slides.some((slide) => slide.id === slideId)) throw new Error(`Unknown slide: ${slideId}`);
      return save(document);
    },
    async createLink(document = current(), options = {}) {
      return core.briefing.createLink({ baseUrl: options.baseUrl || baseUrl(), briefing: document, qrSafe: options.qrSafe === true, compress: options.compress !== false });
    },
    exportGmo(document = current(), options = {}) {
      const project = projectManager.snapshot();
      project.presentation = { ...project.presentation, briefing: normalizeBriefing(document) };
      const text = JSON.stringify(project, null, 2);
      return {
        fileName: `${cleanName(options.fileName || project.presentation?.modeTitles?.briefing || project.name)}.gmo`,
        mimeType: "application/vnd.gismap.online.project+json",
        text,
        blob: new Blob([text], { type: "application/vnd.gismap.online.project+json" }),
      };
    },
  };
  return Object.freeze(api);
}

export function createClientApi(options) {
  const briefing = createBriefingApi(options);
  const smartImages = Object.freeze({ ...core.smartImages, downloadCurrent: (settings) => options.projectManager.exportSmartImage(settings) });
  return Object.freeze({
    version: core.version,
    capabilities: () => clone(core.capabilities),
    briefing,
    queries: core.queries,
    sources: core.sources,
    smartImages,
  });
}
