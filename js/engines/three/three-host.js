// three.js inside MapLibre: one custom layer shares the map's WebGL context and
// draws every 3D layer (point clouds, models) in its own local metre frame.
// three.js loads only when the first 3D layer is added (import map in index.html).
import { createAnimationClock } from "../../animation-clock.js?v=0.1.0";

export const THREE_LAYER_ID = "gismap-three";
let threeLoading = null;

/** three.js and the addons it needs, from the pinned CDN build in the import map. */
export function loadThree() {
  threeLoading ??= import("three").catch((error) => {
    threeLoading = null;
    throw new Error(`three.js could not be loaded (${error.message}).`);
  });
  return threeLoading;
}

export async function loadThreeAddon(path) {
  return import(`three/addons/${path}`);
}

/**
 * Draws three.js scenes on a MapLibre map. Each item: { scene, origin: [mercX, mercY], scale, update?(time, { map }), animated?, dispose? }.
 * `clock` is the shared animation clock: items read its time; the map repaints while it plays.
 * An `animated` item (a cinematic effect) keeps the map repainting while it is visible.
 */
export class ThreeHost {
  #items = new Map();
  #renderer = null;
  #camera = null;
  #warnedGlobe = false;
  // Frame timing while items animate: smoothed interval and render cost in ms.
  #frames = { last: 0, interval: 0, render: 0, samples: 0 };

  constructor({ map, THREE, notify = () => {} }) {
    Object.assign(this, { map, THREE, notify });
    this.clock = createAnimationClock({ start: 0, end: 8000, loop: true, reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true });
    this.clock.onTick(() => this.map.triggerRepaint());
    this.layer = {
      id: THREE_LAYER_ID,
      type: "custom",
      renderingMode: "3d",
      onAdd: (map, gl) => {
        this.#camera = new THREE.Camera();
        this.#renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
        this.#renderer.autoClear = false;
      },
      render: (gl, options) => this.#render(options),
      onRemove: () => { this.#renderer?.dispose(); this.#renderer = null; },
    };
    this.attach();
    // A background tab neither repaints nor counts as a slow frame.
    globalThis.document?.addEventListener?.("visibilitychange", () => {
      this.#frames.last = 0;
      if (globalThis.document.visibilityState === "visible") this.map.triggerRepaint();
    });
  }

  /** (Re)adds the custom layer, e.g. after a basemap style change removed it. */
  attach() {
    if (this.map.getLayer?.(THREE_LAYER_ID)) return;
    this.map.addLayer(this.layer);
  }

  add(uid, item) {
    // Replacing an observed snapshot must free the prior GPU resources.
    this.remove(uid);
    // Kept as-is (not copied) so live getters such as `animated` stay live.
    this.#items.set(uid, Object.assign(item, { visible: item.visible ?? true, opacity: item.opacity ?? 1, vertices: countVertices(item.scene) }));
    this.attach();
    this.map.triggerRepaint();
  }

  remove(uid) {
    const item = this.#items.get(uid);
    if (!item) return;
    item.dispose?.();
    item.scene.traverse?.((object) => { object.geometry?.dispose?.(); [object.material].flat().forEach((material) => material?.dispose?.()); });
    this.#items.delete(uid);
    this.map.triggerRepaint();
  }

  set(uid, { visible, opacity } = {}) {
    const item = this.#items.get(uid);
    if (!item) return;
    if (visible !== undefined) item.visible = Boolean(visible);
    if (opacity !== undefined) {
      item.opacity = opacity;
      item.scene.traverse((object) => [object.material].flat().forEach((material) => {
        if (!material) return;
        // Shader effects blend premultiplied colour and read opacity as a uniform.
        if (material.uniforms?.uOpacity) { material.uniforms.uOpacity.value = opacity; return; }
        material.transparent = opacity < 1; material.opacity = opacity;
      }));
    }
    this.map.triggerRepaint();
  }

  get size() { return this.#items.size; }

  /** What is drawn and how fast: items, vertices, smoothed frame interval and render cost (ms). `reset` restarts the frame sample. */
  stats({ reset = false } = {}) {
    const items = [...this.#items.values()].filter((item) => item.visible);
    const { interval, render, samples } = this.#frames;
    const result = {
      items: items.length, vertices: items.reduce((sum, item) => sum + (item.vertices || 0), 0),
      frameMs: samples ? Math.round(interval * 10) / 10 : null, fps: samples && interval ? Math.round(1000 / interval) : null,
      renderMs: samples ? Math.round(render * 100) / 100 : null, samples,
    };
    if (reset) this.#frames = { last: 0, interval: 0, render: 0, samples: 0 };
    return result;
  }

  clear() {
    [...this.#items.keys()].forEach((uid) => this.remove(uid));
  }

  #render(options) {
    if (!this.#renderer || !this.#items.size) return;
    if (this.map.getProjection?.()?.type === "globe") {
      if (!this.#warnedGlobe) { this.#warnedGlobe = true; this.notify("3D point clouds and models draw on the flat (Mercator) map; switch off the globe to see them."); }
      return;
    }
    // MapLibre 5: mainMatrix takes 0–1 Mercator units (modelViewProjectionMatrix takes world pixels).
    // MapLibre 4 passed the Mercator matrix itself.
    const matrix = options?.defaultProjectionData?.mainMatrix ?? options;
    const { Matrix4 } = this.THREE;
    const projection = new Matrix4().fromArray(matrix);
    const time = this.clock.time;
    const started = globalThis.performance?.now?.() ?? Date.now();
    let animating = false;
    for (const item of this.#items.values()) {
      if (!item.visible) continue;
      item.update?.(time, { map: this.map });
      animating ||= item.animated === true;
      const [x, y] = item.origin, s = item.scale;
      // Ground-relative layers stand on the terrain when it is on (0 on a flat map).
      const ground = item.onTerrain && this.map.getTerrain?.() ? this.map.queryTerrainElevation?.(item.lngLat) || 0 : 0;
      // Local metres (east, north, up) to Mercator units: north is −y on the map.
      const local = new Matrix4().makeTranslation(x, y, ground * s).scale(new this.THREE.Vector3(s, -s, s));
      this.#camera.projectionMatrix = projection.clone().multiply(local);
      this.#renderer.resetState();
      this.#renderer.render(item.scene, this.#camera);
    }
    if (animating) this.#sample(started);
    if (animating && globalThis.document?.visibilityState !== "hidden") this.map.triggerRepaint();
  }

  #sample(started) {
    const now = globalThis.performance?.now?.() ?? Date.now();
    const frames = this.#frames, gap = frames.last ? started - frames.last : 0;
    frames.last = started;
    // Gaps over half a second are a stall or a hidden tab, not frame time.
    if (!gap || gap > 500) return;
    const weight = frames.samples < 10 ? 1 / (frames.samples + 1) : 0.1;
    frames.interval += (gap - frames.interval) * weight;
    frames.render += ((now - started) - frames.render) * weight;
    frames.samples += 1;
  }
}

function countVertices(scene) {
  let count = 0;
  scene?.traverse?.((object) => { count += object.geometry?.attributes?.position?.count || 0; });
  return count;
}
