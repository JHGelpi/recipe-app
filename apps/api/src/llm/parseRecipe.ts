import type Anthropic from '@anthropic-ai/sdk';
import { DRAFT_FIELDS, toImportDraft, UNITS, type ImportDraft } from '@recipe-app/domain';
import prompt from './prompts/parse-recipe.v1.md';

export const PARSE_PROMPT_VERSION = 'parse-recipe.v1';
const SOURCE_MAX = 30_000;

export type ParseRequest = { system: string; user: string };

const nullable = (type: string) => ({ type: [type, 'null'] });

/** The forced tool whose input is the draft (spec §4). Its output is still validated (rule 7). */
export const RECORD_RECIPE_TOOL: Anthropic.Tool = {
  name: 'record_recipe',
  description: 'Record the recipe found in the source, or say there is none.',
  input_schema: {
    type: 'object',
    properties: {
      is_recipe: { type: 'boolean', description: 'False when the source contains no recipe.' },
      title: { type: 'string' },
      servings: nullable('integer'),
      prep_minutes: nullable('integer'),
      cook_minutes: nullable('integer'),
      ingredients: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            raw: { type: 'string' },
            quantity: nullable('number'),
            quantity_max: nullable('number'),
            unit: { type: ['string', 'null'], enum: [...UNITS, null] },
            item: { type: 'string' },
            note: nullable('string'),
            heading: { type: 'boolean' },
          },
          required: ['raw', 'quantity', 'quantity_max', 'unit', 'item', 'note', 'heading'],
        },
      },
      steps: { type: 'array', items: { type: 'string' } },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
      author: nullable('string'),
      low_confidence: { type: 'array', items: { type: 'string', enum: [...DRAFT_FIELDS] } },
    },
    required: [
      'is_recipe',
      'title',
      'servings',
      'prep_minutes',
      'cook_minutes',
      'ingredients',
      'steps',
      'tags',
      'author',
      'low_confidence',
    ],
  },
};

export function buildParseRequest(
  source: { text: string; url: string | null },
  householdTags: string[],
): ParseRequest {
  // The source must not be able to end its own block and talk to the model.
  const text = source.text.slice(0, SOURCE_MAX).replace(/<\/source>/gi, '</ source>');
  const tags = householdTags.length > 0 ? householdTags.join(', ') : '(none yet)';
  const user = [
    source.url ? `Source page: ${source.url}` : 'Source: text pasted by the cook',
    `Tags this household already uses: ${tags}`,
    '<source>',
    text,
    '</source>',
  ].join('\n');
  return { system: prompt, user };
}

export type ParseOutcome =
  { kind: 'draft'; draft: ImportDraft } | { kind: 'not_a_recipe' } | { kind: 'invalid_output' };

/** The model's tool input, untrusted (rule 7), as an outcome. */
export function interpretToolInput(input: unknown): ParseOutcome {
  if (typeof input !== 'object' || input === null) return { kind: 'invalid_output' };
  if ((input as { is_recipe?: unknown }).is_recipe === false) return { kind: 'not_a_recipe' };
  const draft = toImportDraft(input);
  return draft ? { kind: 'draft', draft } : { kind: 'invalid_output' };
}
