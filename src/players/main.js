/* ══════════════════════════════════════════════════════════════
   WarEra+ — Giocatori
   ------------------------------------------------------------------
   Voce di "Approfondimenti". Richiesta dell'utente: cliccando un
   cittadino (Statistiche nazioni → scheda nazione → Cittadini) si
   apriva il suo profilo sul sito del gioco, e basta; voleva un
   riepilogo QUI — ricchezza, danni, danni totali, le battaglie in cui
   ha combattuto — e una sezione dedicata ai giocatori.

   Due schermate:
   1. PARTENZA — ricerca per nome, "Sono io" e i visti di recente, e le
      classifiche mondiali dei giocatori (danni settimanali, totali,
      ricchezza, taglia) filtrabili per nazione.
   2. SCHEDA DI UN GIOCATORE — in cima chi è (nazione, unità, livello,
      build, pillola) e i numeri con la posizione mondiale E nella sua
      nazione; sotto cinque schede: Battaglie (col bottino di ognuna),
      Ricchezza nel tempo, Aziende e lavoro, Politica, Abilità ed
      equipaggiamento.
   3. CONFRONTO 1 VS 1 — dalla scheda, "Confronta con…": due giocatori
      affiancati, riga per riga, col migliore dei due evidenziato.

   "Sono io" è la STESSA chiave della scheda Ricchezza di Economia
   (`we_my_player`): dirlo in un posto vale anche nell'altro. I visti di
   recente (`we_players_recent`) tengono id, nome e avatar per disegnare
   le scorciatoie senza una richiesta. Niente di tutto ciò lascia il
   browser.

   Da dove viene ogni dato, e perché le battaglie sono "le ultime N
   giornate" e non "tutte": vedi src/players/api.js.
   ══════════════════════════════════════════════════════════════ */

import '../styles/economy.css';     // il grafico della ricchezza (candleChart) vive lì
import '../styles/players.css';
import { state } from '../diplomacy/state.js';
import { escapeHtml, countryName, flagImg, avatarImg, fmtCompact, fmtFull, fmtRelative, fmtDate } from '../mu/ui.js';
import { classifyPlaystyle, WAR_SKILLS, ECO_SKILLS } from '../mu/playstyle.js';
import { candleChartSvg, attachCandleExplorer } from '../economy/candleChart.js';
import { ecoT } from '../economy/i18n.js';
import { syncBack } from '../app/backNav.js';
import { plyT } from './i18n.js';
import {
  LEADERBOARDS, fetchPlayer, searchPlayers, fetchEquipment, fetchWealthHistory,
  fetchLeaderboard, fetchNames, fetchPlayerBattles, fetchCompanies, fetchWorkStats,
  fetchPolitics, fetchNationRanks,
} from './api.js';

const APP_BASE = 'https://app.warera.io';
const MINE_KEY = 'we_my_player';
const RECENT_KEY = 'we_players_recent';
const RECENT_MAX = 8;
const BOARD_TOP = 50;
const BATTLE_DAYS = [3, 10, 17, 24, 31];
const BASE_SKILLS = ['health', 'hunger', 'energy', 'stamina'];
const GEAR_SLOTS = ['weapon', 'helmet', 'chest', 'pants', 'boots', 'gloves'];
const ID_RE = /^[a-f0-9]{24}$/;

let _root = null;
let _langHandler = null;

// Partenza
let _q = '';
let _searching = false;
let _cands = null;
let _board = LEADERBOARDS[0];
let _boardCountry = '';
let _boardRows = null;       // righe della classifica _board, o null in volo
let _boardError = false;
let _boardLoading = false;
let _boardNames = new Map();

// Scheda
let _pid = null;
let _lite = null;
let _loading = false;
let _ptab = 'battles';
let _battles = null;         // risposta di fetchPlayerBattles
let _battleDays = BATTLE_DAYS[0];
let _battlesLoading = false;
let _wealth;                 // undefined = non chiesta, null = non disponibile
let _equip;                  // idem
let _muName = null;
let _wealthObs = null;
let _natRanks = null;        // posizione nella sua nazione (fetchNationRanks)
let _companies;              // undefined = non chiesta, 'loading', null, []
let _work;                   // idem, statistiche di lavoro a 31 giorni
let _politics;               // idem
let _lootOpen = new Set();   // battaglie con la riga del bottino aperta

// Confronto
let _picking = false;        // "Confronta con…" aperto sulla scheda
let _pickQ = '';
let _pickCands = null;
let _pickSearching = false;
let _cmpId = null;
let _cmp = null;             // { lite, natRanks, equip } del secondo giocatore
let _cmpEquipA;              // equipaggiamento del primo, per il confronto

/* ── Piccoli aiuti ─────────────────────────────────────────────── */

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* storage negato */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* idem */ } }

