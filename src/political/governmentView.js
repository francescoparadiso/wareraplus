/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: il governo in carica
   ------------------------------------------------------------------
   Modulo NUOVO (2026-11-08). Fino al 7 novembre il governo erano cinque
   persone (presidente, vice, tre ministri fissi) e bastava una fila di
   card uguali. Dall'aggiornamento di quel giorno il presidente nomina fino
   a 20 ministri, con un titolo suo e poteri che decide lui (vedi
   src/shared/government.js): cinque card uguali diventavano una colonna
   di venti che non diceva niente di più del nome.

   Qui il governo si legge per quello che è:
   · presidente e vice in evidenza, col partito e da quando sono in carica
     (il presidente dalla fine dell'elezione che ha vinto, se è fra quelle
     in memoria);
   · una barra della composizione per partito — chi governa davvero;
   · i ministri come card ordinate per portafoglio: titolo del presidente
     (o del gioco), partito, giorni in carica, distintivo (dopo 3 giorni),
     e i POTERI come icone, che sono la differenza vera fra un ministro
     della difesa e un consigliere.

   Zero richieste in più: il partito di ognuno viene da `members` della
   lista partiti che Political carica comunque (loadPartiesForCountry, in
   cache), i nomi da getGovernmentWithDetails.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, getPartyColor, partyNamesMap, electionHistory, APP_BASE } from './config.js';
import { prT, prLocale } from './presI18n.js';
import { governmentRoleLabel } from '../shared/government.js';

const DAY = 86400000;

// Portafoglio → icona. L'ordine è quello di src/shared/government.js.
const ROLE_ICON = {
  president: '👑', vicePresident: '🎖️',
  minOfDefense: '🛡️', minOfForeignAffairs: '🌐', minOfEconomy: '💰', minOfInterior: '🏠',
  minOfCommunication: '📣', chiefOfStaff: '📋', advisor: '💡',
};

// I diritti di gioco, raggruppati: dodici voci sono troppe per una card, e
// "fissare un articolo / un messaggio / pubblicare un annuncio" sono una
// cosa sola per chi legge.
const POWERS = [
  { key: 'r_orders', icon: '🎯', rights: ['setOrders'] },
  { key: 'r_battle', icon: '⚔️', rights: ['openBattle'] },
  { key: 'r_contracts', icon: '📜', rights: ['manageMercenaryContracts', 'manageMercenaryContractProposals'] },
  { key: 'r_upgrade', icon: '🏗️', rights: ['upgradeRegion'] },
  { key: 'r_resistance', icon: '✊', rights: ['manageResistance'] },
  { key: 'r_inventory', icon: '📦', rights: ['manageInventory'] },
  { key: 'r_citizenship', icon: '🛂', rights: ['manageCitizenshipApplications'] },
  { key: 'r_tournament', icon: '🏆', rights: ['registerTournament'] },
  { key: 'r_comms', icon: '📣', rights: ['pinArticle', 'pinMessage', 'postAnnouncement'] },
];

const fmtDay = (ms) => new Date(ms).toLocaleDateString(prLocale(), { day: 'numeric', month: 'short' });

function daysLabel(fromMs) {
  if (!fromMs) return '';
  const d = Math.floor((Date.now() - fromMs) / DAY);
  return d <= 0 ? prT('gv_today') : d === 1 ? prT('gv_day') : prT('gv_days', { n: d });
}

/** Da quando il presidente è in carica: fine dell'ultima presidenziale
 *  conclusa che ha vinto. null se non è fra le elezioni in memoria (per
 *  esempio un vice subentrato). */
function presidentSince(presidentId) {
  const won = (electionHistory || [])
    .filter(e => e.type === 'president' && e.votesEndAt && Date.parse(e.votesEndAt) < Date.now())
    .filter(e => (e.candidates || []).some(c => c.isElected && (c.user || c.userId) === presidentId))
    .sort((a, b) => Date.parse(b.votesEndAt) - Date.parse(a.votesEndAt))[0];
  return won ? Date.parse(won.votesEndAt) : null;
}

function avatar(user, cls) {
  if (user?.avatarUrl) return `<img src="${escapeHtml(user.avatarUrl)}" class="${cls}" alt="" loading="lazy">`;
  return `<span class="${cls} wp-gv-av-none">${escapeHtml((user?.username || '?')[0].toUpperCase())}</span>`;
}

function partyChip(pid) {
  if (!pid) return `<span class="wp-gv-party wp-gv-party-none">${escapeHtml(prT('gv_no_party'))}</span>`;
  const c = getPartyColor(pid);
  return `<span class="wp-gv-party" style="--pc:${c}"><i></i>${escapeHtml(partyNamesMap.get(pid) || '—')}</span>`;
}

function powersHtml(rights) {
  const set = new Set(rights || []);
  const on = POWERS.filter(p => p.rights.some(r => set.has(r)));
  if (!on.length) return '';
  return `<div class="wp-gv-powers" aria-label="${escapeHtml(prT('gv_powers'))}">${on.map(p =>
    `<span title="${escapeHtml(prT(p.key))}">${p.icon}</span>`).join('')}</div>`;
}

