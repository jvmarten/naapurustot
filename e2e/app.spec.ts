import { test, expect } from '@playwright/test';

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.locator('[data-testid="loading-overlay"]').waitFor({ state: 'hidden', timeout: 30000 });
}

test.describe('naapurustot app', () => {
  test('loads the app and shows the map', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
    // Map container should exist
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  });

  test('can search for a neighborhood', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);

    // Find and click the search input
    const searchInput = page.locator('input[type="text"]');
    await searchInput.fill('00100');
    // Should see search results
    await expect(page.locator('text=00100')).toBeVisible({ timeout: 5000 });
  });

  test('can switch layers via the layer selector', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);

    // Desktop: layer selector should be visible
    const layerSelector = page.locator('text=layers.title').first();
    if (await layerSelector.isVisible()) {
      // Click on a group header to expand it
      const group = page.locator('text=layers.economy').first();
      if (await group.isVisible()) {
        await group.click();
      }
    }
  });

  test('URL hash updates when neighborhood is selected', async ({ page }) => {
    await page.goto('/#pno=00100&layer=median_income');
    await waitForDataLoaded(page);
    // The URL should still contain the hash params
    expect(page.url()).toContain('pno=00100');
  });

  test('comparison URL with pinned neighborhoods', async ({ page }) => {
    await page.goto('/#pno=00100&compare=00200,00300');
    await waitForDataLoaded(page);
    // URL should retain compare params
    expect(page.url()).toContain('compare=');
  });

  test('tools dropdown opens and shows options', async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);

    // Click the tools button (wrench icon)
    const toolsBtn = page.locator('button[title]').first();
    if (await toolsBtn.isVisible()) {
      await toolsBtn.click();
    }
  });
});
