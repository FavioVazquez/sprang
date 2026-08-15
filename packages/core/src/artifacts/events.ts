/**
 * Event / pub-sub artifact extraction.
 *
 * ## Why this exists
 *
 * A call graph is built from *direct* edges: A imports B, A calls B. Pub/sub is
 * specifically the pattern that deletes those edges on purpose. The publisher
 * says `emit('order.created')` and does not know, reference, or import a single
 * one of its consumers. The consumer says `on('order.created')` and does not
 * import the publisher. Structurally, they are two unrelated islands — and yet
 * changing one of them breaks the other.
 *
 * So the question **"who consumes what this publishes?"** is unanswerable from a
 * code graph and answerable in about thirty lines of string matching. That is
 * the whole justification for this module: the value-to-complexity ratio is
 * absurd.
 *
 * The two flags on {@link EventLink} are the point:
 *
 * - `orphanedPublish` — something publishes a topic nobody listens for. Either
 *   dead code, or (much worse) a consumer that was renamed/deleted and the
 *   event now silently drops on the floor. This never throws, never fails a
 *   test, and never shows up in coverage.
 * - `orphanedSubscribe` — a handler registered for a topic nobody publishes.
 *   Usually a typo in the topic string, or a producer that was refactored to a
 *   new name. The handler simply never runs.
 *
 * Both are real, shipped-to-production bugs. Neither is findable in a call graph.
 *
 * ## Design notes
 *
 * - Purely lexical, no parsing, no I/O.
 * - Dynamic topics (`emit(eventName)`, `` emit(`user.${id}`) ``) are **recorded,
 *   never dropped and never matched**. Silently dropping them would make the
 *   orphan flags lie; treating them as literals would make them lie in the other
 *   direction. So they are surfaced with `confidence: 'dynamic'` and the
 *   expression text as the topic, and {@link linkEvents} refuses to draw orphan
 *   conclusions about them.
 * - The scanner finds `identifier(` with one simple, non-backtracking regex and
 *   then walks the argument list character by character. There is no regex here
 *   that can blow up on a pathological input.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** A single publish or subscribe site. */
export interface EventRef {
  /**
   * The topic. For `confidence: 'literal'` this is the string literal's value.
   * For `confidence: 'dynamic'` this is the raw expression text (e.g.
   * `eventName` or `` `user.${id}` ``) so a human can still act on it.
   */
  topic: string;
  file: string;
  /** 1-based line number of the call site. */
  line: number;
  role: 'publish' | 'subscribe';
  /**
   * - `literal`  — the topic was a quoted string; safe to join on.
   * - `resolved` — reserved for future constant resolution (following
   *   `EVENTS.ORDER_CREATED` back to its definition). Nothing emits this yet;
   *   it exists so that consumers written today keep working when it does.
   * - `dynamic`  — the topic is a variable or template. Reported, never joined.
   */
  confidence: 'literal' | 'resolved' | 'dynamic';
  /** The matched call shape, e.g. `emitter.emit` or `basic_publish:routing_key`. */
  source: string;
}

/** One topic, with both sides of the link and the orphan verdicts. */
export interface EventLink {
  topic: string;
  /** Deduped, sorted files that publish this topic. */
  publishers: string[];
  /** Deduped, sorted files that subscribe to this topic. */
  subscribers: string[];
  /** Published but nothing listens — dead event or deleted consumer. */
  orphanedPublish: boolean;
  /** Subscribed but nothing publishes — typo'd topic or removed producer. */
  orphanedSubscribe: boolean;
}

// ─── Vocabulary ───────────────────────────────────────────────────────────────

/**
 * Call names treated as publishing.
 *
 * `send` is included because it is the Kafka/SQS producer idiom
 * (`producer.send('topic', …)`). It is the loosest entry in this table and the
 * most likely source of a false positive; it is kept because a missed producer
 * turns a real `orphanedSubscribe` into silence, which is the worse failure.
 */
const PUBLISH_NAMES: ReadonlySet<string> = new Set([
  'emit',
  'publish',
  'dispatch',
  'send',
  'basic_publish',
]);

/** Call names treated as subscribing, including decorator forms. */
const SUBSCRIBE_NAMES: ReadonlySet<string> = new Set([
  'on',
  'addEventListener',
  'subscribe',
  'handle',
  'subscriber',
  'on_event',
]);

/**
 * Tokens that, immediately before a matched name, mean it is a *definition*
 * rather than a call site. `function handle(...)` is not a subscription.
 */
const DEFINITION_KEYWORDS: readonly string[] = ['function', 'def', 'func', 'fn', 'class', 'sub'];

/** How far into an argument list we are willing to scan, in characters. */
const MAX_ARG_SCAN = 2000;

// ─── File classification (comment style only) ────────────────────────────────

interface CommentStyle {
  line: string | null;
  block: boolean;
}

