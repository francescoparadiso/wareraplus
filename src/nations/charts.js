/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: grafici
   ------------------------------------------------------------------
   SVG scritto a mano, nessuna libreria: sono ciambelle e barre, e questa
   vista non deve trascinarsi dietro Chart.js (che nel bundle esiste solo
   per Political). Stessa scelta già fatta per la fascia a ciambelle di
   Statistiche alleanze — vedi src/diplomacy/blocStats.js: donutCardHtml.

   Le due funzioni sono generiche (etichette, valori, colori): chi le usa
   decide cosa rappresentano.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, fmtCompact } from '../mu/ui.js';

export const CHART_COLORS = [
  '#58a6ff', '#3fb950', '#f0883e', '#a371f7', '#e5484d', '#39d0d8', '#e3b341', '#f778ba',
];
const OTHER_COLOR = '#6e7681';

/**
 * Ciambella con legenda. `slices` = [{ label, value, color? }].
 * Oltre `top` fette il resto confluisce in "altre".
 */
export function donutHtml({ title, slices, top = 6, otherLabel = 'others', totalFmt = fmtCompact }) {
  const sorted = slices.filter(s => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, top);
  const rest = sorted.slice(top);
  const restSum = rest.reduce((s, x) => s + x.value, 0);
  const parts = restSum > 0
    ? [...head, { label: otherLabel, value: restSum, color: OTHER_COLOR }]
    : head;

  const total = parts.reduce((s, x) => s + x.value, 0);
  if (!total) return '';

  const R = 52, SW = 16, C = 60;
  const circ = 2 * Math.PI * R;
  let offset = 0;
  const arcs = parts.map((p, i) => {
    const frac = p.value / total;
    const seg = `${(frac * circ).toFixed(2)} ${(circ - frac * circ).toFixed(2)}`;
    const dashOffset = (-offset * circ).toFixed(2);
    offset += frac;
    return `<circle cx="${C}" cy="${C}" r="${R}" fill="none"
              stroke="${p.color || CHART_COLORS[i % CHART_COLORS.length]}" stroke-width="${SW}"
              stroke-dasharray="${seg}" stroke-dashoffset="${dashOffset}"
              transform="rotate(-90 ${C} ${C})"><title>${escapeHtml(p.label)}: ${escapeHtml(totalFmt(p.value))}</title></circle>`;
  }).join('');

  const legend = parts.map((p, i) => `
    <li>
      <span class="wp-nat-dot" style="background:${p.color || CHART_COLORS[i % CHART_COLORS.length]}"></span>
      <span class="wp-nat-legend-name">${escapeHtml(p.label)}</span>
      <span class="wp-nat-legend-val">${escapeHtml(String(Math.round((p.value / total) * 100)))}%</span>
    </li>`).join('');

  return `
    <div class="wp-nat-chart">
      <h4 class="wp-nat-chart-title">${escapeHtml(title)}</h4>
      <div class="wp-nat-chart-body">
        <svg viewBox="0 0 120 120" class="wp-nat-donut" role="img" aria-label="${escapeHtml(title)}">
          ${arcs}
          <text x="60" y="58" class="wp-nat-donut-total">${escapeHtml(totalFmt(total))}</text>
        </svg>
        <ul class="wp-nat-legend">${legend}</ul>
      </div>
    </div>`;
}

/** Barre orizzontali: una riga per voce, larghezza proporzionale al massimo. */
export function barsHtml({ title, rows, fmt = fmtCompact, color = CHART_COLORS[0] }) {
  const max = Math.max(...rows.map(r => r.value), 0);
  if (!max) return '';
  const body = rows.map(r => `
    <li class="wp-nat-bar-row">
      <span class="wp-nat-bar-label">${r.icon || ''}${escapeHtml(r.label)}</span>
      <span class="wp-nat-bar-track"><span class="wp-nat-bar-fill" style="width:${((r.value / max) * 100).toFixed(1)}%;background:${r.color || color}"></span></span>
      <span class="wp-nat-bar-val">${escapeHtml(fmt(r.value))}</span>
    </li>`).join('');

  return `
    <div class="wp-nat-chart">
      <h4 class="wp-nat-chart-title">${escapeHtml(title)}</h4>
      <ul class="wp-nat-bars">${body}</ul>
    </div>`;
}

/** Barra a due estremi per il confronto 1vs2: quota di A contro quota di B. */
export function versusBarHtml({ label, a, b, fmt = fmtCompact }) {
  const total = a + b;
  const pctA = total > 0 ? (a / total) * 100 : 50;
  return `
    <li class="wp-nat-vs-row">
      <span class="wp-nat-vs-label">${escapeHtml(label)}</span>
      <span class="wp-nat-vs-a">${escapeHtml(fmt(a))}</span>
      <span class="wp-nat-vs-track">
        <span class="wp-nat-vs-fill-a" style="width:${pctA.toFixed(1)}%"></span>
        <span class="wp-nat-vs-fill-b" style="width:${(100 - pctA).toFixed(1)}%"></span>
      </span>
      <span class="wp-nat-vs-b">${escapeHtml(fmt(b))}</span>
    </li>`;
}
