/**
 * Prints raw / gzip / brotli sizes for every JS + CSS chunk in dist/_app and the
 * HTML, grouped by loading stage, so bundle regressions are visible in CI logs.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';

const dist = resolve('dist');
const app = resolve(dist, '_app');
const stage = (name) => {
  if (/index\.astro|main/.test(name)) return 'stage 0-1  entry';
  if (/gsap|lenis|scroll|AnimationManager/.test(name)) return 'stage 2    motion';
  if (/^three\.|PanoramaViewer|math/.test(name)) return 'stage 3    engine';
  if (/ktx2|gltf|draco|basis/.test(name)) return 'stage 4    loaders (on demand)';
  return 'other';
};

const rows = [];
for (const f of readdirSync(app)) {
  if (!/\.(js|css)$/.test(f)) continue;
  const buf = readFileSync(resolve(app, f));
  rows.push({ stage: stage(f), file: f, raw: buf.length, gzip: gzipSync(buf).length, br: brotliCompressSync(buf).length });
}
const html = readFileSync(resolve(dist, 'index.html'));
rows.push({ stage: 'stage 0-1  entry', file: 'index.html', raw: html.length, gzip: gzipSync(html).length, br: brotliCompressSync(html).length });

rows.sort((a, b) => a.stage.localeCompare(b.stage) || b.raw - a.raw);
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + ' KB';
let last = '';
for (const r of rows) {
  if (r.stage !== last) { console.log(`\n${r.stage}`); last = r.stage; }
  console.log(`  ${r.file.padEnd(48)} raw ${kb(r.raw)}  gzip ${kb(r.gzip)}  br ${kb(r.br)}`);
}
const total = (k) => rows.reduce((s, r) => s + r[k], 0);
console.log(`\nTOTAL (all chunks, worst case)  raw ${kb(total('raw'))}  gzip ${kb(total('gzip'))}  br ${kb(total('br'))}`);
const initial = rows.filter((r) => r.stage.startsWith('stage 0'));
console.log(`INITIAL (HTML + entry)          raw ${kb(initial.reduce((s, r) => s + r.raw, 0))}  br ${kb(initial.reduce((s, r) => s + r.br, 0))}`);
console.log(`Panorama tiers: ${readdirSync(resolve(dist, 'assets/pano/kristal-kule')).filter((f) => /webp|ktx2|avif/.test(f)).map((f) => `${f} ${(statSync(resolve(dist, 'assets/pano/kristal-kule', f)).size / 1024).toFixed(0)} KB`).join(', ')}`);
