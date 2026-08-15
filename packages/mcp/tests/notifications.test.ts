/**
 * Subscriptions, progress and elicitation.
 *
 * All three are *optional* protocol surface, which makes the most important
 * test in this file the boring one at the bottom: a client that declares
 * nothing and subscribes to nothing must see byte-identical behaviour to the
 * server as it was before any of this existed. Everything above it pins the
 * parts that are easy to get subtly wrong — a debounce that fires twice, a
 * watcher that outlives its subscription and keeps a stdio server alive, an
 * elicitation attempted against a client that cannot answer it.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import {
  ResourceSubscriptionManager,
  ProgressReporter,
  progressTokenOf,
  clientSupportsElicitation,
  elicitAnnotationContent,
  elicitReviewProceed,
  highRiskUnreadFiles,
  HIGH_RISK_THRESHOLD,
  type ElicitCapableServer,
  type ElicitParams,
  type ElicitOutcome,
  type ProgressNotificationParams,
  type ResourceNotifier,
  type WatchFactory,
  type WatchHandle,
} from '../src/notifications.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeRoot(tag: string): string {
  const dir = join(tmpdir(), `sprang-notif-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(dir, '.sprang'), { recursive: true });
  return dir;
}

interface Recorder extends ResourceNotifier {
  updated: string[];
  listChanged: number;
}

function recordingNotifier(): Recorder {
  const updated: string[] = [];
  const state = {
    updated,
    listChanged: 0,
    async sendResourceUpdated(params: { uri: string }): Promise<void> {
      updated.push(params.uri);
    },
    async sendResourceListChanged(): Promise<void> {
      state.listChanged += 1;
    },
  };
  return state;
}

/** A watch factory whose trigger the test drives by hand. */
function manualWatch(): {
  factory: WatchFactory;
  fire: (filename: string | null) => void;
  fail: () => void;
  closes: number;
  created: number;
} {
  const listeners: Array<(f: string | null) => void> = [];
  const errors: Array<(e: unknown) => void> = [];
  const state = {
    closes: 0,
    created: 0,
    factory: ((_dir, onChange, onError): WatchHandle => {
      state.created += 1;
      listeners.push(onChange);
      errors.push(onError);
      return {
        close: () => {
          state.closes += 1;
        },
      };
    }) as WatchFactory,
    fire: (filename: string | null) => {
      for (const l of listeners) l(filename);
    },
    fail: () => {
      for (const e of errors) e(new Error('inotify watch limit reached'));
    },
  };
  return state;
}

const GRAPH = 'knowledge-graph.json';
const REPORT = 'SPRANG_REPORT.md';

function paths(root: string): { graphPath: string; reportPath: string } {
  return {
    graphPath: join(root, '.sprang', GRAPH),
    reportPath: join(root, '.sprang', REPORT),
  };
}

/** A schema-valid graph, so the whole-server tests exercise the real paths. */
function validGraph(stamp: number): Record<string, unknown> {
  return {
    version: '1.0.0',
    generated_at: new Date(stamp * 1000).toISOString(),
    project_root: '/test',
    project_name: 'test',
    phase: 'complete',
    nodes: [
      { id: 'file:src/auth.ts', type: 'file', label: 'auth.ts', filePath: 'src/auth.ts', risk_score: 0.9 },
    ],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: {
      node_count: 1,
      edge_count: 0,
      risk_summary: { high: 1, medium: 0, low: 0 },
      smell_summary: {},
      generated_at: new Date(stamp * 1000).toISOString(),
    },
  };
}

/** Rewrite the graph with a distinct mtime, since mtimeMs can repeat inside a ms. */
let mtimeCursor = 1_700_000_000;
function touchGraph(root: string): void {
  const p = join(root, '.sprang', GRAPH);
  writeFileSync(p, JSON.stringify(validGraph(mtimeCursor)));
  mtimeCursor += 60;
  utimesSync(p, mtimeCursor, mtimeCursor);
}

