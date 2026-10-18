import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLocalVectorFile } from '../js/local-vector-import.js';
const entry = (name, size = 10) => ({ name, dir: false, _data: { uncompressedSize: size } });
const zip = (entries) => ({ loadAsync: async () => ({ files: Object.fromEntries(entries.map((e) => [e.name, e])) }) });
const file = { name:'roads.zip', size: 10, arrayBuffer: async () => new ArrayBuffer(0) };
test('multiple shapefiles are kept separate and use their own keys', async () => {
  const entries = ['a.shp','a.prj','a.dbf','b.shp','b.prj','b.dbf'].map((e) => entry(e));
  const parts = [{ type:'FeatureCollection', features:[], fileName:'a' }, { type:'FeatureCollection', features:[], fileName:'b' }];
  const result = await parseLocalVectorFile(file, { zipLibrary:zip(entries), loadShp:async () => ({ default:async () => parts }) });
  assert.deepEqual(result.collections.map((p) => p.key), ['a', 'b']);
});
test('unknown projection and unsafe archives are rejected before parsing', async () => {
  await assert.rejects(parseLocalVectorFile(file, { zipLibrary:zip([entry('a.shp')]) }), /Projection/);
  await assert.rejects(parseLocalVectorFile(file, { zipLibrary:zip([entry('a.shp', 251*1024*1024)]) }), /too large/);
});
test('KML is converted locally with unsupported features reported', async () => {
  const old = globalThis.DOMParser;
  globalThis.DOMParser = class { parseFromString() { return { querySelector: (selector) => selector === 'parsererror' ? null : {} }; } };
  try {
    const result = await parseLocalVectorFile({name:'x.kml',size:1,text:async () => '<kml />'}, { loadKml:async () => ({kml:() => ({type:'FeatureCollection',features:[]})}) });
    assert.equal(result.collections[0].data.type, 'FeatureCollection'); assert.match(result.warnings.join(' '), /network links/i);
  } finally { globalThis.DOMParser = old; }
});
