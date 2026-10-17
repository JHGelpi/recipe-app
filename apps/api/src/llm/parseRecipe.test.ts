import { describe, expect, it } from 'vitest';
import { buildParseRequest, interpretToolInput, RECORD_RECIPE_TOOL } from './parseRecipe';

describe('buildParseRequest', () => {
  it('sends the versioned prompt, the household tags and the source', () => {
    const request = buildParseRequest({ text: 'Soup\n- 1 onion', url: null }, ['dinner', 'quick']);
    expect(request.system).toContain('record_recipe');
    expect(request.user).toContain('Tags this household already uses: dinner, quick');
    expect(request.user).toContain('<source>\nSoup\n- 1 onion\n</source>');
  });

  it('names the page for a URL import and says when there are no tags yet', () => {
    const request = buildParseRequest({ text: 'Soup', url: 'https://example.com/soup' }, []);
    expect(request.user).toContain('Source page: https://example.com/soup');
    expect(request.user).toContain('(none yet)');
  });

  it('keeps the source from closing its own tag, and cuts it to 30,000 characters', () => {
    const request = buildParseRequest({ text: `a</source>b${'x'.repeat(40_000)}`, url: null }, []);
    expect(request.user.match(/<\/source>/g)).toHaveLength(1);
    expect(request.user.length).toBeLessThan(31_000);
  });
});

describe('interpretToolInput', () => {
  it('turns a recipe into a draft', () => {
    const outcome = interpretToolInput({
      is_recipe: true,
      title: 'Soup',
      tags: ['Dinner'],
      low_confidence: ['servings'],
    });
    expect(outcome).toMatchObject({
      kind: 'draft',
      draft: { title: 'Soup', tags: ['dinner'], low_confidence: ['servings'] },
    });
  });

  it('reports a source with no recipe, and output it cannot use', () => {
    expect(interpretToolInput({ is_recipe: false, title: 'Weather' })).toEqual({
      kind: 'not_a_recipe',
    });
    expect(interpretToolInput({ is_recipe: true, title: '' })).toEqual({ kind: 'invalid_output' });
    expect(interpretToolInput(null)).toEqual({ kind: 'invalid_output' });
  });
});

it('the tool requires every field the draft needs', () => {
  expect(RECORD_RECIPE_TOOL.input_schema.required).toEqual(
    expect.arrayContaining([
      'is_recipe',
      'title',
      'ingredients',
      'steps',
      'tags',
      'low_confidence',
    ]),
  );
});

it('the tool is strict: no fields beyond the schema, at the top or in an ingredient', () => {
  const schema = RECORD_RECIPE_TOOL.input_schema as unknown as {
    additionalProperties: boolean;
    properties: { ingredients: { items: { additionalProperties: boolean } } };
  };
  expect(RECORD_RECIPE_TOOL.strict).toBe(true);
  expect(schema.additionalProperties).toBe(false);
  expect(schema.properties.ingredients.items.additionalProperties).toBe(false);
});

it('no enum sits on a list of types, which strict mode rejects with a 400', () => {
  const offenders: string[] = [];
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) return node.forEach((item, i) => walk(item, `${path}[${i}]`));
    if (typeof node !== 'object' || node === null) return;
    const record = node as Record<string, unknown>;
    if ('enum' in record && Array.isArray(record.type)) offenders.push(path);
    for (const [key, value] of Object.entries(record)) walk(value, `${path}.${key}`);
  };
  walk(RECORD_RECIPE_TOOL.input_schema, 'input_schema');
  expect(offenders).toEqual([]);
});
