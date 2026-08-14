import fs from 'node:fs';
import path from 'node:path';

/**
 * Append-only trace of dashboard question handling.
 *
 * The bridge spawns background processes whose failures are invisible: the
 * panel just spins. Diagnosing that has repeatedly meant guessing across
 * several round trips with the user. One line per event in a known file turns
 * "it says thinking and nothing happens" into a single `cat`.
 *
 * Best-effort by design — logging must never be the reason a question fails.
 */
export function bridgeLog(sprangRoot: string, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const dir = path.join(sprangRoot, '.sprang');
    fs.mkdirSync(dir, { recursive: true });
    const parts = Object.entries(fields).map(([k, v]) => {
      const s = typeof v === 'string' ? v : JSON.stringify(v);
      // Keep it one line and skimmable; full text lives in the response file.
      return `${k}=${String(s).replace(/\s+/g, ' ').slice(0, 200)}`;
    });
    fs.appendFileSync(
      path.join(dir, 'bridge.log'),
      `${new Date().toISOString()} ${event}${parts.length ? ' ' + parts.join(' ') : ''}\n`,
    );
  } catch {
    /* never let logging break the bridge */
  }
}
