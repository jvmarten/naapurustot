import { test, expect } from '@playwright/test';

/**
 * /live/ — a smoke spec, because unit tests cannot reach this page's failure modes.
 *
 * The realtime surface is ~9,800 lines across 22 modules behind a lazy chunk that
 * nothing else in CI ever loads in a browser. The things most likely to take it
 * down are all mount-time and none of them are visible to Vitest: a broken
 * `import('maplibre-gl')`, a Suspense/lazy wiring mistake in main.tsx, a
 * WebGL-less crash, a locale asset that never resolves, an effect that throws on
 * the first render. Any one of those ships a blank page while 3,200 unit tests
 * stay green.
 *
 * So this asserts the page comes up, in the language its URL claims, and that
 * the two pieces of state a link is supposed to carry survive the round trip.
 *
 * WHAT IT DOES NOT ASSERT is anything that needs the network. The feeds reach
 * FMI, Fintraffic, Overpass and a basemap CDN, and a spec that waited on those
 * would fail for reasons that have nothing to do with this repository. The map
 * canvas, the sidebar, the clock and the URL codec are all reachable without a
 * single successful fetch — that is the surface pinned here.
 */

/** The page is up once MapLibre has put its canvas in the DOM. */
async function waitForLiveMap(page: import('@playwright/test').Page) {
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30000 });
}

test.describe('/live/', () => {
  test('mounts, in Finnish, with its map and its clock', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/live/');
    await waitForLiveMap(page);

    // The feed sidebar is generated entirely from FEED_GROUPS, so its group
    // heading appearing means the registry, the locale dictionary and the
    // component all resolved.
    await expect(page.getByText('Aurinko ja varjot')).toBeVisible();
    // The shared clock. role="slider" is the contract the bar carries.
    await expect(page.getByRole('slider')).toBeVisible();

    // A page error here is a crash, not a failed fetch — those surface as
    // console messages and are deliberately not collected.
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('renders /en/live/ in English and /sv/live/ in Swedish', async ({ page }) => {
    // The three URLs exist to be indexed separately, with their own titles and
    // hreflang (scripts/prerender.mjs). They rendered Finnish regardless until
    // the routes started carrying a `lang` prop, so an English visitor arriving
    // on an English title got a Finnish interface.
    await page.goto('/en/live/');
    await waitForLiveMap(page);
    await expect(page.getByText('Sun & shadows')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');

    await page.goto('/sv/live/');
    await waitForLiveMap(page);
    await expect(page.getByText('Sol och skuggor')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv');
  });

  test('opens where a link points, and keeps the link', async ({ page }) => {
    // Oulu rather than the Helsinki default, so "the camera moved" and "the
    // camera was never set" cannot look the same.
    await page.goto('/live/?at=65.01210,25.46510,14.00&t=2026-08-16T15:42Z&f=shadows');
    await waitForLiveMap(page);

    // The clock is pinned, not following: `t` present means an instant somebody
    // chose, and the bar says so rather than ticking off it.
    await expect(page).toHaveURL(/t=2026-08-16T15:42Z/);
    await expect(page).toHaveURL(/at=65\.01210,25\.46510/);

    // `f=shadows` is one of three feeds in the sun group, and the sidebar prints
    // the count — so this reads the applied state rather than the URL again.
    await expect(page.getByText('1/3').first()).toBeVisible();

    // The third of them is the UV index, and its label lives in `fi-extra.json`
    // — a lazily fetched asset. A registry row whose `labelKey` never resolves
    // renders as the raw key, which no unit test can see because none of them
    // mounts the sidebar against the real dictionary.
    await expect(page.getByText('UV-indeksi')).toBeVisible();
  });

  test('carries a raster feed through the registry to a working toggle', async ({ page }) => {
    // The radar is the one feed on the page whose layer is an image rather than
    // a list of marks, and it reaches the sidebar the same way every other feed
    // does: a row in FEED_GROUPS plus three locale keys, with no mention of it
    // in FeedSidebar.tsx. This is what would catch a registry entry whose
    // `labelKey` has no dictionary behind it — which renders as the raw key and
    // is invisible to the unit tests, since they never mount the sidebar.
    await page.goto('/live/?f=radar');
    await waitForLiveMap(page);

    await expect(page.getByText('Sadetutka')).toBeVisible();
    // `sanitizeEnabled` keeps only ids that are real AND live, so the applied
    // count is the round trip through the registry rather than an echo of `f=`.
    // The denominator is the weather group's live-feed count: radar,
    // observations, clouds, wind, air quality, sea level and lightning.
    await expect(page.getByText('1/7').first()).toBeVisible();
  });

  test('gives a phone its map and keeps the clock on screen', async ({ page }) => {
    // Two desktop-only assumptions shipped together here: `h-screen` (100vh,
    // which on a phone is the viewport with the browser chrome COLLAPSED, so
    // the footer sat below the fold) and a 256 px feed sidebar opened
    // unconditionally, leaving ~134 px of map on a 390 px screen. Neither is
    // visible at desktop widths, and nothing else in this suite is narrow.
    await page.setViewportSize({ width: 390, height: 780 });
    await page.goto('/live/');
    await waitForLiveMap(page);

    // The sidebar starts closed, so the map has the width.
    await expect(page.getByText('Aurinko ja varjot')).toBeHidden();
    const canvas = await page.locator('.maplibregl-canvas').boundingBox();
    expect(canvas?.width ?? 0).toBeGreaterThan(300);

    // And the clock — the control every layer on the page answers to — is
    // inside the viewport rather than under the browser chrome.
    const slider = await page.getByRole('slider').boundingBox();
    expect(slider).not.toBeNull();
    expect(slider!.y + slider!.height).toBeLessThanOrEqual(780);
  });

  test('keeps keyboard focus on the trigger as the sidebar closes and reopens', async ({ page }) => {
    // Opening the sidebar swaps the header's "Filters" button for the panel, and
    // closing it swaps back — each time, the activated control unmounts, and React
    // drops focus to <body> unless the page moves it onto the replacement. A
    // keyboard user stranded on <body> has to tab in from the top of the document
    // every time, which is the WCAG 2.4.3 failure this pins. No network is needed:
    // the sidebar and its trigger mount without a single successful fetch.
    await page.goto('/live/');
    await waitForLiveMap(page);

    // Desktop default viewport, so the sidebar starts open. Its close control's
    // label lives in the lazily-fetched fi-extra dictionary, so waiting on it
    // confirms the panel and its real labels are both present before we type.
    const closeBtn = page.getByRole('button', { name: 'Sulje suodattimet' });
    await expect(closeBtn).toBeVisible();

    // Escape closes it — focus must land on the "Filters" button now in the header.
    await page.keyboard.press('Escape');
    const reopen = page.getByRole('button', { name: 'Suodattimet' });
    await expect(reopen).toBeFocused();

    // Reopening from that button moves focus into the panel, onto its close control.
    await reopen.press('Enter');
    await expect(closeBtn).toBeFocused();
  });

  test('remembers the camera for a later bare /live/', async ({ page }) => {
    await page.goto('/live/?at=65.01210,25.46510,14.00');
    await waitForLiveMap(page);
    // The sync is debounced; the assertion below is what waits for it.

    await page.goto('/live/');
    await waitForLiveMap(page);
    // Restored from localStorage and written back to the address bar, so a
    // bookmarked /live/ no longer drops the reader over Helsinki every time.
    await expect(page).toHaveURL(/at=65\.01210,25\.46510/, { timeout: 15000 });
  });
});
