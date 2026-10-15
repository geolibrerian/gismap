import { events } from "./events.js?v=0.18.2";
import { AuthController } from "./auth.js?v=0.18.2";
import { MapController } from "./map.js?v=0.18.13";
import { ProjectManager } from "./project.js?v=0.18.7";
import { IdentifyController } from "./identify.js?v=0.18.2";
import { AttributeTableController } from "./attribute-table.js?v=0.18.2";
import { AIController } from "./ai.js?v=0.18.2";
import { ToolManager } from "./tool-manager.js?v=0.18.2";
import { UIController } from "./ui.js?v=0.18.14";
import { ExportController } from "./export/export-controller.js?v=0.18.2";
import { parseShareParameters } from "./share.js?v=0.18.2";
import { decodeEmbeddedTour } from "./tour-share.js?v=0.18.2";
import { decodeFieldTask, featureLayerUrl, readFieldTaskHash } from "./field-task-share.js?v=0.18.13";
import { POPULAR_SERVICES } from "./catalog.js?v=0.18.2";
import { ApplicationRuntime } from "./application-runtime.js?v=0.18.2";
import { PanelManager } from "./panel-manager.js?v=0.18.2";
import { MobilePanelManager } from "./mobile-panel-manager.js?v=0.18.2";
import { MobileWorkflowRouter } from "./mobile-workflow-router.js?v=0.18.14";

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

async function start() {
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
  });
  mobileWorkflowRouter.initialize();
  await mapController.initialize();
  events.publish("project:loaded", { project: projectManager.current, missingFiles: [] });

  try {
    const shared = parseShareParameters(location.search, POPULAR_SERVICES, {
      allowHttp: location.hostname === "localhost" || location.hostname === "127.0.0.1",
    });
    if (shared.basemap) mapController.setBasemap(shared.basemap);
    const sharedLayers = [];
    for (const layer of shared.layers) {
      try {
        sharedLayers.push(...await loadSharedLayer(mapController, layer));
      } catch (error) {
        events.publish("app:error", { message: `Shared layer failed to load: ${error.message}` });
      }
    }
    const example = POPULAR_SERVICES.find((item) => (item.slug || item.id) === shared.example);
    if (example?.presentation && sharedLayers.length) {
      const primaryLayer = sharedLayers.find((layer) => /pm2[.\s-]*5/i.test(layer.title || "")) || sharedLayers[0];
      projectManager.setPresentation({ ...example.presentation, primaryLayerId: primaryLayer.uid });
    }
  } catch (error) {
    events.publish("app:error", { message: error.message });
  }

  const launchParams = new URLSearchParams(location.search);
  const requestedWorkflow = launchParams.get("workflow");
  const sharedBriefingIds = launchParams.get("briefing");
  if (requestedWorkflow === "briefing" && sharedBriefingIds) {
    const layer = mapController.getOperationalLayers().find((item) => typeof item.queryFeatures === "function");
    if (layer) projectManager.patchPresentation({ primaryLayerId: layer.uid, briefingSelection: { layerId: layer.uid, ids: sharedBriefingIds.split(",").filter(Boolean), useAll: false } });
  }
  const fieldTaskPayload = readFieldTaskHash(location.hash);
  if (fieldTaskPayload) {
    try {
      const shared = decodeFieldTask(fieldTaskPayload, { allowHttp: location.hostname === "localhost" || location.hostname === "127.0.0.1" });
      if (shared.kind === "assign") {
        // Bring in the feature layers the assignment points at, unless they are already on the map.
        const loaded = new Set(mapController.getOperationalLayers().flatMap((layer) => [featureLayerUrl(layer), mapController.getLayerConfig(layer).url]).filter(Boolean));
        for (const url of new Set(shared.task.features.map((feature) => feature.layerUrl).filter(Boolean))) {
          if (loaded.has(url)) continue;
          try {
            await loadSharedLayer(mapController, { url, serviceType: "arcgis-auto" });
          } catch (error) {
            events.publish("app:error", { message: `A field task layer failed to load: ${error.message}` });
          }
        }
      }
      // The fragment stays in place so a reload reopens the task even in an unsaved project.
      await mobileWorkflowRouter.openSharedTask(shared);
    } catch (error) {
      events.publish("app:error", { message: error.message });
    }
  } else if (["briefing", "tours", "tasks"].includes(requestedWorkflow)) {
    mobileWorkflowRouter.navigate(requestedWorkflow);
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

  // A narrow, intentional extension surface for local tools and debugging.
  globalThis.gisMapOnline = Object.freeze({
    events,
    map: mapController.map,
    view: mapController.view,
    getProject: () => projectManager.snapshot(),
    getConnections: () => authController.list(),
    exportData: (options) => exportController.exportLayer(options),
    application: Object.freeze({
      getState: () => applicationRuntime.state.value,
      getConfig: () => applicationRuntime.snapshot(),
      listPanels: () => applicationRuntime.panels.list(),
      listTools: () => applicationRuntime.tools.list(),
      runTool: (id, input, options) => applicationRuntime.runTool(id, input, options),
      plan: (prompt) => applicationRuntime.planRequest(prompt),
      previewPlan: (plan) => applicationRuntime.previewPlan(plan),
      undo: () => applicationRuntime.undo(),
    }),
  });
}

start().catch((error) => {
  console.error(error);
  document.querySelector("#map-status").textContent = "Map failed to start";
  events.publish("app:error", { message: error.message });
});
