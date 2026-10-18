// Shared local vector conversion. Parsers are loaded only when needed; files
// and archive contents stay in the browser and are never fetched as URLs.
const MAX_FILE = 100 * 1024 * 1024;
const MAX_EXPANDED = 250 * 1024 * 1024;
function archiveEntries(zip) {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  let total = 0;
  for (const entry of entries) {
    const size = entry._data?.uncompressedSize;
    if (!Number.isFinite(size) || size < 0) throw new Error('The archive does not report a safe uncompressed size.');
    total += size;
    if (total > MAX_EXPANDED || entries.length > 2000) throw new Error('The archive is too large to unpack safely in the browser.');
  }
  return entries;
}
export async function parseLocalVectorFile(file, { zipLibrary = globalThis.JSZip, loadKml = () => import('https://cdn.jsdelivr.net/npm/@tmcw/togeojson@7.1.2/+esm'), loadShp = () => import('https://cdn.jsdelivr.net/npm/shpjs@6.2.0/+esm') } = {}) {
  const extension = String(file?.name || '').split('.').pop().toLowerCase();
  if (file.size > MAX_FILE) throw new Error('File exceeds the 100 MB browser import limit. Use a smaller dataset.');
  if (extension === 'json' || extension === 'geojson') return { extension, collections: [{ key: null, data: JSON.parse(await file.text()) }], warnings: [] };
  if (!['kml', 'kmz', 'zip'].includes(extension)) throw new Error('Unsupported file. Use GeoJSON, JSON, KML, KMZ, or a zipped shapefile.');
  let entries = []; let zip;
  if (extension === 'zip' || extension === 'kmz') {
    if (!zipLibrary) throw new Error('The ZIP library did not load.');
    try { zip = await zipLibrary.loadAsync(file); entries = archiveEntries(zip); } catch (error) { throw new Error(`Cannot open archive: ${error.message}`, { cause: error }); }
  }
  if (extension === 'zip') {
    const names = new Set(entries.map((entry) => entry.name.toLowerCase()));
    const shapes = entries.filter((entry) => /\.shp$/i.test(entry.name));
    if (!shapes.length) throw new Error('The ZIP archive does not contain a shapefile (.shp).');
    const missing = shapes.filter((entry) => !names.has(entry.name.replace(/\.shp$/i, '.prj').toLowerCase()));
    if (missing.length) throw new Error(`Projection (.prj) missing for ${missing.map((entry) => entry.name).join(', ')}. Add a .prj file so coordinates are not misplaced.`);
    const incomplete = shapes.filter((entry) => !names.has(entry.name.replace(/\.shp$/i, '.dbf').toLowerCase()));
    const shp = await loadShp(); const parsed = await shp.default(await file.arrayBuffer());
    const parts = Array.isArray(parsed) ? parsed : [parsed];
    return { extension, collections: parts.map((data, index) => ({ key: String(data.fileName || shapes[index]?.name.replace(/\.shp$/i, '') || index), data })), warnings: incomplete.length ? ['Some shapefiles have no .dbf attributes.'] : [] };
  }
  let text;
  if (extension === 'kmz') {
    const documents = entries.filter((entry) => /\.kml$/i.test(entry.name));
    if (!documents.length) throw new Error('The KMZ archive does not contain a KML document.');
    const entry = documents.find((item) => item.name.toLowerCase() === 'doc.kml') || documents[0];
    text = await entry.async('text');
  } else text = await file.text();
  const documentNode = new DOMParser().parseFromString(text, 'application/xml');
  if (documentNode.querySelector('parsererror')) throw new Error('The KML document is not valid XML.');
  const toGeoJSON = await loadKml();
  const warnings = ['KML styles may not be preserved.'];
  if (documentNode.querySelector('NetworkLink, GroundOverlay, ScreenOverlay, PhotoOverlay, Model')) warnings.push('KML network links, overlays and 3D models are not imported.');
  if (extension === 'kmz') warnings.push('Embedded KMZ images and custom styles may not be preserved.');
  return { extension, collections: [{ key: null, data: toGeoJSON.kml(documentNode) }], warnings };
}
