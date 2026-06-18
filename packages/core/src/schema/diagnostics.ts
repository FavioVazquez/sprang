import type { ZodError } from 'zod';

/**
 * Turn a (potentially huge) ZodError into a concise, actionable one-liner:
 * total issue count plus the few most common distinct "path :: message" shapes.
 * Array indices collapse to `[]` so e.g. 64 bad domain steps read as one line.
 *
 * Used by the MCP GraphLoader and the `sprang merge` CLI to report why a graph
 * failed validation instead of failing silently.
 */
export function summarizeZodIssues(error: ZodError): string {
  const counts = new Map<string, number>();
  for (const issue of error.issues) {
    const path = issue.path.map((p) => (typeof p === 'number' ? '[]' : p)).join('.');
    const key = `${path || '<root>'}: ${issue.message}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, c]) => (c > 1 ? `${k} (×${c})` : k));
  return `${error.issues.length} issue(s): ${top.join('; ')}${counts.size > 3 ? ' …' : ''}`;
}
