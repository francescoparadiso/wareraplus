/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: grafici della Storia politica (SVG a mano)
   ------------------------------------------------------------------
   Stessa scelta di src/nations/charts.js e src/market/priceChart.js:
   SVG scritto a mano e niente Chart.js, perché qui i grafici sono
   pochi, fermi, e devono seguire le variabili CSS del tema senza
   doverli ridisegnare a ogni cambio (Chart.js prende i colori una
   volta sola, vedi repaintForTheme in main.js).

   Due forme:
     · lineChartSvg — linee su un asse del tempo. `step: true` tiene il
       valore fino al punto successivo (iscritti: una serie di CAMBI,
       il numero resta quello finché non cambia di nuovo) e `until`
       prolunga l'ultimo valore fino ad adesso.
     · stripSvg — una fascia orizzontale divisa in periodi colorati
       (i presidenti in carica, uno dopo l'altro).
   Un valore mancante è un BUCO, mai uno zero (stessa regola di tutte
   le curve del progetto).
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from './config.js';
import { getLang } from './i18n.js';

const W = 640;

function _date(ts, withYear = false) {
  try {
    return new Date(ts).toLocaleDateString(getLang() || 'en', withYear
      ? { day: 'numeric', month: 'short', year: '2-digit' }
      : { day: 'numeric', month: 'short' });
  } catch (_) { return new Date(ts).toISOString().slice(0, 10); }
}

function _num(n) {
  if (!Number.isFinite(n)) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

/** Un tetto "tondo" sopra il massimo, per le etichette dell'asse. */
function _niceMax(v) {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/**
 * @param {{series: Array<{name:string, color:string, points:Array<[number, number|null]>, dashed?:boolean, dots?:boolean}>,
 *          height?:number, step?:boolean, until?:number, from?:number}} opts
 */
export function lineChartSvg({ series, height = 200, step = false, until = null, from = null }) {
  const pts = series.flatMap(s => s.points.filter(p => p[1] != null));
  if (!pts.length) return '';
  const pad = { l: 40, r: 12, t: 10, b: 24 };
  const x0 = from ?? Math.min(...pts.map(p => p[0]));
  const x1 = Math.max(until ?? 0, ...pts.map(p => p[0]));
  const span = Math.max(1, x1 - x0);
  const yMax = _niceMax(Math.max(...pts.map(p => p[1])));
  const iw = W - pad.l - pad.r, ih = height - pad.t - pad.b;
  const X = t => pad.l + ((t - x0) / span) * iw;
  const Y = v => pad.t + ih - (v / yMax) * ih;

  const grid = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const y = pad.t + ih - f * ih;
    return `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y}" y2="${y}" class="wp-pol-ch-grid"/>
      <text x="${pad.l - 6}" y="${y + 3}" text-anchor="end" class="wp-pol-ch-lab">${_num(yMax * f)}</text>`;
  }).join('');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const t = x0 + f * span;
    return `<text x="${X(t)}" y="${height - 6}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" class="wp-pol-ch-lab">${escapeHtml(_date(t, span > 200 * 864e5))}</text>`;
  }).join('');

  const lines = series.map(s => {
    const p = s.points.slice().sort((a, b) => a[0] - b[0]);
    let d = '';
    let pen = false;
    p.forEach(([t, v], i) => {
      if (v == null) { pen = false; return; }
      if (!pen) { d += `M${X(t).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; }
      else if (step) d += `H${X(t).toFixed(1)}V${Y(v).toFixed(1)}`;
      else d += `L${X(t).toFixed(1)},${Y(v).toFixed(1)}`;
      if (i === p.length - 1 && step && until && until > t) d += `H${X(until).toFixed(1)}`;
    });
    const dots = s.dots ? p.filter(q => q[1] != null).map(([t, v]) =>
      `<circle cx="${X(t).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2.6" style="fill:${s.color}"><title>${escapeHtml(s.name)} · ${escapeHtml(_date(t, true))}: ${v}</title></circle>`).join('') : '';
    return `<path d="${d}" fill="none" style="stroke:${s.color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="5 4"' : ''} stroke-linejoin="round"/>${dots}`;
  }).join('');

  return `<svg class="wp-pol-ch" viewBox="0 0 ${W} ${height}" role="img">${grid}${lines}${ticks}</svg>`;
}

/**
 * Fascia dei periodi: [{from, to, color, label}] — `to` null = fino ad adesso.
 */
export function stripSvg(periods, { height = 26 } = {}) {
  if (!periods.length) return '';
  const now = Date.now();
  const x0 = periods[0].from;
  const x1 = Math.max(now, ...periods.map(p => p.to || now));
  const span = Math.max(1, x1 - x0);
  const X = t => ((t - x0) / span) * W;
  const rects = periods.map(p => {
    const a = X(p.from), b = X(p.to || now);
    return `<rect x="${a.toFixed(1)}" y="0" width="${Math.max(1, b - a - 1).toFixed(1)}" height="${height}" style="fill:${p.color}" rx="2"><title>${escapeHtml(p.label)}</title></rect>`;
  }).join('');
  return `<svg class="wp-pol-strip" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none" role="img">${rects}</svg>
    <div class="wp-pol-strip-axis"><span>${escapeHtml(_date(x0, true))}</span><span>${escapeHtml(_date(x1, true))}</span></div>`;
}

export { _date as fmtDate };
