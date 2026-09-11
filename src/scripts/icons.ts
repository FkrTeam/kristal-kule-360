/**
 * Marker icon set. Keys are what goes into hotspots.json (`"icon": "hastane"`).
 * Inline 24x24 stroke SVGs: no extra requests, tinted by CSS `currentColor`.
 */
export interface IconDef { label: string; path: string; color: string }

const P = (d: string) => d;

export const ICONS: Record<string, IconDef> = {
  genel:   { label: 'Genel',        color: '#8e44ad', path: P('M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z M12 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z') },
  konut:   { label: 'Konut',        color: '#2d6cdf', path: P('M3 11l9-7 9 7 M5 10v10h14V10 M10 20v-6h4v6') },
  hastane: { label: 'Hastane',      color: '#e0443e', path: P('M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16 M2 21h20 M12 7v6 M9 10h6 M9 21v-4h6v4') },
  okul:    { label: 'Okul',         color: '#d98a1b', path: P('M2 9l10-5 10 5-10 5L2 9z M6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5 M22 9v6') },
  avm:     { label: 'AVM',          color: '#f39c12', path: P('M4 8h16l-1 12H5L4 8z M9 8V6a3 3 0 0 1 6 0v2 M9 12v1 M15 12v1') },
  ulasim:  { label: 'Toplu taşıma', color: '#9b30c9', path: P('M5 4h14a1 1 0 0 1 1 1v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1z M4 10h16 M8 14h.01 M16 14h.01 M7 18l-1.5 3 M17 18l1.5 3') },
  park:    { label: 'Park',         color: '#27a35a', path: P('M12 3l5 7h-3l4 5h-5v6h-2v-6H6l4-5H7l5-7z') },
  cami:    { label: 'Cami',         color: '#1f9e8a', path: P('M5 21V12a7 7 0 0 1 14 0v9 M3 21h18 M12 5V3 M12 5c-1.5 1-2.5 2.5-2.5 4h5c0-1.5-1-3-2.5-4z M9 21v-4a3 3 0 0 1 6 0v4') },
  spor:    { label: 'Spor',         color: '#e3562b', path: P('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3.5 9.5L8 12l-1.5 5.5 M20.5 9.5L16 12l1.5 5.5 M8 12l4-3 4 3-1.5 4.5h-5L8 12z M12 3v6') },
  deniz:   { label: 'Deniz',        color: '#1e88c9', path: P('M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0 M12 4v4 M10 8h4') },
  otopark: { label: 'Otopark',      color: '#5c6b7a', path: P('M4 4h16v16H4z M9 17V7h4a3 3 0 0 1 0 6H9') },
};

export const DEFAULT_ICON = 'genel';

export function iconSvg(name: string | undefined, size = 14): string {
  const def = ICONS[name ?? ''] ?? ICONS[DEFAULT_ICON]!;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${def.path}"/></svg>`;
}

export const iconPath = (name: string | undefined): string => (ICONS[name ?? ''] ?? ICONS[DEFAULT_ICON]!).path;
export const iconColor = (name: string | undefined): string => (ICONS[name ?? ''] ?? ICONS[DEFAULT_ICON]!).color;

export function iconLabel(name: string | undefined): string {
  return (ICONS[name ?? ''] ?? ICONS[DEFAULT_ICON]!).label;
}
