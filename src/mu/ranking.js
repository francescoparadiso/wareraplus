/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: classifiche
   ------------------------------------------------------------------
   ZERO chiamate di rete. Il progetto iniziale prevedeva
   `ranking.getRanking` con i sei tipi mu*, ma la verifica dal vivo ha
   mostrato che ogni unità porta già con sé la propria posizione in tutte
   e sei le classifiche (`rankings: { muWeeklyDamages: {value, rank,
   tier}, ... }`) dentro `mu.getManyPaginated` — cioè dentro la directory
   che questa vista ha comunque già in memoria.

   Ordinare per `rank` qui dà quindi la stessa classifica di
   ranking.getRanking, ma senza una richiesta in più e senza un secondo
   modo di essere disallineati (la classifica e le card mostrerebbero
   numeri presi da due fetch diverse).
   ══════════════════════════════════════════════════════════════ */

import { MU_RANKING_TYPES } from './api.js';
import { muT } from './i18n.js';
import { avatarImg, countryName, escapeHtml, flagImg, fmtFull, tierLabel } from './ui.js';

const TOP_N = 100;

let activeType = 'muWeeklyDamages';
let hostEl = null;
let ctx = null;

export function renderMuRankings(host, context) {
  hostEl = host;
  ctx = context;

  host.innerHTML = `
    <div class="wp-mu-rank-tabs">
      ${MU_RANKING_TYPES.map(t => `
        <button type="button" class="wp-mu-rank-tab${t === activeType ? ' active' : ''}" data-type="${t}">
          ${escapeHtml(muT(t))}
        </button>`).join('')}
    </div>
    <div id="wp-mu-rank-body"></div>`;

  host.querySelectorAll('.wp-mu-rank-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      activeType = btn.dataset.type;
      host.querySelectorAll('.wp-mu-rank-tab').forEach(b => b.classList.toggle('active', b === btn));
      paint();
    });
  });

  paint();
}

function paint() {
  const body = hostEl?.querySelector('#wp-mu-rank-body');
  if (!body) return;

  const rows = ctx.directory
    .filter(m => m.rankings?.[activeType])
    .sort((a, b) => a.rankings[activeType].rank - b.rankings[activeType].rank)
    .slice(0, TOP_N);

  if (!rows.length) {
    body.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('noResults'))}</div>`;
    return;
  }

  body.innerHTML = `<ol class="wp-mu-rank-list">${rows.map(m => {
    const r = m.rankings[activeType];
    return `
      <li class="wp-mu-rank-row" data-mu-id="${escapeHtml(m._id)}">
        <span class="wp-mu-rank-pos">${r.rank}</span>
        ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-sm')}
        <span class="wp-mu-rank-name">${escapeHtml(m.name)}</span>
        <span class="wp-mu-rank-country">${flagImg(m.country)}<span>${escapeHtml(countryName(m.country))}</span></span>
        <span class="wp-mu-rank-value">${escapeHtml(fmtFull(r.value))}</span>
        ${tierLabel(r)}
      </li>`;
  }).join('')}</ol>`;

  body.querySelectorAll('.wp-mu-rank-row').forEach(row => {
    row.addEventListener('click', () => ctx.onOpenMu(row.dataset.muId));
  });
}
