/**
 * Server-initiated MCP traffic: resource subscriptions, progress and elicitation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Everything Sprang served until now was pull-only: the client asks, the server
 * answers, the connection goes quiet. Three things do not fit that shape.
 *
 * 1. **The graph goes stale while the session is running.** Today that is
 *    communicated by the `SessionStart` hook, which prints a one-shot warning at
 *    the top of the conversation ("the graph was built at commit X, HEAD is Y").
 *    A one-shot warning is wrong in both directions: it is silent when a graph
 *    goes stale *during* the session (the common case — the agent itself commits),
 *    and it is *actively misleading* the moment a background rebuild finishes,
 *    because the warning is still sitting in the context window claiming the
 *    graph is old. `resources/subscribe` is the protocol's answer to exactly this
 *    problem: the client says which resources it cares about, and the server
 *    pushes `notifications/resources/updated` when they actually change. That
 *    *replaces* the staleness hook — the two must not both run, or an agent gets
 *    a stale text warning and a fresh push notification and has no way to tell
 *    which is current. The hook is the thing to delete once a client subscribes.
 *
 * 2. **A first scan on a large repository takes tens of seconds** and the client
 *    shows nothing at all. `notifications/progress` fixes that, but only for
 *    calls that genuinely take time — see `ProgressReporter` for why fabricating
 *    progress for the fast tools would be worse than staying silent.
 *
 * 3. **Two decisions belong to a human, not the model.** `elicitation/create`
 *    lets the server ask. It is intrusive, so exactly two cases qualify; see
 *    `elicitAnnotationContent` and `elicitReviewProceed`.
 *
 * DEGRADATION CONTRACT
 * --------------------
 * All three are optional protocol surface, and this module is written so that a
 * client which ignores every one of them behaves *exactly* as it did before:
 *  - No subscription ⇒ no watcher is ever created (watching is lazy).
 *  - No `_meta.progressToken` ⇒ `ProgressReporter.disabled()` and not a single
 *    notification is sent.
 *  - No `elicitation` capability in `initialize` ⇒ the elicit helpers return
 *    `null` without touching the wire, and the caller takes its old path.
 * Nothing here is ever allowed to fail a request: a notification that cannot be
 * delivered is swallowed, because a tool result must not depend on the client's
 * appetite for out-of-band messages.
 */
import { existsSync, statSync, watch as fsWatch, type FSWatcher } from 'node:fs';
import { dirname, basename } from 'node:path';

// ─── Resource subscriptions ──────────────────────────────────────────────────

/**
 * The two senders the subscription manager needs from the SDK `Server`.
 *
 * Structural, not the concrete class, so the tests can drive the manager with a
 * recording double instead of standing up a transport for every assertion.
 */
export interface ResourceNotifier {
  sendResourceUpdated(params: { uri: string }): Promise<void>;
  sendResourceListChanged(): Promise<void>;
}

/** Minimal handle over whatever is doing the watching, so both paths look alike. */
export interface WatchHandle {
  close(): void;
}

export type WatchFactory = (
  directory: string,
  onChange: (filename: string | null) => void,
  onError: (error: unknown) => void
) => WatchHandle;

export interface SubscriptionManagerOptions {
  /** Absolute path to `.sprang/knowledge-graph.json`. */
  graphPath: string;
  /** Absolute path to `.sprang/SPRANG_REPORT.md`. */
  reportPath: string;
  notifier: ResourceNotifier;
  /** Coalescing window. A rebuild rewrites the graph several times. */
  debounceMs?: number;
  /** Poll period for the `fs.watch`-unavailable fallback. */
  pollMs?: number;
  /** Injectable for tests, and for the day `fs.watch` needs replacing. */
  watchFactory?: WatchFactory;
}

/** How the manager is currently observing the filesystem. */
export type WatchMode = 'idle' | 'fs' | 'poll';

/** Resources whose content is derived from the knowledge graph. */
const GRAPH_DERIVED_STATIC = new Set([
  'sprang://health',
  'sprang://graph/stats',
  'sprang://suggestions',
]);

const REPORT_URI = 'sprang://report';

/** Templated reads (`sprang://node/…`, `sprang://file/…`, `sprang://why/…`) are graph-derived too. */
function isGraphDerived(uri: string): boolean {
  if (GRAPH_DERIVED_STATIC.has(uri)) return true;
  return (
    uri.startsWith('sprang://node/') ||
    uri.startsWith('sprang://file/') ||
    uri.startsWith('sprang://why/')
  );
}

