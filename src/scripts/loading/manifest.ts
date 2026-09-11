/**
 * Asset addressing + panorama manifest types.
 *
 * All heavy assets resolve through `assetUrl()`, so pointing production at a CDN
 * (Cloudflare R2 / S3+CloudFront) is a single env var: PUBLIC_ASSET_BASE.
 * The app bundle itself stays on the static host; only bytes that benefit from
 * edge caching and range requests move.
 */
export interface PanoTier {
  width: number;
  height: number;
  webp: string;
  webpBytes: number;
  ktx2?: string;
  ktx2Bytes?: number;
  ktx2Codec?: 'etc1s' | 'uastc';
}

export interface PanoManifest {
  id: string;
  source: { width: number; height: number };
  /** 64x32 blurred JPEG data URI, inlined into the HTML for a zero-request first paint. */
  lqip: string;
  tiers: PanoTier[];
  generated: number;
}

import { withBase } from '../utils/base';

/** CDN origin when PUBLIC_ASSET_BASE is set; otherwise assets live next to index.html. */
export const ASSET_BASE = (import.meta.env.PUBLIC_ASSET_BASE || '').replace(/\/+$/, '');

export const assetUrl = (path: string): string =>
  ASSET_BASE ? `${ASSET_BASE}/${path.replace(/^\/+/, '')}` : withBase(path);
export const panoUrl = (id: string, file: string): string => assetUrl(`assets/pano/${id}/${file}`);
export const modelUrl = (file: string): string => assetUrl(`assets/models/${file}`);

const manifests = new Map<string, Promise<PanoManifest>>();

export function loadManifest(id: string): Promise<PanoManifest> {
  let p = manifests.get(id);
  if (!p) {
    p = fetch(panoUrl(id, 'manifest.json'), { cache: 'force-cache' }).then((r) => {
      if (!r.ok) throw new Error(`manifest ${id}: ${r.status}`);
      return r.json() as Promise<PanoManifest>;
    });
    manifests.set(id, p);
  }
  return p;
}

/** Pick the ordered list of tiers to stream, ending at the largest one allowed. */
export function planTiers(m: PanoManifest, maxWidth: number, maxTextureSize: number): PanoTier[] {
  const cap = Math.min(maxWidth, maxTextureSize);
  const usable = m.tiers.filter((t) => t.width <= cap).sort((a, b) => a.width - b.width);
  if (usable.length <= 3) return usable;
  // Three stages max: preview, medium, high. Drop intermediates from the middle.
  const first = usable[0]!, last = usable[usable.length - 1]!;
  const mid = usable[Math.floor(usable.length / 2)]!;
  return mid === first || mid === last ? [first, last] : [first, mid, last];
}
