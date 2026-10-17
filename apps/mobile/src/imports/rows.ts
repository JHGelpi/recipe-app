import {
  IMPORT_ERRORS,
  IMPORT_STATUSES,
  toImportDraft,
  type ImportDraft,
  type ImportError,
  type ImportStatus,
} from '@recipe-app/domain';

export type ImportRecord = {
  id: string;
  source_type: 'text' | 'url' | 'photo';
  source_text: string | null;
  source_url: string | null;
  status: ImportStatus;
  error: ImportError | null;
  draft: ImportDraft | null;
  parse_started_at: string | null;
  created_at: string | null;
  /** Photo imports: live pages, pages on the server, pages this phone still has to send, and the first page. */
  pages: number;
  uploaded: number;
  localPending: number;
  firstPage: string | null;
};

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function draftOf(value: unknown): ImportDraft | null {
  if (typeof value !== 'string' || value === '') return null;
  try {
    // Lenient on purpose: a draft from a newer or older server still reads
    // when it can, instead of failing a strict schema.
    return toImportDraft(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

/** A local imports row, or null when it is not an import this app knows how to show. */
export function importFromRow(row: Record<string, unknown>): ImportRecord | null {
  if (typeof row.id !== 'string') return null;
  if (row.source_type !== 'text' && row.source_type !== 'url' && row.source_type !== 'photo') {
    return null;
  }
  const status = (IMPORT_STATUSES as readonly unknown[]).includes(row.status)
    ? (row.status as ImportStatus)
    : 'pending';
  const error = (IMPORT_ERRORS as readonly unknown[]).includes(row.error)
    ? (row.error as ImportError)
    : null;
  return {
    id: row.id,
    source_type: row.source_type,
    source_text: textOrNull(row.source_text),
    source_url: textOrNull(row.source_url),
    status,
    error,
    draft: draftOf(row.draft),
    parse_started_at: textOrNull(row.parse_started_at),
    created_at: textOrNull(row.created_at),
    pages: Number(row.pages ?? 0),
    uploaded: Number(row.uploaded ?? 0),
    localPending: Number(row.local_pending ?? 0),
    firstPage: textOrNull(row.first_page),
  };
}

const PREVIEW_MAX = 80;

/** The import's first line, or its link, for the list. */
export function importPreview(record: ImportRecord): string {
  if (record.source_type === 'photo') {
    return `Photo · ${record.pages} ${record.pages === 1 ? 'page' : 'pages'}`;
  }
  if (record.source_type === 'url') return record.source_url ?? '';
  const first =
    (record.source_text ?? '')
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? '';
  return first.length > PREVIEW_MAX ? `${first.slice(0, PREVIEW_MAX - 1)}…` : first;
}
