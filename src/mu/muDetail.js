/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: scheda di una singola unità
   ------------------------------------------------------------------
   Due fasi, così la scheda appare subito e non dopo due round-trip:

     1) disegno immediato con quello che la directory ha già in memoria
        (nome, avatar, nazione, livello, le sei classifiche) — zero attesa;
     2) mu.getById per i MEMBRI (l'unico campo che la proiezione lean del
        server toglie), poi un solo batch user.getUserLite per dare a
        ognuno nome, avatar, livello e danni settimanali.

   La riga (2) è l'unico traffico che questa vista genera oltre alla
   directory, e solo per l'unità che l'utente apre davvero: cachearla lato
   server per tutte le ~1400 unità sarebbe poll sprecato su dati che
   cambiano di continuo (i membri entrano ed escono).

   Le classifiche NON si chiedono a ranking.getRanking: ogni MU porta con
   sé le proprie `rankings` (verificato dal vivo), quindi sono già qui.
   ══════════════════════════════════════════════════════════════ */

import { MU_RANKING_TYPES, fetchMuDetail, fetchUsersLite } from './api.js';
import { muT } from './i18n.js';
import { isPinned, togglePin } from '../app/pins.js';
import { trackEvent } from '../shared/analytics.js';
import { avatarImg, countryName, dominantCountry, escapeHtml, flagImg, fmtCompact, fmtDate, fmtFull, tierBadge } from './ui.js';

const APP_BASE = 'https://app.warera.io';

// La scheda mostra le SEI classifiche e nient'altro di numerico. Verificato
// sull'intera directory (1379 unità): leveling.level vale 1 per tutte e
// leveling.monthlyDamages vale 0 per tutte — campi che il gioco oggi non
// alimenta, identici ovunque, quindi in scheda sarebbero solo rumore. Anche
// mercenaryReputation coincide (salvo 4 unità, per un arrotondamento) col
// valore della classifica muReputation, che ha già la sua casella. I campi
// restano comunque nella cache lato server e lato client: se il gioco li
// attiverà, rimetterli sarà un cambio di sola UI.

let hostEl = null;
let ctx = null;
let currentMu = null;

export function renderMuDetail(host, muId, context) {
  hostEl = host;
  ctx = context;
  currentMu = ctx.directory.find(m => m._id === muId) || null;

  if (!currentMu) {
    // Unità creata dopo l'ultimo poll del server (la directory si aggiorna
    // ogni 30 min): non c'è motivo di dire "non esiste", basta chiedere il
    // dettaglio e disegnare da quello.
    host.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('loading'))}</div>`;
    fetchMuDetail(muId)
      .then(detail => {
        if (!detail) throw new Error('vuoto');
        currentMu = detail;
        paintHeader();
        paintMembers(detail);
      })
      .catch(() => { host.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('detailError'))}</div>`; });
    return;
  }

  paintHeader();
  loadMembers(muId);
  trackEvent('mu-detail-open', { muId });
}

