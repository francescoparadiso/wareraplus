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
import { classifyPlaystyle, countPlaystyles, playstyleBarHtml } from './playstyle.js';
import { trackEvent } from '../shared/analytics.js';
import { avatarImg, countryName, dominantCountry, escapeHtml, flagImg, fmtCompact, fmtDate, fmtFull, fmtRelative, tierBadge } from './ui.js';
import { ensureDailyDamage, muDamageToday, dailyDamageLabel } from '../shared/dailyDamage.js';
// L'etichetta della finestra ("Oggi" / "Dalle HH:MM") vive nel dizionario
// dello shell, non in quello locale della vista MU: si prende da lì.
import { t as sharedT } from '../shared/i18n.js';

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
  // Unità nuova: i membri della precedente non c'entrano più. L'ordinamento
  // scelto invece resta, è una preferenza di lettura.
  _members = [];

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
        ${todayCardHtml()}
      </section>

      <section id="wp-mu-playstyle"></section>

      <section id="wp-mu-composition"></section>

      <section class="wp-mu-members">
        <h3 class="wp-mu-section-title">
          ${escapeHtml(muT('memberList'))} <span class="wp-mu-count" id="wp-mu-member-count"></span>
          <div class="wp-mu-member-tools">
            <label class="wp-mu-member-sort">
              <span>${escapeHtml(muT('memberSortBy'))}</span>
              <select id="wp-mu-member-sort">
                ${MEMBER_SORTS.map(o => `<option value="${o.key}">${escapeHtml(muT(o.label))}</option>`).join('')}
              </select>
            </label>
            <div class="wp-mu-viewswitch" id="wp-mu-member-view" role="group">
              <button type="button" data-view="list" class="${_memberView === 'list' ? 'active' : ''}">${escapeHtml(muT('viewList'))}</button>
              <button type="button" data-view="cards" class="${_memberView === 'cards' ? 'active' : ''}">${escapeHtml(muT('viewCards'))}</button>
            </div>
          </div>
        </h3>
        <div id="wp-mu-member-list"><div class="wp-mu-empty">${escapeHtml(muT('membersLoading'))}</div></div>
      </section>
    </div>`;

  const sortSel = hostEl.querySelector('#wp-mu-member-sort');
  if (sortSel) {
    sortSel.value = _memberSort;
    sortSel.addEventListener('change', (e) => {
      _memberSort = e.target.value;
      // Riordino in posto: i membri sono già in memoria, nessuna fetch.
      renderMemberList();
      trackEvent('mu-member-sort', { key: _memberSort });
    });
  }

  const viewSwitch = hostEl.querySelector('#wp-mu-member-view');
  if (viewSwitch) {
    viewSwitch.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-view]');
      if (!btn || btn.dataset.view === _memberView) return;
      _memberView = btn.dataset.view;
      try { localStorage.setItem(MEMBER_VIEW_KEY, _memberView); } catch { /* storage negato: la vista resta per la sessione */ }
      viewSwitch.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === _memberView));
      renderMemberList();
      trackEvent('mu-member-view', { view: _memberView });
    });
  }

  hostEl.querySelector('#wp-mu-back').addEventListener('click', () => ctx.onBack());
  hostEl.querySelector('#wp-mu-pin').addEventListener('click', (e) => {
    const now = togglePin('mu', m._id, { name: m.name, avatarUrl: m.avatarUrl, country: m.country });
    e.currentTarget.classList.toggle('wp-mu-pin-on', now);
    e.currentTarget.title = muT(now ? 'unpin' : 'pin');
    e.currentTarget.setAttribute('aria-label', e.currentTarget.title);
  });

  paintTodayCard(m);
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

/** Quanti membri giocano di guerra e quanti di economia. Calcolato dal vivo
 *  sulle skill dei membri appena scaricati (vedi src/mu/playstyle.js): qui
 *  il dato è completo, mentre quello dell'elenco viene dalla mappa del
 *  server, che si riempie a scaglioni. */
function paintPlaystyle(counts) {
  const el = hostEl?.querySelector('#wp-mu-playstyle');
  if (!el || !counts.known) return;
  el.innerHTML = `
    <h3 class="wp-mu-section-title">${escapeHtml(muT('playstyle'))} <span class="wp-mu-count">${counts.known}</span></h3>
    ${playstyleBarHtml(counts, playstyleLabels())}`;
}

/** Etichette dei quattro gruppi, dal dizionario di questa vista. */
export function playstyleLabels() {
  return {
    war: muT('psWar'), eco: muT('psEco'),
    mixed: muT('psMixed'), undecided: muT('psUndecided'),
  };
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

/* ── Danno di oggi dell'unità (WarEra+) ──
   WarEra dà solo il cumulato settimanale (muWeeklyDamages): il danno di
   giornata si ricava dallo scatto che il server di cache prende al cambio
   giorno di gioco — stesso meccanismo di nazioni e alleanze, vedi
   src/shared/dailyDamage.js.

   Come nel pannello nazione la casella nasce vuota e si riempie quando lo
   scatto arriva: la scheda dell'unità è già tutta disponibile in memoria
   dalla directory, non deve aspettare la rete per comparire. */
function todayCardHtml() {
  return `
    <div class="wp-mu-statcard" id="wp-mu-today" hidden>
      <div class="wp-mu-statcard-label" id="wp-mu-today-label"></div>
      <div class="wp-mu-statcard-value" id="wp-mu-today-value">—</div>
    </div>`;
}

function paintTodayCard(mu) {
  ensureDailyDamage().then(baseline => {
    if (!baseline) return;
    const today = muDamageToday(mu);
    if (today == null) return;   // unità nata dopo lo scatto: nessuna base
    // Cercati DENTRO il contenitore della scheda, non nel documento: la
    // vista può essere montata in più radici (ed è comunque l'unica corretta
    // se nel frattempo se ne è aperta un'altra).
    const box = hostEl?.querySelector('#wp-mu-today');
    const label = hostEl?.querySelector('#wp-mu-today-label');
    const value = hostEl?.querySelector('#wp-mu-today-value');
    if (!box || !label || !value || currentMu?._id !== mu._id) return;
    label.textContent = `🔥 ${dailyDamageLabel(sharedT)}`;
    value.textContent = fmtFull(today);
    box.hidden = false;
  });
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

/* ══════════════════════════════════════════════════════════════
   I MEMBRI, per esteso
   ------------------------------------------------------------------
   La riga per membro mostrava nome, livello e danno settimanale, e basta.
   Ma `user.getUserLite` — la chiamata che la scheda fa GIÀ per ogni
   membro — porta con sé molto altro: nazione, grado militare, tutte le
   classifiche utente, le skill (da cui lo stile di gioco), ricchezza,
   taglia e l'ultimo accesso. Nessuna di queste informazioni costa una
   richiesta in più: erano solo scartate.

   Quindi la scheda del membro ora è una card con la sua griglia di
   statistiche, e l'elenco si può riordinare (chi picchia, chi è ricco,
   chi è ancora attivo) senza rifetchare nulla: `_members` resta in
   memoria e si riordina in posto.
   ══════════════════════════════════════════════════════════════ */

const MEMBER_SORTS = [
  { key: 'weekly',   label: 'colWeekly', get: u => u.rankings?.weeklyUserDamages?.value ?? 0 },
  { key: 'total',    label: 'colTotal',  get: u => u.rankings?.userDamages?.value ?? u.stats?.damagesCount ?? 0 },
  { key: 'level',    label: 'level',     get: u => u.leveling?.level ?? 0 },
  { key: 'wealth',   label: 'colWealth', get: u => u.rankings?.userWealth?.value ?? 0 },
  { key: 'bounty',   label: 'colBounty', get: u => u.rankings?.userBounty?.value ?? 0 },
  { key: 'lastSeen', label: 'lastSeen',  get: u => Date.parse(u.dates?.lastConnectionAt) || 0 },
  // Il nome è l'unico criterio crescente e alfabetico: gestito a parte
  // in sortMembers(), gli altri sono tutti "dal più grande al più piccolo".
  { key: 'name',     label: 'sortName',  get: u => u.username || '' },
];

let _members = [];        // utenti dell'unità aperta, già scaricati
let _memberSort = 'weekly';
/* Due viste sugli stessi dati: LISTA (predefinita) per confrontare molti
   membri riga per riga, CARD per leggerne uno alla volta con più respiro.
   Nessuna delle due rifetcha nulla: sono due disegni di `_members`.
   La scelta è una preferenza di lettura, quindi sopravvive alla sessione. */
const MEMBER_VIEW_KEY = 'we_mu_member_view';
let _memberView = (() => {
  try { return localStorage.getItem(MEMBER_VIEW_KEY) === 'cards' ? 'cards' : 'list'; }
  catch { return 'list'; }
})();
let _memberRoles = { owner: null, commanders: new Set(), managers: new Set() };

function sortMembers(users) {
  const s = MEMBER_SORTS.find(o => o.key === _memberSort) || MEMBER_SORTS[0];
  const arr = users.slice();
  if (s.key === 'name') {
    arr.sort((a, b) => String(s.get(a)).localeCompare(String(s.get(b)), undefined, { sensitivity: 'base' }));
  } else {
    arr.sort((a, b) => s.get(b) - s.get(a));
  }
  return arr;
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
  paintPlaystyle(countPlaystyles(users));
  const badge = hostEl.querySelector('#wp-mu-head-defacto');
  if (badge) badge.innerHTML = deFactoBadge(dominantCountry({ ...currentMu, composition: comp }));

  _members = users;
  _memberRoles = {
    owner: detail.user,
    commanders: new Set(detail.roles?.commanders || []),
    managers: new Set(detail.roles?.managers || []),
  };
  renderMemberList();
}

/** Ridisegna SOLO l'elenco (nessuna fetch): usata sia al primo disegno sia
 *  a ogni cambio di ordinamento. */
function renderMemberList() {
  const listEl = hostEl?.querySelector('#wp-mu-member-list');
  if (!listEl) return;
  const rows = sortMembers(_members);
  listEl.innerHTML = _memberView === 'cards'
    ? `<div class="wp-mu-member-grid">${rows.map(memberCard).join('')}</div>`
    : memberTableHtml(rows);
  if (_memberView === 'list') attachMemberTableSort(listEl);
}

/* ── Vista LISTA ──────────────────────
   Una riga per membro, colonne ordinabili cliccando l'intestazione (le
   stesse chiavi del selettore: un solo criterio di verità per
   l'ordinamento, vedi MEMBER_SORTS). Tabella a sé e non quella
   dell'elenco unità: le colonne sono altre. */
const MEMBER_COLS = [
  { key: 'name',     label: 'member',    cls: 'wp-mu-mt-name' },
  { key: 'level',    label: 'level',     num: true },
  { key: null,       label: 'mrank',     num: true, get: u => u.militaryRank ?? '—' },
  { key: null,       label: 'playstyle', get: u => psPill(u) },
  { key: 'weekly',   label: 'colWeekly', num: true, get: u => fmtCompact(u.rankings?.weeklyUserDamages?.value ?? 0), cls: 'wk' },
  { key: 'total',    label: 'colTotal',  num: true, get: u => fmtCompact(u.rankings?.userDamages?.value ?? u.stats?.damagesCount ?? 0) },
  { key: 'wealth',   label: 'colWealth', num: true, get: u => fmtCompact(u.rankings?.userWealth?.value ?? 0), cls: 'money' },
  { key: 'bounty',   label: 'colBounty', num: true, get: u => fmtCompact(u.rankings?.userBounty?.value ?? 0) },
  { key: null,       label: 'atk',       num: true, get: u => fmtCompact(u.skills?.attack?.total ?? 0) },
  { key: null,       label: 'crit',      num: true, get: u => `${fmtCompact(u.skills?.criticalChance?.total ?? 0)}%` },
  { key: 'lastSeen', label: 'lastSeen',  num: true, get: u => fmtRelative(u.dates?.lastConnectionAt), cls: 'when' },
];

function psPill(u) {
  const ps = classifyPlaystyle(u);
  const label = { war: 'psWar', eco: 'psEco', mixed: 'psMixed', undecided: 'psUndecided' }[ps.mode];
  return `<span class="wp-mu-ps-pill wp-mu-ps-${ps.mode}">${escapeHtml(muT(label))}</span>`;
}

function memberTableHtml(rows) {
  const head = MEMBER_COLS.map(c => `
    <button type="button" class="wp-mu-mt-th${c.num ? ' wp-mu-mt-num' : ''}${c.key ? '' : ' wp-mu-mt-static'}${c.key && c.key === _memberSort ? ' active' : ''}"
            ${c.key ? `data-sort="${c.key}"` : 'disabled'}>${escapeHtml(muT(c.label))}</button>`).join('');

  const body = rows.map(u => {
    const roles = memberRoles(u);
    return `
      <a class="wp-mu-mt-row" href="${APP_BASE}/user/${encodeURIComponent(u._id)}" target="_blank" rel="noopener noreferrer">
        <span class="wp-mu-mt-name">
          ${avatarImg(u.avatarUrl, u.username, 'wp-mu-avatar wp-mu-avatar-xs')}
          ${flagImg(u.country)}
          <span class="wp-mu-member-nick">${escapeHtml(u.username)}</span>
          ${roles.length ? `<span class="wp-mu-mt-role">${escapeHtml(roles[0])}</span>` : ''}
        </span>
        <span class="wp-mu-mt-num">${u.leveling?.level ?? '—'}</span>
        ${MEMBER_COLS.slice(2).map(c => `<span class="${c.num ? 'wp-mu-mt-num ' : ''}${c.cls || ''}">${c.get(u)}</span>`).join('')}
      </a>`;
  }).join('');

  return `<div class="wp-mu-mtable-wrap"><div class="wp-mu-mtable">
    <div class="wp-mu-mt-head">${head}</div>
    ${body}
  </div></div>`;
}

function memberRoles(u) {
  const { owner, commanders, managers } = _memberRoles;
  const roles = [];
  if (u._id === owner) roles.push(muT('owner'));
  if (commanders.has(u._id)) roles.push(muT('commander'));
  if (managers.has(u._id)) roles.push(muT('manager'));
  return roles;
}

function attachMemberTableSort(listEl) {
  listEl.querySelectorAll('.wp-mu-mt-th[data-sort]').forEach(btn => {
    btn.addEventListener('click', () => {
      _memberSort = btn.dataset.sort;
      const sel = hostEl?.querySelector('#wp-mu-member-sort');
      if (sel) sel.value = _memberSort;
      renderMemberList();
      trackEvent('mu-member-sort', { key: _memberSort, from: 'header' });
    });
  });
}

function memberCard(u) {
  const roles = memberRoles(u);

  const weekly = u.rankings?.weeklyUserDamages;
  const total = u.rankings?.userDamages?.value ?? u.stats?.damagesCount;
  const wealth = u.rankings?.userWealth?.value;
  const bounty = u.rankings?.userBounty?.value;
  // Le skill in scheda sono i TOTALI (con arma ed equipaggiamento): qui
  // interessa quanto picchia davvero, non come ha speso i punti — quello
  // lo dice già la pastiglia dello stile di gioco.
  const atk = u.skills?.attack?.total;
  const crit = u.skills?.criticalChance?.total;
  const ps = classifyPlaystyle(u);
  const psLabel = { war: 'psWar', eco: 'psEco', mixed: 'psMixed', undecided: 'psUndecided' }[ps.mode];
  const lastSeen = u.dates?.lastConnectionAt;

  const cell = (label, value, cls = '') => `
    <div class="wp-mu-mcell">
      <span class="wp-mu-mcell-k">${escapeHtml(label)}</span>
      <span class="wp-mu-mcell-v ${cls}">${value}</span>
    </div>`;

  return `
    <a class="wp-mu-member" href="${APP_BASE}/user/${encodeURIComponent(u._id)}" target="_blank" rel="noopener noreferrer">
      <div class="wp-mu-member-top">
        ${avatarImg(u.avatarUrl, u.username, 'wp-mu-avatar wp-mu-avatar-sm')}
        <div class="wp-mu-member-main">
          <span class="wp-mu-member-name">
            ${flagImg(u.country)}<span class="wp-mu-member-nick">${escapeHtml(u.username)}</span>
          </span>
          <span class="wp-mu-member-sub">
            ${escapeHtml(muT('level'))} ${u.leveling?.level ?? '—'}${u.leveling?.prestigeLevel ? ` ⭐${u.leveling.prestigeLevel}` : ''}
            · ${escapeHtml(muT('mrank'))} ${u.militaryRank ?? '—'}${roles.length ? ` · ${escapeHtml(roles.join(' · '))}` : ''}
          </span>
        </div>
        ${psLabel ? `<span class="wp-mu-ps-pill wp-mu-ps-${ps.mode}">${escapeHtml(muT(psLabel))}</span>` : ''}
      </div>
      <div class="wp-mu-member-stats">
        ${cell(muT('colWeekly'), `${weekly?.value != null ? escapeHtml(fmtCompact(weekly.value)) : '—'} ${tierBadge(weekly)}`, 'wk')}
        ${cell(muT('colTotal'), total != null ? escapeHtml(fmtCompact(total)) : '—')}
        ${cell(muT('colWealth'), wealth != null ? escapeHtml(fmtCompact(wealth)) : '—', 'money')}
        ${cell(muT('colBounty'), bounty != null ? escapeHtml(fmtCompact(bounty)) : '—')}
        ${cell(muT('atk'), atk != null ? escapeHtml(fmtCompact(atk)) : '—')}
        ${cell(muT('crit'), crit != null ? `${escapeHtml(fmtCompact(crit))}%` : '—')}
        ${cell(muT('lastSeen'), escapeHtml(fmtRelative(lastSeen)), 'when')}
      </div>
    </a>`;
}
