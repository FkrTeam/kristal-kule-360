/**
 * GLB optimisation pipeline (gltf-transform).
 *
 *   source-models/hero.glb  ->  public/assets/models/hero.glb          (Draco + KTX2, LOD0)
 *                               public/assets/models/hero.lod1.glb     (simplified 50%)
 *                               public/assets/models/hero.lod2.glb     (simplified 15%)
 *
 * Draco gives the best compression for static meshes; Meshopt is used for the LOD
 * variants because it decodes faster and streams well. Textures become KTX2 (ETC1S).
 * Run with:  npm run glb          (needs: npx @gltf-transform/cli, toktx on PATH for KTX2)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, resolve } from 'node:path';

const SRC = resolve('source-models');
const OUT = resolve('public/assets/models');
const LODS = [
  { suffix: '', ratio: 1, compress: 'draco' },
  { suffix: '.lod1', ratio: 0.5, compress: 'meshopt' },
  { suffix: '.lod2', ratio: 0.15, compress: 'meshopt' },
];

if (!existsSync(SRC)) { console.log('[glb] no source-models/ directory - nothing to do'); process.exit(0); }
mkdirSync(OUT, { recursive: true });

const run = (cmd) => { console.log('  $', cmd); execSync(cmd, { stdio: 'inherit' }); };
const gt = 'npx --yes @gltf-transform/cli';

for (const file of readdirSync(SRC).filter((f) => /\.(glb|gltf)$/i.test(f))) {
  const name = basename(file, extname(file));
  const src = resolve(SRC, file);
  console.log(`[glb] ${file}`);
  for (const lod of LODS) {
    const out = resolve(OUT, `${name}${lod.suffix}.glb`);
    const steps = [
      `${gt} dedup "${src}" "${out}"`,
      `${gt} prune "${out}" "${out}"`,
      `${gt} weld "${out}" "${out}"`,
      lod.ratio < 1 ? `${gt} simplify "${out}" "${out}" --ratio ${lod.ratio} --error 0.001` : null,
      `${gt} resize "${out}" "${out}" --width 2048 --height 2048`,
      `${gt} etc1s "${out}" "${out}" --quality 200`,          // KTX2 textures (skipped gracefully if toktx is missing)
      lod.compress === 'draco' ? `${gt} draco "${out}" "${out}" --method edgebreaker` : `${gt} meshopt "${out}" "${out}" --level medium`,
    ].filter(Boolean);
    for (const s of steps) {
      try { run(s); } catch (e) { console.warn(`  ! step failed, continuing: ${s.split(' ')[3]}`); }
    }
    console.log(`  -> ${basename(out)} ${(statSync(out).size / 1024).toFixed(0)} KB`);
  }
}
