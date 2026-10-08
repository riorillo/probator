/** Compare acyclic CDP data without sorting, copying or serializing the page twice.
 * Like canonical(), absent array entries/undefined and non-finite numbers normalize to null.
 * Object key order is immaterial; missing keys remain distinct from present null keys.
 */
export function equal(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === undefined || (typeof left === "number" && !Number.isFinite(left))) left = null;
  if (right === undefined || (typeof right === "number" && !Number.isFinite(right))) right = null;
  if (left === right) return true;
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (!equal(left[i], right[i])) return false;
    return true;
  }
  if (Array.isArray(right)) return false;
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  for (const key of keys) {
    if (!Object.hasOwn(b, key) || !equal(a[key], b[key])) return false;
  }
  return true;
}
