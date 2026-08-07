export class ToolManager {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.tools = new Map();
  }

  async load(file) {
    const url = URL.createObjectURL(file);
    try {
      const module = await import(url);
      const register = module.default || module.register;
      if (typeof register !== "function") {
        throw new Error("A custom tool must export a default registration function.");
      }
      const context = Object.freeze({
        events: this.events,
        map: this.mapController.map,
        view: this.mapController.view,
        getLayers: () => this.mapController.getOperationalLayers(),
      });
      const definition = (await register(context)) || {};
      const id = definition.id || file.name;
      this.tools.set(id, { id, fileName: file.name, ...definition });
      this.events.publish("tool:loaded", { tool: this.tools.get(id) });
      return this.tools.get(id);
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
