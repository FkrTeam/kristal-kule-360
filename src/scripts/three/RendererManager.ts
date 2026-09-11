/**
 * Owns the one WebGL2 canvas. Responsibilities:
 *   - renderer creation with the leanest context flags a panorama needs
 *   - pixel-ratio clamping (device tier) + runtime adjustment (perf monitor)
 *   - resize via ResizeObserver (never per frame, never layout-thrashing)
 *   - context-loss recovery
 */
import { WebGLRenderer, SRGBColorSpace, NoToneMapping, type Scene, type Camera } from 'three';
import { loop } from '../core/loop';

export class RendererManager {
  readonly renderer: WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  readonly maxTextureSize: number;
  readonly maxAnisotropy: number;
  private ro: ResizeObserver;
  private pixelRatio: number;
  private width = 1;
  private height = 1;
  private resizeListeners = new Set<(w: number, h: number) => void>();

  constructor(canvas: HTMLCanvasElement, pixelRatio: number) {
    this.canvas = canvas;
    this.pixelRatio = pixelRatio;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false,        // a full-screen textured sphere gains nothing from MSAA; hotspots AA in-shader
      alpha: false,
      depth: false,            // nothing overlaps in depth: sphere first, then billboards with depthTest off
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      premultipliedAlpha: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping; // photographic panoramas are already graded
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setClearColor(0x0b0c0e, 1);
    this.renderer.info.autoReset = true;

    const caps = this.renderer.capabilities;
    this.maxTextureSize = caps.maxTextureSize;
    this.maxAnisotropy = caps.getMaxAnisotropy();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement ?? canvas);
    this.resize();

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); loop.stop(); console.warn('[gl] context lost'); });
    canvas.addEventListener('webglcontextrestored', () => { console.info('[gl] context restored'); loop.requestRender(); loop.start(); });
  }

  get size(): { width: number; height: number } { return { width: this.width, height: this.height }; }

  onResize(fn: (w: number, h: number) => void): () => void {
    this.resizeListeners.add(fn);
    fn(this.width, this.height);
    return () => { this.resizeListeners.delete(fn); };
  }

  private resize(): void {
    const el = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, el.clientWidth), h = Math.max(1, el.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h;
    this.renderer.setSize(w, h, false); // CSS already sizes the canvas (inset:0)
    for (const fn of this.resizeListeners) fn(w, h);
    loop.requestRender();
  }

  setPixelRatio(v: number): void {
    if (v === this.pixelRatio) return;
    this.pixelRatio = v;
    this.renderer.setPixelRatio(v);
    this.renderer.setSize(this.width, this.height, false);
    loop.requestRender();
  }
  getPixelRatio(): number { return this.pixelRatio; }

  render(scene: Scene, camera: Camera): void { this.renderer.render(scene, camera); }

  dispose(): void {
    this.ro.disconnect();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
