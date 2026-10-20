// Public fire-map refinement example. A generated URL is not evidence of rendering.
export const FIRE_SOURCE = 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/ArcGIS/rest/services/California_Historic_Fire_Perimeters/FeatureServer/0';
export const FIRE_WHERE = 'YEAR_ >= 2000 AND YEAR_ <= 2010';
export const FIRE_BASE = { version: 1, title: 'Historical fires 2000–2010', basemap: 'gray-vector', camera: { center: [-120, 37.5], zoom: 5 }, legend: true, layers: [{ url: FIRE_SOURCE, type: 'feature', title: 'California historical fire perimeters', where: FIRE_WHERE, opacity: 0.8 }] };
const colors = ['#8e0152','#d73027','#f46d43','#fdae61','#fee08b','#66a61e','#1b9e77','#1f78b4','#6a3d9a','#a6761d','#4d4d4d'];
export const FIRE_YEAR = { ...FIRE_BASE, title: 'Fires by year 2000–2010', layers: FIRE_BASE.layers.map(layer => ({ ...layer, renderer: { type: 'categories', field: 'YEAR_', maxCategories: 11, colors: Object.fromEntries(colors.map((color, i) => [String(2000 + i), color])) } })) };
export const FIRE_ACRES = { ...FIRE_BASE, title: 'Fire acreage 2000–2010', layers: FIRE_BASE.layers.map(layer => ({ ...layer, renderer: { type: 'choropleth', field: 'GIS_ACRES', classes: 5, method: 'quantile', classColors: ['#ffffb2','#fecc5c','#fd8d3c','#f03b20','#bd0026'] } })) };
export const fireLink = spec => `https://gismap.online/#map=json:${encodeURIComponent(JSON.stringify(spec))}`;
export const FIRE_START_LINK = `https://gismap.online/?${new URLSearchParams({layer: FIRE_SOURCE, layerType: 'feature', where: FIRE_WHERE, basemap: 'gray-vector', center: '-120,37.5', level: '5'})}`;
