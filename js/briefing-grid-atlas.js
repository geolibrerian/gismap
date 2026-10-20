// Counts are snapshots of the loaded selection, not the entire source.
import { atlasGeometry, atlasIntersects } from "./briefing-grid-geometry.js?v=0.1.0";
import { MAX_SLIDES, addSlide, createSlide, normalizeBriefing } from './briefing-document.js?v=0.35.0';

export function previewGridAtlas({ records, rows = 3, columns = 3, targetCells = null, order = 'row-major', skipEmpty = false, countMode = 'assigned', availableSlides = MAX_SLIDES } = {}) {
  rows = Number(rows); columns = Number(columns);
  if (targetCells != null && (!Number.isInteger(Number(targetCells)) || Number(targetCells) < 1 || Number(targetCells) > MAX_SLIDES)) throw new Error(`Choose a target between 1 and ${MAX_SLIDES} slides.`);
  if (!Number.isInteger(rows) || !Number.isInteger(columns) || rows < 1 || columns < 1 || rows > 20 || columns > 20) throw new Error('Choose between 1 and 20 rows and columns.');
  if (!['row-major','column-major','snake'].includes(order)) throw new Error('Choose a supported traversal order.');
  if (!['assigned','intersecting'].includes(countMode)) throw new Error('Choose assigned or intersecting counts.');
  if (!Array.isArray(records) || !records.length) throw new Error('Include at least one loaded feature with geometry.');
  const geometries = records.map(record => atlasGeometry(record.geometry));
  let west = 180, south = 90, east = -180, north = -90;
  for (const {bounds:[w,s,e,n]} of geometries) { west=Math.min(west,w); east=Math.max(east,e); south=Math.min(south,s); north=Math.max(north,n); }
  if (east-west > 180) throw new Error('Antimeridian-spanning data is not yet supported.');
  if (east === west) { west=Math.max(-180,west-0.005); east=Math.min(180,east+0.005); }
  if (north === south) { south=Math.max(-90,south-0.005); north=Math.min(90,north+0.005); }
  if (targetCells != null) {
    const target=Number(targetCells);
    // Approximate ground aspect only; fixed metric cells need a projection.
    const aspect=Math.max(0.01,(east-west)*Math.cos((south+north)*Math.PI/360)/(north-south));
    let best=Infinity;
    for (let r=1;r<=20;r++) for (let c=1;c<=20;c++) {
      if (r*c>target) continue;
      const score=(target-r*c)/target+0.25*Math.abs(Math.log((c/r)/aspect));
      if (score<best) { best=score; rows=r; columns=c; }
    }
  }
  const width=(east-west)/columns, height=(north-south)/rows;
  const grid=Array.from({length:rows},(_,row)=>Array.from({length:columns},(_,col)=>({ id:`r${row+1}-c${col+1}`, row, col, bounds:[west+col*width,north-(row+1)*height,west+(col+1)*width,north-row*height], count:0, assigned:0, intersecting:0 })));
  // Intersections include touching boundaries. Assign points using half-open
  // cells; for all other geometries assign the first intersecting cell in
  // row-major order, independent of presentation traversal.
  for (const geometry of geometries) {
    let assigned = false;
    const [x,y] = geometry.type === 'Point' ? geometry.coordinates : [null,null];
    const pointCol = x == null ? -1 : Math.min(columns-1,Math.max(0,Math.floor((x-west)/width)));
    const pointRow = y == null ? -1 : Math.min(rows-1,Math.max(0,Math.floor((north-y)/height)));
    for (const row of grid) for (const cell of row) {
      if (!atlasIntersects(geometry,cell.bounds)) continue;
      cell.intersecting++;
      if (!assigned && (geometry.type !== 'Point' || (cell.col === pointCol && cell.row === pointRow))) { cell.assigned++; assigned=true; }
    }
    if (!assigned) throw new Error('A geometry could not be assigned to a grid cell.');
  }
  for (const cell of grid.flat()) cell.count = cell[countMode];
  let cells;
  if (order === 'column-major') cells=Array.from({length:columns},(_,col)=>grid.map(row=>row[col])).flat();
  else cells=grid.flatMap((row,index)=>order === 'snake' && index%2 ? [...row].reverse() : row);
  if (skipEmpty) cells=cells.filter(cell=>cell.count > 0);
  if (cells.length > Math.max(0, availableSlides)) throw new Error(`${cells.length} cells exceed the ${Math.max(0, availableSlides)} available slide slots; no slides were added.`);
  return { cells, bounds:[west,south,east,north], rows, columns, recordCount:geometries.length, countMode };
}

export function generateGridAtlas({briefing, layerRef, camera, ...options} = {}) {
  const original=normalizeBriefing(briefing);
  if (!layerRef || !camera) throw new Error('A source layer and a current map view are required.');
  const preview=previewGridAtlas({...options,availableSlides:MAX_SLIDES-original.slides.length});
  let result=original;
  for (const cell of preview.cells) {
    const slide=createSlide('map-narrative',{title:`Grid ${cell.id}`,camera});
    const text=slide.blocks.find(block=>block.type==='text');
    if (text) text.markdown=`${cell.intersecting} loaded features intersect this cell; ${cell.assigned} are assigned to it. Boundary touches count as intersections. Non-point features are assigned to the first intersecting cell in row-major order. Other features remain visible for context. These counts are snapshots, not complete-source statistics.`;
    slide.generatedBy={template:'grid-atlas',version:1,cellId:cell.id,bounds:cell.bounds,gridBounds:preview.bounds,row:cell.row,column:cell.col,rows:preview.rows,columns:preview.columns,layer:layerRef,countMode:preview.countMode,assigned:cell.assigned,intersecting:cell.intersecting};
    result=addSlide(result,slide);
  }
  return {briefing:result,preview};
}
