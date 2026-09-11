// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { writeFile, rename, access } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Dev-only endpoint: POST /__kk360/save?scene=<id> with a JSON body writes
 * public/assets/pano/<id>/hotspots.json. Lets the `?edit` mode's "Kaydet"
 * button save straight to disk while `astro dev` runs. Never part of the build;
 * production uses public/api/save-hotspots.php instead.
 */
function hotspotSaver() {
  let base = '/';
  return {
    name: 'kk360-save-hotspots',
    apply: 'serve',
    configResolved(config) { base = config.base || '/'; },
    configureServer(server) {
      server.middlewares.use(`${base.replace(/\/$/, '')}/__kk360/save`, async (req, res) => {
        const json = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
        if (req.method !== 'POST') return json(405, { ok: false, error: 'POST bekleniyor' });
        const scene = (new URL(req.url, 'http://x').searchParams.get('scene') || '').replace(/[^a-z0-9_-]/gi, '');
        if (!scene) return json(400, { ok: false, error: 'scene eksik' });
        const dir = resolve('public/assets/pano', scene);
        try { await access(dir); } catch { return json(404, { ok: false, error: `Sahne klasörü yok: ${scene}` }); }
        let raw = '';
        for await (const chunk of req) raw += chunk;
        let data;
        try { data = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'Geçersiz JSON' }); }
        if (!Array.isArray(data)) return json(400, { ok: false, error: 'Dizi bekleniyor' });
        const path = resolve(dir, 'hotspots.json');
        await writeFile(path + '.tmp', JSON.stringify(data, null, 2) + String.fromCharCode(10), 'utf8');
        await rename(path + '.tmp', path);
        console.log(`[kk360] hotspots.json kaydedildi (${data.length} işaret) -> ${path}`);
        json(200, { ok: true, count: data.length });
      });
    },
  };
}

/**
 * Static output only — the result is a plain `dist/` folder that runs on any
 * Linux shared host / object storage bucket. No Node runtime, no adapter.
 */
export default defineConfig({
  output: 'static',
  site: process.env.PUBLIC_SITE_URL || 'https://kristalkule.com',
  compressHTML: true,
  build: {
    // Stage 0: critical CSS is inlined into the HTML; nothing render-blocking.
    inlineStylesheets: 'always',
    assets: '_app',
  },
  prefetch: false,
  vite: {
    plugins: [tailwindcss(), hotspotSaver()],
    // URLs that JS builds for its own chunks are resolved relative to the importing
    // module (import.meta.url), so the build works in any sub-folder.
    experimental: {
      renderBuiltUrl: (_filename, { hostType }) => (hostType === 'js' ? { relative: true } : undefined),
    },
    build: {
      target: 'es2022',
      modulePreload: false,
      cssMinify: 'lightningcss',
      // Keep the heavy engine out of the initial bundle. Each chunk is loaded lazily
      // by the LoadingManager at the stage where it is actually needed.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/three/examples/jsm/loaders/GLTFLoader') ||
                id.includes('node_modules/three/examples/jsm/loaders/DRACOLoader') ||
                id.includes('node_modules/three/examples/jsm/libs/meshopt')) return 'three-gltf';
            if (id.includes('node_modules/three/examples/jsm/loaders/KTX2Loader')) return 'three-ktx2';
            if (id.includes('node_modules/three/')) return 'three';
          },
        },
      },
      chunkSizeWarningLimit: 700, // three core is ~600 KB min / ~150 KB brotli
    },
  },
});
