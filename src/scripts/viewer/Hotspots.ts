/**
 * Hotspot markers: one InstancedMesh (one draw call for all markers), a tiny
 * billboard shader with in-shader anti-aliasing, angular picking, and HTML
 * labels positioned by projecting each marker after every rendered frame.
 */
import {
  InstancedMesh, InstancedBufferAttribute, PlaneGeometry, ShaderMaterial, Matrix4, Vector3, Raycaster, Vector2, Color,
  type Camera, type PerspectiveCamera,
} from 'three';
import { DEG } from '../utils/math';
import { Emitter } from '../utils/events';
import type { View } from '../three/CameraController';
import { iconSvg } from '../icons';

export interface HotspotDef {
  id: string;
  yaw: number;
  pitch: number;
  label: string;
  /** Icon key from icons.ts (hastane, okul, avm, ulasim, park, ...). */
  icon?: string;
  /** Optional description shown in the info panel when selected. */
  text?: string;
  /** Where the camera flies when selected. Defaults to look at the marker. */
  view?: Partial<View>;
}

const RADIUS = 8;
const SIZE = 0.42;

const vert = /* glsl */ `
  attribute float aPhase;
  varying vec2 vUv;
  varying float vPhase;
  varying vec3 vColor;
  void main() {
    vUv = uv; vPhase = aPhase; vColor = instanceColor;
    vec4 origin = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    origin.xy += position.xy * ${SIZE.toFixed(2)};
    gl_Position = projectionMatrix * origin;
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  uniform float uTime;
  varying vec2 vUv;
  varying float vPhase;
  varying vec3 vColor;
  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    float aa = fwidth(d) * 1.2;
    float pulse = 0.5 + 0.5 * sin(uTime * 2.2 + vPhase);
    float ring = smoothstep(0.30 + aa, 0.30, d) - smoothstep(0.22 + aa, 0.22, d);
    float dot  = 1.0 - smoothstep(0.10, 0.10 + aa, d);
    float halo = (1.0 - smoothstep(0.30, 0.95, d)) * 0.35 * pulse * (1.0 - smoothstep(0.85, 1.0, d));
    float a = clamp(ring + dot + halo, 0.0, 1.0);
    if (a < 0.003) discard;
    gl_FragColor = vec4(vColor, a);
  }
`;

type Events = { select: HotspotDef; hover: HotspotDef | null };

export class Hotspots extends Emitter<Events> {
  readonly mesh: InstancedMesh;
  camera: PerspectiveCamera | null = null;
  private defs: HotspotDef[] = [];
  private labels: HTMLElement[] = [];
  private raycaster = new Raycaster();
  private ndc = new Vector2();
  private pos = new Vector3();
  private ray = new Vector3();
  private dir = new Vector3();
  private hovered = -1;
  private visible = false;
  private time = 0;
  private base = new Color('#e3c88f');
  private hot = new Color('#ffffff');
  private disposers: (() => void)[] = [];
  private max: number;

