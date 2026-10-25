/* ══════════════════════════════════════════════════════════════
   WarEra+ — Tornei
   ------------------------------------------------------------------
   Voce di "Approfondimenti". Richiesta dell'utente: una sezione sul
   torneo, con i tornei delle nazioni e quelli delle unità SEPARATI, la
   grafica del tabellone e dei possibili incontri, e — scelta un'unità —
   i suoi possibili avversari in ordine di difficoltà, dal danno
   settimanale che fanno, in media o in potenziale.

   ── COSA C'È ───────────────────────────────────────────────────────
   · Due schede, Unità militari e Nazioni: ognuna parte dal torneo più
     recente del suo tipo, con un menù per i precedenti.
   · TABELLONE. Il torneo MU ha 9 turni e 457 squadre: intero sarebbe un
     muro di 256 caselle. Si divide come un tabellone vero: una FASE
     FINALE (ultimi quattro turni) e otto SETTORI, ognuno il ramo che
     porta a una delle partite d'apertura della fase finale. Il torneo
     delle nazioni (3 turni, 8 squadre) sta tutto in una vista. Le regole
     stanno in model.js: bracketViews.
   · SQUADRA SCELTA (clic nel tabellone, ricerca, o "La mia unità" da
     `we_my_player`, la stessa chiave di Giocatori ed Economia): il suo
     percorso turno per turno, e per ogni turno futuro chi può incontrare,
     dalla più dura, con una fascia di difficoltà rispetto a lei. Nel
     tabellone il suo cammino si accende e i possibili avversari si
     colorano.
   · Senza squadra scelta, al posto della scheda, le squadre più forti
     ancora in gara.

   ── LA MISURA ──────────────────────────────────────────────────────
   Potenziale e media sono calcolati sui soli ISCRITTI al torneo: vedi
   la testata di model.js, anche per il ⚠️ sulla settimana che riparte.

   ── STRUTTURA ──────────────────────────────────────────────────────
   api.js (dati), model.js (tabellone, percorso, difficoltà, nessun DOM),
   questo file (disegno ed eventi), i18n.js. Il giro di aggiornamento del
   torneo in corso (3 minuti) si ferma alla chiusura dell'overlay, che
   chiama stopTournamentView.
   ══════════════════════════════════════════════════════════════ */

import '../styles/tournament.css';
import { state } from '../diplomacy/state.js';
import { trnT } from './i18n.js';
import { fetchTournamentList, fetchTournament, fetchTeams, fetchWeeklyByUser, fetchLiveScores } from './api.js';
import { buildModel, teamLabel, roundKind, matchState, subtree, bracketViews, viewForTeam, teamPath, difficulty, METRICS } from './model.js';
import { escapeHtml, flagImg, avatarImg, countryName, fmtCompact, fmtFull, fmtDate } from '../mu/ui.js';
import { fetchMuDirectory } from '../mu/api.js';
import { getAllCountries } from '../shared/countries.js';
import { trackEvent } from '../shared/analytics.js';
import { syncBack, updateBackParams } from '../app/backNav.js';

const MINE_KEY = 'we_my_player';
const ID_RE = /^[a-f0-9]{24}$/i;
const REFRESH_MS = 3 * 60 * 1000;
const OPP_PREVIEW = 8;
const POWER_PREVIEW = 20;
const GAME_BATTLE_URL = 'https://app.warera.io/battle/';

let _container = null;
let _type = 'mu';                 // 'mu' | 'country'
const _tid = { mu: null, country: null };   // torneo scelto per tipo
let _list = null;                 // tornei (entrambi i tipi)
let _model = null;
let _loading = false;
let _error = null;
let _teamId = null;
let _metric = 'potential';
let _viewId = null;
let _query = '';
let _expanded = new Set();        // turni con l'elenco avversari aperto per intero
let _powerAll = false;
let _scores = new Map();
let _timer = null;
let _langHandler = null;
let _resizeHandler = null;
let _pending = null;              // { type, team } da un link
let _loadSeq = 0;

// Sorgenti condivise fra i tornei, caricate una volta.
let _weekly;                      // Map | null (undefined = non ancora chiesta)
let _muDir = null;                // Map muId → MU della directory
let _nations = null;              // Map countryId → nazione

/* ── Ingresso ──────────────────────────────────────────────────── */

/** Da un link (?section=tournament&tab=country&team=…): va chiamata PRIMA
 *  di initTournamentView. */
export function openTournamentTeam({ type, team } = {}) {
  _pending = { type: type === 'country' ? 'country' : (type === 'mu' ? 'mu' : null), team: team || null };
}

