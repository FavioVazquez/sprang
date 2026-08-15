/**
 * The tool contract.
 *
 * Everything a client sees of Sprang before it calls anything is the `tools/list`
 * payload: names, descriptions, input schemas, output schemas, annotations. That
 * payload is the API. These tests treat it as one — they assert the properties an
 * agent (or a permission policy) actually relies on, and they fail when the
 * declaration drifts away from the implementation.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Must be set before the module is evaluated, so the import is dynamic:
// importing server.ts otherwise starts the stdio transport and never returns.
process.env['SPRANG_MCP_NO_LISTEN'] = '1';
const { TOOLS, listTools, truncateOversizedResult, MAX_RESULT_CHARS } = await import(
  '../src/server.js'
);

const SERVER_SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'server.ts');

/** Tools that must never be able to modify anything. */
const READ_TOOLS = [
  'sprang_query',
  'sprang_node',
  'sprang_diff_impact',
  'sprang_why',
  'sprang_health',
  'sprang_tour',
  'sprang_domain',
  'sprang_coupled',
  'sprang_traps',
  'sprang_owners',
  'sprang_review',
  'sprang_context',
];

/** Tools that write files. Marking either of these read-only would be a bug. */
const WRITE_TOOLS = ['sprang_annotate', 'sprang_respond'];

type Schema = Record<string, unknown>;

interface ToolLike {
  name: string;
  description: string;
  inputSchema: Schema;
  outputSchema: Schema;
  annotations: Record<string, unknown>;
}

const tools = TOOLS as unknown as ToolLike[];
const names = tools.map((t) => t.name);

/**
 * Walk every object-schema in a schema tree — the root, each `oneOf`/`anyOf`
 * /`allOf` branch, each nested property, each `items`. Used to check that no
 * `required` entry names a property that was never declared.
 */
function eachObjectSchema(schema: unknown, visit: (s: Schema, path: string) => void, path = '$'): void {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return;
  const node = schema as Schema;

  if (node['properties'] !== undefined || Array.isArray(node['required'])) {
    visit(node, path);
  }

  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    const branches = node[key];
    if (Array.isArray(branches)) {
      branches.forEach((branch, i) => eachObjectSchema(branch, visit, `${path}.${key}[${i}]`));
    }
  }

  const properties = node['properties'];
  if (properties && typeof properties === 'object') {
    for (const [prop, sub] of Object.entries(properties as Record<string, unknown>)) {
      eachObjectSchema(sub, visit, `${path}.${prop}`);
    }
  }

  if (node['items'] !== undefined) {
    eachObjectSchema(node['items'], visit, `${path}[]`);
  }

  const additional = node['additionalProperties'];
  if (additional && typeof additional === 'object') {
    eachObjectSchema(additional, visit, `${path}.*`);
  }
}

function assertRequiredAreDeclared(schema: unknown, label: string): void {
  eachObjectSchema(schema, (node, path) => {
    const required = node['required'];
    if (!Array.isArray(required)) return;
    const declared = Object.keys((node['properties'] ?? {}) as Record<string, unknown>);
    for (const key of required) {
      expect(
        declared,
        `${label} at ${path}: required lists "${String(key)}" but it is not a declared property`,
      ).toContain(key);
    }
  });
}

// ─── Presence and shape ────────────────────────────────────────────────────

describe('every tool declares a complete contract', () => {
  it('exposes a non-empty tool list', () => {
    expect(tools.length).toBeGreaterThan(0);
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s is fully declared', (name, tool) => {
    expect(typeof tool.name).toBe('string');
    expect(tool.name.length).toBeGreaterThan(0);

    expect(typeof tool.description).toBe('string');
    expect(tool.description.trim().length).toBeGreaterThan(0);

    expect(tool.inputSchema, `${name} has no inputSchema`).toBeTruthy();
    expect(tool.inputSchema['type']).toBe('object');

    expect(tool.outputSchema, `${name} has no outputSchema`).toBeTruthy();
    expect(tool.outputSchema['type']).toBe('object');
    // Either a plain object schema or a oneOf of them — never empty.
    const hasProps = tool.outputSchema['properties'] !== undefined;
    const hasBranches = Array.isArray(tool.outputSchema['oneOf']);
    expect(hasProps || hasBranches, `${name}'s outputSchema declares nothing`).toBe(true);
    if (hasBranches) {
      expect((tool.outputSchema['oneOf'] as unknown[]).length).toBeGreaterThan(1);
    }

    expect(tool.annotations, `${name} has no annotations`).toBeTruthy();
    expect(Object.keys(tool.annotations).length).toBeGreaterThan(0);
  });

  it.each(names)('%s is namespaced under sprang_', (name) => {
    expect(name.startsWith('sprang_')).toBe(true);
    expect(name).toMatch(/^sprang_[a-z][a-z_]*$/);
  });

  it('has no duplicate names', () => {
    expect(new Set(names).size).toBe(names.length);
  });
});