/** `statSync` on a path that may not exist. 0 means "absent". */
function mtimeOf(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Default watcher: watch the **containing directory**, not the file.
 *
 * A rebuild writes to a temp file and renames it over the target, which swaps
 * the inode; a file-level `fs.watch` is bound to the old inode and goes deaf
 * after the first rebuild — the exact moment it was supposed to fire. Watching
 * `.sprang/` survives that, and picks up `SPRANG_REPORT.md` appearing for the
 * first time as a bonus.
 *
 * `persistent: false` is deliberate: in a stdio server the event loop must be
 * free to drain when stdin closes, and a persistent watcher would hold the
 * process open forever. It is still closed explicitly — relying on `persistent`
 * for cleanup would leak a file descriptor per subscribe/unsubscribe cycle.
 */
const defaultWatchFactory: WatchFactory = (directory, onChange, onError) => {
  const watcher: FSWatcher = fsWatch(directory, { persistent: false }, (_event, filename) => {
    onChange(typeof filename === 'string' ? filename : null);
  });
  // `fs.watch` can fail *after* construction (the directory is deleted, or the
  // filesystem simply does not support inotify). Silently-not-working is the
  // failure mode to avoid, so an error demotes us to polling.
  watcher.on('error', (error) => onError(error));
  return { close: () => watcher.close() };
};

/**
 * Tracks `resources/subscribe` registrations and pushes updates when the files
 * behind them change.
 *
 * Lazy on both ends: no subscription means no watcher exists at all, and the
 * last unsubscribe tears it down again. That matters more than it sounds — a
 * leaked `fs.watch` handle or a live `setInterval` keeps a stdio server alive
 * after its client has gone away, and the user is left with an orphan process
 * they have to find and kill.
 */
export class ResourceSubscriptionManager {
  private readonly subscribed = new Set<string>();
  private readonly options: Required<SubscriptionManagerOptions>;
  private readonly watchDir: string;
  private readonly graphFile: string;
  private readonly reportFile: string;

  private watcher: WatchHandle | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  private lastGraphMtime = 0;
  private lastReportMtime = 0;
  private reportPresent = false;

  /** Set while a change is pending, so the debounced flush knows what to send. */
  private graphDirty = false;
  private reportDirty = false;

  private closed = false;

  /** Counters the tests assert on; cheap enough to keep in production. */
  readonly stats = { updatesSent: 0, listChangedSent: 0, flushes: 0 };

  constructor(options: SubscriptionManagerOptions) {
    this.options = {
      debounceMs: 500,
      pollMs: 2000,
      watchFactory: defaultWatchFactory,
      ...options,
    };
    this.watchDir = dirname(options.graphPath);
    this.graphFile = basename(options.graphPath);
    this.reportFile = basename(options.reportPath);
    this.lastGraphMtime = mtimeOf(options.graphPath);
    this.lastReportMtime = mtimeOf(options.reportPath);
    this.reportPresent = existsSync(options.reportPath);
  }

  // ── Registration ───────────────────────────────────────────────────────────

  subscribe(uri: string): void {
    if (this.closed) return;
    this.subscribed.add(uri);
    this.ensureWatching();
  }

  /** Unsubscribing the last URI tears the watcher down. */
  unsubscribe(uri: string): void {
    this.subscribed.delete(uri);
    if (this.subscribed.size === 0) this.stopWatching();
  }

  has(uri: string): boolean {
    return this.subscribed.has(uri);
  }

  get size(): number {
    return this.subscribed.size;
  }

  /** Sorted for determinism — two identical states must stringify identically. */
  list(): string[] {
    return [...this.subscribed].sort();
  }

  watchMode(): WatchMode {
    if (this.watcher !== null) return 'fs';
    if (this.pollTimer !== null) return 'poll';
    return 'idle';
  }

  /** True while a debounced flush is pending. Exposed so cleanup can be asserted. */
  hasPendingFlush(): boolean {
    return this.debounceTimer !== null;
  }

  /**
   * Release every handle. Idempotent, and safe to call from a signal handler.
   *
   * Called on unsubscribe-all, on `server.onclose`, and on SIGINT/SIGTERM. A
   * watcher that outlives the connection is a real bug in a stdio server, not a
   * tidiness concern.
   */
  close(): void {
    this.closed = true;
    this.subscribed.clear();
    this.stopWatching();
  }

  // ── Watching ───────────────────────────────────────────────────────────────

  private ensureWatching(): void {
    if (this.watcher !== null || this.pollTimer !== null) return;
    try {
      this.watcher = this.options.watchFactory(
        this.watchDir,
        (filename) => this.onFilesystemEvent(filename),
        () => this.demoteToPolling()
      );
    } catch {
      // `fs.watch` throws synchronously on filesystems that cannot support it
      // (some network mounts, some containers). Polling is slower but always
      // works, and a subscription that silently never fires is the one outcome
      // worth ruling out.
      this.startPolling();
    }
  }

  private demoteToPolling(): void {
    if (this.closed) return;
    if (this.watcher !== null) {
      try {
        this.watcher.close();
      } catch {
        /* already gone */
      }
      this.watcher = null;
    }
    if (this.subscribed.size > 0) this.startPolling();
  }

  private startPolling(): void {
    if (this.pollTimer !== null) return;
    const timer = setInterval(() => this.poll(), this.options.pollMs);
    // Same reasoning as `persistent: false` above: never hold the process open.
    timer.unref?.();
    this.pollTimer = timer;
  }

  private stopWatching(): void {
    if (this.watcher !== null) {
      try {
        this.watcher.close();
      } catch {
        /* already gone */
      }
      this.watcher = null;
    }
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.graphDirty = false;
    this.reportDirty = false;
  }

  /**
   * A directory event names the file that changed on most platforms, but not
   * all — a `null` filename means "something in here changed", so both files
   * are re-stat'ed rather than guessed at.
   */
  private onFilesystemEvent(filename: string | null): void {
    if (filename === null) {
      this.poll();
      return;
    }
    if (filename === this.graphFile) this.checkGraph();
    else if (filename === this.reportFile) this.checkReport();
  }

  /** The fallback path, and the re-check used when an event carries no filename. */
  poll(): void {
    if (this.closed) return;
    this.checkGraph();
    this.checkReport();
  }

  private checkGraph(): void {
    const mtime = mtimeOf(this.options.graphPath);
    if (mtime === this.lastGraphMtime) return;
    this.lastGraphMtime = mtime;
    this.graphDirty = true;
    this.scheduleFlush();
  }

  private checkReport(): void {
    const mtime = mtimeOf(this.options.reportPath);
    const present = mtime !== 0;
    const appearedOrVanished = present !== this.reportPresent;
    if (mtime === this.lastReportMtime && !appearedOrVanished) return;
    this.lastReportMtime = mtime;
    this.reportPresent = present;
    this.reportDirty = true;
    if (appearedOrVanished) this.listChangedPending = true;
    this.scheduleFlush();
  }

  private listChangedPending = false;

  /**
   * Trailing-edge debounce.
   *
   * A rebuild rewrites `knowledge-graph.json` several times (merge, enrich,
   * stats), and on some platforms a single write raises two `fs.watch` events.
   * Emitting per event would hand the client a burst of five identical
   * notifications and, worse, make it re-read a half-written graph. One
   * notification `debounceMs` after the *last* write is both cheaper and more
   * correct, because by then the file has settled.
   */
  private scheduleFlush(): void {
    if (this.closed) return;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    const timer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.options.debounceMs);
    timer.unref?.();
    this.debounceTimer = timer;
  }

  private async flush(): Promise<void> {
    if (this.closed) return;
    const graphDirty = this.graphDirty;
    const reportDirty = this.reportDirty;
    const listChanged = this.listChangedPending;
    this.graphDirty = false;
    this.reportDirty = false;
    this.listChangedPending = false;
    this.stats.flushes += 1;

    // The available-resource *set* changed (SPRANG_REPORT.md appeared for the
    // first time, say). That is a different signal from "content changed" and
    // goes to every client, subscribed or not — it is how a client knows to
    // re-run `resources/list` instead of trusting its cache forever.
    if (listChanged) {
      this.stats.listChangedSent += 1;
      await this.safely(() => this.options.notifier.sendResourceListChanged());
    }

    // Only URIs somebody actually asked for. Broadcasting every known URI would
    // be spec-legal and useless: the client would re-read resources nobody has
    // open, on every rebuild, on a file that can be 50 MB.
    for (const uri of this.list()) {
      const affected = uri === REPORT_URI ? reportDirty : graphDirty && isGraphDerived(uri);
      if (!affected) continue;
      this.stats.updatesSent += 1;
      await this.safely(() => this.options.notifier.sendResourceUpdated({ uri }));
    }
  }

  /** A notification the client refuses must never surface anywhere. */
  private async safely(send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch {
      /* the client hung up, or does not want it; either way, not our problem */
    }
  }
}

