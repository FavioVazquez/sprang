import { describe, it, expect } from 'vitest';
import { detectLanguageLessons } from '../../src/agents/language-lessons.js';

// ─── Priority: only 1 result returned ─────────────────────────────────────────

describe('priority — at most 1 result returned', () => {
  it('returns exactly 1 result even when multiple patterns match', () => {
    // This code triggers: async_await, promises, and possibly closures
    const code = `
      async function loadAll() {
        const p1 = new Promise((resolve) => resolve(1));
        const p2 = new Promise((resolve) => resolve(2));
        const a = await p1;
        const b = await p2;
        return function() { return a + b; };
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'multi.ts');
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('returns 0 or 1 results, never more', () => {
    // Code with generators + async_await
    const code = `
      async function* asyncRange(start: number, end: number) {
        for (let i = start; i < end; i++) {
          await delay(10);
          yield i;
        }
      }
      async function consume() {
        for await (const n of asyncRange(0, 5)) {
          console.log(n);
        }
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'async-gen.ts');
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('prefers FSM over generators when both are detected', () => {
    // Code with State. prefix (FSM) and yield (generators)
    const code = `
      function* stateWalker() {
        if (current === State.IDLE) yield State.RUNNING;
        if (current === State.RUNNING) yield State.DONE;
        if (current === State.DONE) yield State.IDLE;
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'fsm-gen.ts');
    // FSM has higher priority than generators in our priority list
    if (results.length > 0) {
      expect(results[0]!.pattern).toBe('finite_state_machine');
    }
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('prefers generators over observers when both detected', () => {
    // Code with function* and addEventListener
    const code = `
      function* events() {
        yield 'start';
        yield 'end';
      }
      button.addEventListener('click', handler);
      window.addEventListener('load', onLoad);
    `;
    const results = detectLanguageLessons(code, 'typescript', 'gen-events.ts');
    if (results.length > 0) {
      expect(results[0]!.pattern).toBe('generators');
    }
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('prefers async_await when only that pattern is present', () => {
    const code = `
      async function fetchUser(id: string) {
        const user = await userService.find(id);
        const posts = await postService.findByUser(id);
        return { user, posts };
      }
    `;
    const results = detectLanguageLessons(code, 'typescript', 'fetch.ts');
    // async_await is lowest priority; no other pattern should fire
    expect(results.some(r => r.pattern === 'async_await')).toBe(true);
    expect(results.length).toBe(1);
  });
});

// ─── Python code ──────────────────────────────────────────────────────────────

describe('Python code detection', () => {
  it('detects async_await in Python (≥2 awaits required)', () => {
    const code = `
import asyncio

async def fetch_all(urls):
    result_a = await fetch(urls[0])
    result_b = await fetch(urls[1])
    return result_a, result_b
    `;
    const results = detectLanguageLessons(code, 'python', 'fetch.py');
    expect(results.some(r => r.pattern === 'async_await')).toBe(true);
  });

  it('detects generators in Python', () => {
    const code = `
def fibonacci(n):
    a, b = 0, 1
    for _ in range(n):
        yield a
        a, b = b, a + b
    `;
    const results = detectLanguageLessons(code, 'python', 'fib.py');
    expect(results.some(r => r.pattern === 'generators')).toBe(true);
  });

  it('prefers generators over async_await in Python when both present', () => {
    // generators + async_await; generators has higher priority
    const code = `
async def async_gen():
    for i in range(10):
        await asyncio.sleep(0.1)
        yield i

async def consume():
    async for item in async_gen():
        result = await process(item)
        print(result)
    `;
    const results = detectLanguageLessons(code, 'python', 'async_gen.py');
    expect(results.length).toBeLessThanOrEqual(1);
    if (results.length === 1) {
      // generators has higher priority than async_await
      expect(results[0]!.pattern).toBe('generators');
    }
  });

  it('returns empty for Python code with no detectable patterns', () => {
    const code = `
def add(a, b):
    return a + b

def multiply(a, b):
    return a * b

result = add(2, 3)
    `;
    const results = detectLanguageLessons(code, 'python', 'math.py');
    // No patterns should fire (closures/promises/decorators/observers/DI/middleware/immutability are JS/TS only)
    // async_await needs ≥2 awaits, generics need pattern, generators need yield/function*
    expect(results.length).toBe(0);
  });
});

// ─── Go code ──────────────────────────────────────────────────────────────────

describe('Go code detection', () => {
  it('returns empty array for Go code (most patterns are JS/TS specific)', () => {
    const code = `
package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}
    `;
    const results = detectLanguageLessons(code, 'go', 'main.go');
    expect(results).toHaveLength(0);
  });

  it('returns empty for Go web server code', () => {
    const code = `
package main

import (
    "net/http"
    "encoding/json"
)

type Handler struct {
    db *Database
}

func (h *Handler) GetUser(w http.ResponseWriter, r *http.Request) {
    user, err := h.db.Find(r.URL.Query().Get("id"))
    if err != nil {
        http.Error(w, err.Error(), http.StatusInternalServerError)
        return
    }
    json.NewEncoder(w).Encode(user)
}

func main() {
    h := &Handler{db: NewDatabase()}
    http.HandleFunc("/user", h.GetUser)
    http.ListenAndServe(":8080", nil)
}
    `;
    const results = detectLanguageLessons(code, 'go', 'server.go');
    expect(results).toHaveLength(0);
  });

  it('may detect generics in Go with sufficient <T> occurrences', () => {
    const code = `
package main

func Map[T, U any](s []T, f func(T) U) []U {
    result := make([]U, len(s))
    for i, v := range s {
        result[i] = f(v)
    }
    return result
}

func Filter[T any](s []T, f func(T) bool) []T {
    var result []T
    for _, v := range s {
        if f(v) {
            result = append(result, v)
        }
    }
    return result
}

func Reduce[T, U any](s []T, init U, f func(U, T) U) U {
    acc := init
    for _, v := range s {
        acc = f(acc, v)
    }
    return acc
}
    `;
    // Go generics use [...] not <T> but the regex looks for <T>
    // This should not trigger since Go uses different syntax
    const results = detectLanguageLessons(code, 'go', 'generics.go');
    // Either 0 or 1, but at most 1
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('handles empty string without throwing', () => {
    expect(() => detectLanguageLessons('', 'typescript', 'empty.ts')).not.toThrow();
    expect(detectLanguageLessons('', 'typescript', 'empty.ts')).toHaveLength(0);
  });

  it('handles unknown language without throwing', () => {
    const code = `some code here`;
    expect(() => detectLanguageLessons(code, 'cobol', 'file.cob')).not.toThrow();
  });

  it('handles very long file content without error', () => {
    const line = `const x = await fetch('/api'); const y = await fetch('/api2');\n`;
    const code = line.repeat(500);
    expect(() => detectLanguageLessons(code, 'typescript', 'big.ts')).not.toThrow();
  });
});
