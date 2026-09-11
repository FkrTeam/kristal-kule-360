/**
 * Boot: preview image first (LCP), then Three.js on idle, then the panorama
 * tiers stream in. Hotspots come from public/assets/pano/<scene>/hotspots.json.
 * `?debug` shows the perf HUD, `?edit` opens the marker editor.
 */
import { detectQuality } from './core/quality';
import { loop } from './core/loop';
import { supports } from './utils/supports';
import { $, idle, decodeImage, readParams } from './utils/dom';
import { panoUrl } from './loading/manifest';
import { site } from '../data/site';
import type { HotspotDef, PanoramaViewer } from './viewer/PanoramaViewer';

async function loadHotspots(scene: string): Promise<HotspotDef[]> {
  try {
    const r = await fetch(panoUrl(scene, 'hotspots.json'), { cache: 'no-cache' });
    return r.ok ? ((await r.json()) as HotspotDef[]) : [];
  } catch { return []; }
}

async function boot(): Promise<void> {
  const params = readParams();
  const debug = params.has('debug');
  const edit = params.has('edit');
  const quality = detectQuality();
  if (debug) {
    console.info('[quality]', quality);
    Object.assign(window as unknown as Record<string, unknown>, { __loop: loop });
  }

  const preview = $<HTMLImageElement>('#stage-preview');
  const canvas = $<HTMLCanvasElement>('#stage-canvas');
  const labelRoot = $('#hotspot-labels');
  const hint = $('#hint');
  const gyroBtn = $<HTMLButtonElement>('#gyro-btn');
  const fsBtn = $<HTMLButtonElement>('#fs-btn');

  await decodeImage(preview);
  preview.classList.add('is-ready');

  if (!supports.webgl2()) {
    hint.textContent = 'Tarayıcınız WebGL2 desteklemiyor; sabit önizleme gösteriliyor.';
    return;
  }

  const hotspotsPromise = loadHotspots(site.scene);
  await idle(600);
  const { PanoramaViewer } = await import('./viewer/PanoramaViewer');
  const viewer: PanoramaViewer = new PanoramaViewer({ canvas, labelRoot, previewImg: preview, quality });
  viewer.camera.jumpTo(site.initialView);
  viewer.camera.autoRotate = site.autoRotate;
  canvas.classList.add('is-ready');
  setTimeout(() => { preview.hidden = true; }, 1200);

  /* ---- UI ---- */
  viewer.camera.onFirstInteraction = () => hint.classList.add('is-hidden');

  viewer.on('hotspot', (h) => {
    viewer.flyTo(h.view ?? { yaw: h.yaw, pitch: h.pitch, fov: 50 });
    viewer.hotspots.setSelected(h.id);
  });

  gyroBtn.hidden = !(quality.isMobile && supports.gyro());
  gyroBtn.addEventListener('click', async () => {
    if (viewer.gyroEnabled) { viewer.disableGyro(); gyroBtn.setAttribute('aria-pressed', 'false'); return; }
    const ok = await viewer.enableGyro();
    gyroBtn.setAttribute('aria-pressed', String(ok));
    if (!ok) gyroBtn.disabled = true;
  });

  fsBtn.hidden = !document.fullscreenEnabled;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen().catch(() => { /* denied */ });
  });

  /* ---- content ---- */
  const hotspots = await hotspotsPromise;
  void viewer.loadScene(site.scene, hotspots);

  if (edit) {
    const { initEditor } = await import('./editor');
    initEditor(viewer, site.scene, hotspots);
  }
  if (debug) {
    Object.assign(window as unknown as Record<string, unknown>, { viewer });
    viewer.debug();
    viewer.on('tier', (t) => console.info(`[viewer] tier ${t.width}px (${t.index}/${t.total}) gpu ~${(viewer.textures.gpuBytes / 1048576).toFixed(0)} MB`));
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => void boot(), { once: true });
else void boot();