// ─── Progress ────────────────────────────────────────────────────────────────

export interface ProgressNotificationParams {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export type SendProgress = (params: ProgressNotificationParams) => Promise<void>;

/**
 * Read the progress token off a `tools/call` request.
 *
 * Absent means the client did not ask for progress, and per spec we must then
 * send none at all — an unsolicited `notifications/progress` carries no token
 * the client can correlate and is dropped (or logged as a protocol error).
 */
export function progressTokenOf(meta: unknown): string | number | undefined {
  if (meta === null || typeof meta !== 'object') return undefined;
  const token = (meta as Record<string, unknown>)['progressToken'];
  if (typeof token === 'string' || typeof token === 'number') return token;
  return undefined;
}

/**
 * Emits `notifications/progress` for one tool call, or nothing at all.
 *
 * THE RULE THIS ENCODES: progress is only reported where there is something
 * real to report. A fake progress bar is worse than no progress bar — it
 * teaches the user that the number means nothing, and then the one tool with a
 * genuine 40-second scan gets ignored too. So:
 *  - Instant tools (`sprang_node`, `sprang_query`, `sprang_health`, …) get no
 *    reporter at all; they return before a client could paint a spinner.
 *  - Tools with real, observable phase boundaries (`sprang_context`: load the
 *    graph, then retrieve, then rank) call `report()` at those boundaries.
 *  - Tools that are one opaque blocking call into git (`sprang_coupled`,
 *    `sprang_traps`, `sprang_owners` all funnel into a single `git log` walk
 *    whose duration is unknown and whose internals emit nothing) get exactly
 *    one `indeterminate()` at the start and nothing afterwards. There is no
 *    honest intermediate number to send, and inventing `total: 100` and
 *    stepping it on a timer would be a lie about work that has not happened.
 */
export class ProgressReporter {
  private counter = 0;

