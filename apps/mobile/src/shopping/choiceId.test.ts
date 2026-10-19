import { expect, it } from 'vitest';
import { aisleChoiceId, uuidV5 } from './choiceId';

it('makes RFC 4122 version 5 UUIDs (the standard test vector)', async () => {
  // DNS namespace, "www.example.com" (RFC 4122 / Python uuid docs).
  expect(await uuidV5('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'www.example.com')).toBe(
    '2ed6657d-e927-568b-95e1-2665a8aea6a2',
  );
});

it('gives every phone the same id for a household’s choice, and different ones otherwise (review I3)', async () => {
  const a = await aisleChoiceId('h1', 'lemon');
  expect(await aisleChoiceId('h1', 'lemon')).toBe(a);
  expect(await aisleChoiceId('h1', 'lime')).not.toBe(a);
  expect(await aisleChoiceId('h2', 'lemon')).not.toBe(a);
  expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