function writeReport(root: string): void {
  const p = join(root, '.sprang', REPORT);
  writeFileSync(p, `# report ${mtimeCursor}\n`);
  mtimeCursor += 60;
  utimesSync(p, mtimeCursor, mtimeCursor);
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─── Subscription registry ───────────────────────────────────────────────────

describe('resources/subscribe registry', () => {
  function make(): { mgr: ResourceSubscriptionManager; watch: ReturnType<typeof manualWatch>; root: string } {
    const root = makeRoot('reg');
    const watch = manualWatch();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier: recordingNotifier(),
      watchFactory: watch.factory,
      debounceMs: 5,
    });
    return { mgr, watch, root };
  }

  it('round-trips a subscribe and an unsubscribe', () => {
    const { mgr } = make();
    expect(mgr.has('sprang://health')).toBe(false);
    mgr.subscribe('sprang://health');
    expect(mgr.has('sprang://health')).toBe(true);
    expect(mgr.list()).toEqual(['sprang://health']);
    mgr.unsubscribe('sprang://health');
    expect(mgr.has('sprang://health')).toBe(false);
    expect(mgr.size).toBe(0);
    mgr.close();
  });

  it('is idempotent: subscribing twice tracks one URI', () => {
    const { mgr, watch } = make();
    mgr.subscribe('sprang://health');
    mgr.subscribe('sprang://health');
    expect(mgr.size).toBe(1);
    expect(watch.created).toBe(1);
    mgr.close();
  });

  it('ignores an unsubscribe for a URI that was never subscribed', () => {
    const { mgr } = make();
    mgr.subscribe('sprang://health');
    mgr.unsubscribe('sprang://suggestions');
    expect(mgr.list()).toEqual(['sprang://health']);
    mgr.close();
  });

  it('lists subscriptions in a deterministic order', () => {
    const { mgr } = make();
    mgr.subscribe('sprang://suggestions');
    mgr.subscribe('sprang://health');
    mgr.subscribe('sprang://graph/stats');
    expect(mgr.list()).toEqual(['sprang://graph/stats', 'sprang://health', 'sprang://suggestions']);
    mgr.close();
  });

  it('creates no watcher at all until something subscribes', () => {
    const { mgr, watch } = make();
    expect(mgr.watchMode()).toBe('idle');
    expect(watch.created).toBe(0);
    mgr.close();
  });

  it('starts an fs watcher on the first subscribe only', () => {
    const { mgr, watch } = make();
    mgr.subscribe('sprang://health');
    mgr.subscribe('sprang://report');
    expect(mgr.watchMode()).toBe('fs');
    expect(watch.created).toBe(1);
    mgr.close();
  });

  it('tears the watcher down when the last subscription goes away', () => {
    const { mgr, watch } = make();
    mgr.subscribe('sprang://health');
    mgr.subscribe('sprang://report');
    mgr.unsubscribe('sprang://health');
    expect(mgr.watchMode()).toBe('fs');
    mgr.unsubscribe('sprang://report');
    expect(mgr.watchMode()).toBe('idle');
    expect(watch.closes).toBe(1);
    mgr.close();
  });

  it('close() drops every subscription and every handle, and is idempotent', () => {
    const { mgr, watch } = make();
    mgr.subscribe('sprang://health');
    mgr.close();
    mgr.close();
    expect(mgr.size).toBe(0);
    expect(mgr.watchMode()).toBe('idle');
    expect(watch.closes).toBe(1);
  });

  it('refuses to subscribe after close, so a shutdown cannot resurrect a watcher', () => {
    const { mgr, watch } = make();
    mgr.close();
    mgr.subscribe('sprang://health');
    expect(mgr.size).toBe(0);
    expect(watch.created).toBe(0);
    expect(mgr.watchMode()).toBe('idle');
  });
});

// ─── Notification emission ───────────────────────────────────────────────────

