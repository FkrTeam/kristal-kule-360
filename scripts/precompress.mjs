/**
 * Pre-compress text assets in dist/ as .br and .gz so shared hosts without
 * on-the-fly Brotli can still serve compressed files (see public/.htaccess).
 * Run after `astro build`:  node scripts/precompress.mjs
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const EXT = new Set(['.js', '.css', '.html', '.json', '.svg', '.wasm', '.xml', '.txt']);
let files = 0, before = 0, after = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!EXT.has(extname(name))) continue;
    const buf = readFileSync(p);
    if (buf.length < 1024) continue;
    const br = brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: buf.length } });
    writeFileSync(p + '.br', br);
    writeFileSync(p + '.gz', gzipSync(buf, { level: 9 }));
    files++; before += buf.length; after += br.length;
  }
}
walk('dist');
console.log(`[precompress] ${files} files, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB brotli`);
