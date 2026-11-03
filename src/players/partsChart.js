/* ══════════════════════════════════════════════════════════════
   WarEra+ — Giocatori: grafico delle PARTI della ricchezza
   ------------------------------------------------------------------
   Una linea per parte (aziende, ordini d'acquisto, resto), giorno per
   giorno. Le parti si accendono e si spengono dai riquadri sopra il
   grafico (`data-part`, gestiti da players/main.js): qui si disegna solo
   quello che arriva in `sel`.

   Scala da ZERO, a differenza del totale: le parti si confrontano fra
   loro, e un asse che parte da un minimo scelto farebbe sembrare
   un'azienda da 2.000 più grossa di un resto da 20.000.

   Dove una parte manca in un giorno (`null`: il censimento non c'era) la
   linea si spezza, non scende a zero — "non so" non è "zero".
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';

export const PART_COLORS = {
  companies: '#e6a817',
  orders: '#2f9de4',
  rest: '#9b7be8',
};
export const PART_KEYS = ['companies', 'orders', 'rest'];

const DAY = 86400_000;
const dayMs = (g) => Date.parse(`${g}T12:00:00Z`);

/**
 * @param {Array<{g:string, companies:number|null, orders:number|null, rest:number|null}>} serie
 * @param {Set<string>} sel parti da disegnare
 * @param {{ w:number, h:number, fmt:(v:number)=>string, lingua:string, label:(k:string)=>string }} o
 */
export function partsChartSvg(serie, sel, { w = 880, h = 280, fmt = String, lingua = 'it', label = (k) => k } = {}) {
  const keys = PART_KEYS.filter(k => sel.has(k));
  if (serie.length < 2 || !keys.length) return '';

  const L = 58, R = 14, T = 14, B = 26;
  const x0 = dayMs(serie[0].g), x1 = dayMs(serie[serie.length - 1].g), arco = Math.max(1, x1 - x0);
  let max = 0;
  for (const r of serie) for (const k of keys) if (Number.isFinite(r[k])) max = Math.max(max, r[k]);
  if (max <= 0) max = 1;
  max *= 1.08;
  const x = (g) => L + ((dayMs(g) - x0) / arco) * (w - L - R);
  const y = (v) => T + (1 - v / max) * (h - T - B);

  const guide = [0, 1, 2, 3].map(i => {
    const v = (max * i) / 3;
    const gy = y(v).toFixed(1);
    return `<line class="wp-ecn-grid" x1="${L}" x2="${w - R}" y1="${gy}" y2="${gy}"/>
      <text class="wp-ecn-axis" x="${L - 6}" y="${(Number(gy) + 3).toFixed(1)}" text-anchor="end">${escapeHtml(fmt(v))}</text>`;
  }).join('');

  const linee = keys.map(k => {
    let d = '';
    let prec = null;
    for (const r of serie) {
      if (!Number.isFinite(r[k])) { prec = null; continue; }
      const salto = prec && (dayMs(r.g) - dayMs(prec)) > 2.5 * DAY;
      d += `${(!prec || salto) ? 'M' : 'L'}${x(r.g).toFixed(1)},${y(r[k]).toFixed(1)}`;
      prec = r.g;
    }
    return `<path d="${d}" fill="none" stroke="${PART_COLORS[k]}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');

  const data = (g) => new Intl.DateTimeFormat(lingua, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(dayMs(g)));

  // Una colonna invisibile per giorno col riepilogo nel `title`: tooltip
  // del browser, nessuno stato da tenere.
  const colonne = serie.map((r, i) => {
    const gx = x(r.g);
    const a = i ? (x(serie[i - 1].g) + gx) / 2 : L;
    const b = i < serie.length - 1 ? (gx + x(serie[i + 1].g)) / 2 : w - R;
    const righe = [data(r.g), ...keys.map(k => `${label(k)}: ${Number.isFinite(r[k]) ? fmt(r[k]) : '—'}`)].join('\n');
    return `<rect x="${a.toFixed(1)}" y="${T}" width="${Math.max(1, b - a).toFixed(1)}" height="${h - T - B}" fill="transparent"><title>${escapeHtml(righe)}</title></rect>`;
  }).join('');

  return `<svg class="wp-ecn-mchart" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(keys.map(label).join(', '))}">
      ${guide}
      ${linee}
      <text class="wp-ecn-axis" x="${L}" y="${h - 8}">${escapeHtml(data(serie[0].g))}</text>
      <text class="wp-ecn-axis" x="${w - R}" y="${h - 8}" text-anchor="end">${escapeHtml(data(serie[serie.length - 1].g))}</text>
      ${colonne}
    </svg>`;
}
