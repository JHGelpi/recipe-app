import { importTextSchema, importUrlSchema } from '@recipe-app/domain';

export type ImportSource = { type: 'text'; text: string } | { type: 'url'; url: string };
export type SourceResult = { ok: true; source: ImportSource } | { ok: false; message: string };

/** The Import screen's input as a source, or the reason it cannot be one. */
export function importSourceFrom(kind: 'text' | 'url', input: string): SourceResult {
  const parsed = (kind === 'text' ? importTextSchema : importUrlSchema).safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the input' };
  }
  return {
    ok: true,
    source:
      kind === 'text' ? { type: 'text', text: parsed.data } : { type: 'url', url: parsed.data },
  };
}
