import type Anthropic from '@anthropic-ai/sdk';
import type { Ingredient } from '@recipe-app/domain';
import type { ParseRequest } from './parseRecipe';
import prompt from './prompts/suggest-substitutes.v1.md';

export const SUBSTITUTE_PROMPT_VERSION = 'suggest-substitutes.v1';
const RECIPE_MAX = 20_000;

export type SubstituteRecipe = {
  title: string;
  servings: number | null;
  ingredients: Ingredient[];
  steps: { text: string }[];
};

/** The strict tool whose input is the answer (spec §6). Still validated (rule 7). */
export const RECORD_SUBSTITUTES_TOOL: Anthropic.Tool = {
  name: 'record_substitutes',
  description:
    'Record the substitutes for the marked ingredient. Always call this tool exactly once.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      options: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            substitute: { type: 'string' },
            amount: { type: 'string' },
            how: { type: 'string' },
            effect: { type: 'string' },
          },
          required: ['substitute', 'amount', 'how', 'effect'],
        },
      },
      note: { type: ['string', 'null'] },
    },
    required: ['options', 'note'],
  },
};

export function buildSubstituteRequest(
  recipe: SubstituteRecipe,
  ingredientId: string,
): ParseRequest & { user: string } {
  const target = recipe.ingredients.find((line) => line.id === ingredientId);
  const lines = recipe.ingredients.map(
    (line) => `- ${line.raw}${line.id === ingredientId ? '  ← replace this' : ''}`,
  );
  const body = [
    `Title: ${recipe.title}`,
    `Servings: ${recipe.servings ?? 'not given'}`,
    'Ingredients:',
    ...lines,
    'Steps:',
    ...recipe.steps.map((step, index) => `${index + 1}. ${step.text}`),
  ]
    .join('\n')
    .slice(0, RECIPE_MAX)
    // The recipe must not be able to end its own block and talk to the model.
    .replace(/<\/recipe>/gi, '</ recipe>');
  const user = ['<recipe>', body, '</recipe>', `Ingredient to replace: ${target?.raw ?? ''}`].join(
    '\n',
  );
  return { system: prompt, user };
}
