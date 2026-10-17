import {
  draftToRecipeFields,
  isHttpUrl,
  type DraftField,
  type ImportDraft,
} from '@recipe-app/domain';
import type { RecipeForm } from '../recipes/form';
import { NO_SOURCE, type RecipeRecord } from '../recipes/rows';
import type { ImportRecord } from './rows';

const FORM_FIELD: Record<DraftField, keyof RecipeForm> = {
  title: 'title',
  servings: 'servings',
  prep_minutes: 'prep',
  cook_minutes: 'cook',
  ingredients: 'ingredients',
  steps: 'steps',
  tags: 'tags',
};

/** The draft as an unsaved recipe, so the editor can open it like any recipe. */
export function draftRecord(
  record: ImportRecord,
  draft: ImportDraft,
  householdId: string,
  newId: () => string,
): RecipeRecord {
  return {
    id: record.id,
    household_id: householdId,
    ...draftToRecipeFields(draft, newId),
    notes: '',
    deleted_at: null,
    photo_id: null,
    ...NO_SOURCE,
  };
}

/** FR-11: the editor fields to highlight. */
export function flaggedFields(draft: ImportDraft): (keyof RecipeForm)[] {
  return draft.low_confidence.map((field) => FORM_FIELD[field]);
}

/** The site name of an http(s) link, for "From example.com"; null for anything else. */
export function linkHost(url: string | null): string | null {
  if (!url || !isHttpUrl(url)) return null;
  return new URL(url).hostname.replace(/^www\./, '');
}
