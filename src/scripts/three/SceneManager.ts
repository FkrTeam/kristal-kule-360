/**
 * Scene graph bookkeeping. Keeps the graph flat (sphere, hotspots, optional model
 * group) and knows how to *fully* release a subtree: geometries, materials, textures.
 */
import { Scene, Group, Mesh, type Object3D, type Material, type Texture } from 'three';

type Disposable = { dispose(): void };

export class SceneManager {
  readonly scene = new Scene();
  private layers = new Map<string, Object3D>();

  add(name: string, obj: Object3D, renderOrder = 0): void {
    this.remove(name);
    obj.name = name;
    obj.renderOrder = renderOrder;
    this.layers.set(name, obj);
    this.scene.add(obj);
  }

  get<T extends Object3D = Object3D>(name: string): T | undefined { return this.layers.get(name) as T | undefined; }

  /** Remove *and* dispose a layer - used when a section's content is no longer needed. */
  remove(name: string): void {
    const obj = this.layers.get(name);
    if (!obj) return;
    this.scene.remove(obj);
    this.layers.delete(name);
    SceneManager.disposeObject(obj);
  }

  group(name: string): Group {
    const g = this.get<Group>(name) ?? new Group();
    if (!this.layers.has(name)) this.add(name, g);
    return g;
  }

  /** Walk a subtree and free every GPU resource it references. */
  static disposeObject(root: Object3D, disposeTextures = true): void {
    root.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose?.();
      const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const m of mats) {
        if (disposeTextures) {
          for (const v of Object.values(m as unknown as Record<string, unknown>)) {
            if ((v as Texture)?.isTexture) (v as Texture).dispose();
          }
          const uniforms = (m as unknown as { uniforms?: Record<string, { value: unknown }> }).uniforms;
          if (uniforms) for (const u of Object.values(uniforms)) if ((u.value as Texture)?.isTexture) (u.value as Texture).dispose();
        }
        (m as Material & Disposable).dispose();
      }
    });
    root.clear();
  }

  dispose(): void {
    for (const name of [...this.layers.keys()]) this.remove(name);
  }
}
