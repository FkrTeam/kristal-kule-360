export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

/**
 * Frame-rate independent exponential smoothing.
 * `lambda` = convergence speed; dt in seconds.
 */
export const damp = (a: number, b: number, lambda: number, dt: number) =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));

/** Shortest signed angular distance in degrees (wraps +-180). */
export const angleDelta = (from: number, to: number) => ((((to - from) % 360) + 540) % 360) - 180;

export const dampAngle = (a: number, b: number, lambda: number, dt: number) =>
  a + angleDelta(a, b) * (1 - Math.exp(-lambda * dt));
