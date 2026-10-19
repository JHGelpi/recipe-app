# Bug batch PR 1: App screens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the owner's tag bar report and every deferred app-screen finding listed in spec §2.

**Architecture:**
- Small, independent fixes, grouped by area into tasks.
- **Pure logic** goes in `packages/domain` or a small `.ts` file beside the screen, and gets a unit test. Screens change only to call it.
- **New pieces:**
  - one UI component, `ChipBar`;
  - one Playwright project, `firefox`, which runs only `@firefox`-tagged tests;
  - no new dependencies.

**Tech Stack:** Expo / React Native Web, PowerSync web, Vitest, Playwright (Chromium, plus Firefox in CI), Hono API with postgres.js.

**Spec:** `docs/superpowers/specs/2026-10-19-bug-batch-design.md` (§2, and the PR 1 parts of §6 and §7)

## Global Constraints

- **CLAUDE.md:**
  - no color literals outside `src/theme`;
  - no `react-native` `Text`/`TextInput` outside `src/ui`;
  - TypeScript strict, and no `any` without a comment;
  - Conventional Commits that name requirement IDs.
- **Branch:** `fix/app-screens`; the PR goes against `main`.
- **Database:** never run `pnpm db:reset`; seed rows are inserted by hand if needed. Never run dev or test commands against the `dishkept` project.
- **After test runs:** `pnpm dev:backend`, then `docker compose restart sync`.
- **Copy (exact):**
  - "Scroll tags left", "Scroll tags right";
  - "The list is empty.";
  - "Items can be up to 200 characters.";
  - "This recipe is no longer on the server.";
  - "Photo not downloaded yet";
  - "Amounts in steps are for the original N servings".
- **Viewers** never see write controls (rule 4).
- **Offline:** every list and recipe write stays a local write (rule 3).

## Review Focus

1. **Tag bar, no overflow:** when the tags fit (one or two tags) or the window is wide, neither scroll button shows and the wheel scrolls the page as before. *Pinned by the unit test "no buttons when the content fits" (Task 1) and the e2e "few tags: no scroll buttons" (Task 1).*
2. **Tag bar after a filter change:** when chips are added or removed (selecting a tag moves it first), the buttons follow the new width without a manual scroll. *Pinned by the e2e "selecting a tag keeps the buttons right" (Task 1).*
3. **Clear ticked with a line partly ticked:** the partly ticked line stays on the list, its amount counting only unticked rows. *Pinned by the unit test "a partly ticked line counts only what is still to buy" (Task 3) and the repository test "clears only the rows of fully ticked lines" (Task 4).*
4. **Line sheet when the line disappears:** another phone clears the line while its sheet is open; the sheet closes instead of acting on missing rows. *Pinned by the pure test "openLine is null once the key is gone" (Task 4).*
5. **Add to list in metric with tiny amounts:** "⅛ tsp salt" in metric shows "a pinch of salt" on the sheet, so the list gets "a pinch", not "1 ml". *Pinned by the unit test "adds a pinch where the sheet shows one" (Task 3).*

---

### Task 1: ChipBar: the tag bar scrolls with buttons, the wheel, and an edge fade

**Files:**
- Create: `apps/mobile/src/ui/chipBar.ts`
- Create: `apps/mobile/src/ui/chipBar.test.ts`
- Create: `apps/mobile/src/ui/ChipBar.tsx`
- Modify: `apps/mobile/src/ui/index.ts`
- Modify: `apps/mobile/src/theme/colors.ts` (add `fade`)
- Modify: `apps/mobile/src/screens/RecipeListScreen.tsx:61-79`
- Modify: `playwright.config.ts`
- Modify: `.github/workflows/ci.yml:63`
- Create: `e2e/tagbar.spec.ts`
- Modify: `ARCHITECTURE.md` (UI kit list)

**Interfaces:**
- Produces:
  - `chipBarEdges(offset: number, viewport: number, content: number): { left: boolean; right: boolean }`;
  - `chipBarPage(offset: number, viewport: number, content: number, direction: 1 | -1): number`;
  - `<ChipBar label: string>{children}</ChipBar>`.

- [ ] **Step 1: Write the failing unit test**

```ts
// apps/mobile/src/ui/chipBar.test.ts
import { describe, expect, it } from 'vitest';
import { chipBarEdges, chipBarPage } from './chipBar';

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
```

- [ ] **Step 2: Run it to verify it fails**

Run: `rtk vitest run apps/mobile/src/ui/chipBar.test.ts`
Expected: FAIL, "Failed to resolve import './chipBar'".

- [ ] **Step 3: Implement the logic**

```ts
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
```

- [ ] **Step 4: Run it to verify it passes**

Run: `rtk vitest run apps/mobile/src/ui/chipBar.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the fade color**

In `apps/mobile/src/theme/colors.ts`, after `scrim`:

```ts
  // The tag bar's edge fade: the background, fully transparent.
  fade: 'rgba(14, 18, 26, 0)',
```

- [ ] **Step 6: Write the component**

```tsx
// apps/mobile/src/ui/ChipBar.tsx
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, ScrollView, View, type ViewStyle } from 'react-native';
import { colors, space } from '../theme';
import { chipBarEdges, chipBarPage } from './chipBar';
import { IconButton } from './IconButton';

type Size = { offset: number; viewport: number; content: number };

// Web only: react-native-web passes CSS gradients through; ViewStyle has no type for them.
const fade = (to: 'left' | 'right') =>
  ({
    backgroundImage: `linear-gradient(to ${to}, ${colors.fade}, ${colors.bg})`,
  }) as unknown as ViewStyle;

/**
 * A sideways row of chips (bug batch spec §2). It scrolls by touch, the
 * keyboard, ‹ › buttons at an end with chips hidden past it, and on web a
 * vertical mouse wheel, so it works where swiping does not.
 */
export function ChipBar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<ScrollView>(null);
  const [size, setSize] = useState<Size>({ offset: 0, viewport: 0, content: 0 });
  const edges = chipBarEdges(size.offset, size.viewport, size.content);

  // A vertical wheel scrolls the bar sideways while it overflows (web).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = (
      ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth) return;
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      node.scrollLeft += event.deltaY;
      event.preventDefault();
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const page = (direction: 1 | -1) =>
    ref.current?.scrollTo({
      x: chipBarPage(size.offset, size.viewport, size.content, direction),
      animated: true,
    });

  return (
    <View aria-label={label} role="group" style={{ flexDirection: 'row', alignItems: 'center' }}>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: space.sm }}
        style={{ flexGrow: 1, flexShrink: 1 }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          const { contentOffset } = event.nativeEvent;
          setSize((current) => ({ ...current, offset: contentOffset.x }));
        }}
        onLayout={(event) => {
          const viewport = event.nativeEvent.layout.width;
          setSize((current) => ({ ...current, viewport }));
        }}
        onContentSizeChange={(content) => setSize((current) => ({ ...current, content }))}
      >
        {children}
      </ScrollView>
      {edges.left ? (
        <View
          style={{ position: 'absolute', left: 0, flexDirection: 'row', alignItems: 'center' }}
        >
          <View style={{ backgroundColor: colors.bg }}>
            <IconButton icon="chevron-back" label="Scroll tags left" filled onPress={() => page(-1)} />
          </View>
          <View pointerEvents="none" style={[{ width: space.lg, height: 36 }, fade('left')]} />
        </View>
      ) : null}
      {edges.right ? (
        <View
          style={{ position: 'absolute', right: 0, flexDirection: 'row', alignItems: 'center' }}
        >
          <View pointerEvents="none" style={[{ width: space.lg, height: 36 }, fade('right')]} />
          <View style={{ backgroundColor: colors.bg }}>
            <IconButton
              icon="chevron-forward"
              label="Scroll tags right"
              filled
              onPress={() => page(1)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}
```

Note: the `fade('left')` gradient on the ‹ side runs from the background (under the button) to transparent toward the chips, so `to left` is correct there: `linear-gradient(to left, transparent, bg)` puts the background at the left edge. The › side is the mirror image.

In `apps/mobile/src/ui/index.ts`, add `export { ChipBar } from './ChipBar';`.

- [ ] **Step 7: Use it on the list**

In `RecipeListScreen.tsx`:
- replace the `<ScrollView horizontal …>…</ScrollView>` block (lines 62–78) with `<ChipBar label="Tags">…the same chips…</ChipBar>`;
- add `ChipBar` to the `../ui` import;
- drop `ScrollView` from the `react-native` import.

- [ ] **Step 8: Add the Firefox project and CI install**

Replace the `projects` line in `playwright.config.ts`:

```ts
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // The owner uses Firefox (bug batch spec §6). CI runs the @firefox-tagged
    // tests there; locally set E2E_FIREFOX=1 once Firefox and its libraries
    // are installed (or use the Playwright Docker image).
    ...(process.env.CI || process.env.E2E_FIREFOX
      ? [{ name: 'firefox', grep: /@firefox/, use: { ...devices['Desktop Firefox'] } }]
      : []),
  ],
```

In `.github/workflows/ci.yml` line 63:

```yaml
      - run: pnpm exec playwright install --with-deps chromium firefox
```

- [ ] **Step 9: Write the e2e tests**

```ts
// e2e/tagbar.spec.ts
import { expect, test } from './fixtures';
import { createRecipe, freshEmail, signIn, unique } from './helpers';

const many = Array.from({ length: 14 }, (_, i) => `tagnumber${i}`).join(', ');
const scroller = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: 'Tags' }).locator('div').first();

test.use({ viewport: { width: 390, height: 800 } });

test('the tag bar scrolls with › and ‹ to the last tag @firefox', async ({ page }) => {
  await signIn(page, freshEmail('tagbar'));
  await createRecipe(page, { title: unique('Tag bar'), tags: many });
  await page.goto('/');
  const last = page.getByRole('button', { name: 'Tag tagnumber9', exact: true });
  await expect(page.getByRole('button', { name: 'Scroll tags left' })).toHaveCount(0);
  await expect(last).not.toBeInViewport();
  const right = page.getByRole('button', { name: 'Scroll tags right' });
  // Press › until the end is reached and the button goes away.
  for (let i = 0; i < 8 && (await right.count()) > 0; i++) {
    await right.click();
    await page.waitForTimeout(300);
  }
  await expect(right).toHaveCount(0);
  // Tags sort as text, so tagnumber9 is the last chip.
  await expect(last).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Scroll tags left' })).toBeVisible();
});

