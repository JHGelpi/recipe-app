import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { PHOTO_LIMITS } from '@recipe-app/domain';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { pageText } from '../src/import/html';
import { costMicroUsd, createGateway } from '../src/llm/gateway';
import { buildPhotoRequest } from '../src/llm/parsePhoto';
import { buildParseRequest, interpretToolInput, RECORD_RECIPE_TOOL } from '../src/llm/parseRecipe';
import { jpegInfo } from '../src/photos/jpeg';

// ADR-0005: a small set of real samples, parsed by the real Claude API with
// the key in .env, to catch regressions when the prompt or model changes.
// Run by hand: `pnpm eval:import`. Skipped when there is no key.
if (existsSync('.env')) process.loadEnvFile('.env');
const config = loadConfig({ ...process.env, DATABASE_URL: 'unused', JWT_SECRET: 'unused' });
const dir = new URL('./samples/', import.meta.url);
const samples = readdirSync(dir)
  .filter((name) => /\.(txt|html)$/.test(name))
  .sort();

// FR-43: nutrition only as stated per serving. Every other sample states none,
// so any value there was estimated; nutrition-total gives only a whole-pot
// figure, which must not be divided.
const NUTRITION: Record<string, unknown> = {
  'nutrition-panel.txt': { calories: 420, protein_g: 32, carbs_g: 45, fat_g: 11 },
};

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
    if (outcome.kind === 'draft') {
      expect(outcome.draft.nutrition ?? null).toEqual(NUTRITION[name] ?? null);
    }
  });

  // Photos: <name>-1.jpg, <name>-2.jpg … are the pages of one recipe, in order.
  const photoDir = new URL('./samples/photos/', import.meta.url);
  const groups = new Map<string, string[]>();
  for (const name of readdirSync(photoDir).filter((file) => /-\d+\.jpe?g$/i.test(file))) {
    const recipe = name.replace(/-\d+\.jpe?g$/i, '');
    groups.set(recipe, [...(groups.get(recipe) ?? []), name]);
  }
  const pageNumber = (name: string) => Number(/-(\d+)\.jpe?g$/i.exec(name)?.[1]);

  it.each([...groups.entries()].sort())('photos: %s', async (recipe, names) => {
    const pages = names
      .sort((a, b) => pageNumber(a) - pageNumber(b))
      .map((name) => new Uint8Array(readFileSync(new URL(name, photoDir))));
    for (const [index, bytes] of pages.entries()) {
      expect(
        bytes.byteLength,
        `${names[index]} is over 3 MB: export it at about 1600 px`,
      ).toBeLessThanOrEqual(PHOTO_LIMITS.bytes);
      expect(jpegInfo(bytes), `${names[index]} is not a JPEG`).not.toBeNull();
    }
    const started = Date.now();
    const call = await gateway.callTool(
      buildPhotoRequest(pages, ['dinner', 'quick']),
      RECORD_RECIPE_TOOL,
    );
    const seconds = (Date.now() - started) / 1000;
    const outcome = interpretToolInput(call.input);
    const cost = costMicroUsd(call.usage, config.ai);
    total += cost;
    console.log(
      `\n=== photos ${recipe} (${pages.length} pages, ${seconds.toFixed(1)} s, $${(cost / 1e6).toFixed(4)}, total $${(total / 1e6).toFixed(4)})\n` +
        JSON.stringify(outcome, null, 2),
    );
    expect(outcome.kind).toBe(recipe.startsWith('not-recipe') ? 'not_a_recipe' : 'draft');
    // None of the photo samples states nutrition (FR-43).
    if (outcome.kind === 'draft') expect(outcome.draft.nutrition ?? null).toBeNull();
    expect(seconds, 'NFR-6: a photo parse under 30 s').toBeLessThan(30);
  });
});