describe('notifications/resources/updated', () => {
  function make(tag: string): {
    mgr: ResourceSubscriptionManager;
    watch: ReturnType<typeof manualWatch>;
    notifier: Recorder;
    root: string;
  } {
    const root = makeRoot(tag);
    touchGraph(root);
    const watch = manualWatch();
    const notifier = recordingNotifier();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      watchFactory: watch.factory,
      debounceMs: 20,
    });
    return { mgr, watch, notifier, root };
  }

  it('emits exactly one update for a subscribed URI when the graph changes', async () => {
    const { mgr, watch, notifier, root } = make('one');
    mgr.subscribe('sprang://health');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://health']);
    mgr.close();
  });

  it('collapses a burst of writes into a single notification', async () => {
    const { mgr, watch, notifier, root } = make('burst');
    mgr.subscribe('sprang://health');
    for (let i = 0; i < 6; i += 1) {
      touchGraph(root);
      watch.fire(GRAPH);
    }
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://health']);
    expect(mgr.stats.flushes).toBe(1);
    mgr.close();
  });

  it('emits again for a change that arrives after the debounce window closed', async () => {
    const { mgr, watch, notifier, root } = make('twice');
    mgr.subscribe('sprang://health');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://health', 'sprang://health']);
    mgr.close();
  });

  it('sends nothing for a URI nobody subscribed to', async () => {
    const { mgr, watch, notifier, root } = make('unsub');
    mgr.subscribe('sprang://health');
    mgr.unsubscribe('sprang://health');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual([]);
    mgr.close();
  });

  it('sends nothing at all when there are no subscriptions', async () => {
    const { mgr, watch, notifier, root } = make('none');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual([]);
    expect(notifier.listChanged).toBe(0);
    mgr.close();
  });

  it('notifies templated node/file/why URIs, which are graph-derived too', async () => {
    const { mgr, watch, notifier, root } = make('templated');
    mgr.subscribe('sprang://node/function:src/a.ts:go');
    mgr.subscribe('sprang://file/src/a.ts');
    mgr.subscribe('sprang://why/file:src/a.ts');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated.sort()).toEqual([
      'sprang://file/src/a.ts',
      'sprang://node/function:src/a.ts:go',
      'sprang://why/file:src/a.ts',
    ]);
    mgr.close();
  });

  it('does not notify sprang://report when only the graph changed', async () => {
    const { mgr, watch, notifier, root } = make('reportquiet');
    mgr.subscribe('sprang://report');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual([]);
    mgr.close();
  });

  it('notifies sprang://report when the report itself changes', async () => {
    const { mgr, watch, notifier, root } = make('reportloud');
    writeReport(root);
    watch.fire(REPORT);
    await wait(60);
    // Not subscribed yet: still silent.
    expect(notifier.updated).toEqual([]);
    mgr.subscribe('sprang://report');
    writeReport(root);
    watch.fire(REPORT);
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://report']);
    mgr.close();
  });

  it('re-stats both files when the platform gives no filename with the event', async () => {
    const { mgr, watch, notifier, root } = make('nofilename');
    mgr.subscribe('sprang://health');
    touchGraph(root);
    watch.fire(null);
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://health']);
    mgr.close();
  });

  it('ignores an event when the mtime did not actually move', async () => {
    const { mgr, watch, notifier } = make('nochange');
    mgr.subscribe('sprang://health');
    watch.fire(GRAPH);
    watch.fire(GRAPH);
    await wait(60);
    expect(notifier.updated).toEqual([]);
    mgr.close();
  });

  it('sends list_changed the first time SPRANG_REPORT.md appears', async () => {
    const { mgr, watch, notifier, root } = make('listchanged');
    mgr.subscribe('sprang://health');
    writeReport(root);
    watch.fire(REPORT);
    await wait(60);
    expect(notifier.listChanged).toBe(1);
    mgr.close();
  });

  it('does not repeat list_changed when an existing report is merely rewritten', async () => {
    const root = makeRoot('listchanged2');
    touchGraph(root);
    writeReport(root);
    const watch = manualWatch();
    const notifier = recordingNotifier();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      watchFactory: watch.factory,
      debounceMs: 20,
    });
    mgr.subscribe('sprang://report');
    writeReport(root);
    watch.fire(REPORT);
    await wait(60);
    expect(notifier.updated).toEqual(['sprang://report']);
    expect(notifier.listChanged).toBe(0);
    mgr.close();
  });

  it('drops a pending debounced notification when the server shuts down mid-window', async () => {
    const { mgr, watch, notifier, root } = make('shutdown');
    mgr.subscribe('sprang://health');
    touchGraph(root);
    watch.fire(GRAPH);
    expect(mgr.hasPendingFlush()).toBe(true);
    mgr.close();
    expect(mgr.hasPendingFlush()).toBe(false);
    await wait(60);
    expect(notifier.updated).toEqual([]);
  });

  it('swallows a notifier that rejects, because a push must never break the server', async () => {
    const root = makeRoot('reject');
    touchGraph(root);
    const watch = manualWatch();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier: {
        sendResourceUpdated: async () => {
          throw new Error('client hung up');
        },
        sendResourceListChanged: async () => {
          throw new Error('client hung up');
        },
      },
      watchFactory: watch.factory,
      debounceMs: 20,
    });
    mgr.subscribe('sprang://health');
    touchGraph(root);
    watch.fire(GRAPH);
    await wait(60);
    expect(mgr.stats.flushes).toBe(1);
    expect(mgr.watchMode()).toBe('fs');
    mgr.close();
  });
});

