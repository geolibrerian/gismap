const ARCGIS_WORLD_GEOCODER =
  "https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer";

export function parseArcGISFeatureQueryUrl(value) {
  try {
    const parsed = new URL(value);
    const match = parsed.pathname.match(/^(.*\/FeatureServer\/\d+)\/query\/?$/i);
    if (!match) return null;

    const parameter = (name) => {
      const entry = [...parsed.searchParams].find(([key]) => key.toLowerCase() === name.toLowerCase());
      return entry?.[1]?.trim() || null;
    };
    const layerUrl = new URL(parsed.href);
    layerUrl.pathname = match[1];
    layerUrl.search = "";
    layerUrl.hash = "";

    const where = parameter("where");
    const outFields = parameter("outFields");
    return {
      layerUrl: layerUrl.href.replace(/\/$/, ""),
      definitionExpression: where && where !== "1=1" ? where : undefined,
      outFields: outFields ? outFields.split(",").map((field) => field.trim()).filter(Boolean) : undefined,
      requestedOutSpatialReference: parameter("outSR"),
    };
  } catch {
    return null;
  }
}

export class MapController {
  constructor(events) {
    this.events = events;
    this.map = null;
    this.view = null;
    this.drawLayer = null;
    this.modules = {};
    this.layerConfigs = new Map();
    this.localAssets = new Map();
    this.widgets = new Map();
    this.sketch = null;
    this.defaultViewpoint = { center: [-98.5, 39.5], zoom: 4, tilt: 35, heading: 0 };
    this.basemapId = "topo-3d";
    this.groundId = "world-elevation";
  }

  async initialize(container = "viewDiv") {
    if (!globalThis.$arcgis?.import) {
      throw new Error("ArcGIS Maps SDK did not load. Check the network connection and CDN URL.");
    }

    const moduleIds = [
      "@arcgis/core/Map.js",
      "@arcgis/core/views/SceneView.js",
      "@arcgis/core/Ground.js",
      "@arcgis/core/layers/Layer.js",
      "@arcgis/core/layers/FeatureLayer.js",
      "@arcgis/core/layers/MapImageLayer.js",
      "@arcgis/core/layers/ImageryLayer.js",
      "@arcgis/core/layers/WMSLayer.js",
      "@arcgis/core/layers/KMLLayer.js",
      "@arcgis/core/layers/GeoJSONLayer.js",
      "@arcgis/core/layers/GraphicsLayer.js",
      "@arcgis/core/Graphic.js",
      "@arcgis/core/renderers/support/jsonUtils.js",
      "@arcgis/core/rest/locator.js",
      "@arcgis/core/widgets/Sketch/SketchViewModel.js",
    ];
    const [
      ArcGISMap,
      SceneView,
      Ground,
      Layer,
      FeatureLayer,
      MapImageLayer,
      ImageryLayer,
      WMSLayer,
      KMLLayer,
      GeoJSONLayer,
      GraphicsLayer,
      Graphic,
      rendererJsonUtils,
      locator,
      SketchViewModel,
    ] = await $arcgis.import(moduleIds);

    Object.assign(this.modules, {
      ArcGISMap,
      SceneView,
      Ground,
      Layer,
      FeatureLayer,
      MapImageLayer,
      ImageryLayer,
      WMSLayer,
      KMLLayer,
      GeoJSONLayer,
      GraphicsLayer,
      Graphic,
      rendererJsonUtils,
      locator,
      SketchViewModel,
    });

    this.drawLayer = new GraphicsLayer({ title: "Drawings", listMode: "hide" });
    this.map = new ArcGISMap({
      basemap: this.basemapId,
      ground: this.groundId,
      layers: [this.drawLayer],
    });
    this.view = new SceneView({
      container,
      map: this.map,
      ...this.defaultViewpoint,
      viewingMode: "global",
      qualityProfile: "high",
      popupEnabled: false,
      ui: { components: [] },
      highlightOptions: { color: "#d9951e", haloOpacity: 0.9, fillOpacity: 0.15 },
      environment: {
        atmosphereEnabled: true,
        starsEnabled: true,
        lighting: { type: "virtual" },
      },
    });
    await this.view.when();
    this.view.ui.empty("top-left");
    this.view.on("click", (event) => this.events.publish("map:click", event));
    this.view.on("layerview-create-error", ({ layer, error }) => {
      this.events.publish("app:error", {
        message: `Could not draw ${layer?.title ?? "a layer"}: ${error?.message ?? "unknown error"}`,
      });
    });
    this.#initializeSketch();
    this.events.publish("map:ready", { view: this.view });
    return this.view;
  }

