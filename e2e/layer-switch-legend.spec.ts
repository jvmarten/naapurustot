import { test, expect } from '@playwright/test';

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"][data-loaded="true"]', { timeout: 30000 });
}

test.describe('layer switching and legend updates', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('switching layer updates the legend title', async ({ page }) => {
    // Verify the default legend label is the quality index (Finnish: "Laatuindeksi")
    await expect(page.locator('text=Laatuindeksi').first()).toBeVisible({ timeout: 5000 });

    // Expand the "Talous" (Economy) group in the layer selector
    const economyGroup = page.locator('text=Talous').first();
    await expect(economyGroup).toBeVisible({ timeout: 5000 });
    await economyGroup.click();

    // Click on "Mediaanitulo" (Median Income) layer
    const medianIncomeLayer = page.locator('button[role="option"]').filter({ hasText: 'Mediaanitulo' });
    await expect(medianIncomeLayer).toBeVisible({ timeout: 3000 });
    await medianIncomeLayer.click();

    // The legend title should now show "Mediaanitulo"
    await expect(page.locator('text=Mediaanitulo').first()).toBeVisible({ timeout: 5000 });

    // Verify the URL hash updates to reflect the new layer
    await expect(page).toHaveURL(/layer=median_income/, { timeout: 3000 });
  });

  test('switching to unemployment layer updates legend', async ({ page }) => {
    // Expand the Economy group
    const economyGroup = page.locator('text=Talous').first();
    await economyGroup.click();

    // Click on "Työttömyysaste" (Unemployment Rate)
    const unemploymentLayer = page.locator('button[role="option"]').filter({ hasText: 'Työttömyysaste' });
    await expect(unemploymentLayer).toBeVisible({ timeout: 3000 });
    await unemploymentLayer.click();

    // Legend should update
    await expect(page.locator('text=Työttömyysaste').first()).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/layer=unemployment/, { timeout: 3000 });
  });

  test('layer selector shows color dots for each layer option', async ({ page }) => {
    // Expand the "Elämänlaatu" (Quality of Life) group — it should already be partially visible
    const qualityGroup = page.locator('text=Elämänlaatu').first();
    await qualityGroup.click();

    // Verify that layer options exist with role="option"
    const layerOptions = page.locator('button[role="option"]');
    const count = await layerOptions.count();
    expect(count).toBeGreaterThan(0);

    // Each option should have a colored dot (div with rounded-full class and inline background color)
    const firstOption = layerOptions.first();
    const colorDot = firstOption.locator('.rounded-full');
    await expect(colorDot.first()).toBeVisible();
  });

  test('active layer is highlighted in the layer selector', async ({ page }) => {
    // The default layer is quality_index, which is in the "Elämänlaatu" group
    // Expand the group
    const qualityGroup = page.locator('text=Elämänlaatu').first();
    await qualityGroup.click();

    // The active layer option should have aria-selected="true"
    const activeOption = page.locator('button[role="option"][aria-selected="true"]');
    await expect(activeOption).toBeVisible({ timeout: 3000 });
    await expect(activeOption).toContainText('Laatuindeksi');
  });
});
