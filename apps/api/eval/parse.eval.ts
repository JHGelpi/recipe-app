import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { pageText } from '../src/import/html';
import { costMicroUsd, createGateway } from '../src/llm/gateway';
import { buildParseRequest, interpretToolInput, RECORD_RECIPE_TOOL } from '../src/llm/parseRecipe';

// ADR-0005: a small set of real samples, parsed by the real Claude API with
// the key in .env, to catch regressions when the prompt or model changes.
// Run by hand: `pnpm eval:import`. Skipped when there is no key.
if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig({ ...process.env, DATABASE_URL: 'unused', JWT_SECRET: 'unused' });
const dir = new URL('./samples/', import.meta.url);
const samples = readdirSync(dir)
  .filter((name) => /\.(txt|html)$/.test(name))
  .sort();

describe.skipIf(!config.ai.apiKey)('parse eval (real Claude)', () => {
  const gateway = createGateway({ ...config.ai, baseUrl: null });
  let total = 0;

  it.each(samples)('%s', async (name) => {
    const raw = readFileSync(new URL(name, dir), 'utf8');
    const text = name.endsWith('.html') ? pageText(raw) : raw;
    const request = buildParseRequest({ text, url: null }, ['dinner', 'quick']);
    const call = await gateway.callTool(request, RECORD_RECIPE_TOOL);
    const outcome = interpretToolInput(call.input);
    const cost = costMicroUsd(call.usage, config.ai);
    total += cost;
    console.log(
      `\n=== ${name} ($${(cost / 1e6).toFixed(4)}, total $${(total / 1e6).toFixed(4)})\n` +
        JSON.stringify(outcome, null, 2),
    );
    expect(outcome.kind).toBe(name.startsWith('not-recipe') ? 'not_a_recipe' : 'draft');
  });
});
