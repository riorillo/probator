/**
 * Absolute HTTP(S) addresses without embedded credentials.
 * This mirrors the urlsplit-based validation the provider addresses used to go through.
 */
export function absolute(value: string): boolean {
  if (value !== value.trim()) return false;
  const parsed = URL.parse(value);
  if (!parsed) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (!parsed.hostname) return false;
  return !parsed.username && !parsed.password;
}
