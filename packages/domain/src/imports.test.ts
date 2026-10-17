import { describe, expect, it } from 'vitest';
import {
  importPatchSchema,
  importPutSchema,
  importTextSchema,
  importUrlSchema,
  isHttpUrl,
  isRetryable,
} from './imports';

const ID = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD = '22222222-2222-4222-8222-222222222222';

describe('import sources', () => {
  it('accepts pasted text up to 20,000 characters, trimmed', () => {
    expect(importTextSchema.parse('  Soup  ')).toBe('Soup');
    expect(importTextSchema.safeParse('x'.repeat(20_000)).success).toBe(true);
  });

  it('refuses empty text and text over 20,000 characters with a message', () => {
    expect(importTextSchema.safeParse('   ').success).toBe(false);
    const long = importTextSchema.safeParse('x'.repeat(20_001));
    expect(long.success).toBe(false);
    expect(long.error?.issues[0]?.message).toBe('At most 20,000 characters');
  });

  it.each([
    ['http://example.com/soup', true],
    ['https://example.com/soup?x=1', true],
    ['HTTPS://EXAMPLE.COM', true],
    ['javascript:alert(1)', false],
    ['ftp://example.com/a', false],
    ['https://', false],
    ['example.com/soup', false],
  ])('isHttpUrl(%s) is %s', (value, expected) => {
    expect(isHttpUrl(value)).toBe(expected);
  });

  it('refuses a link over 2,000 characters', () => {
    expect(importUrlSchema.safeParse(`https://example.com/${'a'.repeat(2_000)}`).success).toBe(
      false,
    );
  });
});

describe('import uploads', () => {
  it('accepts a text import and a url import', () => {
    expect(
      importPutSchema.safeParse({
        id: ID,
        household_id: HOUSEHOLD,
        source_type: 'text',
        source_text: 'Soup',
      }).success,
    ).toBe(true);
    expect(
      importPutSchema.safeParse({
        id: ID,
        household_id: HOUSEHOLD,
        source_type: 'url',
        source_url: 'https://example.com/soup',
      }).success,
    ).toBe(true);
  });

  it('refuses mixed sources and server-owned fields', () => {
    const base = { id: ID, household_id: HOUSEHOLD, source_type: 'text', source_text: 'Soup' };
    expect(importPutSchema.safeParse({ ...base, source_url: 'https://example.com' }).success).toBe(
      false,
    );
    expect(importPutSchema.safeParse({ ...base, status: 'ready' }).success).toBe(false);
    expect(importPutSchema.safeParse({ ...base, draft: {} }).success).toBe(false);
  });

  it('a patch may only set recipe_id or deleted_at, and must set one', () => {
    expect(
      importPatchSchema.safeParse({ id: ID, deleted_at: '2026-10-17T10:00:00Z' }).success,
    ).toBe(true);
    expect(importPatchSchema.safeParse({ id: ID, recipe_id: HOUSEHOLD }).success).toBe(true);
    expect(importPatchSchema.safeParse({ id: ID }).success).toBe(false);
    expect(importPatchSchema.safeParse({ id: ID, status: 'pending' }).success).toBe(false);
    expect(importPatchSchema.safeParse({ id: ID, error: null }).success).toBe(false);
  });

  it('knows which errors can be retried', () => {
    expect(['quota', 'ai_unavailable', 'fetch_failed', 'invalid_output'].every(isRetryable)).toBe(
      true,
    );
    expect(isRetryable('not_a_recipe')).toBe(false);
    expect(isRetryable('blocked_address')).toBe(false);
    expect(isRetryable(null)).toBe(false);
  });
});
