/**
 * Hotspots as DOM pins: a coloured map pin (SVG) with a white disc and a white
 * label box above it. The icon only sets the pin colour and the info panel. Each pin is re-positioned by
 * projecting its direction after every rendered frame, so it sticks to the
 * panorama exactly like a 3D marker would, but stays crisp and clickable.
 */
import { Vector3, type Camera, type PerspectiveCamera } from 'three';
import { DEG } from '../utils/math';
import { Emitter } from '../utils/events';
import { iconColor } from '../icons';
import type { View } from '../three/CameraController';

export interface HotspotDef {
  id: string;
  yaw: number;
  pitch: number;
  label: string;
  /** Icon key from icons.ts (hastane, okul, avm, ulasim, park, ...). */
  icon?: string;
  /** Pin colour (CSS). Defaults to the icon's colour. */
  color?: string;
  /** Optional description shown in the info panel when selected. */
  text?: string;
  /** Where the camera flies when selected. Defaults to look at the marker. */
  view?: Partial<View>;
}

const PIN = 'M16 0C7.2 0 0 7.2 0 16c0 11.3 16 26 16 26s16-14.7 16-26C32 7.2 24.8 0 16 0z';

type Events = { select: HotspotDef; hover: HotspotDef | null };

export class Hotspots extends Emitter<Events> {
  camera: PerspectiveCamera | null = null;
  private defs: HotspotDef[] = [];
  private els: HTMLElement[] = [];
  private dirs: Vector3[] = [];
  private pos = new Vector3();
  private ray = new Vector3();
  private visible = false;
  private selected = -1;

  constructor(private el: HTMLElement, private root: HTMLElement) {
    super();
  }

  get items(): readonly HotspotDef[] { return this.defs; }

  set(defs: HotspotDef[]): void {
    this.defs = defs.slice();
    this.dirs = this.defs.map((d) => this.direction(d.yaw, d.pitch, new Vector3()));
    this.selected = -1;
    this.root.replaceChildren();
    this.els = this.defs.map((d, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hotspot';
      b.dataset.id = d.id;
      b.style.setProperty('--pin', d.color || iconColor(d.icon));
      b.hidden = true;
      b.innerHTML =
        `<span class="hotspot-label"></span>` +
        `<svg class="hotspot-pin" viewBox="0 0 32 42" aria-hidden="true">` +
        `<path class="hotspot-pin-body" d="${PIN}"/><circle cx="16" cy="16" r="7" fill="#fff"/></svg>`;
      b.querySelector('.hotspot-label')!.textContent = d.label;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.select(i); });
      b.addEventListener('pointerenter', () => this.emit('hover', d));
      b.addEventListener('pointerleave', () => this.emit('hover', null));
      this.root.append(b);
      return b;
    });
    this.root.hidden = !this.visible;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root.hidden = !v;
  }

  /** Mark one pin as active (after a flight/selection). */
  setSelected(id: string | null): void {
    this.selected = this.defs.findIndex((d) => d.id === id);
    this.els.forEach((el, i) => el.classList.toggle('is-active', i === this.selected));
  }

  /** After each rendered frame: project every pin to screen space. */
  updateLabels(camera: Camera, w: number, h: number): void {
    if (!this.visible) return;
    for (let i = 0; i < this.dirs.length; i++) {
      this.pos.copy(this.dirs[i]!).multiplyScalar(8).project(camera);
      const el = this.els[i]!;
      const behind = this.pos.z > 1 || this.pos.x < -1.3 || this.pos.x > 1.3 || this.pos.y < -1.3 || this.pos.y > 1.3;
      el.hidden = behind;
      if (!behind) el.style.transform = `translate(${(((this.pos.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - this.pos.y) / 2) * h).toFixed(1)}px)`;
    }
  }

  /** Index of the marker whose direction is nearest a client coordinate (editor), or -1. */
  pickAt(clientX: number, clientY: number): number {
    if (!this.camera || !this.visible) return -1;
    const r = this.el.getBoundingClientRect();
    this.ray.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(this.camera).normalize();
    const limit = (this.camera.fov * DEG) * 0.035;
    let best = -1, bestAngle = limit;
    this.dirs.forEach((d, i) => { const a = d.angleTo(this.ray); if (a < bestAngle) { bestAngle = a; best = i; } });
    return best;
  }

  private select(i: number): void {
    const d = this.defs[i];
    if (!d) return;
    this.setSelected(d.id);
    this.emit('select', d);
  }

  private direction(yaw: number, pitch: number, out: Vector3): Vector3 {
    const y = yaw * DEG, p = pitch * DEG;
    // Matches CameraController: yaw 0 = -Z, yaw increases turning right.
    return out.set(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p));
  }

  dispose(): void {
    this.root.replaceChildren();
    this.els = []; this.defs = []; this.dirs = [];
    this.clear();
  }
}
