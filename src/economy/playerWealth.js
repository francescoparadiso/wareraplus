/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: la scheda RICCHEZZA (di un giocatore)
   ------------------------------------------------------------------
   «Come sta andando la mia situazione?». Il gioco mostra la ricchezza
   di ADESSO e nient'altro: nessuna procedura dice quanto aveva un
   giocatore ieri. Il VPS invece fotografa ogni notte la classifica
   Ricchezza intera (~17.000 giocatori, dal 19 giugno 2026 grazie
   all'import), e questa scheda rilegge quella fotografia giocatore per
   giocatore: la curva, i giorni migliori e peggiori, la posizione.

   ── DUE FONTI, E QUALE MANCA ───────────────────────────────────────
   · ADESSO: `user.getUserLite` (pubblica, api6) porta
     `rankings.userWealth` con valore e posizione. Funziona sempre.
   · LO STORICO: `/player-wealth` sul cache-server, che lo chiede
     all'area riservata sulla loopback. Senza server la scheda mostra il
     valore di adesso e lo dichiara — non c'è un ripiego, perché lo
     storico non esiste da nessun'altra parte.
   La ricerca per nome è `search.searchUsers` (pubblica) + un batch di
   `getUserLite` per i candidati: due richieste, mai una per nome.

   ── ⚠️ COS'È IL NUMERO ─────────────────────────────────────────────
   Il valore della classifica Ricchezza del gioco. La differenza fra due
   giorni è il SALDO NETTO: non dice cosa si è guadagnato e cosa si è
   speso (stessa avvertenza del Bilancio unità, server/plusApi/wealth.js).
   La scheda lo scrive, invece di chiamare "spese" un calo.

   "Sono io" salva solo l'id del giocatore in questo browser
   (`we_my_player`), per riaprire la scheda sul proprio personaggio.
   Nessun collegamento all'account, nessun dato inviato.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, countryName, flagImg, avatarImg, fmtCompact, fmtFull } from '../mu/ui.js';
import { trpcBatchManual } from '../shared/trpcClient.js';
import { fetchPlayerWealthViaCache } from '../diplomacy/cacheClient.js';
import { candleChartSvg, attachCandleExplorer } from './candleChart.js';
import { plusT } from './i18nPlus.js';
import { ecoT } from './i18n.js';

const MIO_KEY = 'we_my_player';
const MAX_CANDIDATI = 8;
const RANGES = [{ g: 30, key: 'r30' }, { g: 90, key: 'r90' }, { g: 0, key: 'rAll' }];

let _container = null;
let _cerca = '';
let _cercando = false;
let _candidati = null;     // [{ id, lite }] dell'ultima ricerca, null = nessuna
let _player = null;        // { id, lite, hist, histFailed }
let _loading = false;
let _giorni = 90;
let _finestra = null;
let _resizeObs = null;

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } }

function lingua() {
  return (localStorage.getItem('we_lang') || navigator.language || 'it').slice(0, 2);
}
function fmtDay(g) {
  return new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${g}T12:00:00Z`));
}
const oro = (v) => (v == null || !Number.isFinite(v) ? '—' : fmtCompact(v));
function deltaHtml(abs, pct) {
  if (abs == null || !Number.isFinite(abs)) return '<span class="wp-ecn-dim">—</span>';
  const cls = abs > 0 ? 'wp-ecn-up' : abs < 0 ? 'wp-ecn-down' : 'wp-ecn-flat';
  const segno = abs > 0 ? '+' : abs < 0 ? '−' : '';
  const p = pct != null && Number.isFinite(pct)
    ? ` <small>(${segno}${escapeHtml(new Intl.NumberFormat(lingua(), { maximumFractionDigits: 1 }).format(Math.abs(pct)))}%)</small>` : '';
  return `<span class="wp-ecn-delta ${cls}">${segno}${escapeHtml(oroIntero(Math.abs(abs)))}${p}</span>`;
}
// Le differenze in oro intero: "+3.129" e non "+3129,1". Sopra i diecimila
// la forma compatta ("+18k"), che in una colonna di variazioni basta.
function oroIntero(v) {
  return Math.abs(v) >= 1e4 ? fmtCompact(v) : fmtFull(Math.round(v));
}

const dayNum = (g) => Math.round(Date.parse(`${g}T12:00:00Z`) / 86400000);

/** Variazione fra l'ultimo scatto e quello di `giorni` fa (o il primo
 *  dopo, se quel giorno è un buco). `giorni = 0` = dall'inizio. */
function variazione(days, giorni) {
  if (!days || days.length < 2) return null;
  const ultimo = days[days.length - 1];
  const bersaglio = giorni ? dayNum(ultimo[0]) - giorni : -Infinity;
  const prima = days.find(r => dayNum(r[0]) >= bersaglio);
  if (!prima || prima === ultimo) return null;
  const abs = ultimo[1] - prima[1];
  return { abs, pct: prima[1] ? (abs / Math.abs(prima[1])) * 100 : null, da: prima[0] };
}

/** Le differenze fra due scatti CONSECUTIVI di calendario. Quelle a
 *  cavallo di un buco coprono più giorni e non sono "un giorno": fuori. */
function giornate(days) {
  const out = [];
  for (let i = 1; i < days.length; i++) {
    if (dayNum(days[i][0]) - dayNum(days[i - 1][0]) !== 1) continue;
    out.push({ g: days[i][0], d: days[i][1] - days[i - 1][1] });
  }
  return out;
}

// ── Caricamento ────────────────────────────────────────────────────
async function cerca(testo) {
  const q = testo.trim();
  if (q.length < 2) return;
  _cercando = true;
  _candidati = null;
  paint();
  try {
    const [ids] = await trpcBatchManual([['search.searchUsers', { searchText: q }]]);
    const lista = (Array.isArray(ids) ? ids : []).slice(0, MAX_CANDIDATI);
    const lite = lista.length ? await trpcBatchManual(lista.map(id => ['user.getUserLite', { userId: id }])) : [];
    _candidati = lista.map((id, i) => ({ id, lite: lite[i] })).filter(c => c.lite);
  } catch (err) {
    console.warn('[economia/ricchezza] ricerca fallita:', err.message);
    _candidati = [];
  } finally {
    _cercando = false;
  }
  // Un nome solo trovato: niente elenco da cui scegliere.
  if (_candidati.length === 1) { apriGiocatore(_candidati[0].id, _candidati[0].lite); return; }
  paint();
}

async function apriGiocatore(id, liteNota = null) {
  _candidati = null;
  _loading = true;
  _player = { id, lite: liteNota, hist: null, histFailed: false };
  paint();
  const [lite, hist] = await Promise.all([
    liteNota ? Promise.resolve(liteNota)
      : trpcBatchManual([['user.getUserLite', { userId: id }]]).then(r => r[0]).catch(() => null),
    fetchPlayerWealthViaCache(id),
  ]);
  if (_player?.id !== id) return;   // nel frattempo ne è stato scelto un altro
  _player = { id, lite, hist, histFailed: !hist };
  _loading = false;
  paint();
}

// ── Disegno ────────────────────────────────────────────────────────
function candidatiHtml() {
  if (_cercando) return `<div class="wp-ecn-loading">${escapeHtml(plusT('wlSearching'))}</div>`;
  if (!_candidati) return '';
  if (!_candidati.length) return `<p class="wp-ecn-note">${escapeHtml(plusT('wlNoResults'))}</p>`;
  return `
    <p class="wp-ecn-dim">${escapeHtml(plusT('wlPick'))}</p>
    <div class="wp-ecn-wcands">${_candidati.map(({ id, lite }) => `
      <button type="button" class="wp-ecn-wcand" data-player="${escapeHtml(id)}">
        ${avatarImg(lite.avatarUrl, lite.username, 'wp-ecn-wavatar')}
        <span class="wp-ecn-wcname">${escapeHtml(lite.username)}
          <small>${flagImg(lite.country, 'wp-ecn-flag')} ${escapeHtml(countryName(lite.country))} · lv ${escapeHtml(lite.leveling?.level ?? '—')}</small></span>
        <span class="wp-ecn-num">${escapeHtml(oro(lite.rankings?.userWealth?.value))}</span>
      </button>`).join('')}
    </div>`;
}

function giocatoreHtml() {
  _finestra = null;
  const p = _player;
  if (!p) return '';
  if (_loading && !p.lite) return `<div class="wp-ecn-loading">${escapeHtml(plusT('wlLoading'))}</div>`;

  const lite = p.lite || {};
  const ora = lite.rankings?.userWealth || null;
  const days = p.hist?.days || [];
  const ultimo = days[days.length - 1] || null;
  const mio = safeGet(MIO_KEY) === p.id;

  const v1 = variazione(days, 1), v7 = variazione(days, 7), v30 = variazione(days, 30), vAll = variazione(days, 0);
  const dalloScatto = ora && ultimo ? ora.value - ultimo[1] : null;

  const dal = _giorni && ultimo ? dayNum(ultimo[0]) - _giorni : -Infinity;
  const finestra = days.filter(r => dayNum(r[0]) >= dal).map(([g, v]) => [g, v, v, v, v, null]);
  if (finestra.length > 1) _finestra = finestra;

  const gg = giornate(days);
  const migliori = [...gg].sort((a, b) => b.d - a.d).filter(x => x.d > 0).slice(0, 5);
  const peggiori = [...gg].sort((a, b) => a.d - b.d).filter(x => x.d < 0).slice(0, 5);
  const listaGiorni = (arr) => arr.length ? arr.map(x => `
      <li><span>${escapeHtml(fmtDay(x.g))}</span>${deltaHtml(x.d)}</li>`).join('') : `<li class="wp-ecn-dim">${escapeHtml(plusT('none'))}</li>`;

  const rank = p.hist?.rank, prima = p.hist?.rankBefore;

  let storico;
  if (_loading) storico = `<div class="wp-ecn-loading">${escapeHtml(plusT('wlLoading'))}</div>`;
  else if (p.histFailed) storico = `<p class="wp-ecn-note">${escapeHtml(plusT('wlNoHistory'))}</p>`;
  else if (!days.length) storico = `<p class="wp-ecn-note">${escapeHtml(plusT('wlNotInArchive'))}</p>`;
  else {
    storico = `
      <div class="wp-ecn-chartbar">
        <span class="wp-ecn-dim">${escapeHtml(ecoT('range'))}</span>
        ${RANGES.map(x => `<button type="button" class="wp-ecn-chip${_giorni === x.g ? ' active' : ''}" data-range="${x.g}">${escapeHtml(plusT(x.key))}</button>`).join('')}
      </div>
      <h4 class="wp-ecn-psec">${escapeHtml(plusT('wlChart'))}</h4>
      <div class="wp-ecn-chartwrap">${_finestra
        ? candleChartSvg(_finestra, { fmt: oro, lingua: lingua(), mode: 'line' })
        : `<p class="wp-ecn-note">${escapeHtml(plusT('noSeries'))}</p>`}</div>
      <div class="wp-ecn-wdays">
        <div><h4 class="wp-ecn-psec">${escapeHtml(plusT('wlBest'))}</h4><ul>${listaGiorni(migliori)}</ul></div>
        <div><h4 class="wp-ecn-psec">${escapeHtml(plusT('wlWorst'))}</h4><ul>${listaGiorni(peggiori)}</ul></div>
      </div>
      <p class="wp-ecn-note">${escapeHtml(plusT('wlWhat'))}</p>
      ${p.hist.archiveFrom ? `<p class="wp-ecn-note">${escapeHtml(plusT('wlCoverage', { d: fmtDay(p.hist.archiveFrom) }))}</p>` : ''}`;
  }

  return `
    <div class="wp-ecn-detail wp-ecn-wplayer">
      <header class="wp-ecn-whead">
        ${avatarImg(lite.avatarUrl, lite.username, 'wp-ecn-wavatar wp-ecn-wavatar-lg')}
        <div class="wp-ecn-wwho">
          <h3>${escapeHtml(lite.username || p.hist?.username || p.id)}</h3>
          <span class="wp-ecn-dim">${lite.country ? `${flagImg(lite.country, 'wp-ecn-flag')} ${escapeHtml(countryName(lite.country))}` : ''}${lite.leveling?.level != null ? ` · lv ${escapeHtml(lite.leveling.level)}` : ''}</span>
        </div>
        ${mio
          ? `<span class="wp-ecn-wmine">${escapeHtml(plusT('wlIsMine'))} <button type="button" class="wp-ecn-chip" data-forget="1">${escapeHtml(plusT('wlForget'))}</button></span>`
          : `<button type="button" class="wp-ecn-chip" data-mine="1">${escapeHtml(plusT('wlMine'))}</button>`}
      </header>

      <div class="wp-ecn-book wp-ecn-wstats">
        <span title="${escapeHtml(plusT('wlNowNote'))}"><em>${escapeHtml(plusT('wlNow'))}</em> <strong>${ora?.value != null ? escapeHtml(fmtFull(Math.round(ora.value))) : '—'}</strong>
          ${dalloScatto != null && ultimo ? deltaHtml(dalloScatto) : ''}</span>
        <span><em>${escapeHtml(plusT('wlRank'))}</em> ${ora?.rank ? `#${escapeHtml(fmtFull(ora.rank))}` : rank ? escapeHtml(plusT('wlRankOf', { p: fmtFull(rank.posizione), n: fmtFull(rank.su) })) : '—'}
          ${prima ? `<small class="wp-ecn-dim">${escapeHtml(plusT('wlRankMove', { p: fmtFull(prima.posizione), d: fmtDay(prima.slot) }))}</small>` : ''}</span>
        <span><em>${escapeHtml(plusT('wlD1'))}</em> ${deltaHtml(v1?.abs, v1?.pct)}</span>
        <span><em>${escapeHtml(plusT('wlD7'))}</em> ${deltaHtml(v7?.abs, v7?.pct)}</span>
        <span><em>${escapeHtml(plusT('wlD30'))}</em> ${deltaHtml(v30?.abs, v30?.pct)}</span>
        ${vAll ? `<span><em>${escapeHtml(plusT('wlDAll', { d: fmtDay(vAll.da) }))}</em> ${deltaHtml(vAll.abs, vAll.pct)}</span>` : ''}
      </div>
      ${storico}
    </div>`;
}

function paint() {
  if (!_container) return;
  _container.innerHTML = `
    <div class="wp-ecn-prices wp-ecn-wealth">
      <header class="wp-ecn-phead">
        <div>
          <h2>${escapeHtml(plusT('wlTitle'))}</h2>
          <p class="wp-ecn-sub">${escapeHtml(plusT('wlSub'))}</p>
        </div>
        <form class="wp-ecn-tools wp-ecn-wform">
          <input type="search" class="wp-ecn-search" placeholder="${escapeHtml(plusT('wlSearch'))}" value="${escapeHtml(_cerca)}" autocomplete="off">
          <button type="submit" class="wp-ecn-refresh"${_cercando ? ' disabled' : ''}>${escapeHtml(plusT('wlGo'))}</button>
        </form>
      </header>
      ${candidatiHtml()}
      ${giocatoreHtml()}
    </div>`;
  wire();
}

function wire() {
  const root = _container;
  if (!root) return;
  const form = root.querySelector('.wp-ecn-wform');
  const input = root.querySelector('.wp-ecn-search');
  input?.addEventListener('input', () => { _cerca = input.value; });
  form?.addEventListener('submit', (e) => { e.preventDefault(); cerca(_cerca); });

  root.querySelectorAll('[data-player]').forEach(b => {
    const c = _candidati?.find(x => x.id === b.dataset.player);
    b.addEventListener('click', () => apriGiocatore(b.dataset.player, c?.lite || null));
  });
  root.querySelector('[data-mine]')?.addEventListener('click', () => { safeSet(MIO_KEY, _player.id); paint(); });
  root.querySelector('[data-forget]')?.addEventListener('click', () => { safeDel(MIO_KEY); paint(); });
  root.querySelectorAll('[data-range]').forEach(b => {
    b.addEventListener('click', () => { _giorni = Number(b.dataset.range); paint(); });
  });

  const wrap = root.querySelector('.wp-ecn-chartwrap');
  if (wrap && _finestra) disegnaAllaMisura(wrap);
}

/* Come prices.js e production.js: il grafico si ridisegna alla misura
   vera del suo contenitore. */
function disegnaAllaMisura(wrap) {
  const svg = wrap.querySelector('.wp-ecn-chart');
  if (!svg) return;
  const w = Math.round(svg.clientWidth), h = Math.round(svg.clientHeight);
  if (w > 50 && h > 50) {
    const nuovo = candleChartSvg(_finestra, { w, h, fmt: oro, lingua: lingua(), mode: 'line' });
    if (nuovo) svg.outerHTML = nuovo;
  }
  wrap.querySelectorAll('.wp-ecn-guide, .wp-ecn-tip').forEach(e => e.remove());
  attachCandleExplorer(wrap, _finestra, {
    w: w > 50 ? w : 880, h: h > 50 ? h : 320, fmt: oro, lingua: lingua(), t: ecoT,
    righe: (r) => [[escapeHtml(plusT('wlValue')), escapeHtml(fmtFull(Math.round(r[4])))]],
  });
  _resizeObs?.disconnect();
  let ultimaW = w;
  _resizeObs = new ResizeObserver(() => {
    const nw = Math.round(wrap.querySelector('.wp-ecn-chart')?.clientWidth || 0);
    if (!nw || Math.abs(nw - ultimaW) < 8 || !wrap.isConnected) return;
    ultimaW = nw;
    disegnaAllaMisura(wrap);
  });
  _resizeObs.observe(wrap);
}

export async function initWealthTab(container) {
  _container = container;
  if (_player) { paint(); return; }
  // Chi ha detto "sono io" riapre la scheda sul suo personaggio.
  const mio = safeGet(MIO_KEY);
  if (mio && /^[a-f0-9]{24}$/.test(mio)) { await apriGiocatore(mio); return; }
  paint();
}

export function retranslateWealthTab() {
  if (_container) paint();
}

export function stopWealthTab() {
  _resizeObs?.disconnect();
}