// ─── Descriptions ──────────────────────────────────────────────────────────

describe('descriptions say what the tool is for', () => {
  it.each(tools.map((t) => [t.name, t.description] as const))(
    '%s has a description that carries information',
    (name, description) => {
      // 40 characters is roughly one clause. Below that a description cannot be
      // saying anything beyond restating the name.
      expect(description.length).toBeGreaterThanOrEqual(40);

      const words = description.trim().split(/\s+/);
      expect(words.length, `${name}: description is too short to explain anything`).toBeGreaterThanOrEqual(8);

      // Not just the name restated: strip the name's own words out and require
      // that real content remains.
      const nameWords = name.replace(/^sprang_/, '').split('_');
      const withoutName = description
        .toLowerCase()
        .replace(new RegExp(`\\b(${nameWords.join('|')}|sprang)\\b`, 'g'), '')
        .replace(/[^a-z]+/g, ' ')
        .trim();
      expect(withoutName.length, `${name}: description is the name restated`).toBeGreaterThanOrEqual(30);

      const normalise = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
      expect(normalise(description)).not.toBe(normalise(name));

      // Ends like a sentence, i.e. it is prose rather than a label.
      expect(description.trim()).toMatch(/[.!?]$/);
    },
  );
});

// ─── Schema self-consistency ───────────────────────────────────────────────

describe('required only ever references declared properties', () => {
  it.each(tools.map((t) => [t.name, t] as const))('%s input and output schemas agree', (name, tool) => {
    assertRequiredAreDeclared(tool.inputSchema, `${name} inputSchema`);
    assertRequiredAreDeclared(tool.outputSchema, `${name} outputSchema`);
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s declares object-typed schemas', (_name, tool) => {
    // A `oneOf` at the root must still be a union of object schemas, because
    // structuredContent is always an object.
    const branches = tool.outputSchema['oneOf'];
    if (Array.isArray(branches)) {
      for (const branch of branches as Schema[]) {
        expect(branch['type']).toBe('object');
        expect(branch['properties']).toBeTruthy();
      }
    }
  });
});

// ─── Annotations ───────────────────────────────────────────────────────────

describe('annotations describe capability truthfully', () => {
  it('covers exactly the tools this test knows about', () => {
    // If a tool is added, it must be classified here as read or write — that is
    // the whole point of the hints.
    expect(new Set(names)).toEqual(new Set([...READ_TOOLS, ...WRITE_TOOLS]));
  });

  it.each(READ_TOOLS)('%s is marked read-only and closed-world', (name) => {
    const tool = tools.find((t) => t.name === name);
    expect(tool, `${name} is missing from TOOLS`).toBeTruthy();
    expect(tool!.annotations['readOnlyHint']).toBe(true);
    expect(tool!.annotations['openWorldHint']).toBe(false);
  });

  it.each(WRITE_TOOLS)('%s is NOT marked read-only', (name) => {
    const tool = tools.find((t) => t.name === name);
    expect(tool, `${name} is missing from TOOLS`).toBeTruthy();
    expect(tool!.annotations['readOnlyHint']).toBe(false);
    expect(tool!.annotations['destructiveHint']).toBe(false);
    expect(tool!.annotations['idempotentHint']).toBe(false);
    expect(tool!.annotations['openWorldHint']).toBe(false);
  });

  it.each(tools.map((t) => [t.name, t] as const))('%s has a human title', (_name, tool) => {
    const title = tool.annotations['title'];
    expect(typeof title).toBe('string');
    expect((title as string).length).toBeGreaterThan(3);
    // A title is for a human: not the raw tool name.
    expect(title).not.toBe(tool.name);
  });
});

// ─── Ordering ──────────────────────────────────────────────────────────────

describe('tools/list is deterministic', () => {
  it('returns the same tools, in the same order, on every call', () => {
    const first = listTools();
    const second = listTools();
    const third = listTools();

    expect(first.tools.map((t) => t.name)).toEqual(names);
    expect(second.tools.map((t) => t.name)).toEqual(first.tools.map((t) => t.name));
    expect(third.tools.map((t) => t.name)).toEqual(first.tools.map((t) => t.name));
    // Deep equality too: schemas and annotations must not be rebuilt per call
    // in a way that reorders keys, because clients cache on the payload.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(third)).toBe(JSON.stringify(first));
  });
});

// ─── Size guard ────────────────────────────────────────────────────────────

