/**
 * The single requestAnimationFrame loop for the whole site.
 *
 *   rAF
 *    1. tasks   (lenis.raf, gsap.updateRoot, camera, gyro, hotspots ...)
 *    2. render  (only if something asked for it)   <- on-demand rendering
 *    3. after   (perf sampling -> adaptive quality)
 *
 * Tasks return `true` when they changed something visible; the frame is only
 * rendered when at least one did (or `requestRender()` was called). A static
 * panorama therefore costs ~0 GPU time while the user reads.
 */
export type Task = (dt: number, time: number) => boolean | void;

export class RenderLoop {
  private tasks = new Set<Task>();
  private renderers = new Set<() => void>();
  private after = new Set<(dt: number) => void>();
  private raf = 0;
  private last = 0;
  private dirty = true;
  private running = false;
  /** Render every frame regardless (e.g. while the debug HUD is visible). */
  alwaysRender = false;

  constructor() {
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
  }

  add(task: Task): () => void { this.tasks.add(task); return () => { this.tasks.delete(task); }; }
  addRenderer(fn: () => void): () => void { this.renderers.add(fn); return () => { this.renderers.delete(fn); }; }
  onAfterRender(fn: (dt: number) => void): () => void { this.after.add(fn); return () => { this.after.delete(fn); }; }

  requestRender(): void { this.dirty = true; }

  start(): void {
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private tick = (time: number): void => {
    if (!this.running) return;
    // Clamp dt to [0, 50 ms]: no 2 s "jump" after a tab switch or GC pause, and never
    // negative (timestamp anomalies would otherwise run tweens backwards).
    const dt = Math.min(Math.max((time - this.last) / 1000, 0), 1 / 20);
    this.last = time;

    let needsRender = this.dirty || this.alwaysRender;
    for (const task of this.tasks) if (task(dt, time)) needsRender = true;

    if (needsRender) {
      for (const r of this.renderers) r();
      this.dirty = false;
      for (const fn of this.after) fn(dt);
    }
    this.raf = requestAnimationFrame(this.tick);
  };
}

export const loop = new RenderLoop();
