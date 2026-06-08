/**
 * Longest Common Subsequence length — O(m×n) time, O(min(m,n)) space.
 */
export function lcsLength(a: string, b: string): number {
  if (!a || !b) return 0;
  const [s, t] = a.length <= b.length ? [a, b] : [b, a];
  const len = s.length;
  let prev = new Array<number>(len + 1).fill(0);
  let curr = new Array<number>(len + 1).fill(0);
  for (let i = 0; i < t.length; i++) {
    for (let j = 1; j <= len; j++) {
      curr[j] = t[i] === s[j - 1]
        ? (prev[j - 1] ?? 0) + 1
        : Math.max(prev[j] ?? 0, curr[j - 1] ?? 0);
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return prev[len] ?? 0;
}

/**
 * LCS similarity ratio: lcsLength / max(a.length, b.length). Returns 0.0–1.0.
 */
export function lcsSimilarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  return lcsLength(a, b) / Math.max(a.length, b.length);
}

/**
 * Structural fingerprint — strip whitespace/comments, normalize literals.
 */
export function structuralFingerprint(code: string): string {
  return code
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/"[^"]*"/g, '"S"')
    .replace(/'[^']*'/g, "'S'")
    .replace(/`[^`]*`/g, '`S`')
    .replace(/\b\d+(\.\d+)?\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
}