describe('the size guard truncates deterministically', () => {
  function oversized(): { impact_nodes: unknown[]; total_impact: number; high_risk_count: number } {
    const impact_nodes = Array.from({ length: 4000 }, (_, i) => ({
      node_id: `file:src/generated/module-${i}/index.ts`,
      label: `module-${i}`,
      type: 'file',
      risk_score: 0.5,
      risk_factors: ['high_coupling', 'no_test_coverage'],
      path_from_changed: ['file:src/root.ts', `file:src/generated/module-${i}/index.ts`],
    }));
    return { impact_nodes, total_impact: impact_nodes.length, high_risk_count: 0 };
  }

  it('leaves a small result completely alone', () => {
    const small = { nodes: [{ id: 'file:a.ts' }], total: 1, query: 'a' };
    const out = truncateOversizedResult(small);
    expect(out).toBe(small);
    expect(JSON.stringify(out)).not.toContain('_truncated');
  });

  it('shrinks an oversized result and marks it', () => {
    const big = oversized();
    const before = JSON.stringify(big).length;
    expect(before).toBeGreaterThan(MAX_RESULT_CHARS);

    const out = truncateOversizedResult(big) as Record<string, unknown>;
    const after = JSON.stringify(out).length;

    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(MAX_RESULT_CHARS);

    const marker = out['_truncated'] as { field: string; shown: number; total: number; hint: string };
    expect(marker).toBeTruthy();
    expect(marker.field).toBe('impact_nodes');
    expect(marker.total).toBe(4000);
    expect(marker.shown).toBeLessThan(marker.total);
    expect(marker.shown).toBeGreaterThan(0);
    expect((out['impact_nodes'] as unknown[]).length).toBe(marker.shown);
    expect(marker.hint.length).toBeGreaterThan(20);
  });

  it('keeps the head of the list, which is the ranked part', () => {
    const big = oversized();
    const out = truncateOversizedResult(big) as Record<string, unknown>;
    const kept = out['impact_nodes'] as Array<{ node_id: string }>;
    expect(kept[0]?.node_id).toBe('file:src/generated/module-0/index.ts');
    expect(kept[1]?.node_id).toBe('file:src/generated/module-1/index.ts');
  });

  it('leaves the scalar summary fields intact so counts stay true', () => {
    const out = truncateOversizedResult(oversized()) as Record<string, unknown>;
    expect(out['total_impact']).toBe(4000);
    expect(out['high_risk_count']).toBe(0);
  });

  it('picks the largest array, not the first one', () => {
    const result = {
      changed_nodes: [{ node_id: 'file:src/root.ts' }],
      impact_nodes: Array.from({ length: 4000 }, (_, i) => ({
        node_id: `file:src/m-${i}.ts`,
        blurb: 'x'.repeat(40),
      })),
    };
    const out = truncateOversizedResult(result) as Record<string, unknown>;
    expect((out['_truncated'] as { field: string }).field).toBe('impact_nodes');
    expect((out['changed_nodes'] as unknown[]).length).toBe(1);
  });

  it('does not mutate the result it was given', () => {
    const big = oversized();
    truncateOversizedResult(big);
    expect(big.impact_nodes.length).toBe(4000);
    expect('_truncated' in big).toBe(false);
  });

  it('passes non-object results through untouched', () => {
    expect(truncateOversizedResult(null)).toBe(null);
    expect(truncateOversizedResult('x'.repeat(MAX_RESULT_CHARS + 10))).toHaveLength(
      MAX_RESULT_CHARS + 10,
    );
  });

  it('produces a result that is still valid JSON — the whole point', () => {
    const out = truncateOversizedResult(oversized());
    expect(() => JSON.parse(JSON.stringify(out))).not.toThrow();
  });
});

// ─── Drift guard ───────────────────────────────────────────────────────────

describe('the TOOLS array and the dispatch switch cannot drift apart', () => {
  const source = readFileSync(SERVER_SOURCE, 'utf-8');

  it('every case in the switch is a declared tool, and vice versa', () => {
    const cases = new Set<string>();
    for (const match of source.matchAll(/^\s*case '(sprang_[a-z_]+)':/gm)) {
      if (match[1]) cases.add(match[1]);
    }

    // Sanity: the regex found something at all. Without this the test would
    // pass vacuously if the switch were ever reformatted.
    expect(cases.size).toBeGreaterThan(0);

    const declared = new Set(names);
    const undeclared = [...cases].filter((c) => !declared.has(c));
    const undispatched = [...declared].filter((d) => !cases.has(d));

    expect(undeclared, 'handled in the switch but missing from TOOLS').toEqual([]);
    expect(undispatched, 'declared in TOOLS but not handled in the switch').toEqual([]);
    expect(cases.size).toBe(declared.size);
  });

  it('every declared tool imports an output schema of its own', () => {
    // Guards against copy-pasting one tool's outputSchema onto another.
    const serialised = tools.map((t) => JSON.stringify(t.outputSchema));
    expect(new Set(serialised).size).toBe(serialised.length);
  });

  it('the response path returns structuredContent alongside the text block', () => {
    expect(source).toContain('structuredContent');
    expect(source).toMatch(/content:\s*\[/);
  });
});
