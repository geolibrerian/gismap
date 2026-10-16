import { events } from "./events.js?v=0.18.2";
import { AuthController } from "./auth.js?v=0.18.2";
import { MapController } from "./map.js?v=0.31.0";
import { ProjectManager } from "./project.js?v=0.32.0";
import { IdentifyController } from "./identify.js?v=0.18.2";
import { AttributeTableController } from "./attribute-table.js?v=0.18.2";
import { AIController } from "./ai.js?v=0.27.0";
import { ToolManager } from "./tool-manager.js?v=0.18.2";
import { UIController } from "./ui.js?v=0.34.0";
import { ExportController } from "./export/export-controller.js?v=0.18.2";
import { SHARE_BASEMAPS, parseShareParameters } from "./share.js?v=0.29.0";
import { readShareLocation } from "./map-share.js?v=0.32.0";
import { decodeEmbeddedTour } from "./tour-share.js?v=0.18.2";
import { decodeFieldTask, featureLayerUrl, readFieldTaskHash, readFocus } from "./field-task-share.js?v=0.29.0";
import { POPULAR_SERVICES } from "./catalog.js?v=0.18.2";
import { ApplicationRuntime } from "./application-runtime.js?v=0.27.0";
import { PanelManager } from "./panel-manager.js?v=0.18.2";
import { MobilePanelManager } from "./mobile-panel-manager.js?v=0.18.2";
import { MobileWorkflowRouter } from "./mobile-workflow-router.js?v=0.29.0";
import { createClientApi } from "./briefing-api.js?v=0.32.0";
import { createCameraApi, createLayersApi } from "./layers-api.js?v=0.29.0";
import { registerLayerTools } from "./layer-tools.js?v=0.29.0";
import { createMapSpecApi } from "./map-spec-api.js?v=0.32.0";
import { mapSpecFromShareParameters } from "./map-spec.js?v=0.32.0";
import { GisMapError, ERROR_CODES } from "./gismap-errors.js?v=0.28.0";

async function loadSharedLayer(mapController, config) {
  const rootUrl = config.url.replace(/\/+$/, "");
  if (/\/FeatureServer$/i.test(new URL(rootUrl).pathname)) {
    const layers = await mapController.discoverFeatureServiceLayers(rootUrl);
    if (!layers.length) throw new Error("The shared FeatureServer does not advertise any feature layers.");
    const added = await Promise.all(layers.map((layer) => mapController.addService({
      ...config,
      url: layer.url,
      title: layers.length === 1 ? config.title : layer.name,
      serviceType: "feature",
    })));
    if (config.renderer && added.length === 1) mapController.restoreRenderer(added[0], config.renderer);
    return added;
  }
  const added = await mapController.addService(config);
  if (config.renderer) mapController.restoreRenderer(added, config.renderer);
  return [added];
}

// Readiness for agents and scripts: gisMapOnline.ready, a `gismap:ready` event,
// and <html data-gismap-state="loading|ready|error">.
document.documentElement.dataset.gismapState = "loading";
let resolveReady;
let rejectReady;
const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
ready.catch(() => {});

