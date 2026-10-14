/**
 * One definition of the compact (phone and portrait-tablet) interface. Every
 * script and stylesheet must agree on this breakpoint; otherwise panels mix
 * mobile and desktop behaviour on tablets and rotated phones.
 *


 */
export const COMPACT_QUERY = "(max-width: 640px), (max-width: 880px) and (orientation: portrait)";

export const compactMedia = () => globalThis.matchMedia?.(COMPACT_QUERY) || { matches: false, addEventListener() {} };
