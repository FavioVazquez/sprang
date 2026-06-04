import type { LanguagePattern } from '../schema/types.js';

export type { LanguagePattern };

export interface LessonDetectionResult {
  pattern: LanguagePattern;
  title: string;
  explanation: string;
  confidence: 'high' | 'medium';
  lines?: [number, number];
}

// ─── Titles ───────────────────────────────────────────────────────────────────

const TITLES: Record<LanguagePattern, string> = {
  closures: 'Closures',
  async_await: 'Async/Await',
  promises: 'Promises',
  generators: 'Generators',
  decorators: 'Decorators',
  generics: 'Generics',
  streams: 'Streams & Reactive',
  observers: 'Observer Pattern',
  dependency_injection: 'Dependency Injection',
  middleware: 'Middleware Pattern',
  finite_state_machine: 'Finite State Machine',
  immutability: 'Immutability',
};

// ─── Explanations ─────────────────────────────────────────────────────────────

const EXPLANATIONS: Record<LanguagePattern, string> = {
  closures:
    'A closure is a function that captures variables from its surrounding scope, enabling data encapsulation and stateful callbacks.',
  async_await:
    'async/await is syntactic sugar over Promises that makes asynchronous code read like synchronous code.',
  promises:
    'Promises represent the eventual result of an asynchronous operation, allowing you to chain callbacks with .then() and handle errors with .catch().',
  generators:
    'Generators are functions that can pause execution and yield multiple values lazily, enabling efficient iteration over potentially infinite sequences.',
  decorators:
    'Decorators are annotations applied to classes or methods that modify their behavior at definition time, commonly used for dependency injection and logging.',
  generics:
    'Generics let you write reusable functions and data structures that work across many types while preserving full type safety.',
  streams:
    'Streams and reactive programming model data as time-ordered sequences of values, enabling composable asynchronous data pipelines.',
  observers:
    'The Observer pattern decouples event producers from consumers: producers emit events and registered observers react without either knowing about the other.',
  dependency_injection:
    'Dependency injection passes a class\'s dependencies through its constructor rather than creating them internally, making the class easier to test and configure.',
  middleware:
    'Middleware is a chain of functions that each receive a request and a "next" callback, allowing cross-cutting concerns like logging and auth to be composed cleanly.',
  finite_state_machine:
    'A finite state machine models an object that transitions between a fixed set of named states in response to events, making complex control flow explicit and testable.',
  immutability:
    'Immutability means values cannot be changed after creation; instead you produce new values, eliminating a whole class of bugs caused by shared mutable state.',
};

// ─── Priority order (rarest / most educational first) ─────────────────────────

const PRIORITY: LanguagePattern[] = [
  'finite_state_machine',
  'generators',
  'observers',
  'streams',
  'dependency_injection',
  'decorators',
  'generics',
  'closures',
  'immutability',
  'middleware',
  'promises',
  'async_await',
];

// ─── Helper: count non-overlapping occurrences of a regex ─────────────────────

function countMatches(content: string, re: RegExp): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return (content.match(g) ?? []).length;
}

// ─── Helper: first line of a match in the source ─────────────────────────────

function matchLine(content: string, re: RegExp): number | undefined {
  const m = re.exec(content);
  if (!m) return undefined;
  return content.slice(0, m.index).split('\n').length;
}

// ─── Helper: line range for a pattern ────────────────────────────────────────

function lineRangeFor(content: string, re: RegExp): [number, number] | undefined {
  const line = matchLine(content, re);
  if (line === undefined) return undefined;
  return [line, Math.min(line + 5, content.split('\n').length)];
}

// ─── Detectors ────────────────────────────────────────────────────────────────

interface DetectorResult {
  matched: boolean;
  confidence: 'high' | 'medium';
  lines?: [number, number];
}

const JS_TS_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js']);
const ASYNC_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'python', 'rust', 'csharp']);
const GENERATOR_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'python']);
const DECORATOR_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'python']);
const GENERIC_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'java', 'kotlin', 'go', 'rust', 'csharp']);
const STREAM_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'java', 'kotlin']);
const OBSERVER_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js']);
const DI_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'java', 'kotlin']);
const MIDDLEWARE_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js']);
const IMMUTABILITY_LANGS = new Set(['typescript', 'javascript', 'tsx', 'jsx', 'ts', 'js', 'java', 'kotlin']);

