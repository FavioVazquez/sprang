/**
 * Basic math utility functions.
 */

/**
 * Adds two numbers together.
 */
export function add(a: number, b: number): number {
  return a + b;
}

/**
 * Subtracts b from a.
 */
export function subtract(a: number, b: number): number {
  return a - b;
}

/**
 * Multiplies two numbers together.
 */
export function multiply(a: number, b: number): number {
  return a * b;
}

/**
 * Divides a by b.
 * @throws {Error} if b is zero
 */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Division by zero');
  }
  return a / b;
}
