/**
 * Starter catalog. Add or remove entries without changing the UI module.
 * Public providers can change URLs or usage terms; review an entry before production use.
 */
export const POPULAR_SERVICES = [
  {
    id: "usgs-naip-plus",
    provider: "USGS",
    title: "USGS NAIP Plus",
    description: "National Agriculture Imagery Program imagery served by The National Map.",
    serviceType: "imagery",
    url: "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer",
  },
  {
    id: "esri-modis-hotspots-recent",
    provider: "Esri Disaster Response",
    title: "Recent MODIS Hotspot Data",
    description: "Recent thermal anomalies detected by the MODIS satellite instruments.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/MODIS_Thermal_v1/FeatureServer/0",
  },
  {
    id: "esri-active-hurricanes",
    provider: "Esri Disaster Response",
    title: "Active Hurricanes",
    description: "Current tropical cyclone tracks, forecasts, and related observations.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer",
  },
  {
    id: "esri-air-quality-pm25",
    provider: "Esri Disaster Response",
    title: "PM2.5 Data",
    description: "Latest particulate matter air-quality observations and results.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Air_Quality_PM25_Latest_Results/FeatureServer",
  },
  {
    id: "esri-usgs-seismic-activity",
    provider: "USGS / Esri",
    title: "USGS Seismic Activity",
    description: "Recent earthquake and seismic activity reported by the USGS.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/USGS_Seismic_Data_v1/FeatureServer",
  },
  {
    id: "esri-ndfd-wind-gusts",
    provider: "NWS / Esri",
    title: "NDFD Wind Gusts",
    description: "Forecast wind-gust conditions from the National Digital Forecast Database.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NDFD_WindGust_v1/FeatureServer",
  },
  {
    id: "esri-ndfd-precipitation",
    provider: "NWS / Esri",
    title: "NDFD Precipitation",
    description: "Forecast precipitation from the National Digital Forecast Database.",
    serviceType: "feature",
    url: "https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/NDFD_Precipitation_v1/FeatureServer",
  },
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
