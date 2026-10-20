// Exact planar geometry/rectangle tests in WGS84 longitude/latitude. Not a
// geodesic intersection engine: reject projected and antimeridian data.
export function atlasGeometry(g) {
  const wkid = g?.spatialReference?.latestWkid ?? g?.spatialReference?.wkid;
  if (!g || (wkid && wkid !== 4326)) throw new Error('Grid Atlas requires WGS84 geometries; projected geometries are not yet supported.');
  let type=g.type, coordinates=g.coordinates;
  if (Number.isFinite(g.x) && Number.isFinite(g.y)) { type='Point'; coordinates=[g.x,g.y]; }
  else if (g.paths) { type='MultiLineString'; coordinates=g.paths; }
  else if (g.rings) { type='Polygon'; coordinates=g.rings; }
  else if (g.points) { type='MultiPoint'; coordinates=g.points; }
  if (!['Point','MultiPoint','LineString','MultiLineString','Polygon','MultiPolygon'].includes(type) || !Array.isArray(coordinates)) throw new Error('Grid Atlas supports WGS84 points, lines, and polygons with geometry.');
  const points=[];
  function walk(value) {
    if (!Array.isArray(value) || !value.length) throw new Error('Grid Atlas cannot use empty or malformed geometry.');
    if (typeof value[0] === 'number') {
      const [x,y]=value;
      if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x)>180 || Math.abs(y)>90) throw new Error('Grid Atlas requires valid WGS84 coordinates.');
      points.push([x,y]); return;
    }
    value.forEach(walk);
  }
  const depth={Point:0,MultiPoint:1,LineString:1,MultiLineString:2,Polygon:2,MultiPolygon:3}[type];
  function validShape(value, level) {
    if (!Array.isArray(value)) return false;
    if (level===0) return value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number';
    const min = type.includes('Polygon') && level===1 ? 4 : type.includes('LineString') && level===1 ? 2 : 1;
    return value.length >= min && value.every(item=>validShape(item,level-1));
  }
  if (!validShape(coordinates,depth)) throw new Error('Grid Atlas cannot use empty or malformed geometry.');
  walk(coordinates);
  if (points.length < (type.includes('LineString') ? 2 : type.includes('Polygon') ? 4 : 1)) throw new Error('Grid Atlas cannot use incomplete geometry.');
  const bounds=points.reduce(([w,s,e,n],[x,y])=>[Math.min(w,x),Math.min(s,y),Math.max(e,x),Math.max(n,y)],[180,90,-180,-90]);
  if (bounds[2]-bounds[0]>180) throw new Error('Antimeridian-spanning data is not yet supported.');
  return {type,coordinates,bounds};
}
const inside=([x,y],[w,s,e,n])=>x>=w && x<=e && y>=s && y<=n;
function segmentHits(a,b,[w,s,e,n]) {
  let low=0, high=1;
  const dx=b[0]-a[0], dy=b[1]-a[1];
  for (const [p,q] of [[-dx,a[0]-w],[dx,e-a[0]],[-dy,a[1]-s],[dy,n-a[1]]]) {
    if (p===0) { if (q<0) return false; continue; }
    const t=q/p;
    if (p<0) low=Math.max(low,t); else high=Math.min(high,t);
    if (low>high) return false;
  }
  return true;
}
function lineHits(line,box,closed=false) {
  if (line.some(p=>inside(p,box))) return true;
  for (let i=1;i<line.length;i++) if (segmentHits(line[i-1],line[i],box)) return true;
  return closed && line.length>2 && segmentHits(line.at(-1),line[0],box);
}
function inRings([x,y],rings) {
  let result=false;
  for (const ring of rings) for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const [xi,yi]=ring[i], [xj,yj]=ring[j];
    if ((yi>y)!==(yj>y) && x < (xj-xi)*(y-yi)/(yj-yi)+xi) result=!result;
  }
  return result;
}
function polygonHits(rings,box) {
  if (rings.some(ring=>lineHits(ring,box,true))) return true;
  const [w,s,e,n]=box;
  return [[w,s],[w,n],[e,s],[e,n]].some(p=>inRings(p,rings));
}
export function atlasIntersects(geometry,box) {
  const [w,s,e,n]=box, [gw,gs,ge,gn]=geometry.bounds;
  if (ge<w || gw>e || gn<s || gs>n) return false;
  const c=geometry.coordinates;
  switch(geometry.type) {
    case 'Point': return inside(c,box);
    case 'MultiPoint': return c.some(p=>inside(p,box));
    case 'LineString': return lineHits(c,box);
    case 'MultiLineString': return c.some(line=>lineHits(line,box));
    case 'Polygon': return polygonHits(c,box);
    case 'MultiPolygon': return c.some(poly=>polygonHits(poly,box));
    default: return false;
  }
}
