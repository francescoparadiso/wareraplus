/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: panoramica
   ------------------------------------------------------------------
   Tutte le nazioni su una riga sola, colonne ordinabili — gemella della
   tabella riassuntiva di Statistiche alleanze, che risponde alla stessa
   domanda un livello più in alto ("chi pesa quanto"). Cliccando una riga
   si apre la scheda della nazione.

   Le colonne sono le METRICS (src/nations/metrics.js), quindi aggiungerne
   una qui significa aggiungerla anche al confronto e alla scheda: un
   posto solo, mai tre definizioni che divergono.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { METRICS, metricValue } from './metrics.js';
import { escapeHtml, flagImg } from '../mu/ui.js';

export function renderNationList(host, ctx) {
  const { nations, sort, search } = ctx;

  const filtered = nations.filter(n =>
    !search || n.name?.toLowerCase().includes(search.toLowerCase()));

  const rows = filtered.slice().sort((a, b) => {
    if (sort.key === 'name') {
      const r = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
      return sort.dir > 0 ? r : -r;
    }
    return (metricValue(b, sort.key) - metricValue(a, sort.key)) * (sort.dir > 0 ? -1 : 1);
  });

  const head = `
    <button type="button" class="wp-nat-th wp-nat-th-name${sort.key === 'name' ? ' active' : ''}" data-sort="name">${escapeHtml(natT('nation'))}</button>
    ${METRICS.map(m => `
      <button type="button" class="wp-nat-th wp-nat-num${sort.key === m.key ? ' active' : ''}" data-sort="${m.key}">${escapeHtml(natT(m.label))}</button>`).join('')}`;

  const body = rows.map(n => `
    <div class="wp-nat-row" role="button" tabindex="0" data-country="${escapeHtml(n._id)}">
      <span class="wp-nat-th-name">${flagImg(n._id)}<span class="wp-nat-name">${escapeHtml(n.name || '—')}</span></span>
      ${METRICS.map(m => `<span class="wp-nat-num ${m.cls || ''}">${escapeHtml(m.fmt(m.get(n)))}</span>`).join('')}
    </div>`).join('');

  host.innerHTML = `
    <div class="wp-nat-toolbar">
      <input type="search" id="wp-nat-search" class="wp-nat-search" placeholder="${escapeHtml(natT('search'))}" value="${escapeHtml(search || '')}">
      <span class="wp-nat-count">${rows.length} ${escapeHtml(natT('nations'))}</span>
    </div>
    ${rows.length ? `
      <div class="wp-nat-table-wrap"><div class="wp-nat-table">
        <div class="wp-nat-thead">${head}</div>
        ${body}
      </div></div>`
      : `<div class="wp-nat-empty">${escapeHtml(natT('empty'))}</div>`}`;

  host.querySelectorAll('.wp-nat-th[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => ctx.onSort(btn.dataset.sort));
  });
  host.querySelectorAll('.wp-nat-row').forEach(row => {
    row.addEventListener('click', () => ctx.onOpen(row.dataset.country));
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.onOpen(row.dataset.country); }
    });
  });

  const searchEl = host.querySelector('#wp-nat-search');
  if (searchEl) {
    searchEl.addEventListener('input', (e) => ctx.onSearch(e.target.value));
    // Ridisegnare l'elenco ad ogni tasto azzera il focus: lo si rimette
    // dov'era, altrimenti non si riesce a scrivere due lettere di fila.
    if (ctx.searchFocused) {
      searchEl.focus();
      searchEl.setSelectionRange(searchEl.value.length, searchEl.value.length);
    }
  }
}
