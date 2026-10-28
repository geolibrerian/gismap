import { createSlide, normalizeBriefing } from './briefing-document.js?v=0.61.0-briefing-player';
import { createCinematicClip } from './cinematic/clip-model.js?v=0.3.9';

// This example intentionally uses one stable, publisher-hosted FeatureServer.
// Its definition query keeps a global historical archive legible and makes the
// cinematic timeline small enough to play comfortably on a laptop or phone.
export const HISTORICAL_QUAKES_WHERE = 'mag >= 6.5';
export const HISTORICAL_QUAKES_SOURCE = 'https://rhvpkkiftonktxq3.svcs9.arcgis.com/RHVPKKiFTONKtxq3/ArcGIS/rest/services/Historical_Quakes/FeatureServer/0';

// The service publishes a useful scale range.  A globe-wide view can therefore
// be perfectly valid cartographically while hiding every earthquake symbol.
// Start inside the north-east Pacific instead: it makes the first timeline
// frame immediately legible and leaves enough room for the camera to travel.
const overviewCamera = { center: [-132, 31], zoom: 5.35, heading: -8, tilt: 20 };
const ringOfFireCamera = { center: [-118, 27], zoom: 6.15, heading: -18, tilt: 32 };

const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const attribute = (feature, field) => feature?.attributes?.[field];
const pointCamera = (feature) => {
  const x = finite(feature?.geometry?.x ?? feature?.geometry?.longitude);
  const y = finite(feature?.geometry?.y ?? feature?.geometry?.latitude);
  return x == null || y == null ? overviewCamera : { center: [x, y], zoom: 5, heading: 0, tilt: 20 };
};
const sourceLayer = (layer) => [{ layer, visible: true }];

/**
 * A portable Clip recipe which leaves the service renderer intact. The
 * timeline reveals actual recorded events cumulatively; camera movement and
 * captions provide the cinematic treatment without replacing publisher
 * magnitude symbols with a decorative point effect.
 */
export function createHistoricalQuakesCinematicClip({ quakeRef, projectId = null, observationTimes = [] } = {}) {
  if (!quakeRef) throw new Error('The Historical Quakes layer is required.');
  const cinematic = {
    id: 'historical-quakes-observed-timeline',
    title: 'Historical Quakes — observed timeline',
    intent: 'present',
    preferredEngine: 'arcgis',
    quality: 'balanced',
    clock: { start: '', end: '', current: '', timeMode: 'cumulative', durationSeconds: 32, rate: 0.35, loop: false, effectsRate: 1, effectsPlaying: false },
    layers: [{
      layerRef: quakeRef,
      temporal: { kind: 'time', startField: 'time', featureIdField: 'OBJECTID', timezone: 'UTC', missingTime: 'exclude' },
      // `none` is deliberate: ArcGIS Engine continues to draw the service's
      // own magnitude renderer rather than covering it with generic markers.
      animation: { template: 'moving-track', transition: 'crossfade', opacity: 0.95, effect: { type: 'none' }, visible: true },
      provenance: { status: 'observed', caption: 'Recorded earthquake events, ordered by the service’s Event Time field.' },
    }],
    provenance: { synthetic: false, sourceUrls: [HISTORICAL_QUAKES_SOURCE] },
  };
  return createCinematicClip({
    cinematic,
    projectId,
    observationTimes,
    title: 'Historical Quakes — observed timeline',
    options: {
      id: 'historical-quakes-observed-timeline',
      durationMs: 28000,
      easing: 'ease-in-out',
      startCamera: { longitude: overviewCamera.center[0], latitude: overviewCamera.center[1], zoom: overviewCamera.zoom, bearing: overviewCamera.heading, pitch: overviewCamera.tilt },
      endCamera: { longitude: ringOfFireCamera.center[0], latitude: ringOfFireCamera.center[1], zoom: ringOfFireCamera.zoom, bearing: ringOfFireCamera.heading, pitch: ringOfFireCamera.tilt },
      captions: [
        { atMs: 0, text: 'Recorded earthquakes appear in Event Time order.' },
        { atMs: 14000, text: 'This example shows magnitude 6.5 and larger events so the global pattern stays readable.' },
        { atMs: 26000, text: 'Colour and size remain the Feature Service’s magnitude styling.' },
      ],
    },
  });
}

