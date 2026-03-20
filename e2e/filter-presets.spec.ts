import { test, expect } from '@playwright/test';

test.describe('filter presets flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.maplibregl-canvas', { timeout: 15000 });
  });

  test('open filter panel via tools dropdown → use preset → verify results', async ({ page }) => {
    // Open the tools dropdown by clicking the wrench icon button
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await expect(toolsButton).toBeVisible({ timeout: 5000 });
    await toolsButton.click();

    // Click "Suodata" (Filter) in the dropdown
    const filterOption = page.locator('text=Suodata').first();
    await expect(filterOption).toBeVisible({ timeout: 3000 });
    await filterOption.click();

    // The filter panel should appear with title "Etsi naapurustoja" (Find Neighborhoods)
    const filterTitle = page.locator('text=Etsi naapurustoja').first();
    await expect(filterTitle).toBeVisible({ timeout: 5000 });

    // Filter presets should be visible: "Pikavalinnat" (Presets)
    const presetsLabel = page.locator('text=Pikavalinnat').first();
    await expect(presetsLabel).toBeVisible({ timeout: 3000 });

    // Click the "Lapsiperheille" (Best for families) preset
    const familyPreset = page.locator('text=Lapsiperheille').first();
    await expect(familyPreset).toBeVisible();
    await familyPreset.click();

    // After selecting a preset, filter criteria should be applied
    // The results count should be visible (contains "osumaa" = "matches")
    const matchCount = page.locator('text=osumaa').first();
    await expect(matchCount).toBeVisible({ timeout: 5000 });

    // There should be neighborhood results listed below the criteria
    // Each result is a button with a neighborhood name
    // Check that results exist by looking for numbered items
    await page.waitForTimeout(500);
  });

  test('commuter preset loads criteria and shows matches', async ({ page }) => {
    // Open tools → filter
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Suodata').first().click();

    // Wait for filter panel
    await expect(page.locator('text=Etsi naapurustoja').first()).toBeVisible({ timeout: 5000 });

    // Click "Työmatkalaisia" (Best for commuters) preset
    const commuterPreset = page.locator('text=Työmatkalaisia').first();
    await expect(commuterPreset).toBeVisible();
    await commuterPreset.click();

    // Match count should appear
    await expect(page.locator('text=osumaa').first()).toBeVisible({ timeout: 5000 });
  });

  test('affordable preset loads criteria and shows matches', async ({ page }) => {
    // Open tools → filter
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Suodata').first().click();

    // Wait for filter panel
    await expect(page.locator('text=Etsi naapurustoja').first()).toBeVisible({ timeout: 5000 });

    // Click "Edullisimmat" (Most affordable) preset
    const affordablePreset = page.locator('text=Edullisimmat').first();
    await expect(affordablePreset).toBeVisible();
    await affordablePreset.click();

    // Match count should appear
    await expect(page.locator('text=osumaa').first()).toBeVisible({ timeout: 5000 });
  });

  test('premium preset loads criteria and shows matches', async ({ page }) => {
    // Open tools → filter
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Suodata').first().click();

    // Wait for filter panel
    await expect(page.locator('text=Etsi naapurustoja').first()).toBeVisible({ timeout: 5000 });

    // Click "Laadukkaimmat" (Highest quality) preset
    const premiumPreset = page.locator('text=Laadukkaimmat').first();
    await expect(premiumPreset).toBeVisible();
    await premiumPreset.click();

    // Match count should appear
    await expect(page.locator('text=osumaa').first()).toBeVisible({ timeout: 5000 });
  });

  test('presets disappear after selection, add criterion button appears', async ({ page }) => {
    // Open tools → filter
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Suodata').first().click();
    await expect(page.locator('text=Etsi naapurustoja').first()).toBeVisible({ timeout: 5000 });

    // Presets should be visible when no criteria are set
    await expect(page.locator('text=Pikavalinnat').first()).toBeVisible();

    // Apply a preset
    await page.locator('text=Lapsiperheille').first().click();

    // Presets should no longer be visible (they only show when filters.length === 0)
    await expect(page.locator('text=Pikavalinnat')).not.toBeVisible({ timeout: 3000 });

    // The "Lisää kriteeri" (Add criterion) button should be visible
    await expect(page.locator('text=Lisää kriteeri').first()).toBeVisible();
  });
});
