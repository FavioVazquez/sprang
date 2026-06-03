import { describe, it, expect } from 'vitest';
import { capitalize, truncate, slugify } from './string-utils.js';

describe('capitalize', () => {
  it('capitalizes the first letter', () => {
    expect(capitalize('hello')).toBe('Hello');
  });

  it('leaves already-capitalized strings unchanged', () => {
    expect(capitalize('Hello')).toBe('Hello');
  });

  it('returns an empty string unchanged', () => {
    expect(capitalize('')).toBe('');
  });

  it('capitalizes a single character', () => {
    expect(capitalize('a')).toBe('A');
  });

  it('does not change characters after the first', () => {
    expect(capitalize('hELLO')).toBe('HELLO');
  });
});

describe('truncate', () => {
  it('truncates strings longer than maxLen', () => {
    expect(truncate('Hello, world!', 5)).toBe('Hello...');
  });

  it('returns the original string if it fits', () => {
    expect(truncate('Hi', 10)).toBe('Hi');
  });

  it('returns the original string if length equals maxLen', () => {
    expect(truncate('Hello', 5)).toBe('Hello');
  });

  it('handles empty strings', () => {
    expect(truncate('', 5)).toBe('');
  });

  it('handles maxLen of zero', () => {
    expect(truncate('abc', 0)).toBe('...');
  });
});

describe('slugify', () => {
  it('converts a simple string to a slug', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('replaces multiple spaces with a single hyphen', () => {
    expect(slugify('foo   bar')).toBe('foo-bar');
  });

  it('removes special characters', () => {
    expect(slugify('Hello, World!')).toBe('hello-world');
  });

  it('removes leading and trailing hyphens', () => {
    expect(slugify(' leading and trailing ')).toBe('leading-and-trailing');
  });

  it('handles an already-slugified string', () => {
    expect(slugify('my-slug')).toBe('my-slug');
  });

  it('handles numbers', () => {
    expect(slugify('Release 2.0')).toBe('release-2-0');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});
