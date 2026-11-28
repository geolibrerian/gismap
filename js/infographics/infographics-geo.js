// Browser-side geography for Flow Map: d3-geo projections and a quiet world
// boundary layer. Loaded only when the infographics editor opens, so a map
// with no graphic downloads none of it.

import { endpointExtent } from "./flow-map.js";

export const D3_GEO_URL = "https://cdn.jsdelivr.net/npm/d3-geo@3.1.1/+esm";
export const TOPOJSON_URL = "https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/+esm";
export const BOUNDARY_URL = "https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json";
export const BOUNDARY_REVISION = "world-atlas@2.0.2/countries-110m";
export const BOUNDARY_CREDIT = "Boundaries: Natural Earth 1:110m via world-atlas 2.0.2";

let loading = null;

/** d3-geo plus land and border geometry, fetched once per page. */
export function loadGeoModules({ importModule = (url) => import(url), fetchJson = (url) => fetch(url).then((response) => { if (!response.ok) throw new Error(`Boundaries could not load (${response.status}).`); return response.json(); }) } = {}) {
  loading ||= Promise.all([importModule(D3_GEO_URL), importModule(TOPOJSON_URL), fetchJson(BOUNDARY_URL)]).then(([d3, topojson, world]) => ({
    d3,
    land: topojson.feature(world, world.objects.land),
    borders: topojson.mesh(world, world.objects.countries, (a, b) => a !== b),
  })).catch((error) => { loading = null; throw error; });
  return loading;
}

/**
 * The `geo` object renderFlowMapSvg expects. "world" fits Equal Earth to the
 * sphere; "regional" fits Mercator to the displayed endpoints, centred on them
 * so a Pacific extent stays in one piece.
 */
export function flowMapGeo(modules, kind = "world") {
  const { d3, land, borders } = modules;
  return {
    credit: BOUNDARY_CREDIT,
    revision: BOUNDARY_REVISION,
    create(box, flows) {
      const pad = 10;
      const extent = [[box.x + pad, box.y + pad], [box.x + box.width - pad, box.y + box.height - pad]];
      let projection;
      if (kind === "regional" && flows.length) {
        const ends = flows.flatMap((flow) => [flow.origin, flow.destination]);
        // Pad by a share of the data's own spread, so a city region and an ocean basin both fill the frame.
        const tight = endpointExtent(ends, 0);
        const spread = Math.max(tight.ymax - tight.ymin, tight.crossesAntimeridian ? tight.xmax + 360 - tight.xmin : tight.xmax - tight.xmin);
        const bounds = endpointExtent(ends, Math.min(8, Math.max(0.15, spread * 0.12)));
        const span = bounds.crossesAntimeridian ? bounds.xmax + 360 - bounds.xmin : bounds.xmax - bounds.xmin;
        const center = bounds.xmin + span / 2;
        projection = d3.geoMercator().rotate([-center, 0]);
        const corners = { type: "MultiPoint", coordinates: [[bounds.xmin, bounds.ymin], [bounds.xmin + span, bounds.ymax], [center, bounds.ymin], [center, bounds.ymax]] };
        projection.fitExtent(extent, corners).clipExtent([[box.x, box.y], [box.x + box.width, box.y + box.height]]);
      } else {
        projection = d3.geoEqualEarth().fitExtent(extent, { type: "Sphere" });
      }
      const path = d3.geoPath(projection);
      if (typeof path.digits === "function") path.digits(1);
      return {
        project: (point) => projection(point),
        sphere: kind === "regional" ? null : path({ type: "Sphere" }),
        land: path(land),
        borders: path(borders),
      };
    },
  };
}
