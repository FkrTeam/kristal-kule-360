/** Feature detection, evaluated once and cached. Everything here is synchronous and cheap. */

const cache: Record<string, boolean> = {};
const safe = (fn: () => boolean) => { try { return fn(); } catch { return false; } };
const memo = (k: string, fn: () => boolean) => (k in cache ? cache[k]! : (cache[k] = safe(fn)));

type NavExt = Navigator & { connection?: { saveData?: boolean; effectiveType?: string } };

export const supports = {
  webgl2: () => memo('webgl2', () => !!document.createElement('canvas').getContext('webgl2')),
  touch: () => memo('touch', () => 'ontouchstart' in window || navigator.maxTouchPoints > 0),
  gyro: () => memo('gyro', () => 'DeviceOrientationEvent' in window),
  /** iOS 13+ requires a user-gesture permission request for orientation events. */
  gyroNeedsPermission: () =>
    memo('gyroPerm', () => typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission === 'function'),
  reducedMotion: () => memo('rm', () => matchMedia('(prefers-reduced-motion: reduce)').matches),
  saveData: () => memo('sd', () => !!(navigator as NavExt).connection?.saveData),
  slowNetwork: () => memo('slow', () => /(^|-)2g|3g/.test((navigator as NavExt).connection?.effectiveType ?? '')),
  imageBitmap: () => memo('ib', () => 'createImageBitmap' in window),
};
