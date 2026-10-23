import { createSlide, normalizeBriefing } from './briefing-document.js?v=0.60.0-media1';

// Narrative is deliberately qualitative: the two public services change over time.
export function createHazardsExampleBriefing({ earthquakeRef, hurricaneRef, hurricaneLayerName = 'selected layer' }) {
  if (!earthquakeRef || !hurricaneRef) throw new Error('Both example layers are required.');
  const camera = { center: [-80, 24], zoom: 2, heading: 0, tilt: 0 };
  const hurricaneCamera = { center: [-70, 25], zoom: 3, heading: 0, tilt: 0 };
  const layers = (earthquakes, hurricanes) => [{ layer: earthquakeRef, visible: earthquakes }, { layer: hurricaneRef, visible: hurricanes }];
  const narrative = (title, markdown, visibleLayers, view = camera) => {
    const slide = createSlide('map-narrative', { title, camera: view });
    slide.blocks = [{ type: 'text', markdown }];
    slide.layers = visibleLayers;
    return slide;
  };
  const title = createSlide('title', { title: 'A changing hazards picture', subtitle: 'Example briefing · hurricanes and recent earthquakes', camera });
  title.layers = layers(true, true);
  const closing = createSlide('actions', { title: 'Explore and verify', camera });
  closing.layers = layers(true, true);
  closing.blocks = [
    { type: 'list', items: ['Select a feature to inspect its attributes and source.', 'Use the Features tab to explore records, then edit or add slides.', 'Check the source agencies for current warnings and operational decisions.'] },
    { type: 'links', links: [
      { label: 'Active Hurricanes service', url: 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Active_Hurricanes_v1/FeatureServer' },
      { label: 'USGS Recent Earthquakes service', url: 'https://earthquake.usgs.gov/arcgis/rest/services/eq/Recent_Earthquakes/MapServer' },
    ] },
  ];
  return normalizeBriefing({
    layerId: earthquakeRef,
    slides: [title,
      narrative('Active hurricanes', `The Active Hurricanes service provides tropical cyclone information. This slide shows its ${hurricaneLayerName} layer; earthquake points are hidden. Forecast positions describe projections, not current observations. If there are no active storms, the hurricane layer may be empty. Check the source for coverage and update time.`, layers(false, true), hurricaneCamera),
      narrative('Recent earthquakes', 'The USGS Recent Earthquakes layer shows recent magnitude 2.5 and greater events; the hurricane layer is hidden. Inspect individual points for event details. The displayed events are a changing feed, not a complete record of all earthquakes.', layers(true, false)),
      narrative('Reading the map', 'This example puts two different natural hazards in one view. Their presence together does not imply a causal relationship. Data coverage, update schedules, and display scales differ; inspect each source before comparing them.', layers(true, true)),
      closing,
    ],
  });
}

export function chooseHurricaneLayer(layers) {
  const candidates = (layers || []).filter(layer => layer?.url);
  return candidates.find(layer => /current.*(position|location)|(?:position|location).*current/i.test(layer.name || ''))
    || candidates.find(layer => /position|location|storm/i.test(layer.name || ''))
    || candidates[0] || null;
}
