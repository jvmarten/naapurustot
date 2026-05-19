import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';
import { trackEvent } from './analytics';

/** Round metric values to the smallest meaningful precision so Umami sees clean buckets. */
function roundMetric(name: Metric['name'], value: number): number {
  // CLS is unitless and small; keep three decimals.
  if (name === 'CLS') return Math.round(value * 1000) / 1000;
  // The rest are milliseconds — integer ms is plenty for trend analysis.
  return Math.round(value);
}

function send(metric: Metric): void {
  const value = roundMetric(metric.name, metric.value);
  if (import.meta.env.DEV) {
    console.debug(`[web-vitals] ${metric.name} = ${value} (rating: ${metric.rating})`);
    return;
  }
  // navigation type is 'navigate' | 'reload' | 'back-forward' | 'back-forward-cache' | 'prerender' | 'restore'
  trackEvent('web-vital', {
    metric: metric.name,
    value,
    rating: metric.rating,
    navigation_type: metric.navigationType,
  });
}

/** Subscribe to LCP / INP / CLS / FCP / TTFB and forward to Umami via trackEvent. */
export function reportWebVitals(): void {
  try {
    onLCP(send);
    onINP(send);
    onCLS(send);
    onFCP(send);
    onTTFB(send);
  } catch {
    // PerformanceObserver / web-vitals not supported — silently no-op.
  }
}
