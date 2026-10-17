const fail = (message, fallback) => { throw new Error(message || fallback); };
const deep = (a, b) => {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a).filter((k) => a[k] !== undefined || k in b), kb = Object.keys(b);
  if (Object.keys(a).length !== kb.length) return false;
  return Object.keys(a).every((k) => deep(a[k], b[k]));
};
const assert = {
  equal: (a, b, m) => Object.is(a, b) || fail(m, `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`),
  notEqual: (a, b, m) => !Object.is(a, b) || fail(m, `Expected values to differ: ${JSON.stringify(a)}`),
  strictEqual: (a, b, m) => Object.is(a, b) || fail(m, `Expected ${JSON.stringify(a)} to equal ${JSON.stringify(b)}`),
  deepEqual: (a, b, m) => deep(a, b) || fail(m, `Expected ${JSON.stringify(a)} to deep-equal ${JSON.stringify(b)}`),
  deepStrictEqual: (a, b, m) => deep(a, b) || fail(m, `Expected ${JSON.stringify(a)} to deep-equal ${JSON.stringify(b)}`),
  notDeepEqual: (a, b, m) => !deep(a, b) || fail(m, `Expected values not to deep-equal: ${JSON.stringify(a)}`),
  ok: (v, m) => v || fail(m, `Expected truthy, got ${JSON.stringify(v)}`),
  match: (s, r, m) => r.test(s) || fail(m, `Expected text to match ${r}`),
  doesNotMatch: (s, r, m) => !r.test(s) || fail(m, `Expected text not to match ${r}`),
  throws: (fn, r, m) => { try { fn(); } catch (e) { if (r instanceof RegExp && !r.test(String(e?.message))) fail(m, `Error "${e?.message}" did not match ${r}`); return; } fail(m, "Expected function to throw"); },
  rejects: async (p, r, m) => { try { await (typeof p === "function" ? p() : p); } catch (e) { if (r instanceof RegExp && !r.test(String(e?.message))) fail(m, `Rejection "${e?.message}" did not match ${r}`); return; } fail(m, "Expected rejection"); },
};
export default assert;
export const { equal, deepEqual, ok, match, throws } = assert;