function narrative(title, markdown, { quakeRef, camera = overviewCamera } = {}) {
  const slide = createSlide('map-narrative', { title, camera });
  slide.blocks = [{ type: 'text', markdown }];
  slide.layers = sourceLayer(quakeRef);
  return slide;
}

function featureSlide(feature, quakeRef) {
  const title = String(attribute(feature, 'title') || attribute(feature, 'place') || 'Recorded earthquake').slice(0, 160);
  const slide = createSlide('feature', {
    title,
    featureId: attribute(feature, 'OBJECTID'),
    camera: pointCamera(feature),
    fields: ['mag', 'time', 'place', 'depth', 'sig'],
  });
  slide.layers = sourceLayer(quakeRef);
  const magnitude = finite(attribute(feature, 'mag'));
  const depth = finite(attribute(feature, 'depth'));
  slide.blocks[1].markdown = [
    magnitude == null ? 'A recorded event from the Historical Quakes Feature Service.' : `Magnitude **${magnitude.toFixed(1)}** recorded by the source service.`,
    depth == null ? '' : `Depth: **${depth.toFixed(1)} km**.`,
    'Use the facts and Source panel to inspect the original record and its publisher metadata.',
  ].filter(Boolean).join(' ');
  return slide;
}

/** A completed, editable briefing based on the stable Historical Quakes FeatureServer. */
export function createHistoricalQuakesExampleBriefing({ quakeRef, clip, featuredEvents = [] } = {}) {
  if (!quakeRef) throw new Error('The Historical Quakes layer is required.');
  if (!clip?.id) throw new Error('The Historical Quakes cinematic Clip is required.');
  const title = createSlide('title', {
    title: 'Historical earthquakes',
    subtitle: 'A finished briefing built from a stable ArcGIS Feature Service',
    camera: overviewCamera,
  });
  title.layers = sourceLayer(quakeRef);

  const cinematic = createSlide('cinematic', { title: 'Observed history in motion', camera: overviewCamera });
  cinematic.layers = sourceLayer(quakeRef);
  cinematic.clipRef = clip.id;
  cinematic.clip = clip;
  cinematic.presentation = 'interactive';
  cinematic.autoplay = false;
  cinematic.loop = false;
  cinematic.allowExplore = true;

  const closing = createSlide('actions', { title: 'Explore the source', camera: ringOfFireCamera });
  closing.layers = sourceLayer(quakeRef);
  closing.blocks = [
    { type: 'list', items: [
      'Open a record to inspect its place, magnitude, depth, significance, and UTC event time.',
      'Use Filter map to change the magnitude threshold, then save your own briefing or map.',
      'The service is an archive: check the publisher’s metadata before using it for operational decisions.',
    ] },
    { type: 'links', links: [{ label: 'Open the Historical Quakes Feature Service', url: HISTORICAL_QUAKES_SOURCE }] },
  ];

  return normalizeBriefing({
    layerId: quakeRef,
    playerSettings: { basemap: 'topo-vector', animations: true, motion: 'fly', mapDetails: 'slide' },
    slides: [
      title,
      narrative('A reliable archive, styled by its source', 'This example uses the **Historical Quakes** ArcGIS Feature Service rather than a changing hazard feed. It shows magnitude **6.5 and larger** events so the global pattern remains readable. In ArcGIS Engine, the layer keeps the publisher’s own magnitude renderer: colour and symbol size come from the service instead of a generic point style.', { quakeRef, camera: overviewCamera }),
      cinematic,
      ...featuredEvents.slice(0, 3).map((feature) => featureSlide(feature, quakeRef)),
      narrative('Read patterns carefully', 'The animation orders recorded events by the service’s **Event Time** field in UTC. It is a visual way to explore an archive, not a forecast or an alert feed. Dense areas can reflect both seismic activity and the archive’s historical coverage; inspect individual records and source metadata before drawing conclusions.', { quakeRef, camera: ringOfFireCamera }),
      closing,
    ],
  });
}
