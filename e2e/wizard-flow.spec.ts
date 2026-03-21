import { test, expect } from '@playwright/test';

async function waitForDataLoaded(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"][data-loaded="true"]', { timeout: 30000 });
}

test.describe('neighborhood wizard flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForDataLoaded(page);
  });

  test('open wizard → complete all steps → verify results', async ({ page }) => {
    // Open the tools dropdown
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await expect(toolsButton).toBeVisible({ timeout: 5000 });
    await toolsButton.click();

    // Click "Etsi naapurusto" (Find neighborhood) to open the wizard
    const wizardOption = page.locator('text=Etsi naapurusto').first();
    await expect(wizardOption).toBeVisible({ timeout: 3000 });
    await wizardOption.click();

    // The wizard modal should appear with the title "Asuinalueen valitsin" (Neighborhood Finder)
    const wizardTitle = page.locator('text=Asuinalueen valitsin');
    await expect(wizardTitle).toBeVisible({ timeout: 5000 });

    // --- Step 1: Lifestyle ---
    // Verify step 1 heading is visible: "Elämäntyyli" (Lifestyle)
    await expect(page.locator('h3:has-text("Elämäntyyli")')).toBeVisible();

    // The transit importance slider should be present
    await expect(page.locator('text=Julkisen liikenteen tärkeys')).toBeVisible();

    // The quiet preference buttons should be present
    await expect(page.locator('text=Rauhallinen')).toBeVisible();
    await expect(page.locator('text=Neutraali')).toBeVisible();
    await expect(page.locator('text=Vilkas')).toBeVisible();

    // Select "Rauhallinen" (Quiet)
    await page.locator('button:has-text("Rauhallinen")').click();

    // Click "Seuraava" (Next) to proceed to step 2
    const nextButton = page.locator('button:has-text("Seuraava")');
    await nextButton.click();

    // --- Step 2: Housing ---
    await expect(page.locator('h3:has-text("Asuminen")')).toBeVisible();

    // Budget fields should be present
    await expect(page.locator('text=Asuntobudjetti')).toBeVisible();

    // Apartment size preference buttons should be present
    await expect(page.locator('text=Asunnon koko')).toBeVisible();
    await expect(page.locator('button:has-text("Pieni")')).toBeVisible();
    await expect(page.locator('button:has-text("Keskikokoinen")')).toBeVisible();
    await expect(page.locator('button:has-text("Suuri")')).toBeVisible();

    // Select "Keskikokoinen" (Medium)
    await page.locator('button:has-text("Keskikokoinen")').click();

    // Tenure preference buttons should be present
    await expect(page.locator('text=Omistus vai vuokra')).toBeVisible();

    // Select "Ei väliä" (Either)
    await page.locator('button:has-text("Ei väliä")').click();

    // Proceed to step 3
    await nextButton.click();

    // --- Step 3: Family & Services ---
    await expect(page.locator('h3:has-text("Perhe ja palvelut")')).toBeVisible();

    // Children question
    await expect(page.locator('text=Onko sinulla lapsia')).toBeVisible();

    // Select "Ei" (No) — scope to wizard modal to avoid matching "Aineistot" FAB
    const wizardModal = page.locator('.fixed.inset-0.z-50');
    await wizardModal.locator('button:has-text("Ei")').first().click();

    // Healthcare importance slider should be present
    await expect(page.locator('text=Terveyspalvelujen tärkeys')).toBeVisible();

    // Proceed to step 4 (Results)
    await nextButton.click();

    // --- Step 4: Results ---
    // The results heading "Parhaat osumat" (Top matches) should appear
    await expect(page.locator('h3:has-text("Parhaat osumat")')).toBeVisible({ timeout: 10000 });

    // Results should show numbered neighborhood matches (at least one)
    // Each result has a numbered circle (1, 2, 3...) and a name
    const resultItems = page.locator('button').filter({
      has: page.locator('.rounded-full.bg-blue-500'),
    });
    const resultCount = await resultItems.count();
    expect(resultCount).toBeGreaterThan(0);

    // Each result should show a percentage score
    await expect(page.locator('text=/%/').first()).toBeVisible({ timeout: 3000 });

    // The "Näytä tulokset" / finish button should be visible
    const finishButton = page.locator('button:has-text("Näytä tulokset")');
    await expect(finishButton).toBeVisible();

    // Click finish to close the wizard
    await finishButton.click();

    // The wizard modal should close
    await expect(wizardTitle).not.toBeVisible({ timeout: 3000 });
  });

  test('wizard back button navigates to previous step', async ({ page }) => {
    // Open wizard
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Etsi naapurusto').first().click();
    await expect(page.locator('text=Asuinalueen valitsin')).toBeVisible({ timeout: 5000 });

    // We're on step 1
    await expect(page.locator('h3:has-text("Elämäntyyli")')).toBeVisible();

    // Go to step 2
    await page.locator('button:has-text("Seuraava")').click();
    await expect(page.locator('h3:has-text("Asuminen")')).toBeVisible();

    // Click "Takaisin" (Back)
    const backButton = page.locator('button:has-text("Takaisin")');
    await expect(backButton).toBeVisible();
    await backButton.click();

    // Should be back on step 1
    await expect(page.locator('h3:has-text("Elämäntyyli")')).toBeVisible();
  });

  test('wizard can be closed by clicking X button', async ({ page }) => {
    // Open wizard
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Etsi naapurusto').first().click();

    const wizardTitle = page.locator('text=Asuinalueen valitsin');
    await expect(wizardTitle).toBeVisible({ timeout: 5000 });

    // Close by clicking the X button in the wizard header
    const wizardModal = page.locator('.fixed.inset-0.z-50');
    const closeBtn = wizardModal.locator('button').filter({
      has: page.locator('svg path[d="M6 18L18 6M6 6l12 12"]'),
    }).first();
    await closeBtn.click();

    // Wizard should be closed
    await expect(wizardTitle).not.toBeVisible({ timeout: 3000 });
  });

  test('wizard with children selected shows school importance slider', async ({ page }) => {
    // Open wizard
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Etsi naapurusto').first().click();
    await expect(page.locator('text=Asuinalueen valitsin')).toBeVisible({ timeout: 5000 });

    // Navigate to step 3 (Family & Services)
    await page.locator('button:has-text("Seuraava")').click();
    await page.locator('button:has-text("Seuraava")').click();
    await expect(page.locator('h3:has-text("Perhe ja palvelut")')).toBeVisible();

    // Select "Kyllä" (Yes) for has children
    await page.locator('button:has-text("Kyllä")').click();

    // School importance slider should now appear: "Koulujen tärkeys"
    await expect(page.locator('text=Koulujen tärkeys')).toBeVisible({ timeout: 3000 });
  });

  test('wizard step indicators show progress', async ({ page }) => {
    // Open wizard
    const toolsButton = page.locator('button[aria-label="Työkalut"]');
    await toolsButton.click();
    await page.locator('text=Etsi naapurusto').first().click();
    await expect(page.locator('text=Asuinalueen valitsin')).toBeVisible({ timeout: 5000 });

    // Step indicators should show 4 numbered circles
    // The first step (current) should be highlighted (blue bg)
    const stepIndicators = page.locator('.rounded-full.flex.items-center.justify-center');
    const indicatorCount = await stepIndicators.count();
    expect(indicatorCount).toBe(4);

    // First indicator should contain "1" and have blue styling
    await expect(stepIndicators.nth(0)).toContainText('1');
  });
});