function paintHeader() {
  const m = currentMu;
  const pinned = isPinned('mu', m._id);

  hostEl.innerHTML = `
    <div class="wp-mu-detail">
      <button type="button" class="wp-mu-back" id="wp-mu-back">← ${escapeHtml(muT('back'))}</button>

      <header class="wp-mu-head">
        ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-lg')}
        <div class="wp-mu-head-main">
          <h2 class="wp-mu-head-name">${escapeHtml(m.name)}</h2>
          <div class="wp-mu-head-country">
            <span class="wp-mu-head-registered">
              ${flagImg(m.country)}<span>${escapeHtml(countryName(m.country))}</span>
              <span class="wp-mu-head-registered-label">${escapeHtml(muT('registeredIn'))}</span>
            </span>
            <span id="wp-mu-head-defacto">${deFactoBadge(dominantCountry(m))}</span>
          </div>
          <div class="wp-mu-head-meta">
            <span>${escapeHtml(muT('created'))} <strong>${escapeHtml(fmtDate(m.createdAt))}</strong></span>
            <span>${escapeHtml(muT('members'))} <strong id="wp-mu-head-members">${m.memberCount ?? (m.members?.length ?? '—')}</strong></span>
          </div>
        </div>
        <button type="button" class="wp-mu-pin${pinned ? ' wp-mu-pin-on' : ''}" id="wp-mu-pin"
                title="${escapeHtml(muT(pinned ? 'unpin' : 'pin'))}" aria-label="${escapeHtml(muT(pinned ? 'unpin' : 'pin'))}">★</button>
      </header>

      <section class="wp-mu-stats-grid">
        ${MU_RANKING_TYPES.map(type => statCard(type, m.rankings?.[type])).join('')}
      </section>

      <section id="wp-mu-composition"></section>

      <section class="wp-mu-members">
        <h3 class="wp-mu-section-title">${escapeHtml(muT('memberList'))} <span class="wp-mu-count" id="wp-mu-member-count"></span></h3>
        <div id="wp-mu-member-list"><div class="wp-mu-empty">${escapeHtml(muT('membersLoading'))}</div></div>
      </section>
    </div>`;

  hostEl.querySelector('#wp-mu-back').addEventListener('click', () => ctx.onBack());
  hostEl.querySelector('#wp-mu-pin').addEventListener('click', (e) => {
    const now = togglePin('mu', m._id, { name: m.name, avatarUrl: m.avatarUrl, country: m.country });
    e.currentTarget.classList.toggle('wp-mu-pin-on', now);
    e.currentTarget.title = muT(now ? 'unpin' : 'pin');
    e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
  });
}

/** Marchio "de facto": si mostra SOLO quando la nazione prevalente fra i
 *  membri è diversa da quella di registrazione — è l'unico caso in cui
 *  aggiunge qualcosa. Se coincidono, la bandiera è già lì sopra. */
function deFactoBadge(dom) {
  if (!dom || !dom.foreign) return '';
  return `
    <span class="wp-mu-defacto wp-mu-defacto-head${dom.share < 0.5 ? ' wp-mu-defacto-weak' : ''}" title="${escapeHtml(`${dom.n}/${dom.known}`)}">
      ${flagImg(dom.country)}
      <span>${escapeHtml(countryName(dom.country))}</span>
      <span class="wp-mu-share">${Math.round(dom.share * 100)}%</span>
      <span class="wp-mu-defacto-label">${escapeHtml(muT('deFacto'))}</span>
    </span>`;
}

/** Composizione per nazionalità calcolata dai membri appena scaricati:
 *  qui il dato è VIVO e completo (abbiamo l'oggetto utente di ognuno),
 *  mentre quello dell'elenco viene dalla mappa del server di cache, che si
 *  riempie a scaglioni. Stessa forma di ritorno di muComposition lato
 *  server, così `dominantCountry()` funziona su entrambi. */
