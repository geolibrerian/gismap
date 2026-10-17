// Build links from coordinates already present in a shared tour or field task.
export function googleMapsLink(latitude, longitude, zoom = 14) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const level = Number.isFinite(zoom) ? Math.max(0, Math.min(21, Math.round(zoom))) : 14;
  return `https://www.google.com/maps/@${latitude},${longitude},${level}z`;
}

export function googleMapsLinkForChapter(chapter = {}) {
  const state = chapter.viewState || {};
  const center = state.center;
  if (Array.isArray(center) && center.length >= 2) {
    const link = googleMapsLink(center[1], center[0], state.zoom);
    if (link) return link;
  }
  const target = chapter.viewpoint?.targetGeometry || chapter.viewpoint?.target || state.camera?.position;
  if (!target) return null;
  let longitude = target.longitude ?? target.x;
  let latitude = target.latitude ?? target.y;
  const wkid = target.spatialReference?.latestWkid ?? target.spatialReference?.wkid;
  if ([3857, 102100, 102113].includes(wkid) && Number.isFinite(longitude) && Number.isFinite(latitude)) {
    longitude = longitude / 6378137 * 180 / Math.PI;
    latitude = (2 * Math.atan(Math.exp(latitude / 6378137)) - Math.PI / 2) * 180 / Math.PI;
  }
  return googleMapsLink(latitude, longitude, state.zoom);
}
