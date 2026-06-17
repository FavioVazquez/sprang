export function add(a: number, b: number): number {
  return a + b;
}

// Internal call: sumList calls add() defined in the same file
export function sumList(nums: number[]): number {
  let total = 0;
  for (const n of nums) {
    total = add(total, n);
  }
  return total;
}
