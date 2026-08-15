import { describe, it, expect } from 'vitest';
import { extractEventRefs, linkEvents } from '../../src/artifacts/events.js';
import type { EventRef } from '../../src/artifacts/events.js';

const topics = (refs: EventRef[]): string[] => refs.map((r) => r.topic);

// ─── publishes ────────────────────────────────────────────────────────────────

describe('extractEventRefs — publishers', () => {
  it("detects a bare emit('topic')", () => {
    const refs = extractEventRefs('src/order.ts', "emit('order.created');");
    expect(refs).toEqual([
      {
        topic: 'order.created',
        file: 'src/order.ts',
        line: 1,
        role: 'publish',
        confidence: 'literal',
        source: 'emit',
      },
    ]);
  });

  it('detects emitter.emit("topic") on a receiver', () => {
    const refs = extractEventRefs('src/bus.ts', 'emitter.emit("user.updated", payload);');
    expect(topics(refs)).toEqual(['user.updated']);
    expect(refs[0]?.role).toBe('publish');
  });

  it("detects publish('topic')", () => {
    const refs = extractEventRefs('src/bus.ts', "bus.publish('invoice.paid', data);");
    expect(topics(refs)).toEqual(['invoice.paid']);
    expect(refs[0]?.role).toBe('publish');
  });

  it("detects dispatch('topic')", () => {
    const refs = extractEventRefs('src/store.ts', "store.dispatch('cart/clear');");
    expect(topics(refs)).toEqual(['cart/clear']);
    expect(refs[0]?.role).toBe('publish');
  });

  it("detects send('topic')", () => {
    const refs = extractEventRefs('src/mq.ts', "producer.send('orders', msg);");
    expect(topics(refs)).toEqual(['orders']);
    expect(refs[0]?.role).toBe('publish');
  });
});

// ─── subscribes ───────────────────────────────────────────────────────────────

describe('extractEventRefs — subscribers', () => {
  it("detects on('topic')", () => {
    const refs = extractEventRefs('src/listen.ts', "emitter.on('order.created', handler);");
    expect(topics(refs)).toEqual(['order.created']);
    expect(refs[0]?.role).toBe('subscribe');
  });

  it("detects addEventListener('topic')", () => {
    const refs = extractEventRefs('src/dom.ts', "window.addEventListener('resize', fn);");
    expect(topics(refs)).toEqual(['resize']);
    expect(refs[0]?.role).toBe('subscribe');
  });

  it("detects subscribe('topic')", () => {
    const refs = extractEventRefs('src/sub.ts', "pubsub.subscribe('invoice.paid', fn);");
    expect(refs[0]?.role).toBe('subscribe');
  });

  it("detects handle('topic')", () => {
    const refs = extractEventRefs('src/router.ts', "router.handle('job.retry', fn);");
    expect(topics(refs)).toEqual(['job.retry']);
    expect(refs[0]?.role).toBe('subscribe');
  });

  it('detects the @subscriber decorator form', () => {
    const refs = extractEventRefs('src/handlers.ts', "@subscriber('payment.failed')\nclass H {}");
    expect(topics(refs)).toEqual(['payment.failed']);
    expect(refs[0]?.role).toBe('subscribe');
  });

  it('detects the python @on_event decorator form', () => {
    const refs = extractEventRefs('app/handlers.py', '@on_event("startup")\ndef boot():\n    pass');
    expect(topics(refs)).toEqual(['startup']);
    expect(refs[0]?.role).toBe('subscribe');
  });
});

// ─── message queues ───────────────────────────────────────────────────────────

describe('extractEventRefs — message queues', () => {
  it('detects channel.basic_publish(routing_key=...) and prefers it over the exchange arg', () => {
    const src = "channel.basic_publish(exchange='events', routing_key='user.signup', body=b)";
    const refs = extractEventRefs('app/amqp.py', src);
    expect(topics(refs)).toEqual(['user.signup']);
    expect(refs[0]?.role).toBe('publish');
    expect(refs[0]?.source).toBe('basic_publish:routing_key');
  });

  it("detects consumer.subscribe(['a', 'b']) as two topics", () => {
    const refs = extractEventRefs('src/kafka.ts', "consumer.subscribe(['orders', 'payments']);");
    expect(topics(refs)).toEqual(['orders', 'payments']);
    expect(refs.every((r) => r.role === 'subscribe')).toBe(true);
    expect(refs.every((r) => r.confidence === 'literal')).toBe(true);
  });

  it('detects a topic= keyword argument', () => {
    const refs = extractEventRefs('app/producer.py', "producer.send(topic='metrics.raw', value=v)");
    expect(topics(refs)).toEqual(['metrics.raw']);
    expect(refs[0]?.confidence).toBe('literal');
  });
});

