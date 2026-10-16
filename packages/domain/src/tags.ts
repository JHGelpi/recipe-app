/** Comma-separated input to clean, lowercase, unique tags, in the order typed. */
export function normalizeTags(input: string): string[] {
  const tags: string[] = [];
  for (const part of input.split(',')) {
    const tag = part.trim().replace(/\s+/g, ' ').toLowerCase();
    if (tag !== '' && !tags.includes(tag)) tags.push(tag);
  }
  return tags;
}
