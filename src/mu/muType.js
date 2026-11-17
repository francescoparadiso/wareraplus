/* ══════════════════════════════════════════════════════════════
   WarEra+ — Unità militari: tipo e lega settimanale (v0.28.3)
   ------------------------------------------------------------------
   Dal 16 novembre 2026 ogni unità ha un tipo: Paramilitare (il default,
   campo `type` assente), Esercito di Stato (`stateArmy`: una nazione la
   sponsorizza con una legge e le paga il petrolio del quartier generale,
   `sponsorCountry`) o Mercenaria privata (`privateMercenary`). E c'è una
   lega settimanale del danno, in 16 divisioni a gironi da 10.

   Qui stanno i due pezzi di disegno che servono a più viste: il
   cartellino del tipo (elenco, scheda, Statistiche nazioni) e il riquadro
   della lega (scheda dell'unità). I dati arrivano da src/mu/api.js.

   ⚠️ Le divisioni: `division` va da 0 a 15 e la 15 è la PIÙ ALTA —
   misurato il 2026-11-17 con muLeague.getDivisionCounts (124 unità nella
   0, 10 nella 15) e con la prima del danno settimanale, che sta nella 15
   o poco sotto. Si mostra quindi "Divisione {division+1} di 16".
   ══════════════════════════════════════════════════════════════ */

import { muT } from './i18n.js';
import { muType } from './api.js';
import { countryName, escapeHtml, flagImg, fmtCompact, fmtFull } from './ui.js';

export const TYPE_LABEL = {
  paramilitary: 'typeParamilitary',
  stateArmy: 'typeStateArmy',
  privateMercenary: 'typePrivateMerc',
};

/** Cartellino del tipo. Le paramilitari (il default, 19 unità su 20) non
 *  ne hanno uno nell'elenco: segnare la norma sarebbe solo rumore. Nella
 *  scheda invece (`always`) il tipo si dice sempre. */
export function muTypeBadge(m, { short = false, always = false } = {}) {
  const type = muType(m);
  if (type === 'paramilitary' && !always) return '';
  const label = muT(TYPE_LABEL[type]);
  const sponsor = type === 'stateArmy' && m.sponsorCountry
    ? `${flagImg(m.sponsorCountry)}${short ? '' : `<span>${escapeHtml(muT('sponsoredBy', { c: countryName(m.sponsorCountry) }))}</span>`}`
    : '';
  const title = type === 'stateArmy' && m.sponsorCountry
    ? `${label} · ${muT('sponsoredBy', { c: countryName(m.sponsorCountry) })}`
    : label;
  return `<span class="wp-mu-type wp-mu-type-${type}" title="${escapeHtml(title)}">
    <span class="wp-mu-type-label">${escapeHtml(short ? muT(TYPE_LABEL[type] + 'Short') : label)}</span>${sponsor}
  </span>`;
}

const MOVE_ICON = { up: '▲', down: '▼', stay: '•' };

function prizeText(pot) {
  if (!pot) return '—';
  const parts = [];
  if (pot.money) parts.push(fmtFull(pot.money));
  if (pot.case1) parts.push(`${pot.case1}× ${muT('leagueCase1')}`);
  if (pot.case2) parts.push(`${pot.case2}× ${muT('leagueCase2')}`);
  if (pot.hasBadge) parts.push(muT('leagueBadge'));
  return parts.join(' · ') || '—';
}

/** Il riquadro della lega: girone intero dell'unità, con lei evidenziata.
 *  `nameOf(muId)` → { name, avatarUrl } dalla directory già in memoria. */
export function muLeagueHtml(data, muId, nameOf) {
  if (!data?.league || !data.rows?.length) {
    return `<h3 class="wp-mu-section-title" data-sec="mu-league">🏆 ${escapeHtml(muT('leagueTitle'))}</h3>
      <p class="wp-mu-note">${escapeHtml(muT('leagueNone'))}</p>`;
  }
  const me = data.me || data.rows.find(r => r.mu === muId) || null;
  const div = me?.division ?? data.rows[0]?.division;
  const ends = data.weekEndsAt ? new Date(data.weekEndsAt) : null;
  const endsTxt = ends ? ends.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const head = [
    div != null ? muT('leagueDivision', { d: div + 1 }) : null,
    me ? muT('leaguePlace', { r: me.rank, n: data.rows.length }) : null,
    me?.move ? muT('leagueMove_' + me.move) : null,
    endsTxt ? muT('leagueEnds', { t: endsTxt }) : null,
  ].filter(Boolean);

  return `
    <h3 class="wp-mu-section-title" data-sec="mu-league">🏆 ${escapeHtml(muT('leagueTitle'))}</h3>
    <p class="wp-mu-league-head">${head.map(h => `<span>${escapeHtml(h)}</span>`).join('')}</p>
    <div class="wp-mu-tablewrap"><table class="wp-mu-league">
      <thead><tr>
        <th class="wp-mu-num">#</th><th>${escapeHtml(muT('leagueUnit'))}</th>
        <th class="wp-mu-num">${escapeHtml(muT('leaguePoints'))}</th>
        <th class="wp-mu-num">${escapeHtml(muT('leagueSeats'))}</th>
        <th>${escapeHtml(muT('leaguePrize'))}</th><th></th>
      </tr></thead>
      <tbody>${data.rows.map(r => {
        const n = nameOf(r.mu);
        return `<tr class="${r.mu === muId ? 'wp-mu-league-me' : ''}${r.isEligible === false ? ' wp-mu-league-out' : ''}" data-mu-id="${escapeHtml(r.mu)}">
          <td class="wp-mu-num">${escapeHtml(r.rank)}</td>
          <td>${escapeHtml(n?.name || '…')}</td>
          <td class="wp-mu-num">${escapeHtml(fmtCompact(r.points))}</td>
          <td class="wp-mu-num">${escapeHtml(r.seats ?? '—')}</td>
          <td>${escapeHtml(prizeText(r.pot))}</td>
          <td class="wp-mu-league-move wp-mu-league-${escapeHtml(r.move || 'stay')}" title="${escapeHtml(muT('leagueMove_' + (r.move || 'stay')))}">${MOVE_ICON[r.move] || ''}</td>
        </tr>`;
      }).join('')}</tbody>
    </table></div>
    <p class="wp-mu-note">${escapeHtml(muT('leagueNote', { p: data.league.promoteCount ?? '—', d: data.league.demoteCount ?? '—' }))}</p>`;
}