  private constructor(
    private readonly token: string | number | undefined,
    private readonly send: SendProgress
  ) {}

  static from(token: string | number | undefined, send: SendProgress): ProgressReporter {
    return new ProgressReporter(token, send);
  }

  /** A reporter that can never emit. Used where a client asked for nothing. */
  static disabled(): ProgressReporter {
    return new ProgressReporter(undefined, async () => undefined);
  }

  get enabled(): boolean {
    return this.token !== undefined;
  }

  /** How many notifications this reporter has actually put on the wire. */
  get sent(): number {
    return this.counter;
  }

  /**
   * Report a definite step. `progress` must increase across a single token;
   * callers pass ascending values and this does not reorder them.
   */
  async report(progress: number, total: number | undefined, message: string): Promise<void> {
    if (this.token === undefined) return;
    const params: ProgressNotificationParams = {
      progressToken: this.token,
      progress,
      message,
    };
    if (total !== undefined) params.total = total;
    this.counter += 1;
    try {
      await this.send(params);
    } catch {
      // A tool result must never depend on a notification being deliverable.
    }
  }

  /**
   * A single "working" ping with no `total`.
   *
   * The spec explicitly allows omitting `total`, and that is what "indeterminate"
   * means on the wire: the client shows a spinner rather than a bar. This is the
   * honest shape for a blocking `git log` whose length nobody knows.
   */
  async indeterminate(message: string): Promise<void> {
    await this.report(0, undefined, message);
  }
}

// ─── Elicitation ─────────────────────────────────────────────────────────────

/**
 * The two field shapes Sprang asks for: free text, and a closed choice.
 *
 * Spelled out rather than reusing the SDK's `PrimitiveSchemaDefinition` union
 * so the helpers below can be driven by a plain test double. Both branches are
 * deliberately assignable to the SDK's union — free text to its string variant,
 * the choice to its enum variant — so passing the real `Server` still typechecks.
 */
export type ElicitField =
  | { type: 'string'; title?: string; description?: string; default?: string }
  | {
      type: 'string';
      title?: string;
      description?: string;
      enum: string[];
      enumNames?: string[];
      default?: string;
    };

export interface ElicitParams {
  message: string;
  requestedSchema: {
    type: 'object';
    properties: Record<string, ElicitField>;
    required?: string[];
  };
}

export interface ElicitOutcome {
  action: string;
  content?: Record<string, unknown> | undefined;
}

/** The slice of the SDK `Server` the elicit helpers need. */
export interface ElicitCapableServer {
  getClientCapabilities(): { elicitation?: unknown } | undefined;
  elicitInput(params: ElicitParams): Promise<ElicitOutcome>;
}

/**
 * Did the client declare `elicitation` during `initialize`?
 *
 * Every elicitation path is gated on this. Calling `elicitInput` on a client
 * that never declared support is a protocol violation the SDK will throw on,
 * and — far worse in practice — on a client that declared it but has no UI, the
 * request hangs until the request timeout with the user staring at nothing.
 * Undeclared means fall straight through to the pre-existing behaviour, with no
 * message, no warning and no wire traffic.
 */
export function clientSupportsElicitation(server: ElicitCapableServer): boolean {
  const capabilities = server.getClientCapabilities();
  return capabilities !== undefined && capabilities.elicitation !== undefined;
}

/**
 * `sprang_annotate` was called with no `content`.
 *
 * A team annotation is prose a *person* writes — the whole point of the
 * annotations directory is that it holds knowledge the graph cannot derive. So
 * when the body is missing, asking beats both failing (the agent retries with
 * text it invented) and writing an empty file.
 *
 * @returns the text the user typed, or `null` if they declined, cancelled, or
 *          the client cannot be asked. `null` means "take the old path".
 */
export async function elicitAnnotationContent(
  server: ElicitCapableServer,
  nodeId: string
): Promise<string | null> {
  if (!clientSupportsElicitation(server)) return null;
  try {
    const result = await server.elicitInput({
      message:
        `Sprang is about to write a team annotation for \`${nodeId}\` but no content was ` +
        'provided. What should it say? (This is committed with the repository and is read ' +
        'by both humans and agents.)',
      requestedSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            title: 'Annotation',
            description: 'What future readers of this node need to know.',
          },
        },
        required: ['content'],
      },
    });
    if (result.action !== 'accept') return null;
    const content = result.content?.['content'];
    if (typeof content !== 'string' || content.trim() === '') return null;
    return content;
  } catch {
    // Timeout, rejection, malformed answer: fall back, never fail the tool.
    return null;
  }
}

