/**
 * DEV ONLY: `?dpr=1.5` fakes window.devicePixelRatio so pixel-ratio handling can be exercised
 * from a browser that runs at ratio 1 (Windows 125%/150% scaling and browser zoom change it).
 * Imported first in main.ts so it runs before anything reads devicePixelRatio.
 */
if (import.meta.env.DEV) {
  const v = Number.parseFloat(new URLSearchParams(window.location.search).get('dpr') ?? '');
  if (Number.isFinite(v) && v > 0) {
    Object.defineProperty(window, 'devicePixelRatio', { get: () => v, configurable: true });
  }
}
export {};
