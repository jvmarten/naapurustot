/**
 * Sentry `beforeSend` predicates for errors that provably did not come from our
 * code. Kept out of main.tsx so they are unit-testable, and side-effect-free so
 * builds without VITE_SENTRY_DSN tree-shake them out along with the init block
 * that references them.
 */

/** The subset of a Sentry error event these predicates read. */
export interface SentryEventShape {
  exception?: {
    values?: {
      type?: string;
      stacktrace?: { frames?: { filename?: string }[] }
    }[]
  };
}

/** Does `filename` name a JavaScript file — i.e. a script we could have shipped? */
function isScriptFile(filename: string | undefined): boolean {
  if (!filename) return false;
  // Drop any query/hash so a cache-busted `/assets/index-abc.js?v=2` still counts.
  return /\.[cm]?js$/i.test(filename.split(/[?#]/)[0]);
}

/**
 * A parse error in JavaScript that is not ours, attributed to the page itself.
 *
 * Android in-app browsers (Facebook, Instagram, TikTok, …) run their own scripts
 * inside the page via WebView.evaluateJavascript(). That code has no URL of its
 * own, so the engine attributes a parse failure in it to the *document* — which
 * arrives here as an uncaught "SyntaxError: Unexpected token 'else'" on, say,
 * /alue/02230-matinkyla/, line 1, from a two-generations-stale WebView. It looks
 * like a bug on the page it was injected into; it is unfixable from our side.
 *
 * The discriminator is the stack frames' filenames. Every line of JavaScript we
 * ship is either a hashed `/assets/*.js` chunk or one of the two hand-written
 * inline snippets in index.html (the theme guard and the font-swap `onload`),
 * both plain ES5 — and `assertHeadIntegrity` in scripts/prerender-lib.mjs fails
 * the build if the prerender's regex surgery ever truncates the inline ones into
 * a syntax error. So a SyntaxError with no `.js` frame is injected code, while a
 * genuine one — a corrupt chunk, a build target too modern for a browser we
 * support — always carries an `/assets/*.js` frame and still reports.
 */
export function isInjectedScriptSyntaxError(event: SentryEventShape): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;
  if (!values.every((v) => v.type === 'SyntaxError')) return false;
  const frames = values.flatMap((v) => v.stacktrace?.frames ?? []);
  return !frames.some((f) => isScriptFile(f.filename));
}
