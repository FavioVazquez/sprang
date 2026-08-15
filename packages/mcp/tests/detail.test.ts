import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOLS } from '../src/server.js';

/**
 * Progressive disclosure is applied once at the dispatch layer, not per tool.
 * These tests pin both halves of that: the declaration (clients can discover
 * it) and the projection (it actually does something).
 */
describe('detail parameter', () => {
  const TOOLS_WITH_DETAIL = [
    'sprang_query',
    'sprang_node',
    'sprang_diff_impact',
    'sprang_why',
    'sprang_tour',
    'sprang_domain',
    'sprang_context',
    'sprang_review',
  ];

  it('is declared on every tool that returns nodes', () => {
    for (const name of TOOLS_WITH_DETAIL) {
      const tool = TOOLS.find((t) => t.name === name);
      expect(tool, `${name} is missing from TOOLS`).toBeDefined();
      const props = tool!.inputSchema.properties as Record<string, unknown> | undefined;
      expect(props?.['detail'], `${name} does not declare detail`).toBeDefined();
    }
  });

  it('offers exactly the four documented levels', () => {
    const tool = TOOLS.find((t) => t.name === 'sprang_node')!;
    const props = tool.inputSchema.properties as Record<string, { enum?: string[] }>;
    expect(props['detail']?.enum).toEqual(['ids', 'summary', 'skeleton', 'full']);
  });

  it('is never required — omitting it must keep old behaviour', () => {
    for (const name of TOOLS_WITH_DETAIL) {
      const tool = TOOLS.find((t) => t.name === name)!;
      expect(tool.inputSchema.required ?? []).not.toContain('detail');
    }
  });

  it('handles rows that reference a node instead of embedding one', () => {
    // sprang_context and sprang_diff_impact use `node_id`, not `id`. Passing
    // those to projectNode yields {id: undefined}; the dispatch layer has a
    // separate branch, and without it `detail` would appear supported on those
    // tools while doing nothing — worse than not offering it.
    const source = readFileSync(join(import.meta.dirname, '../src/server.ts'), 'utf-8');
    expect(source).toMatch(/record\['node_id'\]/);
  });

  it('does not project non-node objects away', () => {
    // Guidance strings, health summaries and counts are not nodes.
    const source = readFileSync(join(import.meta.dirname, '../src/server.ts'), 'utf-8');
    expect(source).toMatch(/NODE_ID\.test/);
    expect(source).toMatch(/typeof record\['type'\] === 'string'/);
  });
});
