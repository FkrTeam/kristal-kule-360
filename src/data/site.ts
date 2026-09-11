/**
 * Site ayarlari. Isaretler (hotspot) burada degil, calisma zamaninda
 * public/assets/pano/<sahne>/hotspots.json dosyasindan okunur; boylece
 * yeniden derleme yapmadan FTP ile duzenlenebilir. `?edit` modu bu JSON'u uretir.
 *
 * yaw:   derece, 0 = panorama merkezi, pozitif = saga donus  (u = 0.5 + yaw/360)
 * pitch: derece, 0 = ufuk, pozitif = yukari                   (v = 0.5 - pitch/180)
 */
import type { View } from '../scripts/three/CameraController';

export const site = {
  name: 'Kristal Kule',
  title: 'Kristal Kule 360° Panorama',
  description: 'Kristal Kule ve cevresinin havadan cekilmis 360° panoramik goruntusu.',
  locale: 'tr',
  themeColor: '#0b0c0e',
  /** public/assets/pano/<scene>/ klasoru */
  scene: 'kristal-kule',
  initialView: { yaw: 0, pitch: -2, fov: 70 } as View,
  /** Bos birakildiginda saniyede kac derece kendiliginden donsun (0 = kapali) */
  autoRotate: 0,
};
