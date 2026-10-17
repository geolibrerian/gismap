// Contrast audit for the generated content pages: every visible text node's colour
// against the first opaque background behind it. Returns elements below WCAG AA.
window.contrastAudit = () => {
  const parse = (value) => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const [r, g, b, a = 1] = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r, g, b, a };
  };
  const luminance = ({ r, g, b }) => {
    const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const blend = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const backgroundOf = (element) => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      const color = parse(style.backgroundColor);
      if (style.backgroundImage !== "none" && !color?.a) {
        // A gradient: use its first colour stop.
        const stop = parse(style.backgroundImage.match(/rgba?\([^)]+\)/g)?.slice(-1)[0] || "");
        if (stop) { layers.push({ ...stop, a: 1 }); break; }
      }
      if (color && color.a > 0) { layers.push(color); if (color.a >= 1) break; }
    }
    let result = { r: 255, g: 255, b: 255, a: 1 };
    for (const layer of layers.reverse()) result = blend(layer, result);
    return result;
  };
  const failures = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!node.textContent.trim() || seen.has(element)) continue;
    seen.add(element);
    const style = getComputedStyle(element);
    if (style.visibility === "hidden" || style.display === "none" || !element.getClientRects().length || element.closest("[hidden], script, style, details:not([open]) > :not(summary)")) continue;
    const fg = parse(style.color);
    if (!fg) continue;
    const bg = backgroundOf(element);
    const text = blend(fg, bg);
    const [light, dark] = [luminance(text), luminance(bg)].sort((a, b) => b - a);
    const ratio = (light + 0.05) / (dark + 0.05);
    const size = parseFloat(style.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
    if (ratio < (large ? 3 : 4.5)) failures.push({ text: node.textContent.trim().slice(0, 40), tag: element.tagName.toLowerCase(), cls: element.className, ratio: Math.round(ratio * 100) / 100, color: style.color, background: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})` });
  }
  return failures;
};
