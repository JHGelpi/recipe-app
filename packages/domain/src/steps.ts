export type Step = { id: string; text: string };

// "1. ", "2) ", "Step 3: ", "step 4 - ": numbering the app adds itself.
const NUMBERING = /^(?:step\s*)?\d+\s*[.):-]\s*/i;

/** One step per non-empty line, numbering removed; an unchanged step keeps its id. */
export function stepsFromText(text: string, previous: Step[], newId: () => string): Step[] {
  const unused = new Map<string, string[]>();
  for (const step of previous) unused.set(step.text, [...(unused.get(step.text) ?? []), step.id]);
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' ').replace(NUMBERING, '').trim())
    .filter((line) => line !== '')
    .map((line) => ({ id: unused.get(line)?.shift() ?? newId(), text: line }));
}

export function stepsToText(steps: Step[]): string {
  return steps.map((step) => step.text).join('\n');
}
