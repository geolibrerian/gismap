const STORAGE_KEY = "gismap-online:projects:v1";
const CURRENT_KEY = "gismap-online:current-project:v1";

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `project-${Date.now()}`;
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

export class ProjectManager {
  constructor(events, mapController, authController = null) {
    this.events = events;
    this.mapController = mapController;
    this.authController = authController;
    this.current = this.#blank("Untitled project");
  }

  #blank(name) {
    return {
      schema: "https://gismap.online/project/v1",
      version: 1,
      id: makeId(),
      name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      basemap: "topo-3d",
      ground: "world-elevation",
      view: { type: "scene", center: [-98.5, 39.5], zoom: 4, heading: 0, tilt: 35 },
      layers: [],
      bookmarks: [],
      tools: [],
      ai: { provider: null, model: null },
      connections: [],
    };
  }

  list() {
    return Object.values(this.#readStore()).sort((a, b) =>
      String(b.updatedAt).localeCompare(String(a.updatedAt)),
    );
  }

  async create(name = "Untitled project") {
    await this.mapController.clearOperationalLayers();
    this.mapController.drawLayer?.removeAll();
    this.mapController.setBasemap("topo-3d");
    this.mapController.setGround("world-elevation");
    await this.mapController.restoreView({ center: [-98.5, 39.5], zoom: 4, heading: 0, tilt: 35 });
    this.current = this.#blank(name.trim() || "Untitled project");
    this.events.publish("project:loaded", { project: this.current, missingFiles: [] });
    return this.current;
  }

  snapshot() {
    this.current = {
      ...this.current,
      updatedAt: new Date().toISOString(),
      basemap: this.mapController.getBasemapId(),
      ground: this.mapController.getGroundId(),
      view: this.mapController.getViewState(),
      layers: this.mapController.getAllLayerConfigs().map(({ uid, ...layer }) => layer),
      connections: this.authController?.exportConnections() ?? this.current.connections ?? [],
    };
    return structuredClone(this.current);
  }

  save(name = null) {
    if (name?.trim()) this.current.name = name.trim();
    const project = this.snapshot();
    const store = this.#readStore();
    store[project.id] = project;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    localStorage.setItem(CURRENT_KEY, project.id);
    this.events.publish("project:saved", { project });
    return project;
  }

  async loadSaved(id) {
    const project = this.#readStore()[id];
    if (!project) throw new Error("That local project no longer exists.");
    return this.load(project);
  }

  async load(project, packageFiles = new Map()) {
    if (!project || project.version !== 1 || !Array.isArray(project.layers)) {
      throw new Error("This is not a supported GIS Map Online project file.");
    }
    this.authController?.importConnections(project.connections ?? []);
    await this.mapController.clearOperationalLayers();
    this.mapController.setBasemap(project.basemap || "topo-3d");
    this.mapController.setGround(project.ground || "world-elevation");
    const missingFiles = [];

    for (const layer of project.layers) {
      try {
        if (layer.local) {
          const packaged = packageFiles.get(layer.projectPath) || packageFiles.get(`data/${layer.fileName}`);
          if (!packaged) {
            missingFiles.push(layer.fileName);
            continue;
          }
          const added = await this.mapController.addLocalFile(packaged, layer.projectPath);
          await this.#restoreLayerPresentation(added, layer);
        } else if (layer.url) {
          const added = await this.mapController.addService({
            url: layer.url,
            title: layer.title,
            serviceType: this.#serviceTypeFor(layer),
            opacity: layer.opacity,
            visible: layer.visible,
            elevationInfo: layer.elevationInfo,
            refreshInterval: layer.refreshInterval,
          });
          await this.#restoreLayerPresentation(added, layer);
        }
      } catch (error) {
        this.events.publish("app:error", {
          message: `Could not restore ${layer.title || layer.fileName}: ${error.message}`,
        });
      }
    }

    this.current = structuredClone(project);
    await this.mapController.restoreView(project.view);
    this.events.publish("project:loaded", { project: this.current, missingFiles });
    return { project: this.current, missingFiles };
  }

  async #restoreLayerPresentation(layer, config) {
    layer.visible = config.visible !== false;
    layer.opacity = Number.isFinite(config.opacity) ? config.opacity : 1;
    if (config.renderer) this.mapController.restoreRenderer(layer, config.renderer);
  }

  #serviceTypeFor(layer) {
    const type = layer.sourceType || layer.type;
    const lookup = {
      feature: "feature",
      "map-image": "map-image",
      imagery: "imagery",
      wms: "wms",
      kml: "kml",
      geojson: "geojson",
    };
    return lookup[type] || "arcgis-auto";
  }

  exportJson() {
    const project = this.snapshot();
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: "application/vnd.gismap.online.project+json",
    });
    downloadBlob(blob, `${this.#exportName(project)}.gmo`);
    this.events.publish("project:exported", { kind: "json" });
  }

  async exportPackage() {
    if (!globalThis.JSZip) throw new Error("The ZIP library did not load.");
    const project = this.snapshot();
    const zip = new JSZip();
    for (const layer of this.mapController.getOperationalLayers()) {
      const asset = this.mapController.localAssets.get(layer.uid);
      const config = this.mapController.getLayerConfig(layer);
      if (asset && config.projectPath) zip.file(config.projectPath, asset);
    }
    zip.file("project.json", JSON.stringify(project, null, 2));
    zip.file(
      "README.txt",
      "GIS Map Online project package\nOpen https://gismap.online and choose Project > Import project file.\n",
    );
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
    downloadBlob(blob, `${this.#exportName(project)}.gmop`);
    this.events.publish("project:exported", { kind: "package" });
  }

  async importFile(file) {
    if (/\.(?:zip|gmop|gismap)$/i.test(file.name)) {
      if (!globalThis.JSZip) throw new Error("The ZIP library did not load.");
      const zip = await JSZip.loadAsync(file);
      const projectEntry = zip.file("project.json");
      if (!projectEntry) throw new Error("The package does not contain project.json.");
      const project = JSON.parse(await projectEntry.async("text"));
      const packageFiles = new Map();
      await Promise.all(
        Object.values(zip.files)
          .filter((entry) => !entry.dir && entry.name !== "project.json" && entry.name !== "README.txt")
          .map(async (entry) => {
            const blob = await entry.async("blob");
            packageFiles.set(entry.name, new File([blob], entry.name.split("/").pop()));
          }),
      );
      return this.load(project, packageFiles);
    }
    return this.load(JSON.parse(await file.text()));
  }

  addBookmark(bookmark) {
    this.current.bookmarks ??= [];
    this.current.bookmarks.push({ id: makeId(), ...bookmark });
    this.events.publish("bookmarks:changed", { bookmarks: this.current.bookmarks });
  }

  removeBookmark(id) {
    this.current.bookmarks = (this.current.bookmarks ?? []).filter((item) => item.id !== id);
    this.events.publish("bookmarks:changed", { bookmarks: this.current.bookmarks });
  }

  #readStore() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {};
    }
  }

  #safeName(value) {
    return (value || "Project").replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "");
  }

  #exportName(project) {
    const date = new Date(project.updatedAt || Date.now());
    const pad = (value) => String(value).padStart(2, "0");
    const timestamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}`;
    return `${timestamp}-${this.#safeName(project.name)}`;
  }
}
