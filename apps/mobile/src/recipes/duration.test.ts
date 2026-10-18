import { expect, it } from 'vitest';
import { durationLabel } from './duration';

it.each([
  [5, '5 min'],
  [45, '45 min'],
  [60, '1 h'],
  [95, '1 h 35 min'],
])('%i minutes reads "%s"', (minutes, label) => {
  expect(durationLabel(minutes)).toBe(label);
});
