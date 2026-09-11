/**
 * Camera controller for the panorama.
 *
 * State is a (yaw, pitch, fov) triple in degrees. Pointer drag, wheel/pinch
 * zoom, keyboard, cinematic flights and the gyro all write to `target`;
 * `update()` damps the live camera toward it so every input blends smoothly.
 */
import { PerspectiveCamera, Quaternion, Euler, Vector3 } from 'three';
import { clamp, damp, dampAngle, angleDelta, DEG, RAD } from '../utils/math';

export interface View { yaw: number; pitch: number; fov: number }

const PITCH_LIMIT = 85;
const FOV_MIN = 30, FOV_MAX = 100;
const EPS = 1e-3;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraController {
  readonly camera: PerspectiveCamera;
  readonly target: View = { yaw: 0, pitch: 0, fov: 75 };
  readonly view: View = { yaw: 0, pitch: 0, fov: 75 };
  /** Degrees per second of idle drift (0 disables). */
  autoRotate = 0;
  /** Fires once on the first real user interaction (used to hide the hint). */
  onFirstInteraction?: () => void;
  private interacted = false;
  private velocity = { yaw: 0, pitch: 0 };
  private dragging = false;
  private last = { x: 0, y: 0, t: 0 };
  private idleSince = 0;
  private pinchDist = 0;
  private fly: { from: View; to: View; t: number; duration: number } | null = null;
  private gyroQuat: Quaternion | null = null;
  private gyroYawOffset = 0;
  private tmpEuler = new Euler(0, 0, 0, 'YXZ');
  private tmpQuat = new Quaternion();
  private tmpVec = new Vector3();
  private up = new Vector3(0, 1, 0);
  private lastFov = -1;
  private disposers: (() => void)[] = [];

  constructor(private el: HTMLElement, aspect: number) {
    this.camera = new PerspectiveCamera(75, aspect, 0.1, 100);
    this.camera.rotation.order = 'YXZ';
    this.bind();
  }

  /* ------------------------------------------------------------------ input */

  private bind(): void {
    const el = this.el;
    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn, opts);
      this.disposers.push(() => el.removeEventListener(type, fn));
    };

    on('pointerdown', (e) => {
      if (!e.isPrimary) return;
      el.setPointerCapture(e.pointerId);
      this.dragging = true;
      this.fly = null;
      el.classList.add('is-dragging');
      this.velocity.yaw = this.velocity.pitch = 0;
      this.last = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.touch();
    });

    on('pointermove', (e) => {
      if (!this.dragging || !e.isPrimary) return;
      const now = performance.now();
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      const dt = Math.max(1, now - this.last.t) / 1000;
      const degPerPx = this.view.fov / el.clientHeight; // vertical fov maps to canvas height
      const dYaw = -dx * degPerPx, dPitch = dy * degPerPx;
      if (this.gyroQuat) this.gyroYawOffset += dYaw;
      else {
        this.target.yaw += dYaw;
        this.target.pitch = clamp(this.target.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);
      }
      this.velocity.yaw = this.velocity.yaw * 0.5 + (dYaw / dt) * 0.5;
      this.velocity.pitch = this.velocity.pitch * 0.5 + (dPitch / dt) * 0.5;
      this.last = { x: e.clientX, y: e.clientY, t: now };
      this.touch();
    });

    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      el.classList.remove('is-dragging');
      try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (performance.now() - this.last.t > 80) this.velocity.yaw = this.velocity.pitch = 0;
    };
    on('pointerup', end);
    on('pointercancel', end);

    on('wheel', (e) => {
      e.preventDefault();
      this.touch();
      this.fly = null;
      this.target.fov = clamp(this.target.fov + e.deltaY * 0.04, FOV_MIN, FOV_MAX);
    }, { passive: false });

    on('touchstart', (e) => { if (e.touches.length === 2) this.pinchDist = this.dist(e); }, { passive: true });
    on('touchmove', (e) => {
      if (e.touches.length !== 2) return;
      const d = this.dist(e);
      if (this.pinchDist) this.target.fov = clamp(this.target.fov * (this.pinchDist / d), FOV_MIN, FOV_MAX);
      this.pinchDist = d;
      this.touch();
    }, { passive: true });

    const key = (e: KeyboardEvent) => {
      const step = 8;
      const map: Record<string, () => void> = {
        ArrowLeft: () => { this.target.yaw -= step; },
        ArrowRight: () => { this.target.yaw += step; },
        ArrowUp: () => { this.target.pitch = clamp(this.target.pitch + step, -PITCH_LIMIT, PITCH_LIMIT); },
        ArrowDown: () => { this.target.pitch = clamp(this.target.pitch - step, -PITCH_LIMIT, PITCH_LIMIT); },
        '+': () => { this.target.fov = clamp(this.target.fov - 5, FOV_MIN, FOV_MAX); },
        '-': () => { this.target.fov = clamp(this.target.fov + 5, FOV_MIN, FOV_MAX); },
      };
      const fn = map[e.key];
      if (fn && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) { fn(); this.fly = null; this.touch(); e.preventDefault(); }
    };
    window.addEventListener('keydown', key);
    this.disposers.push(() => window.removeEventListener('keydown', key));
  }

  private dist(e: TouchEvent): number {
    const a = e.touches[0]!, b = e.touches[1]!;
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  }

  private touch(): void {
    this.idleSince = performance.now();
    if (!this.interacted) { this.interacted = true; this.onFirstInteraction?.(); }
  }

  /* ------------------------------------------------------------------ api */

  /** Snap both live view and target (used once, before the first frame). */
  jumpTo(v: Partial<View>): void {
    Object.assign(this.target, v);
    Object.assign(this.view, this.target);
    this.lastFov = -1;
  }

  /** Cinematic flight to a view; interrupted by any user input. */
  flyTo(v: Partial<View>, duration = 1.4): void {
    const to = { ...this.target, ...v };
    // Shortest arc for yaw.
    to.yaw = this.target.yaw + angleDelta(this.target.yaw, to.yaw);
    this.fly = { from: { ...this.target }, to, t: 0, duration };
    this.velocity.yaw = this.velocity.pitch = 0;
  }

  /** Gyro feeds an absolute orientation; drag becomes a yaw offset on top of it. */
  setGyroQuaternion(q: Quaternion | null): void {
    if (q && !this.gyroQuat) this.gyroYawOffset = this.view.yaw;
    this.gyroQuat = q;
  }

  setAspect(aspect: number): void { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  /** Yaw/pitch of the panorama point under a client coordinate (used by the editor). */
  pickView(clientX: number, clientY: number): { yaw: number; pitch: number } {
    const r = this.el.getBoundingClientRect();
    this.tmpVec.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1, 0.5).unproject(this.camera).normalize();
    const d = this.tmpVec;
    return { yaw: Math.atan2(d.x, -d.z) * RAD, pitch: Math.asin(clamp(d.y, -1, 1)) * RAD };
  }

  /** Returns true when the camera moved this frame (drives on-demand rendering). */
  update(dt: number): boolean {
    const t = this.target, v = this.view;

    if (this.fly) {
      const f = this.fly;
      f.t = Math.min(1, f.t + dt / f.duration);
      const k = easeInOut(f.t);
      t.yaw = f.from.yaw + (f.to.yaw - f.from.yaw) * k;
      t.pitch = f.from.pitch + (f.to.pitch - f.from.pitch) * k;
      t.fov = f.from.fov + (f.to.fov - f.from.fov) * k;
      if (f.t >= 1) this.fly = null;
    } else if (!this.dragging && (Math.abs(this.velocity.yaw) > 0.5 || Math.abs(this.velocity.pitch) > 0.5)) {
      t.yaw += this.velocity.yaw * dt;
      t.pitch = clamp(t.pitch + this.velocity.pitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
      const decay = Math.exp(-4.5 * dt);
      this.velocity.yaw *= decay; this.velocity.pitch *= decay;
    }
    if (this.autoRotate && !this.dragging && !this.fly && !this.gyroQuat && performance.now() - this.idleSince > 5000) {
      t.yaw += this.autoRotate * dt;
    }

    const lambda = this.dragging ? 22 : 9;
    const ny = dampAngle(v.yaw, t.yaw, lambda, dt);
    const np = damp(v.pitch, t.pitch, lambda, dt);
    const nf = damp(v.fov, t.fov, 10, dt);
    const moved = Math.abs(ny - v.yaw) > EPS || Math.abs(np - v.pitch) > EPS || Math.abs(nf - v.fov) > EPS || !!this.gyroQuat;
    v.yaw = ny; v.pitch = np; v.fov = nf;

    if (this.gyroQuat) {
      this.tmpQuat.setFromAxisAngle(this.up, -this.gyroYawOffset * DEG);
      this.camera.quaternion.copy(this.tmpQuat).multiply(this.gyroQuat);
    } else {
      this.tmpEuler.set(v.pitch * DEG, -v.yaw * DEG, 0, 'YXZ');
      this.camera.quaternion.setFromEuler(this.tmpEuler);
    }
    if (Math.abs(v.fov - this.lastFov) > 1e-3) {
      this.camera.fov = v.fov;
      this.camera.updateProjectionMatrix();
      this.lastFov = v.fov;
    }
    return moved;
  }

  dispose(): void { for (const d of this.disposers) d(); this.disposers = []; }
}
