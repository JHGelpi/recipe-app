import { isRetryable, type ImportError } from '@recipe-app/domain';
import type { ImportRecord } from './rows';

export const IMPORT_ERROR_MESSAGES: Record<ImportError, string> = {
  quota: "Over this month's AI limit",
  ai_unavailable: "Couldn't reach the AI service",
  fetch_failed: "Couldn't open that page. Try pasting the recipe text instead.",
  blocked_address: "That link can't be imported",
  not_a_recipe: "This doesn't look like a recipe",
  invalid_output: "Couldn't read this recipe",
  photo_unreadable: "Couldn't read the photos",
};

export type ImportView = { label: string; canReview: boolean; canRetry: boolean; busy: boolean };

/** What the Imports list shows for one import (spec §6). */
export function importView(record: ImportRecord, online: boolean): ImportView {
  const none = { canReview: false, canRetry: false, busy: false };
  // Spec §6: a photo import's pages upload before it is read. Dismiss stays
  // available, so a page the server refuses never strands the import.
  if (
    record.source_type === 'photo' &&
    record.status === 'pending' &&
    record.uploaded < record.pages
  ) {
    if (record.localPending === 0) {
      return { ...none, label: 'Waiting for photos from another device' };
    }
    return online
      ? { ...none, label: `Uploading photos (${record.uploaded} of ${record.pages})` }
      : { ...none, label: 'Waiting to go online' };
  }
  if (record.status === 'ready') {
    return record.draft
      ? { ...none, label: 'Ready to review', canReview: true }
      : { ...none, label: 'This import could not be read' };
  }
  if (record.status === 'failed') {
    const error = record.error ?? 'ai_unavailable';
    return { ...none, label: IMPORT_ERROR_MESSAGES[error], canRetry: isRetryable(error) };
  }
  return online
    ? { ...none, label: 'Reading…', busy: true }
    : { ...none, label: 'Waiting to go online' };
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
