import { describe, expect, it } from 'vitest';
import { importFromRow, importPreview, type ImportRecord } from './rows';
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

describe('photo imports', () => {
  const photo = (over: Partial<ImportRecord>): ImportRecord => ({
    id: 'i1',
    source_type: 'photo',
    source_text: null,
    source_url: null,
    status: 'pending',
    error: null,
    draft: null,
    parse_started_at: null,
    created_at: null,
    pages: 3,
    uploaded: 2,
    localPending: 1,
    firstPage: 'p1',
    ...over,
  });

  it('shows upload progress online, and can still be dismissed', () => {
    expect(importView(photo({}), true)).toEqual({
      label: 'Uploading photos (2 of 3)',
      canReview: false,
      canRetry: false,
      busy: false,
    });
  });

  it('waits to go online when this phone holds the files', () => {
    expect(importView(photo({}), false).label).toBe('Waiting to go online');
  });

  it('says when another device holds the files', () => {
    expect(importView(photo({ localPending: 0 }), true).label).toBe(
      'Waiting for photos from another device',
    );
  });

  it('reads like any import once every page is uploaded', () => {
    expect(importView(photo({ uploaded: 3, localPending: 0 }), true).label).toBe('Reading…');
  });

  it('previews as the number of pages', () => {
    expect(importPreview(photo({}))).toBe('Photo · 3 pages');
    expect(importPreview(photo({ pages: 1 }))).toBe('Photo · 1 page');
  });
});