function headCard(m, { big, since }) {
  const u = m?.data;
  const name = u?.username || (m ? m.user : null);
  return `<div class="wp-gv-head${big ? ' wp-gv-head-pres' : ''}">
    ${m ? avatar(u, big ? 'wp-gv-av wp-gv-av-big' : 'wp-gv-av wp-gv-av-mid') : '<span class="wp-gv-av wp-gv-av-mid wp-gv-av-none">—</span>'}
    <div class="wp-gv-head-txt">
      <div class="wp-gv-role">${ROLE_ICON[m?.role] || ''} ${escapeHtml(m ? m.label : prT('gv_vacant'))}</div>
      <div class="wp-gv-name">${m ? `<a href="${APP_BASE}/user/${escapeHtml(m.user)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>` : '—'}</div>
      ${m ? `<div class="wp-gv-meta">${partyChip(m.party)}${since ? `<span>${escapeHtml(prT('gv_since', { d: fmtDay(since) }))}</span>` : ''}</div>` : ''}
    </div>
  </div>`;
}

function ministerCard(m) {
  const u = m.data;
  const titled = m.customTitle && m.customTitle !== m.roleLabel;
  return `<div class="wp-gv-card" style="--pc:${m.party ? getPartyColor(m.party) : 'var(--bd3)'}">
    ${avatar(u, 'wp-gv-av')}
    <div class="wp-gv-card-txt">
      <div class="wp-gv-role" title="${escapeHtml(m.roleLabel)}">${ROLE_ICON[m.role] || '💡'} ${escapeHtml(m.customTitle || m.roleLabel)}${titled ? ` <span class="wp-gv-role-game">· ${escapeHtml(m.roleLabel)}</span>` : ''}</div>
      <div class="wp-gv-name"><a href="${APP_BASE}/user/${escapeHtml(m.user)}" target="_blank" rel="noopener">${escapeHtml(u?.username || m.user)}</a>${m.badge ? ` <span class="wp-gv-badge" title="${escapeHtml(prT('gv_badge'))}">🏅</span>` : ''}</div>
      <div class="wp-gv-meta">${partyChip(m.party)}${m.appointedAt ? `<span>${escapeHtml(daysLabel(m.appointedAt))}</span>` : ''}</div>
      ${powersHtml(m.rights)}
    </div>
  </div>`;
}

function compositionHtml(people) {
  const counts = new Map();
  for (const p of people) counts.set(p.party || '', (counts.get(p.party || '') || 0) + 1);
  // Per numero di persone; "senza partito" in fondo a parità.
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] ? -1 : 1));
  const total = people.length || 1;
  const color = (pid) => (pid ? getPartyColor(pid) : 'var(--bd3)');
  const name = (pid) => (pid ? partyNamesMap.get(pid) || '—' : prT('gv_no_party'));
  return `<div class="wp-gv-comp">
    <div class="wp-gv-comp-title">${escapeHtml(prT('gv_by_party'))}</div>
    <div class="wp-gv-comp-bar">${rows.map(([pid, n]) =>
      `<span style="flex:${n};background:${color(pid)}" title="${escapeHtml(`${name(pid)}: ${n}`)}"></span>`).join('')}</div>
    <div class="wp-gv-comp-legend">${rows.map(([pid, n]) =>
      `<span><i style="background:${color(pid)}"></i>${escapeHtml(name(pid))} <b>${n}</b> <em>${Math.round(n / total * 100)}%</em></span>`).join('')}</div>
  </div>`;
}

/**
 * Disegna il governo dentro `grid` e scrive il conteggio nel badge.
 * `gov` è quello di getGovernmentWithDetails (membersData, partyOf).
 */
export function renderGovernmentPanel(gov, grid, badge) {
  const members = (gov.membersData || []);
  const partyOf = gov.partyOf || new Map();
  const raw = new Map((Array.isArray(gov.ministers) ? gov.ministers : []).map(m => [m.user, m]));
  const enrich = (m) => {
    const r = raw.get(m.user);
    return {
      ...m,
      party: partyOf.get(m.user) || null,
      // `label` è già il titolo personalizzato quando c'è: il nome di gioco
      // della carica si rifà dal ruolo.
      roleLabel: governmentRoleLabel(m.role),
      rights: r?.rights || null,
      appointedAt: Date.parse(r?.appointedAt || '') || null,
      badge: Boolean(r?.badgeGrantedAt),
    };
  };
  const all = members.map(enrich);
  const pres = all.find(m => m.role === 'president') || null;
  const vp = all.find(m => m.role === 'vicePresident') || null;
  const ministers = all.filter(m => m.role !== 'president' && m.role !== 'vicePresident');
  const people = [...new Map(all.map(m => [m.user, m])).values()];
  const parties = new Set(people.map(p => p.party).filter(Boolean));

  grid.className = 'wp-gv';
  grid.innerHTML = `
    <div class="wp-gv-top">
      ${headCard(pres, { big: true, since: pres ? presidentSince(pres.user) : null })}
      ${headCard(vp, { big: false })}
      ${people.length > 1 ? compositionHtml(people) : ''}
    </div>
    ${ministers.length
      ? `<div class="wp-gv-grid">${ministers.map(ministerCard).join('')}</div>`
      : `<p class="wp-gv-empty">${escapeHtml(prT('gv_no_ministers'))}</p>`}`;
  if (badge) {
    badge.textContent = [
      prT('gv_members', { n: people.length }),
      prT('gv_ministers', { n: ministers.length }),
      parties.size ? prT('gv_parties', { n: parties.size }) : '',
    ].filter(Boolean).join(' · ');
  }
}

