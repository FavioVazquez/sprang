import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  computeFileFingerprint,
  classifyChange,
  buildFingerprintStore,
  loadFingerprintStore,
  saveFingerprintStore,
} from '../../src/utils/fingerprint.js';
import type { FileFingerprint, FingerprintStore } from '../../src/utils/fingerprint.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const TS_CONTENT = `import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export const formatDate = (date: Date) => {
  return date.toISOString();
};

export class UserService {
  private users: Map<string, string> = new Map();
  addUser(id: string, name: string): void {
    this.users.set(id, name);
  }
}

export interface User {
  id: string;
  name: string;
}
`;

const PYTHON_CONTENT = `from typing import List
import os

def greet(name: str) -> str:
    return f"Hello, {name}!"

def format_date(date) -> str:
    return date.isoformat()

class UserService:
    def __init__(self):
        self.users = {}

    def add_user(self, id: str, name: str) -> None:
        self.users[id] = name
`;

const UNKNOWN_LANG_CONTENT = `-- SQL file
SELECT * FROM users WHERE id = 1;
CREATE TABLE orders (id INT PRIMARY KEY);
`;

// ─── computeFileFingerprint tests ─────────────────────────────────────────────

describe('computeFileFingerprint', () => {
  it('extracts functions from a TypeScript file', () => {
    const fp = computeFileFingerprint('src/utils.ts', TS_CONTENT, 'typescript');

    expect(fp.contentHash).toHaveLength(64); // sha256 hex
    expect(fp.functions).toContain('greet');
    expect(fp.functions).toContain('formatDate');
    expect(fp.totalLines).toBe(TS_CONTENT.split('\n').length);
  });

  it('extracts classes from a TypeScript file', () => {
    const fp = computeFileFingerprint('src/utils.ts', TS_CONTENT, 'typescript');
    expect(fp.classes).toContain('UserService');
    expect(fp.classes).toContain('User');
  });

  it('extracts imports from a TypeScript file', () => {
    const fp = computeFileFingerprint('src/utils.ts', TS_CONTENT, 'typescript');
    expect(fp.imports).toContain('node:fs/promises');
    expect(fp.imports).toContain('node:path');
  });

  it('extracts exports from a TypeScript file', () => {
    const fp = computeFileFingerprint('src/utils.ts', TS_CONTENT, 'typescript');
    expect(fp.exports).toContain('greet');
    expect(fp.exports).toContain('formatDate');
    expect(fp.exports).toContain('UserService');
    expect(fp.exports).toContain('User');
  });

  it('extracts defs and classes from a Python file', () => {
    const fp = computeFileFingerprint('main.py', PYTHON_CONTENT, 'python');

    expect(fp.contentHash).toHaveLength(64);
    expect(fp.functions).toContain('greet');
    expect(fp.functions).toContain('format_date');
    expect(fp.classes).toContain('UserService');
  });

  it('extracts imports from a Python file', () => {
    const fp = computeFileFingerprint('main.py', PYTHON_CONTENT, 'python');
    expect(fp.imports).toContain('typing');
    expect(fp.imports).toContain('os');
  });

  it('returns empty arrays for unknown language but still hashes', () => {
    const fp = computeFileFingerprint('schema.sql', UNKNOWN_LANG_CONTENT, 'sql');

    expect(fp.contentHash).toHaveLength(64);
    expect(fp.functions).toEqual([]);
    expect(fp.classes).toEqual([]);
    expect(fp.imports).toEqual([]);
    expect(fp.exports).toEqual([]);
    expect(fp.totalLines).toBe(UNKNOWN_LANG_CONTENT.split('\n').length);
  });

  it('produces a deterministic hash for the same content', () => {
    const fp1 = computeFileFingerprint('a.ts', TS_CONTENT, 'typescript');
    const fp2 = computeFileFingerprint('a.ts', TS_CONTENT, 'typescript');
    expect(fp1.contentHash).toBe(fp2.contentHash);
  });

  it('produces different hashes for different content', () => {
    const fp1 = computeFileFingerprint('a.ts', TS_CONTENT, 'typescript');
    const fp2 = computeFileFingerprint('a.ts', TS_CONTENT + '\n// extra comment', 'typescript');
    expect(fp1.contentHash).not.toBe(fp2.contentHash);
  });

  describe('Go language', () => {
    const GO_CONTENT = `package main

import (
  "fmt"
  "os"
)

type User struct {
  ID   string
  Name string
}

type Repository interface {
  FindByID(id string) (*User, error)
}

func NewUser(id, name string) *User {
  return &User{ID: id, Name: name}
}