// ─── Fallback path ───────────────────────────────────────────────────────────

describe('polled fallback when fs.watch is unavailable', () => {
  it('falls back to polling when the watch factory throws', async () => {
    const root = makeRoot('poll');
    touchGraph(root);
    const notifier = recordingNotifier();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      debounceMs: 5,
      pollMs: 10,
      watchFactory: () => {
        throw new Error('ENOSYS: fs.watch is not available on this filesystem');
      },
    });
    mgr.subscribe('sprang://health');
    expect(mgr.watchMode()).toBe('poll');
    touchGraph(root);
    await wait(120);
    expect(notifier.updated).toEqual(['sprang://health']);
    mgr.close();
  });

  it('demotes to polling when the watcher errors after construction', async () => {
    const root = makeRoot('demote');
    touchGraph(root);
    const watch = manualWatch();
    const notifier = recordingNotifier();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      watchFactory: watch.factory,
      debounceMs: 5,
      pollMs: 10,
    });
    mgr.subscribe('sprang://health');
    expect(mgr.watchMode()).toBe('fs');
    watch.fail();
    expect(mgr.watchMode()).toBe('poll');
    expect(watch.closes).toBe(1);
    touchGraph(root);
    await wait(120);
    expect(notifier.updated).toEqual(['sprang://health']);
    mgr.close();
  });

  it('clears the poll interval on unsubscribe-all, leaving no live timer', async () => {
    const root = makeRoot('pollclear');
    touchGraph(root);
    const notifier = recordingNotifier();
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      debounceMs: 5,
      pollMs: 10,
      watchFactory: () => {
        throw new Error('no fs.watch here');
      },
    });
    mgr.subscribe('sprang://health');
    expect(mgr.watchMode()).toBe('poll');
    mgr.unsubscribe('sprang://health');
    expect(mgr.watchMode()).toBe('idle');
    // The proof that the interval is really gone: a change after teardown
    // produces nothing, however long we wait.
    touchGraph(root);
    await wait(80);
    expect(notifier.updated).toEqual([]);
  });

  it('leaves no lingering handles behind after close', async () => {
    const root = makeRoot('handles');
    touchGraph(root);
    const activeBefore = process.getActiveResourcesInfo?.() ?? [];
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier: recordingNotifier(),
      debounceMs: 5,
      pollMs: 10,
    });
    mgr.subscribe('sprang://health');
    mgr.close();
    await wait(40);
    const activeAfter = process.getActiveResourcesInfo?.() ?? [];
    const count = (list: readonly string[], kind: string): number =>
      list.filter((entry) => entry.toLowerCase().includes(kind)).length;
    expect(count(activeAfter, 'watch')).toBeLessThanOrEqual(count(activeBefore, 'watch'));
    expect(count(activeAfter, 'timeout')).toBeLessThanOrEqual(count(activeBefore, 'timeout') + 0);
    expect(mgr.watchMode()).toBe('idle');
  });

  it('detects a real change through the real fs.watch factory', async () => {
    const root = makeRoot('realwatch');
    touchGraph(root);
    const notifier = recordingNotifier();
    // No watchFactory: the production default, plus a fast poll so the
    // assertion also holds on a filesystem where inotify does nothing.
    const mgr = new ResourceSubscriptionManager({
      ...paths(root),
      notifier,
      debounceMs: 20,
      pollMs: 25,
    });
    mgr.subscribe('sprang://health');
    // Belt and braces: if fs.watch worked, we are in 'fs' mode; either way the
    // manager must notice the write.
    expect(['fs', 'poll']).toContain(mgr.watchMode());
    await wait(20);
    touchGraph(root);
    for (let i = 0; i < 40 && notifier.updated.length === 0; i += 1) {
      // A directory watch that misses the event would leave this loop empty;
      // the poll below is what makes the fallback claim testable.
      mgr.poll();
      await wait(25);
    }
    expect(notifier.updated).toContain('sprang://health');
    mgr.close();
    rmSync(root, { recursive: true, force: true });
  });
});