export async function initTournamentView(container) {
  _container = container;
  if (_pending?.type) _type = _pending.type;
  if (!_langHandler) {
    _langHandler = () => { if (_container) paint(); };
    window.addEventListener('wareraplus:langchange', _langHandler);
  }
  if (!_resizeHandler) {
    let raf = 0;
    _resizeHandler = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(drawConnectors); };
    window.addEventListener('resize', _resizeHandler);
  }
  paint();
  await load();
  startTimer();
  trackEvent('tournament-view-open', { type: _type });
}

export function stopTournamentView() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

function startTimer() {
  stopTournamentView();
  _timer = setInterval(() => {
    if (_model?.status === 'active' && !document.hidden) load({ refresh: true });
  }, REFRESH_MS);
}

/* ── Dati ──────────────────────────────────────────────────────── */

async function load({ refresh = false } = {}) {
  const seq = ++_loadSeq;
  if (!refresh) { _loading = true; _error = null; paint(); }
  // Le sorgenti condivise (classifica settimanale, directory MU, nazioni)
  // non dipendono dal torneo: partono subito, insieme alla lista.
  const sources = ensureSources();
  try {
    _list = await fetchTournamentList();
    const ofType = _list.filter(t => t.type === _type);
    if (!_tid[_type] || !ofType.some(t => t._id === _tid[_type])) _tid[_type] = ofType[0]?._id || null;
    const tid = _tid[_type];
    if (!tid) { _model = null; return; }

    const t = await fetchTournament(tid, { force: refresh });
    const [teams] = await Promise.all([
      fetchTeams(tid, { ended: t.status === 'ended' }),
      sources,
    ]);
    if (seq !== _loadSeq) return;     // l'utente ha cambiato torneo nel frattempo
    _model = buildModel(t, teams, { weekly: _weekly, muDir: _muDir || new Map(), nations: _nations || new Map() });

    if (_pending?.team && _model.teams.has(_pending.team)) _teamId = _pending.team;
    _pending = null;
    if (_teamId && !_model.teams.has(_teamId)) _teamId = null;
    if (!_teamId && !refresh) _teamId = myTeamId();
    if (!refresh || !_viewId) _viewId = _teamId ? viewForTeam(_model, bracketViews(_model), _teamId) : bracketViews(_model)[0]?.id;
  } catch (err) {
    console.warn('WarEra+ tornei:', err);
    if (!refresh) _error = err;
  } finally {
    if (seq === _loadSeq) {
      _loading = false;
      paint({ keepScroll: refresh });
    }
  }
}

async function ensureSources() {
  const jobs = [];
  if (_weekly === undefined) jobs.push(fetchWeeklyByUser().then(m => { _weekly = m; }));
  if (!_nations) {
    jobs.push(getAllCountries().then(list => { _nations = new Map((list || []).map(n => [n._id, n])); })
      .catch(() => { _nations = new Map(); }));
  }
  if (_type === 'mu' && !_muDir) {
    jobs.push(fetchMuDirectory().then(list => { _muDir = new Map(list.map(m => [m._id, m])); })
      .catch(err => { console.warn('WarEra+ tornei: directory MU non disponibile:', err.message); }));
  }
  await Promise.all(jobs);
}

function myPlayerId() {
  try {
    const v = localStorage.getItem(MINE_KEY);
    return v && ID_RE.test(v) ? v : null;
  } catch { return null; }
}

function myTeamId() {
  const me = myPlayerId();
  if (!me || !_model) return null;
  for (const t of _model.teams.values()) if (t.participants.includes(me)) return t.id;
  return null;
}

/* ── Formattazione ─────────────────────────────────────────────── */

const FMT = {
  more: n => trnT('more', { n }),
  teamN: n => trnT('teamN', { n }),
};
const label = team => teamLabel(team, FMT);
const team = id => _model?.teams.get(id) || null;

function roundName(round) {
  const k = roundKind(_model, round);
  return k ? trnT(k) : trnT('roundN', { n: round.n });
}

/** Colori delle squadre come li chiama il gioco: le squadre delle nazioni
 *  sono coalizioni senza nome, il colore è l'unica cosa che le distingue
 *  a colpo d'occhio. */
const TEAM_COLORS = {
  lightGreen: '#8bc34a', lightBlue: '#4fc3f7', gray: '#9e9e9e', orange: '#ff9800', deepPink: '#ec407a',
  cyan: '#26c6da', emerald: '#10b981', sand: '#d6b77a', red: '#ef5350', blue: '#42a5f5', green: '#66bb6a',
  purple: '#ab47bc', yellow: '#fdd835', pink: '#f48fb1', teal: '#26a69a', indigo: '#5c6bc0', brown: '#8d6e63',
  lime: '#d4e157', amber: '#ffca28', violet: '#9575cd', white: '#e0e0e0', black: '#424242',
};

