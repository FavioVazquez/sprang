import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock elkjs before importing the module under test ───────────────────────

const mockLayout = vi.fn();

vi.mock('elkjs/lib/elk.bundled.js', () => {
  return {
    default: class MockELK {
      layout = mockLayout;
    },
  };
});

// Import AFTER mock is set up
const { computeLayerLayout } = await import('./elk-layout');

describe('computeLayerLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns positions for all input nodes', async () => {
    mockLayout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'layer-1', x: 0, y: 0, width: 280, height: 160 },
        { id: 'layer-2', x: 360, y: 200, width: 280, height: 160 },
        { id: 'layer-3', x: 0, y: 400, width: 280, height: 160 },
      ],
    });

    const nodes = [
      { id: 'layer-1', width: 280, height: 160 },
      { id: 'layer-2', width: 280, height: 160 },
      { id: 'layer-3', width: 280, height: 160 },
    ];
    const edges = [
      { id: 'e1', sources: ['layer-1'], targets: ['layer-2'] },
      { id: 'e2', sources: ['layer-2'], targets: ['layer-3'] },
    ];

    const result = await computeLayerLayout(nodes, edges);

    expect(result.nodes.size).toBe(3);
    expect(result.nodes.has('layer-1')).toBe(true);
    expect(result.nodes.has('layer-2')).toBe(true);
    expect(result.nodes.has('layer-3')).toBe(true);
  });

  it('returns correct x/y coordinates from ELK output', async () => {
    mockLayout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'node-a', x: 10, y: 20, width: 280, height: 160 },
        { id: 'node-b', x: 400, y: 300, width: 280, height: 160 },
      ],
    });

    const result = await computeLayerLayout(
      [
        { id: 'node-a', width: 280, height: 160 },
        { id: 'node-b', width: 280, height: 160 },
      ],
      [],
    );

    expect(result.nodes.get('node-a')).toEqual({ x: 10, y: 20 });
    expect(result.nodes.get('node-b')).toEqual({ x: 400, y: 300 });
  });

  it('returns empty map when ELK returns no children', async () => {
    mockLayout.mockResolvedValue({ id: 'root' });

    const result = await computeLayerLayout([], []);
    expect(result.nodes.size).toBe(0);
  });

  it('defaults x/y to 0 if ELK omits position', async () => {
    mockLayout.mockResolvedValue({
      id: 'root',
      children: [
        { id: 'node-x', width: 280, height: 160 }, // no x/y
      ],
    });

    const result = await computeLayerLayout(
      [{ id: 'node-x', width: 280, height: 160 }],
      [],
    );

    expect(result.nodes.get('node-x')).toEqual({ x: 0, y: 0 });
  });

  it('passes correct ELK layout options', async () => {
    mockLayout.mockResolvedValue({ id: 'root', children: [] });

    await computeLayerLayout([], []);

    expect(mockLayout).toHaveBeenCalledOnce();
    const callArg = mockLayout.mock.calls[0][0];
    expect(callArg.layoutOptions).toMatchObject({
      algorithm: 'layered',
      'elk.direction': 'DOWN',
      'elk.layered.spacing.nodeNodeBetweenLayers': '100',
      'elk.spacing.nodeNode': '80',
      'elk.edgeRouting': 'ORTHOGONAL',
    });
  });

  it('passes nodes and edges to ELK correctly', async () => {
    mockLayout.mockResolvedValue({ id: 'root', children: [] });

    const nodes = [{ id: 'n1', width: 100, height: 50 }];
    const edges = [{ id: 'e1', sources: ['n1'], targets: ['n2'] }];

    await computeLayerLayout(nodes, edges);

    const callArg = mockLayout.mock.calls[0][0];
    expect(callArg.children).toEqual([{ id: 'n1', width: 100, height: 50 }]);
    expect(callArg.edges).toEqual([{ id: 'e1', sources: ['n1'], targets: ['n2'] }]);
  });
});
