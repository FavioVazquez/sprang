import { describe, it, expect } from 'vitest';
import { computeAvgCoupling } from '../../src/graph/metrics.js';

const file = (id: string) => ({ id, type: 'file' as const, label: id });
const edge = (source: string, target: string, type = 'imports') => ({ source, target, type } as never);

describe('computeAvgCoupling', () => {
  it('is zero for a graph with no files', () => {
    expect(computeAvgCoupling({ nodes: [], edges: [] })).toBe(0);
  });

  it('counts both ends of a dependency', () => {
    // a -> b: each file participates in one coupling relationship.
    const g = { nodes: [file('a'), file('b')], edges: [edge('a', 'b')] };
    expect(computeAvgCoupling(g as never)).toBe(1);
  });

  it('averages over all files, including uncoupled ones', () => {
    // a -> b, a -> c. degrees: a=2, b=1, c=1, d=0  => 4/4 = 1
    const g = {
      nodes: [file('a'), file('b'), file('c'), file('d')],
      edges: [edge('a', 'b'), edge('a', 'c')],
    };
    expect(computeAvgCoupling(g as never)).toBe(1);
  });

  it('ignores edge types that are not dependencies', () => {
    const g = {
      nodes: [file('a'), file('b')],
      edges: [edge('a', 'b', 'contains'), edge('a', 'b', 'calls')],
    };
    expect(computeAvgCoupling(g as never)).toBe(0);
  });

  it('ignores self-imports, which are a resolution bug rather than coupling', () => {
    const g = { nodes: [file('a')], edges: [edge('a', 'a')] };
    expect(computeAvgCoupling(g as never)).toBe(0);
  });

  it('ignores non-file endpoints so symbols do not inflate the average', () => {
    const g = {
      nodes: [file('a'), file('b'), { id: 'fn', type: 'function' as const, label: 'fn' }],
      edges: [edge('a', 'b'), edge('fn', 'b')],
    };
    // fn is not a file: only a and b count => (1 + 2)/2 = 1.5
    expect(computeAvgCoupling(g as never)).toBe(1.5);
  });
});