async function start() {
  const allowHttp = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  const authController = new AuthController(events);
  await authController.initialize();
  const mapController = new MapController(events, authController);
  const projectManager = new ProjectManager(events, mapController, authController);
  const identifyController = new IdentifyController(events, mapController);
  const aiController = new AIController(events, mapController);
  const toolManager = new ToolManager(events, mapController);
  const tableController = new AttributeTableController(events, mapController);
  const exportController = new ExportController(events, mapController);
  const panelManager = new PanelManager();
  const mobilePanelManager = new MobilePanelManager({ panelManager });
  const applicationRuntime = new ApplicationRuntime({ events, mapController, projectManager, aiController, panelManager, mobilePanelManager });
  const uiController = new UIController(
    events,
    mapController,
    projectManager,
    authController,
    aiController,
    toolManager,
    exportController,
    applicationRuntime,
    panelManager,
    mobilePanelManager,
  );

  identifyController.initialize();
  tableController.initialize();
  applicationRuntime.initialize();
  uiController.initialize();
  const mobileWorkflowRouter = new MobileWorkflowRouter({
    events, projectManager, mapController,
    prepareWorkflow: (route) => uiController.prepareMobileWorkflow(route),
    openWorkflow: (route) => uiController.openMobileWorkflow(route),
    shareWorkflow: (route, payload) => uiController.shareMobileWorkflow(route, payload),
    notify: (message) => uiController.toast(message),
    dockWorkflow: (open) => uiController.dockWorkflowPanel(open),
    createTour: (places, options) => uiController.createTourFromPlaces(places, options),
    createBriefing: (request) => uiController.createBriefingForLayerUrl(request),
  });
  mobileWorkflowRouter.initialize();
  // Briefing action items become field tasks.
  uiController.fieldTasks = mobileWorkflowRouter;
  // Briefing documents can name a service URL as their layer; it loads like a shared layer.
  uiController.loadLayer = (config) => loadSharedLayer(mapController, config);

  // The public, in-page API. Defined before the map starts so agents can await `ready`.
  const layersApi = createLayersApi({ mapController, loadLayer: (config) => loadSharedLayer(mapController, config), state: applicationRuntime.state, events, allowHttp });
  const cameraApi = createCameraApi({ mapController, layers: layersApi });
  registerLayerTools(applicationRuntime.tools, layersApi);
  const clientApi = createClientApi({
    projectManager,
    mapController,
    host: {
      openBriefing: (briefing, options) => uiController.openBriefingDocument(briefing, options),
      generate: (options) => uiController.generateBriefingFromView(options),
      createPdf: (options) => uiController.briefingPdfFile(options),
      loadLayer: (config) => loadSharedLayer(mapController, config),
      layerInfo: (layer) => layersApi.get(layer.uid),
    },
  });
  const issues = [];
  const mapSpecApi = createMapSpecApi({
    layers: layersApi,
    camera: cameraApi,
    mapController,
    issues,
    allowHttp,
    host: {
      setBasemap: (id) => mapController.setBasemap(id),
      applySkin: (skin) => uiController.applySkinChoice(skin),
      setTitle: (title) => uiController.setProjectTitle(title),
      getTitle: () => projectManager.current?.name || "",
      getSkin: () => document.documentElement.dataset.skin || null,
      showLegend: () => uiController.showLegendWidget(),
      showIssues: (list) => uiController.showSpecIssues(list),
      loadBriefing: (briefing) => clientApi.briefing.load(briefing, { activate: false }).ready,
      getBriefing: () => projectManager.current?.presentation?.briefing || null,
    },
  });
  const describeTool = (tool) => ({ id: tool.id, displayName: tool.displayName, description: tool.description, inputSchema: tool.inputSchema });
  const describe = () => {
    let camera = null;
    try { camera = cameraApi.get(); } catch { /* Not ready yet. */ }
    const presentation = projectManager.current?.presentation || {};
    return {
      ...clientApi.capabilities(),
      tools: applicationRuntime.tools.list().map(describeTool),
      errorCodes: Object.keys(ERROR_CODES),
      state: {
        status: document.documentElement.dataset.gismapState,
        layers: mapController.map ? layersApi.list() : [],
        basemap: mapController.getBasemapId(),
        camera,
        skin: document.documentElement.dataset.skin || presentation.skin || null,
        mode: presentation.template || "standard",
        briefingSlides: presentation.briefing?.slides?.length || 0,
        aiConfigured: aiController.isConfigured(),
        issues: issues.slice(),
      },
    };
  };
  uiController.mapSpec = mapSpecApi;
  globalThis.gisMapOnline = Object.freeze({
    version: clientApi.version,
    /** Resolves once the view, basemap and the layers the address asked for have loaded. */
    ready,
    describe,
    layers: layersApi,
    camera: cameraApi,
    /** Whole maps as one JSON object (schemas/map-v1.schema.json): validate, encode, decode, createLink, load, fromCurrent. */
    mapSpec: mapSpecApi,
    GisMapError,
    events,
    /** Experimental escape hatches: the ArcGIS Map and SceneView. Prefer layers.* and camera.*. */
    get map() { return mapController.map; },
    get view() { return mapController.view; },
    getProject: () => projectManager.snapshot(),
    getConnections: () => authController.list(),
    exportData: (options) => exportController.exportLayer(options),
    capabilities: clientApi.capabilities,
    briefing: clientApi.briefing,
    queries: clientApi.queries,
    sources: clientApi.sources,
    smartImages: clientApi.smartImages,
    application: Object.freeze({
      getState: () => applicationRuntime.state.value,
      getConfig: () => applicationRuntime.snapshot(),
      listPanels: () => applicationRuntime.panels.list(),
      listTools: () => applicationRuntime.tools.list().map(describeTool),
      runTool: (id, input, options) => applicationRuntime.runTool(id, input, options),
      plan: (prompt) => applicationRuntime.planRequest(prompt),
      previewPlan: (plan) => applicationRuntime.previewPlan(plan),
      undo: () => applicationRuntime.undo(),
    }),
  });

  // Read the address before the scene exists, so it starts on the requested
  // basemap instead of drawing the default and swapping it mid-draw.
  let shared = null;
  let sharedError = null;
  try {
    shared = parseShareParameters(location.search, POPULAR_SERVICES, { allowHttp });
  } catch (error) {
    sharedError = error;
  }
  let sharedState = null;
  let sharedStateError = null;
  try {
    sharedState = await readShareLocation(location, { allowHttp });
  } catch (error) {
    sharedStateError = error;
  }
  const linkBasemap = shared?.basemap || (sharedState?.kind === "map-spec" ? sharedState.spec?.basemap : sharedState?.basemap) || null;
  mapController.setInitialBasemap(SHARE_BASEMAPS.has(linkBasemap) ? linkBasemap : null);
  await mapController.initialize();
  events.publish("project:loaded", { project: projectManager.current, missingFiles: [] });

  // Waits that depend on drawing (camera moves) never finish in a hidden tab.
  const within = (promise, seconds) => Promise.race([promise, new Promise((resolve) => setTimeout(resolve, seconds * 1000))]);
  const sharedLayers = [];
  try {
    if (sharedError) throw sharedError;
    if (shared.basemap) mapController.setBasemap(shared.basemap);
    // ?layer= links (with their title=, where=, style=… parameters) load as a map spec, the one path for links.
    if (shared.layers.length) {
      const spec = mapSpecFromShareParameters(shared);
      // Another part of the link (#map, #briefing, a tour, a task, #at=) decides the view.
      if (sharedState || /(?:^#|&)(?:tour|fieldTask|at)=/.test(location.hash)) spec.camera = { fit: "none" };
      await within(mapSpecApi.load(spec, { replace: false }).ready, 120).catch((error) => events.publish("app:error", { message: error.message }));
      sharedLayers.push(...mapController.getOperationalLayers());
    }
    const example = POPULAR_SERVICES.find((item) => (item.slug || item.id) === shared.example);
    if (example?.presentation && sharedLayers.length) {
      const primaryLayer = sharedLayers.find((layer) => /pm2[.\s-]*5/i.test(layer.title || "")) || sharedLayers[0];
      projectManager.setPresentation({ ...example.presentation, primaryLayerId: primaryLayer.uid });
    }
  } catch (error) {
    events.publish("app:error", { message: error.message });
  }

  // A styled map or briefing link (`#map=…`, `#briefing=…`, or `?briefing=<file URL>`).
  try {
    if (sharedStateError) throw sharedStateError;
    if (sharedState?.kind === "map-spec") {
      await within(mapSpecApi.load(sharedState.spec, { replace: false }).ready, 120);
      // A link whose spec carries slides opens presenting them, as a briefing link does.
      // (mapSpec.load from the API stays quiet: an agent decides when to present.)
      const briefing = projectManager.current?.presentation?.briefing;
      if (sharedState.spec?.briefing && briefing?.slides?.some((slide) => !slide.hidden)) await uiController.openBriefingDocument(briefing, { present: true });
    } else if (sharedState) await uiController.openSharedState(sharedState, { loadLayer: (config) => loadSharedLayer(mapController, config) });
  } catch (error) {
    events.publish("app:error", { message: error.message });
  }

  const launchParams = new URLSearchParams(location.search);
  const requestedWorkflow = sharedState ? null : launchParams.get("workflow");
  const sharedBriefingIds = launchParams.get("briefing");
  if (requestedWorkflow === "briefing" && sharedBriefingIds && !/^https?:/i.test(sharedBriefingIds)) {
    const layer = mapController.getOperationalLayers().find((item) => typeof item.queryFeatures === "function");
    if (layer) projectManager.patchPresentation({ primaryLayerId: layer.uid, briefingSelection: { layerId: layer.uid, ids: sharedBriefingIds.split(",").filter(Boolean), useAll: false } });
  }
  const fieldTaskPayload = readFieldTaskHash(location.hash);
  if (fieldTaskPayload) {
    try {
      const shared = decodeFieldTask(fieldTaskPayload, { allowHttp: location.hostname === "localhost" || location.hostname === "127.0.0.1" });
      {
        // Bring in the feature layers the task points at (to work on them, or to inspect them in a
        // report), unless they are already on the map.
        const loaded = new Set(mapController.getOperationalLayers().flatMap((layer) => [featureLayerUrl(layer), mapController.getLayerConfig(layer).url]).filter(Boolean));
        for (const url of new Set(shared.task.features.map((feature) => feature.layerUrl).filter(Boolean))) {
          if (loaded.has(url)) continue;
          try {
            await loadSharedLayer(mapController, { url, serviceType: "arcgis-auto", renderer: shared.task.layerStyles?.[url] || null });
          } catch (error) {
            events.publish("app:error", { message: `A field task layer failed to load: ${error.message}` });
          }
        }
      }
      // The fragment stays in place so a reload reopens the task even in an unsaved project.
      await mobileWorkflowRouter.openSharedTask(shared, readFocus(location.hash));
    } catch (error) {
      events.publish("app:error", { message: error.message });
    }
  } else if (["briefing", "tours", "tasks"].includes(requestedWorkflow)) {
    mobileWorkflowRouter.navigate(requestedWorkflow);
  }
  // A location link (`#at=lat,lon`, as in PDF reports) opens the map pinned on that place.
  const sharedPlace = !fieldTaskPayload && readFocus(location.hash).at;
  if (sharedPlace) {
    mapController.setTaskPin({ kind: "task", label: "Shared location", ...sharedPlace });
    mapController.goToTaskPlaces([sharedPlace], { animate: false }).catch(() => {});
  }

  const tourMatch = location.hash.match(/(?:^#|&)tour=([^&]+)/);
  if (tourMatch) {
    try {
      const tour = decodeEmbeddedTour(tourMatch[1], new Set([
        "topo-3d", "navigation-3d", "navigation-dark-3d", "osm-3d", "gray-3d", "dark-gray-3d", "streets-3d", "streets-dark-3d", "topo-vector", "streets-vector", "navigation", "gray-vector", "dark-gray-vector", "osm", "satellite", "hybrid",
      ]));
      projectManager.setPresentation({ template: "atlas", ...tour });
      const launch = new URLSearchParams(location.search);
      const chapter = Math.max(0, Number(launch.get("chapter") || 1) - 1);
      await uiController.openSharedAtlas({
        chapterIndex: chapter,
        autoplay: launch.get("autoplay") === "1",
        tourOnly: launch.get("tourOnly") === "1",
        embed: launch.get("embed") === "1",
      });
      if (tour.chapters.some((item) => item.sharedBasemapFallback)) events.publish("app:error", { message: "One or more shared basemaps are unavailable; a supported map was used instead." });
    } catch (error) { events.publish("app:error", { message: error.message }); }
  }

  // Installed as an app, double-clicking a .gmo / .gmop / .gmoatlas file opens it here.
  globalThis.launchQueue?.setConsumer?.(async ({ files = [] }) => {
    for (const handle of files) await uiController.importProjectFile(await handle.getFile());
  });

  // The basemap's layers loading is part of "ready": a screenshot taken now shows the whole map.
  await Promise.race([mapController.map.basemap?.load?.(), new Promise((resolve) => setTimeout(resolve, 15000))]).catch(() => {});
  document.documentElement.dataset.gismapState = "ready";
  resolveReady();
  dispatchEvent(new CustomEvent("gismap:ready", { detail: describe() }));
}

start().catch((error) => {
  console.error(error);
  document.documentElement.dataset.gismapState = "error";
  rejectReady(error);
  document.querySelector("#map-status").textContent = "Map failed to start";
  events.publish("app:error", { message: error.message });
});
