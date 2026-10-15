// Icons for moving a panel: a two-tone north-arrow needle (the map's own
// symbol) aimed where the panel will go. "dock" points into a right-hand
// panel, "undock" back to the left side, "popout" up and out of a frame into a
// floating window. The lit half of the needle uses the skin's accent colour.

const needle = (from, to, width) => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  // The widest point sits a third of the way from the tail, like a compass needle.
  const [mx, my] = [x1 + ux * length * 0.36, y1 + uy * length * 0.36];
  const [nx, ny] = [-uy * width, ux * width];
  const point = (x, y) => `${x.toFixed(2)},${y.toFixed(2)}`;
  // Lit and shaded halves, and the pivot, as on a compass rose.
  return `<polygon class="dock-icon__lit" points="${point(x1, y1)} ${point(mx + nx, my + ny)} ${point(x2, y2)}"/><polygon class="dock-icon__shade" points="${point(x1, y1)} ${point(mx - nx, my - ny)} ${point(x2, y2)}"/><circle class="dock-icon__pivot" cx="${mx.toFixed(2)}" cy="${my.toFixed(2)}" r="${(width * 0.34).toFixed(2)}"/>`;
};

const SHAPES = {
  // A frame with its right column filled: the right panel. The needle points into it.
  dock: `<rect class="dock-icon__frame" x="2.75" y="4.75" width="18.5" height="14.5" rx="2.5"/><path class="dock-icon__pane" d="M14.5 5.5h4.25a1.75 1.75 0 0 1 1.75 1.75v9.5a1.75 1.75 0 0 1-1.75 1.75H14.5z"/>${needle([4.4, 12], [19.2, 12], 2.5)}`,
  // The same frame, needle pointing back to the left side.
  undock: `<rect class="dock-icon__frame" x="2.75" y="4.75" width="18.5" height="14.5" rx="2.5"/><path class="dock-icon__pane" d="M9.5 5.5H5.25A1.75 1.75 0 0 0 3.5 7.25v9.5a1.75 1.75 0 0 0 1.75 1.75H9.5z"/>${needle([19.6, 12], [4.8, 12], 2.5)}`,
  // An open-cornered frame with the needle leaving it to the north-east: a floating window.
  popout: `<path class="dock-icon__frame" d="M11 4.75H5.25a2.5 2.5 0 0 0-2.5 2.5v11.5a2.5 2.5 0 0 0 2.5 2.5h11.5a2.5 2.5 0 0 0 2.5-2.5V13"/>${needle([5.4, 18.6], [21.6, 2.4], 2.5)}`,
};

/** Inline SVG for a dock button; decorative, so buttons keep their own aria-label. */
export function dockIcon(kind = "dock") {
  return `<svg class="dock-icon dock-icon--${kind}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${SHAPES[kind] || SHAPES.dock}</svg>`;
}