function teamBadge(t, size = 'sm') {
  if (!t) return '';
  if (t.type === 'mu') return avatarImg(t.avatarUrl, t.name || '?', `wp-trn-av wp-trn-av-${size}`);
  const dot = `<span class="wp-trn-dot" style="background:${TEAM_COLORS[t.color] || '#8b949e'}"></span>`;
  const flags = t.entityIds.slice(0, size === 'lg' ? 6 : 2).map(id => flagImg(id, 'wp-trn-flag')).join('');
  return `<span class="wp-trn-flags">${dot}${flags}</span>`;
}

function metricVal(t) { return t ? t[_metric] : 0; }

/* ── Disegno ───────────────────────────────────────────────────── */

function paint({ keepScroll = false } = {}) {
  if (!_container) return;
  const root = _container.closest('#wp-tournament-root') || _container;
  const scrollTop = root.scrollTop;
  const brScroll = _container.querySelector('.wp-trn-bracket-scroll')?.scrollLeft || 0;

  _container.innerHTML = `
    <div class="wp-trn">
      <header class="wp-trn-head">
        <h1 class="wp-trn-title">${trnT('title')}</h1>
        <p class="wp-trn-sub">${trnT('subtitle')}</p>
      </header>
      <nav class="wp-trn-tabs" role="tablist">
        ${[['mu', 'tabMu'], ['country', 'tabCountry']].map(([id, k]) => `
          <button type="button" role="tab" class="wp-trn-tab${_type === id ? ' active' : ''}" data-type="${id}" aria-selected="${_type === id}">${trnT(k)}</button>`).join('')}
      </nav>
      <div class="wp-trn-body">${bodyHtml()}</div>
    </div>`;
  wire();
  syncUrlState();

  if (keepScroll) {
    root.scrollTop = scrollTop;
    const sc = _container.querySelector('.wp-trn-bracket-scroll');
    if (sc) sc.scrollLeft = brScroll;
  }
  requestAnimationFrame(drawConnectors);
  refreshScores();
}

function bodyHtml() {
  if (_loading && !_model) return `<div class="wp-trn-loading">${trnT('loading')}</div>`;
  if (_error && !_model) {
    return `<div class="wp-trn-empty">${trnT('error')} <button type="button" class="wp-trn-btn" data-act="retry">${trnT('retry')}</button></div>`;
  }
  if (!_model) return `<div class="wp-trn-empty">${trnT('none')}</div>`;
  if (_loading) return `<div class="wp-trn-loading">${trnT('loading')}</div>`;

  const notices = [];
  if (!_model.weeklyOk) notices.push(`<p class="wp-trn-notice warn">${trnT('weeklyMissing')}</p>`);
  else notices.push(`<p class="wp-trn-notice">${trnT('weeklyNote')}</p>`);
  // Torneo concluso: la classifica settimanale è quella di OGGI, non di
  // quando si è giocato. Il danno nel torneo invece è quello vero.
  if (_model.status === 'ended') notices.push(`<p class="wp-trn-notice warn">${trnT('endedNote')}</p>`);

  if (!_model.levels.length) {
    return `${metaHtml()}<p class="wp-trn-notice">${trnT('upcomingNote')} · ${trnT('registeredN', { n: _model.registeredCount })}</p>`;
  }

  return `
    ${metaHtml()}
    ${notices.join('')}
    ${toolbarHtml()}
    <div class="wp-trn-grid">
      <section class="wp-trn-bracket-wrap">${bracketHtml()}</section>
      <aside class="wp-trn-side">${_teamId ? teamCardHtml(team(_teamId)) : powerHtml()}</aside>
    </div>`;
}

function metaHtml() {
  const m = _model;
  const ofType = (_list || []).filter(t => t.type === _type);
  const st = { active: 'stActive', ended: 'stEnded', upcoming: 'stUpcoming' }[m.status] || 'stEnded';
  const chips = [
    `<span class="wp-trn-chip st-${escapeHtml(m.status)}">${m.status === 'active' ? '<span class="wp-trn-livedot"></span>' : ''}${trnT(st)}</span>`,
  ];
  if (m.status === 'active' && m.activeRound) chips.push(`<span class="wp-trn-chip">${trnT('roundOf', { n: m.activeRound, m: m.roundsCount })}</span>`);
  if (m.teams.size) chips.push(`<span class="wp-trn-chip">${trnT('teamsN', { n: m.teams.size })}</span>`);
  if (m.maxRarity) chips.push(`<span class="wp-trn-chip">${trnT('rarityCap', { r: trnT(`r_${m.maxRarity}`) })}</span>`);
  if (m.winner && team(m.winner)) {
    chips.push(`<button type="button" class="wp-trn-chip wp-trn-chip-win" data-team="${escapeHtml(m.winner)}">🏆 ${escapeHtml(label(team(m.winner)))}</button>`);
  }
  return `
    <div class="wp-trn-meta">
      <select class="wp-trn-select" aria-label="${escapeHtml(trnT('title'))}">
        ${ofType.map(t => `<option value="${escapeHtml(t._id)}"${t._id === m.id ? ' selected' : ''}>${escapeHtml(t.name || '')} · ${escapeHtml(fmtDate(t.startAt))}</option>`).join('')}
      </select>
      ${chips.join('')}
    </div>`;
}

