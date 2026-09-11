/**
 * PanoramaViewer - composes the engine pieces into one object the page talks to.
 *
 *   RendererManager    the WebGL2 canvas, DPR, resize, context loss
 *   SceneManager       flat scene graph + disposal
 *   CameraController   yaw/pitch/fov, inputs, damping, flights
 *   TextureManager     WebP / KTX2 loading, upload, GPU byte accounting
 *   PanoSphere         the single textured sphere with crossfade
 *   Hotspots           instanced markers + labels
 *   PerformanceMonitor adaptive DPR + HUD
 *   Gyro               optional device orientation (mobile)
 *
 * Progressive loading: `loadScene()` walks the planned tiers (preview -> medium
 * -> high), uploads each before the crossfade, and disposes the previous tier
 * the moment the fade ends.
 */
import type { Quaternion, Texture } from 'three';
import { loop } from '../core/loop';
import { PerformanceMonitor } from '../core/perf';
import type { QualityProfile } from '../core/quality';
import { Emitter } from '../utils/events';
import { supports } from '../utils/supports';
import { RendererManager } from '../three/RendererManager';
import { SceneManager } from '../three/SceneManager';
import { CameraController, type View } from '../three/CameraController';
import { TextureManager } from '../three/TextureManager';
import { loadManifest, planTiers, panoUrl } from '../loading/manifest';
import { PanoSphere } from './PanoSphere';
import { Hotspots, type HotspotDef } from './Hotspots';
import { Gyro } from './Gyro';

export interface ViewerOptions {
  canvas: HTMLCanvasElement;
  labelRoot: HTMLElement;
  previewImg: HTMLImageElement | null;
  quality: QualityProfile;
}

type Events = {
  tier: { scene: string; width: number; index: number; total: number };
  scene: { id: string };
  hotspot: HotspotDef;
  progress: { scene: string; width: number; value: number };
};

export class PanoramaViewer extends Emitter<Events> {
  readonly renderer: RendererManager;
  readonly scenes = new SceneManager();
  readonly camera: CameraController;
  readonly textures: TextureManager;
  readonly sphere: PanoSphere;
  readonly hotspots: Hotspots;
  readonly perf: PerformanceMonitor;
  readonly quality: QualityProfile;
  private gyro: Gyro | null = null;
  private abort: AbortController | null = null;
  private currentScene = '';
  private currentWidth = 0;
  private disposers: (() => void)[] = [];

  constructor(opts: ViewerOptions) {
    super();
    const q = (this.quality = opts.quality);
    this.renderer = new RendererManager(opts.canvas, q.maxPixelRatio);
    const { width, height } = this.renderer.size;

    this.camera = new CameraController(opts.canvas, width / height);
    this.textures = new TextureManager(this.renderer.renderer, Math.min(q.anisotropy, this.renderer.maxAnisotropy));
    this.sphere = new PanoSphere(q.sphereSegments, q.effects && !supports.reducedMotion());
    // Rotate the sphere so the image centre (u = 0.5) sits at yaw 0 (camera -Z).
    this.sphere.mesh.rotation.y = -Math.PI / 2;
    this.sphere.mesh.updateMatrix();
    this.scenes.add('pano', this.sphere.mesh, 0);

    this.hotspots = new Hotspots(opts.canvas, opts.labelRoot);
    this.hotspots.camera = this.camera.camera;
    this.hotspots.on('select', (h) => this.emit('hotspot', h));

    this.perf = new PerformanceMonitor(this.renderer, this.renderer.renderer, q.minPixelRatio, q.maxPixelRatio);
    this.textures.onBytesChange = (d) => this.perf.trackTextureBytes(d);

    this.disposers.push(
      this.renderer.onResize((w, h) => {
        this.camera.setAspect(w / h);
        const pr = this.renderer.getPixelRatio();
        this.sphere.setResolution(w * pr, h * pr);
      }),
      loop.add((dt) => {
        let moved = false;
        if (this.gyro?.enabled) moved = this.gyro.update(dt) || moved;
        moved = this.camera.update(dt) || moved;
        if (moved) this.sphere.tick(dt);
        return moved;
      }),
      loop.addRenderer(() => this.renderer.render(this.scenes.scene, this.camera.camera)),
      loop.onAfterRender((dt) => {
        this.perf.sample(dt);
        const { width: w, height: h } = this.renderer.size;
        this.hotspots.updateLabels(this.camera.camera, w, h);
      }),
    );

    if (opts.previewImg?.naturalWidth) {
      const tex = this.textures.fromImage(opts.previewImg);
      this.textures.upload(tex);
      void this.sphere.setTexture(tex, 0);
      this.currentWidth = opts.previewImg.naturalWidth;
    }
    loop.requestRender();
    loop.start();
  }