const HASH_EXTENSIONS = new Set(['py', 'pyi', 'rb', 'rake', 'sh', 'bash', 'zsh', 'yml', 'yaml', 'ex', 'exs', 'pl', 'r']);
const SLASH_EXTENSIONS = new Set([
  'js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'go', 'java', 'kt', 'kts',
  'scala', 'cs', 'c', 'h', 'cpp', 'hpp', 'rs', 'php', 'swift', 'dart', 'svelte', 'vue',
]);

function commentStyleFor(filePath: string): CommentStyle {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const slash = normalized.lastIndexOf('/');
  const base = slash === -1 ? normalized : normalized.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const ext = dot === -1 ? '' : base.slice(dot + 1);
  if (HASH_EXTENSIONS.has(ext)) return { line: '#', block: false };
  if (SLASH_EXTENSIONS.has(ext)) return { line: '//', block: true };
  return { line: null, block: false };
}

/**
 * Blank out comment bodies while preserving offsets, so line numbers stay
 * correct and commented-out `emit('x')` calls do not become findings.
 * Deliberately a cheap scanner rather than a lexer.
 */
function maskComments(content: string, style: CommentStyle): string {
  if (style.line === null && !style.block) return content;
  const out = content.split('');
  const marker = style.line;
  let i = 0;
  let quote: string | null = null;

  while (i < content.length) {
    const ch = content[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      else if (ch === '\n' && quote !== '`') quote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      i++;
      continue;
    }
    if (style.block && ch === '/' && content[i + 1] === '*') {
      let j = i + 2;
      while (j < content.length && !(content[j] === '*' && content[j + 1] === '/')) j++;
      const end = Math.min(j + 2, content.length);
      for (let k = i; k < end; k++) if (out[k] !== '\n') out[k] = ' ';
      i = end;
      continue;
    }
    if (marker !== null && content.startsWith(marker, i)) {
      let j = i;
      while (j < content.length && content[j] !== '\n') {
        out[j] = ' ';
        j++;
      }
      i = j;
      continue;
    }
    i++;
  }
  return out.join('');
}

// ─── Offset → line ────────────────────────────────────────────────────────────

/** Precomputed newline offsets, so line lookup is a binary search not a split. */
function lineStarts(content: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ─── Argument scanning ────────────────────────────────────────────────────────

/**
 * Return the text of the argument list starting just after `(` at `open`,
 * stopping at the matching `)`. Quote-aware so `emit('a)b')` does not truncate.
 * Bounded by {@link MAX_ARG_SCAN} so a missing paren cannot make us walk a
 * megabyte of minified bundle.
 */
function readArgs(content: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  const limit = Math.min(content.length, open + MAX_ARG_SCAN);
  for (let i = open; i < limit; i++) {
    const ch = content[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) return content.slice(open + 1, i);
    }
  }
  return content.slice(open + 1, limit);
}

