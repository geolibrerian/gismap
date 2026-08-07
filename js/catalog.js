/**
 * Starter catalog. Add or remove entries without changing the UI module.
 * Public providers can change URLs or usage terms; review an entry before production use.
 */
export const POPULAR_SERVICES = [
  {
    id: "usgs-earthquakes-month",
    provider: "USGS",
    title: "Earthquakes — past 30 days",
    description: "Continuously updated GeoJSON feed of global earthquake activity.",
    serviceType: "geojson",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson",
    refreshInterval: 5,
  },
  {
    id: "esri-world-countries",
    provider: "Esri",
    title: "World countries — generalized",
    description: "Generalized country boundaries from an ArcGIS feature service.",
    serviceType: "feature",
    url: "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/World_Countries_(Generalized)/FeatureServer/0",
  },
];
