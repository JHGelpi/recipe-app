import { isRetryable, type ImportError } from '@recipe-app/domain';
import { parseTimestamp } from '../recipes/rows';
import type { ParseRequestOutcome } from './api';
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

const sameUtcMonth = (a: number, b: number) =>
  new Date(a).getUTCFullYear() === new Date(b).getUTCFullYear() &&
  new Date(a).getUTCMonth() === new Date(b).getUTCMonth();

/** What the Imports list shows for one import (spec §6). */
export function importView(record: ImportRecord, online: boolean, now = Date.now()): ImportView {
  const none = { canReview: false, canRetry: false, busy: false };
  if (record.status === 'unknown') return { ...none, label: 'Update the app to see this import' };
  if (record.source_type === 'photo' && record.status === 'pending') {
    // A tab closed mid-save leaves an import with no pages: nothing will come.
    if (record.pages === 0) return { ...none, label: 'No photos were saved' };
    if (record.uploaded < record.pages) {
      if (record.refused > 0) return { ...none, label: "Couldn't upload a photo" };
      if (record.localPending === 0) {
        return { ...none, label: 'Waiting for photos from another device' };
      }
      return online
        ? { ...none, label: `Uploading photos (${record.uploaded} of ${record.pages})` }
        : { ...none, label: 'Waiting to go online' };
    }
  }
  if (record.status === 'ready') {
    return record.draft
      ? { ...none, label: 'Ready to review', canReview: true }
      : { ...none, label: 'This import could not be read' };
  }
  if (record.status === 'failed') {
    const error = record.error ?? 'ai_unavailable';
    const started = parseTimestamp(record.parse_started_at);
    if (error === 'quota' && started !== null && sameUtcMonth(started, now)) {
      return { ...none, label: "Over this month's AI limit. Try again next month." };
    }
    if (error === 'photo_unreadable') {
      // The phone cannot send the file again, so trying again would fail the same way.
      return {
        ...none,
        label: "Couldn't read the photos. Dismiss this import and add the photos again.",
      };
    }
    return { ...none, label: IMPORT_ERROR_MESSAGES[error], canRetry: isRetryable(error) };
  }
  return online
    ? { ...none, label: 'Reading…', busy: true }
    : { ...none, label: 'Waiting to go online' };
}

/** The "+" badge: ready drafts this app can open. */
export function readyCount(records: ImportRecord[]): number {
  return records.filter((record) => record.status === 'ready' && record.draft !== null).length;
}

export function retryMessage(outcome: ParseRequestOutcome): string | null {
  if (outcome === 'started' || outcome === 'busy') return null;
  if (outcome === 'not_found') return 'This import is no longer on the server';
  return "Couldn't start it again. Check your connection and try again.";
}

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
