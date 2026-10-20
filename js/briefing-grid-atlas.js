// Grid Atlas first supports point records in geographic coordinates. Counts are
// based on the supplied loaded selection, not a claim about the entire source.
import { MAX_SLIDES, addSlide, createSlide, normalizeBriefing } from './briefing-document.js?v=0.35.0';

function point(record) {
  const g = record?.geometry;
  if (!g) return null;
  const coords = g.type === 'Point' ? g.coordinates : Number.isFinite(g.x) && Number.isFinite(g.y) ? [g.x,g.y] : null;
  if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1]) || Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) return null;
  const wkid = g.spatialReference?.latestWkid ?? g.spatialReference?.wkid;
  if (wkid && wkid !== 4326) return null;
  return coords;
}

export function previewGridAtlas({ records, rows = 3, columns = 3, order = 'row-major', skipEmpty = false, availableSlides = MAX_SLIDES } = {}) {
  rows = Number(rows); columns = Number(columns);
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 20 || columns > 20) throw new Error('Choose between 1 and 20 rows and columns.');
  if (!['row-major','column-major','snake'].includes(order)) throw new Error('Choose a supported traversal order.');
  if (!Array.isArray(records) || !records.length) throw new Error('Include at least one loaded point feature with geometry.');
  const points = records.map(point);
  if (points.some(value => !value)) throw new Error('Grid Atlas currently requires loaded point geometries in WGS84. Other geometries and projected points are not yet supported.');
  let west = 180, south = 90, east = -180, north = -90;
  for (const [x,y] of points) { west=Math.min(west,x); east=Math.max(east,x); south=Math.min(south,y); north=Math.max(north,y); }
  if (east-west > 180) throw new Error('Antimeridian-spanning data is not yet supported.');
  if (east === west) { west=Math.max(-180,west-0.005); east=Math.min(180,east+0.005); }
  if (north === south) { south=Math.max(-90,south-0.005); north=Math.min(90,north+0.005); }
  const width=(east-west)/columns, height=(north-south)/rows;
  const grid=Array.from({length:rows},(_,row)=>Array.from({length:columns},(_,col)=>({ id:`r${row+1}-c${col+1}`, row, col, bounds:[west+col*width,north-(row+1)*height,west+(col+1)*width,north-row*height], count:0 })));
  // Each point is assigned once; the outer east/south edges belong to the last cell.
  for (const [x,y] of points) { const col=Math.min(columns-1,Math.max(0,Math.floor((x-west)/width))); const row=Math.min(rows-1,Math.max(0,Math.floor((north-y)/height))); grid[row][col].count++; }
  let cells;
  if (order === 'column-major') cells=Array.from({length:columns},(_,col)=>grid.map(row=>row[col])).flat();
  else cells=grid.flatMap((row,index)=>order === 'snake' && index%2 ? [...row].reverse() : row);
  if (skipEmpty) cells=cells.filter(cell=>cell.count > 0);
  if (cells.length > Math.max(0, availableSlides)) throw new Error(`${cells.length} cells exceed the ${Math.max(0, availableSlides)} available slide slots; no slides were added.`);
  return { cells, bounds:[west,south,east,north], rows, columns, recordCount:points.length };
}

export function generateGridAtlas({briefing, layerRef, camera, ...options} = {}) {
  const original=normalizeBriefing(briefing);
  if (!layerRef || !camera) throw new Error('A source layer and a current map view are required.');
  const preview=previewGridAtlas({...options,availableSlides:MAX_SLIDES-original.slides.length});
  let result=original;
  for (const cell of preview.cells) {
    const slide=createSlide('map-narrative',{title:`Grid ${cell.id}`,camera});
    const text=slide.blocks.find(block=>block.type==='text');
    if (text) text.markdown=`${cell.count} loaded, included point${cell.count === 1 ? '' : 's'} assigned to this cell. Other map features remain visible for context; this count is a snapshot, not a complete-source statistic.`;
    slide.generatedBy={template:'grid-atlas',version:1,cellId:cell.id,bounds:cell.bounds,gridBounds:preview.bounds,row:cell.row,column:cell.col,rows:preview.rows,columns:preview.columns,layer:layerRef};
    result=addSlide(result,slide);
  }
  return {briefing:result,preview};
}
