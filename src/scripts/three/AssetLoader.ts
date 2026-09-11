/**
 * GLB/GLTF loading with Draco + Meshopt decoding, KTX2 textures, caching and
 * disposal. Lazily imports the loader chunk ("three-gltf") on first use, so a
 * page that never shows a model never downloads it.
 *
 * LOD helper: pass variants sorted from most to least detailed; the returned
 * THREE.LOD switches by camera distance, and frustum culling stays enabled.
 */
import { LOD, Group, type Object3D, type WebGLRenderer } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SceneManager } from './SceneManager';
import { withBase } from '../utils/base';

type GLTFLoaderT = import('three/examples/jsm/loaders/GLTFLoader.js').GLTFLoader;

export interface LodVariant { url: string; distance: number }

export class AssetLoader {
  private loader: Promise<GLTFLoaderT> | null = null;
  private cache = new Map<string, Promise<GLTF>>();

  constructor(private renderer: WebGLRenderer) {}

  private getLoader(): Promise<GLTFLoaderT> {
    if (!this.loader) {
      this.loader = Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
        import('three/examples/jsm/loaders/KTX2Loader.js'),
      ]).then(([{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }, { KTX2Loader }]) => {
        const draco = new DRACOLoader().setDecoderPath(withBase('decoders/draco/'));
        const ktx2 = new KTX2Loader().setTranscoderPath(withBase('decoders/basis/')).detectSupport(this.renderer);
        return new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
      });
    }
    return this.loader;
  }

  /** Load (cached). Returns a fresh clone each call so callers can mutate freely. */
  async load(url: string): Promise<Object3D> {
    let p = this.cache.get(url);
    if (!p) {
      p = this.getLoader().then((l) => l.loadAsync(url));
      this.cache.set(url, p);
    }
    const gltf = await p;
    const clone = gltf.scene.clone(true);
    clone.traverse((o) => { o.frustumCulled = true; });
    return clone;
  }

  /** Build a LOD object from `[{url, distance}]`, most detailed first. Variants load in parallel. */
  async loadLOD(variants: LodVariant[]): Promise<LOD> {
    const lod = new LOD();
    const objs = await Promise.all(variants.map((v) => this.load(v.url)));
    objs.forEach((o, i) => lod.addLevel(o, variants[i]!.distance));
    lod.autoUpdate = true;
    return lod;
  }

  /** Warm the cache without instantiating (call during Stage 4 idle time). */
  prefetch(url: string): void { void this.load(url).catch(() => { /* logged by caller when actually used */ }); }

  /** Drop a cached asset and free its GPU resources. */
  dispose(url: string): void {
    const p = this.cache.get(url);
    this.cache.delete(url);
    void p?.then((g) => SceneManager.disposeObject(g.scene));
  }

  disposeAll(): void { for (const url of [...this.cache.keys()]) this.dispose(url); }

  static group(...children: Object3D[]): Group { const g = new Group(); g.add(...children); return g; }
}
