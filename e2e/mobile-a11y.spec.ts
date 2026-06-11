import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * IN-7: Mobile-viewport accessibility gate.
 *
 * Runs only in the dedicated `mobile` Playwright project (Pixel 7, hasTouch), so
 * the bottom-sheet / mobile-only UI — which the desktop e2e project and the
 * single-page Lighthouse a11y audit never reach — is axe-scanned. This is exactly
 * where unlabeled icon buttons and missing dialog roles slipped through before
 * QW-6/PO-3 (the axe gate never scanned mobile states). It locks those fixes in.
 *
 * Same policy as e2e/a11y.spec.ts: gate on serious/critical violations, exclude the
 * third-party MapLibre WebGL canvas.
 */

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"][data-loaded="true"]', { timeout: 30000 });
}

function analyze(page: import('@playwright/test').Page) {
  return new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('.maplibregl-map')
    .analyze();
}

function blocking(results: Awaited<ReturnType<typeof analyze>>) {
  return results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}

function describe(violations: ReturnType<typeof blocking>): string {
  return violations
    .map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)\n    ${v.nodes[0]?.target.join(' ')}`)
    .join('\n');
}

test.describe('mobile accessibility (axe-core, Pixel 7)', () => {
  test('mobile home state has no serious/critical a11y violations', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    const results = await analyze(page);
    const violations = blocking(results);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('mobile neighborhood bottom sheet (expanded) is accessible', async ({ page }) => {
    await page.goto('/#pno=00100');
    await waitForDataLoaded(page);
    const sheet = page.locator('[role="dialog"]').first();
    await expect(sheet).toBeVisible({ timeout: 10000 });
    // PO-3: the drag handle is a real <button aria-expanded> whose tap cycles
    // peek -> half -> full. Tap it to expand the sheet so its full content is scanned.
    const handle = sheet.locator('button[aria-expanded]').first();
    await handle.tap();
    await handle.tap();
    await page.waitForTimeout(400); // let the height transition settle
    const results = await analyze(page);
    const violations = blocking(results);
    expect(violations, describe(violations)).toEqual([]);
  });

  test('mobile filter sheet is accessible', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    // "Suodata" (filter.toggle) lives inside the Tools dropdown — open it first,
    // then tap the now-visible filter toggle.
    await page.getByRole('button', { name: 'Työkalut' }).first().tap();
    await page.getByRole('menuitem', { name: 'Suodata' }).first().tap();
    // The filter sheet is a role=dialog named by its heading (filter.title).
    await expect(page.getByRole('dialog', { name: 'Etsi naapurustoja' })).toBeVisible({ timeout: 5000 });
    const results = await analyze(page);
    const violations = blocking(results);
    expect(violations, describe(violations)).toEqual([]);
  });
});
