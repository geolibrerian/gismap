/**
 * Project files are meant to be shared, so credentials never go into them:
 * API keys and tokens in layer URLs, in WFS custom parameters, or in saved
 * connections are removed, and so is any user:password part of a URL.
 */
export const SENSITIVE_KEY = /^(?:token|oauth[_-]?token|access[_-]?token|api[_-]?key|apikey|key|client[_-]?secret|password|passwd|pwd|authorization|auth|signature|sig|x-api-key|subscription[_-]?key)$/i;

/** The URL without credentials, plus whether anything was removed. */
export function stripUrlCredentials(value) {
  if (typeof value !== "string" || !value) return { url: value, stripped: false };
  let parsed;
  try { parsed = new URL(value); } catch { return { url: value, stripped: false }; }
  let stripped = false;
  if (parsed.username || parsed.password) { parsed.username = ""; parsed.password = ""; stripped = true; }
  for (const key of [...parsed.searchParams.keys()]) {
    if (SENSITIVE_KEY.test(key)) { parsed.searchParams.delete(key); stripped = true; }
  }
  return { url: stripped ? parsed.href : value, stripped };
}

function stripKeys(value) {
  if (Array.isArray(value)) return value.map(stripKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEY.test(key))
    .map(([key, item]) => [key, typeof item === "string" && /^https?:/i.test(item) ? stripUrlCredentials(item).url : stripKeys(item)]));
}

/** A copy of the project that is safe to write to a file; `removed` lists what was taken out. */
export function stripProjectCredentials(project) {
  const copy = structuredClone(project);
  const removed = [];
  for (const layer of copy.layers ?? []) {
    const { url, stripped } = stripUrlCredentials(layer.url);
    if (stripped) { layer.url = url; removed.push(layer.title || "a layer"); }
    if (layer.customParameters && typeof layer.customParameters === "object") {
      const kept = Object.fromEntries(Object.entries(layer.customParameters).filter(([key]) => !SENSITIVE_KEY.test(key)));
      if (Object.keys(kept).length !== Object.keys(layer.customParameters).length) removed.push(layer.title || "a layer");
      layer.customParameters = Object.keys(kept).length ? kept : null;
    }
  }
  if (Array.isArray(copy.connections)) copy.connections = stripKeys(copy.connections);
  return { project: copy, removed: [...new Set(removed)] };
}
