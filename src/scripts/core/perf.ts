/**
 * Performance monitor + adaptive quality.
 *
 * Samples only *rendered* frames (on-demand loop), keeps a short EMA of frame time,
 * and nudges the renderer's pixel ratio down when we sustain < 45 fps, back up when
 * we sustain > 57 fps for a while. Also exposes a dev HUD (`?debug` in the URL).
 */
import type { WebGLRenderer } from 'three';
import { clamp } from '../utils/math';

export interface PerfSnapshot {
  fps: number;
  frameMs: number;
  pixelRatio: number;
  drawCalls: number;
  triangles: number;
  textures: number;
  geometries: number;
  textureMB: number;
}

interface Target { setPixelRatio(v: number): void; getPixelRatio(): number }

export class PerformanceMonitor {
  private ema = 16.7;
  private lowSince = 0;
  private highSince = 0;
  private lastAdjust = 0;
  private hud: HTMLElement | null = null;
  private hudTimer = 0;
  private textureBytes = 0;
  private samples = 0;

  constructor(
    private target: Target,
    private renderer: WebGLRenderer,
    private min: number,
    private max: number,
  ) {}

  /** Call once per *rendered* frame. */
  sample(dt: number): void {
    const ms = dt * 1000;
    this.ema += (ms - this.ema) * 0.08;
    this.samples++;
    if (this.samples < 30) return; // warm-up: skip shader compile / first uploads

    const now = performance.now();
    const fps = 1000 / this.ema;

    if (fps < 45) {
      this.highSince = 0;
      if (!this.lowSince) this.lowSince = now;
      else if (now - this.lowSince > 1500 && now - this.lastAdjust > 2000) this.adjust(-0.25, now);
    } else if (fps > 57) {
      this.lowSince = 0;
      if (!this.highSince) this.highSince = now;
      else if (now - this.highSince > 6000 && now - this.lastAdjust > 6000) this.adjust(+0.25, now);
    } else {
      this.lowSince = this.highSince = 0;
    }
  }

  private adjust(delta: number, now: number): void {
    const cur = this.target.getPixelRatio();
    const next = clamp(Math.round((cur + delta) * 100) / 100, this.min, this.max);
    if (next !== cur) {
      this.target.setPixelRatio(next);
      if (import.meta.env.DEV) console.info(`[perf] pixelRatio ${cur} -> ${next} (${(1000 / this.ema).toFixed(0)} fps)`);
    }
    this.lastAdjust = now;
    this.lowSince = this.highSince = 0;
  }

  trackTextureBytes(delta: number): void { this.textureBytes = Math.max(0, this.textureBytes + delta); }

  snapshot(): PerfSnapshot {
    const i = this.renderer.info;
    return {
      fps: 1000 / this.ema,
      frameMs: this.ema,
      pixelRatio: this.target.getPixelRatio(),
      drawCalls: i.render.calls,
      triangles: i.render.triangles,
      textures: i.memory.textures,
      geometries: i.memory.geometries,
      textureMB: this.textureBytes / 1048576,
    };
  }

  /** Dev HUD - cheap textContent update at 4 Hz, never per frame. */
  showHud(extra?: () => string): void {
    if (this.hud) return;
    this.hud = Object.assign(document.createElement('div'), { id: 'perf-hud' });
    document.body.append(this.hud);
    this.hudTimer = window.setInterval(() => {
      const s = this.snapshot();
      this.hud!.textContent =
        `${s.fps.toFixed(0)} fps  ${s.frameMs.toFixed(1)} ms\n` +
        `dpr ${s.pixelRatio}  calls ${s.drawCalls}  tris ${s.triangles}\n` +
        `tex ${s.textures} (${s.textureMB.toFixed(0)} MB est)  geo ${s.geometries}` +
        (extra ? `\n${extra()}` : '');
    }, 250);
    this.observeVitals();
  }

  hideHud(): void {
    clearInterval(this.hudTimer);
    this.hud?.remove();
    this.hud = null;
  }

  /** Log Core Web Vitals in debug mode without pulling in the web-vitals package. */
  private observeVitals(): void {
    if (!('PerformanceObserver' in window)) return;
    const log = (name: string, v: number) => console.info(`[vitals] ${name}: ${name === 'CLS' ? v.toFixed(3) : v.toFixed(0) + ' ms'}`);
    try {
      new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) log('LCP', e.startTime); })
        .observe({ type: 'largest-contentful-paint', buffered: true });
      let cls = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as (PerformanceEntry & { hadRecentInput: boolean; value: number })[]) if (!e.hadRecentInput) cls += e.value;
        log('CLS', cls);
      }).observe({ type: 'layout-shift', buffered: true });
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as (PerformanceEntry & { processingStart: number })[]) log('INP-candidate', e.processingStart - e.startTime);
      }).observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit);
    } catch { /* unsupported entry types */ }
  }
}
