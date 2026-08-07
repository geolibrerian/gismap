import { events } from "./events.js?v=0.3.2";
import { MapController } from "./map.js?v=0.3.2";
import { ProjectManager } from "./project.js?v=0.3.2";
import { IdentifyController } from "./identify.js?v=0.3.2";
import { AttributeTableController } from "./attribute-table.js?v=0.3.2";
import { AIController } from "./ai.js?v=0.2.6";
import { ToolManager } from "./tool-manager.js?v=0.2.0";
import { UIController } from "./ui.js?v=0.3.2";

async function start() {
  const mapController = new MapController(events);
  const projectManager = new ProjectManager(events, mapController);
  const identifyController = new IdentifyController(events, mapController);
  const aiController = new AIController(events, mapController);
  const toolManager = new ToolManager(events, mapController);
  const tableController = new AttributeTableController(events, mapController);
  const uiController = new UIController(
    events,
    mapController,
    projectManager,
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
  });
}

start().catch((error) => {
  console.error(error);
  document.querySelector("#map-status").textContent = "Map failed to start";
  events.publish("app:error", { message: error.message });
});