test('a mouse wheel over the tag bar scrolls it sideways @firefox', async ({ page }) => {
  await signIn(page, freshEmail('tagwheel'));
  await createRecipe(page, { title: unique('Tag wheel'), tags: many });
  await page.goto('/');
  const first = page.getByRole('button', { name: 'Tag tagnumber0', exact: true });
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 10, box.y + 10);
  await page.mouse.wheel(0, 400);
  await expect
    .poll(() => scroller(page).evaluate((node) => node.scrollLeft))
    .toBeGreaterThan(100);
});

test('few tags: no scroll buttons', async ({ page }) => {
  await signIn(page, freshEmail('tagfew'));
  await createRecipe(page, { title: unique('Two tags'), tags: 'quick, dinner' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Tag quick', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Scroll tags/ })).toHaveCount(0);
});

test('selecting a tag keeps the buttons right', async ({ page }) => {
  await signIn(page, freshEmail('tagselect'));
  await createRecipe(page, { title: unique('Tag select'), tags: many });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scroll tags right' }).click();
  await page.getByRole('button', { name: 'Tag tagnumber3', exact: true }).click();
  // The selected chip moves first; the bar may jump back to the start.
  await expect(page.getByRole('button', { name: 'Scroll tags right' })).toBeVisible();
});
```

Note: `scroller` finds the bar's scrolling element, which is react-native-web's first `div` inside the group. If the DOM order differs, select by `[style*="overflow"]` instead, and record a ruling.

- [ ] **Step 10: Build and run the e2e tests**

Run: `rtk proxy pnpm test:e2e e2e/tagbar.spec.ts > $W/e2e1.log 2>&1; tail -20 $W/e2e1.log`, where `$W` is the plan's workspace.
Expected: 4 passed.

To see the RED first, `git stash` the RecipeListScreen change and rebuild: the first two tests fail with "Scroll tags right" not found and a `scrollLeft` of 0.

- [ ] **Step 11: Run the @firefox tests in Firefox (Docker)**

The test stack is still up from Step 10:

```bash
docker run --rm --network host -v "$PWD":/work -w /work --ipc=host \
  -e E2E_FIREFOX=1 mcr.microsoft.com/playwright:v1.62.0-noble \
  npx playwright test --project=firefox e2e/tagbar.spec.ts
```

Expected: 2 passed, the two tests tagged @firefox.

- [ ] **Step 12: Docs and commit**

In `ARCHITECTURE.md`, in the UI kit component list, add `ChipBar` (sideways chips with ‹ › buttons, wheel and fade).

```bash
git add apps/mobile/src/ui apps/mobile/src/theme/colors.ts apps/mobile/src/screens/RecipeListScreen.tsx playwright.config.ts .github/workflows/ci.yml e2e/tagbar.spec.ts ARCHITECTURE.md
git commit -m "fix(app): the tag bar scrolls with ‹ › buttons, the mouse wheel and an edge fade (FR-19)"
```

---

### Task 2: The "+" sheet: no lost tap in Firefox, and it closes when the tab bar hides

**Files:**
- Modify: `apps/mobile/src/navigation/AddSheet.tsx`
- Modify: `apps/mobile/src/navigation/TabBar.tsx:87-95`
- Modify: `e2e/tagbar.spec.ts` (an editor test; keeps the @firefox tests together)

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing e2e**

Append to `e2e/tagbar.spec.ts`:

```ts
test('typing into Title right after New recipe keeps every letter @firefox', async ({ page }) => {
  await signIn(page, freshEmail('quicktitle'));
  await page.getByRole('button', { name: /^Add a recipe/ }).click();
  await page.getByRole('button', { name: 'New recipe' }).click();
  const title = page.getByLabel('Title', { exact: true });
  await title.click();
  await page.keyboard.type('Quick');
  await expect(title).toHaveValue('Quick');
});

test('the "+" sheet does not come back after cook mode hid the tab bar', async ({ page }) => {
  await signIn(page, freshEmail('plusback'));
  const name = unique('Plus back');
  await createRecipe(page, { title: name, steps: 'Stir' });
  await page.getByRole('button', { name: 'Cook' }).click();
  await page.goBack();
  await page.getByRole('button', { name: /^Add a recipe/ }).click();
  await page.goForward(); // into cook mode: the tab bar hides
  await page.goBack();
  await expect(page.getByRole('dialog', { name: 'Add a recipe' })).toHaveCount(0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run, Chromium for the second test and Firefox (Docker, as in Task 1 Step 11) for the first:

- `rtk proxy pnpm test:e2e e2e/tagbar.spec.ts -g "tab bar"`
- `… --project=firefox e2e/tagbar.spec.ts -g "Title"`

Expected:
- Chromium FAIL: the dialog is still open (count 1);
- Firefox FAIL: the value is `''`.

If the second test passes on main, cook mode is no longer reached by history. Record a ruling and keep only the unit-level fix in Step 4.

- [ ] **Step 3: Close the sheet at once when choosing**

In `AddSheet.tsx`, add an `instant` state:

```tsx
  // Choosing New recipe or Import hides the sheet at once: while it slid out,
  // its focus trap took the first tap on the next screen (Firefox).
  const [instant, setInstant] = useState(false);
  useEffect(() => {
    if (open) setInstant(false);
  }, [open]);
  const go = (path: '/recipe/new' | '/import') => {
    setInstant(true);
    onClose();
    router.push(path);
  };
```

Then:
- change the Modal to `animationType={instant ? 'none' : 'slide'}`;
- import `useState` from 'react'.

- [ ] **Step 4: Close it when the tab bar hides**

In `TabBar.tsx`, before `if (!claims || !showTabBar(path, true)) return null;`:

```tsx
  const visible = claims !== null && showTabBar(path, true);
  // A sheet left open as the bar hides (cook mode, a photo) must not reappear later.
  useEffect(() => {
    if (!visible) setAdding(false);
  }, [visible]);
```

Then:
- change the early return to `if (!claims || !visible) return null;`;
- import `useEffect`.

- [ ] **Step 5: Run the tests to verify they pass**

Same commands as Step 2.
Expected: PASS in both browsers.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/navigation e2e/tagbar.spec.ts
git commit -m "fix(app): the + sheet hides at once when choosing, and closes with the tab bar (FR-9)"
```

---

### Task 3: Shopping list domain: partly ticked lines, amounts, ties, word list, units added

**Files:**
- Modify: `packages/domain/src/shopping.ts`
- Modify: `packages/domain/src/aisles.ts`
- Modify: `packages/domain/src/cooking.ts` (add `shownAmount`)
- Modify: `apps/mobile/src/components/AddToListSheet.tsx:57`
- Test: `packages/domain/src/shopping.test.ts`
- Test: `packages/domain/src/cooking.test.ts`

**Interfaces:**
- Produces:
  - `shownAmount(ingredient: Ingredient, options: { factor: number; units: UnitSystem }): Pick<Ingredient, 'quantity' | 'quantity_max' | 'unit'>` returns the amount `displayIngredient` shows, and 'pinch' becomes `{ quantity: 1, quantity_max: null, unit: 'pinch' }`;
  - `addRows(recipe, factor, chosen, choices, units: UnitSystem = 'as_written')`;
  - `ShoppingLine` is unchanged in shape: `checked` is still "every row ticked", and `amount` now counts only unticked rows unless every row is ticked.
- Consumes: none.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/src/shopping.test.ts`:

```ts
describe('bug batch (spec §2)', () => {
  it('a partly ticked line counts only what is still to buy', () => {
    const [line] = shoppingLines([
      row({ quantity: 2, checked_at: '2026-10-18T11:00:00Z' }),
      row({ quantity: 1 }),
    ]);
    expect(line!.checked).toBe(false);
    expect(line!.amount).toBe('1');
  });

  it('a fully ticked line shows its whole amount', () => {
    const [line] = shoppingLines([
      row({ quantity: 2, checked_at: '2026-10-18T11:00:00Z' }),
      row({ quantity: 1, checked_at: '2026-10-18T11:00:00Z' }),
    ]);
    expect(line!.amount).toBe('3');
  });

  it('a quantity of 0 shows no amount', () => {
    expect(shoppingLines([row({ quantity: 0 })])[0]!.amount).toBe('');
  });

  it('rows made at the same moment take the name of the lowest id', () => {
    const at = '2026-10-18T10:00:00Z';
    const lines = shoppingLines([
      row({ id: 'b', item: 'Onions', created_at: at }),
      row({ id: 'a', item: 'onion', created_at: at }),
    ]);
    expect(lines[0]!.item).toBe('onion');
  });

  it('a typed amount with no item keeps its text as the item, with no amount', () => {
    const typed = typedRow('2 cups', new Map())!;
    expect(typed).toMatchObject({ item: '2 cups', quantity: null, unit: null });
  });

  it('matches the last two words before the last word', () => {
    expect(aisleFor(itemKey('red bell peppers'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('fresh lemon juice'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('garlic cloves'), new Map())).toBe('produce');
    expect(aisleFor(itemKey('olives'), new Map())).toBe('pantry');
    expect(aisleFor(itemKey('egg yolks'), new Map())).toBe('dairy');
  });

  it('adds what the sheet shows: converted units', () => {
    const milk: Ingredient = {
      id: '11111111-1111-4111-8111-111111111111',
      raw: '1 cup milk',
      quantity: 1,
      quantity_max: null,
      unit: 'cup',
      item: 'milk',
      note: null,
      heading: false,
    };
    const [added] = addRows(
      { id: 'r', title: 'T', ingredients: [milk] },
      1,
      new Set([milk.id]),
      new Map(),
      'metric',
    );
    expect(added).toMatchObject({ unit: 'ml' });
    expect(added!.quantity).toBeCloseTo(236.588, 2);
  });

  it('adds a pinch where the sheet shows one', () => {
    const salt: Ingredient = {
      id: '22222222-2222-4222-8222-222222222222',
      raw: '⅛ tsp salt',
      quantity: 0.125,
      quantity_max: null,
      unit: 'tsp',
      item: 'salt',
      note: null,
      heading: false,
    };
    // Halved, ⅛ tsp is 1/16 tsp: the sheet shows "a pinch of salt".
    const [added] = addRows(
      { id: 'r', title: 'T', ingredients: [salt] },
      0.5,
      new Set([salt.id]),
      new Map(),
      'as_written',
    );
    expect(added).toMatchObject({ quantity: 1, unit: 'pinch' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run packages/domain/src/shopping.test.ts`
Expected: 7 failures:
- amounts "3" and "≈½";
- the item is "Onions";
- the typed amount keeps quantity 2;
- `aisleFor` gives "spices" or "drinks";
- unit "cup";
- "tsp".

The fully ticked test passes already.

- [ ] **Step 3: Implement**

In `cooking.ts`, after `displayIngredient`:

```ts
/** The amount displayIngredient shows, as numbers: what Add to list adds (FR-32). */
export function shownAmount(
  ingredient: Ingredient,
  options: { factor: number; units: UnitSystem },
): Pick<Ingredient, 'quantity' | 'quantity_max' | 'unit'> {
  const scaled = scaleIngredient(ingredient, options.factor);
  if (scaled.heading || scaled.quantity === null) return scaled;
  const fluid = ingredient.unit === 'oz' && /\bfl\.?\s*oz\b|fluid\s+ounce/i.test(ingredient.raw);
  if (!ingredient.item || fluid) return scaled;
  const converted = convertAmount(
    { value: scaled.quantity, max: scaled.quantity_max, unit: scaled.unit },
    options.units,
  );
  const stepped =
    converted.unit !== null && (US_UNITS.has(converted.unit) || METRIC_UNITS.has(converted.unit))
      ? stepUnits(converted)
      : converted;
  if (stepped === 'pinch') return { quantity: 1, quantity_max: null, unit: 'pinch' };
  return { quantity: stepped.value, quantity_max: stepped.max, unit: stepped.unit };
}
```

Note: `displayIngredient` returns the written line unchanged at factor 1 in `as_written`, but `shownAmount` always scales and steps. At factor 1 the two agree, because `stepUnits` only changes amounts that display would also step. 0.0625 tsp steps to `'pinch'` today, through the tsp rule.

In `shopping.ts`:

1. **Imports:** add `shownAmount` and `type UnitSystem` to the `./cooking` import.
2. **`amountOf` callers:** in `shoppingLines`, compute amounts from the rows still to buy:
   ```ts
   const checked = group.every((row) => row.checked_at !== null);
   // A partly ticked line shows only what is left to buy (owner's choice, spec §2).
   const counted = checked ? byAge : byAge.filter((row) => row.checked_at === null);
   ```
   Use `amount: amountOf(counted)` and `checked,`.
3. **Ties:** sort `byAge` with
   `time(a.created_at).localeCompare(time(b.created_at)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)`.
4. **Zero:** in `amountOf`, change the first check to `if (row.quantity === null || row.quantity === 0) {` and set `toTaste` only when `row.quantity === null`:
   ```ts
    if (row.quantity === null || row.quantity === 0) {
      if (row.quantity === null) toTaste = true;
      continue;
    }
   ```
5. **Two-word match:** in `aisleFor`:
   ```ts
  const words = key.split(' ');
  const lastTwo = words.slice(-2).join(' ');
  const last = words.at(-1) ?? key;
  return (AISLE_WORDS[key] ?? AISLE_WORDS[lastTwo] ?? AISLE_WORDS[last] ?? 'other') as Aisle;
   ```
6. **`newRow`:** an item-less line keeps its text and drops the amount:
   ```ts
  const named = ingredient.item.trim() !== '';
  const item = (named ? ingredient.item.trim() : ingredient.raw.trim()).slice(0, SHOPPING_LIMITS.item);
  ...
  const quantity = named ? fits(ingredient.quantity) : null;
   ```
7. **`addRows`:** gains `units: UnitSystem = 'as_written'` and maps with
   `newRow({ ...line, ...shownAmount(line, { factor, units }) }, recipe, choices)`.

In `aisles.ts`, add these entries, inside the existing lists by aisle:
- **produce:** `'bell pepper'` (exists), `'lemon juice'`, `'lime juice'`, `'garlic clove'`;
- **pantry:** `'olive'`;
- **dairy:** `'yolk'`, `'egg yolk'`, `'egg white'`.

Keep the file's grouping style.

In `AddToListSheet.tsx` line 57, call `addRows(recipe, factor, chosen, choices, place.units)`.

- [ ] **Step 4: Run them to verify they pass**

Run: `rtk vitest run packages/domain/src/shopping.test.ts packages/domain/src/cooking.test.ts`
Expected: PASS, with no earlier test broken.

If an earlier test expects a ticked row in a mixed line's amount, it encodes the old behaviour. Update it to the owner's choice and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add packages/domain apps/mobile/src/components/AddToListSheet.tsx
git commit -m "fix(shopping): partly ticked lines count what is left; added amounts match the sheet; two-word aisles (FR-32–FR-34)"
```

---

### Task 4: Shopping list screen: Clear ticked, the Add button, the live line sheet, accessibility and text

**Files:**
- Create: `apps/mobile/src/shopping/screen.ts`
- Create: `apps/mobile/src/shopping/screen.test.ts`
- Modify: `apps/mobile/src/shopping/repository.ts:72-78`
- Modify: `apps/mobile/src/shopping/repository.test.ts:59-72`
- Modify: `apps/mobile/src/screens/ShoppingListScreen.tsx`
- Modify: `apps/mobile/src/components/ShoppingLineSheet.tsx`
- Modify: `apps/mobile/src/components/AddToListSheet.tsx`
- Modify: `apps/mobile/src/screens/RecipeScreen.tsx` (the banner timer)
- Modify: `e2e/shopping.spec.ts` (lines 39 and 122 use role button; the line is now a group)

**Interfaces:**
- Produces:
  - `addButton(count: number): { label: string; disabled: boolean }`;
  - `openLine(lines: ShoppingLine[], key: string | null): ShoppingLine | null`;
  - `typedError(text: string): string | null`;
  - `clearTicked(db, claims, lines: ShoppingLine[])`, which now takes lines.
- Consumes: `ShoppingLine` from Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/shopping/screen.test.ts
import type { ShoppingLine } from '@recipe-app/domain';
import { describe, expect, it } from 'vitest';
import { addButton, openLine, typedError } from './screen';

const line = (key: string): ShoppingLine => ({
  key,
  item: key,
  aisle: 'produce',
  amount: '',
  recipes: [],
  handAdded: true,
  checked: false,
  rowIds: [`${key}-1`],
});

describe('the add sheet button', () => {
  it('names the count and is disabled at zero', () => {
    expect(addButton(3)).toEqual({ label: 'Add 3 items', disabled: false });
    expect(addButton(1)).toEqual({ label: 'Add 1 item', disabled: false });
    expect(addButton(0)).toEqual({ label: 'Add 0 items', disabled: true });
  });
});

describe('the open line', () => {
  it('follows the live line, and is null once the key is gone', () => {
    const fresh = { ...line('onion'), amount: '3' };
    expect(openLine([fresh], 'onion')).toBe(fresh);
    expect(openLine([line('lemon')], 'onion')).toBeNull();
    expect(openLine([fresh], null)).toBeNull();
  });
});

describe('typed items', () => {
  it('says why a long item is not added', () => {
    expect(typedError('x'.repeat(201))).toBe('Items can be up to 200 characters.');
    expect(typedError('2 lemons')).toBeNull();
  });
});
```

In `repository.test.ts`, replace the `clearTicked(db, member)` call in "ticks, unticks, removes and clears" with
`await clearTicked(db, member, [{ ...lineFor(['a', 'b']), checked: true }, { ...lineFor(['c']), checked: false }]);`.
Add a helper at the top of the file:

```ts
const lineFor = (rowIds: string[]) => ({
  key: 'k', item: 'k', aisle: 'produce' as const, amount: '', recipes: [],
  handAdded: true, checked: true, rowIds,
});
```

Then add the test:

```ts
  it('clears only the rows of fully ticked lines', async () => {
    const { db, calls } = fakeDb();
    await clearTicked(db, member, [
      { ...lineFor(['a', 'b']), checked: true },
      { ...lineFor(['c']), checked: false },
    ]);
    expect(calls.at(-1)!.params.slice(1)).toEqual(['a', 'b']);
  });
```

Use the file's existing fake db helper name. Read the top of `repository.test.ts` first; if it is not `fakeDb`, use that name.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run apps/mobile/src/shopping`
Expected: FAIL with "Failed to resolve import './screen'", and the repository call's params are `[now]` with no ids.

- [ ] **Step 3: Implement**

```ts
// apps/mobile/src/shopping/screen.ts
import { SHOPPING_LIMITS, type ShoppingLine } from '@recipe-app/domain';

/** The add sheet's button (shopping spec §3): dimmed and inert at zero. */
export function addButton(count: number): { label: string; disabled: boolean } {
  return { label: `Add ${count} ${count === 1 ? 'item' : 'items'}`, disabled: count === 0 };
}

/** The line a sheet is open for, read live; null once another phone removed it. */
export function openLine(lines: ShoppingLine[], key: string | null): ShoppingLine | null {
  return key === null ? null : (lines.find((line) => line.key === key) ?? null);
}

export function typedError(text: string): string | null {
  return text.trim().length > SHOPPING_LIMITS.item ? 'Items can be up to 200 characters.' : null;
}
```

In `repository.ts`, replace `clearTicked`:

```ts
/** Removes fully ticked lines only; a partly ticked line stays whole (spec §2). */
export async function clearTicked(db: Db, claims: Claims, lines: ShoppingLine[]): Promise<void> {
  const ids = lines.filter((line) => line.checked).flatMap((line) => line.rowIds);
  if (ids.length === 0) return;
  await removeRows(db, claims, ids);
}
```

Then:
- add `type ShoppingLine` to the domain import;
- keep `requireWriter` running even with no ids: put `requireWriter(claims);` first.

**In `ShoppingListScreen.tsx`:**
- **Open line:** replace `useState<ShoppingLine | null>` with `const [openKey, setOpenKey] = useState<string | null>(null);` and `const open = openLine(lines, openKey);`. Add
  ```tsx
  useEffect(() => {
    if (openKey !== null && open === null) setOpenKey(null);
  }, [openKey, open]);
  ```
- **Add:** `addTyped` first sets `const error = typedError(text); if (error) { setMessage(error); return; }`.
- **Clear ticked** calls `clearTicked(db, claims, lines)`.
- **Line view:** the middle `Pressable` gets `focusable={false}` and loses `role="button"`. The outer row `View` gets `role="group"` and `aria-label={`${line.item}${line.amount ? `, ${line.amount}` : ''}`}`; move the label off the Pressable. Its `onPress` becomes `() => setOpenKey(line.key)`, and so does More's.
- **Empty list:** `{writer ? 'Your list is empty. Add ingredients from a recipe, or type an item above.' : 'The list is empty.'}`.
- **Sheet:** `<ShoppingLineSheet claims={claims} line={open} onClose={() => setOpenKey(null)} />`.

**In `ShoppingLineSheet.tsx`:** the title becomes `<Text variant="h2" role="heading" aria-level={2}>{line.item}</Text>`.

**In `AddToListSheet.tsx`:**
- the title becomes a heading the same way;
- the button uses `const button = addButton(chosen.size);`, then `label={button.label}` and `disabled={button.disabled}`. Remove `aria-disabled`: `Button` sets it from `disabled`.

**In `RecipeScreen.tsx`:** the banner clears after 4 seconds or on the next Add to list. Replace `onPress={() => setAdding(true)}` with
`onPress={() => { setAdded(0); setAdding(true); }}` and add, after the state hooks:

```tsx
  useEffect(() => {
    if (added === 0) return;
    const timer = setTimeout(() => setAdded(0), 4000);
    return () => clearTimeout(timer);
  }, [added]);
```

Import `useEffect`. This hook must run before `if (recipe === undefined) return null;` (rules of hooks).

**In `e2e/shopping.spec.ts`:** lines 39 and 122 become `page.getByRole('group', { name: 'onion, 3' })` and `page.getByRole('group', { name: 'onions, 4' })`. Any `getByRole('button', { name: /^<item>,/ })` that clicks a line becomes `getByRole('button', { name: 'More for <item>' })`; search the file for such clicks.

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `rtk vitest run apps/mobile/src/shopping`
Expected: PASS.

- [ ] **Step 5: Add an e2e for Clear ticked on a mixed line, and run the shopping e2e tests**

Append to `e2e/shopping.spec.ts`:

```ts
test('Clear ticked leaves a partly ticked line whole (FR-35)', async ({ page }) => {
  await signIn(page, freshEmail('shop-mixed'));
  await createRecipe(page, { title: unique('Mixed A'), ingredients: '2 onions' });
  await addFromRecipe(page);
  await openList(page);
  await page.getByRole('button', { name: 'Got onions' }).click();
  await page.getByLabel('Add an item').fill('1 onion');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  // One ticked row and one new row: the line is to buy, showing only the new one.
  await expect(page.getByRole('group', { name: 'onions, 1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clear ticked' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Got onions' }).click();
  await page.getByRole('button', { name: 'Clear ticked' }).click();
  await expect(page.getByRole('group', { name: /^onions/ })).toHaveCount(0);
});
```

Note: with one ticked row, the line shows in its aisle, not in Got it, so "Clear ticked" (shown only when a line is fully ticked) is absent. That matches the `got` filter. If the spec's "appears when anything is ticked" is read as rows, record a ruling: lines, matching the owner's choice.

Run: `rtk proxy pnpm test:e2e e2e/shopping.spec.ts > $W/e2e4.log 2>&1; tail -20 $W/e2e4.log`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src e2e/shopping.spec.ts
git commit -m "fix(shopping): Clear ticked keeps partly ticked lines; dimmed Add, live line sheet, one tab stop, clearer text (FR-32, FR-35)"
```

---

### Task 5: Shopping list server: the 500-row cap under concurrent uploads, and the Viewer aisle_choices test

**Files:**
- Modify: `apps/api/src/upload/ops.ts:185-190`
- Test: `apps/api/tests/upload/shopping.test.ts`
- Test: `apps/api/tests/rls/shopping.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Write the failing API test**

Add after "a full list refuses new rows with list_full" in `apps/api/tests/upload/shopping.test.ts`; `upload`, `fresh` and `adminSql` are that file's own helpers:

```ts
it('phones uploading at once cannot pass 500 live rows', async () => {
  const cook = await fresh();
  await adminSql`
    insert into public.shopping_items (id, household_id, item, item_key, aisle)
    select gen_random_uuid(), ${cook.householdId}, 'x', 'x', 'other' from generate_series(1, 498)`;
  const one = () => [
    {
      op: 'put',
      table: 'shopping_items',
      id: randomUUID(),
      data: { household_id: cook.householdId, item: 'more', item_key: 'more', aisle: 'other' },
    },
  ];
  const results = await Promise.all(Array.from({ length: 5 }, () => upload(cook, one())));
  const [count] = await adminSql<{ live: number }[]>`
    select count(*)::int as live from public.shopping_items
    where household_id = ${cook.householdId} and deleted_at is null`;
  expect(count!.live).toBe(500);
  expect(results.flatMap((r) => r.results).filter((r) => r.status === 'applied')).toHaveLength(2);
});
```

- [ ] **Step 2: Run it to verify it fails**

The stack must be up in test mode, `pnpm dev:backend:test`.
Run: `rtk proxy pnpm test:api -- shopping > $W/api5.log 2>&1; tail -20 $W/api5.log`
Expected: FAIL, live is over 500 (up to 503). Concurrent counts each see 498.

If it passes by chance, rerun it three times. Count it RED if any run is over 500; record it as a timing-dependent RED.

- [ ] **Step 3: Implement**

In `ops.ts`, inside `if (!existing) {`, before the count:

```ts
      // Concurrent uploads count one at a time per household, so the cap holds (spec §2).
      await tx`select pg_advisory_xact_lock(hashtext(${`shopping_items:${String(fields.household_id)}`}))`;
```

- [ ] **Step 4: Write the RLS test for aisle choices**

Append inside `describe('shopping list tables', …)` in `apps/api/tests/rls/shopping.test.ts`:

```ts
  it('viewers cannot insert or update aisle choices', async () => {
    const member = await signInAs(SEED.memberA);
    const viewer = await signInAs(SEED.viewerA);
    const choice = {
      id: randomUUID(),
      household_id: member.householdId,
      item_key: `viewer-test-${randomUUID()}`,
      aisle: 'pantry',
    };
    await as(member, (tx) => tx`insert into public.aisle_choices ${tx(choice)}`);
    expect(
      await refusalCode(
        as(viewer, (tx) =>
          tx`insert into public.aisle_choices ${tx({ ...choice, id: randomUUID(), item_key: `v-${randomUUID()}` })}`,
        ),
      ),
    ).toBe('42501');
    const updated = await as(
      viewer,
      (tx) => tx`update public.aisle_choices set aisle = 'other' where id = ${choice.id} returning id`,
    );
    expect(updated).toHaveLength(0);
  });
```

This test pins existing RLS. It passes at once, which is expected for a coverage test; note that in the ledger.

- [ ] **Step 5: Run both suites to verify they pass**

Run: `rtk proxy pnpm test:api -- shopping` and `rtk proxy pnpm test:rls -- shopping`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "fix(api): the 500-row list cap holds under concurrent uploads; test: viewers cannot write aisle choices (FR-31, FR-34)"
```

---

### Task 6: Search and the recipe list: folding, sorting, tags, live regions, cached rows, the clear-search flash

**Files:**
- Modify: `packages/domain/src/search.ts`
- Test: `packages/domain/src/search.test.ts`
- Modify: `apps/mobile/src/recipes/rows.ts:145-158` (normalized tags)
- Create: `apps/mobile/src/recipes/listRows.ts`
- Create: `apps/mobile/src/recipes/listRows.test.ts`
- Modify: `apps/mobile/src/recipes/hooks.ts:35-40`
- Modify: `apps/mobile/src/screens/RecipeListScreen.tsx`
- Modify: `apps/mobile/src/screens/EditRecipeScreen.tsx:37-41`
- Modify: `apps/mobile/src/screens/ReviewImportScreen.tsx:110-114`
- Test: `apps/mobile/src/recipes/rows.test.ts`

**Interfaces:**
- Produces: `listRowsFrom(rows: Record<string, unknown>[], cache: Map<string, { stamp: string; row: ListRow }>): Map<string, ListRow>`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/domain/src/search.test.ts`:

```ts
describe('bug batch (spec §2)', () => {
  const src = (id: string, title: string): SearchSource => ({ id, title, ingredients: [], tags: [] });

  it('folds ligatures, full-width letters and ß', () => {
    expect(normalizeSearchText('ﬁsh')).toBe('fish');
    expect(normalizeSearchText('ＡＢＣ')).toBe('abc');
    expect(normalizeSearchText('Straße')).toBe('strasse');
  });

  it('keeps marks outside Latin, Greek and Cyrillic', () => {
    expect(normalizeSearchText('ガ')).toBe('ガ');
    expect(normalizeSearchText('क़')).toBe('क़'.normalize('NFC'));
    expect(normalizeSearchText('Éclair')).toBe('eclair');
  });

  it('sorts accented titles with their letter', () => {
    const index = buildSearchIndex([src('1', 'Zucchini'), src('2', 'Éclair'), src('3', 'Apple')]);
    expect(searchRecipes(index, '', [])).toEqual(['3', '2', '1']);
  });

  it('a word starting after a digit or symbol counts as a word start', () => {
    const index = buildSearchIndex([
      // Ids reversed, so only the word-start bonus can put '2cups' first.
      { id: 'b', title: 'x', ingredients: ['2cups milk'], tags: [] },
      { id: 'a', title: 'x', ingredients: ['teacups milk'], tags: [] },
    ]);
    expect(searchRecipes(index, 'cups', [])).toEqual(['b', 'a']);
  });
});
```

Append to `apps/mobile/src/recipes/rows.test.ts`:

```ts
describe('listRowFrom tags', () => {
  it('trims, lowercases and drops empty tags', () => {
    expect(listRowFrom({ id: '1', title: 't', tags: '[" Quick ", "", "dinner"]' }).tags).toEqual([
      'quick',
      'dinner',
    ]);
  });
});
```

```ts
// apps/mobile/src/recipes/listRows.test.ts
import { describe, expect, it } from 'vitest';
import { listRowsFrom } from './listRows';
import type { ListRow } from './rows';

describe('listRowsFrom', () => {
  it('reuses a row whose columns did not change, and rereads one that did', () => {
    const cache = new Map<string, { stamp: string; row: ListRow }>();
    const a = { id: 'a', title: 'A', tags: '["x"]', ingredients: '[]' };
    const b = { id: 'b', title: 'B', tags: '["y"]', ingredients: '[]' };
    const first = listRowsFrom([a, b], cache);
    const second = listRowsFrom([{ ...a }, { ...b, tags: '["z"]' }], cache);
    expect(second.get('a')).toBe(first.get('a'));
    expect(second.get('b')!.tags).toEqual(['z']);
  });

  it('forgets removed rows', () => {
    const cache = new Map<string, { stamp: string; row: ListRow }>();
    listRowsFrom([{ id: 'a', title: 'A' }], cache);
    listRowsFrom([], cache);
    expect(cache.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run packages/domain/src/search.test.ts apps/mobile/src/recipes`
Expected: FAIL:
- 'ﬁsh' unchanged;
- 'Straße' gives 'straße';
- Japanese loses its dakuten ('カ');
- the order puts Éclair last;
- 'b' outranks or ties 'a' (ids sort ['a','b'] only by score);
- the tags are untrimmed;
- `listRows` does not resolve.

- [ ] **Step 3: Implement**

In `search.ts`:

```ts
// Marks are stripped only from these scripts' letters; elsewhere (Japanese,
// Indic scripts) a mark changes the letter (spec §2).
const FOLDED = /([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}])\p{M}+/gu;

/** Lowercase, compatibility forms folded, Latin/Greek/Cyrillic accents removed, whitespace collapsed. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(FOLDED, '$1')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}
```

Then:
- in `buildSearchIndex`, use `sortKey: normalizeSearchText(recipe.title),`;
- change `BOUNDARY` to `const BOUNDARY = /[\s\p{P}\p{N}\p{S}]/u;`.

In `rows.ts` `listRowFrom`, change the tags line to:

```ts
    tags: listOf(row.tags).flatMap((tag) => {
      const clean = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
      return clean ? [clean] : [];
    }),
```

Create the row cache:

```ts
// apps/mobile/src/recipes/listRows.ts
import { listRowFrom, type ListRow } from './rows';

const COLUMNS = ['title', 'tags', 'ingredients', 'photo_id', 'prep_minutes', 'cook_minutes'];

/**
 * List rows by id, reading only rows whose columns changed since the last
 * call (NFR-6): a change to one recipe no longer re-parses every row's tags.
 */
export function listRowsFrom(
  rows: Record<string, unknown>[],
  cache: Map<string, { stamp: string; row: ListRow }>,
): Map<string, ListRow> {
  const out = new Map<string, ListRow>();
  for (const raw of rows) {
    const id = String(raw.id);
    const stamp = COLUMNS.map((column) => String(raw[column] ?? '')).join('\u0000');
    const hit = cache.get(id);
    const row = hit && hit.stamp === stamp ? hit.row : listRowFrom(raw);
    if (row !== hit?.row) cache.set(id, { stamp, row });
    out.set(id, row);
  }
  for (const id of cache.keys()) if (!out.has(id)) cache.delete(id);
  return out;
}
```

In `hooks.ts` `useRecipeSearch`, add:
- `const cache = useRef(new Map<string, { stamp: string; row: ListRow }>());`
- `const rows = useMemo(() => listRowsFrom(recipeRows, cache.current), [recipeRows]);`

Also import `useRef`, `listRowsFrom` and `type ListRow`.

**In `RecipeListScreen.tsx`:**
- `const filtering = deferredQuery.trim() !== '' || selected.length > 0;`. It is computed from what the results used, so clearing a no-match search never flashes the empty text.
- The count line becomes:

  ```tsx
      <Text variant="small" tone="muted" aria-live="polite">
        {filtering && items.length > 0
          ? items.length === 1
            ? '1 recipe'
            : `${items.length} recipes`
          : ''}
      </Text>
  ```

  It stays mounted, so screen readers hear changes.

**After a new recipe is saved, the filters clear:**
- In `EditRecipeScreen.tsx`'s `onSave`, after `createRecipe` and only when `id` is null, add `clearFilter();`, imported from `'../recipes/listFilter'`.
- In `ReviewImportScreen.tsx`, after `saveImportedRecipe`, add `clearFilter();`.

- [ ] **Step 4: Run them to verify they pass**

Run: `rtk vitest run packages/domain apps/mobile/src/recipes`
Expected: PASS.

- [ ] **Step 5: e2e for the new-recipe filter**

Append to `e2e/search.spec.ts`:

```ts
test('a new recipe shows even after an unrelated search (FR-19)', async ({ page }) => {
  await signIn(page, freshEmail('search-new'));
  await page.getByLabel('Search recipes').fill('zzzz-nothing');
  const title = unique('Fresh after search');
  await createRecipe(page, { title });
  await page.getByRole('link', { name: 'Recipes' }).click();
  await expect(page.getByLabel('Search recipes')).toHaveValue('');
  await expect(page.getByText(title, { exact: true })).toBeVisible();
});
```

Run: `rtk proxy pnpm test:e2e e2e/search.spec.ts`
Expected: PASS. Use the file's imports, adding `createRecipe` and `unique` if missing.

- [ ] **Step 6: Commit**

```bash
git add packages/domain apps/mobile/src e2e/search.spec.ts
git commit -m "fix(search): fold ligatures and ß, keep non-Latin marks, sort by folded title, tidy tags; cached list rows; no empty flash (FR-19, NFR-6)"
```

---

### Task 7: Editor and favorites: double saves, double stars, line-numbered errors, forward-compatible rows, the fraction slash

**Files:**
- Modify: `apps/mobile/src/components/RecipeEditor.tsx:37-63`
- Modify: `apps/mobile/src/recipes/repository.ts:103-124`
- Test: `apps/mobile/src/recipes/repository.test.ts`
- Modify: `apps/mobile/src/recipes/form.ts:114-119`
- Test: `apps/mobile/src/recipes/form.test.ts`
- Modify: `apps/mobile/src/recipes/rows.ts:49-66`
- Test: `apps/mobile/src/recipes/rows.test.ts`
- Modify: `packages/domain/src/ingredients.ts` (the parse entry)
- Test: `packages/domain/src/ingredients.test.ts`

**Interfaces:** none shared.

- [ ] **Step 1: Write the failing tests**

`repository.test.ts`: read its fake db first. Add:

```ts
it('a fast double tap on the star makes one favorite row', async () => {
  const { db, calls } = fakeDb(); // the file's helper; getOptional returns rows inserted so far
  await Promise.all([
    setFavorite(db, member, 'recipe-1', true),
    setFavorite(db, member, 'recipe-1', true),
  ]);
  expect(calls.filter((c) => c.sql.startsWith('insert into favorites'))).toHaveLength(1);
});
```

If the fake's `getOptional` does not see earlier inserts, extend the fake: `getOptional` returns `{ id }` once an `insert into favorites` call has been recorded. Keep the change inside the test file.

`form.test.ts`:

```ts
it('names the line that is too long', () => {
  const result = valuesFromForm(
    { ...emptyForm(), title: 'T', ingredients: `1 egg\n2 eggs\n${'x'.repeat(501)}`, steps: `a\n${'y'.repeat(2001)}`, tags: 'ok, ' + 'z'.repeat(41) },
    null,
    () => crypto.randomUUID(),
  );
  expect(result).toMatchObject({
    ok: false,
    errors: {
      ingredients: 'Ingredient 3 is over 500 characters',
      steps: 'Step 2 is over 2000 characters',
      tags: 'Tag 2 is over 40 characters',
    },
  });
});
```

`rows.test.ts`:

```ts
it('reads an ingredient with a field from a newer app, and an unknown unit as its raw text', () => {
  const recipe = rowToRecipe({
    id: '11111111-1111-4111-8111-111111111111',
    household_id: '22222222-2222-4222-8222-222222222222',
    title: 'Future',
    ingredients: JSON.stringify([
      { id: '33333333-3333-4333-8333-333333333333', raw: '2 cups flour', quantity: 2, quantity_max: null, unit: 'cup', item: 'flour', note: null, heading: false, brand: 'Acme' },
      { id: '44444444-4444-4444-8444-444444444444', raw: '3 sprigs thyme', quantity: 3, quantity_max: null, unit: 'sprig', item: 'thyme', note: null, heading: false },
    ]),
    steps: JSON.stringify([{ id: '55555555-5555-4555-8555-555555555555', text: 'Mix', timer: 60 }]),
  });
  expect(recipe).not.toBeNull();
  expect(recipe!.ingredients[1]).toMatchObject({ raw: '3 sprigs thyme', quantity: null, unit: null });
  expect(recipe!.steps[0]).toEqual({ id: '55555555-5555-4555-8555-555555555555', text: 'Mix' });
});
```

`ingredients.test.ts`:

```ts
it('reads the fraction slash', () => {
  expect(parseIngredientLine('1⁄2 cup milk')).toMatchObject({ quantity: 0.5, unit: 'cup', item: 'milk', raw: '1⁄2 cup milk' });
  expect(parseIngredientLine('1 1⁄2 cups milk')).toMatchObject({ quantity: 1.5, unit: 'cup' });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run apps/mobile/src/recipes packages/domain/src/ingredients.test.ts`
Expected: FAIL:
- two inserts;
- zod default messages ("Too big: expected string to have <=500 characters");
- `null` for the future recipe;
- quantity null for the fraction slash.

- [ ] **Step 3: Implement**

**`RecipeEditor.tsx`:** add `const saving = useRef(false);` and import `useRef`. In `save()`, replace the guard with

```ts
    if (saving.current) return; // a double tap in one frame must not save twice
    ...
    saving.current = true;
    setBusy(true);
```

In the `catch`, set `saving.current = false;` before `setBusy(false)`.

**`repository.ts`** `setFavorite`: serialise per recipe:

```ts
// One star change at a time per recipe: a double tap must not insert two rows.
const starChains = new Map<string, Promise<void>>();

export function setFavorite(db: Db, claims: Claims, recipeId: string, starred: boolean): Promise<void> {
  const key = `${claims.userId}:${recipeId}`;
  const next = (starChains.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => writeFavorite(db, claims, recipeId, starred));
  starChains.set(key, next);
  return next;
}
```

Rename the existing function body to `async function writeFavorite(...)`, unchanged.

**`form.ts`:** replace the error loop:

```ts
const LINE_NAME: Record<string, string> = { ingredients: 'Ingredient', steps: 'Step', tags: 'Tag' };

function messageFor(issue: { path: PropertyKey[]; code: string; maximum?: unknown; message: string }): string | null {
  const [field, index] = issue.path;
  const name = LINE_NAME[String(field)];
  if (name && typeof index === 'number' && issue.code === 'too_big') {
    return `${name} ${index + 1} is over ${String(issue.maximum)} characters`;
  }
  return null;
}
```

Loop body:
`if (field && !errors[field]) errors[field] = NUMBER_MESSAGE[field] ?? messageFor(issue) ?? issue.message;`.
Cast with `issue as unknown as Parameters<typeof messageFor>[0]` if zod's union type is not assignable; add a comment that `too_big` carries `maximum`.

**`rows.ts`:** before `recipeSchema.safeParse`, tidy the lists from newer apps:

```ts
const INGREDIENT_KEYS = ['id', 'raw', 'quantity', 'quantity_max', 'unit', 'item', 'note', 'heading'];

/** A newer app's extra fields are ignored, and an unknown unit reads as raw text (spec §2). */
function tidyIngredients(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) return item;
    const known = Object.fromEntries(
      Object.entries(item).filter(([key]) => INGREDIENT_KEYS.includes(key)),
    ) as Record<string, unknown>;
    if (known.unit !== null && !(UNITS as readonly unknown[]).includes(known.unit)) {
      return { ...known, unit: null, quantity: null, quantity_max: null };
    }
    return known;
  });
}

function tidySteps(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((step) =>
    typeof step === 'object' && step !== null
      ? { id: (step as { id?: unknown }).id, text: (step as { text?: unknown }).text }
      : step,
  );
}
```

Use `ingredients: tidyIngredients(jsonList(row.ingredients))` and `steps: tidySteps(jsonList(row.steps))`. Import `UNITS` from the domain. The upload schema stays strict on the server.

**`ingredients.ts`:** in `parseIngredientLine`, normalise the fraction slash for reading only. The first line of the function, where the text is trimmed, should read the quantity from `text.replace(/⁄/g, '/')`, while `raw` keeps the original. Read the function, then apply the replace to the string the `QUANTITY` regex runs on, not to `raw`.

- [ ] **Step 4: Run them to verify they pass**

Run: `rtk vitest run apps/mobile/src/recipes packages/domain`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src packages/domain
git commit -m "fix(recipes): one save and one star per tap, line-numbered errors, rows from newer apps read, the fraction slash (FR-8, FR-20)"
```

---

### Task 8: Amount display: tiny amounts, count ranges, singular counts, rounded unit steps

**Files:**
- Create: `packages/domain/src/plural.ts` (`singular` moved from shopping.ts)
- Modify: `packages/domain/src/shopping.ts` (import it)
- Modify: `packages/domain/src/cooking.ts`
- Test: `packages/domain/src/cooking.test.ts`

**Interfaces:**
- Produces: `singular(word: string): string` in `plural.ts`, with the same behaviour as today's private function.

- [ ] **Step 1: Write the failing tests**

Append to `cooking.test.ts`:

```ts
describe('bug batch display (spec §2)', () => {
  it('tiny weights and volumes show as a pinch', () => {
    expect(show(line({ raw: '1 oz salt', quantity: 1, unit: 'oz', item: 'salt' }), 0.1, 'us')).toBe('a pinch of salt');
    expect(show(line({ raw: '1 tsp salt', quantity: 1, unit: 'tsp', item: 'salt' }), 0.1, 'metric')).toBe('a pinch of salt');
    expect(show(line({ raw: '5 g yeast', quantity: 5, unit: 'g', item: 'yeast' }), 0.1, 'metric')).toBe('a pinch of yeast');
  });

  it('count ranges read cleanly and take the singular at one', () => {
    const garlic = line({ raw: '1-2 cloves garlic', quantity: 1, quantity_max: 2, unit: 'clove', item: 'garlic' });
    expect(show(garlic, 0.45, 'us')).toBe('½–1 clove garlic');
    const eggs = line({ raw: '2 eggs', quantity: 2, item: 'eggs' });
    expect(show(eggs, 0.5)).toBe('1 egg');
  });

  it('steps up when the rounded value reaches the next unit', () => {
    expect(show(line({ raw: '15.98 oz beans', quantity: 15.98, unit: 'oz', item: 'beans' }), 1, 'us')).toBe('1 lb beans');
    expect(show(line({ raw: '998 g flour', quantity: 998, unit: 'g', item: 'flour' }), 1, 'metric')).toBe('1 kg flour');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run packages/domain/src/cooking.test.ts`
Expected: FAIL with "⅛ oz salt", "1 ml", "1 g", "≈½–≈1 cloves garlic", "1 eggs", "15⅞ oz" or "16 oz", and "1000 g".

- [ ] **Step 3: Implement**

**Move `singular`:** cut it, with `KEEP`, `VES` and `IE`, from `shopping.ts` into `plural.ts` and export it. `shopping.ts` then does `import { singular } from './plural';`.

**`cooking.ts`:**

1. **Rounded checks in `stepUnits`.** Add a helper and use it for every `>=` threshold:
   ```ts
   // The value as formatAmount will show it, so "15.98 oz" steps up like "16 oz".
   function shownValue(value: number, unit: Unit): number {
     if (US_UNITS.has(unit)) return Math.round(value * 8) / 8;
     if (unit === 'g' || unit === 'ml') return value < 100 ? Math.round(value) : Math.round(value / 5) * 5;
     return value;
   }
   const atLeast = (amount: Amount, limit: number) =>
     amount.unit !== null && shownValue(amount.value, amount.unit) >= limit;
   ```
   Replace, for example, `current.value >= 3` with `atLeast(current, 3)`, for tsp, tbsp, g, ml and oz.
2. **Pinches in `stepUnits`.** After the existing tsp pinch line, add:
   ```ts
   if (current.unit === 'oz' && current.value < 0.125) return 'pinch';
   if ((current.unit === 'ml' || current.unit === 'g') && current.value < 1) return 'pinch';
   ```
   Then make `displayIngredient` step metric and oz units too. It already steps US and metric units, so check that the `oz` path reaches `stepUnits`: `US_UNITS` has 'oz', so it does.
3. **Count ranges.** In `displayIngredient` and `formatTotal`, format a range without '≈' on either end, and pick the unit label by the larger end:
   ```ts
   const plainRange = (low: number, high: number, unit: Unit | null) =>
     `${formatAmount(low, unit).replace('≈', '')}–${formatAmount(high, unit).replace('≈', '')}`;
   ```
   Use `plainRange(stepped.value, stepped.max, stepped.unit)` when `stepped.max !== null`. Pass the shown high end to `unitLabel` instead of `'range'`, so `unitLabel(unit, formatAmount(max, unit).replace('≈',''))` gives "clove" at 1 and "cloves" above.
4. **Singular counts.** In `displayIngredient`, when `stepped.unit === null` and the shown value (without '≈') is '1' or a lone fraction glyph, singularise the item's first word:
   ```ts
   const one = stepped.unit === null && stepped.max === null && /^≈?(1|⅛|¼|⅓|½|⅔|¾|⅞)$/.test(value);
   const named = one ? item.replace(/^(\S+)/, (word) => singular(word.toLowerCase()) === word.toLowerCase() ? word : singular(word)) : item;
   ```
   Use `named` in the returned string, and import `singular` from `./plural`. "1 eggs" becomes "1 egg"; "1 large eggs" keeps "large" (first word) and stays as written. That's an accepted miss: add a ledger note, since "large" is not a plural.

- [ ] **Step 4: Run them to verify they pass**

Run: `rtk vitest run packages/domain`
Expected: PASS.

If an older test expected "⅛ oz", "1 ml" or "≈½–≈1", it encoded a deferred finding. Update it and record a ruling.

- [ ] **Step 5: Commit**

```bash
git add packages/domain
git commit -m "fix(cooking): tiny amounts show as a pinch, tidy count ranges and singulars, unit steps use the shown value (FR-21–FR-23)"
```

---

### Task 9: Recipe page and cook mode

**Files:**
- Modify: `apps/mobile/src/screens/RecipeScreen.tsx:174-224`
- Modify: `apps/mobile/src/components/IngredientList.tsx` (prop `substitutable`)
- Create: `apps/mobile/src/cooking/steps.ts`
- Create: `apps/mobile/src/cooking/steps.test.ts`
- Modify: `apps/mobile/src/screens/CookScreen.tsx`
- Modify: `apps/mobile/src/cooking/useWakeLock.ts`
- Modify: `apps/mobile/src/db/DatabaseSessionBridge.tsx:76`
- Modify: `apps/mobile/src/substitutions/repository.ts`
- Test: `apps/mobile/src/substitutions/repository.test.ts`
- Modify: `packages/domain/src/substitutions.ts:61-67`
- Test: `packages/domain/src/substitutions.test.ts`
- Modify: `apps/mobile/src/substitutions/api.ts:12-16`
- Test: `apps/mobile/src/substitutions/api.test.ts`
- Modify: `apps/mobile/src/components/SubstitutePanel.tsx`
- Test: `e2e/cook.spec.ts`

**Interfaces:**
- Produces:
  - `stepsNote(servings: number | null): string`;
  - `shownStep(step: number, count: number): number`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/cooking/steps.test.ts
import { describe, expect, it } from 'vitest';
import { shownStep, stepsNote } from './steps';

describe('cook mode steps', () => {
  it('names the original servings', () => {
    expect(stepsNote(4)).toBe('Amounts in steps are for the original 4 servings');
    expect(stepsNote(null)).toBe('Amounts in steps are for the original recipe');
  });
  it('never shows a step past the last one', () => {
    expect(shownStep(5, 3)).toBe(2);
    expect(shownStep(1, 3)).toBe(1);
    expect(shownStep(4, 0)).toBe(0);
  });
});
```

`packages/domain/src/substitutions.test.ts`:

```ts
it('does not repeat a short substitute already in its amount', () => {
  expect(
    substitutionNoteLine('1 tbsp mayo', { substitute: 'Egg', amount: '1 egg', how: '', effect: 'Richer' }),
  ).toBe('Instead of 1 tbsp mayo: 1 egg — Richer');
});
```

`apps/mobile/src/substitutions/repository.test.ts`, using the file's fake db, whose notes already hold the line:

```ts
it('adding the same line twice adds it once', async () => {
  const line = 'Instead of 1 egg: 1 tbsp flax — Denser';
  const { db, calls } = fakeDbWithNotes(`Old note\n${line}`); // extend the file's fake: getOptional returns { notes }
  expect(await addSubstitutionToNotes(db, member, 'r1', line)).toBe('already');
  expect(calls.filter((c) => c.sql.startsWith('update'))).toHaveLength(0);
});
```

`apps/mobile/src/substitutions/api.test.ts`, with the file's fetch fake returning 404 `{ error: 'not_found' }`:

```ts
it('says the recipe is gone on a 404', async () => {
  const result = await askSubstitutes(ask, depsReturning(404, { error: 'not_found' }));
  expect(result).toEqual({ kind: 'error', message: 'This recipe is no longer on the server.' });
});
```

Use the file's own helpers for `ask`, `member` and the fetch fake. Read the top of each test file first and adapt the names.

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run apps/mobile/src/cooking apps/mobile/src/substitutions packages/domain/src/substitutions.test.ts`
Expected: FAIL:
- `./steps` does not resolve;
- the note gives "1 egg (Egg)";
- the notes writer returns 'added';
- the message is the fallback.

- [ ] **Step 3: Implement**

```ts
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
```

**`CookScreen.tsx`:**
- after `const last = steps.length - 1;`, add `const step = shownStep(place.step, steps.length);`;
- replace every `place.step` used for display or navigation with `step`: the label, the progress width, the text, the dot highlight, `place.step > 0`, `place.step < last`, and the Previous/Next updates (`update({ step: step - 1 })` / `step + 1`);
- replace the inline note with `{factor !== 1 ? <Text tone="muted">{stepsNote(recipe.servings)}</Text> : null}`;
- render the bottom bar always; when `steps.length === 0` it holds only `<Button full large label="Done" onPress={done} />`. Change `{steps.length > 0 ? (<View …>…</View>) : null}` to always render, and inside, show Previous only when `steps.length > 0 && step > 0`, and Next only when `step < last`, else Done.

**`useWakeLock.ts`:** in the `then`, release any lock already held before keeping the new one:

```ts
        (held) => {
          if (!live) {
            void held.release();
            return;
          }
          // Overlapping requests (visibility flicker): keep one lock only.
          void sentinel?.release();
          sentinel = held;
          setState('on');
        },
```

**`DatabaseSessionBridge.tsx` line 76:**

```ts
          try {
            if (globalThis.localStorage) clearAllPlaces(globalThis.localStorage);
          } catch (error) {
            // Storage can throw (private mode, quota); the database wipe must still run.
            console.error('Clearing cook places failed', error);
          }
```

**`substitutions.ts` `substitutionNoteLine`:** match short names as whole words at a word start:

```ts
  const amountWords = option.amount.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const named = option.substitute
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .some((word) => word.length >= 3 && amountWords.some((other) => other.startsWith(word)));
```

**`substitutions/repository.ts`:** before the length check:

```ts
  if (current.split('\n').some((existing) => existing.trim() === line.trim())) return 'already';
```

Change the return type to `'added' | 'already' | 'full' | 'missing'`.

**`substitutions/api.ts`:** add `not_found: 'This recipe is no longer on the server.',` to `MESSAGES`.

**`SubstitutePanel.tsx`:**
- the notice maps `'already'` to `'Already in notes'`;
- the stale label is checked against the answer's own line, so a fresh answer is labelled too once the line is edited again: `const stale = answer !== null && isStale({ ingredient_raw: askedFor }, ingredient);`.

**`RecipeScreen.tsx`:** one component owns the cook's place for the ingredients and steps, so the note can sit under the steps. Replace lines 175–189, the IngredientsSection call and the Steps card, with `<RecipeBody claims={claims} recipe={recipe} />`, and replace `IngredientsSection` with:

```tsx
/**
 * FR-22–24: ingredients with servings, units and Substitute, and the steps
 * with the original-servings note. In the Trash, as written and read-only.
 */
function RecipeBody({ claims, recipe }: { claims: Claims; recipe: RecipeRecord }) {
  const { place, update } = useCookPlace(recipe);
  const substitutions = useSubstitutions(recipe.id);
  const trashed = recipe.deleted_at !== null;
  const factor = trashed ? 1 : scaleFactor(recipe.servings, place.servings, place.scale);
  return (
    <>
      {recipe.ingredients.length > 0 ? (
        <Card title="Ingredients">
          {trashed ? null : (
            <ServingsBar recipeServings={recipe.servings} place={place} onChange={update} />
          )}
          <IngredientList
            claims={claims}
            recipeId={recipe.id}
            ingredients={recipe.ingredients}
            factor={factor}
            units={trashed ? 'as_written' : place.units}
            substitutions={substitutions}
            substitutable={!trashed}
          />
        </Card>
      ) : null}
      {recipe.steps.length > 0 ? (
        <Card title="Steps">
          {recipe.steps.map((step, index) => (
            <View key={step.id} style={{ flexDirection: 'row', gap: space.md }}>
              <Text aria-hidden tone="accent" variant="h3">
                {index + 1}
              </Text>
              <Text style={{ flex: 1 }}>{step.text}</Text>
            </View>
          ))}
          {factor !== 1 ? <Text tone="muted">{stepsNote(recipe.servings)}</Text> : null}
        </Card>
      ) : null}
    </>
  );
}
```

**`IngredientList.tsx`:** add the prop `substitutable = true`, and render the Substitute `Button` and the panel only when it is true.

- [ ] **Step 4: Write the e2e tests**

Append to `e2e/cook.spec.ts`, using the file's own imports:

```ts
test('a recipe with no steps has Done in cook mode (FR-21)', async ({ page }) => {
  await signIn(page, freshEmail('cook-nosteps'));
  const title = unique('No steps');
  await createRecipe(page, { title, ingredients: '1 egg' });
  await page.getByRole('button', { name: 'Cook' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
});

test('the recipe page says step amounts are for the original servings (FR-22)', async ({ page }) => {
  await signIn(page, freshEmail('cook-note'));
  await createRecipe(page, { title: unique('Note'), servings: '4', ingredients: '2 eggs', steps: 'Beat 2 eggs' });
  await page.getByRole('button', { name: /more servings|Increase servings/i }).click();
  await expect(page.getByText('Amounts in steps are for the original 4 servings')).toBeVisible();
});

test('a recipe in the Trash shows no servings or Substitute (FR-18)', async ({ page }) => {
  await signIn(page, freshEmail('cook-trash'));
  const title = unique('Trashed view');
  await createRecipe(page, { title, servings: '2', ingredients: '1 egg' });
  await page.getByRole('button', { name: 'More' }).click();
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Move to Trash' }).click();
  await page.goto('/trash');
  await page.getByText(title, { exact: true }).click();
  await expect(page.getByText('This recipe is in the Trash')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Substitute for/ })).toHaveCount(0);
});
```

Read `ServingsBar.tsx` for the exact name of the increase button, and the Trash e2e for how a trashed recipe is opened and confirmed; the `confirm` helper may be a custom dialog. Use those exact locators.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `rtk vitest run apps/mobile packages/domain`, then `rtk proxy pnpm test:e2e e2e/cook.spec.ts`
Expected: PASS. Before Step 3, the three e2e tests failed: no Done, no note, and Substitute present.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src packages/domain e2e/cook.spec.ts
git commit -m "fix(cook): Done with no steps, steps never out of range, one wake lock, the servings note on the page, a read-only Trash view, substitutes tidier (FR-18, FR-21–FR-25)"
```

---

### Task 10: App shell: service worker, other tabs, sign-out, photos, fonts, Household, icons

**Files:**
- Modify: `apps/mobile/workbox.config.cjs`
- Create: `apps/mobile/src/pwa/workboxConfig.test.ts`
- Modify: `apps/mobile/public/index.html`
- Modify: `apps/mobile/src/pwa/serviceWorker.ts`
- Test: `apps/mobile/src/pwa/serviceWorker.test.ts`
- Modify: `apps/mobile/src/session/sessionState.ts:80-81`
- Test: `apps/mobile/src/session/sessionState.test.ts`
- Modify: `apps/mobile/src/photos/remote.ts`
- Test: `apps/mobile/src/photos/remote.test.ts`
- Modify: `apps/mobile/src/photos/queue.ts`
- Modify: `apps/mobile/src/photos/usePhotoUri.ts`
- Modify: `apps/mobile/src/components/PhotoImage.tsx`
- Modify: `apps/mobile/src/components/Thumb.tsx`
- Modify: `apps/mobile/src/theme/type.ts`
- Create: `apps/mobile/src/theme/type.test.ts`
- Modify: `apps/mobile/src/screens/HouseholdScreen.tsx:136`
- Modify: `scripts/make-icons.mjs`

**Interfaces:**
- Produces:
  - `applyUpdate(reload?: () => void)`;
  - `watchController(container: EventTarget, hadController: boolean)`;
  - `bumpPhotoGeneration(): void`, with `photoGeneration()` in `remote.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/mobile/src/pwa/workboxConfig.test.ts
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const config = createRequire(import.meta.url)('../../workbox.config.cjs') as {
  navigateFallbackDenylist: RegExp[];
};

describe('workbox config', () => {
  it('leaves /healthz to the network', () => {
    expect(config.navigateFallbackDenylist.some((pattern) => pattern.test('/healthz'))).toBe(true);
  });
});
```

Append to `serviceWorker.test.ts`:

```ts
describe('other tabs and redundant workers', () => {
  it('a tab that did not tap Reload shows the update once another tab activated it', () => {
    const container = new EventTarget();
    watchController(container, true);
    container.dispatchEvent(new Event('controllerchange'));
    expect(updateReady()).toBe(true);
  });

  it('the first install taking control is not an update', () => {
    const container = new EventTarget();
    watchController(container, false);
    container.dispatchEvent(new Event('controllerchange'));
    expect(updateReady()).toBe(false);
  });

  it('Reload reloads when the waiting worker became redundant', () => {
    const registration = new FakeRegistration();
    const worker = new FakeWorker();
    registration.waiting = worker;
    watchRegistration(registration, () => true);
    worker.state = 'redundant';
    let reloaded = 0;
    applyUpdate(() => (reloaded += 1));
    expect(reloaded).toBe(1);
  });
});
```

Also add `applyUpdate` and `watchController` to the test's import.

Append to `sessionState.test.ts`:

```ts
it('a sign-out with nothing left to wipe keeps (no wipe on every online toggle)', () => {
  expect(localDataAction({ status: 'signedOut', byUser: true }, null)).toBe('keep');
  expect(localDataAction({ status: 'signedOut', byUser: true }, 'user-1:house-1')).toBe('wipe');
});
```

Append to `remote.test.ts`, using the file's fetch fake:

```ts
it('a download that finishes after sign-out is dropped, not written', async () => {
  let release!: () => void;
  const fetchFake = (async () => {
    await new Promise<void>((resolve) => (release = resolve));
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as unknown as typeof fetch;
  const remote = createRemoteStorage({ fetch: fetchFake, apiUrl: '/api', token: async () => 't' });
  const pending = remote.downloadFile({ id: 'p1' } as never);
  await Promise.resolve();
  bumpPhotoGeneration();
  release();
  await expect(pending).rejects.toThrow('signed out');
});
```

Here `as never` stands in for a partial `AttachmentRecord` that the adapter reads only `id` from; add that as a comment in the test.

```ts
// apps/mobile/src/theme/type.test.ts
import { describe, expect, it } from 'vitest';
import { type } from './type';

describe('type scale', () => {
  it('names each weight, so the system font fallback is not flat', () => {
    expect(type.h1.fontWeight).toBe('600');
    expect(type.label.fontWeight).toBe('500');
    expect(type.body.fontWeight).toBe('400');
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `rtk vitest run apps/mobile/src/pwa apps/mobile/src/session apps/mobile/src/photos apps/mobile/src/theme`
Expected: FAIL:
- the denylist lacks /healthz;
- `watchController` and `bumpPhotoGeneration` are missing;
- the action is 'wipe';
- `fontWeight` is undefined.

- [ ] **Step 3: Implement**

**`workbox.config.cjs`:** add `/^\/healthz$/,` to `navigateFallbackDenylist`.

**`public/index.html` line 5:** `<meta http-equiv="X-UA-Compatible" content="IE=edge" />`. In the `<head>`, add `<style>body { font-synthesis: none; }</style>`; with named weights (below) the bundled single-weight fonts must not be faux-bolded.

**`serviceWorker.ts`:**

```ts
let activated = false;

export function updateReady(): boolean {
  return waiting !== null || activated;
}
```

Also reset `activated = false` in `resetUpdateStateForTests`, then add:

```ts
/** Another tab tapped Reload: this tab's code is now older than its worker. */
export function watchController(container: EventTarget, hadController: boolean): void {
  container.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    activated = true;
    listeners.forEach((listener) => listener());
  });
}

let reloading = false;

/** Activates the waiting worker, or reloads when there is nothing left to activate. */
export function applyUpdate(reload: () => void = () => window.location.reload()): void {
  reloading = true;
  if (activated || !waiting || waiting.state === 'redundant') {
    reload();
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => reload(), { once: true });
  // Workbox's generated worker calls skipWaiting() on this message.
  waiting.postMessage({ type: 'SKIP_WAITING' });
}
```

In `registerServiceWorker`, after `watchRegistration(...)`, add `watchController(navigator.serviceWorker, navigator.serviceWorker.controller !== null);`. Check `UpdateBanner.tsx` calls `applyUpdate()` with no argument, and leave it so.

**`sessionState.ts` line 81:**

```ts
  // Nothing to wipe once a sign-out's wipe has run: online toggles must not repeat it.
  if (session.status === 'signedOut') return session.byUser && owner !== null ? 'wipe' : 'keep';
```

Then check the bridge test in `sessionState.test.ts` still passes. A signed-out wipe with an owner still wipes.

**`remote.ts`:**

```ts
let generation = 0;
/** Sign-out moves this on; a download started before it is dropped. */
export function bumpPhotoGeneration(): void {
  generation += 1;
}
export const photoGeneration = () => generation;
```

and in `downloadFile`:

```ts
    async downloadFile(attachment: AttachmentRecord) {
      const started = generation;
      const data = await (await call(attachment.id, { method: 'GET', headers: {} })).arrayBuffer();
      if (generation !== started) throw new Error('signed out');
      return data;
    },
```

**`queue.ts`:**
- in `clearPhotos`, call `bumpPhotoGeneration()` first, imported from './remote';
- memoise `initialize()` per entry: add `opened: Promise<void> | null` to `Entry`, initialised to `null`, and use

```ts
function opened(e: Entry): Promise<void> {
  e.opened ??= e.queue.localStorage.initialize();
  return e.opened;
}
```

Replace each `await queue.localStorage.initialize()` with `await opened(current(db))`, or `opened(e)` where `e` is in hand. After `clearQueue()`, set `entry.opened = null`, so the next use opens the store again after it was cleared.

**`usePhotoUri.ts`:**
- at the top of the effect, after the `!id` check, add `setView({ state: 'loading', uri: null });`, so the old photo clears;
- add retry for a photo that is missing while online:

```ts
  const [attempt, setAttempt] = useState(0);
  ...
      } else {
        setView({ state: online ? 'missing' : 'offline', uri: null });
        // Another phone may not have uploaded it yet: look again, up to 10 times.
        if (online && attempt < 10) retry = setTimeout(() => live && setAttempt((n) => n + 1), 30_000);
      }
  ...
    return () => {
      live = false;
      if (retry) clearTimeout(retry);
      if (made) URL.revokeObjectURL(made);
    };
  }, [db, id, local, online, attempt]);
```

Declare `let retry: ReturnType<typeof setTimeout> | null = null;` beside `made`. This replaces the spec's "retried when it comes back online": that case already re-runs on `online`, and the retry covers 404 while online. Record a ruling.

**`PhotoImage.tsx`:** add the prop `placeholder?: 'mark'`. When it is set and the photo isn't ready:
- render the app mark (move the `MARK` require from `Thumb.tsx` into `PhotoImage.tsx`, as `Thumb`'s placeholder does);
- use `aria-label="Photo not downloaded yet"`.

**`Thumb.tsx`:** pass `placeholder="mark"`.

**`type.ts`:** add `fontWeight: '600' as const` to h1–h3, `'400'` to body, small and caption, and `'500'` to label.

**`HouseholdScreen.tsx` line 136:** remove `numberOfLines={1}`, so the email wraps and " (you)" is always visible.

**`scripts/make-icons.mjs`:**
- resolve every path from the repo root: `const root = new URL('..', import.meta.url);`, then `new URL(SOURCE, root)` for reads and `new URL(output.file, root)` for writes (`fileURLToPath` for `mkdirSync`/`dirname`);
- wrap the loop in `try { … } finally { await browser.close(); }`.

- [ ] **Step 4: Run them to verify they pass**

Run: `rtk vitest run apps/mobile`
Expected: PASS.

Then run `cd /tmp && node /mnt/d/github_projects/recipe-app/scripts/make-icons.mjs && cd - && git status --short apps/mobile/assets apps/mobile/public/icons`.
Expected: "wrote …" lines, and git reports no changed icon files: same pixels, now from any folder.

If PNG bytes differ because of encoder metadata, `git checkout` the icons and record a ruling.

- [ ] **Step 5: Run the whole e2e suite**

The photo, session and install specs touch this task.

Run: `rtk proxy pnpm test:e2e > $W/e2e10.log 2>&1; tail -25 $W/e2e10.log`
Expected: all pass, 1 skipped as before.

Fix tests that assert the old placeholder name. For example, a list thumbnail announced "Photo of X" while not downloaded now reads "Photo not downloaded yet". Record a ruling for each.

- [ ] **Step 6: Commit**

```bash
git add apps/mobile scripts/make-icons.mjs
git commit -m "fix(app): /healthz bypasses the worker, other tabs see updates, one wipe per sign-out, dropped stale downloads, photo placeholders, named font weights (NFR-1, FR-15)"
```

---

### Task 11: Docs: UI spec drift, SPEC, ADR-0019

**Files:**
- Modify: `docs/superpowers/specs/2026-10-17-ui-theme-design.md`
- Modify: `docs/SPEC.md` (FR-35)
- Modify: `docs/adr/0019-shopping-list.md`

**Interfaces:** none.

- [ ] **Step 1: Update the UI spec to the app as built**

Find each statement and edit it to match the app:

- the icon corner fill → `#101B31`;
- recipe meta on list rows → "one line: the first tag as a chip and the total time", not a row of chips;
- Leave household → the danger style;
- Invite a friend → the ghost style;
- the review page's "Imports" link → a ghost button.

Run `rtk grep -n "corner\|meta\|Leave household\|Invite a friend\|Imports" docs/superpowers/specs/2026-10-17-ui-theme-design.md` to find them. Change only those statements.

- [ ] **Step 2: SPEC FR-35**

In `docs/SPEC.md`, the FR-35 row adds: "Clear ticked removes fully ticked lines; a partly ticked line stays, counting what is left."

- [ ] **Step 3: ADR-0019 Consequences**

Add two bullets:

- **A partly ticked line stays whole until every row is ticked.** Its amount counts only the rows still to buy, and Clear ticked removes only fully ticked lines.
- **Add to list adds the amounts the sheet shows,** in the cook's chosen units, with "a pinch" where the sheet shows one.

- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs: the UI spec matches the app as built; FR-35 and ADR-0019 record Clear ticked and added units"
```

---

## Final verification (before the final review)

Run each, writing long output to the workspace:

- `pnpm lint && pnpm typecheck`
- `rtk vitest run` (unit)
- `pnpm dev:backend` then `pnpm test:stack` and `pnpm test:rls`
- `pnpm dev:backend:test` then `pnpm test:api`
- `pnpm test:e2e`
- the @firefox tests in Docker (Task 1 Step 11, all of `e2e/tagbar.spec.ts`)
- `pnpm test:prod-config`
- `pnpm dev:backend` and `docker compose restart sync` to restore the real AI service
