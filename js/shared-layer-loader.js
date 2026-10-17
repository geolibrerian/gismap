// Restores a shared layer only after its data and configuration are ready.
export async function loadSharedLayer(mapController, config) {
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
    await Promise.all(added.map((layer) => mapController.loadLayer(layer)));
    if (config.renderer && added.length !== 1) throw new Error("A shared renderer cannot be applied to multiple service layers.");
    if (config.renderer) mapController.restoreRenderer(added[0], config.renderer);
    return added;
  }
  const added = await mapController.addService(config);
  await mapController.loadLayer(added);
  if (config.renderer) {
    mapController.restoreRenderer(added, config.renderer);
    if (!mapController.getLayerConfig(added)?.renderer) throw new Error("The requested layer style could not be restored.");
  }
  if (config.definitionExpression && mapController.getLayerConfig(added)?.definitionExpression !== config.definitionExpression) throw new Error("The requested layer filter could not be restored.");
  return [added];
}

