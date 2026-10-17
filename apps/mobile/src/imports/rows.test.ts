import { describe, expect, it } from 'vitest';
import { importFromRow, importPreview } from './rows';

const row = {
  id: 'i1',
  source_type: 'text',
  source_text: '\n  Weeknight Soup  \n- 1 onion',
  source_url: null,
  status: 'ready',
  error: null,
  draft: JSON.stringify({ title: 'Soup', servings: 4, low_confidence: ['servings'] }),
  parse_started_at: '2026-10-17 10:00:00.123456Z',
  created_at: '2026-10-17T10:00:00Z',
};

describe('importFromRow', () => {
  it('reads a synced row and its draft', () => {
    const record = importFromRow(row);
    expect(record).toMatchObject({ id: 'i1', source_type: 'text', status: 'ready', error: null });
    expect(record?.draft).toMatchObject({
      title: 'Soup',
      servings: 4,
      low_confidence: ['servings'],
    });
  });

  it('a draft that cannot be read becomes null, the row still reads', () => {
    expect(importFromRow({ ...row, draft: '{not json' })?.draft).toBeNull();
    expect(importFromRow({ ...row, draft: JSON.stringify({ title: '' }) })?.draft).toBeNull();
    expect(importFromRow({ ...row, draft: JSON.stringify(['x']) })?.draft).toBeNull();
  });

  it('unknown status and error values read as pending and null; unknown source types are dropped', () => {
    expect(importFromRow({ ...row, status: 'weird', error: 'odd' })).toMatchObject({
      status: 'pending',
      error: null,
    });
    expect(importFromRow({ ...row, source_type: 'video' })).toBeNull();
    expect(importFromRow({ ...row, id: 7 })).toBeNull();
  });
});

describe('importPreview', () => {
  it('shows the first line of text, cut to 80 characters, or the link', () => {
    expect(importPreview(importFromRow(row)!)).toBe('Weeknight Soup');
    expect(importPreview(importFromRow({ ...row, source_text: 'x'.repeat(100) })!)).toBe(
      `${'x'.repeat(79)}…`,
    );
    expect(
      importPreview(
        importFromRow({
          ...row,
          source_type: 'url',
          source_text: null,
          source_url: 'https://e.com/a',
        })!,
      ),
    ).toBe('https://e.com/a');
  });
});

it('reads a photo import with its page counts', () => {
  expect(
    importFromRow({
      id: 'i1',
      source_type: 'photo',
      status: 'pending',
      pages: 2,
      uploaded: 1,
      local_pending: 1,
      first_page: 'p1',
    }),
  ).toMatchObject({
    source_type: 'photo',
    pages: 2,
    uploaded: 1,
    localPending: 1,
    firstPage: 'p1',
  });
});
