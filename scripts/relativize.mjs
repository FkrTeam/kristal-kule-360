/**
 * Post-build: make dist/index.html folder-independent.
 *
 * Astro emits its own <script src="/_app/..."> as root-absolute. We turn every
 * root-absolute reference in the HTML into a relative one so the same build works
 * at kristalkule.com/, /360/, /360-test/ or anywhere else without rebuilding.
 * (Chunk-to-chunk imports inside /_app are already relative.)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const file = resolve('dist/index.html');
let html = readFileSync(file, 'utf8');
const before = html;

html = html
  .replace(/(src|href)="\/(?!\/)/g, '$1="')   // src="/_app/x.js" -> src="_app/x.js"
  .replace(/url\((["']?)\/(?!\/)/g, 'url($1'); // url("/fonts/x") -> url("fonts/x")

if (html !== before) writeFileSync(file, html);
const left = html.match(/(src|href)="\/(?!\/)[^"]*"/g);
console.log(`[relativize] index.html ${html === before ? 'already relative' : 'rewritten'}${left ? `; remaining root-absolute: ${left.join(', ')}` : ''}`);
