export const TITLE_MAX = 200;

export const RECIPE_LIMITS = {
  servings: [1, 999],
  minutes: [0, 10000],
  ingredients: 200,
  steps: 100,
  tags: 30,
  tagLength: 40,
  notes: 10000,
} as const;