function toolbarHtml() {
  const mine = myTeamId();
  return `
    <div class="wp-trn-toolbar">
      <div class="wp-trn-search-wrap">
        <input type="search" class="wp-trn-search" placeholder="${escapeHtml(trnT(_type === 'mu' ? 'searchMu' : 'searchCountry'))}" value="${escapeHtml(_query)}" autocomplete="off">
        <div class="wp-trn-results" hidden></div>
      </div>
      ${mine ? `<button type="button" class="wp-trn-btn${mine === _teamId ? ' active' : ''}" data-team="${escapeHtml(mine)}">${trnT(_type === 'mu' ? 'myMu' : 'myCountry')}</button>` : ''}
      <div class="wp-trn-seg" role="group" aria-label="${escapeHtml(trnT('metric'))}">
        <span class="wp-trn-lbl">${trnT('metric')}</span>
        ${METRICS.map(k => {
          const key = k === 'potential' ? 'mPotential' : 'mAverage';
          return `<button type="button" class="wp-trn-segbtn${_metric === k ? ' active' : ''}" data-metric="${k}" title="${escapeHtml(trnT(`${key}Tip`))}">${trnT(key)}</button>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── Tabellone ─────────────────────────────────────────────────── */

function bracketHtml() {
  const views = bracketViews(_model);
  let view = views.find(v => v.id === _viewId) || views[0];
  _viewId = view.id;
  const myView = _teamId ? viewForTeam(_model, views, _teamId) : null;

  const chips = views.length > 1 ? `
    <div class="wp-trn-views">
      ${views.map(v => `<button type="button" class="wp-trn-vchip${v.id === view.id ? ' active' : ''}${v.id === myView ? ' mine' : ''}" data-view="${v.id}">${v.id === 'final' ? trnT('finalPhase') : trnT('sector', { n: v.sector })}</button>`).join('')}
    </div>` : '';

  const cols = subtree(_model, view.L, view.idx, view.depth);
  const firstL = view.L - cols.length + 1;
  const path = _teamId ? new Set(teamPath(_model, _teamId).filter(s => s.certain).map(s => `${s.round.n}:${s.match.idx}`)) : new Set();
  const oppSet = _teamId ? opponentSet(_teamId) : new Set();

  const colsHtml = cols.map((col, c) => {
    const round = _model.levels[firstL + c];
    return `
      <div class="wp-trn-col">
        <div class="wp-trn-colhead">${escapeHtml(roundName(round))}</div>
        <div class="wp-trn-cells">
          ${col.map((m, j) => `<div class="wp-trn-cell">${m ? matchHtml(m, round, c, j, path, oppSet) : ''}</div>`).join('')}
        </div>
      </div>`;
  }).join('');

  return `
    <div class="wp-trn-sechead">
      <h2 class="wp-trn-h2">${trnT('bracket')}</h2>
      ${chips}
    </div>
    <div class="wp-trn-bracket-scroll">
      <div class="wp-trn-bracket${cols.length <= 3 ? ' wide' : ''}" style="--wp-trn-rows:${cols[0]?.length || 1}">
        <svg class="wp-trn-lines" aria-hidden="true"></svg>
        ${colsHtml}
      </div>
    </div>`;
}

/** Tutti i possibili avversari della squadra scelta, in ogni turno. */
function opponentSet(teamId) {
  const s = new Set();
  for (const step of teamPath(_model, teamId)) step.opponents.forEach(id => s.add(id));
  return s;
}

function matchHtml(m, round, c, j, path, oppSet) {
  const st = matchState(m);
  const hot = path.has(`${round.n}:${m.idx}`);
  const link = m.battle ? `<a class="wp-trn-blink" href="${GAME_BATTLE_URL}${escapeHtml(m.battle)}" target="_blank" rel="noopener" title="${escapeHtml(trnT('openBattle'))}">↗</a>` : '';
  const live = st === 'live' ? `<span class="wp-trn-mlive"><span class="wp-trn-livedot"></span>${trnT('live')}</span>` : '';
  return `
    <div class="wp-trn-match st-${st}${hot ? ' hot' : ''}" data-c="${c}" data-j="${j}" data-battle="${escapeHtml(m.battle || '')}">
      ${live || link ? `<div class="wp-trn-mhead">${live}${link}</div>` : ''}
      ${slotHtml(m, 'a', round, oppSet)}
      ${slotHtml(m, 'd', round, oppSet)}
    </div>`;
}

function slotHtml(m, side, round, oppSet) {
  const id = m[side] || (m[`p${side}`].length === 1 ? m[`p${side}`][0] : null);
  const poss = m[`p${side}`];
  const sideKey = side === 'a' ? 'attacker' : 'defender';
  const result = m.wonBy ? (m.wonBy === sideKey ? ' won' : ' lost') : '';
  const score = m.battle && !m.wonBy ? `<span class="wp-trn-sc" data-side="${side}"></span>` : '';

  // Da dove arriva il posto al primo livello: qualificazione o d'ufficio.
  let origin = '';
  if (round === _model.levels[0] && _model.qual && id) {
    origin = _model.autoQualified.has(id) ? '' : `<span class="wp-trn-q" title="${escapeHtml(trnT('fromQual'))}">Q</span>`;
  }

  if (id) {
    const t = team(id);
    const cls = `${result}${id === _teamId ? ' me' : ''}${oppSet.has(id) ? ' opp' : ''}`;
    return `
      <button type="button" class="wp-trn-slot${cls}" data-team="${escapeHtml(id)}" title="${escapeHtml(label(t))}">
        ${teamBadge(t)}${origin}
        <span class="wp-trn-sname">${escapeHtml(label(t))}</span>
        ${score || `<span class="wp-trn-sval">${escapeHtml(fmtCompact(metricVal(t)))}</span>`}
      </button>`;
  }
  if (!poss.length) return `<div class="wp-trn-slot empty"><span class="wp-trn-sname">${trnT('tbd')}</span></div>`;

  const fav = poss.map(team).filter(Boolean).sort((x, y) => metricVal(y) - metricVal(x))[0];
  const meIn = poss.includes(_teamId);
  const anyOpp = poss.some(x => oppSet.has(x));
  return `
    <div class="wp-trn-slot poss${meIn ? ' me-poss' : ''}${anyOpp && !meIn ? ' opp-poss' : ''}">
      <span class="wp-trn-pn">${trnT('possibleN', { n: poss.length })}</span>
      ${fav ? `<button type="button" class="wp-trn-fav" data-team="${escapeHtml(fav.id)}">${escapeHtml(trnT('favourite', { name: label(fav) }))}</button>` : ''}
    </div>`;
}

/** Linee fra le partite, disegnate DOPO il layout (le altezze dipendono
 *  dal contenuto). La partita j della colonna c riceve le partite 2j e
 *  2j+1 della colonna prima: è l'ordine in cui le mette subtree(). */
function drawConnectors() {
  const br = _container?.querySelector('.wp-trn-bracket');
  const svg = br?.querySelector('.wp-trn-lines');
  if (!br || !svg) return;
  const base = br.getBoundingClientRect();
  svg.setAttribute('width', br.scrollWidth);
  svg.setAttribute('height', br.scrollHeight);
  const boxes = new Map();
  br.querySelectorAll('.wp-trn-match').forEach(el => boxes.set(`${el.dataset.c}:${el.dataset.j}`, el));
  const paths = [];
  boxes.forEach((el, key) => {
    const [c, j] = key.split(':').map(Number);
    if (c === 0) return;
    const r = el.getBoundingClientRect();
    const x2 = r.left - base.left;
    const y2 = r.top - base.top + r.height / 2;
    for (const k of [2 * j, 2 * j + 1]) {
      const child = boxes.get(`${c - 1}:${k}`);
      if (!child) continue;
      const cr = child.getBoundingClientRect();
      const x1 = cr.right - base.left;
      const y1 = cr.top - base.top + cr.height / 2;
      const xm = x1 + (x2 - x1) / 2;
      const hot = child.classList.contains('hot') && el.classList.contains('hot');
      paths.push(`<path class="${hot ? 'hot' : ''}" d="M${x1} ${y1}H${xm}V${y2}H${x2}"/>`);
    }
  });
  svg.innerHTML = paths.join('');
}

/** Punteggi delle partite in corso visibili (e di quella della squadra
 *  scelta): una richiesta a gruppi, poi si scrivono nelle caselle senza
 *  ridisegnare il resto. */
async function refreshScores() {
  if (!_container || !_model || _model.status !== 'active') return;
  const ids = new Set([..._container.querySelectorAll('.wp-trn-match.st-live')].map(el => el.dataset.battle).filter(Boolean));
  if (_teamId) for (const s of teamPath(_model, _teamId)) if (s.state === 'live' && s.match.battle) ids.add(s.match.battle);
  if (!ids.size) return;
  const got = await fetchLiveScores([...ids]);
  got.forEach((v, k) => _scores.set(k, v));
  if (!_container) return;
  _container.querySelectorAll('.wp-trn-match.st-live').forEach(el => {
    const s = _scores.get(el.dataset.battle);
    if (!s) return;
    el.querySelectorAll('.wp-trn-sc').forEach(sp => {
      const mine = sp.dataset.side === 'a' ? s.a : s.d;
      const theirs = sp.dataset.side === 'a' ? s.d : s.a;
      sp.textContent = String(mine);
      sp.classList.toggle('lead', mine > theirs);
    });
    const head = el.querySelector('.wp-trn-mlive');
    if (head && s.toWin) head.title = trnT('bestOf', { n: s.toWin });
  });
  _container.querySelectorAll('[data-score-for]').forEach(el => {
    const s = _scores.get(el.dataset.scoreFor);
    if (!s) return;
    const mine = el.dataset.side === 'a' ? s.a : s.d;
    const theirs = el.dataset.side === 'a' ? s.d : s.a;
    el.textContent = `${mine}–${theirs}${s.toWin ? ` · ${trnT('bestOf', { n: s.toWin })}` : ''}`;
  });
}

/* ── Scheda della squadra ──────────────────────────────────────── */

function statusLine(t, path) {
  if (t.status === 'winner') return `<span class="wp-trn-pill win">🏆 ${trnT('winner')}</span>`;
  const last = path[path.length - 1];
  if (t.status === 'eliminated' || last?.result === 'lost') {
    const r = last?.round ? roundName(last.round) : '';
    return `<span class="wp-trn-pill out">${trnT('eliminatedIn', { round: escapeHtml(r) })}</span>`;
  }
  return `<span class="wp-trn-pill in">${trnT('alive')}</span>`;
}

function teamCardHtml(t) {
  if (!t) return powerHtml();
  const path = teamPath(_model, t.id);
  const n = _model.aliveCount;
  const rankP = t.rank.potential ? `<span class="wp-trn-rank">${trnT('rankOf', { n: t.rank.potential, m: n })}</span>` : '';
  const rankA = t.rank.average ? `<span class="wp-trn-rank">${trnT('rankOf', { n: t.rank.average, m: n })}</span>` : '';
  const extra = t.type === 'mu'
    ? stat(trnT('statMuWeekly'), fmtCompact(t.entityWeekly))
    : stat(trnT('statNatWeekly'), fmtCompact(t.entityWeekly), trnT('nationsN', { n: t.entityIds.length }));
  const nations = t.type === 'country' && t.entityIds.length > 1
    ? `<div class="wp-trn-natlist">${t.entityIds.map(id => `<span class="wp-trn-nat">${flagImg(id, 'wp-trn-flag')}${escapeHtml(countryName(id))}</span>`).join('')}</div>`
    : '';

  return `
    <div class="wp-trn-card">
      <div class="wp-trn-cardhead">
        ${teamBadge(t, 'lg')}
        <div class="wp-trn-cardtitle">
          <div class="wp-trn-cardname">${escapeHtml(label(t))}</div>
          <div class="wp-trn-cardsub">${statusLine(t, path)}${t.type === 'mu' && t.homeCountry ? `<span class="wp-trn-home">${flagImg(t.homeCountry, 'wp-trn-flag')}${escapeHtml(countryName(t.homeCountry))}</span>` : ''}</div>
        </div>
        <button type="button" class="wp-trn-x" data-act="clear" title="${escapeHtml(trnT('clear'))}" aria-label="${escapeHtml(trnT('clear'))}">✕</button>
      </div>
      ${nations}
      <div class="wp-trn-stats">
        ${stat(trnT('statPotential'), fmtCompact(t.potential), rankP, _metric === 'potential')}
        ${stat(trnT('statAverage'), fmtCompact(t.average), rankA, _metric === 'average')}
        ${stat(trnT('statRoster'), fmtFull(t.roster), trnT('fightersOf', { n: t.fighters, m: t.roster }))}
        ${stat(trnT('statTour'), fmtCompact(t.tourDamage))}
        ${extra}
      </div>
      <h3 class="wp-trn-h3">${trnT('path')}</h3>
      <ol class="wp-trn-path">
        ${_model.qual && _model.autoQualified.has(t.id) ? `<li class="wp-trn-step done"><span class="wp-trn-stepr">${escapeHtml(roundName(_model.qual))}</span><span class="wp-trn-stept">${trnT('directQual')}</span></li>` : ''}
        ${path.map(s => stepHtml(t, s)).join('')}
      </ol>
    </div>`;
}

function stat(lbl, val, note = '', active = false) {
  return `
    <div class="wp-trn-stat${active ? ' active' : ''}">
      <div class="wp-trn-statl">${escapeHtml(lbl)}</div>
      <div class="wp-trn-statv">${escapeHtml(val)}</div>
      ${note ? `<div class="wp-trn-statn">${note}</div>` : ''}
    </div>`;
}

function teamLink(id) {
  const t = team(id);
  if (!t) return escapeHtml(trnT('tbd'));
  return `<button type="button" class="wp-trn-tlink" data-team="${escapeHtml(id)}">${escapeHtml(label(t))}</button>`;
}

function stepHtml(me, s) {
  const rn = `<span class="wp-trn-stepr">${escapeHtml(roundName(s.round))}</span>`;
  if (s.state === 'done' && s.result) {
    const txt = trnT(s.result === 'won' ? 'beat' : 'lostTo', { name: teamLink(s.opp) });
    return `<li class="wp-trn-step done ${s.result}">${rn}<span class="wp-trn-stept">${txt}</span>${diffPill(team(s.opp), me)}</li>`;
  }
  if (s.state === 'live' && s.opp && s.certain) {
    const score = s.match.battle ? `<span class="wp-trn-stepsc" data-score-for="${escapeHtml(s.match.battle)}" data-side="${s.side}"></span>` : '';
    return `<li class="wp-trn-step live">${rn}<span class="wp-trn-stept"><span class="wp-trn-livedot"></span>${trnT('playing', { name: teamLink(s.opp) })} ${score}</span>${diffPill(team(s.opp), me)}</li>`;
  }
  if (s.opponents.length === 1 && s.certain) {
    return `<li class="wp-trn-step next">${rn}<span class="wp-trn-stept">${trnT('willPlay', { name: teamLink(s.opponents[0]) })}</span>${diffPill(team(s.opponents[0]), me)}</li>`;
  }
  return `<li class="wp-trn-step future">${rn}<span class="wp-trn-stept">${trnT('nOpp', { n: s.opponents.length })}${s.certain ? '' : ` <em>(${trnT('ifWins')})</em>`}</span>${oppListHtml(me, s)}</li>`;
}

function diffPill(opp, me) {
  if (!opp) return '';
  const d = difficulty(opp, me, _metric);
  return `<span class="wp-trn-diff d-${d}" title="${escapeHtml(trnT('vsYou'))}">${trnT(`d_${d}`)}</span>`;
}

/** Elenco dei possibili avversari di un turno, dal più forte. La barra è
 *  sulla misura scelta, in scala col più forte dell'elenco (o con la
 *  squadra stessa, se è lei la più forte); la tacca segna la squadra. */
function oppListHtml(me, s) {
  const opps = s.opponents.map(team).filter(Boolean).sort((x, y) => metricVal(y) - metricVal(x));
  const max = Math.max(metricVal(me), ...opps.map(metricVal), 1);
  const open = _expanded.has(s.round.n);
  const shown = open ? opps : opps.slice(0, OPP_PREVIEW);
  const mark = (metricVal(me) / max) * 100;
  return `
    <div class="wp-trn-opps">
      ${shown.map((o, i) => `
        <button type="button" class="wp-trn-opp" data-team="${escapeHtml(o.id)}">
          <span class="wp-trn-oppi">${i + 1}</span>
          ${teamBadge(o)}
          <span class="wp-trn-oppn">${escapeHtml(label(o))}</span>
          <span class="wp-trn-oppbar"><span style="width:${(metricVal(o) / max) * 100}%"></span><i style="left:${mark}%"></i></span>
          <span class="wp-trn-oppv">${escapeHtml(fmtCompact(metricVal(o)))}</span>
          ${diffPill(o, me)}
        </button>`).join('')}
      ${opps.length > OPP_PREVIEW ? `<button type="button" class="wp-trn-more" data-expand="${s.round.n}">${open ? trnT('showLess') : trnT('showAll', { n: opps.length })}</button>` : ''}
    </div>`;
}

/* ── Classifica di forza (nessuna squadra scelta) ─────────────── */

function powerHtml() {
  const pool = [..._model.teams.values()].filter(t => _model.status === 'ended' || t.status !== 'eliminated')
    .sort((x, y) => metricVal(y) - metricVal(x));
  const shown = _powerAll ? pool : pool.slice(0, POWER_PREVIEW);
  const max = Math.max(metricVal(pool[0]), 1);
  return `
    <div class="wp-trn-card">
      <p class="wp-trn-hint">${trnT('pickHint')}</p>
      <h3 class="wp-trn-h3">${trnT(_model.status === 'ended' ? 'powerAll' : 'powerAlive')}</h3>
      <div class="wp-trn-opps">
        ${shown.map((t, i) => `
          <button type="button" class="wp-trn-opp${t.status === 'winner' ? ' win' : ''}" data-team="${escapeHtml(t.id)}">
            <span class="wp-trn-oppi">${i + 1}</span>
            ${teamBadge(t)}
            <span class="wp-trn-oppn">${t.status === 'winner' ? '🏆 ' : ''}${escapeHtml(label(t))}</span>
            <span class="wp-trn-oppbar"><span style="width:${(metricVal(t) / max) * 100}%"></span></span>
            <span class="wp-trn-oppv">${escapeHtml(fmtCompact(metricVal(t)))}</span>
          </button>`).join('')}
        ${pool.length > POWER_PREVIEW ? `<button type="button" class="wp-trn-more" data-act="power-all">${_powerAll ? trnT('showLess') : trnT('showAll', { n: pool.length })}</button>` : ''}
      </div>
    </div>`;
}

/* ── Ricerca ───────────────────────────────────────────────────── */

function searchTeams(q) {
  const s = q.trim().toLowerCase();
  if (s.length < 2 || !_model) return [];
  const out = [];
  for (const t of _model.teams.values()) {
    const names = [label(t), ...(t.type === 'country' ? t.entityIds.map(countryName) : [])];
    if (names.some(n => n.toLowerCase().includes(s))) out.push(t);
  }
  return out.sort((x, y) => metricVal(y) - metricVal(x)).slice(0, 8);
}

function paintResults(box, q) {
  const res = searchTeams(q);
  if (q.trim().length < 2) { box.hidden = true; return; }
  box.innerHTML = res.length
    ? res.map(t => `<button type="button" class="wp-trn-res" data-team="${escapeHtml(t.id)}">${teamBadge(t)}<span>${escapeHtml(label(t))}</span><em>${escapeHtml(fmtCompact(metricVal(t)))}</em></button>`).join('')
    : `<div class="wp-trn-res none">${trnT('noMatch')}</div>`;
  box.hidden = false;
}

/* ── Eventi ────────────────────────────────────────────────────── */

function selectTeam(id) {
  if (!_model?.teams.has(id)) return;
  _teamId = id;
  _query = '';
  _expanded = new Set();
  _viewId = viewForTeam(_model, bracketViews(_model), id);
  paint({ keepScroll: true });
  trackEvent('tournament-pick-team', { type: _type });
  // Su telefono la scheda sta sotto il tabellone: la si porta in vista.
  if (window.matchMedia('(max-width: 1099px)').matches) {
    _container.querySelector('.wp-trn-side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function clearTeam() {
  _teamId = null;
  _expanded = new Set();
  paint({ keepScroll: true });
}

function wire() {
  const c = _container;
  c.querySelectorAll('.wp-trn-tab').forEach(btn => btn.addEventListener('click', () => {
    if (btn.dataset.type === _type) return;
    _type = btn.dataset.type;
    _teamId = null; _model = null; _query = ''; _viewId = null; _powerAll = false;
    load();
  }));
  c.querySelector('.wp-trn-select')?.addEventListener('change', (e) => {
    _tid[_type] = e.target.value;
    _teamId = null; _viewId = null; _powerAll = false;
    load();
  });
  c.querySelectorAll('[data-metric]').forEach(btn => btn.addEventListener('click', () => {
    _metric = btn.dataset.metric;
    paint({ keepScroll: true });
  }));
  c.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    _viewId = btn.dataset.view;
    paint({ keepScroll: true });
  }));
  c.querySelectorAll('[data-expand]').forEach(btn => btn.addEventListener('click', () => {
    const n = Number(btn.dataset.expand);
    if (_expanded.has(n)) _expanded.delete(n); else _expanded.add(n);
    paint({ keepScroll: true });
  }));
  c.querySelector('[data-act="power-all"]')?.addEventListener('click', () => { _powerAll = !_powerAll; paint({ keepScroll: true }); });
  c.querySelector('[data-act="clear"]')?.addEventListener('click', clearTeam);
  c.querySelector('[data-act="retry"]')?.addEventListener('click', () => load());

  // Un solo ascoltatore per tutti i [data-team] (caselle, elenchi, link).
  c.querySelector('.wp-trn-body')?.addEventListener('click', (e) => {
    const el = e.target.closest('[data-team]');
    if (!el || el.closest('.wp-trn-results')) return;
    e.preventDefault();
    selectTeam(el.dataset.team);
  });

  const input = c.querySelector('.wp-trn-search');
  const box = c.querySelector('.wp-trn-results');
  if (input && box) {
    input.addEventListener('input', () => { _query = input.value; paintResults(box, _query); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { const first = searchTeams(input.value)[0]; if (first) selectTeam(first.id); }
      if (e.key === 'Escape') { box.hidden = true; }
    });
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
    box.addEventListener('mousedown', (e) => {
      const el = e.target.closest('[data-team]');
      if (el) { e.preventDefault(); selectTeam(el.dataset.team); }
    });
  }
}

/** Link condivisibile: scheda (tipo) e squadra scelta. Indietro con una
 *  squadra aperta torna alla classifica invece di chiudere la sezione. */
function syncUrlState() {
  updateBackParams('tournament', { tab: _type === 'country' ? 'country' : undefined });
  syncBack('tournament/team', !!_teamId, clearTeam, () => !!_teamId, { team: _teamId || undefined });
}
