// Runs a script with `sandbox` as its global, enough for the vendored UMD bundles the tests load.
export function runInNewContext(code, sandbox) {
  new Function("globalThis", "self", "window", "define", "exports", "module", code).call(sandbox, sandbox, sandbox, sandbox);
  return sandbox;
}
export default { runInNewContext };
