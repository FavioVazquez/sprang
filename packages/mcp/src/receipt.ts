import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A record of what the agent actually looked at.
 *
 * Sourcegraph's CodeScaleBench study of 1,281 agent runs names five failure
 * modes, and calls partial completion "the most dangerous failure mode because
 * it appears to be somewhat successful". An agent changes a function, does not
 * notice three of its seven callers, and reports success. Every retrieval tool
 * in this space helps the agent *find* code; none of them check afterwards
 * whether it found enough.
 *
 * That check is cheap when a dependency graph is already present: the set of
 * nodes the agent read is knowable, the blast radius of what it changed is
 * computable, and the difference between them is the answer.
 *
 * Reads are appended to a JSONL file per session rather than held in memory,
 * because the MCP server and the process that reviews the diff are usually not
 * the same process — and a receipt that vanishes when the server restarts
 * would be worthless exactly when a long session needs it most.
 */
export interface ReadEvent {
  /** Graph node id, or a bare file path for file-level reads. */
  node: string;
  /** Which tool surfaced it. */
  tool: string;
  at: string;
}

const RECEIPTS_DIR = join('.sprang', 'receipts');

/** Node ids are `file:<path>`; normalise both forms to a plain path. */
export function toPath(nodeOrPath: string): string {
  if (nodeOrPath.startsWith('file:')) return nodeOrPath.slice('file:'.length);
  // function:<path>:<name> — the file is the part that matters for coverage.
  const match = /^(?:function|class):([^:]+):/.exec(nodeOrPath);
  if (match?.[1]) return match[1];
  return nodeOrPath;
}

export class ReadLog {
  private readonly file: string;
  private readonly seen = new Set<string>();

  constructor(
    private readonly sprangRoot: string,
    sessionId: string,
  ) {
    // A session id from the client would be ideal, but MCP is stateless by
    // design, so fall back to something stable for the life of the process.
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
    this.file = join(sprangRoot, RECEIPTS_DIR, `${safe}.jsonl`);
  }

  /** Best-effort: a failure to record must never fail the tool call. */
  record(nodes: string[], tool: string): void {
    const fresh = nodes.filter((n) => n && !this.seen.has(n));
    if (fresh.length === 0) return;
    for (const n of fresh) this.seen.add(n);
    try {
      mkdirSync(join(this.sprangRoot, RECEIPTS_DIR), { recursive: true });
      const at = new Date().toISOString();
      appendFileSync(
        this.file,
        fresh.map((node) => JSON.stringify({ node, tool, at } satisfies ReadEvent)).join('\n') + '\n',
      );
    } catch {
      /* receipts are diagnostics, never a hard dependency */
    }
  }

  /** Every path read in this session. */
  paths(): Set<string> {
    const out = new Set<string>();
    for (const node of this.seen) out.add(toPath(node));
    return out;
  }
}

/** Read every receipt on disk — used when reviewing a diff after the fact. */
export function loadAllReadPaths(sprangRoot: string): { paths: Set<string>; sessions: number } {
  const dir = join(sprangRoot, RECEIPTS_DIR);
  const paths = new Set<string>();
  if (!existsSync(dir)) return { paths, sessions: 0 };

  let sessions = 0;
  try {
    // Cheap directory read; receipts are small and few.
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.jsonl')) continue;
      sessions += 1;
      const raw = readFileSync(join(dir, name), 'utf-8');
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as ReadEvent;
          if (event.node) paths.add(toPath(event.node));
        } catch {
          /* a truncated final line is expected on an interrupted write */
        }
      }
    }
  } catch {
    /* ignore */
  }
  return { paths, sessions };
}
