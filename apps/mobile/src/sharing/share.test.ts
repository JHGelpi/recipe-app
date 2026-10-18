import { afterEach, expect, it, vi } from 'vitest';
import { shareFile, shareOrCopy } from './share';

const refused = (name: string) => Object.assign(new Error(name), { name });

afterEach(() => {
  vi.unstubAllGlobals();
});

it('copies when Safari refuses the share sheet after a wait (Final 6)', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', {
    share: vi.fn(async () => {
      throw refused('NotAllowedError');
    }),
    clipboard: { writeText },
  });
  expect(await shareOrCopy({ title: 'Soup', text: 'Soup: link' })).toBe('copied');
  expect(writeText).toHaveBeenCalledWith('Soup: link');
});

it('does nothing more when the person cancels the share sheet', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', {
    share: vi.fn(async () => {
      throw refused('AbortError');
    }),
    clipboard: { writeText },
  });
  expect(await shareOrCopy({ title: 'Soup', text: 'x' })).toBe('cancelled');
  expect(writeText).not.toHaveBeenCalled();
});

it('downloads the PDF when Safari refuses to share the file (Final 6)', async () => {
  const click = vi.fn();
  vi.stubGlobal('navigator', {
    canShare: () => true,
    share: vi.fn(async () => {
      throw refused('NotAllowedError');
    }),
  });
  vi.stubGlobal('document', {
    createElement: () => ({ click, remove: () => {} }),
    body: { append: () => {} },
  });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} });
  const file = { name: 'Soup.pdf' } as File;
  expect(await shareFile(file, 'Soup')).toBe('downloaded');
  expect(click).toHaveBeenCalled();
});
