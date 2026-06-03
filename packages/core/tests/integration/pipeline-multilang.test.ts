import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProjectScannerAgent } from '../../src/agents/project-scanner.js';
import { FileAnalyzerAgent } from '../../src/agents/file-analyzer.js';
import { createEmptyGraph } from '../../src/graph/store.js';
import { NullLLMClient } from '../../src/llm/client.js';
import type { AgentContext, SprangOptions } from '../../src/agents/base.js';

function makeCtx(fixtureRoot: string, tmpDir: string): AgentContext {
  const sprangDir = join(tmpDir, '.sprang');
  return {
    projectRoot: fixtureRoot,
    sprangDir,
    intermediateDir: join(sprangDir, 'intermediate'),
    cacheDir: join(sprangDir, 'cache'),
    graph: createEmptyGraph(fixtureRoot, 'multilang-test'),
    llm: new NullLLMClient(),
    options: { skipLLM: true } as SprangOptions,
  };
}

describe('Phase 1 pipeline – Go project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-go', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-go-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects Go language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('go');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:main.go');
    expect(ids).toContain('file:pkg/auth/auth.go');
  });

  it('creates function and struct nodes for Go files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('function:main.go:main');
    expect(ids).toContain('function:main.go:Helper');
    expect(ids).toContain('function:pkg/auth/auth.go:NewUser');
    expect(ids).toContain('function:pkg/auth/auth.go:Greet');
    expect(ids).toContain('class:pkg/auth/auth.go:User');
    expect(ids).toContain('class:pkg/auth/auth.go:AuthError');
  });

  it('creates contains edges for Go files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    const containsEdge = result.mutatedGraph.edges.find(
      (e) => e.source === 'file:main.go' && e.target === 'function:main.go:Helper' && e.type === 'contains'
    );
    expect(containsEdge).toBeDefined();
  });
});

describe('Phase 1 pipeline – Rust project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-rust', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-rust-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects Rust language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('rust');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:src/main.rs');
    expect(ids).toContain('file:src/auth.rs');
    expect(ids).toContain('file:src/models.rs');
  });

  it('creates function and struct nodes for Rust files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('function:src/auth.rs:authenticate');
    expect(ids).toContain('class:src/models.rs:User');
    expect(ids).toContain('class:src/models.rs:Role');
  });

  it('creates import edges from mod declarations', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    const importEdges = result.mutatedGraph.edges.filter((e) => e.type === 'imports');
    const fromMain = importEdges.filter((e) => e.source === 'file:src/main.rs').map((e) => e.target);
    expect(fromMain).toContain('file:src/auth.rs');
    expect(fromMain).toContain('file:src/models.rs');
  });
});

describe('Phase 1 pipeline – Java project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-java', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-java-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects Java language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('java');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:Main.java');
    expect(ids).toContain('file:auth/AuthService.java');
  });

  it('creates class and method nodes for Java files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('class:Main.java:Main');
    expect(ids).toContain('class:auth/AuthService.java:AuthService');
  });
});

describe('Phase 1 pipeline – Ruby project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-ruby', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-ruby-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects Ruby language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('ruby');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:main.rb');
    expect(ids).toContain('file:lib/user.rb');
    expect(ids).toContain('file:lib/auth.rb');
  });

  it('creates class and method nodes for Ruby files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('class:lib/user.rb:User');
    expect(ids).toContain('class:lib/auth.rb:Auth');
  });

  it('creates import edges from require_relative', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    const importEdges = result.mutatedGraph.edges.filter((e) => e.type === 'imports');
    const fromMain = importEdges.filter((e) => e.source === 'file:main.rb').map((e) => e.target);
    expect(fromMain).toContain('file:lib/user.rb');
    expect(fromMain).toContain('file:lib/auth.rb');
  });
});

describe('Phase 1 pipeline – C project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-c', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-c-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects C language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('c');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:main.c');
    expect(ids).toContain('file:utils.h');
    expect(ids).toContain('file:utils.c');
  });

  it('creates function nodes for C files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('function:utils.c:greet');
    expect(ids).toContain('function:utils.c:multiply');
  });

  it('creates import edges from #include', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    const importEdges = result.mutatedGraph.edges.filter((e) => e.type === 'imports');
    const fromMain = importEdges.filter((e) => e.source === 'file:main.c').map((e) => e.target);
    expect(fromMain).toContain('file:utils.h');
  });
});

describe('Phase 1 pipeline – Kotlin project', () => {
  const FIXTURE_ROOT = new URL('../fixtures/simple-kotlin', import.meta.url).pathname;
  let tmpDir: string;

  beforeEach(async () => { tmpDir = await mkdtemp(join(tmpdir(), 'sprang-kotlin-test-')); });
  afterEach(async () => { await rm(tmpDir, { recursive: true, force: true }); });

  it('detects Kotlin language and creates file nodes', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const result = await new ProjectScannerAgent().run(ctx);
    expect(result.success).toBe(true);
    expect(result.mutatedGraph.languages).toContain('kotlin');
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('file:Main.kt');
    expect(ids).toContain('file:auth/AuthService.kt');
  });

  it('creates class and function nodes for Kotlin files', async () => {
    const ctx = makeCtx(FIXTURE_ROOT, tmpDir);
    const scanResult = await new ProjectScannerAgent().run(ctx);
    const analyzerCtx = { ...ctx, graph: scanResult.mutatedGraph };
    const result = await new FileAnalyzerAgent().run(analyzerCtx);
    expect(result.success).toBe(true);
    const ids = result.mutatedGraph.nodes.map((n) => n.id);
    expect(ids).toContain('class:auth/AuthService.kt:AuthService');
    expect(ids).toContain('class:auth/User.kt:User');
    expect(ids).toContain('function:auth/AuthService.kt:authenticate');
    expect(ids).toContain('function:auth/AuthService.kt:getTokenAsync');
  });
});
