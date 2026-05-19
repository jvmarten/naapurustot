/**
 * Lighthouse CI configuration (IN-3).
 *
 * Audits the production build's main app shell plus a sample prerendered
 * neighborhood profile page (FI + EN), so regressions in either the SPA's
 * critical path or the static SEO pages get caught before merge.
 *
 * Asserts the score thresholds from the roadmap:
 *   performance ≥ 0.85, accessibility ≥ 0.95, best-practices ≥ 0.95, seo ≥ 0.95.
 *
 * The HTML reports are uploaded to ./lhci-reports/ and surfaced as a PR
 * artifact by the workflow.
 */
const fs = require('fs');
const path = require('path');

const distDir = path.join(__dirname, 'dist');

function findSamplePrerenderedSlug(localePath) {
  // localePath is relative to dist, e.g. 'alue' (FI) or 'en/area' (EN).
  const dir = path.join(distDir, localePath);
  if (!fs.existsSync(dir)) return null;
  const entries = fs.readdirSync(dir).filter((name) => {
    if (name.startsWith('.')) return false;
    const full = path.join(dir, name);
    return fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'index.html'));
  });
  return entries.length > 0 ? entries[0] : null;
}

const urls = ['http://localhost/index.html'];
const fiSlug = findSamplePrerenderedSlug('alue');
if (fiSlug) urls.push(`http://localhost/alue/${fiSlug}/index.html`);
const enSlug = findSamplePrerenderedSlug('en/area');
if (enSlug) urls.push(`http://localhost/en/area/${enSlug}/index.html`);

module.exports = {
  ci: {
    collect: {
      staticDistDir: './dist',
      url: urls,
      numberOfRuns: 1,
      settings: {
        preset: 'desktop',
        chromeFlags: '--no-sandbox --headless=new --disable-dev-shm-usage',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        // Skip audits that are infrastructure-level (CDN/host config) rather than app code.
        // Lighthouse CI runs against a local static server that can't satisfy them anyway.
        skipAudits: [
          'uses-http2',
          'redirects-http',
          'is-on-https',
          'uses-long-cache-ttl',
          'canonical',
        ],
      },
    },
    assert: {
      assertions: {
        'categories:performance': ['error', { minScore: 0.85 }],
        'categories:accessibility': ['error', { minScore: 0.95 }],
        'categories:best-practices': ['error', { minScore: 0.95 }],
        'categories:seo': ['error', { minScore: 0.95 }],
      },
    },
    upload: {
      target: 'filesystem',
      outputDir: './lhci-reports',
    },
  },
};