// ─── Progress ────────────────────────────────────────────────────────────────

describe('progress notifications', () => {
  function sink(): { sent: ProgressNotificationParams[]; send: (p: ProgressNotificationParams) => Promise<void> } {
    const sent: ProgressNotificationParams[] = [];
    return {
      sent,
      send: async (p) => {
        sent.push(p);
      },
    };
  }

  it('reads a string progressToken out of _meta', () => {
    expect(progressTokenOf({ progressToken: 'abc' })).toBe('abc');
  });

  it('reads a numeric progressToken out of _meta', () => {
    expect(progressTokenOf({ progressToken: 7 })).toBe(7);
  });

  it('returns undefined for missing, malformed or absent _meta', () => {
    expect(progressTokenOf(undefined)).toBeUndefined();
    expect(progressTokenOf(null)).toBeUndefined();
    expect(progressTokenOf({})).toBeUndefined();
    expect(progressTokenOf('nope')).toBeUndefined();
    expect(progressTokenOf({ progressToken: { nested: true } })).toBeUndefined();
  });

  it('emits nothing when no progressToken was supplied', async () => {
    const s = sink();
    const reporter = ProgressReporter.from(undefined, s.send);
    expect(reporter.enabled).toBe(false);
    await reporter.report(1, 3, 'step');
    await reporter.indeterminate('working');
    expect(s.sent).toEqual([]);
    expect(reporter.sent).toBe(0);
  });

  it('emits nothing from a disabled reporter', async () => {
    const reporter = ProgressReporter.disabled();
    await reporter.report(1, 1, 'x');
    expect(reporter.enabled).toBe(false);
    expect(reporter.sent).toBe(0);
  });

  it('emits token, progress, total and message when a token is supplied', async () => {
    const s = sink();
    const reporter = ProgressReporter.from('tok-1', s.send);
    expect(reporter.enabled).toBe(true);
    await reporter.report(1, 3, 'Graph loaded');
    expect(s.sent).toEqual([
      { progressToken: 'tok-1', progress: 1, message: 'Graph loaded', total: 3 },
    ]);
  });

  it('omits total for an indeterminate ping, which is what makes it a spinner', async () => {
    const s = sink();
    const reporter = ProgressReporter.from(42, s.send);
    await reporter.indeterminate('Reading git history…');
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]).toEqual({ progressToken: 42, progress: 0, message: 'Reading git history…' });
    expect(s.sent[0]).not.toHaveProperty('total');
  });

  it('keeps counting monotonically across several reports', async () => {
    const s = sink();
    const reporter = ProgressReporter.from('t', s.send);
    await reporter.report(0, 3, 'a');
    await reporter.report(1, 3, 'b');
    await reporter.report(3, 3, 'c');
    expect(s.sent.map((p) => p.progress)).toEqual([0, 1, 3]);
    expect(reporter.sent).toBe(3);
  });

  it('swallows a send failure so a tool result never depends on it', async () => {
    const reporter = ProgressReporter.from('t', async () => {
      throw new Error('transport closed');
    });
    await expect(reporter.report(1, 2, 'x')).resolves.toBeUndefined();
  });
});

