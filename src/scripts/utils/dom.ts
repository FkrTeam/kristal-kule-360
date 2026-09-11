export const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

/** Resolve when the browser is idle, or after `timeout` ms - whichever comes first. */
export const idle = (timeout = 1000): Promise<void> =>
  new Promise((res) => {
    const timer = setTimeout(res, timeout + 100);
    if ('requestIdleCallback' in window) requestIdleCallback(() => { clearTimeout(timer); res(); }, { timeout });
  });

/** Decode an <img> already in the DOM; never throws (a failed preview is not fatal). */
export const decodeImage = async (img: HTMLImageElement | null): Promise<void> => {
  if (!img) return;
  try {
    if (!img.complete) await new Promise<void>((r) => { img.onload = () => r(); img.onerror = () => r(); });
    await img.decode();
  } catch { /* ignore */ }
};

export const readParams = (): URLSearchParams => new URLSearchParams(location.search);