  constructor(private el: HTMLElement, private labelRoot: HTMLElement, max = 64) {
    super();
    this.max = max;
    const geo = new PlaneGeometry(1, 1);
    const phase = new Float32Array(max);
    for (let i = 0; i < max; i++) phase[i] = Math.random() * 6.283;
    geo.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
    const mat = new ShaderMaterial({
      vertexShader: vert, fragmentShader: frag,
      uniforms: { uTime: { value: 0 } },
      transparent: true, depthTest: false, depthWrite: false,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = true;
    this.mesh.visible = false;
    this.bind();
  }

  get items(): readonly HotspotDef[] { return this.defs; }

  set(defs: HotspotDef[]): void {
    this.defs = defs.slice(0, this.max);
    const m = new Matrix4();
    this.defs.forEach((d, i) => {
      this.direction(d.yaw, d.pitch, this.pos).multiplyScalar(RADIUS);
      m.makeTranslation(this.pos.x, this.pos.y, this.pos.z);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, this.base);
    });
    this.mesh.count = this.defs.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();
    this.mesh.visible = this.visible && this.defs.length > 0;
    this.hovered = -1;
    this.renderLabels();
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.mesh.visible = v && this.defs.length > 0;
    this.labelRoot.hidden = !v;
    if (!v) this.setHover(-1);
  }

  /** Advance the halo pulse; called only on frames that render anyway (on-demand loop). */
  tick(dt: number): void {
    this.time = (this.time + dt) % 1000;
    (this.mesh.material as ShaderMaterial).uniforms.uTime!.value = this.time;
  }

  /** After each rendered frame: move the HTML labels to their projected positions. */
  updateLabels(camera: Camera, w: number, h: number): void {
    if (!this.visible) return;
    const m = new Matrix4();
    this.defs.forEach((_, i) => {
      this.mesh.getMatrixAt(i, m);
      this.pos.setFromMatrixPosition(m).project(camera);
      const el = this.labels[i]!;
      const behind = this.pos.z > 1;
      el.hidden = behind;
      if (!behind) el.style.transform = `translate(-50%, 0) translate(${((this.pos.x + 1) / 2) * w}px, ${((1 - this.pos.y) / 2) * h + 18}px)`;
    });
  }

  /** Index of the marker under a client coordinate, or -1. */
  pickAt(clientX: number, clientY: number): number {
    if (!this.camera || !this.visible) return -1;
    const r = this.el.getBoundingClientRect();
    this.ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.camera);
    this.ray.copy(this.raycaster.ray.direction);
    const limit = (this.camera.fov * DEG) * 0.028;
    let best = -1, bestAngle = limit;
    this.defs.forEach((d, i) => {
      const a = this.direction(d.yaw, d.pitch, this.dir).angleTo(this.ray);
      if (a < bestAngle) { bestAngle = a; best = i; }
    });
    return best;
  }

  /* ------------------------------------------------------------ internals */

  private direction(yaw: number, pitch: number, out: Vector3): Vector3 {
    const y = yaw * DEG, p = pitch * DEG;
    // Matches CameraController: yaw 0 = -Z, yaw increases turning right.
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  private renderLabels(): void {
    this.labelRoot.replaceChildren();
    this.labels = this.defs.map((d) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'hotspot-label';
      el.innerHTML = `${iconSvg(d.icon, 13)}<span></span>`;
      el.querySelector('span')!.textContent = d.label;
      el.dataset.id = d.id;
      el.hidden = true;
      el.addEventListener('click', () => this.emit('select', d));
      this.labelRoot.append(el);
      return el;
    });
  }

  private setHover(i: number): void {
    if (i === this.hovered) return;
    if (this.hovered >= 0 && this.hovered < this.defs.length) this.mesh.setColorAt(this.hovered, this.base);
    if (i >= 0) this.mesh.setColorAt(i, this.hot);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.hovered = i;
    this.el.style.cursor = i >= 0 ? 'pointer' : '';
    this.emit('hover', i >= 0 ? this.defs[i]! : null);
  }

  private bind(): void {
    let down = { x: 0, y: 0 };
    const move = (e: PointerEvent) => { if (this.visible && this.camera) this.setHover(this.pickAt(e.clientX, e.clientY)); };
    const pdown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const up = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return; // it was a drag
      const i = this.pickAt(e.clientX, e.clientY);
      if (i >= 0) this.emit('select', this.defs[i]!);
    };
    this.el.addEventListener('pointermove', move, { passive: true });
    this.el.addEventListener('pointerdown', pdown, { passive: true });
    this.el.addEventListener('pointerup', up, { passive: true });
    this.disposers.push(
      () => this.el.removeEventListener('pointermove', move),
      () => this.el.removeEventListener('pointerdown', pdown),
      () => this.el.removeEventListener('pointerup', up),
    );
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.labelRoot.replaceChildren();
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.mesh.dispose();
    this.clear();
  }
}