function compositionFromUsers(users, total) {
  const counts = new Map();
  for (const u of users) {
    if (!u?.country) continue;
    counts.set(u.country, (counts.get(u.country) || 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([country, n]) => ({ country, n }));
  return { total, known: users.filter(u => u?.country).length, top };
}

function paintComposition(comp) {
  const el = hostEl?.querySelector('#wp-mu-composition');
  if (!el || !comp.known) return;

  // Barra proporzionale + elenco: le prime sei nazioni, il resto raccolto
  // in "altre" — oltre quelle la barra diventerebbe una scia di schegge
  // illeggibili.
  const MAX = 6;
  const shown = comp.top.slice(0, MAX);
  const rest = comp.top.slice(MAX).reduce((sum, t) => sum + t.n, 0);
  const segments = [...shown, ...(rest ? [{ country: null, n: rest }] : [])];

  el.innerHTML = `
    <h3 class="wp-mu-section-title">${escapeHtml(muT('composition'))} <span class="wp-mu-count">${comp.known}</span></h3>
    <div class="wp-mu-comp-bar">
      ${segments.map((seg, i) => `<span class="wp-mu-comp-seg wp-mu-comp-seg-${i}" style="width:${(seg.n / comp.known) * 100}%" title="${escapeHtml(`${seg.country ? countryName(seg.country) : '…'} · ${seg.n}`)}"></span>`).join('')}
    </div>
    <div class="wp-mu-comp-legend">
      ${segments.map((seg, i) => `
        <span class="wp-mu-comp-item">
          <span class="wp-mu-comp-dot wp-mu-comp-seg-${i}"></span>
          ${seg.country ? flagImg(seg.country) : ''}
          <span>${escapeHtml(seg.country ? countryName(seg.country) : muT('unknownCountry'))}</span>
          <strong>${seg.n}</strong>
          <span class="wp-mu-share">${Math.round((seg.n / comp.known) * 100)}%</span>
        </span>`).join('')}
    </div>`;
}

function statCard(type, ranking) {
  return `
    <div class="wp-mu-statcard">
      <div class="wp-mu-statcard-label">${escapeHtml(muT(type))}</div>
      <div class="wp-mu-statcard-value">${ranking ? escapeHtml(fmtFull(ranking.value)) : '—'}</div>
      <div class="wp-mu-statcard-rank">${ranking ? tierBadge(ranking) : `<span class="wp-mu-unranked">${escapeHtml(muT('unranked'))}</span>`}</div>
    </div>`;
}

async function loadMembers(muId) {
  try {
    const detail = await fetchMuDetail(muId);
    if (!detail) throw new Error('vuoto');
    // L'utente può aver già cambiato scheda mentre la chiamata era in volo.
    if (currentMu?._id !== muId) return;
    await paintMembers(detail);
  } catch (err) {
    const list = hostEl?.querySelector('#wp-mu-member-list');
    if (list) list.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('detailError'))}</div>`;
  }
}

async function paintMembers(detail) {
  const listEl = hostEl?.querySelector('#wp-mu-member-list');
  if (!listEl) return;

  const ids = Array.isArray(detail.members) ? detail.members : [];
  const countEl = hostEl.querySelector('#wp-mu-member-count');
  if (countEl) countEl.textContent = String(ids.length);

  if (!ids.length) {
    listEl.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('membersEmpty'))}</div>`;
    return;
  }

  const users = (await fetchUsersLite(ids)).filter(Boolean);
  if (currentMu?._id !== detail._id) return; // scheda cambiata nel frattempo

  // Composizione dal dato vivo appena scaricato, non da quella della
  // directory: qui abbiamo la nazione di OGNI membro presente.
  const comp = compositionFromUsers(users, ids.length);
  paintComposition(comp);
  const badge = hostEl.querySelector('#wp-mu-head-defacto');
  if (badge) badge.innerHTML = deFactoBadge(dominantCountry({ ...currentMu, composition: comp }));

  const managers = new Set(detail.roles?.managers || []);
  const commanders = new Set(detail.roles?.commanders || []);
  const owner = detail.user;

  users.sort((a, b) => (b.rankings?.weeklyUserDamages?.value ?? 0) - (a.rankings?.weeklyUserDamages?.value ?? 0));

  listEl.innerHTML = `<div class="wp-mu-member-grid">${users.map(u => {
    const roles = [];
    if (u._id === owner) roles.push(muT('owner'));
    if (commanders.has(u._id)) roles.push(muT('commander'));
    if (managers.has(u._id)) roles.push(muT('manager'));
    const weekly = u.rankings?.weeklyUserDamages?.value;
    return `
      <a class="wp-mu-member" href="${APP_BASE}/user/${encodeURIComponent(u._id)}" target="_blank" rel="noopener noreferrer">
        ${avatarImg(u.avatarUrl, u.username, 'wp-mu-avatar wp-mu-avatar-sm')}
        <div class="wp-mu-member-main">
          <span class="wp-mu-member-name">${escapeHtml(u.username)}</span>
          <span class="wp-mu-member-sub">${escapeHtml(muT('level'))} ${u.leveling?.level ?? '—'}${roles.length ? ` · ${escapeHtml(roles.join(' · '))}` : ''}</span>
        </div>
        <span class="wp-mu-member-dmg">${weekly != null ? escapeHtml(fmtCompact(weekly)) : '—'}</span>
      </a>`;
  }).join('')}</div>`;
}