  /* ------------------------------------------------------------- scenes */

  /**
   * Stream a panorama scene. Tiers already at or below the width on screen are
   * skipped, so calling this for the scene whose preview is showing continues
   * straight to medium -> high.
   */
  async loadScene(id: string, hotspots: HotspotDef[] = [], initialView?: Partial<View>): Promise<void> {
    this.abort?.abort();
    const ac = (this.abort = new AbortController());
    const sameScene = id === this.currentScene || !this.currentScene;
    this.currentScene = id;
    this.setHotspots(hotspots);

    const manifest = await loadManifest(id);
    let tiers = planTiers(manifest, this.quality.maxPanoWidth, this.renderer.maxTextureSize);
    if (sameScene) tiers = tiers.filter((t) => t.width > this.currentWidth);
    if (!sameScene && initialView) this.camera.flyTo(initialView, 1.2);

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i]!;
      let tex: Texture;
      try {
        tex = await this.textures.loadTier((f) => panoUrl(id, f), tier, true, {
          signal: ac.signal,
          onProgress: (value) => this.emit('progress', { scene: id, width: tier.width, value }),
        });
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn(`[viewer] tier ${tier.width} failed`, e);
        continue;
      }
      if (ac.signal.aborted) { this.textures.dispose(tex); return; }

      this.textures.upload(tex); // synchronous GPU upload now, so the fade itself is smooth
      const old = await this.sphere.setTexture(tex, i === 0 && !sameScene ? 1.4 : 1.0);
      this.textures.dispose(old);
      this.currentWidth = tier.width;
      this.emit('tier', { scene: id, width: tier.width, index: i + 1, total: tiers.length });
      if (i === 0 && !sameScene) this.emit('scene', { id });
    }
  }

  setHotspots(defs: HotspotDef[]): void {
    this.hotspots.set(defs);
    this.hotspots.setVisible(true);
    loop.requestRender();
  }

  /* -------------------------------------------------------------- camera */

  flyTo(view: Partial<View>, duration = 1.4): void { this.camera.flyTo(view, duration); }

  async enableGyro(): Promise<boolean> {
    if (!Gyro.available()) return false;
    this.gyro ??= new Gyro();
    const ok = await this.gyro.enable();
    this.camera.setGyroQuaternion(ok ? (this.gyro.quaternion as Quaternion) : null);
    if (!ok) this.gyro.disable();
    return ok;
  }

  disableGyro(): void {
    this.gyro?.disable();
    this.camera.setGyroQuaternion(null);
  }

  get gyroEnabled(): boolean { return !!this.gyro?.enabled; }

  /* -------------------------------------------------------------- misc */

  debug(): void {
    loop.alwaysRender = true;
    this.perf.showHud(() => `tier ${this.currentWidth}px  q:${this.quality.tier}  ${this.quality.gpu.slice(0, 40)}`);
  }

  dispose(): void {
    this.abort?.abort();
    for (const d of this.disposers) d();
    this.disableGyro();
    this.camera.dispose();
    this.hotspots.dispose();
    this.sphere.dispose();
    this.scenes.dispose();
    this.textures.disposeAll();
    this.perf.hideHud();
    this.renderer.dispose();
  }
}

export type { View, HotspotDef };
