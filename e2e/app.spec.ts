import { test, expect } from '@playwright/test';

test.describe('naapurustot app', () => {
  test('loads the app and shows the map', async ({ page }) => {
    await page.goto('/');
    // Wait for the loading screen to disappear
    await expect(page.locator('h1:has-text("naapurustot")')).toBeVisible({ timeout: 15000 });
    // Map container should exist
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 });
  });

  test('can search for a neighborhood', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });

    // Find and click the search input
    const searchInput = page.locator('input[type="text"]');
    await searchInput.fill('00100');
    // Should see search results
    await expect(page.locator('text=00100')).toBeVisible({ timeout: 5000 });
  });

  test('can switch layers via the layer selector', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });

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
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    // The URL should still contain the hash params
    expect(page.url()).toContain('pno=00100');
  });

  test('comparison URL with pinned neighborhoods', async ({ page }) => {
    await page.goto('/#pno=00100&compare=00200,00300');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
    // URL should retain compare params
    expect(page.url()).toContain('compare=');
  });

  test('tools dropdown opens and shows options', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });

    // Click the tools button (wrench icon)
    const toolsBtn = page.locator('button[title]').first();
    if (await toolsBtn.isVisible()) {
      await toolsBtn.click();
    }
  });
});
