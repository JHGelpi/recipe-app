const KEEP = new Set(['asparagus', 'couscous', 'molasses', 'swiss', 'hummus', 'glass', 'grass']);

// -ves plurals of words ending in -f; other -ves words (olives, cloves) just drop the s.
const VES = new Map([
  ['leaves', 'leaf'],
  ['loaves', 'loaf'],
  ['halves', 'half'],
  ['calves', 'calf'],
  ['shelves', 'shelf'],
  ['wolves', 'wolf'],
]);
// -ies plurals of words ending in -ie, not -y.
const IE = new Set(['cookies', 'pies', 'brownies', 'smoothies', 'ties', 'calories']);

/** Simple English singulars, for merging list items and "1 egg" (FR-23, FR-33). */
export function singular(word: string): string {
  if (KEEP.has(word) || word.length <= 3) return word;
  const ves = VES.get(word);
  if (ves) return ves;
  if (IE.has(word)) return word.slice(0, -1);
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  // peaches, radishes, boxes, glasses: the plural adds -es.
  if (/(ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s') && !/(ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
