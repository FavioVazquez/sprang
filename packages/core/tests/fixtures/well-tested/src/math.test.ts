import { describe, it, expect } from 'vitest';
import { add, subtract, multiply, divide } from './math.js';

describe('add', () => {
  it('adds two positive numbers', () => {
    expect(add(2, 3)).toBe(5);
  });

  it('adds negative numbers', () => {
    expect(add(-1, -4)).toBe(-5);
  });

  it('adds zero', () => {
    expect(add(0, 7)).toBe(7);
    expect(add(7, 0)).toBe(7);
  });

  it('adds floats', () => {
    expect(add(0.1, 0.2)).toBeCloseTo(0.3);
  });
});

describe('subtract', () => {
  it('subtracts b from a', () => {
    expect(subtract(10, 4)).toBe(6);
  });

  it('subtracts to produce a negative result', () => {
    expect(subtract(3, 9)).toBe(-6);
  });

  it('subtracts zero', () => {
    expect(subtract(5, 0)).toBe(5);
  });
});

describe('multiply', () => {
  it('multiplies two positive numbers', () => {
    expect(multiply(3, 4)).toBe(12);
  });

  it('multiplies by zero', () => {
    expect(multiply(5, 0)).toBe(0);
  });

  it('multiplies negative numbers', () => {
    expect(multiply(-2, 3)).toBe(-6);
    expect(multiply(-2, -3)).toBe(6);
  });

  it('multiplies floats', () => {
    expect(multiply(0.5, 4)).toBe(2);
  });
});

describe('divide', () => {
  it('divides two numbers', () => {
    expect(divide(10, 2)).toBe(5);
  });

  it('divides to produce a float', () => {
    expect(divide(7, 2)).toBe(3.5);
  });

  it('throws on division by zero', () => {
    expect(() => divide(5, 0)).toThrow('Division by zero');
  });

  it('divides negative numbers', () => {
    expect(divide(-10, 2)).toBe(-5);
  });
});
