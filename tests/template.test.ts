import { describe, it, expect } from 'vitest';
import { substitute } from '../src/shared/template';

describe('substitute', () => {
  it('replaces {{var}} inside strings', () => {
    expect(substitute({ url: 'https://x.com/search?q={{q}}' }, { q: { value: 'oneplus 16' } }))
      .toEqual({ url: 'https://x.com/search?q=oneplus 16' });
  });
  it('deep substitution in nested args', () => {
    expect(substitute({ a: { b: ['{{x}}', 1] } }, { x: { value: 'v' } })).toEqual({ a: { b: ['v', 1] } });
  });
  it('coerces number when whole value is a single var typed number', () => {
    expect(substitute({ page: '{{p}}' }, { p: { value: '3', type: 'number' } })).toEqual({ page: 3 });
  });
  it('keeps string when embedded', () => {
    expect(substitute({ s: 'page {{p}}' }, { p: { value: '3', type: 'number' } })).toEqual({ s: 'page 3' });
  });
  it('leaves unknown vars untouched', () => {
    expect(substitute({ s: '{{nope}}' }, {})).toEqual({ s: '{{nope}}' });
  });
});
