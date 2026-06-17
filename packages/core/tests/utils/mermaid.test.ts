import { describe, it, expect } from 'vitest';
import { generateMermaid } from '../../src/utils/mermaid.js';
import type { KnowledgeGraph } from '../../src/schema/types.js';

function makeGraph(overrides: Partial<KnowledgeGraph> = {}): KnowledgeGraph {
  return {
    version: '0.2.0',
    kind: 'codebase',
    phase: 'skeleton',
    generated_at: new Date().toISOString(),
    project_name: 'test',
    project_root: '/tmp/test',
    languages: ['javascript'],
    frameworks: [],
    nodes: [],
    edges: [],
    layers: [],
    tours: [],
    domains: [],
    stats: { total_nodes: 0, total_edges: 0, file_count: 0 },
    ...overrides,
  };
}

describe('generateMermaid', () => {
  it('generates flat diagram with CommonJS import edges', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'file:src/index.js', type: 'file', label: 'index.js', tags: [] },
        { id: 'file:src/lib/utils.js', type: 'file', label: 'utils.js', tags: [] },
      ],
      edges: [
        { id: 'e1', source: 'file:src/index.js', target: 'file:src/lib/utils.js', type: 'imports' },
      ],
    });

    const result = generateMermaid(graph);
    expect(result).toContain('flowchart TD');
    expect(result).toContain('file_src_index_js');
    expect(result).toContain('file_src_lib_utils_js');
    expect(result).toContain('-->');
  });

  it('prioritizes connected nodes over unconnected when flat', () => {
    const nodes = [
      { id: 'file:isolated.js', type: 'file', label: 'isolated.js', tags: [] },
      { id: 'file:hub.js', type: 'file', label: 'hub.js', tags: [] },
      { id: 'file:dep1.js', type: 'file', label: 'dep1.js', tags: [] },
      { id: 'file:dep2.js', type: 'file', label: 'dep2.js', tags: [] },
    ];
    const edges = [
      { id: 'e1', source: 'file:hub.js', target: 'file:dep1.js', type: 'imports' },
      { id: 'e2', source: 'file:hub.js', target: 'file:dep2.js', type: 'imports' },
    ];
    const graph = makeGraph({ nodes, edges });
    const result = generateMermaid(graph);
    // hub.js and its deps should be in diagram (high degree)
    expect(result).toContain('file_hub_js');
    expect(result).toContain('file_dep1_js');
    expect(result).toContain('file_dep2_js');
  });

  it('generates layer diagram when layers exist', () => {
    const graph = makeGraph({
      nodes: [
        { id: 'file:src/api.js', type: 'file', label: 'api.js', tags: [] },
        { id: 'file:src/db.js', type: 'file', label: 'db.js', tags: [] },
      ],
      edges: [
        { id: 'e1', source: 'file:src/api.js', target: 'file:src/db.js', type: 'imports' },
      ],
      layers: [
        { id: 'api', name: 'API Layer', description: 'API files', node_ids: ['file:src/api.js'] },
        { id: 'data', name: 'Data Layer', description: 'DB files', node_ids: ['file:src/db.js'] },
      ],
    });

    const result = generateMermaid(graph);
    expect(result).toContain('API Layer');
    expect(result).toContain('Data Layer');
    expect(result).toContain('-->|1|');
  });
});
