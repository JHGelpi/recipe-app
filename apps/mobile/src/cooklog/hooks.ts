import { useQuery } from '@powersync/react';
import { cookHistory, localDay } from '@recipe-app/domain';
import { useMemo } from 'react';
import {
  DIARY_SQL,
  ENTRY_PHOTOS_SQL,
  ENTRY_SQL,
  MEMBER_EMAILS_SQL,
  RECIPE_HISTORY_SQL,
  TRASHED_ENTRIES_SQL,
} from './repository';

export type DiaryItem = {
  id: string;
  recipe_id: string | null;
  title: string;
  cooked_on: string;
  cooked_by: string | null;
  notes: string | null;
  photo_id: string | null;
};

export type Entry = DiaryItem & { deleted_at: string | null; recipe_live: number | null };

/** FR-40: the household's entries, newest first; one recipe's when `recipeId` is set. */
export function useDiary(recipeId: string | null): DiaryItem[] {
  return useQuery<DiaryItem>(DIARY_SQL, [recipeId, recipeId]).data;
}

/** undefined while loading, null when this phone has no such entry. */
export function useEntry(id: string): Entry | null | undefined {
  const { data, isLoading } = useQuery<Entry>(ENTRY_SQL, [id]);
  if (isLoading) return undefined;
  return data[0] ?? null;
}

export function useEntryPhotos(id: string): string[] {
  const { data } = useQuery<{ id: string }>(ENTRY_PHOTOS_SQL, [id]);
  return useMemo(() => data.map((row) => row.id), [data]);
}

/** FR-41: "Cooked 4 times · last on Oct 22", or null. */
export function useCookHistory(recipeId: string): string | null {
  const { data } = useQuery<{ cooked_on: string }>(RECIPE_HISTORY_SQL, [recipeId]);
  return useMemo(() => cookHistory(data, localDay(new Date())), [data]);
}

export function useTrashedEntries(): {
  id: string;
  title: string;
  cooked_on: string;
  deleted_at: string;
}[] {
  return useQuery<{ id: string; title: string; cooked_on: string; deleted_at: string }>(
    TRASHED_ENTRIES_SQL,
  ).data;
}

/** Who cooked: "You", a member's email, or "A former member". */
export function useCookName(userId: string): (cookedBy: string | null) => string {
  const { data } = useQuery<{ user_id: string; email: string | null }>(MEMBER_EMAILS_SQL);
  return useMemo(() => {
    const emails = new Map(data.map((row) => [row.user_id, row.email]));
    return (cookedBy) => {
      if (cookedBy === userId) return 'You';
      return (cookedBy && emails.get(cookedBy)) || 'A former member';
    };
  }, [data, userId]);
}
