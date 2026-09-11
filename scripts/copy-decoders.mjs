/**
 * Copies the WASM/JS decoders Three.js needs at runtime into /public so they are
 * served as static files (no bundler magic, CDN-friendly, cacheable).
 *   - basis/   → KTX2 / Basis Universal transcoder (KTX2Loader)
 *   - draco/   → Draco mesh decoder (GLTFLoader + DRACOLoader)
 */
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const libs = resolve(root, 'node_modules/three/examples/jsm/libs');
const targets = [
  ['basis', 'public/decoders/basis'],
  ['draco/gltf', 'public/decoders/draco'],
];

// Self-hosted variable font (one 40 KB woff2, preloaded from the layout; no CSS import chain).
const fontSrc = resolve(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2');
if (existsSync(fontSrc)) {
  mkdirSync(resolve(root, 'public/fonts'), { recursive: true });
  cpSync(fontSrc, resolve(root, 'public/fonts/inter-latin-wght.woff2'));
  console.log('[copy-decoders] inter font -> public/fonts');
}

for (const [from, to] of targets) {
  const src = resolve(libs, from);
  const dst = resolve(root, to);
  if (!existsSync(src)) { console.warn(`[copy-decoders] missing ${src}`); continue; }
  mkdirSync(dst, { recursive: true });
  cpSync(src, dst, { recursive: true, filter: (p) => !p.endsWith('.d.ts') && !/README|LICENSE/.test(p) });
  console.log(`[copy-decoders] ${from} → ${to}`);
}
