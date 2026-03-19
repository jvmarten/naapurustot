import { test, expect } from '@playwright/test';

test.describe('neighborhood panel flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  });

  test('select neighborhood via search → view panel → verify stats → close panel', async ({ page }) => {
    // Search for a known postal code
    const searchInput = page.locator('input[type="text"]');
    await searchInput.fill('00100');

    // Click the search result to select the neighborhood
    const result = page.locator('text=00100').first();
    await expect(result).toBeVisible({ timeout: 5000 });
    await result.click();

    // The neighborhood panel should appear (desktop: side panel with h2 containing the name)
    const panelHeading = page.locator('h2').filter({ hasText: /00100|Helsinki/ }).first();
    await expect(panelHeading).toBeVisible({ timeout: 5000 });

    // Verify key stat labels are shown in the panel
    // The app defaults to Finnish — "Väestö" = Population, "Mediaanitulo" = Median Income
    await expect(page.locator('text=Väestö').first()).toBeVisible();
    await expect(page.locator('text=Mediaanitulo').first()).toBeVisible();

    // Verify the Quality Index section is shown
    await expect(page.locator('text=Laatuindeksi').first()).toBeVisible();

    // Verify the postal code is displayed in the panel
    await expect(page.locator('p:has-text("00100")').first()).toBeVisible();

    // Close the panel by clicking the close button (X icon in the panel header)
    // The close button is inside the panel, near the heading
    const closeButton = page.locator('.hidden.md\\:block svg path[d="M6 18L18 6M6 6l12 12"]').first();
    // Use a more reliable approach: find the X button within the panel
    const panel = page.locator('.hidden.md\\:block.absolute');
    const panelCloseBtn = panel.locator('button').filter({
      has: page.locator('svg path[d="M6 18L18 6M6 6l12 12"]'),
    }).first();
    await panelCloseBtn.click();

    // Panel should be gone — heading no longer visible
    await expect(panelHeading).not.toBeVisible({ timeout: 3000 });
  });

  test('selecting neighborhood via URL hash shows panel with stats', async ({ page }) => {
    await page.goto('/#pno=00100&layer=median_income');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });

    // Panel should be displayed with the neighborhood data
    const panelHeading = page.locator('h2').filter({ hasText: /00100|Helsinki/ }).first();
    await expect(panelHeading).toBeVisible({ timeout: 10000 });

    // Verify stats are rendered (at least population and median income rows)
    await expect(page.locator('text=Väestö').first()).toBeVisible();
    await expect(page.locator('text=Mediaanitulo').first()).toBeVisible();
  });

  test('panel shows housing section with stats', async ({ page }) => {
    await page.goto('/#pno=00100');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });

    // Wait for the panel to load
    const panelHeading = page.locator('h2').filter({ hasText: /00100|Helsinki/ }).first();
    await expect(panelHeading).toBeVisible({ timeout: 10000 });

    // Housing section should be visible (it defaults to open)
    // "Asuminen" is Finnish for "Housing"
    await expect(page.locator('text=Asuminen').first()).toBeVisible();

    // Verify housing stat rows exist
    // "Omistusaste" = Ownership Rate
    await expect(page.locator('text=Omistusaste').first()).toBeVisible();
  });
});
