/**
 * Marker editor (`?edit`). Click anywhere on the panorama, fill in name / icon /
 * description in the panel form, and copy/download the resulting hotspots.json.
 * Work in progress is kept in localStorage so a reload does not lose it.
 */
import type { PanoramaViewer, HotspotDef } from './viewer/PanoramaViewer';
import { $ } from './utils/dom';
import { ICONS, DEFAULT_ICON, iconSvg, iconColor } from './icons';
import { withBase } from './utils/base';

const slug = (s: string) =>
  s.toLowerCase().replace(/ı/g, 'i').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'isaret';

export function initEditor(viewer: PanoramaViewer, scene: string, initial: HotspotDef[]): void {
  let fromFile = initial;
  const key = `kk360:hotspots:${scene}`;
  const panel = $('#editor');
  const list = $('#editor-list');
  const json = $<HTMLTextAreaElement>('#editor-json');
  const status = $('#editor-status');
  const form = $<HTMLFormElement>('#editor-form');
  const nameInput = $<HTMLInputElement>('#editor-name');
  const textInput = $<HTMLTextAreaElement>('#editor-text');
  const iconGrid = $('#editor-icons');
  const formPos = $('#editor-form-pos');
  const canvas = viewer.renderer.canvas;

  let defs: HotspotDef[] = fromFile;
  try {
    const saved = localStorage.getItem(key);
    if (saved) defs = JSON.parse(saved) as HotspotDef[];
  } catch { /* ignore */ }

  let pending: { yaw: number; pitch: number } | null = null;
  let icon = DEFAULT_ICON;
  let saved: HotspotDef[] = fromFile; // last state known to be on disk
  let dirty = false;

  const setStatus = (msg: string, tone: '' | 'ok' | 'err' = '') => { status.textContent = msg; status.dataset.tone = tone; };

  panel.hidden = false;
  document.documentElement.classList.add('is-editing');

  const round = (n: number) => Math.round(n * 10) / 10;
  const uniqueId = (base: string) => {
    let id = base, n = 2;
    while (defs.some((d) => d.id === id)) id = `${base}-${n++}`;
    return id;
  };

  /* Icon picker: one radio-like button per icon. */
  iconGrid.replaceChildren(...Object.entries(ICONS).map(([name, def]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'editor-icon';
    b.title = def.label;
    b.dataset.icon = name;
    b.innerHTML = `${iconSvg(name, 16)}<span>${def.label}</span>`;
    b.addEventListener('click', () => selectIcon(name));
    return b;
  }));
  function selectIcon(name: string): void {
    icon = name;
    iconGrid.querySelectorAll<HTMLElement>('.editor-icon').forEach((b) => b.classList.toggle('is-active', b.dataset.icon === name));
  }
  selectIcon(DEFAULT_ICON);

  function apply(): void {
    viewer.setHotspots(defs);
    localStorage.setItem(key, JSON.stringify(defs));
    json.value = JSON.stringify(defs, null, 2);
    list.replaceChildren(...defs.map((d, i) => {
      const row = document.createElement('div');
      row.className = 'editor-row';
      row.innerHTML = `<button type="button" class="editor-go" title="Bu işarete git">${iconSvg(d.icon, 13)}<span></span></button><span class="editor-meta"></span><button type="button" class="editor-del" title="Sil">×</button>`;
      row.querySelector<HTMLElement>('.editor-go span')!.textContent = d.label;
      row.querySelector('.editor-meta')!.textContent = `${round(d.yaw)}° / ${round(d.pitch)}°`;
      row.querySelector('.editor-go')!.addEventListener('click', () => viewer.flyTo({ yaw: d.yaw, pitch: d.pitch, fov: 50 }));
      row.querySelector('.editor-del')!.addEventListener('click', () => { defs.splice(i, 1); apply(); });
      return row;
    }));
    dirty = JSON.stringify(defs) !== JSON.stringify(saved);
    setStatus(`${defs.length} işaret${dirty ? ' · kaydedilmedi' : ''}`);
  }

  /* Save straight to hotspots.json: Vite middleware in dev, PHP endpoint in production. */
  const saveBtn = $<HTMLButtonElement>('#editor-save');
  const keyStore = 'kk360:savekey';
  async function save(): Promise<void> {
    saveBtn.disabled = true;
    setStatus('Kaydediliyor...');
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      let url = withBase(`__kk360/save?scene=${encodeURIComponent(scene)}`);
      let payload: unknown = defs;
      let k = '';
      if (!import.meta.env.DEV) {
        url = withBase(`api/save-hotspots.php?scene=${encodeURIComponent(scene)}`);
        k = sessionStorage.getItem(keyStore) ?? '';
        if (!k) { k = (prompt('Kaydetme şifresi (sunucudaki api/save-hotspots.php içindeki PASSWORD):') ?? '').trim(); if (!k) { setStatus('Kaydetme iptal edildi'); return; } }
        headers['X-KK360-Key'] = k;
        payload = { key: k, hotspots: defs }; // key also in the body: some hosts strip custom headers
      }
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) });
      const body = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || !body.ok) {
        if (r.status === 401) sessionStorage.removeItem(keyStore);
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      if (k) sessionStorage.setItem(keyStore, k);
      saved = JSON.parse(JSON.stringify(defs)) as HotspotDef[];
      fromFile = saved;
      localStorage.removeItem(key);
      dirty = false;
      setStatus(`Kaydedildi (${defs.length} işaret)`, 'ok');
    } catch (e) {
      setStatus(`Kaydedilemedi: ${(e as Error).message}`, 'err');
    } finally {
      saveBtn.disabled = false;
    }
  }
  saveBtn.addEventListener('click', () => void save());
  window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

  function openForm(pos: { yaw: number; pitch: number }): void {
    pending = pos;
    formPos.textContent = `${round(pos.yaw)}° / ${round(pos.pitch)}°`;
    form.hidden = false;
    nameInput.value = '';
    textInput.value = '';
    selectIcon(DEFAULT_ICON);
    nameInput.focus();
  }
  function closeForm(): void { pending = null; form.hidden = true; }

  /* Click on the panorama (not a drag, not on an existing marker) -> open the form. */
  let down = { x: 0, y: 0 };
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    if (viewer.hotspots.pickAt(e.clientX, e.clientY) >= 0) return;
    openForm(viewer.camera.pickView(e.clientX, e.clientY));
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = nameInput.value.trim();
    if (!pending || !label) { nameInput.focus(); return; }
    const def: HotspotDef = { id: uniqueId(slug(label)), yaw: round(pending.yaw), pitch: round(pending.pitch), label, icon, color: iconColor(icon) };
    const text = textInput.value.trim();
    if (text) def.text = text;
    defs.push(def);
    closeForm();
    apply();
  });
  $('#editor-cancel').addEventListener('click', closeForm);

  $('#editor-copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(json.value); setStatus('Panoya kopyalandı', 'ok'); }
    catch { json.select(); setStatus('Ctrl+C ile kopyalayın'); }
  });

  $('#editor-download').addEventListener('click', () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json.value], { type: 'application/json' }));
    a.download = 'hotspots.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('#editor-reset').addEventListener('click', () => {
    if (!confirm('Değişiklikler silinip dosyadaki işaretlere dönülsün mü?')) return;
    defs = [...fromFile];
    localStorage.removeItem(key);
    closeForm();
    apply();
  });

  $('#editor-clear').addEventListener('click', () => {
    if (!confirm('Tüm işaretler silinsin mi?')) return;
    defs = [];
    closeForm();
    apply();
  });

  apply();
}
