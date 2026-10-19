// apps/mobile/src/theme/type.test.ts
import { describe, expect, it } from 'vitest';
import { type } from './type';

describe('type scale', () => {
  it('names each weight, so the system font fallback is not flat', () => {
    expect(type.h1.fontWeight).toBe('600');
    expect(type.label.fontWeight).toBe('500');
    expect(type.body.fontWeight).toBe('400');
  });
});
