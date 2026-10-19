// apps/mobile/src/cooking/steps.ts
/** Under the steps when servings or scale changed (FR-22). */
export function stepsNote(servings: number | null): string {
  return servings !== null
    ? `Amounts in steps are for the original ${servings} servings`
    : 'Amounts in steps are for the original recipe';
}

/** The step to show: a live edit can remove steps while cook mode is open. */
export function shownStep(step: number, count: number): number {
  return Math.max(0, Math.min(step, count - 1));
}