/** What the human said about shipping a change with unread high-risk files. */
export type ProceedDecision = 'proceed' | 'stop';

/**
 * `sprang_review` found unread files at `risk_score >= 0.8`.
 *
 * This is the one Sprang result that is a judgement call rather than a fact.
 * "You changed `charge` and never opened `RefundJob` (risk 0.86)" can be
 * entirely deliberate — or it can be the partial-completion failure the review
 * tool exists to catch, and the model is the *last* party who should get to
 * decide which, since it is the one that would be marking its own homework.
 *
 * Only fires at ≥ 0.8, and only on `gaps_found`. Any looser threshold and the
 * prompt appears on routine changes, users learn to dismiss it, and it stops
 * meaning anything.
 *
 * @returns the decision, or `null` when the client cannot be asked — in which
 *          case the review result is returned unchanged, exactly as today.
 */
export async function elicitReviewProceed(
  server: ElicitCapableServer,
  files: readonly string[]
): Promise<ProceedDecision | null> {
  if (!clientSupportsElicitation(server)) return null;
  if (files.length === 0) return null;
  // Named, not counted: "3 high-risk files" is not actionable, `RefundJob.ts` is.
  const named = files.slice(0, 5).join(', ');
  const more = files.length > 5 ? ` (and ${files.length - 5} more)` : '';
  try {
    const result = await server.elicitInput({
      message:
        `This change impacts high-risk files that were never opened: ${named}${more}. ` +
        'Proceed anyway, or stop and review them first?',
      requestedSchema: {
        type: 'object',
        properties: {
          decision: {
            type: 'string',
            title: 'Proceed?',
            enum: ['proceed', 'stop'],
            enumNames: ['Proceed anyway', 'Stop and review'],
            description: 'Whether to continue without reading the listed files.',
          },
        },
        required: ['decision'],
      },
    });
    if (result.action !== 'accept') return null;
    const decision = result.content?.['decision'];
    return decision === 'proceed' || decision === 'stop' ? decision : null;
  } catch {
    return null;
  }
}

/** Files a review flagged as unread and dangerous enough to ask about. */
export const HIGH_RISK_THRESHOLD = 0.8;

export interface ReviewLike {
  verdict?: unknown;
  unread?: unknown;
}

/**
 * Pull the ≥ 0.8 unread paths out of a `sprang_review` result.
 *
 * Defensive about shape because the same handler serialises error payloads
 * through this path, and an error object has no `unread` at all.
 */
export function highRiskUnreadFiles(result: ReviewLike): string[] {
  if (result.verdict !== 'gaps_found' || !Array.isArray(result.unread)) return [];
  const files: string[] = [];
  for (const entry of result.unread) {
    if (entry === null || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const risk = record['risk_score'];
    const path = record['path'];
    if (typeof risk === 'number' && risk >= HIGH_RISK_THRESHOLD && typeof path === 'string') {
      files.push(path);
    }
  }
  return files;
}
