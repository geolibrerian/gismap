import { events } from "./events.js?v=0.10.1";
import { AuthController } from "./auth.js?v=0.10.1";
import { MapController } from "./map.js?v=0.10.1";
import { ProjectManager } from "./project.js?v=0.10.1";
import { IdentifyController } from "./identify.js?v=0.10.1";
import { AttributeTableController } from "./attribute-table.js?v=0.10.1";
import { AIController } from "./ai.js?v=0.10.1";
import { ToolManager } from "./tool-manager.js?v=0.10.1";
import { UIController } from "./ui.js?v=0.10.1";
import { ExportController } from "./export/export-controller.js?v=0.10.1";
import { parseShareParameters } from "./share.js?v=0.10.1";
import { POPULAR_SERVICES } from "./catalog.js?v=0.10.1";

async function loadSharedLayer(mapController, config) {
  const rootUrl = config.url.replace(/\/+$/, "");
  if (/\/FeatureServer$/i.test(new URL(rootUrl).pathname)) {
    const layers = await mapController.discoverFeatureServiceLayers(rootUrl);
    if (!layers.length) throw new Error("The shared FeatureServer does not advertise any feature layers.");
    return Promise.all(layers.map((layer) => mapController.addService({
      ...config,
      url: layer.url,
      title: layers.length === 1 ? config.title : layer.name,
      serviceType: "feature",
    })));
  }
  return [await mapController.addService(config)];
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
  const uiController = new UIController(
    events,
    mapController,
    projectManager,
    authController,
    aiController,
    toolManager,
    exportController,
  );

  identifyController.initialize();
  tableController.initialize();
  uiController.initialize();
  await mapController.initialize();
  events.publish("project:loaded", { project: projectManager.current, missingFiles: [] });

  try {
    const shared = parseShareParameters(location.search, POPULAR_SERVICES, {
      allowHttp: location.hostname === "localhost" || location.hostname === "127.0.0.1",
    });
    if (shared.basemap) mapController.setBasemap(shared.basemap);
    for (const layer of shared.layers) {
      try {
        await loadSharedLayer(mapController, layer);
      } catch (error) {
        events.publish("app:error", { message: `Shared layer failed to load: ${error.message}` });
      }
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
  });
}

start().catch((error) => {
  console.error(error);
  document.querySelector("#map-status").textContent = "Map failed to start";
  events.publish("app:error", { message: error.message });
});
