export const ENTERPRISE_CATALOGS = [
  {
    id: "santa-clara",
    title: "City of Santa Clara GIS",
    rootUrl: "https://map.santaclaraca.gov/maps/rest/services",
    version: "ArcGIS Enterprise 10.91",
  },
];

export class EnterpriseCatalog {
  constructor(definition) {
    this.definition = definition;
  }

  async browse(folder = "") {
    const folderPath = folder.replace(/^\/+|\/+$/g, "");
    const url = `${this.definition.rootUrl}${folderPath ? `/${folderPath}` : ""}`;
    const response = await fetch(`${url}?f=json`);
    if (!response.ok) throw new Error(`Service directory returned ${response.status}.`);
    const payload = await response.json();
    if (payload.error) throw new Error(payload.error.message || "Could not read the service directory.");
    return {
      folder: folderPath,
      folders: payload.folders ?? [],
      services: (payload.services ?? []).map((service) => ({
        ...service,
        url: `${this.definition.rootUrl}/${service.name}/${service.type}`,
        serviceType: this.#serviceType(service.type),
      })),
    };
  }

  #serviceType(type) {
    if (type === "MapServer") return "map-image";
    if (type === "FeatureServer") return "feature";
    if (type === "ImageServer") return "imagery";
    return "arcgis-auto";
  }
}
