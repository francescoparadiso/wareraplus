/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: confronto fra schieramenti (1 vs 2)
   ------------------------------------------------------------------
   Gemello del tab "Faction 1vs2" di Statistiche alleanze, un livello più
   in basso: lì si confrontano blocchi, qui le singole nazioni, che è la
   domanda pratica prima di una guerra ("noi due contro loro tre, come
   siamo messi?").

   SELEZIONE — DUE ELENCHI, UNO PER SCHIERAMENTO (richiesta esplicita
   dell'utente). Prima c'era un elenco solo con selezione a ciclo (un
   clic = A, due = B, tre = via), ereditata dal Faction 1vs2 delle
   alleanze: chi voleva mettere la seconda nazione in B la vedeva finire
   in A, perché il "due clic" è un'informazione che sta solo nella
   scritta di istruzioni. Ora ogni schieramento ha la SUA casella di
   ricerca e la sua griglia: si aggiunge dove si intende aggiungere, e
   basta. Un clic su una nazione già nel proprio schieramento la toglie;
   su una nazione dell'altro schieramento la SPOSTA (nessuna nazione può
   stare da entrambe le parti, altrimenti il confronto non vorrebbe dire
   niente).

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

  // Un elenco per schieramento. Le nazioni già schierate restano visibili
  // (marcate con la tinta del lato in cui stanno): servono per togliere o
  // spostare senza doverle cercare fra i chip.
  const pickerHtml = (side) => {
    const query = (side === 'a' ? ctx.searchA : ctx.searchB) || '';
    const q = query.toLowerCase();
    const items = nations
      .filter(n => !q || n.name?.toLowerCase().includes(q))
      .slice()
      .sort((x, y) => metricValue(y, 'weekly') - metricValue(x, 'weekly'))
      .map(n => {
        const cur = sides.get(n._id);
        return `
          <button type="button" class="wp-nat-pick${cur ? ` wp-nat-pick-${cur}` : ''}" data-country="${escapeHtml(n._id)}" data-side="${side}">
            ${flagImg(n._id)}<span class="wp-nat-pick-name">${escapeHtml(n.name)}</span>
            <span class="wp-nat-pick-val">${escapeHtml(fmtCompact(metricValue(n, 'weekly')))}</span>
          </button>`;
      }).join('');
    return `
      <div class="wp-nat-picker wp-nat-picker-${side}">
        <h4>${escapeHtml(natT(side === 'a' ? 'sideA' : 'sideB'))}</h4>
        <input type="search" id="wp-nat-pick-search-${side}" class="wp-nat-search" data-side="${side}"
               placeholder="${escapeHtml(natT('search'))}" value="${escapeHtml(query)}">
        <div class="wp-nat-picker-grid">${items}</div>
      </div>`;
  };

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

    <div class="wp-nat-pickers">
      ${pickerHtml('a')}
      ${pickerHtml('b')}
    </div>`;

  // Griglia: il lato è quello dell'elenco su cui si è cliccato.
  host.querySelectorAll('.wp-nat-pick').forEach(el => {
    el.addEventListener('click', () => ctx.onPick(el.dataset.country, el.dataset.side));
  });
  // Chip già schierato: il clic (o la ✕) lo toglie e basta.
  host.querySelectorAll('.wp-nat-chip').forEach(el => {
    el.addEventListener('click', () => ctx.onRemove(el.dataset.country));
  });
  host.querySelector('#wp-nat-reset')?.addEventListener('click', () => ctx.onResetSides());

  ['a', 'b'].forEach(side => {
    const searchEl = host.querySelector(`#wp-nat-pick-search-${side}`);
    if (!searchEl) return;
    searchEl.addEventListener('input', (e) => ctx.onSearch(side, e.target.value));
    // Rifocalizza solo la casella su cui si stava scrivendo: il render
    // ricostruisce l'HTML, e senza questo il cursore uscirebbe dal campo
    // ad ogni lettera (stesso trattamento dell'elenco panoramica).
    if (ctx.searchFocusedSide === side) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  });
}