function recents() {
  try {
    const arr = JSON.parse(safeGet(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(r => r && ID_RE.test(r.id)) : [];
  } catch { return []; }
}
function rememberRecent(id, lite) {
  if (!lite) return;
  const list = recents().filter(r => r.id !== id);
  list.unshift({ id, u: lite.username || '', a: lite.avatarUrl || '' });
  safeSet(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}

function lingua() {
  return (safeGet('we_lang') || navigator.language || 'it').slice(0, 2);
}
function fmtWhen(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(lingua(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fmtTime(iso) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString(lingua(), { hour: '2-digit', minute: '2-digit' }) : '—';
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e4) return fmtCompact(n);
  return n >= 10 ? n.toFixed(0) : n.toFixed(2);
}
const dayNum = (g) => Math.round(Date.parse(`${g}T12:00:00Z`) / 86400000);

/* ── Caricamento ──────────────────────────────────────────────── */

async function doSearch() {
  if (_q.trim().length < 2) return;
  _searching = true;
  _cands = null;
  render();
  try { _cands = await searchPlayers(_q); }
  catch (err) { console.warn('WarEra+ giocatori: ricerca fallita:', err.message); _cands = []; }
  _searching = false;
  if (_cands.length === 1) { openPlayer(_cands[0].id); return; }
  render();
}

async function loadBoard() {
  const type = _board;
  _boardRows = null;
  _boardError = false;
  _boardLoading = true;
  render();
  try {
    const rows = await fetchLeaderboard(type);
    if (_board !== type) return;
    _boardRows = rows;
  } catch (err) {
    console.warn('WarEra+ giocatori: classifica non disponibile:', err.message);
    if (_board === type) _boardError = true;
  }
  if (_board === type) _boardLoading = false;
  render();
  resolveBoardNames();
}

async function resolveBoardNames() {
  const ids = boardTop().map(r => r.u).filter(id => !_boardNames.has(id));
  if (!ids.length) return;
  const got = await fetchNames(ids).catch(() => new Map());
  got.forEach((v, id) => { if (v) _boardNames.set(id, v); });
  if (!_pid) render();
}

function boardFiltered() {
  if (!_boardRows) return [];
  return _boardCountry ? _boardRows.filter(r => r.c === _boardCountry) : _boardRows;
}
function boardTop() {
  return boardFiltered().slice(0, BOARD_TOP);
}

/** Apre la scheda di un giocatore. Esportata: è quella che chiamano gli
 *  altri pezzi del tool (elenco cittadini, overlay con ?player=). */
export async function openPlayer(id) {
  if (!ID_RE.test(String(id || ''))) return;
  _pid = id;
  _lite = null;
  _loading = true;
  _battles = null;
  _battleDays = BATTLE_DAYS[0];
  _wealth = undefined;
  _equip = undefined;
  _muName = null;
  _natRanks = null;
  _companies = undefined;
  _work = undefined;
  _politics = undefined;
  _lootOpen = new Set();
  _picking = false;
  _pickCands = null;
  _cmpId = null;
  _cmp = null;
  _cmpEquipA = undefined;
  if (!_root) return;          // la vista non è ancora montata: ci pensa initPlayersView
  render();
  _root.scrollTop = 0;
  let lite = null;
  try { lite = await fetchPlayer(id); } catch (err) { console.warn('WarEra+ giocatori:', err.message); }
  if (_pid !== id) return;
  _lite = lite;
  _loading = false;
  rememberRecent(id, lite);
  render();
  if (lite?.mu) resolveMuName(lite.mu, id);
  if (lite) fetchNationRanks(lite).then(r => { if (_pid === id) { _natRanks = r; render(); } }).catch(() => {});
  loadTab(_ptab);
}

async function resolveMuName(muId, pid) {
  try {
    const { fetchMuBriefs } = await import('../mu/api.js');
    const got = await fetchMuBriefs([muId]);
    if (_pid !== pid) return;
    _muName = got.get(muId)?.name || null;
    render();
  } catch (_) { /* resta senza nome */ }
}

/** Ogni scheda carica il suo alla PRIMA apertura: chi guarda solo le
 *  battaglie non scarica lo storico della ricchezza, e viceversa. */
function loadTab(tab) {
  if (!_pid || !_lite) return;
  if (tab === 'battles' && !_battles && !_battlesLoading) loadBattles();
  if (tab === 'wealth' && _wealth === undefined) {
    const pid = _pid;
    _wealth = 'loading';
    fetchWealthHistory(pid).then(h => { if (_pid === pid) { _wealth = h; render(); } });
  }
  if (tab === 'skills' && _equip === undefined) {
    const pid = _pid;
    _equip = 'loading';
    fetchEquipment(pid).then(e => { if (_pid === pid) { _equip = e; render(); } });
  }
  if (tab === 'work' && _companies === undefined) {
    const pid = _pid;
    _companies = 'loading';
    _work = 'loading';
    fetchCompanies(pid).catch(() => null).then(c => { if (_pid === pid) { _companies = c; render(); } });
    fetchWorkStats(pid).then(w => { if (_pid === pid) { _work = w; render(); } });
  }
  if (tab === 'politics' && _politics === undefined) {
    const pid = _pid;
    _politics = 'loading';
    fetchPolitics(pid, _lite.country).catch(() => null).then(p => { if (_pid === pid) { _politics = p; render(); } });
  }
}

async function loadBattles() {
  const pid = _pid;
  _battlesLoading = true;
  render();
  try {
    const res = await fetchPlayerBattles(pid, { days: _battleDays });
    if (_pid === pid) _battles = res;
  } catch (err) {
    console.warn('WarEra+ giocatori: battaglie non disponibili:', err.message);
    if (_pid === pid) _battles = { rows: [], checked: 0, failed: 1, days: _battleDays };
  }
  if (_pid === pid) { _battlesLoading = false; render(); }
}

/* ── Partenza ─────────────────────────────────────────────────── */

function homeHtml() {
  const mine = safeGet(MINE_KEY);
  const rec = recents();
  const chips = [
    mine && ID_RE.test(mine) ? `<button type="button" class="wp-ply-chip wp-ply-chip-me" data-open="${escapeHtml(mine)}">★ ${escapeHtml(plyT('me'))}</button>` : '',
    ...rec.filter(r => r.id !== mine).map(r => `
      <button type="button" class="wp-ply-chip" data-open="${escapeHtml(r.id)}">
        ${avatarImg(r.a, r.u, 'wp-ply-av wp-ply-av-xs')}<span>${escapeHtml(r.u || r.id)}</span></button>`),
  ].filter(Boolean);

  let cands = '';
  if (_searching) cands = `<div class="wp-ply-loading">${escapeHtml(plyT('searching'))}</div>`;
  else if (_cands && !_cands.length) cands = `<p class="wp-ply-note">${escapeHtml(plyT('noResults'))}</p>`;
  else if (_cands) {
    cands = `
      <p class="wp-ply-dim">${escapeHtml(plyT('pick'))}</p>
      <div class="wp-ply-cands">${_cands.map(({ id, lite }) => `
        <button type="button" class="wp-ply-cand" data-open="${escapeHtml(id)}">
          ${avatarImg(lite.avatarUrl, lite.username, 'wp-ply-av')}
          <span class="wp-ply-cand-name">${escapeHtml(lite.username)}
            <small>${flagImg(lite.country, 'wp-ply-flag')} ${escapeHtml(countryName(lite.country))} · lv ${escapeHtml(lite.leveling?.level ?? '—')}</small></span>
        </button>`).join('')}</div>`;
  }

  const nations = (state.nazioniGlobal || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const top = boardTop();
  let board;
  if (_boardError) board = `<p class="wp-ply-note">${escapeHtml(plyT('boardError'))}</p>`;
  else if (!_boardRows) board = `<div class="wp-ply-loading">${escapeHtml(plyT('boardLoading'))}</div>`;
  else {
    const isMoney = _board === 'userWealth' || _board === 'userBounty';
    board = `
      <div class="wp-ply-tablewrap"><table class="wp-ply-table wp-ply-board">
        <thead><tr><th class="wp-ply-num">${escapeHtml(plyT('colRank'))}</th><th>${escapeHtml(plyT('colPlayer'))}</th>
          <th>${escapeHtml(plyT('colNation'))}</th><th class="wp-ply-num">${escapeHtml(plyT('colValue'))}</th></tr></thead>
        <tbody>${top.map(r => {
          const n = _boardNames.get(r.u);
          return `<tr class="wp-ply-rowlink" data-open="${escapeHtml(r.u)}" tabindex="0">
            <td class="wp-ply-num wp-ply-dim">${escapeHtml(r.r)}</td>
            <td><span class="wp-ply-who">${avatarImg(n?.avatarUrl, n?.username, 'wp-ply-av wp-ply-av-xs')}<span>${escapeHtml(n?.username || '…')}</span></span></td>
            <td><span class="wp-ply-who">${flagImg(r.c, 'wp-ply-flag')}<span>${escapeHtml(countryName(r.c))}</span></span></td>
            <td class="wp-ply-num">${escapeHtml(isMoney ? fmtMoney(r.v) : fmtCompact(r.v))}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
      <p class="wp-ply-note">${escapeHtml(plyT('boardNote', { n: top.length, t: fmtFull(boardFiltered().length) }))}</p>`;
  }

  return `
    <header class="wp-ply-head">
      <h2>${escapeHtml(plyT('title'))}</h2>
      <p class="wp-ply-sub">${escapeHtml(plyT('sub'))}</p>
    </header>
    <form class="wp-ply-search" id="wp-ply-search">
      <input type="search" placeholder="${escapeHtml(plyT('searchPh'))}" value="${escapeHtml(_q)}" autocomplete="off">
      <button type="submit"${_searching ? ' disabled' : ''}>${escapeHtml(plyT('go'))}</button>
    </form>
    ${cands}
    ${chips.length ? `<div class="wp-ply-recent"><span class="wp-ply-dim">${escapeHtml(plyT('recent'))}</span>${chips.join('')}</div>` : ''}

    <h3 class="wp-ply-h3">${escapeHtml(plyT('boardsTitle'))}</h3>
    <div class="wp-ply-boardbar">
      <div class="wp-ply-pills">${LEADERBOARDS.map(t => `
        <button type="button" class="wp-ply-pill${_board === t ? ' active' : ''}" data-board="${t}">${escapeHtml(plyT(`board_${t}`))}</button>`).join('')}</div>
      <select class="wp-ply-select" id="wp-ply-board-country">
        <option value="">${escapeHtml(plyT('allCountries'))}</option>
        ${nations.map(n => `<option value="${escapeHtml(n._id)}"${_boardCountry === n._id ? ' selected' : ''}>${escapeHtml(n.name)}</option>`).join('')}
      </select>
    </div>
    ${board}`;
}

/* ── Scheda di un giocatore ───────────────────────────────────── */

function statCard(label, rk, fmt = fmtCompact, type = null) {
  const nat = type && _natRanks?.ranks?.[type];
  return `
    <div class="wp-ply-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${rk?.value != null ? escapeHtml(fmt(rk.value)) : '—'}</strong>
      ${rk?.rank ? `<em class="wp-ply-tier-${escapeHtml(rk.tier || '')}">${escapeHtml(plyT('worldRank', { n: fmtFull(rk.rank) }))}</em>` : ''}
      ${nat ? `<em class="wp-ply-natrank" title="${escapeHtml(plyT(_natRanks.partial ? 'natRankPartial' : 'natRankNote', { n: fmtFull(_natRanks.n) }))}">${escapeHtml(plyT('natRank', { n: fmtFull(nat), c: countryName(_lite?.country) }))}</em>` : ''}
    </div>`;
}

function pillHtml(lite) {
  const b = lite.buffs || {};
  const now = Date.now();
  if (b.buffEndAt && Date.parse(b.buffEndAt) > now) {
    return `<span class="wp-ply-badge wp-ply-badge-pill">💊 ${escapeHtml(plyT('pillOn', { t: fmtTime(b.buffEndAt) }))}</span>`;
  }
  if (b.debuffEndAt && Date.parse(b.debuffEndAt) > now) {
    return `<span class="wp-ply-badge wp-ply-badge-down">💊 ${escapeHtml(plyT('pillOff', { t: fmtTime(b.debuffEndAt) }))}</span>`;
  }
  return '';
}

function playerHtml() {
  const back = `<button type="button" class="wp-ply-back" id="wp-ply-back">← ${escapeHtml(plyT('back'))}</button>`;
  if (_loading) return `${back}<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  const p = _lite;
  if (!p) return `${back}<p class="wp-ply-note">${escapeHtml(plyT('notFound'))}</p>`;

  const lv = p.leveling || {};
  const prestige = Number(lv.prestigeLevel || lv.prestige) || 0;
  const ps = classifyPlaystyle(p);
  const mine = safeGet(MINE_KEY) === _pid;
  const rk = p.rankings || {};

  const tabs = [
    { id: 'battles', label: plyT('tabBattles') },
    { id: 'wealth', label: plyT('tabWealth') },
    { id: 'work', label: plyT('tabWork') },
    { id: 'politics', label: plyT('tabPolitics') },
    { id: 'skills', label: plyT('tabSkills') },
  ];
  let body = '';
  if (_ptab === 'wealth') body = wealthHtml();
  else if (_ptab === 'skills') body = skillsHtml(p, ps);
  else if (_ptab === 'work') body = workHtml();
  else if (_ptab === 'politics') body = politicsHtml();
  else body = battlesHtml();

  return `
    ${back}
    <header class="wp-ply-phead">
      ${avatarImg(p.avatarUrl, p.username, 'wp-ply-av wp-ply-av-lg')}
      <div class="wp-ply-pwho">
        <h2>${escapeHtml(p.username || _pid)}</h2>
        <div class="wp-ply-pmeta">
          <span class="wp-ply-who">${flagImg(p.country, 'wp-ply-flag')}<span>${escapeHtml(countryName(p.country))}</span></span>
          <span>${escapeHtml(plyT('level'))} ${escapeHtml(lv.level ?? '—')}${prestige ? ` <b class="wp-ply-prestige" title="${escapeHtml(plyT('prestige'))}">★${prestige}</b>` : ''}</span>
          ${p.militaryRank != null ? `<span>${escapeHtml(plyT('mrank'))} ${escapeHtml(p.militaryRank)}</span>` : ''}
          <span class="wp-ply-ps wp-ply-ps-${ps.mode}">${escapeHtml(plyT(`style_${ps.mode}`))}</span>
        </div>
        <div class="wp-ply-pmeta">
          ${p.mu
            ? `<button type="button" class="wp-ply-link" data-mu="${escapeHtml(p.mu)}">🛡 ${escapeHtml(_muName || plyT('unit'))}</button>`
            : `<span class="wp-ply-dim">${escapeHtml(plyT('noUnit'))}</span>`}
          ${p.dates?.lastConnectionAt ? `<span class="wp-ply-dim">${escapeHtml(plyT('lastSeen'))} ${escapeHtml(fmtRelative(p.dates.lastConnectionAt))}</span>` : ''}
          ${p.createdAt ? `<span class="wp-ply-dim">${escapeHtml(plyT('joined'))} ${escapeHtml(fmtDate(p.createdAt))}</span>` : ''}
          ${pillHtml(p)}
        </div>
      </div>
      <div class="wp-ply-pactions">
        ${mine
          ? `<span class="wp-ply-dim">${escapeHtml(plyT('isMine'))}</span> <button type="button" class="wp-ply-chip" data-forget="1">${escapeHtml(plyT('forget'))}</button>`
          : `<button type="button" class="wp-ply-chip" data-mine="1">${escapeHtml(plyT('mine'))}</button>`}
        <button type="button" class="wp-ply-chip wp-ply-chip-me" data-compare="1">⚖ ${escapeHtml(plyT('cmpWith'))}</button>
        <a class="wp-ply-chip" href="${APP_BASE}/user/${encodeURIComponent(_pid)}" target="_blank" rel="noopener noreferrer">${escapeHtml(plyT('openInGame'))} ↗</a>
      </div>
    </header>
    ${_picking ? pickerHtml() : ''}

    <div class="wp-ply-stats">
      ${statCard(plyT('stWeekly'), rk.weeklyUserDamages, fmtCompact, 'weeklyUserDamages')}
      ${statCard(plyT('stTotal'), rk.userDamages, fmtCompact, 'userDamages')}
      ${statCard(plyT('stWealth'), rk.userWealth, fmtMoney, 'userWealth')}
      ${statCard(plyT('stBounty'), rk.userBounty, fmtMoney, 'userBounty')}
      ${statCard(plyT('stXp'), rk.userLevel)}
    </div>
    <div class="wp-ply-minor">
      ${[['stCases', rk.userCasesOpened], ['stMissions', rk.userMissionsClaimed], ['stReferrals', rk.userReferrals], ['stSubs', rk.userSubscribers]]
        .filter(([, r]) => r?.value != null)
        .map(([k, r]) => `<span>${escapeHtml(plyT(k))} <b>${escapeHtml(fmtFull(r.value))}</b>${r.rank ? ` <em>#${escapeHtml(fmtFull(r.rank))}</em>` : ''}</span>`).join('')}
    </div>

    <nav class="wp-ply-tabs" role="tablist">${tabs.map(t => `
      <button type="button" role="tab" class="wp-ply-pill${_ptab === t.id ? ' active' : ''}" aria-selected="${_ptab === t.id}" data-ptab="${t.id}">${escapeHtml(t.label)}</button>`).join('')}
    </nav>
    ${body}`;
}

function battlesHtml() {
  if (_battlesLoading && !_battles) return `<div class="wp-ply-loading">${escapeHtml(plyT('btSearching'))}</div>`;
  const b = _battles;
  if (!b) return '';
  const rows = b.rows;
  const tot = rows.reduce((t, r) => ({
    hits: t.hits + r.s.hits, dmg: t.dmg + r.s.dmg, bounty: t.bounty + r.s.bounty,
    contract: t.contract + r.s.contract, cases: t.cases + r.s.cases, loot: t.loot + (r.s.loot?.length || 0),
  }), { hits: 0, dmg: 0, bounty: 0, contract: 0, cases: 0, loot: 0 });
  const nation = (id) => `<span class="wp-ply-who">${flagImg(id, 'wp-ply-flag')}<span>${escapeHtml(countryName(id))}</span></span>`;
  const region = (id) => state.regionData?.[id]?.name || '';

  const next = BATTLE_DAYS.find(d => d > b.days);
  const more = next
    ? `<button type="button" class="wp-ply-more" id="wp-ply-bt-more"${_battlesLoading ? ' disabled' : ''}>${escapeHtml(_battlesLoading ? plyT('btSearching') : plyT('btMore'))}</button>`
    : `<p class="wp-ply-note">${escapeHtml(plyT('btMaxed', { d: b.days }))}</p>`;

  const table = rows.length ? `
    <div class="wp-ply-tablewrap"><table class="wp-ply-table">
      <thead><tr>
        <th>${escapeHtml(plyT('colWhen'))}</th><th>${escapeHtml(plyT('colBattle'))}</th>
        <th class="wp-ply-num">${escapeHtml(plyT('colHits'))}</th><th class="wp-ply-num">${escapeHtml(plyT('colDamage'))}</th>
        <th class="wp-ply-num">${escapeHtml(plyT('colBountyShort'))}</th><th class="wp-ply-num">${escapeHtml(plyT('colContract'))}</th>
        <th class="wp-ply-num">${escapeHtml(plyT('colCases'))}</th>
        <th class="wp-ply-num">${escapeHtml(plyT('colLoot'))}</th>
      </tr></thead>
      <tbody>${rows.map(({ battle: bt, s }) => `
        <tr class="wp-ply-rowlink" data-battle="${escapeHtml(bt.id)}" tabindex="0">
          <td class="wp-ply-when">${bt.live ? `<span class="wp-ply-livedot"></span>${escapeHtml(plyT('liveNow'))}` : escapeHtml(fmtWhen(bt.endedAt))}</td>
          <td><div class="wp-ply-vs">${nation(bt.defender?.countryId)}<span class="wp-ply-dim">vs</span>${nation(bt.attacker?.countryId)}</div>
            ${region(bt.regionId) ? `<small class="wp-ply-dim">${escapeHtml(region(bt.regionId))}</small>` : ''}</td>
          <td class="wp-ply-num">${escapeHtml(fmtFull(s.hits))}</td>
          <td class="wp-ply-num">${escapeHtml(fmtCompact(s.dmg))}</td>
          <td class="wp-ply-num wp-ply-gold">${s.bounty ? escapeHtml(fmtMoney(s.bounty)) : '—'}</td>
          <td class="wp-ply-num wp-ply-violet">${s.contract ? escapeHtml(fmtMoney(s.contract)) : '—'}</td>
          <td class="wp-ply-num">${s.cases || '—'}</td>
          <td class="wp-ply-num">${s.loot?.length
            ? `<button type="button" class="wp-ply-lootbtn${_lootOpen.has(bt.id) ? ' active' : ''}" data-loot="${escapeHtml(bt.id)}" aria-expanded="${_lootOpen.has(bt.id)}">🎁 ${s.loot.length}</button>`
            : '—'}</td>
        </tr>${_lootOpen.has(bt.id) && s.loot?.length ? `
        <tr class="wp-ply-lootrow"><td colspan="8"><div class="wp-ply-loot">${s.loot.map(l => `
          <span class="wp-ply-lootitem"><b>${escapeHtml(l.code)}</b>${l.skills
            ? `<small>${escapeHtml(Object.entries(l.skills).map(([k, v]) => `${plyT(`sk_${k}`)} ${v}`).join(' · '))}</small>` : ''}${l.rank
            ? `<small class="wp-ply-dim">${escapeHtml(plyT('lootRank', { n: l.rank }))}${l.pool === 'round' || l.pool === 'battle' ? ' · ' + escapeHtml(plyT(`lootPool_${l.pool}`)) : ''}</small>` : ''}</span>`).join('')}
        </div></td></tr>` : ''}`).join('')}</tbody>
      <tfoot><tr>
        <td colspan="2">${escapeHtml(plyT('total', { n: rows.length }))}</td>
        <td class="wp-ply-num">${escapeHtml(fmtFull(tot.hits))}</td>
        <td class="wp-ply-num">${escapeHtml(fmtCompact(tot.dmg))}</td>
        <td class="wp-ply-num wp-ply-gold">${escapeHtml(fmtMoney(tot.bounty))}</td>
        <td class="wp-ply-num wp-ply-violet">${escapeHtml(fmtMoney(tot.contract))}</td>
        <td class="wp-ply-num">${tot.cases}</td>
        <td class="wp-ply-num">${tot.loot || '—'}</td>
      </tr></tfoot>
    </table></div>` : '';

  return `
    <p class="wp-ply-summary">${escapeHtml(rows.length ? plyT('btSummary', { n: rows.length, d: b.days }) : plyT('btNone', { d: b.days }))}</p>
    ${table}
    ${more}
    ${b.failed ? `<p class="wp-ply-note">⚠️ ${escapeHtml(plyT('btFailed', { n: b.failed }))}</p>` : ''}
    ${b.archiveDegraded ? `<p class="wp-ply-note">${escapeHtml(plyT('btDegraded'))}</p>` : ''}
    <p class="wp-ply-note">${escapeHtml(plyT('btNoSide'))}</p>`;
}

/** Variazione fra l'ultimo scatto e quello di `giorni` fa (o il primo
 *  dopo, se quel giorno è un buco) — come in economy/playerWealth.js. */
function change(days, giorni) {
  if (!days || days.length < 2) return null;
  const last = days[days.length - 1];
  const target = dayNum(last[0]) - giorni;
  const first = days.find(r => dayNum(r[0]) >= target);
  if (!first || first === last) return null;
  return last[1] - first[1];
}
function deltaHtml(v) {
  if (v == null || !Number.isFinite(v)) return '<span class="wp-ply-dim">—</span>';
  const cls = v > 0 ? 'wp-ply-up' : v < 0 ? 'wp-ply-down' : 'wp-ply-dim';
  return `<span class="${cls}">${v > 0 ? '+' : v < 0 ? '−' : ''}${escapeHtml(fmtMoney(Math.abs(v)))}</span>`;
}

function wealthHtml() {
  if (_wealth === undefined || _wealth === 'loading') return `<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  const now = _lite?.rankings?.userWealth?.value;
  const nowCard = `<div class="wp-ply-minor wp-ply-minor-big"><span>${escapeHtml(plyT('wlNow'))} <b>${now != null ? escapeHtml(fmtFull(Math.round(now))) : '—'}</b></span>`;
  if (!_wealth) return `${nowCard}</div><p class="wp-ply-note">${escapeHtml(plyT('wlNoServer'))}</p>`;
  const days = _wealth.days || [];
  if (!days.length) return `${nowCard}</div><p class="wp-ply-note">${escapeHtml(plyT('wlNotIn'))}</p>`;
  return `
    ${nowCard}
      <span>${escapeHtml(plyT('wl1'))} ${deltaHtml(change(days, 1))}</span>
      <span>${escapeHtml(plyT('wl7'))} ${deltaHtml(change(days, 7))}</span>
      <span>${escapeHtml(plyT('wl30'))} ${deltaHtml(change(days, 30))}</span>
    </div>
    <div class="wp-ecn-chartwrap wp-ply-chart" id="wp-ply-wchart"></div>
    <p class="wp-ply-note">${escapeHtml(plyT('wlNote'))}${_wealth.archiveFrom ? ' ' + escapeHtml(plyT('wlSince', { d: fmtDate(_wealth.archiveFrom) })) : ''}</p>`;
}

/* Il grafico si disegna alla misura vera del contenitore, e si ridisegna
   se cambia (stessa regola di economy/playerWealth.js). */
function drawWealthChart() {
  _wealthObs?.disconnect();
  const wrap = _root?.querySelector('#wp-ply-wchart');
  const days = _wealth?.days;
  if (!wrap || !days || days.length < 2) return;
  const serie = days.map(([g, v]) => [g, v, v, v, v, null]);
  const draw = () => {
    const w = Math.max(320, Math.round(wrap.clientWidth || 0));
    const h = 280;
    wrap.innerHTML = candleChartSvg(serie, { w, h, fmt: fmtMoney, lingua: lingua(), mode: 'line' });
    attachCandleExplorer(wrap, serie, {
      w, h, fmt: fmtMoney, lingua: lingua(), t: ecoT,
      righe: (r) => [[escapeHtml(plyT('stWealth')), escapeHtml(fmtFull(Math.round(r[4])))]],
    });
    return w;
  };
  let lastW = draw();
  _wealthObs = new ResizeObserver(() => {
    const w = Math.round(wrap.clientWidth || 0);
    if (!w || !wrap.isConnected || Math.abs(w - lastW) < 8) return;
    lastW = draw();
  });
  _wealthObs.observe(wrap);
}

function skillsHtml(p, ps) {
  const sk = p.skills || {};
  const group = (title, keys) => {
    const items = keys.filter(k => sk[k]);
    if (!items.length) return '';
    return `
      <div class="wp-ply-skgroup">
        <h4>${escapeHtml(title)}</h4>
        ${items.map(k => {
          const lvl = sk[k].level || 0;
          return `<div class="wp-ply-skill">
            <span>${escapeHtml(plyT(`sk_${k}`))}</span>
            <span class="wp-ply-skbar"><i style="width:${Math.min(100, lvl * 10)}%"></i></span>
            <b>${escapeHtml(lvl)}</b>
            <small class="wp-ply-dim">${escapeHtml(fmtFull(Math.round(sk[k].total ?? sk[k].value ?? 0)))}</small>
          </div>`;
        }).join('')}
      </div>`;
  };

  let gear;
  if (_equip === undefined || _equip === 'loading') gear = `<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  else if (!_equip) gear = `<p class="wp-ply-note">${escapeHtml(plyT('gearNone'))}</p>`;
  else {
    gear = `<div class="wp-ply-gear">${GEAR_SLOTS.map(slot => {
      const it = _equip[slot];
      const skills = it?.skills ? Object.entries(it.skills).map(([k, v]) => `${plyT(`sk_${k}`)} ${v}`).join(' · ') : '';
      return `<div class="wp-ply-gearslot">
        <span class="wp-ply-dim">${escapeHtml(plyT(`slot_${slot}`))}</span>
        <b>${it?.code ? escapeHtml(it.code) : '—'}</b>
        ${skills ? `<small>${escapeHtml(skills)}</small>` : ''}
        ${it?.maxState ? `<small class="wp-ply-dim">${escapeHtml(plyT('condition'))} ${escapeHtml(Math.round(it.state))}/${escapeHtml(it.maxState)}</small>` : ''}
      </div>`;
    }).join('')}
    ${_equip.ammo ? `<div class="wp-ply-gearslot"><span class="wp-ply-dim">${escapeHtml(plyT('slot_ammo'))}</span><b>${escapeHtml(_equip.ammo)}</b></div>` : ''}
    </div>`;
  }

  return `
    <p class="wp-ply-summary"><span class="wp-ply-ps wp-ply-ps-${ps.mode}">${escapeHtml(plyT(`style_${ps.mode}`))}</span>
      ${ps.war + ps.eco ? `<span class="wp-ply-dim">${escapeHtml(plyT('skWar'))} ${ps.war} · ${escapeHtml(plyT('skEco'))} ${ps.eco} ${escapeHtml(plyT('points'))}</span>` : ''}</p>
    <div class="wp-ply-skills">
      ${group(plyT('skWar'), WAR_SKILLS)}
      ${group(plyT('skEco'), ECO_SKILLS)}
      ${group(plyT('skBase'), BASE_SKILLS)}
    </div>
    <h3 class="wp-ply-h3">${escapeHtml(plyT('gear'))}</h3>
    ${gear}`;
}

/* ── Disegno e comandi ────────────────────────────────────────── */

function render() {
  if (!_root) return;
  _root.innerHTML = `<div class="wp-ply">${_pid && _cmpId ? compareHtml() : _pid ? playerHtml() : homeHtml()}</div>`;
  // Indietro del telefono/browser: dal confronto torna alla scheda, dalla
  // scheda alla partenza; l'URL porta ?player= (e ?vs=) finché sono aperti.
  syncBack('players/detail', !!_pid, () => { _pid = null; _cmpId = null; render(); }, () => !!_pid, { player: _pid || undefined });
  syncBack('players/detail/compare', !!(_pid && _cmpId), () => { _cmpId = null; render(); }, () => !!(_pid && _cmpId), { vs: _cmpId || undefined });
  if (_pid && _ptab === 'wealth') drawWealthChart();
  // La classifica parte la prima volta che si vede la partenza — anche
  // tornandoci da una scheda aperta con un link diretto.
  if (!_pid && !_boardRows && !_boardError && !_boardLoading) loadBoard();
}

function wire() {
  _root.addEventListener('submit', (e) => {
    if (e.target.id === 'wp-ply-pick') {
      e.preventDefault();
      _pickQ = e.target.querySelector('input')?.value || '';
      doPickSearch();
      return;
    }
    if (e.target.id !== 'wp-ply-search') return;
    e.preventDefault();
    _q = e.target.querySelector('input')?.value || '';
    doSearch();
  });
  _root.addEventListener('change', (e) => {
    if (e.target.id !== 'wp-ply-board-country') return;
    _boardCountry = e.target.value;
    render();
    resolveBoardNames();
  });
  _root.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches?.('.wp-ply-rowlink')) e.target.click();
  });
  _root.addEventListener('click', (e) => {
    const t = e.target;
    const vs = t.closest('[data-vs]');
    if (vs) { openCompare(vs.dataset.vs); return; }
    const open = t.closest('[data-open]');
    if (open) { openPlayer(open.dataset.open); return; }
    if (t.closest('[data-compare]')) { _picking = !_picking; render(); return; }
    if (t.closest('#wp-ply-cmp-back')) { _cmpId = null; render(); return; }
    if (t.closest('#wp-ply-cmp-swap')) { const a = _pid, b = _cmpId; openPlayer(b).then(() => openCompare(a)); return; }
    const loot = t.closest('[data-loot]');
    if (loot) {
      const id = loot.dataset.loot;
      if (_lootOpen.has(id)) _lootOpen.delete(id); else _lootOpen.add(id);
      render();
      return;
    }
    const board = t.closest('[data-board]');
    if (board) { if (_board !== board.dataset.board) { _board = board.dataset.board; loadBoard(); } return; }
    if (t.closest('#wp-ply-back')) { _pid = null; render(); return; }
    const ptab = t.closest('[data-ptab]');
    if (ptab) { _ptab = ptab.dataset.ptab; render(); loadTab(_ptab); return; }
    if (t.closest('[data-mine]')) { safeSet(MINE_KEY, _pid); render(); return; }
    if (t.closest('[data-forget]')) { safeDel(MINE_KEY); render(); return; }
    if (t.closest('#wp-ply-bt-more')) {
      _battleDays = BATTLE_DAYS.find(d => d > (_battles?.days || 0)) || _battleDays;
      loadBattles();
      return;
    }
    // Battaglia e unità vivono in altri overlay: questo si chiude prima,
    // altrimenti l'altro si aprirebbe SOTTO (stesso z-index, DOM prima).
    const battle = t.closest('[data-battle]');
    if (battle) { jump(m => m.openBattlesView(battle.dataset.battle), () => import('../app/battlesOverlay.js')); return; }
    const mu = t.closest('[data-mu]');
    if (mu) { jump(m => m.openMuView(mu.dataset.mu), () => import('../app/muOverlay.js')); }
  });
}

async function jump(go, load) {
  const [mod, own] = await Promise.all([load(), import('../app/playersOverlay.js')]);
  own.closePlayersView();
  go(mod);
}

/** Monta la vista (o la ridisegna, se era già montata). */
export async function initPlayersView(container) {
  const first = _root !== container;
  if (first) {
    _root = container;
    wire();
  }
  if (!_langHandler) {
    _langHandler = () => { if (_root) render(); };
    window.addEventListener('wareraplus:langchange', _langHandler);
  }
  // openPlayer chiamata PRIMA del montaggio (link diretto, primo clic su
  // un cittadino): aveva solo preso nota dell'id, il caricamento parte qui.
  if (first && _pid && _loading) {
    const id = _pid;
    _pid = null;
    await openPlayer(id);
    return;
  }
  render();
}

/* ── Confronto ─────────────────────────────────────────────────── */

async function doPickSearch() {
  if (_pickQ.trim().length < 2) return;
  _pickSearching = true;
  _pickCands = null;
  render();
  try { _pickCands = (await searchPlayers(_pickQ)).filter(c => c.id !== _pid); }
  catch (_) { _pickCands = []; }
  _pickSearching = false;
  if (_pickCands.length === 1) { openCompare(_pickCands[0].id); return; }
  render();
}

function pickerHtml() {
  const rec = recents().filter(r => r.id !== _pid);
  const mine = safeGet(MINE_KEY);
  let cands = '';
  if (_pickSearching) cands = `<div class="wp-ply-loading">${escapeHtml(plyT('searching'))}</div>`;
  else if (_pickCands && !_pickCands.length) cands = `<p class="wp-ply-note">${escapeHtml(plyT('noResults'))}</p>`;
  else if (_pickCands) {
    cands = `<div class="wp-ply-cands">${_pickCands.map(({ id, lite }) => `
      <button type="button" class="wp-ply-cand" data-vs="${escapeHtml(id)}">
        ${avatarImg(lite.avatarUrl, lite.username, 'wp-ply-av')}
        <span class="wp-ply-cand-name">${escapeHtml(lite.username)}
          <small>${flagImg(lite.country, 'wp-ply-flag')} ${escapeHtml(countryName(lite.country))} · lv ${escapeHtml(lite.leveling?.level ?? '—')}</small></span>
      </button>`).join('')}</div>`;
  }
  const chips = [
    mine && ID_RE.test(mine) && mine !== _pid ? `<button type="button" class="wp-ply-chip wp-ply-chip-me" data-vs="${escapeHtml(mine)}">★ ${escapeHtml(plyT('me'))}</button>` : '',
    ...rec.filter(r => r.id !== mine).map(r => `<button type="button" class="wp-ply-chip" data-vs="${escapeHtml(r.id)}">${avatarImg(r.a, r.u, 'wp-ply-av wp-ply-av-xs')}<span>${escapeHtml(r.u || r.id)}</span></button>`),
  ].filter(Boolean);
  return `
    <div class="wp-ply-picker">
      <form class="wp-ply-search" id="wp-ply-pick">
        <input type="search" placeholder="${escapeHtml(plyT('cmpSearchPh'))}" value="${escapeHtml(_pickQ)}" autocomplete="off">
        <button type="submit"${_pickSearching ? ' disabled' : ''}>${escapeHtml(plyT('go'))}</button>
      </form>
      ${cands}
      ${chips.length ? `<div class="wp-ply-recent">${chips.join('')}</div>` : ''}
    </div>`;
}

/** Apre il confronto fra il giocatore della scheda e `id`. Esportata:
 *  la usa l'overlay per i link ?player=A&vs=B. */
export async function openCompare(id) {
  if (!ID_RE.test(String(id || '')) || !_pid || id === _pid) return;
  _picking = false;
  _cmpId = id;
  _cmp = null;
  if (!_root) return;
  render();
  _root.scrollTop = 0;
  const pid = _pid;
  const lite = await fetchPlayer(id).catch(() => null);
  if (_cmpId !== id || _pid !== pid) return;
  _cmp = { lite, natRanks: null, equip: undefined };
  if (lite) rememberRecent(id, lite);
  render();
  // Posizioni nella nazione ed equipaggiamento dei due, in parallelo:
  // per il primo la posizione c'è già (se la sua scheda l'aveva chiesta).
  const [nr, eqB, eqA] = await Promise.all([
    lite ? fetchNationRanks(lite).catch(() => null) : null,
    fetchEquipment(id),
    _equip && _equip !== 'loading' ? _equip : fetchEquipment(pid),
  ]);
  if (_cmpId !== id || _pid !== pid) return;
  _cmp = { lite, natRanks: nr, equip: eqB };
  _cmpEquipA = eqA;
  render();
}

/* Il confronto come un "versus" da gioco di combattimento. Richiesta
   dell'utente: la prima versione era una tabella, giusta ma piatta.
   - in cima i due giocatori uno di fronte all'altro, ognuno col SUO
     colore (A rosa = l'accento della sezione, B azzurro) e il punteggio
     delle voci vinte al centro;
   - ogni voce è un tiro alla fune: i due valori ai lati e in mezzo una
     barra divisa in proporzione, che si legge senza leggere i numeri;
   - le abilità come radar, i due profili sovrapposti: la forma della
     build si vede prima dei livelli;
   - l'equipaggiamento slot per slot, vince il pezzo con più statistiche.
   I colori A/B sono gli stessi ovunque nella schermata. */

const CMP_GEAR_SUM = (it) => it?.skills ? Object.values(it.skills).reduce((t, v) => t + (Number(v) || 0), 0) : 0;

/** Una voce del duello. `win` = 1 (A), 2 (B), 0 (pari o non confrontabile). */
function duelRow(label, va, vb, { fmt = (v) => fmtFull(v), subA = '', subB = '', lower = false } = {}) {
  const na = Number(va), nb = Number(vb);
  const ok = Number.isFinite(na) && Number.isFinite(nb);
  let win = 0;
  if (ok && na !== nb) win = (na > nb) !== lower ? 1 : 2;
  // La barra: quota di A sul totale. Con valori negativi o tutti a zero
  // (succede: punti eco a 0 per entrambi) metà e metà.
  const tot = ok && na >= 0 && nb >= 0 ? na + nb : 0;
  const pa = tot > 0 ? Math.max(4, Math.min(96, (na / tot) * 100)) : 50;
  const val = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : escapeHtml(fmt(v)));
  return {
    win,
    html: `
    <div class="wp-vs-row${win === 1 ? ' wp-vs-wa' : win === 2 ? ' wp-vs-wb' : ''}">
      <div class="wp-vs-val wp-vs-val-a"><b>${val(va)}</b>${subA ? `<small>${escapeHtml(subA)}</small>` : ''}</div>
      <div class="wp-vs-mid">
        <span class="wp-vs-label">${escapeHtml(label)}</span>
        <div class="wp-vs-bar"><i class="wp-vs-bar-a" style="width:${pa.toFixed(1)}%"></i><i class="wp-vs-bar-b" style="width:${(100 - pa).toFixed(1)}%"></i></div>
      </div>
      <div class="wp-vs-val wp-vs-val-b"><b>${val(vb)}</b>${subB ? `<small>${escapeHtml(subB)}</small>` : ''}</div>
    </div>`,
  };
}

/* Radar delle undici abilità (guerra in alto, economia in basso), SVG a
   mano. Scala sul livello massimo dei due (almeno 10): un giocatore
   piccolo contro uno piccolo resta leggibile. */
function radarSvg(a, b) {
  const keys = [...WAR_SKILLS, ...ECO_SKILLS];
  const lv = (p, k) => Number(p.skills?.[k]?.level) || 0;
  const max = Math.max(10, ...keys.map(k => Math.max(lv(a, k), lv(b, k))));
  const S = 340, C = S / 2, R = 118;
  const pt = (i, v) => {
    const ang = -Math.PI / 2 + (i / keys.length) * Math.PI * 2;
    return [C + Math.cos(ang) * R * v, C + Math.sin(ang) * R * v];
  };
  const ring = (f) => keys.map((_, i) => pt(i, f).map(n => n.toFixed(1)).join(',')).join(' ');
  const poly = (p) => keys.map((k, i) => pt(i, lv(p, k) / max).map(n => n.toFixed(1)).join(',')).join(' ');
  const grid = [0.25, 0.5, 0.75, 1].map(f => `<polygon class="wp-vs-rgrid" points="${ring(f)}"/>`).join('');
  const spokes = keys.map((_, i) => { const [x, y] = pt(i, 1); return `<line class="wp-vs-rgrid" x1="${C}" y1="${C}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
  const labels = keys.map((k, i) => {
    const [x, y] = pt(i, 1.17);
    const anchor = Math.abs(x - C) < 8 ? 'middle' : x > C ? 'start' : 'end';
    const war = WAR_SKILLS.includes(k);
    return `<text class="wp-vs-rlabel${war ? '' : ' wp-vs-rlabel-eco'}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeHtml(plyT(`sk_${k}`))}<title>${escapeHtml(`${plyT(`sk_${k}`)}: ${lv(a, k)} – ${lv(b, k)}`)}</title></text>`;
  }).join('');
  const dots = (p, cls) => keys.map((k, i) => { const [x, y] = pt(i, lv(p, k) / max); return `<circle class="${cls}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3"/>`; }).join('');
  return `<svg class="wp-vs-radar" viewBox="-70 -24 ${S + 140} ${S + 48}" role="img" aria-label="${escapeHtml(plyT('cmpSkills'))}">
    ${grid}${spokes}
    <polygon class="wp-vs-rpoly-b" points="${poly(b)}"/>
    <polygon class="wp-vs-rpoly-a" points="${poly(a)}"/>
    ${dots(b, 'wp-vs-rdot-b')}${dots(a, 'wp-vs-rdot-a')}
    ${labels}
  </svg>`;
}

function compareHtml() {
  const a = _lite;
  const b = _cmp?.lite;
  const back = `<button type="button" class="wp-ply-back" id="wp-ply-cmp-back">← ${escapeHtml(plyT('cmpBack', { a: a?.username || '' }))}</button>`;
  if (!a) return back;
  if (!_cmp) return `${back}<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  if (!b) return `${back}<p class="wp-ply-note">${escapeHtml(plyT('notFound'))}</p>`;

  const psA = classifyPlaystyle(a), psB = classifyPlaystyle(b);
  const ra = a.rankings || {}, rb = b.rankings || {};
  const rankSub = (p, rk, nr, type) => [
    rk?.[type]?.rank ? plyT('worldRank', { n: fmtFull(rk[type].rank) }) : '',
    nr?.ranks?.[type] ? plyT('natRank', { n: fmtFull(nr.ranks[type]), c: countryName(p.country) }) : '',
  ].filter(Boolean).join(' · ');
  const ranked = (label, type, fmt) => duelRow(label, ra[type]?.value, rb[type]?.value, {
    fmt, subA: rankSub(a, ra, _natRanks, type), subB: rankSub(b, rb, _cmp.natRanks, type),
  });
  const pts = (v) => `${v} ${plyT('points')}`;

  const groups = [
    { title: plyT('cmpGroupWar'), icon: '⚔', rows: [
      ranked(plyT('stWeekly'), 'weeklyUserDamages', fmtCompact),
      ranked(plyT('stTotal'), 'userDamages', fmtCompact),
      ranked(plyT('stBounty'), 'userBounty', fmtMoney),
      duelRow(plyT('mrank'), a.militaryRank, b.militaryRank),
      duelRow(plyT('skWar'), psA.war, psB.war, { fmt: pts }),
    ] },
    { title: plyT('cmpGroupEco'), icon: '💰', rows: [
      ranked(plyT('stWealth'), 'userWealth', fmtMoney),
      duelRow(plyT('skEco'), psA.eco, psB.eco, { fmt: pts }),
      duelRow(plyT('stCases'), ra.userCasesOpened?.value, rb.userCasesOpened?.value),
    ] },
    { title: plyT('cmpGroupProg'), icon: '★', rows: [
      duelRow(plyT('stXp'), ra.userLevel?.value, rb.userLevel?.value, { fmt: fmtCompact }),
      duelRow(plyT('level'), a.leveling?.level, b.leveling?.level),
      duelRow(plyT('stMissions'), ra.userMissionsClaimed?.value, rb.userMissionsClaimed?.value),
    ] },
  ];
  const all = groups.flatMap(g => g.rows);
  const winsA = all.filter(r => r.win === 1).length;
  const winsB = all.filter(r => r.win === 2).length;
  const verdict = winsA === winsB
    ? plyT('cmpTie', { n: winsA })
    : plyT('cmpLead', { name: (winsA > winsB ? a : b).username, n: Math.max(winsA, winsB), t: all.length });

  const fighter = (p, ps, side) => `
    <div class="wp-vs-fighter wp-vs-fighter-${side}${(side === 'a' ? winsA > winsB : winsB > winsA) ? ' wp-vs-leader' : ''}">
      ${avatarImg(p.avatarUrl, p.username, 'wp-ply-av wp-vs-av')}
      <button type="button" class="wp-vs-name" data-open="${escapeHtml(p._id)}">${escapeHtml(p.username)}</button>
      <span class="wp-ply-who">${flagImg(p.country, 'wp-ply-flag')}<span>${escapeHtml(countryName(p.country))}</span></span>
      <div class="wp-vs-tags">
        <span class="wp-vs-lv">${escapeHtml(plyT('level'))} ${escapeHtml(p.leveling?.level ?? '—')}</span>
        <span class="wp-ply-ps wp-ply-ps-${ps.mode}">${escapeHtml(plyT(`style_${ps.mode}`))}</span>
      </div>
      ${p.createdAt ? `<small class="wp-ply-dim">${escapeHtml(plyT('cmpSince', { d: fmtDate(p.createdAt) }))}</small>` : ''}
    </div>`;

  const gearLoading = _cmp.equip === undefined || _cmpEquipA === undefined;
  const gearSide = (it, side, win) => {
    const skills = it?.skills ? Object.entries(it.skills).map(([k, v]) => `${plyT(`sk_${k}`)} ${v}`).join(' · ') : '';
    return `<div class="wp-vs-gear wp-vs-gear-${side}${win ? ' wp-vs-gear-win' : ''}">
      <b>${it?.code ? escapeHtml(it.code) : '—'}</b>${skills ? `<small>${escapeHtml(skills)}</small>` : ''}</div>`;
  };
  const gear = gearLoading
    ? `<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`
    : GEAR_SLOTS.map(slot => {
      const ia = _cmpEquipA?.[slot], ib = _cmp.equip?.[slot];
      const sa = CMP_GEAR_SUM(ia), sb = CMP_GEAR_SUM(ib);
      return `<div class="wp-vs-gearrow">
        ${gearSide(ia, 'a', sa > sb)}
        <span class="wp-vs-slot">${escapeHtml(plyT(`slot_${slot}`))}</span>
        ${gearSide(ib, 'b', sb > sa)}
      </div>`;
    }).join('');

  const skillDuels = [...WAR_SKILLS, ...ECO_SKILLS]
    .map(k => duelRow(plyT(`sk_${k}`), a.skills?.[k]?.level ?? 0, b.skills?.[k]?.level ?? 0).html).join('');

  return `
    ${back}
    <section class="wp-vs">
      <div class="wp-vs-hero">
        ${fighter(a, psA, 'a')}
        <div class="wp-vs-center">
          <span class="wp-vs-badge">VS</span>
          <div class="wp-vs-score"><b class="wp-vs-sa">${winsA}</b><span>–</span><b class="wp-vs-sb">${winsB}</b></div>
          <p class="wp-vs-verdict">${escapeHtml(verdict)}</p>
          <button type="button" class="wp-ply-chip" id="wp-ply-cmp-swap">⇄ ${escapeHtml(plyT('cmpSwap'))}</button>
        </div>
        ${fighter(b, psB, 'b')}
      </div>

      ${groups.map(g => `
        <div class="wp-vs-group">
          <h3 class="wp-vs-gtitle"><span>${g.icon}</span>${escapeHtml(g.title)}
            <em><b class="wp-vs-sa">${g.rows.filter(r => r.win === 1).length}</b> – <b class="wp-vs-sb">${g.rows.filter(r => r.win === 2).length}</b></em></h3>
          ${g.rows.map(r => r.html).join('')}
        </div>`).join('')}

      <div class="wp-vs-group">
        <h3 class="wp-vs-gtitle"><span>◆</span>${escapeHtml(plyT('cmpSkills'))}</h3>
        <div class="wp-vs-skills">
          <div class="wp-vs-radarwrap">
            ${radarSvg(a, b)}
            <div class="wp-vs-legend"><span><i class="wp-vs-key-a"></i>${escapeHtml(a.username)}</span><span><i class="wp-vs-key-b"></i>${escapeHtml(b.username)}</span></div>
          </div>
          <div class="wp-vs-skilllist">${skillDuels}</div>
        </div>
      </div>

      <div class="wp-vs-group">
        <h3 class="wp-vs-gtitle"><span>🛡</span>${escapeHtml(plyT('gear'))}</h3>
        ${gear}
      </div>
    </section>
    <p class="wp-ply-note">${escapeHtml(plyT('cmpNote'))}</p>`;
}

/* ── Aziende e lavoro ─────────────────────────────────────────── */

const UPGRADES = ['automatedEngine', 'storage', 'breakRoom', 'headquarters', 'dormitories'];

/* Le ultime 31 giornate come barre impilate (dipendenti / lui / motore),
   in SVG scritto a mano come i grafici di nations/charts.js. Un giorno
   senza riga è un BUCO, non uno zero. */
function workChartSvg(rows) {
  const W = 760, H = 170, PL = 6, PR = 6, PT = 10, PB = 22;
  const days = rows.slice(-31);
  const max = Math.max(1, ...days.map(r => r.total || 0));
  const bw = (W - PL - PR) / days.length;
  const y = (v) => PT + (H - PT - PB) * (1 - v / max);
  const parts = [['employeeProd', 'wp-ply-w-emp'], ['selfWork', 'wp-ply-w-self'], ['automatedEngine', 'wp-ply-w-auto']];
  const bars = days.map((r, i) => {
    let acc = 0;
    const x = PL + i * bw + 1;
    const rects = parts.map(([k, cls]) => {
      const v = r[k] || 0;
      const y1 = y(acc + v), y0 = y(acc);
      acc += v;
      return v > 0 ? `<rect class="${cls}" x="${x.toFixed(1)}" y="${y1.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}"/>` : '';
    }).join('');
    const tip = `${r.dailyDate} · ${fmtFull(Math.round(r.total || 0))} ${plyT('wkPts')} · ${plyT('wkWages')} ${fmtMoney(r.wage || 0)}`;
    return `<g><title>${escapeHtml(tip)}</title>${rects}</g>`;
  }).join('');
  const lbl = (i) => days[i] ? `<text x="${(PL + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(days[i].dailyDate.slice(5))}</text>` : '';
  return `<svg class="wp-ply-wchart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">${bars}<g class="wp-ply-axis">${lbl(0)}${lbl(Math.floor(days.length / 2))}${lbl(days.length - 1)}</g></svg>`;
}

function workHtml() {
  const loading = `<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  let comp;
  if (_companies === undefined || _companies === 'loading') comp = loading;
  else if (!_companies) comp = `<p class="wp-ply-note">${escapeHtml(plyT('wkError'))}</p>`;
  else if (!_companies.length) comp = `<p class="wp-ply-note">${escapeHtml(plyT('wkNone'))}</p>`;
  else {
    const totV = _companies.reduce((t, c) => t + c.value, 0);
    const totW = _companies.reduce((t, c) => t + c.workers, 0);
    const region = (id) => state.regionData?.[id];
    comp = `
      <p class="wp-ply-summary">${escapeHtml(plyT('wkCompanies', { n: _companies.length }))}
        <span class="wp-ply-dim">· ${escapeHtml(plyT('wkValue'))} ${escapeHtml(fmtMoney(totV))} · ${escapeHtml(plyT('wkWorkers'))} ${totW}</span></p>
      <div class="wp-ply-tablewrap"><table class="wp-ply-table">
        <thead><tr><th>${escapeHtml(plyT('wkProduct'))}</th><th>${escapeHtml(plyT('wkRegion'))}</th>
          <th class="wp-ply-num">${escapeHtml(plyT('wkWorkers'))}</th><th class="wp-ply-num">${escapeHtml(plyT('wkStock'))}</th>
          <th class="wp-ply-num">${escapeHtml(plyT('wkValue'))}</th><th>${escapeHtml(plyT('wkUpgrades'))}</th></tr></thead>
        <tbody>${_companies.map(c => {
          const r = region(c.region);
          const ups = UPGRADES.filter(k => c.upgrades[k]).map(k => `${plyT(`up_${k}`)} ${c.upgrades[k]}`).join(' · ');
          return `<tr${c.disabled ? ' class="wp-ply-off"' : ''}>
            <td><b>${escapeHtml(c.itemCode || '—')}</b>${c.disabled ? ` <small class="wp-ply-dim">(${escapeHtml(plyT('wkDisabled'))})</small>` : ''}</td>
            <td><span class="wp-ply-who">${r?.country ? flagImg(r.country, 'wp-ply-flag') : ''}<span>${escapeHtml(r?.name || '—')}</span></span></td>
            <td class="wp-ply-num">${c.workers || '—'}</td>
            <td class="wp-ply-num">${escapeHtml(fmtMoney(c.stock))}</td>
            <td class="wp-ply-num">${escapeHtml(fmtMoney(c.value))}</td>
            <td><small class="wp-ply-dim">${escapeHtml(ups || '—')}</small></td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  let work;
  if (_work === undefined || _work === 'loading') work = loading;
  else if (!_work || !_work.length) work = `<p class="wp-ply-note">${escapeHtml(plyT('wkNoStats'))}</p>`;
  else {
    const sum = (k) => _work.reduce((t, r) => t + (r[k] || 0), 0);
    work = `
      <div class="wp-ply-minor wp-ply-minor-big">
        <span>${escapeHtml(plyT('wkTotal31'))} <b>${escapeHtml(fmtFull(Math.round(sum('total'))))}</b> ${escapeHtml(plyT('wkPts'))}</span>
        <span><i class="wp-ply-key wp-ply-w-emp"></i>${escapeHtml(plyT('wkEmp'))} <b>${escapeHtml(fmtCompact(Math.round(sum('employeeProd'))))}</b></span>
        <span><i class="wp-ply-key wp-ply-w-self"></i>${escapeHtml(plyT('wkSelf'))} <b>${escapeHtml(fmtCompact(Math.round(sum('selfWork'))))}</b></span>
        <span><i class="wp-ply-key wp-ply-w-auto"></i>${escapeHtml(plyT('wkAuto'))} <b>${escapeHtml(fmtCompact(Math.round(sum('automatedEngine'))))}</b></span>
        <span>${escapeHtml(plyT('wkWages'))} <b class="wp-ply-gold">${escapeHtml(fmtMoney(sum('wage')))}</b></span>
      </div>
      <div class="wp-ply-wchartwrap">${workChartSvg(_work)}</div>`;
  }

  return `
    ${comp}
    <h3 class="wp-ply-h3">${escapeHtml(plyT('wkChart'))}</h3>
    ${work}
    <p class="wp-ply-note">${escapeHtml(plyT('wkNote'))}</p>`;
}

/* ── Politica ─────────────────────────────────────────────────── */

function politicsHtml() {
  if (_politics === undefined || _politics === 'loading') return `<div class="wp-ply-loading">${escapeHtml(plyT('loading'))}</div>`;
  if (!_politics) return `<p class="wp-ply-note">${escapeHtml(plyT('polError'))}</p>`;
  const { party, roles, presidentOf, history } = _politics;
  const fmtD = (ms) => ms ? fmtDate(new Date(ms).toISOString()) : plyT('polToday');
  const span = (from, to) => `${fmtD(from)} → ${to ? fmtD(to) : plyT('polToday')}`;
  const allRoles = [...roles];
  if (presidentOf && !allRoles.includes('president')) allRoles.unshift('president');

  const partyCard = party ? `
    <div class="wp-ply-polcard">
      ${avatarImg(party.avatarUrl, party.name, 'wp-ply-av wp-ply-av-md')}
      <div><b>${escapeHtml(party.name)}</b>
        <small class="wp-ply-dim">${escapeHtml(plyT(`polRole_${party.role}`))}${party.members != null ? ' · ' + escapeHtml(plyT('polMembers', { n: party.members })) : ''}</small></div>
    </div>` : `<p class="wp-ply-note">${escapeHtml(plyT('polNoParty'))}</p>`;

  const list = (rows, fn) => rows.length
    ? `<ul class="wp-ply-pollist">${rows.map(fn).join('')}</ul>`
    : `<p class="wp-ply-note">${escapeHtml(plyT('polEmpty'))}</p>`;

  let hist;
  if (!history) hist = `<p class="wp-ply-note">${escapeHtml(plyT('polNoHistory'))}</p>`;
  else {
    hist = `
      <h3 class="wp-ply-h3">${escapeHtml(plyT('polPresidencies'))}</h3>
      ${list(history.presidencies, p => `<li><span>${escapeHtml(span(p.from, p.to))}</span>
        <small class="wp-ply-dim">${p.share != null ? escapeHtml(plyT('polVotes', { p: Math.round(p.share * 100) })) : ''}${p.party ? ' · ' + escapeHtml(p.party) : ''}</small></li>`)}
      <h3 class="wp-ply-h3">${escapeHtml(plyT('polTerms'))} ${history.govFrom ? `<small class="wp-ply-dim">${escapeHtml(plyT('polSince', { d: fmtD(history.govFrom) }))}</small>` : ''}</h3>
      ${list(history.terms, t => `<li><span>${escapeHtml(plyT(`role_${t.role}`))}</span><small class="wp-ply-dim">${escapeHtml(span(t.from, t.to))}</small></li>`)}
      <h3 class="wp-ply-h3">${escapeHtml(plyT('polSwitches'))} ${history.switchFrom ? `<small class="wp-ply-dim">${escapeHtml(plyT('polSince', { d: fmtD(history.switchFrom) }))}</small>` : ''}</h3>
      ${list(history.switches, w => `<li><span>${escapeHtml(fmtD(w.at))}</span>
        <small>${escapeHtml(w.from || plyT('polNoPartyShort'))} → ${escapeHtml(w.to || plyT('polNoPartyShort'))}</small></li>`)}
      <p class="wp-ply-note">${escapeHtml(plyT('polNatNote', { c: countryName(_lite?.country) }))}</p>`;
  }

  return `
    <h3 class="wp-ply-h3 wp-ply-h3-first">${escapeHtml(plyT('polParty'))}</h3>
    ${partyCard}
    <h3 class="wp-ply-h3">${escapeHtml(plyT('polNow'))}</h3>
    ${allRoles.length
      ? `<div class="wp-ply-recent">${allRoles.map(r => `<span class="wp-ply-badge wp-ply-badge-role">${escapeHtml(plyT(`role_${r}`))}</span>`).join('')}</div>`
      : `<p class="wp-ply-note">${escapeHtml(plyT('polNone'))}</p>`}
    ${hist}`;
}

export function stopPlayersView() {
  _wealthObs?.disconnect();
}
