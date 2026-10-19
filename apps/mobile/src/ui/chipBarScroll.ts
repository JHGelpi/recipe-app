// apps/mobile/src/ui/chipBar.ts
// Scroll positions for a sideways chip bar (bug batch spec §2). Pure, so the
// button logic is tested without a browser.

const SLACK = 1; // sub-pixel scroll positions never show a button

/** Which ends have chips hidden past them. */
export function chipBarEdges(
  offset: number,
  viewport: number,
  content: number,
): { left: boolean; right: boolean } {
  const max = Math.max(0, content - viewport);
  return { left: offset > SLACK, right: offset < max - SLACK };
}

/** The offset after a ‹ or › press: three quarters of the bar, within the ends. */
export function chipBarPage(
  offset: number,
  viewport: number,
  content: number,
  direction: 1 | -1,
): number {
  const max = Math.max(0, content - viewport);
  return Math.min(max, Math.max(0, offset + direction * Math.round(viewport * 0.75)));
}
