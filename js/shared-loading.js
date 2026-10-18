// Shared links may need metadata, feature queries and a map before they can be presented.
export function isSharedLaunch(location) {
  const search = new URLSearchParams(location.search || "");
  const hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
  return ["map", "briefing", "tour", "fieldTask"].some((key) => hash.has(key)) ||
    ["layer", "example", "spec", "briefing"].some((key) => search.has(key));
}

export function createSharedLoading({ element, location, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!element || !isSharedLaunch(location)) return { update() {}, finish() {} };
  const message = element.querySelector("[data-shared-loading-message]");
  element.hidden = false;
  let finished = false;
  const timer = setTimer(() => {
    if (!finished && message) message.textContent = "Still charting the map… some data may take a little longer.";
  }, 12000);
  return {
    update(text) { if (!finished && message) message.textContent = text; },
    finish() {
      if (finished) return;
      finished = true;
      clearTimer(timer);
      element.hidden = true;
    },
  };
}