/** Split an argument list on top-level commas, respecting quotes and nesting. */
function splitArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const ch = args[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** `'topic'` / `"topic"` → `topic`; anything else → null. Single quantifier, linear. */
const QUOTED_LITERAL = /^(['"])([^'"\n]*)\1$/;

/** Every string literal inside a fragment — used for `subscribe(['a', 'b'])`. */
const ANY_LITERAL = /(['"])([^'"\n]*)\1/g;

/** `routing_key='topic'` / `routing_key="topic"` — the AMQP publish idiom. */
const ROUTING_KEY = /routing_key\s*=\s*(['"])([^'"\n]*)\1/;

/** `topic='x'` / `destination="x"` — other common keyword-argument spellings. */
const TOPIC_KEYWORD = /\b(?:topic|event|event_name|channel|queue|destination)\s*=\s*(['"])([^'"\n]*)\1/;

interface TopicCandidate {
  topic: string;
  confidence: EventRef['confidence'];
  source: string;
}

/**
 * Work out which topic(s) a call refers to from its argument text.
 *
 * Order matters: keyword arguments win over positional ones, because
 * `channel.basic_publish(exchange='x', routing_key='order.created')` has an
 * exchange in first position and the routing key is what consumers bind to.
 */
function topicsFromArgs(args: string, callName: string): TopicCandidate[] {
  const trimmed = args.trim();
  if (trimmed.length === 0) return [];

  const routing = ROUTING_KEY.exec(trimmed);
  const routingTopic = routing?.[2];
  if (routingTopic !== undefined) {
    return [{ topic: routingTopic, confidence: 'literal', source: `${callName}:routing_key` }];
  }

  const parts = splitArgs(trimmed);
  const first = parts[0];
  if (first === undefined) return [];

  // `consumer.subscribe(['orders', 'payments'])` — an array of topics.
  if (first.startsWith('[') || first.startsWith('(')) {
    const inner = first.slice(1, -1);
    const found: TopicCandidate[] = [];
    ANY_LITERAL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ANY_LITERAL.exec(inner)) !== null) {
      const value = m[2];
      if (value !== undefined && value.length > 0) {
        found.push({ topic: value, confidence: 'literal', source: `${callName}:list` });
      }
    }
    if (found.length > 0) return found;
    return [{ topic: first, confidence: 'dynamic', source: `${callName}:list` }];
  }

  const literal = QUOTED_LITERAL.exec(first);
  const literalValue = literal?.[2];
  if (literalValue !== undefined) {
    if (literalValue.length === 0) return [];
    return [{ topic: literalValue, confidence: 'literal', source: callName }];
  }

  // A keyword argument anywhere in the list, e.g. `send(topic='orders')`.
  const keyword = TOPIC_KEYWORD.exec(trimmed);
  const keywordTopic = keyword?.[2];
  if (keywordTopic !== undefined && keywordTopic.length > 0) {
    return [{ topic: keywordTopic, confidence: 'literal', source: `${callName}:kwarg` }];
  }

  // Not a literal: a variable, a member expression, a template. Record it as
  // dynamic with the expression text so it is visible, but never joinable.
  return [{ topic: first, confidence: 'dynamic', source: callName }];
}

// ─── Extraction ───────────────────────────────────────────────────────────────

/**
 * Find every `identifier(` in the file. Anchored on a single character class
 * with one quantifier — this regex is incapable of catastrophic backtracking.
 * The optional `@` prefix picks up decorator forms like `@on_event("x")`.
 */
const CALL_SITE = /(?:@\s*)?(?:\.\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/**
 * Extract publish/subscribe references from one file.
 *
 * Returns refs in file order. Duplicates within a file (the same topic emitted
 * on three different lines) are all returned; {@link linkEvents} dedupes by file
 * when building the topic index.
 */
export function extractEventRefs(filePath: string, content: string): EventRef[] {
  if (content.length === 0) return [];
  const masked = maskComments(content, commentStyleFor(filePath));
  const starts = lineStarts(masked);
  const refs: EventRef[] = [];

  CALL_SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL_SITE.exec(masked)) !== null) {
    const name = m[1];
    if (name === undefined) continue;
    const isPublish = PUBLISH_NAMES.has(name);
    const isSubscribe = SUBSCRIBE_NAMES.has(name);
    if (!isPublish && !isSubscribe) continue;

    // `function handle(` / `def on_event(` are definitions, not call sites.
    const before = masked.slice(Math.max(0, m.index - 12), m.index);
    const prevWord = /([A-Za-z_$]+)\s+$/.exec(before)?.[1];
    if (prevWord !== undefined && DEFINITION_KEYWORDS.includes(prevWord)) continue;

    const open = m.index + m[0].length - 1;
    const args = readArgs(masked, open);
    const candidates = topicsFromArgs(args, name);
    if (candidates.length === 0) continue;

    const line = lineAt(starts, m.index);
    const role: EventRef['role'] = isPublish ? 'publish' : 'subscribe';
    for (const candidate of candidates) {
      refs.push({
        topic: candidate.topic,
        file: filePath,
        line,
        role,
        confidence: candidate.confidence,
        source: candidate.source,
      });
    }
  }

  return refs;
}

// ─── Linking ──────────────────────────────────────────────────────────────────

/** Namespace dynamic topics so an expression named `a` never joins topic `"a"`. */
function keyFor(ref: EventRef): string {
  return ref.confidence === 'dynamic' ? `\u0000dynamic\u0000${ref.topic}` : ref.topic;
}

/**
 * Join publishers to subscribers by exact topic string.
 *
 * Matching is exact and case-sensitive on purpose: `order.created` and
 * `Order.Created` really are different topics on every broker worth the name,
 * and fuzzy-matching them would hide precisely the typo bug that
 * `orphanedSubscribe` is meant to catch.
 *
 * Dynamic refs are carried through into the output (so nothing is silently
 * dropped) but always come back with both orphan flags `false` — we do not know
 * what they resolve to, so asserting "nobody listens" would be a lie.
 *
 * Result is sorted by topic for deterministic, diffable output.
 */
export function linkEvents(refs: EventRef[]): EventLink[] {
  interface Bucket {
    topic: string;
    dynamic: boolean;
    publishers: Set<string>;
    subscribers: Set<string>;
  }
  const buckets = new Map<string, Bucket>();

  for (const ref of refs) {
    const key = keyFor(ref);
    let bucket = buckets.get(key);
    if (bucket === undefined) {
      bucket = {
        topic: ref.topic,
        dynamic: ref.confidence === 'dynamic',
        publishers: new Set<string>(),
        subscribers: new Set<string>(),
      };
      buckets.set(key, bucket);
    }
    if (ref.role === 'publish') bucket.publishers.add(ref.file);
    else bucket.subscribers.add(ref.file);
  }

  const links: EventLink[] = [];
  for (const bucket of buckets.values()) {
    const publishers = [...bucket.publishers].sort();
    const subscribers = [...bucket.subscribers].sort();
    links.push({
      topic: bucket.topic,
      publishers,
      subscribers,
      orphanedPublish: !bucket.dynamic && publishers.length > 0 && subscribers.length === 0,
      orphanedSubscribe: !bucket.dynamic && subscribers.length > 0 && publishers.length === 0,
    });
  }

  links.sort((a, b) => (a.topic < b.topic ? -1 : a.topic > b.topic ? 1 : 0));
  return links;
}
