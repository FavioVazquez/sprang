/**
 * String utility functions.
 */

/**
 * Capitalizes the first character of a string.
 */
export function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Truncates a string to maxLen characters, appending '...' if truncated.
 */
export function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '...';
}

/**
 * Converts a string to a URL-friendly slug.
 * Lowercases, replaces spaces and special chars with hyphens, removes leading/trailing hyphens.
 */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
