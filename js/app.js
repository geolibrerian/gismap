import { events } from "./events.js?v=0.15.40";
import { AuthController } from "./auth.js?v=0.15.40";
import { MapController } from "./map.js?v=0.15.40";
import { ProjectManager } from "./project.js?v=0.15.40";
import { IdentifyController } from "./identify.js?v=0.15.40";
import { AttributeTableController } from "./attribute-table.js?v=0.15.40";
import { AIController } from "./ai.js?v=0.15.40";
import { ToolManager } from "./tool-manager.js?v=0.15.40";
import { UIController } from "./ui.js?v=0.15.40";
import { ExportController } from "./export/export-controller.js?v=0.15.40";
import { parseShareParameters } from "./share.js?v=0.15.40";
import { POPULAR_SERVICES } from "./catalog.js?v=0.15.40";
import { ApplicationRuntime } from "./application-runtime.js?v=0.15.40";

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
  const applicationRuntime = new ApplicationRuntime({ events, mapController, projectManager, aiController });
  const uiController = new UIController(
    events,
    mapController,
    projectManager,
    authController,
    aiController,
    toolManager,
    exportController,
    applicationRuntime,
  );

  identifyController.initialize();
  tableController.initialize();
  applicationRuntime.initialize();
  uiController.initialize();
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
