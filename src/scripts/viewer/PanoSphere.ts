/**
 * The panorama sphere: one mesh, one draw call, one ShaderMaterial that can
 * crossfade between two equirectangular textures (used for tier upgrades *and*
 * scene changes). No lights, no PBR, no post-processing pass - the fragment
 * shader does two texture fetches, a mix, optional vignette/dither, and encodes.
 *
 * The material always has both samplers bound (B = A when idle) so there is a
 * single shader program: no recompiles, no hitch on the first crossfade.
 */
import { Mesh, SphereGeometry, ShaderMaterial, FrontSide, Texture, Vector2 } from 'three';
import { loop } from '../core/loop';

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  precision highp float;
  uniform sampler2D uTexA;
  uniform sampler2D uTexB;
  uniform float uMix;
  uniform float uExposure;
  uniform float uTime;
  uniform vec2 uResolution;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    // All textures are uploaded with flipY=false; equirect row 0 is the zenith.
    vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
    vec3 a = texture2D(uTexA, uv).rgb;
    vec3 b = texture2D(uTexB, uv).rgb;
    vec3 col = mix(a, b, uMix) * uExposure;
    #ifdef EFFECTS
      vec2 sc = gl_FragCoord.xy / uResolution;
      float vig = smoothstep(1.35, 0.35, distance(sc, vec2(0.5)));
      col *= mix(0.82, 1.0, vig);
      col += (hash(gl_FragCoord.xy + uTime) - 0.5) * 0.012; // dither breaks sky banding
    #endif
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class PanoSphere {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;
  private fading: Promise<void> | null = null;
  private stopTask: (() => void) | null = null;
  private time = 0;

  constructor(segments: [number, number], effects: boolean) {
    const geo = new SphereGeometry(10, segments[0], segments[1]);
    geo.scale(-1, 1, 1); // view from the inside without mirroring the image
    const mat = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: {
        uTexA: { value: null },
        uTexB: { value: null },
        uMix: { value: 0 },
        uExposure: { value: 1 },
        uTime: { value: 0 },
        uResolution: { value: new Vector2(1, 1) },
      },
      defines: effects ? { EFFECTS: '' } : {},
      side: FrontSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      lights: false,
    });
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false; // always surrounds the camera - skip the check
    this.mesh.matrixAutoUpdate = false;
  }

  private get u() { return this.mesh.material.uniforms; }

  get current(): Texture | null { return this.u.uTexA!.value as Texture | null; }

  setResolution(w: number, h: number): void { (this.u.uResolution!.value as Vector2).set(w, h); }

  setExposure(v: number): void { this.u.uExposure!.value = v; loop.requestRender(); }

  /** Dither needs a moving `uTime`; ticked only on frames that render anyway. */
  tick(dt: number): void {
    this.time = (this.time + dt) % 1000;
    this.u.uTime!.value = this.time;
  }

  /**
   * Swap in a texture. With `duration > 0` the new texture crossfades over the
   * old one; resolves with the *previous* texture once it is no longer referenced
   * (safe to dispose). Only one fade runs at a time - a new call waits for it.
   */
  async setTexture(tex: Texture, duration = 0.9): Promise<Texture | null> {
    if (this.fading) await this.fading;
    const old = this.current;

    if (!old || duration <= 0) {
      this.u.uTexA!.value = tex;
      this.u.uTexB!.value = tex;
      this.u.uMix!.value = 0;
      loop.requestRender();
      return old;
    }

    this.u.uTexB!.value = tex;
    this.u.uMix!.value = 0;

    this.fading = new Promise<void>((resolve) => {
      let t = 0;
      this.stopTask = loop.add((dt) => {
        t = Math.min(1, t + dt / duration);
        this.u.uMix!.value = t * t * (3 - 2 * t); // smoothstep
        if (t >= 1) {
          this.u.uTexA!.value = tex;
          this.u.uMix!.value = 0;
          this.stopTask?.(); this.stopTask = null;
          resolve();
        }
        return true;
      });
    });
    await this.fading;
    this.fading = null;
    return old;
  }

  dispose(): void {
    this.stopTask?.();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