// ─── confidence ───────────────────────────────────────────────────────────────

describe('extractEventRefs — confidence', () => {
  it('marks quoted topics as literal', () => {
    const refs = extractEventRefs('src/a.ts', "emit('a.b');");
    expect(refs[0]?.confidence).toBe('literal');
  });

  it('records a variable topic as dynamic without dropping it', () => {
    const refs = extractEventRefs('src/a.ts', 'emitter.emit(eventName, payload);');
    expect(refs).toHaveLength(1);
    expect(refs[0]?.confidence).toBe('dynamic');
    expect(refs[0]?.topic).toBe('eventName');
  });

  it('records a template-literal topic as dynamic with the expression text', () => {
    const refs = extractEventRefs('src/a.ts', 'emit(`user.${id}.updated`);');
    expect(refs[0]?.confidence).toBe('dynamic');
    expect(refs[0]?.topic).toBe('`user.${id}.updated`');
  });

  it('records a member-expression topic as dynamic', () => {
    const refs = extractEventRefs('src/a.ts', 'emit(EVENTS.ORDER_CREATED);');
    expect(refs[0]?.confidence).toBe('dynamic');
    expect(refs[0]?.topic).toBe('EVENTS.ORDER_CREATED');
  });
});

// ─── noise control ────────────────────────────────────────────────────────────

describe('extractEventRefs — noise control', () => {
  it('skips matches inside // line comments', () => {
    const src = ["// emit('ghost.topic');", "emit('real.topic');"].join('\n');
    expect(topics(extractEventRefs('src/a.ts', src))).toEqual(['real.topic']);
  });

  it('skips matches inside /* block */ comments', () => {
    const src = "/* subscribe('ghost') */ subscribe('real');";
    expect(topics(extractEventRefs('src/a.ts', src))).toEqual(['real']);
  });

  it('skips matches inside # comments in Python', () => {
    const src = ['# emit("ghost")', 'emit("real")'].join('\n');
    expect(topics(extractEventRefs('app/a.py', src))).toEqual(['real']);
  });

  it('ignores function/def definitions of the same names', () => {
    const src = ['function handle(req) {}', 'def on_event(x): pass'].join('\n');
    expect(extractEventRefs('src/a.ts', src)).toEqual([]);
  });

  it('ignores calls with no arguments', () => {
    expect(extractEventRefs('src/a.ts', 'emitter.emit();')).toEqual([]);
  });

  it('ignores an empty-string topic', () => {
    expect(extractEventRefs('src/a.ts', "emit('');")).toEqual([]);
  });

  it('reports correct 1-based line numbers', () => {
    const src = ['const a = 1;', '', "emit('late.topic');"].join('\n');
    expect(extractEventRefs('src/a.ts', src)[0]?.line).toBe(3);
  });

  it('keeps duplicate refs to the same topic within one file', () => {
    const src = ["emit('dup');", "emit('dup');"].join('\n');
    const refs = extractEventRefs('src/a.ts', src);
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.line)).toEqual([1, 2]);
  });

  it('returns [] for empty input', () => {
    expect(extractEventRefs('src/a.ts', '')).toEqual([]);
  });

  it('returns [] for a file with no matches', () => {
    expect(extractEventRefs('src/a.ts', 'export const sum = (a: number, b: number) => a + b;')).toEqual([]);
  });
});

// ─── linkEvents ───────────────────────────────────────────────────────────────

