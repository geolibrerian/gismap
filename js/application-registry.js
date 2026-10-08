const PLACEMENTS = new Set(["left", "right", "bottom", "floating"]);

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

export class ToolRegistry {
  #tools = new Map();

  register(definition) {
    const id = requireText(definition?.id, "Tool id");
    if (this.#tools.has(id)) throw new Error(`Tool “${id}” is already registered.`);
    if (typeof definition.execute !== "function") throw new Error(`Tool “${id}” requires an execute function.`);
    const tool = Object.freeze({
      id,
      displayName: requireText(definition.displayName || id, "Tool display name"),
      description: String(definition.description || ""),
      validate: typeof definition.validate === "function" ? definition.validate : () => true,
      execute: definition.execute,
    });
    this.#tools.set(id, tool);
    return tool;
  }

  list() { return [...this.#tools.values()]; }
  has(id) { return this.#tools.has(id); }

  async execute(id, input = {}, context = {}) {
    const tool = this.#tools.get(id);
    if (!tool) throw new Error(`Unknown tool: ${id}`);
    const result = tool.validate(input, context);
    if (result !== true) throw new Error(typeof result === "string" ? result : `Invalid input for ${id}.`);
    return tool.execute(structuredClone(input), context);
  }
}

export class PanelRegistry {
  #types = new Map();
  #instances = new Map();

  register(definition) {
    const type = requireText(definition?.type, "Panel type");
    if (this.#types.has(type)) throw new Error(`Panel type “${type}” is already registered.`);
    if (typeof definition.mount !== "function") throw new Error(`Panel “${type}” requires a mount function.`);
    const placements = definition.placements?.length ? definition.placements : ["left", "right"];
    placements.forEach((placement) => {
      if (!PLACEMENTS.has(placement)) throw new Error(`Panel “${type}” has unsupported placement “${placement}”.`);
    });
    const panel = Object.freeze({
      type,
      displayName: requireText(definition.displayName || type, "Panel display name"),
      description: String(definition.description || ""),
      category: String(definition.category || "General"),
      bindings: [...(definition.bindings || ["active-layer"])],
      capabilities: [...(definition.capabilities || [])],
      defaults: structuredClone(definition.defaults || {}),
      validate: typeof definition.validate === "function" ? definition.validate : () => true,
      mount: definition.mount,
      update: typeof definition.update === "function" ? definition.update : () => {},
      resize: typeof definition.resize === "function" ? definition.resize : () => {},
      unmount: typeof definition.unmount === "function" ? definition.unmount : () => {},
      minSize: { width: 260, height: 160, ...(definition.minSize || {}) },
      placements: [...placements],
      authoring: definition.authoring !== false,
      presentation: definition.presentation !== false,
      multiple: definition.multiple !== false,
      status: ["ready", "conditional", "planned"].includes(definition.status) ? definition.status : "ready",
      availability: typeof definition.availability === "function" ? definition.availability : () => ({ available: true, reason: "" }),
    });
    this.#types.set(type, panel);
    return panel;
  }

  list() { return [...this.#types.values()]; }
  get(type) { return this.#types.get(type) || null; }
  getInstance(instanceId) { return this.#instances.get(instanceId) || null; }

  mount(config, host, context = {}) {
    const instanceId = requireText(config?.instanceId, "Panel instance id");
    if (this.#instances.has(instanceId)) throw new Error(`Panel instance “${instanceId}” is already mounted.`);
    const definition = this.#types.get(config.type);
    if (!definition) return this.#mountRepair(config, host);
    const validation = definition.validate(config);
    if (validation !== true) return this.#mountRepair(config, host, validation || "Configuration needs repair.");
    const cleanup = new Set();
    const instanceContext = {
      ...context,
      config: structuredClone(config),
      onCleanup(callback) { if (typeof callback === "function") cleanup.add(callback); },
    };
    const mounted = definition.mount(host, instanceContext) || {};
    const instance = { instanceId, config: structuredClone(config), definition, host, cleanup, mounted };
    this.#instances.set(instanceId, instance);
    return instance;
  }

  update(instanceId, state) {
    const instance = this.#instances.get(instanceId);
    if (!instance) return false;
    instance.definition.update(instance.host, state, instance.mounted);
    return true;
  }

  resize(instanceId, size) {
    const instance = this.#instances.get(instanceId);
    if (!instance) return false;
    instance.definition.resize(instance.host, size, instance.mounted);
    return true;
  }

  unmount(instanceId, context = {}) {
    const instance = this.#instances.get(instanceId);
    if (!instance) return false;
    instance.definition?.unmount?.(instance.host, instance.mounted, context);
    for (const callback of instance.cleanup) {
      try { callback(); } catch (error) { console.error(`Panel cleanup failed for ${instanceId}`, error); }
    }
    this.#instances.delete(instanceId);
    return true;
  }

  unmountAll(context = {}) {
    [...this.#instances.keys()].forEach((id) => this.unmount(id, context));
  }

  #mountRepair(config, host, reason = "This panel type is not installed in this build.") {
    const documentRef = host?.ownerDocument || globalThis.document;
    const repair = documentRef?.createElement?.("section");
    if (repair) {
      repair.className = "application-panel__repair";
      const title = documentRef.createElement("strong");
      title.textContent = config.title || config.type || "Unknown panel";
      const message = documentRef.createElement("p");
      message.textContent = String(reason);
      repair.append(title, message);
      host.append(repair);
    }
    const instance = { instanceId: config.instanceId, config: structuredClone(config), definition: null, host, cleanup: new Set(), repair: true };
    this.#instances.set(config.instanceId, instance);
    return instance;
  }
}

export const APPLICATION_PLACEMENTS = Object.freeze([...PLACEMENTS]);
