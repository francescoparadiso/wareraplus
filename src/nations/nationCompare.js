/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: confronto fra schieramenti (1 vs 2)
   ------------------------------------------------------------------
   Gemello del tab "Faction 1vs2" di Statistiche alleanze, un livello più
   in basso: lì si confrontano blocchi, qui le singole nazioni, che è la
   domanda pratica prima di una guerra ("noi due contro loro tre, come
   siamo messi?").

   Stessa meccanica di selezione dell'originale: un clic mette la nazione
   nello schieramento A, il secondo la sposta in B, il terzo la toglie.
   Le metriche sommate sono quelle di metrics.js — tasse e malcontento
   restano fuori, sommarli non vorrebbe dire niente (sono percentuali di
   cose diverse); si mostra invece la media.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { METRICS, metricValue } from './metrics.js';
import { versusBarHtml } from './charts.js';
import { escapeHtml, flagImg, fmtCompact } from '../mu/ui.js';

// Percentuali: la somma non ha senso, si fa la media.
const AVERAGED = new Set(['taxes', 'unrest', 'dev', 'coreDev', 'perCit']);
// Fuori dal confronto: "regioni" è già un differenziale col segno, sommarlo
// fra nazioni diverse mescolerebbe guadagni e perdite non confrontabili.
const SKIPPED = new Set(['regions']);

export function renderNationCompare(host, ctx) {
  const { nations, sides } = ctx;   // sides: Map(countryId → 'a' | 'b')

  const listOf = side => nations.filter(n => sides.get(n._id) === side);
  const a = listOf('a');
  const b = listOf('b');

  const agg = (list, m) => {
    if (!list.length) return 0;
    const sum = list.reduce((s, n) => s + metricValue(n, m.key), 0);
    return AVERAGED.has(m.key) ? sum / list.length : sum;
  };

  const rows = METRICS.filter(m => !SKIPPED.has(m.key))
    .map(m => versusBarHtml({ label: natT(m.label), a: agg(a, m), b: agg(b, m), fmt: m.fmt }))
    .join('');

  const chip = n => `
    <button type="button" class="wp-nat-chip wp-nat-chip-${sides.get(n._id)}" data-country="${escapeHtml(n._id)}">
      ${flagImg(n._id)}<span>${escapeHtml(n.name)}</span><span class="wp-nat-chip-x">✕</span>
    </button>`;

  host.innerHTML = `
    <p class="wp-nat-hint">${escapeHtml(natT('pickSide'))}</p>

    <div class="wp-nat-sides">
      <div class="wp-nat-side wp-nat-side-a">
        <h4>${escapeHtml(natT('sideA'))} <span>${a.length}</span></h4>
        <div class="wp-nat-chips">${a.map(chip).join('') || `<span class="wp-nat-empty-inline">${escapeHtml(natT('noSelection'))}</span>`}</div>
      </div>
      <div class="wp-nat-side wp-nat-side-b">
        <h4>${escapeHtml(natT('sideB'))} <span>${b.length}</span></h4>
        <div class="wp-nat-chips">${b.map(chip).join('') || `<span class="wp-nat-empty-inline">${escapeHtml(natT('noSelection'))}</span>`}</div>
      </div>
      <button type="button" class="wp-nat-reset" id="wp-nat-reset">${escapeHtml(natT('reset'))}</button>
    </div>

    ${(a.length || b.length) ? `<ul class="wp-nat-vs">${rows}</ul>` : ''}

    <div class="wp-nat-picker">
      <input type="search" id="wp-nat-pick-search" class="wp-nat-search" placeholder="${escapeHtml(natT('search'))}" value="${escapeHtml(ctx.search || '')}">
      <div class="wp-nat-picker-grid">
        ${nations
          .filter(n => !ctx.search || n.name?.toLowerCase().includes(ctx.search.toLowerCase()))
          .slice()
          .sort((x, y) => metricValue(y, 'weekly') - metricValue(x, 'weekly'))
          .map(n => `
            <button type="button" class="wp-nat-pick${sides.has(n._id) ? ` wp-nat-pick-${sides.get(n._id)}` : ''}" data-country="${escapeHtml(n._id)}">
              ${flagImg(n._id)}<span class="wp-nat-pick-name">${escapeHtml(n.name)}</span>
              <span class="wp-nat-pick-val">${escapeHtml(fmtCompact(metricValue(n, 'weekly')))}</span>
            </button>`).join('')}
      </div>
    </div>`;

  host.querySelectorAll('.wp-nat-pick, .wp-nat-chip').forEach(el => {
    el.addEventListener('click', () => ctx.onCycle(el.dataset.country));
  });
  host.querySelector('#wp-nat-reset')?.addEventListener('click', () => ctx.onResetSides());

  const searchEl = host.querySelector('#wp-nat-pick-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => ctx.onSearch(e.target.value));
    if (ctx.searchFocused) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  }
}
