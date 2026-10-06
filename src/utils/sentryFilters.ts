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
      stacktrace?: { frames?: { filename?: string; function?: string }[] }
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

/**
 * Frame names an engine gives code that is not inside a named function: top-level
 * script ("global code" on WebKit), an inline event-handler attribute, or Sentry's
 * placeholder for an unnamed frame. Our own inline snippets in index.html (the
 * anonymous theme-guard IIFE and the font link's `onload`) only ever produce these.
 */
const UNNAMED_FRAME = /^(\?|<anonymous>|anonymous|global code|onload)$/;

/**
 * A runtime error thrown by a *named function* that lives in the document itself.
 *
 * iOS browsers other than Safari (Chrome, Edge, Firefox, in-app views) inject their
 * own minified scripts into every page through WKUserScript, and WebKit attributes
 * those scripts to the document URL. NAAPURUSTOT-WEB-12/-13 are one of them blowing
 * its stack on Chrome Mobile iOS: forty frames of `Ok`/`Qk` recursing at
 * https://naapurustot.fi/:226:408 — a line of index.html that is a bare `</script>`
 * thirteen characters long, below JSON-LD that is not even executable.
 *
 * The page's own JavaScript in the document is exactly two snippets, an anonymous
 * IIFE and an attribute handler, so neither can put a named frame on the page URL.
 * Everything else we ship runs from `/assets/*.js` and keeps that frame, so an error
 * with a stack, no `.js` frame anywhere in it and a named function among its frames
 * is somebody else's code.
 */
export function isInjectedPageScriptError(event: SentryEventShape): boolean {
  const values = event.exception?.values;
  if (!values?.length) return false;
  const frames = values.flatMap((v) => v.stacktrace?.frames ?? []);
  if (!frames.length) return false;
  if (frames.some((f) => isScriptFile(f.filename))) return false;
  return frames.some((f) => !!f.function && !UNNAMED_FRAME.test(f.function));
}
