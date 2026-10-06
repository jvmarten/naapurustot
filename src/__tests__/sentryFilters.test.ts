import { describe, it, expect } from 'vitest';
import { isInjectedPageScriptError, isInjectedScriptSyntaxError, type SentryEventShape } from '../utils/sentryFilters';

/**
 * Regression tests for the Sentry noise filter.
 *
 * Production reported an uncaught "SyntaxError: Unexpected token 'else'" on
 * /alue/02230-matinkyla/ from Chrome Mobile WebView 102 — an Android in-app browser
 * evaluating its own script in the page, which the engine attributes to the document
 * URL. The filter must drop that shape and keep every syntax error that carries a
 * frame in a script we shipped.
 */

/** Build a minimal Sentry error event with one exception and the given frames. */
function event(type: string, filenames: (string | undefined)[]): SentryEventShape {
  return {
    exception: {
      values: [{ type, stacktrace: { frames: filenames.map((filename) => ({ filename })) } }],
    },
  };
}

describe('isInjectedScriptSyntaxError — injected in-app-browser code is dropped', () => {
  it('drops the reported WebView SyntaxError attributed to the page URL', () => {
    // Exactly as it arrived: one synthetic frame naming the document, line 1.
    expect(
      isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/alue/02230-matinkyla/'])),
    ).toBe(true);
  });

  it('drops one attributed to the bare origin or a hub page', () => {
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/']))).toBe(true);
    expect(
      isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/kaupunki/helsinki_metro/'])),
    ).toBe(true);
  });

  it('drops one with no usable frame at all', () => {
    expect(isInjectedScriptSyntaxError(event('SyntaxError', [undefined]))).toBe(true);
    expect(isInjectedScriptSyntaxError({ exception: { values: [{ type: 'SyntaxError' }] } })).toBe(true);
  });

  it('drops one attributed to about:blank or an eval wrapper', () => {
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['about:blank']))).toBe(true);
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['<anonymous>']))).toBe(true);
  });
});

describe('isInjectedScriptSyntaxError — our own errors still report', () => {
  it('keeps a SyntaxError from an app chunk', () => {
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/assets/index-C-6zelJg.js']))).toBe(false);
  });

  it('keeps one whose chunk URL carries a query or hash', () => {
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/assets/App-abc123.js?v=2']))).toBe(false);
    expect(isInjectedScriptSyntaxError(event('SyntaxError', ['https://naapurustot.fi/sw.js#scope']))).toBe(false);
  });

  it('keeps a JSON.parse SyntaxError thrown inside our code', () => {
    // e.g. a corrupted __naapurustot_profile__ payload: the throw site is our chunk.
    expect(
      isInjectedScriptSyntaxError(
        event('SyntaxError', ['https://naapurustot.fi/alue/02230-matinkyla/', 'https://naapurustot.fi/assets/NeighborhoodProfilePage-xyz.js']),
      ),
    ).toBe(false);
  });

  it('keeps every non-syntax error, however it is attributed', () => {
    expect(isInjectedScriptSyntaxError(event('TypeError', ['https://naapurustot.fi/alue/02230-matinkyla/']))).toBe(false);
    expect(isInjectedScriptSyntaxError(event('RangeError', [undefined]))).toBe(false);
  });

  it('keeps a chained exception unless every link is a syntax error', () => {
    const chained: SentryEventShape = {
      exception: {
        values: [
          { type: 'SyntaxError', stacktrace: { frames: [{ filename: 'https://naapurustot.fi/alue/x/' }] } },
          { type: 'TypeError', stacktrace: { frames: [{ filename: 'https://naapurustot.fi/alue/x/' }] } },
        ],
      },
    };
    expect(isInjectedScriptSyntaxError(chained)).toBe(false);
  });

  it('keeps events with no exception (messages, transactions)', () => {
    expect(isInjectedScriptSyntaxError({})).toBe(false);
    expect(isInjectedScriptSyntaxError({ exception: { values: [] } })).toBe(false);
  });
});

/** Build an event whose frames carry both a filename and a function name. */
function framed(type: string, frames: { filename?: string; function?: string }[]): SentryEventShape {
  return { exception: { values: [{ type, stacktrace: { frames } }] } };
}

describe('isInjectedPageScriptError — named functions on the page URL are not ours', () => {
  const page = 'https://naapurustot.fi/';

  it('drops the Chrome-iOS stack overflow (NAAPURUSTOT-WEB-12/-13)', () => {
    // As reported: unnamed frames at the bottom, then Ok/Qk recursing on the page URL.
    const frames = [
      { filename: page },
      { filename: page },
      ...Array.from({ length: 20 }, (_, i) => ({ filename: page, function: i % 2 ? 'Qk' : 'Ok' })),
    ];
    expect(isInjectedPageScriptError(framed('RangeError', frames))).toBe(true);
  });

  it('keeps anything with a frame in a script we shipped', () => {
    expect(
      isInjectedPageScriptError(
        framed('RangeError', [
          { filename: page, function: 'Ok' },
          { filename: 'https://naapurustot.fi/assets/index-abc.js', function: 'Qk' },
        ]),
      ),
    ).toBe(false);
  });

  it('keeps errors from our own inline snippets, which only produce unnamed frames', () => {
    for (const fn of [undefined, '?', '<anonymous>', 'global code', 'onload']) {
      expect(isInjectedPageScriptError(framed('TypeError', [{ filename: page, function: fn }]))).toBe(false);
    }
  });

  it('keeps events with no stack to judge by', () => {
    expect(isInjectedPageScriptError({})).toBe(false);
    expect(isInjectedPageScriptError({ exception: { values: [{ type: 'TypeError' }] } })).toBe(false);
  });
});
