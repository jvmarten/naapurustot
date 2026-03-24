import { test, expect } from '@playwright/test';

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"][data-loaded="true"]', { timeout: 30000 });
}

/** Wait for map tiles to settle — the canvas keeps painting while tiles stream in. */
async function waitForMapIdle(page: import('@playwright/test').Page) {
  await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  // Allow map tiles and choropleth paint to finish
  await page.waitForTimeout(2000);
}

test.describe('visual regression', () => {
  test.describe.configure({ retries: 0 });

  test('default map load', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    await expect(page).toHaveScreenshot('default-map-load.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('dark mode', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    // Open settings dropdown and switch to dark mode
    const settingsButton = page.locator(`button[aria-label="${await getSettingsLabel(page)}"]`);
    await settingsButton.click();

    // Click the dark mode button (moon icon — third theme button)
    const darkButton = page.locator('button[title="Tumma"], button[title="Dark"]').first();
    await darkButton.click();

    // Close dropdown by clicking elsewhere (avoid header bar at top)
    await page.locator('.maplibregl-canvas').click({ position: { x: 10, y: 100 } });
    await page.waitForTimeout(500);

    // Verify dark class is applied
    const htmlClass = await page.locator('html').getAttribute('class');
    expect(htmlClass).toContain('dark');

    await waitForMapIdle(page);

    await expect(page).toHaveScreenshot('dark-mode.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('neighborhood panel open', async ({ page }) => {
    await page.goto('/#pno=00100&layer=quality_index');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    // Wait for the neighborhood panel to appear (desktop side panel)
    const panel = page.locator('.hidden.md\\:block.absolute').first();
    await expect(panel).toBeVisible({ timeout: 10000 });

    // Wait for stats to render
    await expect(panel.locator('text=Väestö').first()).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('neighborhood-panel-open.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('comparison panel with 3 neighborhoods', async ({ page }) => {
    await page.goto('/#pno=00100&compare=00200,00300&layer=median_income');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    // Wait for comparison panel
    const comparisonTitle = page.locator('h2:has-text("Vertailu")').first();
    await expect(comparisonTitle).toBeVisible({ timeout: 10000 });

    // Ensure table data is rendered
    const comparisonPanel = page.locator('.hidden.md\\:block.absolute.bottom-4');
    await expect(comparisonPanel.locator('text=Väestö').first()).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('comparison-panel-3-neighborhoods.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('filter panel active', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    // Open tools dropdown
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await expect(toolsButton).toBeVisible({ timeout: 5000 });
    await toolsButton.click();

    // Click "Suodata" (Filter)
    await page.locator('text=Suodata').first().click();

    // Wait for filter panel
    await expect(page.locator('text=Etsi naapurustoja').first()).toBeVisible({ timeout: 5000 });

    // Apply a preset to show results
    await page.locator('text=Lapsiperheille').first().click();
    await expect(page.locator('text=osumaa').first()).toBeVisible({ timeout: 5000 });

    await expect(page).toHaveScreenshot('filter-panel-active.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('colorblind mode', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    await waitForMapIdle(page);

    // Open settings dropdown
    const settingsButton = page.locator(`button[aria-label="${await getSettingsLabel(page)}"]`);
    await settingsButton.click();

    // Select protanopia from the colorblind dropdown (skip CitySelector in header)
    const cbSelect = page.locator('.z-50 select').first();
    await cbSelect.selectOption('protanopia');

    // Close dropdown (avoid header bar at top)
    await page.locator('.maplibregl-canvas').click({ position: { x: 10, y: 100 } });
    await page.waitForTimeout(500);

    await waitForMapIdle(page);

    await expect(page).toHaveScreenshot('colorblind-protanopia.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

/** Get the settings button aria-label (varies by language). */
async function getSettingsLabel(page: import('@playwright/test').Page): Promise<string> {
  // Try Finnish first (default), fallback to English
  const fiButton = page.locator('button[aria-label="Asetukset"]');
  if (await fiButton.isVisible({ timeout: 2000 }).catch(() => false)) {
    return 'Asetukset';
  }
  return 'Settings';
}
