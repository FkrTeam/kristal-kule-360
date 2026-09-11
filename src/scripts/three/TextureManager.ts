/**
 * Texture loading + GPU memory accounting.
 *
 *   fromImage()  wrap the already-decoded preview <img>   -> zero extra network, zero decode
 *   loadWebP()   fetch -> createImageBitmap (off-thread decode) -> Texture
 *   loadKTX2()   Basis Universal, transcoded in a worker to the GPU's native format
 *
 * Every texture is uploaded eagerly via `renderer.initTexture()` *before* it is shown,
 * so the crossfade never stalls on a first-use upload. Bytes are tracked so the perf
 * HUD and the disposal logic know what lives on the GPU.
 */
import {
  Texture, SRGBColorSpace, LinearFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping,
  type WebGLRenderer, type CompressedTexture,
} from 'three';
import type { PanoTier } from '../loading/manifest';
import { withBase } from '../utils/base';

export interface LoadOpts { signal?: AbortSignal; onProgress?: (p: number) => void }

type KTX2LoaderT = import('three/examples/jsm/loaders/KTX2Loader.js').KTX2Loader;

export class TextureManager {
  private bytes = 0;
  private sizes = new WeakMap<Texture, number>();
  private ktx2: Promise<KTX2LoaderT> | null = null;
  private live = new Set<Texture>();
  onBytesChange?: (delta: number) => void;

  constructor(private renderer: WebGLRenderer, private anisotropy: number) {}

  get gpuBytes(): number { return this.bytes; }

  /** True when the GPU can consume at least one Basis target format natively. */
  supportsKTX2(): boolean {
    const gl = this.renderer.getContext();
    return !!(
      gl.getExtension('WEBGL_compressed_texture_astc') ||
      gl.getExtension('EXT_texture_compression_bptc') ||
      gl.getExtension('WEBGL_compressed_texture_s3tc') ||
      gl.getExtension('WEBGL_compressed_texture_etc')
    );
  }

  /* --------------------------------------------------------------- loaders */

  fromImage(img: HTMLImageElement): Texture {
    const tex = new Texture(img);
    this.configure(tex, img.naturalWidth, img.naturalHeight, false);
    return tex;
  }

  async loadWebP(url: string, opts: LoadOpts = {}): Promise<Texture> {
    const blob = await this.fetchBlob(url, opts);
    let source: ImageBitmap | HTMLImageElement;
    if ('createImageBitmap' in window) {
      source = await createImageBitmap(blob, { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    } else {
      source = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i); i.onerror = rej;
        i.src = URL.createObjectURL(blob);
      });
    }
    const tex = new Texture(source);
    this.configure(tex, source.width, source.height, false);
    return tex;
  }

  async loadKTX2(url: string, tier: PanoTier, opts: LoadOpts = {}): Promise<Texture> {
    const loader = await this.getKTX2();
    const blob = await this.fetchBlob(url, opts);
    const buf = await blob.arrayBuffer();
    const tex = await new Promise<CompressedTexture>((res, rej) => loader.parse(buf, res, rej));
    // Compressed formats: ETC1S ~0.5 B/px, UASTC 1 B/px, + mip chain.
    const bpp = tier.ktx2Codec === 'uastc' ? 1 : 0.5;
    this.configure(tex, tier.width, tier.height, true, tier.width * tier.height * bpp * 1.333);
    return tex;
  }

  /** Load the best available format for a tier. */
  loadTier(baseUrl: (file: string) => string, tier: PanoTier, preferKTX2: boolean, opts: LoadOpts = {}): Promise<Texture> {
    if (preferKTX2 && tier.ktx2 && this.supportsKTX2()) return this.loadKTX2(baseUrl(tier.ktx2), tier, opts);
    return this.loadWebP(baseUrl(tier.webp), opts);
  }

  /** Force the GPU upload now (synchronous) so the first visible frame is hitch-free. */
  upload(tex: Texture): void {
    this.renderer.initTexture(tex);
  }

  dispose(tex: Texture | null | undefined): void {
    if (!tex || !this.live.has(tex)) return;
    this.live.delete(tex);
    tex.dispose();
    const img = tex.image as unknown;
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) img.close();
    this.account(-(this.sizes.get(tex) ?? 0));
  }

  disposeAll(): void { for (const t of [...this.live]) this.dispose(t); }

  /* --------------------------------------------------------------- internals */

  private configure(tex: Texture, w: number, h: number, compressed: boolean, bytes?: number): void {
    tex.colorSpace = SRGBColorSpace;
    tex.flipY = false;                 // uniform handling: the sphere shader samples (u, 1-v)
    tex.wrapS = ClampToEdgeWrapping;
    tex.wrapT = ClampToEdgeWrapping;
    tex.magFilter = LinearFilter;
    tex.minFilter = LinearMipmapLinearFilter;
    tex.generateMipmaps = !compressed; // KTX2 ships its mip chain
    tex.anisotropy = this.anisotropy;
    tex.needsUpdate = true;
    const size = bytes ?? w * h * 4 * 1.333;
    this.sizes.set(tex, size);
    this.live.add(tex);
    this.account(size);
  }

  private account(delta: number): void {
    this.bytes = Math.max(0, this.bytes + delta);
    this.onBytesChange?.(delta);
  }

  private async fetchBlob(url: string, { signal, onProgress }: LoadOpts): Promise<Blob> {
    const res = await fetch(url, { signal, priority: 'low' } as RequestInit);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    const total = Number(res.headers.get('content-length')) || 0;
    if (!onProgress || !total || !res.body) return res.blob();
    // Stream so the loader can show real progress for multi-MB tiers.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.byteLength;
      onProgress(got / total);
    }
    return new Blob(chunks as BlobPart[], { type: res.headers.get('content-type') ?? '' });
  }

  private getKTX2(): Promise<KTX2LoaderT> {
    if (!this.ktx2) {
      this.ktx2 = import('three/examples/jsm/loaders/KTX2Loader.js').then(({ KTX2Loader }) => {
        const l = new KTX2Loader();
        l.setTranscoderPath(withBase('decoders/basis/'));
        l.setWorkerLimit(2);
        l.detectSupport(this.renderer);
        return l;
      });
    }
    return this.ktx2;
  }
}
