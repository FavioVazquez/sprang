import { add } from './math.js';

// External call: compute() calls add() which is exported from an imported file
export function compute(x: number): number {
  return add(x, 10);
}