describe('linkEvents', () => {
  it('returns [] for no refs', () => {
    expect(linkEvents([])).toEqual([]);
  });

  it('joins a publisher to a subscriber on an exact topic match', () => {
    const refs = [
      ...extractEventRefs('src/pub.ts', "emit('order.created');"),
      ...extractEventRefs('src/sub.ts', "on('order.created', handler);"),
    ];
    expect(linkEvents(refs)).toEqual([
      {
        topic: 'order.created',
        publishers: ['src/pub.ts'],
        subscribers: ['src/sub.ts'],
        orphanedPublish: false,
        orphanedSubscribe: false,
      },
    ]);
  });

  it('flags orphanedPublish when nobody listens', () => {
    const links = linkEvents(extractEventRefs('src/pub.ts', "emit('nobody.listens');"));
    expect(links[0]?.orphanedPublish).toBe(true);
    expect(links[0]?.orphanedSubscribe).toBe(false);
    expect(links[0]?.subscribers).toEqual([]);
  });

  it('flags orphanedSubscribe when nobody publishes', () => {
    const links = linkEvents(extractEventRefs('src/sub.ts', "on('nobody.publishes', fn);"));
    expect(links[0]?.orphanedSubscribe).toBe(true);
    expect(links[0]?.orphanedPublish).toBe(false);
    expect(links[0]?.publishers).toEqual([]);
  });

  it('catches the classic typo: publisher and subscriber differ by one character', () => {
    const refs = [
      ...extractEventRefs('src/pub.ts', "emit('order.created');"),
      ...extractEventRefs('src/sub.ts', "on('order.crated', fn);"),
    ];
    const links = linkEvents(refs);
    expect(links.map((l) => [l.topic, l.orphanedPublish, l.orphanedSubscribe])).toEqual([
      ['order.crated', false, true],
      ['order.created', true, false],
    ]);
  });

  it('is case-sensitive so differently-cased topics do not silently join', () => {
    const refs = [
      ...extractEventRefs('src/pub.ts', "emit('Order.Created');"),
      ...extractEventRefs('src/sub.ts', "on('order.created', fn);"),
    ];
    expect(linkEvents(refs)).toHaveLength(2);
  });

  it('dedupes files and sorts publishers, subscribers and topics', () => {
    const refs = [
      ...extractEventRefs('src/z.ts', "emit('t');\nemit('t');"),
      ...extractEventRefs('src/a.ts', "emit('t');"),
      ...extractEventRefs('src/b.ts', "on('t', fn);"),
      ...extractEventRefs('src/a.ts', "emit('another');"),
    ];
    const links = linkEvents(refs);
    expect(links.map((l) => l.topic)).toEqual(['another', 't']);
    expect(links[1]?.publishers).toEqual(['src/a.ts', 'src/z.ts']);
    expect(links[1]?.subscribers).toEqual(['src/b.ts']);
  });

  it('surfaces dynamic topics but never flags them as orphans', () => {
    const refs = extractEventRefs('src/a.ts', 'emit(eventName);');
    const links = linkEvents(refs);
    expect(links).toHaveLength(1);
    expect(links[0]?.topic).toBe('eventName');
    expect(links[0]?.orphanedPublish).toBe(false);
    expect(links[0]?.orphanedSubscribe).toBe(false);
  });

  it('never joins a dynamic expression to a same-named literal topic', () => {
    const refs: EventRef[] = [
      { topic: 'a', file: 'p.ts', line: 1, role: 'publish', confidence: 'literal', source: 'emit' },
      { topic: 'a', file: 's.ts', line: 1, role: 'subscribe', confidence: 'dynamic', source: 'on' },
    ];
    const links = linkEvents(refs);
    expect(links).toHaveLength(2);
    const literal = links.find((l) => l.publishers.includes('p.ts'));
    expect(literal?.orphanedPublish).toBe(true);
  });

  it('links a cross-language producer/consumer pair', () => {
    const refs = [
      ...extractEventRefs('app/amqp.py', "channel.basic_publish(exchange='e', routing_key='user.signup')"),
      ...extractEventRefs('src/worker.ts', "consumer.subscribe(['user.signup']);"),
    ];
    const links = linkEvents(refs);
    expect(links).toHaveLength(1);
    expect(links[0]?.publishers).toEqual(['app/amqp.py']);
    expect(links[0]?.subscribers).toEqual(['src/worker.ts']);
    expect(links[0]?.orphanedPublish).toBe(false);
  });

  it('handles a mixed graph with both orphan directions at once', () => {
    const refs = [
      ...extractEventRefs('src/pub.ts', "emit('linked');\nemit('only.published');"),
      ...extractEventRefs('src/sub.ts', "on('linked', fn);\non('only.subscribed', fn);"),
    ];
    const links = linkEvents(refs);
    expect(links.map((l) => [l.topic, l.orphanedPublish, l.orphanedSubscribe])).toEqual([
      ['linked', false, false],
      ['only.published', true, false],
      ['only.subscribed', false, true],
    ]);
  });
});