  #initializeSketch() {
    this.sketch = new this.modules.SketchViewModel({
      view: this.view,
      layer: this.drawLayer,
      pointSymbol: {
        type: "simple-marker",
        color: "#d9951e",
        outline: { color: "#ffffff", width: 1.5 },
        size: 9,
      },
      polylineSymbol: { type: "simple-line", color: "#d9951e", width: 3 },
      polygonSymbol: {
        type: "simple-fill",
        color: [217, 149, 30, 0.18],
        outline: { color: "#d9951e", width: 2 },
      },
    });
    this.sketch.on("create", ({ state, graphic }) => {
      if (state === "complete") this.events.publish("draw:complete", { graphic });
    });
  }

  draw(type) {
    if (type === "clear") {
      this.drawLayer.removeAll();
      return;
    }
    this.sketch?.create(type);
  }

  async addService(config) {
    const cleanUrl = config.url?.trim().replace(/\/$/, "");
    if (!cleanUrl) throw new Error("A service URL is required.");
    const featureQuery = parseArcGISFeatureQueryUrl(cleanUrl);
    let serviceType = this.#serviceTypeFromUrl(config.serviceType, cleanUrl);
    if (featureQuery) serviceType = "feature";
    const mapSublayer = this.#parseMapSublayerUrl(cleanUrl);
    let layer;
    const common = {
      url: featureQuery?.layerUrl ?? cleanUrl,
      title: config.title?.trim() || undefined,
      opacity: Number.isFinite(config.opacity) ? config.opacity : 1,
      visible: config.visible !== false,
      popupEnabled: false,
    };

    const buildMapSublayer = () => new this.modules.MapImageLayer({
      ...common,
      url: mapSublayer.rootUrl,
      sublayers: [{ id: mapSublayer.id }],
    });

    try {
      switch (serviceType) {
        case "feature":
          layer = new this.modules.FeatureLayer({
            ...common,
            definitionExpression: featureQuery?.definitionExpression,
            outFields: featureQuery?.outFields,
          });
          break;
        case "map-image":
          layer = mapSublayer ? buildMapSublayer() : new this.modules.MapImageLayer(common);
          break;
        case "imagery":
          if (mapSublayer) {
            serviceType = "map-image";
            layer = buildMapSublayer();
          } else {
            layer = new this.modules.ImageryLayer(common);
          }
          break;
        case "wms":
          layer = new this.modules.WMSLayer(common);
          break;
        case "kml":
          layer = new this.modules.KMLLayer(common);
          break;
        case "geojson":
          layer = new this.modules.GeoJSONLayer(common);
          break;
        default:
          layer = await this.modules.Layer.fromArcGISServerUrl({ url: cleanUrl });
          if (common.title) layer.title = common.title;
          layer.opacity = common.opacity;
          layer.visible = common.visible;
          break;
      }

      return await this.#addLayer(layer, {
        sourceType: serviceType,
        url: cleanUrl,
        title: common.title,
        serviceLayerId: mapSublayer?.id ?? null,
        elevationInfo: config.elevationInfo ?? null,
        refreshInterval: Number(config.refreshInterval) || 0,
      });
    } catch (error) {
      if (!mapSublayer || serviceType !== "arcgis-auto") throw error;
      serviceType = "map-image";
      layer = buildMapSublayer();
      return this.#addLayer(layer, {
        sourceType: serviceType,
        url: cleanUrl,
        title: common.title,
        serviceLayerId: mapSublayer.id,
        refreshInterval: Number(config.refreshInterval) || 0,
      });
    }
  }

  #parseMapSublayerUrl(url) {
    try {
      const parsed = new URL(url, location.href);
      const match = parsed.pathname.match(/^(.*\/MapServer)\/(\d+)$/i);
      if (!match) return null;
      parsed.pathname = match[1];
      return { rootUrl: parsed.href.replace(/\/$/, ""), id: Number(match[2]) };
    } catch {
      const match = String(url).match(/^(.*\/MapServer)\/(\d+)(?:[?#].*)?$/i);
      return match ? { rootUrl: match[1], id: Number(match[2]) } : null;
    }
  }

  #serviceTypeFromUrl(requestedType, url) {
    if (requestedType && requestedType !== "arcgis-auto") return requestedType;
    try {
      const parsed = new URL(url, location.href);
      if (/\.geojson$/i.test(parsed.pathname) || /^(geojson)$/i.test(parsed.searchParams.get("f") || "")) {
        return "geojson";
      }
    } catch {
      if (/\.geojson(?:$|[?#])/i.test(url)) return "geojson";
    }
    return "arcgis-auto";
  }

  async addLocalFile(file, projectPath = null) {
    const extension = file.name.split(".").pop()?.toLowerCase();
    let layer;
    let storedFile = file;

    if (extension === "json" || extension === "geojson") {
      const text = await file.text();
      JSON.parse(text);
      const url = URL.createObjectURL(new Blob([text], { type: "application/geo+json" }));
      layer = new this.modules.GeoJSONLayer({ url, title: file.name, popupEnabled: false });
    } else if (extension === "kml" || extension === "kmz") {
      const toGeoJSON = await import("https://cdn.jsdelivr.net/npm/@tmcw/togeojson@7.1.2/+esm");
      let kmlText;
      if (extension === "kmz") {
        if (!globalThis.JSZip) throw new Error("The ZIP library did not load.");
        const zip = await JSZip.loadAsync(file);
        const entry = Object.values(zip.files).find((item) => !item.dir && /\.kml$/i.test(item.name));
        if (!entry) throw new Error("The KMZ archive does not contain a KML document.");
        kmlText = await entry.async("text");
      } else {
        kmlText = await file.text();
      }
      const documentNode = new DOMParser().parseFromString(kmlText, "application/xml");
      if (documentNode.querySelector("parsererror")) throw new Error("The KML document is not valid XML.");
      const collection = toGeoJSON.kml(documentNode);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(collection)], { type: "application/geo+json" }),
      );
      layer = new this.modules.GeoJSONLayer({ url, title: file.name, popupEnabled: false });
    } else if (extension === "zip") {
      const shp = await import("https://cdn.jsdelivr.net/npm/shpjs@6.2.0/+esm");
      const parsed = await shp.default(await file.arrayBuffer());
      const collection = Array.isArray(parsed)
        ? { type: "FeatureCollection", features: parsed.flatMap((part) => part.features ?? []) }
        : parsed;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(collection)], { type: "application/geo+json" }),
      );
      layer = new this.modules.GeoJSONLayer({ url, title: file.name, popupEnabled: false });
    } else {
      throw new Error("Unsupported file. Use GeoJSON, JSON, KML, KMZ, or a zipped shapefile.");
    }

    const added = await this.#addLayer(layer, {
      sourceType: extension === "zip" ? "shapefile" : extension,
      fileName: file.name,
      projectPath: projectPath || `data/${file.name}`,
      local: true,
    });
    this.localAssets.set(added.uid, storedFile);
    return added;
  }

  async #addLayer(layer, config = {}) {
    layer.popupEnabled = false;
    if (config.refreshInterval > 0 && "refreshInterval" in layer) {
      layer.refreshInterval = config.refreshInterval;
    }
    await layer.load();
    if ("elevationInfo" in layer) {
      layer.elevationInfo = config.elevationInfo || { mode: "on-the-ground" };
    }
    if (config.serviceLayerId != null && !config.title) {
      const sublayer = layer.findSublayerById?.(config.serviceLayerId);
      const serviceTitle = this.#titleFromUrl(config.url || layer.url);
      layer.title = sublayer?.title ? `${serviceTitle} — ${sublayer.title}` : serviceTitle;
    } else if (!layer.title?.trim()) {
      layer.title = this.#titleFromUrl(config.url || layer.url);
    }
    this.map.add(layer, Math.max(0, this.map.layers.length - 1));
    this.layerConfigs.set(layer.uid, { ...config });
    this.events.publish("layer:added", { layer, config: this.getLayerConfig(layer) });
    return layer;
  }

  #titleFromUrl(url = "") {
    const parts = String(url).replace(/\/$/, "").split("/");
    const serviceIndex = parts.findIndex((part) => /^(MapServer|FeatureServer|ImageServer)$/i.test(part));
    const name = serviceIndex > 0 ? parts[serviceIndex - 1] : parts.at(-1);
    try {
      return decodeURIComponent(name || "Untitled layer").replaceAll("_", " ");
    } catch {
      return name || "Untitled layer";
    }
  }

  removeLayer(uid) {
    const layer = this.findLayer(uid);
    if (!layer || layer === this.drawLayer) return;
    this.map.remove(layer);
    this.layerConfigs.delete(uid);
    this.localAssets.delete(uid);
    this.events.publish("layer:removed", { uid });
  }

  findLayer(uid) {
    return this.map?.allLayers?.find((layer) => layer.uid === uid) ?? null;
  }

  getOperationalLayers() {
    return this.map?.layers?.toArray().filter((layer) => layer !== this.drawLayer) ?? [];
  }

  getLayerConfig(layer) {
    const source = this.layerConfigs.get(layer.uid) ?? {};
    return {
      uid: layer.uid,
      id: layer.id,
      title: layer.title,
      type: layer.type,
      url: source.url ?? layer.url ?? null,
      sourceType: source.sourceType ?? layer.type,
      fileName: source.fileName ?? null,
      projectPath: source.projectPath ?? null,
      local: Boolean(source.local),
      visible: layer.visible,
      opacity: layer.opacity,
      refreshInterval: "refreshInterval" in layer ? layer.refreshInterval ?? 0 : 0,
      elevationInfo: layer.elevationInfo?.toJSON?.() ?? source.elevationInfo ?? null,
      renderer: layer.renderer?.toJSON?.() ?? null,
    };
  }

  getAllLayerConfigs() {
    return this.getOperationalLayers().map((layer) => this.getLayerConfig(layer));
  }

  setVisibility(uid, visible) {
    const layer = this.findLayer(uid);
    if (layer) layer.visible = visible;
    this.events.publish("layer:changed", { uid });
  }

  setOpacity(uid, opacity) {
    const layer = this.findLayer(uid);
    if (layer) layer.opacity = Math.max(0, Math.min(1, Number(opacity)));
    this.events.publish("layer:changed", { uid });
  }

  setRefreshInterval(uid, minutes) {
    const layer = this.findLayer(uid);
    if (!layer || !("refreshInterval" in layer)) {
      throw new Error("This layer type does not expose an automatic refresh interval.");
    }
    layer.refreshInterval = Math.max(0, Number(minutes) || 0);
    const config = this.layerConfigs.get(uid) ?? {};
    config.refreshInterval = layer.refreshInterval;
    this.layerConfigs.set(uid, config);
    this.events.publish("layer:changed", { uid });
  }

  restoreRenderer(layer, rendererJson) {
    if (!layer || !("renderer" in layer) || !rendererJson) return;
    const renderer = this.modules.rendererJsonUtils.fromJSON(rendererJson);
    if (renderer) layer.renderer = renderer;
  }

  async setSimpleSymbology(uid, options) {
    const layer = this.findLayer(uid);
    if (!layer || !("renderer" in layer)) throw new Error("This layer does not support client-side renderers.");
    await layer.load();
    const color = options.color || "#1b7f6a";
    const outline = options.outline || "#ffffff";
    const geometryType = layer.geometryType;
    let symbol;
    if (geometryType === "point" || geometryType === "multipoint") {
      symbol = {
        type: "simple-marker",
        color,
        size: Number(options.size) || 9,
        outline: { color: outline, width: 1 },
      };
    } else if (geometryType === "polyline") {
      symbol = { type: "simple-line", color, width: Number(options.size) || 2.5 };
    } else {
      symbol = {
        type: "simple-fill",
        color: this.#hexToRgba(color, 0.35),
        outline: { color: outline, width: Number(options.size) || 1.5 },
      };
    }
    layer.renderer = { type: "simple", symbol };
    this.events.publish("layer:changed", { uid });
  }

  #hexToRgba(hex, alpha) {
    const value = hex.replace("#", "");
    return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16)).concat(alpha);
  }

  async clearOperationalLayers() {
    this.getOperationalLayers().forEach((layer) => this.map.remove(layer));
    this.layerConfigs.clear();
    this.localAssets.clear();
    this.events.publish("layers:reset");
  }

  setBasemap(id) {
    this.basemapId = id || "topo-3d";
    this.map.basemap = this.basemapId;
    this.events.publish("map:basemap-changed", { id: this.basemapId });
  }

  getBasemapId() {
    return this.basemapId;
  }

  setGround(id) {
    this.groundId = id || "world-elevation";
    this.map.ground = this.groundId === "flat" ? new this.modules.Ground() : this.groundId;
    this.events.publish("map:ground-changed", { id: this.groundId });
  }

  getGroundId() {
    return this.groundId;
  }

  getViewState() {
    return {
      type: "scene",
      camera: this.view?.camera?.toJSON?.() ?? null,
      center: this.view?.center ? [this.view.center.longitude, this.view.center.latitude] : null,
      zoom: this.view?.zoom,
      heading: this.view?.camera?.heading ?? 0,
      tilt: this.view?.camera?.tilt ?? 0,
    };
  }

  async restoreView(state) {
    if (state?.camera) {
      await this.view.goTo(state.camera, { animate: false });
      return;
    }
    if (!state?.center) return;
    await this.view.goTo({
      center: state.center,
      zoom: state.zoom ?? 4,
      heading: state.heading ?? state.rotation ?? 0,
      tilt: state.tilt ?? 35,
    });
  }

  async navigate(action) {
    if (action === "home") return this.view.goTo(this.defaultViewpoint);
    if (action === "in") return this.view.zoomIn();
    if (action === "out") return this.view.zoomOut();
    if (["rotate-left", "rotate-right", "tilt-up", "tilt-down"].includes(action)) {
      const camera = this.view.camera.clone();
      if (action === "rotate-left") camera.heading -= 20;
      if (action === "rotate-right") camera.heading += 20;
      if (action === "tilt-up") camera.tilt = Math.min(88, camera.tilt + 10);
      if (action === "tilt-down") camera.tilt = Math.max(0, camera.tilt - 10);
      return this.view.goTo(camera, { duration: 350 });
    }
    if (action === "locate") {
      if (!navigator.geolocation) throw new Error("Geolocation is not supported by this browser.");
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true }),
      );
      return this.view.goTo({
        center: [position.coords.longitude, position.coords.latitude],
        zoom: 15,
        tilt: 55,
      });
    }
  }

  async searchPlaces(query) {
    const text = query.trim();
    const coordinates = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (coordinates) {
      const center = [Number(coordinates[1]), Number(coordinates[2])];
      await this.view.goTo({ center, zoom: 14, tilt: 55 });
      return [{ label: `${center[0].toFixed(5)}, ${center[1].toFixed(5)}`, location: center }];
    }
    const response = await this.modules.locator.addressToLocations(ARCGIS_WORLD_GEOCODER, {
      address: { SingleLine: text },
      maxLocations: 6,
      outFields: ["PlaceName", "Type", "Addr_type"],
    });
    return response.map((candidate) => ({
      label: candidate.address,
      location: [candidate.location.longitude, candidate.location.latitude],
      extent: candidate.extent,
    }));
  }

  async goToSearchResult(result) {
    return result.extent
      ? this.view.goTo({ target: result.extent, tilt: 55 })
      : this.view.goTo({ center: result.location, zoom: 14, tilt: 55 });
  }

  async goToLayer(layerOrUid) {
    const layer = typeof layerOrUid === "string" ? this.findLayer(layerOrUid) : layerOrUid;
    if (!layer?.fullExtent) return;
    return this.view.goTo({ target: layer.fullExtent, tilt: 55 });
  }

  async reverseGeocode(point) {
    try {
      const result = await this.modules.locator.locationToAddress(ARCGIS_WORLD_GEOCODER, {
        location: point,
      });
      return { address: result.address, attributes: result.attributes ?? {} };
    } catch {
      return null;
    }
  }

  async toggleWidget(name) {
    const existing = this.widgets.get(name);
    if (existing) {
      this.view.ui.remove(existing);
      await existing.destroy?.();
      this.widgets.delete(name);
      return false;
    }
    const componentTags = {
      basemapGallery: "arcgis-basemap-gallery",
      compass: "arcgis-compass",
    };
    if (componentTags[name]) {
      const tagName = componentTags[name];
      await customElements.whenDefined(tagName);
      const component = document.createElement(tagName);
      component.view = this.view;
      if (name === "basemapGallery") {
        component.addEventListener("arcgisPropertyChange", (event) => {
          if (event.detail?.name === "activeBasemap") {
            this.basemapId = this.map.basemap?.id || component.activeBasemap?.id || this.basemapId;
            this.events.publish("map:basemap-changed", { id: this.basemapId });
          }
        });
      }
      this.view.ui.add(component, "top-right");
      this.widgets.set(name, component);
      return true;
    }
    const definitions = {
      measurement: ["@arcgis/core/widgets/Measurement.js", {}, "top-right"],
      elevationProfile: ["@arcgis/core/widgets/ElevationProfile.js", {}, "top-right"],
    };
    const definition = definitions[name];
    if (!definition) return false;
    const Widget = await $arcgis.import(definition[0]);
    const widget = new Widget({ view: this.view, ...definition[1] });
    this.view.ui.add(widget, definition[2]);
    this.widgets.set(name, widget);
    return true;
  }
}