// ─── Elicitation ─────────────────────────────────────────────────────────────

describe('elicitation', () => {
  function fakeServer(
    capabilities: { elicitation?: unknown } | undefined,
    reply: (params: ElicitParams) => Promise<ElicitOutcome>
  ): { server: ElicitCapableServer; calls: ElicitParams[] } {
    const calls: ElicitParams[] = [];
    return {
      calls,
      server: {
        getClientCapabilities: () => capabilities,
        elicitInput: async (params) => {
          calls.push(params);
          return reply(params);
        },
      },
    };
  }

  const accept = (content: Record<string, unknown>) => async (): Promise<ElicitOutcome> => ({
    action: 'accept',
    content,
  });

  it('detects the capability only when the client actually declared it', () => {
    expect(clientSupportsElicitation({ getClientCapabilities: () => undefined, elicitInput: vi.fn() })).toBe(false);
    expect(clientSupportsElicitation({ getClientCapabilities: () => ({}), elicitInput: vi.fn() })).toBe(false);
    expect(
      clientSupportsElicitation({ getClientCapabilities: () => ({ elicitation: {} }), elicitInput: vi.fn() })
    ).toBe(true);
  });

  it('never touches the wire for annotation content when the client lacks the capability', async () => {
    const { server, calls } = fakeServer({}, accept({ content: 'hello' }));
    await expect(elicitAnnotationContent(server, 'file:src/a.ts')).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns the text the user typed for a missing annotation body', async () => {
    const { server, calls } = fakeServer({ elicitation: {} }, accept({ content: 'Owned by payments.' }));
    await expect(elicitAnnotationContent(server, 'file:src/a.ts')).resolves.toBe('Owned by payments.');
    expect(calls[0]?.message).toContain('file:src/a.ts');
    expect(calls[0]?.requestedSchema.required).toEqual(['content']);
  });

  it('treats decline, cancel and an empty answer as "no answer"', async () => {
    for (const outcome of [
      { action: 'decline' },
      { action: 'cancel' },
      { action: 'accept', content: {} },
      { action: 'accept', content: { content: '   ' } },
      { action: 'accept', content: { content: 12 } },
    ] as ElicitOutcome[]) {
      const { server } = fakeServer({ elicitation: {} }, async () => outcome);
      await expect(elicitAnnotationContent(server, 'file:src/a.ts')).resolves.toBeNull();
    }
  });

  it('falls back to null when the elicitation request itself throws', async () => {
    const { server } = fakeServer({ elicitation: {} }, async () => {
      throw new Error('timed out waiting for the user');
    });
    await expect(elicitAnnotationContent(server, 'file:src/a.ts')).resolves.toBeNull();
  });

  it('never asks about a review when the client lacks the capability', async () => {
    const { server, calls } = fakeServer(undefined, accept({ decision: 'stop' }));
    await expect(elicitReviewProceed(server, ['src/a.ts'])).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('returns the human decision and names the files in the prompt', async () => {
    const { server, calls } = fakeServer({ elicitation: {} }, accept({ decision: 'stop' }));
    await expect(elicitReviewProceed(server, ['src/RefundJob.ts', 'src/Ledger.ts'])).resolves.toBe('stop');
    expect(calls[0]?.message).toContain('src/RefundJob.ts');
    expect(calls[0]?.message).toContain('src/Ledger.ts');
  });

  it('caps the named files and says how many were elided', async () => {
    const { server, calls } = fakeServer({ elicitation: {} }, accept({ decision: 'proceed' }));
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((n) => `src/${n}.ts`);
    await expect(elicitReviewProceed(server, files)).resolves.toBe('proceed');
    expect(calls[0]?.message).toContain('and 2 more');
    expect(calls[0]?.message).not.toContain('src/g.ts');
  });

  it('asks nothing when there are no high-risk files to ask about', async () => {
    const { server, calls } = fakeServer({ elicitation: {} }, accept({ decision: 'proceed' }));
    await expect(elicitReviewProceed(server, [])).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('rejects an answer that is not one of the two offered decisions', async () => {
    const { server } = fakeServer({ elicitation: {} }, accept({ decision: 'maybe' }));
    await expect(elicitReviewProceed(server, ['src/a.ts'])).resolves.toBeNull();
  });

  it('selects only gaps_found unread files at or above the 0.8 threshold', () => {
    expect(HIGH_RISK_THRESHOLD).toBe(0.8);
    const unread = [
      { path: 'src/hot.ts', risk_score: 0.86 },
      { path: 'src/edge.ts', risk_score: 0.8 },
      { path: 'src/cold.ts', risk_score: 0.79 },
      { path: 'src/none.ts' },
      null,
    ];
    expect(highRiskUnreadFiles({ verdict: 'gaps_found', unread })).toEqual([
      'src/hot.ts',
      'src/edge.ts',
    ]);
    expect(highRiskUnreadFiles({ verdict: 'looks_complete', unread })).toEqual([]);
    expect(highRiskUnreadFiles({ verdict: 'no_receipts', unread })).toEqual([]);
    expect(highRiskUnreadFiles({ error: 'GRAPH_NOT_FOUND' } as never)).toEqual([]);
  });
});

// ─── Whole-server behaviour ──────────────────────────────────────────────────

/**
 * The contract that matters most: a client that uses none of this must be
 * unaffected. The server module is imported once, wired to an in-memory
 * transport, and driven by a real SDK client declaring no capabilities at all.
 */
describe('a client that ignores subscriptions, progress and elicitation', () => {
  const root = makeRoot('server');
  let client: import('@modelcontextprotocol/sdk/client/index.js').Client;
  let mod: typeof import('../src/server.js');
  const notifications: string[] = [];

  beforeAll(async () => {
    process.env['SPRANG_MCP_NO_LISTEN'] = '1';
    process.env['SPRANG_ROOT'] = root;
    touchGraph(root);
    mod = await import('../src/server.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'plain-client', version: '1.0.0' }, { capabilities: {} });
    client.fallbackNotificationHandler = async (n) => {
      notifications.push(n.method);
    };
    await Promise.all([mod.server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    mod.subscriptions.close();
    await client.close();
    rmSync(root, { recursive: true, force: true });
  });

  it('sees the subscribe capability declared without having to use it', () => {
    const capabilities = client.getServerCapabilities();
    expect(capabilities?.resources).toEqual({ subscribe: true, listChanged: true });
  });

  it('still gets the same 14 tools', async () => {
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(14);
    expect(tools.map((t) => t.name)).toContain('sprang_context');
  });

  it('still gets the four static resources and three templates', async () => {
    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resources).toHaveLength(4);
    expect(resourceTemplates).toHaveLength(3);
  });

  it('calls a tool with no progressToken and receives no notification of any kind', async () => {
    notifications.length = 0;
    const result = await client.callTool({ name: 'sprang_health', arguments: {} });
    expect(Array.isArray(result.content)).toBe(true);
    await wait(30);
    expect(notifications).toEqual([]);
  });

  it('calls the git-history tools with no progressToken and still sees no progress', async () => {
    notifications.length = 0;
    await client.callTool({ name: 'sprang_traps', arguments: { limit: 1 } });
    await client.callTool({ name: 'sprang_context', arguments: { task: 'anything' } });
    await wait(30);
    expect(notifications.filter((m) => m === 'notifications/progress')).toEqual([]);
  });

  it('emits progress for sprang_context only when a progressToken is supplied', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { ProgressNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    client.setNotificationHandler(ProgressNotificationSchema, (n) => {
      seen.push(n.params as unknown as Record<string, unknown>);
    });
    await client.callTool(
      { name: 'sprang_context', arguments: { task: 'find the auth code' }, _meta: { progressToken: 'p1' } },
      undefined,
      { onprogress: () => undefined }
    );
    await wait(30);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // The SDK substitutes its own correlation token when `onprogress` is used;
    // what matters is that every notification carries the same one.
    const tokens = new Set(seen.map((p) => p['progressToken']));
    expect(tokens.size).toBe(1);
    expect([...tokens][0]).toBeDefined();
    expect(seen.at(-1)?.['progress']).toBe(3);
    expect(seen.at(-1)?.['total']).toBe(3);
  });

  it('sends exactly one indeterminate ping for a git-history tool', async () => {
    const seen: Array<Record<string, unknown>> = [];
    const { ProgressNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    client.setNotificationHandler(ProgressNotificationSchema, (n) => {
      seen.push(n.params as unknown as Record<string, unknown>);
    });
    await client.callTool(
      { name: 'sprang_owners', arguments: { file: 'src/nope.ts' }, _meta: { progressToken: 'p2' } },
      undefined,
      { onprogress: () => undefined }
    );
    await wait(30);
    expect(seen).toHaveLength(1);
    expect(seen[0]).not.toHaveProperty('total');
    expect(seen[0]?.['progress']).toBe(0);
  });

  it('does not attempt elicitation against a client that declared none', async () => {
    // sprang_annotate with no content on a client without `elicitation`: the
    // call must complete on the old path rather than hanging on a question
    // nobody can answer.
    const result = await client.callTool({
      name: 'sprang_annotate',
      arguments: { node_id: 'file:does/not/exist.ts' },
    });
    // It returns a normal error payload (the node does not exist in this
    // fixture graph) rather than blocking on a question nobody can answer.
    expect(JSON.stringify(result.content)).toMatch(/NODE_NOT_FOUND|GRAPH_/);
    expect(notifications).not.toContain('elicitation/create');
  });

  it('pushes resources/updated to a subscriber when the graph file changes', async () => {
    const updates: string[] = [];
    const { ResourceUpdatedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });
    await client.subscribeResource({ uri: 'sprang://health' });
    expect(mod.subscriptions.has('sprang://health')).toBe(true);
    // One write, then poll until the (500 ms) debounce window has elapsed.
    // Re-writing on every iteration would keep resetting that window — which
    // is exactly the coalescing behaviour asserted in the unit tests above.
    touchGraph(root);
    for (let i = 0; i < 30 && updates.length === 0; i += 1) {
      mod.subscriptions.poll();
      await wait(100);
    }
    expect(updates).toContain('sprang://health');
  });

  it('stops pushing after unsubscribe, and releases the watcher', async () => {
    const updates: string[] = [];
    const { ResourceUpdatedNotificationSchema } = await import('@modelcontextprotocol/sdk/types.js');
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      updates.push(n.params.uri);
    });
    await client.unsubscribeResource({ uri: 'sprang://health' });
    expect(mod.subscriptions.size).toBe(0);
    expect(mod.subscriptions.watchMode()).toBe('idle');
    touchGraph(root);
    await wait(700);
    expect(updates).toEqual([]);
  });
});
