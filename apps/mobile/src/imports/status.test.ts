import { describe, expect, it } from 'vitest';
import { importFromRow } from './rows';
import { formatUsd, importView } from './status';

const base = { id: 'i1', source_type: 'text', source_text: 'Soup', status: 'pending' };
const record = (extra: object) => importFromRow({ ...base, ...extra })!;

describe('importView', () => {
  it('waits offline and reads online', () => {
    expect(importView(record({}), false)).toEqual({
      label: 'Waiting to go online',
      canReview: false,
      canRetry: false,
      busy: false,
    });
    expect(importView(record({ status: 'parsing' }), true)).toEqual({
      label: 'Reading…',
      canReview: false,
      canRetry: false,
      busy: true,
    });
  });

  it('a ready draft can be reviewed; an unreadable one cannot', () => {
    expect(importView(record({ status: 'ready', draft: '{"title":"Soup"}' }), true)).toMatchObject({
      label: 'Ready to review',
      canReview: true,
    });
    expect(importView(record({ status: 'ready', draft: '{' }), true)).toMatchObject({
      label: 'This import could not be read',
      canReview: false,
      canRetry: false,
    });
  });

  it.each([
    ['quota', "Over this month's AI limit", true],
    ['ai_unavailable', "Couldn't reach the AI service", true],
    ['fetch_failed', "Couldn't open that page. Try pasting the recipe text instead.", true],
    ['blocked_address', "That link can't be imported", false],
    ['not_a_recipe', "This doesn't look like a recipe", false],
    ['invalid_output', "Couldn't read this recipe", true],
  ])('%s says "%s"', (error, label, canRetry) => {
    expect(importView(record({ status: 'failed', error }), true)).toEqual({
      label,
      canReview: false,
      canRetry,
      busy: false,
    });
  });
});

it('formats dollars with two decimals', () => {
  expect(formatUsd(0.4234)).toBe('$0.42');
  expect(formatUsd(2)).toBe('$2.00');
});
