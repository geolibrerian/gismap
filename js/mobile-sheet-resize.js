/** Keep a mobile sheet between the top bar and its fixed bottom edge. */
export function clampSheetHeight(height, bottom, top, viewportHeight) {
  const max = Math.max(0, bottom - Math.max(0, top));
  const min = Math.min(max, Math.max(160, viewportHeight * 0.22));
  return Math.max(min, Math.min(max, height));
}

/** Bind the same pointer and keyboard resizing behaviour to either sheet. */
export function bindMobileSheetResize({ handle, sheet, variable, documentRef, windowRef, isCompact, onResize = () => {} }) {
  if (!handle || !sheet) return;
  const setHeight = (height) => {
    const bottom = sheet.getBoundingClientRect().bottom;
    const brand = documentRef.querySelector(".mobile-map-brand");
    const top = brand?.getBoundingClientRect().bottom || 8;
    const value = clampSheetHeight(height, bottom, top, windowRef.innerHeight);
    documentRef.body.style.setProperty(variable, `${value}px`);
    onResize();
  };
  handle.addEventListener("keydown", (event) => {
    if (!isCompact()) return;
    const delta = ({ ArrowUp: 32, ArrowDown: -32 })[event.key];
    if (delta == null) return;
    event.preventDefault();
    setHeight(sheet.getBoundingClientRect().height + delta);
  });
  handle.addEventListener("pointerdown", (event) => {
    if (!isCompact() || (event.button != null && event.button !== 0)) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = sheet.getBoundingClientRect().height;
    const pointerId = event.pointerId;
    handle.setPointerCapture?.(pointerId);
    const move = (next) => { if (next.pointerId === pointerId) setHeight(startHeight + startY - next.clientY); };
    const finish = (next) => {
      if (next.pointerId !== pointerId) return;
      windowRef.removeEventListener("pointermove", move);
      windowRef.removeEventListener("pointerup", finish);
      windowRef.removeEventListener("pointercancel", finish);
      onResize();
    };
    windowRef.addEventListener("pointermove", move);
    windowRef.addEventListener("pointerup", finish);
    windowRef.addEventListener("pointercancel", finish);
  });
}
