// apps/mobile/src/ui/chipBar.test.ts
import { describe, expect, it } from 'vitest';
import { chipBarEdges, chipBarPage } from './chipBarScroll';

describe('chipBarEdges', () => {
  it('no buttons when the content fits', () => {
    expect(chipBarEdges(0, 358, 300)).toEqual({ left: false, right: false });
    expect(chipBarEdges(0, 358, 358)).toEqual({ left: false, right: false });
  });
  it('only › at the start of a long bar', () => {
    expect(chipBarEdges(0, 358, 1612)).toEqual({ left: false, right: true });
  });
  it('both in the middle, only ‹ at the end (within a pixel)', () => {
    expect(chipBarEdges(400, 358, 1612)).toEqual({ left: true, right: true });
    expect(chipBarEdges(1253.5, 358, 1612)).toEqual({ left: true, right: false });
  });
});

describe('chipBarPage', () => {
  it('moves three quarters of the bar and stops at the ends', () => {
    expect(chipBarPage(0, 400, 1600, 1)).toBe(300);
    expect(chipBarPage(1100, 400, 1600, 1)).toBe(1200);
    expect(chipBarPage(200, 400, 1600, -1)).toBe(0);
  });
});