function detectClosures(content: string, language: string): DetectorResult {
  if (!JS_TS_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  // Look for function defined inside another function body
  // Pattern: function body contains another function definition that references outer scope
  const innerFunctionRe = /function\s+\w+\s*\([^)]*\)\s*\{[^}]*function\s+\w*\s*\(/s;
  const arrowInsideFunctionRe = /function\s+\w+\s*\([^)]*\)\s*\{[^}]*(?:const|let|var)\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/s;
  const returnFunctionRe = /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+function/;
  const returnArrowRe = /function\s+\w+\s*\([^)]*\)\s*\{[\s\S]*?return\s+(?:async\s+)?(?:\([^)]*\)|[a-zA-Z_]\w*)\s*=>/;

  const matched =
    innerFunctionRe.test(content) ||
    arrowInsideFunctionRe.test(content) ||
    returnFunctionRe.test(content) ||
    returnArrowRe.test(content);

  if (!matched) return { matched: false, confidence: 'medium' };

  const signalRe = returnFunctionRe.test(content) ? returnFunctionRe : returnArrowRe;
  const lines = lineRangeFor(content, signalRe) ?? lineRangeFor(content, innerFunctionRe);

  // High confidence: explicit return of a function
  const confidence = returnFunctionRe.test(content) || returnArrowRe.test(content) ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectAsyncAwait(content: string, language: string): DetectorResult {
  if (!ASYNC_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const awaitRe = /\bawait\b/g;
  const awaitCount = countMatches(content, awaitRe);
  if (awaitCount < 2) return { matched: false, confidence: 'medium' };

  const asyncFnRe = /\basync\s+(?:function|\w+\s*=>|\([^)]*\)\s*=>)/;
  const lines = lineRangeFor(content, asyncFnRe) ?? lineRangeFor(content, /\bawait\b/);
  const confidence: 'high' | 'medium' = awaitCount >= 4 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectPromises(content: string, language: string): DetectorResult {
  if (!JS_TS_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const thenRe = /\.then\(/g;
  const catchRe = /\.catch\(/g;
  const newPromiseRe = /new\s+Promise\(/g;

  const count =
    countMatches(content, thenRe) +
    countMatches(content, catchRe) +
    countMatches(content, newPromiseRe);

  if (count < 2) return { matched: false, confidence: 'medium' };

  const lines = lineRangeFor(content, /new\s+Promise\(/) ?? lineRangeFor(content, /\.then\(/);
  const confidence: 'high' | 'medium' = count >= 4 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectGenerators(content: string, language: string): DetectorResult {
  if (!GENERATOR_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const generatorFnRe = /function\s*\*/;
  const yieldRe = /\byield\b/g;
  const yieldCount = countMatches(content, yieldRe);

  const matched = generatorFnRe.test(content) || yieldCount >= 1;
  if (!matched) return { matched: false, confidence: 'medium' };

  const lines = lineRangeFor(content, generatorFnRe) ?? lineRangeFor(content, /\byield\b/);
  const confidence: 'high' | 'medium' =
    generatorFnRe.test(content) && yieldCount >= 2 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectDecorators(content: string, language: string): DetectorResult {
  if (!DECORATOR_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  // @decorator before class or method definition
  const decoratorClassRe = /@\w+(?:\([^)]*\))?\s*\n\s*(?:export\s+)?(?:abstract\s+)?class\s+/;
  const decoratorMethodRe = /@\w+(?:\([^)]*\))?\s*\n\s*(?:public|private|protected|static|async|\w+)\s+\w+\s*\(/;
  const injectableRe = /@(?:Injectable|Inject|Component|Directive|Pipe|Module|Controller|Get|Post|Put|Delete|Patch|Body|Param|Query)\b/;

  const matched =
    decoratorClassRe.test(content) ||
    decoratorMethodRe.test(content) ||
    injectableRe.test(content);

  if (!matched) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, decoratorClassRe) ??
    lineRangeFor(content, injectableRe) ??
    lineRangeFor(content, decoratorMethodRe);

  const confidence: 'high' | 'medium' = injectableRe.test(content) ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectGenerics(content: string, language: string): DetectorResult {
  if (!GENERIC_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const genericTRe = /<T(?:\s+extends[^>]*)?\s*>/g;
  const genericExtendsRe = /<T\s+extends\b/g;
  const pythonGenericRe = /:\s*Generic\[/g;

  const count =
    countMatches(content, genericTRe) +
    countMatches(content, genericExtendsRe) +
    countMatches(content, pythonGenericRe);

  if (count < 3) return { matched: false, confidence: 'medium' };

  const lines = lineRangeFor(content, /<T(?:\s+extends[^>]*)?\s*>/);
  const confidence: 'high' | 'medium' = count >= 5 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectStreams(content: string, language: string): DetectorResult {
  if (!STREAM_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const pipeRe = /\.pipe\(/g;
  const observableRe = /\bObservable\b/g;
  const subjectRe = /\bSubject\b/g;
  const streamRe = /\bStream\b/g;

  const count =
    countMatches(content, pipeRe) +
    countMatches(content, observableRe) +
    countMatches(content, subjectRe) +
    countMatches(content, streamRe);

  if (count < 1) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, /\bObservable\b/) ??
    lineRangeFor(content, /\.pipe\(/) ??
    lineRangeFor(content, /\bSubject\b/);

  const confidence: 'high' | 'medium' = count >= 3 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectObservers(content: string, language: string): DetectorResult {
  if (!OBSERVER_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const addEventListenerRe = /\baddEventListener\b/g;
  const subscribeRe = /\bsubscribe\s*\(/g;
  const onEmitRe = /\bon\s*\(/g;
  const emitRe = /\bemit\s*\(/g;

  const listenerCount = countMatches(content, addEventListenerRe);
  const subscribeCount = countMatches(content, subscribeRe);
  const onCount = countMatches(content, onEmitRe);
  const emitCount = countMatches(content, emitRe);

  // addEventListener alone is a strong signal; or on() + emit() combo
  const matched =
    listenerCount >= 1 ||
    subscribeCount >= 1 ||
    (onCount >= 1 && emitCount >= 1);

  if (!matched) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, /\baddEventListener\b/) ??
    lineRangeFor(content, /\bsubscribe\s*\(/) ??
    lineRangeFor(content, /\bon\s*\(/);

  const confidence: 'high' | 'medium' =
    (listenerCount >= 2) || (subscribeCount >= 2) || (onCount >= 1 && emitCount >= 1)
      ? 'high'
      : 'medium';
  return { matched: true, confidence, lines };
}

function detectDependencyInjection(content: string, language: string): DetectorResult {
  if (!DI_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  // @Inject or @Injectable decorator
  const injectDecoratorRe = /@(?:Injectable|Inject)\b/;
  // Constructor with typed parameters in a class
  const constructorTypedParamRe = /constructor\s*\(\s*(?:private|protected|public|readonly)\s+\w+\s*:\s*\w+/;
  const constructorSimpleTypedRe = /constructor\s*\([^)]*:\s*\w+[^)]*\)/;

  const matched =
    injectDecoratorRe.test(content) ||
    constructorTypedParamRe.test(content) ||
    constructorSimpleTypedRe.test(content);

  if (!matched) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, injectDecoratorRe) ??
    lineRangeFor(content, constructorTypedParamRe) ??
    lineRangeFor(content, constructorSimpleTypedRe);

  const confidence: 'high' | 'medium' = injectDecoratorRe.test(content) ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

function detectMiddleware(content: string, language: string): DetectorResult {
  if (!MIDDLEWARE_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const reqResNextRe = /\(\s*req\s*,\s*res\s*,\s*next\s*\)/;
  const appUseRe = /\bapp\.use\s*\(/g;
  const routerUseRe = /\brouter\.use\s*\(/g;

  const appUseCount = countMatches(content, appUseRe);
  const routerUseCount = countMatches(content, routerUseRe);

  const matched =
    reqResNextRe.test(content) ||
    appUseCount >= 1 ||
    routerUseCount >= 1;

  if (!matched) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, reqResNextRe) ??
    lineRangeFor(content, /\bapp\.use\s*\(/);

  const confidence: 'high' | 'medium' =
    reqResNextRe.test(content) && (appUseCount >= 1 || routerUseCount >= 1)
      ? 'high'
      : 'medium';
  return { matched: true, confidence, lines };
}

function detectFSM(content: string, _language: string): DetectorResult {
  // switch on state variable
  const switchStateRe = /switch\s*\(\s*(?:this\.)?\w*[Ss]tate\w*\s*\)/;
  // State. prefix used multiple times (e.g. State.IDLE, State.RUNNING)
  const stateDotRe = /\bState\.\w+/g;
  const stateDotCount = countMatches(content, stateDotRe);
  // enum of states
  const stateEnumRe = /enum\s+\w*[Ss]tate\w*\s*\{/;

  const matched =
    switchStateRe.test(content) ||
    stateDotCount >= 3 ||
    (stateEnumRe.test(content) && (switchStateRe.test(content) || stateDotCount >= 2));

  if (!matched) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, switchStateRe) ??
    lineRangeFor(content, stateEnumRe) ??
    lineRangeFor(content, /\bState\.\w+/);

  const confidence: 'high' | 'medium' =
    switchStateRe.test(content) && (stateEnumRe.test(content) || stateDotCount >= 3)
      ? 'high'
      : 'medium';
  return { matched: true, confidence, lines };
}

function detectImmutability(content: string, language: string): DetectorResult {
  if (!IMMUTABILITY_LANGS.has(language)) return { matched: false, confidence: 'medium' };

  const freezeRe = /\bObject\.freeze\s*\(/g;
  const asConstRe = /\bas\s+const\b/g;
  const readonlyRe = /\breadonly\b/g;
  const immutableTypeRe = /\bImmutable\w+/g;

  const count =
    countMatches(content, freezeRe) +
    countMatches(content, asConstRe) +
    countMatches(content, readonlyRe) +
    countMatches(content, immutableTypeRe);

  if (count < 3) return { matched: false, confidence: 'medium' };

  const lines =
    lineRangeFor(content, /\bObject\.freeze\s*\(/) ??
    lineRangeFor(content, /\bas\s+const\b/) ??
    lineRangeFor(content, /\breadonly\b/);

  const confidence: 'high' | 'medium' = count >= 5 ? 'high' : 'medium';
  return { matched: true, confidence, lines };
}

// ─── Detector map ─────────────────────────────────────────────────────────────

type Detector = (content: string, language: string) => DetectorResult;

const DETECTORS: Record<LanguagePattern, Detector> = {
  closures: detectClosures,
  async_await: detectAsyncAwait,
  promises: detectPromises,
  generators: detectGenerators,
  decorators: detectDecorators,
  generics: detectGenerics,
  streams: detectStreams,
  observers: detectObservers,
  dependency_injection: detectDependencyInjection,
  middleware: detectMiddleware,
  finite_state_machine: detectFSM,
  immutability: detectImmutability,
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect programming language patterns in a source file.
 *
 * Returns at most the single highest-priority matching lesson (to keep tours
 * focused). Priority order: FSM > generators > observers > streams > DI >
 * decorators > generics > closures > immutability > middleware > promises > async_await.
 */
export function detectLanguageLessons(
  content: string,
  language: string,
  _filePath: string,
): LessonDetectionResult[] {
  const lang = language.toLowerCase();

  // Run all detectors and collect matches
  const matches: LessonDetectionResult[] = [];
  for (const pattern of PRIORITY) {
    const detector = DETECTORS[pattern];
    const result = detector(content, lang);
    if (result.matched) {
      matches.push({
        pattern,
        title: TITLES[pattern],
        explanation: EXPLANATIONS[pattern],
        confidence: result.confidence,
        lines: result.lines,
      });
    }
  }

  // Return at most 1 — the first (highest-priority) match
  return matches.slice(0, 1);
}
