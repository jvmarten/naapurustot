import type { Map as MaplibreMap } from 'maplibre-gl';

/**
 * Work around a MapLibre (5.21) crash on a REPEATED WebGL context loss.
 *
 * `Map._contextLost` saves the style (`_lostContextStyle = _getStyleAndImages()`) and
 * then sets `this.style = null`. If the context is lost a second time before it is
 * restored, which happens to long-lived background tabs and on flaky GPU drivers,
 * the second call finds no style and overwrites the saved copy with
 * `{style: null, images: {}}`. `_contextRestored` then skips `setStyle` (no style)
 * but still runs `this.style.imageManager.images = …` because `{}` is truthy, and
 * throws "Cannot read properties of null (reading 'imageManager')". That is Sentry
 * NAAPURUSTOT-WEB-V, from a tab left open for twelve days. Even without the throw,
 * the map would have come back with no style at all.
 *
 * A capture listener on the canvas runs before MapLibre's own (bubble-phase) one.
 * While the map is already lost (`style` is null), it stops the repeat event from
 * reaching MapLibre, so the first saved style survives to the restore. It still
 * calls `preventDefault()`, which tells the browser we want the context restored.
 * Our own components' loss listeners also never see the repeat, which is right:
 * their fallback is already up from the first loss.
 *
 * No disposer: `map.remove()` drops the canvas, and the listener goes with it.
 */
export function guardRepeatedContextLoss(map: MaplibreMap): void {
  map.getCanvas().addEventListener('webglcontextlost', (ev) => {
    if (map.style) return; // first loss: MapLibre saves the style as usual
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }, true);
}
