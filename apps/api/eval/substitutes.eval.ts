import { existsSync } from 'node:fs';
import { toSubstitutionAnswer, type Ingredient } from '@recipe-app/domain';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { costMicroUsd, createGateway } from '../src/llm/gateway';
import { buildSubstituteRequest, RECORD_SUBSTITUTES_TOOL } from '../src/llm/suggestSubstitutes';

// ADR-0005: real substitution answers with the owner's key, by hand
// (`pnpm eval:import`). Skipped when there is no key.
if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig({ ...process.env, DATABASE_URL: 'unused', JWT_SECRET: 'unused' });

const line = (id: string, raw: string): Ingredient => ({
  id,
  raw,
  quantity: null,
  quantity_max: null,
  unit: null,
  item: raw,
  note: null,
  heading: false,
});
const cases = [
  {
    name: 'buttermilk in a cake',
    expectOptions: true,
    recipe: {
      title: 'Buttermilk Snack Cake',
      servings: 9,
      ingredients: [
        line('a', '2 cups flour'),
        line('b', '1 cup buttermilk'),
        line('c', '1 tsp baking soda'),
        line('d', '1 cup sugar'),
      ],
      steps: [
        { text: 'Whisk the dry ingredients.' },
        { text: 'Stir in the buttermilk.' },
        { text: 'Bake at 350°F for 30 minutes.' },
      ],
    },
    target: 'b',
  },
  {
    name: 'eggs in a custard',
    expectOptions: false,
    recipe: {
      title: 'Baked Vanilla Custard',
      servings: 4,
      ingredients: [line('a', '4 eggs'), line('b', '2 cups whole milk'), line('c', '½ cup sugar')],
      steps: [
        { text: 'Whisk eggs, milk and sugar.' },
        { text: 'Bake in a water bath until just set.' },
      ],
    },
    target: 'a',
  },
  {
    name: 'soy sauce in a stir-fry',
    expectOptions: true,
    recipe: {
      title: 'Chicken and Broccoli Stir-Fry',
      servings: 4,
      ingredients: [
        line('a', '1 lb chicken thighs'),
        line('b', '3 tbsp soy sauce'),
        line('c', '2 cups broccoli'),
      ],
      steps: [{ text: 'Stir-fry the chicken.' }, { text: 'Add broccoli and soy sauce; toss.' }],
    },
    target: 'b',
  },
];

describe.skipIf(!config.ai.apiKey)('substitutes eval (real Claude)', () => {
  const gateway = createGateway({ ...config.ai, baseUrl: null });
  let total = 0;

  it.each(cases)('$name', async ({ recipe, target, expectOptions }) => {
    const call = await gateway.callTool(
      buildSubstituteRequest(recipe, target),
      RECORD_SUBSTITUTES_TOOL,
    );
    const answer = toSubstitutionAnswer(call.input);
    const cost = costMicroUsd(call.usage, config.ai);
    total += cost;
    console.log(
      `\n=== ${recipe.title} ($${(cost / 1e6).toFixed(4)}, total $${(total / 1e6).toFixed(4)})\n` +
        JSON.stringify(answer, null, 2),
    );
    expect(answer).not.toBeNull();
    if (expectOptions) expect(answer!.options.length).toBeGreaterThanOrEqual(2);
    else expect(answer!.note).toBeTruthy();
  });
});
