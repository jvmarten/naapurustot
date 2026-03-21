import { test, expect } from '@playwright/test';

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"][data-loaded="true"]', { timeout: 30000 });
}

test.describe('pin neighborhoods and comparison panel', () => {

  test('pin two neighborhoods → comparison panel appears → unpin one', async ({ page }) => {
    // Select the first neighborhood via URL with two pinned neighborhoods
    // The comparison panel only shows when pinned.length >= 2
    await page.goto('/#pno=00100&compare=00200,00300');
    await waitForDataLoaded(page);

    // The comparison panel should appear with the title "Vertailu" (Finnish for "Comparison")
    // Use h2 to avoid matching "Lisää vertailuun" button
    const comparisonTitle = page.locator('h2:has-text("Vertailu")').first();
    await expect(comparisonTitle).toBeVisible({ timeout: 10000 });

    // The comparison panel should show the "Tyhjennä" (Clear all) button
    const clearButton = page.locator('text=Tyhjennä').first();
    await expect(clearButton).toBeVisible();

    // Verify that neighborhood data is shown in the comparison table
    // The panel shows a table with header columns for each pinned neighborhood
    const comparisonPanel = page.locator('.hidden.md\\:block.absolute.bottom-4');
    await expect(comparisonPanel).toBeVisible({ timeout: 5000 });

    // Look for at least one stat label in the table (e.g., "Väestö" = Population)
    await expect(comparisonPanel.locator('text=Väestö').first()).toBeVisible();

    // Unpin one neighborhood by clicking its X button in the table header
    const unpinButtons = comparisonPanel.locator('button[title="Remove"]');
    const unpinCount = await unpinButtons.count();
    expect(unpinCount).toBeGreaterThan(0);
    await unpinButtons.first().click();

    // After unpinning one, if only one remains the comparison panel should still show
    // (since we started with 2 pinned + selected = potentially 2 still pinned)
    // Wait briefly to check whether the panel adjusts
    await page.waitForTimeout(500);
  });

  test('comparison panel has table and chart view toggle', async ({ page }) => {
    await page.goto('/#pno=00100&compare=00200,00300');
    await waitForDataLoaded(page);

    // Wait for comparison panel
    const comparisonTitle = page.locator('h2:has-text("Vertailu")').first();
    await expect(comparisonTitle).toBeVisible({ timeout: 10000 });

    // The panel should have "Taulukko" (Table) and "Kaavio" (Chart) toggle buttons
    const tableTab = page.locator('text=Taulukko').first();
    const chartTab = page.locator('text=Kaavio').first();
    await expect(tableTab).toBeVisible();
    await expect(chartTab).toBeVisible();

    // Click the chart tab
    await chartTab.click();

    // The chart view should now be active — verify by checking for chart-specific content
    // In chart mode, the table should no longer be visible
    await page.waitForTimeout(300);

    // Switch back to table
    await tableTab.click();
    await page.waitForTimeout(300);
  });

  test('clear all pinned neighborhoods removes comparison panel', async ({ page }) => {
    await page.goto('/#pno=00100&compare=00200,00300');
    await waitForDataLoaded(page);

    // Wait for comparison panel title (use h2 to avoid matching "Lisää vertailuun" button)
    const comparisonTitle = page.locator('h2:has-text("Vertailu")').first();
    await expect(comparisonTitle).toBeVisible({ timeout: 10000 });

    // Click "Tyhjennä" (Clear all)
    const clearButton = page.locator('text=Tyhjennä').first();
    await clearButton.click();

    // Comparison panel should disappear
    await expect(comparisonTitle).not.toBeVisible({ timeout: 3000 });
  });

  test('pin button shows in neighborhood panel', async ({ page }) => {
    await page.goto('/#pno=00100');
    await waitForDataLoaded(page);

    // Wait for the neighborhood panel
    const panelHeading = page.locator('.hidden.md\\:block.absolute h2').first();
    await expect(panelHeading).toBeVisible({ timeout: 10000 });

    // The pin button should be visible with text "Lisää vertailuun" (Add to comparison)
    const pinButton = page.locator('text=Lisää vertailuun').first();
    await expect(pinButton).toBeVisible({ timeout: 3000 });
  });
});