func (u *User) Greet() string {
  return fmt.Sprintf("Hello, %s!", u.Name)
}
`;

    it('extracts functions from Go file', () => {
      const fp = computeFileFingerprint('main.go', GO_CONTENT, 'go');
      expect(fp.functions).toContain('NewUser');
      expect(fp.functions).toContain('Greet');
    });

    it('extracts struct/interface names from Go file', () => {
      const fp = computeFileFingerprint('main.go', GO_CONTENT, 'go');
      expect(fp.classes).toContain('User');
      expect(fp.classes).toContain('Repository');
    });

    it('extracts imports from Go file', () => {
      const fp = computeFileFingerprint('main.go', GO_CONTENT, 'go');
      expect(fp.imports).toContain('fmt');
      expect(fp.imports).toContain('os');
    });
  });
});

// ─── classifyChange tests ─────────────────────────────────────────────────────

describe('classifyChange', () => {
  const baseFingerprint: FileFingerprint = {
    contentHash: 'abc123',
    functions: ['greet', 'formatDate'],
    classes: ['UserService'],
    imports: ['node:fs/promises', 'node:path'],
    exports: ['greet', 'UserService'],
    totalLines: 20,
  };

  it('returns SKIP when content hash is identical', () => {
    const curr: FileFingerprint = { ...baseFingerprint };
    expect(classifyChange(baseFingerprint, curr)).toBe('SKIP');
  });

  it('returns STRUCTURAL when prev is undefined (new file)', () => {
    expect(classifyChange(undefined, baseFingerprint)).toBe('STRUCTURAL');
  });

  it('returns COSMETIC when only line count differs but signatures are equal', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'different-hash',
      totalLines: 25, // only line count changed
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('COSMETIC');
  });

  it('returns COSMETIC when only comments differ (same signatures, different hash)', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash-after-comment-change',
      totalLines: 22,
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('COSMETIC');
  });

  it('returns STRUCTURAL when a new function is added', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      functions: [...baseFingerprint.functions, 'newFunction'],
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('STRUCTURAL');
  });

  it('returns STRUCTURAL when a function is removed', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      functions: ['greet'], // formatDate removed
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('STRUCTURAL');
  });

  it('returns STRUCTURAL when an import is added', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      imports: [...baseFingerprint.imports, 'node:crypto'],
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('STRUCTURAL');
  });

  it('returns STRUCTURAL when a class is added', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      classes: [...baseFingerprint.classes, 'NewClass'],
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('STRUCTURAL');
  });

  it('returns STRUCTURAL when an export is removed', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      exports: ['greet'], // UserService removed from exports
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('STRUCTURAL');
  });

  it('treats function order as irrelevant for COSMETIC classification', () => {
    const curr: FileFingerprint = {
      ...baseFingerprint,
      contentHash: 'new-hash',
      functions: ['formatDate', 'greet'], // reversed order
    };
    expect(classifyChange(baseFingerprint, curr)).toBe('COSMETIC');
  });
});

// ─── buildFingerprintStore tests ──────────────────────────────────────────────

describe('buildFingerprintStore', () => {
  it('builds a store with fingerprints for all files', () => {
    const files = [
      { path: 'src/utils.ts', absPath: '/repo/src/utils.ts', language: 'typescript', content: TS_CONTENT },
      { path: 'main.py', absPath: '/repo/main.py', language: 'python', content: PYTHON_CONTENT },
    ];

    const store = buildFingerprintStore(files);

    expect(store.version).toBe('1.0');
    expect(store.generatedAt).toBeTruthy();
    expect(store.files['src/utils.ts']).toBeDefined();
    expect(store.files['main.py']).toBeDefined();
    expect(store.files['src/utils.ts']?.functions).toContain('greet');
    expect(store.files['main.py']?.functions).toContain('greet');
  });

  it('sets generatedAt to a valid ISO string', () => {
    const store = buildFingerprintStore([]);
    expect(() => new Date(store.generatedAt)).not.toThrow();
    expect(new Date(store.generatedAt).toISOString()).toBe(store.generatedAt);
  });

  it('handles empty file list', () => {
    const store = buildFingerprintStore([]);
    expect(store.files).toEqual({});
    expect(store.version).toBe('1.0');
  });
});

// ─── Round-trip: save and load ────────────────────────────────────────────────

describe('saveFingerprintStore / loadFingerprintStore (round-trip)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'sprang-fp-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('round-trips a fingerprint store through disk', async () => {
    const store: FingerprintStore = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      files: {
        'src/index.ts': {
          contentHash: 'deadbeef',
          functions: ['main', 'greet'],
          classes: ['App'],
          imports: ['./utils'],
          exports: ['App'],
          totalLines: 42,
        },
      },
    };

    const sprangDir = join(tmpDir, '.sprang');
    await saveFingerprintStore(sprangDir, store);
    const loaded = await loadFingerprintStore(sprangDir);

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe('1.0');
    expect(loaded!.generatedAt).toBe(store.generatedAt);
    expect(loaded!.files['src/index.ts']).toEqual(store.files['src/index.ts']);
  });

  it('returns null when no store exists yet', async () => {
    const sprangDir = join(tmpDir, '.sprang-nonexistent');
    const result = await loadFingerprintStore(sprangDir);
    expect(result).toBeNull();
  });

  it('creates cache directory automatically when saving', async () => {
    const sprangDir = join(tmpDir, '.sprang-new');
    const store = buildFingerprintStore([]);
    await expect(saveFingerprintStore(sprangDir, store)).resolves.not.toThrow();
    const loaded = await loadFingerprintStore(sprangDir);
    expect(loaded).not.toBeNull();
  });
});
