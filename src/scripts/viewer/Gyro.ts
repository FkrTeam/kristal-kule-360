/**
 * Device-orientation -> camera quaternion (the classic DeviceOrientationControls
 * math, with screen-orientation compensation and slerp smoothing). Handles the
 * iOS 13+ permission prompt, which must be triggered from a user gesture.
 */
import { Quaternion, Euler, Vector3, MathUtils } from 'three';
import { supports } from '../utils/supports';

const Z = new Vector3(0, 0, 1);
const Q1 = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -PI/2 around X
const euler = new Euler();
const q0 = new Quaternion();

export class Gyro {
  readonly quaternion = new Quaternion();
  private target = new Quaternion();
  private alpha = 0; private beta = 0; private gamma = 0;
  private screen = 0;
  private hasData = false;
  private active = false;
  private alphaOffset = 0;

  static available(): boolean { return supports.gyro(); }

  /** Must be called inside a click/touch handler on iOS. Resolves true when events flow. */
  async enable(): Promise<boolean> {
    if (!Gyro.available()) return false;
    if (supports.gyroNeedsPermission()) {
      try {
        const r = await (DeviceOrientationEvent as unknown as { requestPermission(): Promise<string> }).requestPermission();
        if (r !== 'granted') return false;
      } catch { return false; }
    }
    window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
    window.addEventListener('orientationchange', this.onScreen, { passive: true });
    screen.orientation?.addEventListener('change', this.onScreen);
    this.onScreen();
    this.active = true;
    // Give the sensor 300 ms to produce data; some desktops expose the API but never fire.
    return new Promise((res) => setTimeout(() => res(this.hasData), 300));
  }

  disable(): void {
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('orientationchange', this.onScreen);
    screen.orientation?.removeEventListener('change', this.onScreen);
    this.active = false;
    this.hasData = false;
  }

  get enabled(): boolean { return this.active && this.hasData; }

  /** Re-zero heading so "forward" is wherever the phone points right now. */
  calibrate(): void { this.alphaOffset = -this.alpha; }

  private onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.alpha == null || e.beta == null || e.gamma == null) return;
    this.alpha = e.alpha; this.beta = e.beta; this.gamma = e.gamma;
    if (!this.hasData) { this.hasData = true; this.calibrate(); }
  };

  private onScreen = (): void => {
    const o = screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0;
    this.screen = Number(o) || 0;
  };

  /** Returns true when orientation changed enough to warrant a render. */
  update(dt: number): boolean {
    if (!this.enabled) return false;
    const a = MathUtils.degToRad(this.alpha + this.alphaOffset);
    const b = MathUtils.degToRad(this.beta);
    const g = MathUtils.degToRad(this.gamma);
    const o = MathUtils.degToRad(this.screen);
    euler.set(b, a, -g, 'YXZ');
    this.target.setFromEuler(euler).multiply(Q1).multiply(q0.setFromAxisAngle(Z, -o));
    const before = this.quaternion.angleTo(this.target);
    // Slerp with a frame-rate independent factor - kills sensor jitter without lag.
    this.quaternion.slerp(this.target, 1 - Math.exp(-14 * dt));
    return before > 1e-4;
  }
}
