// Small, dependency-free helpers shared by every page.

/** Absolute URL of the site root (works on GitHub Pages sub-paths like /rinova-learn/). */
export const SITE_ROOT = new URL('../../', import.meta.url);
export const url = (path) => new URL(path, SITE_ROOT).href;

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape user-supplied text before putting it in HTML. */
export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template: html`<p>${userText}</p>` escapes every interpolation. Wrap trusted HTML with raw(). */
export class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const html = (strings, ...vals) =>
  strings.reduce((out, s, i) => {
    const v = vals[i - 1];
    const piece = v instanceof Raw ? v.s : Array.isArray(v) ? v.map((x) => (x instanceof Raw ? x.s : escapeHtml(x))).join('') : escapeHtml(v);
    return out + piece + s;
  });

export const qs = (sel, root = document) => root.querySelector(sel);
export const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];
export const param = (name) => new URLSearchParams(location.search).get(name);

export function debounce(fn, ms = 250) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const dateFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : '');
export const formatDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '');

export function timeAgo(d) {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [u, sec] of units) if (Math.abs(s) >= sec) return rtf.format(-Math.round(s / sec), u);
  return 'just now';
}

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?';

export const formatBytes = (n) => {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
};
