/**
 * Device quality tiering.
 *
 * Decided once at boot from cheap heuristics. The PerformanceMonitor can still
 * lower the *dynamic* settings (pixel ratio) at runtime if frame times degrade.
 */
import { supports } from '../utils/supports';

export type Tier = 'low' | 'medium' | 'high';

export interface QualityProfile {
  tier: Tier;
  /** Hard cap on renderer pixel ratio. */
  maxPixelRatio: number;
  /** Floor the adaptive system may descend to. */
  minPixelRatio: number;
  /** Largest panorama tier width we will request. */
  maxPanoWidth: 2048 | 4096 | 8192;
  /** Sphere tessellation - more segments = straighter horizon lines at low FOV. */
  sphereSegments: [number, number];
  anisotropy: number;
  /** Shader extras (grain, vignette) - off on low. */
  effects: boolean;
  isMobile: boolean;
  gpu: string;
}

interface NavigatorExt extends Navigator { deviceMemory?: number }

function gpuString(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
  } catch { return ''; }
}

export function detectQuality(): QualityProfile {
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (supports.touch() && Math.min(screen.width, screen.height) < 900);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as NavigatorExt).deviceMemory ?? (isMobile ? 4 : 8);
  const dpr = window.devicePixelRatio || 1;
  const gpu = gpuString();
  const g = gpu.toLowerCase();

  // Score from a baseline, nudged by signals. Deliberately conservative: over-promising
  // quality on a weak device is the worst outcome for a "premium" feel.
  let score = isMobile ? 1 : 2;
  if (cores >= 8) score += 0.5;
  if (mem >= 8) score += 0.5;
  if (mem <= 2 || cores <= 2) score -= 1;
  if (/intel.*(uhd|hd graphics)|mali-4|mali-t|adreno [1-5]|powervr|swiftshader|llvmpipe/.test(g)) score -= 1;
  if (/apple (m|a1[5-9]|a2)|rtx|radeon rx|adreno [7-9]|mali-g7|mali-g[89]/.test(g)) score += 0.5;
  if (supports.saveData() || supports.slowNetwork()) score -= 0.5;

  const tier: Tier = score >= 2.5 ? 'high' : score >= 1.5 ? 'medium' : 'low';

  const profiles: Record<Tier, Omit<QualityProfile, 'tier' | 'isMobile' | 'gpu'>> = {
    high:   { maxPixelRatio: Math.min(dpr, 2),   minPixelRatio: 1,    maxPanoWidth: 8192, sphereSegments: [96, 64], anisotropy: 8, effects: true },
    medium: { maxPixelRatio: Math.min(dpr, 1.5), minPixelRatio: 0.85, maxPanoWidth: 4096, sphereSegments: [64, 48], anisotropy: 4, effects: true },
    low:    { maxPixelRatio: 1,                  minPixelRatio: 0.7,  maxPanoWidth: 2048, sphereSegments: [48, 32], anisotropy: 2, effects: false },
  };

  const p: QualityProfile = { tier, isMobile, gpu, ...profiles[tier] };
  // Mobile GPUs choke on 8k textures regardless of tier (memory + upload stalls).
  if (isMobile && p.maxPanoWidth > 4096) p.maxPanoWidth = 4096;
  return p;
}
