import { events } from "./events.js?v=0.7.3";
import { AuthController } from "./auth.js?v=0.7.3";
import { MapController } from "./map.js?v=0.7.3";
import { ProjectManager } from "./project.js?v=0.7.3";
import { IdentifyController } from "./identify.js?v=0.7.3";
import { AttributeTableController } from "./attribute-table.js?v=0.7.3";
import { AIController } from "./ai.js?v=0.7.3";
import { ToolManager } from "./tool-manager.js?v=0.7.3";
import { UIController } from "./ui.js?v=0.7.3";

async function start() {
  const authController = new AuthController(events);
  await authController.initialize();
  const mapController = new MapController(events, authController);
  const projectManager = new ProjectManager(events, mapController, authController);
  const identifyController = new IdentifyController(events, mapController);
  const aiController = new AIController(events, mapController);
  const toolManager = new ToolManager(events, mapController);
  const tableController = new AttributeTableController(events, mapController);
  const uiController = new UIController(
    events,
    mapController,
    projectManager,
    authController,
    aiController,
    toolManager,
  );

  identifyController.initialize();
  tableController.initialize();
  uiController.initialize();
  await mapController.initialize();
  events.publish("project:loaded", { project: projectManager.current, missingFiles: [] });

  // A narrow, intentional extension surface for local tools and debugging.
  globalThis.gisMapOnline = Object.freeze({
    events,
    map: mapController.map,
    view: mapController.view,
    getProject: () => projectManager.snapshot(),
    getConnections: () => authController.list(),
  });
}

start().catch((error) => {
  console.error(error);
  document.querySelector("#map-status").textContent = "Map failed to start";
  events.publish("app:error", { message: error.message });
});
