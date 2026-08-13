// battleFront/helpers.js
//
// WarEra+ — funzioni PURE usate da battleFront.js: nessuna dipendenza da
// stato di modulo condiviso, solo dai propri parametri.

// Formattazione numeri per l'HUD — stessa idea di fmtNumber in utils.js, ma
// con più cifre decimali sui milioni (i numeri qui sono spesso enormi).
export function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

export function formatRate(deltaPerSec) {
  if (deltaPerSec == null || deltaPerSec <= 0) return '';
  return `+${fmt(deltaPerSec)}/s`;
}

export function fmtDuration(sec) {
  if (sec == null) return '';
  if (sec < 90) return `${Math.round(sec)}s`;
  const m = sec / 60;
  if (m < 90) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 36) return `${h.toFixed(1)}h`;
  return `${(h / 24).toFixed(1)}d`;
}

// Bagliore della card momentum: colore + intensità cambiano col segno e la
// forza dello squilibrio.
export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
