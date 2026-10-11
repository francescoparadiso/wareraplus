/* ══════════════════════════════════════════════════════════════
   WarEra+ — Replay di una battaglia sulla mappa
   ------------------------------------------------------------------
   Richiesta dell'utente: rivedere una battaglia nel tempo — le frecce
   del danno (battleFlows.js) che nascono quando una nazione entra e
   s'ingrossano man mano, con un cursore per scorrere.

   Il dato c'è già: /battle-timeline (server/battleTimeline.js) tiene per
   ogni tick il danno CUMULATO di ogni nazione per lato, solo le chiavi
   cambiate. Sommando in ordine si ha la classifica della battaglia a
   qualunque istante. Lo legge la stessa funzione della scheda battaglia
   (src/battles/battleTimeline.js: fetchBattleTimeline, cache di
   sessione), con import() dinamico: chi non apre mai un replay non se la
   scarica.

   ── Come si innesta senza toccare chi disegna ─────────────────
   Heatmap, etichette con la percentuale (labels.js), legenda (ui.js),
   tooltip nazione e frecce leggono TUTTI state.battleHeatmapData.nations.
   Durante il replay quel campo viene SOSTITUITO con la classifica
   dell'istante scelto (e highlightedIds ricalcolato con la stessa regola
   di battleHeatmap.js); all'uscita si rimette l'originale. Così ogni
   pezzo della mappa segue il replay da solo, e nessuno di loro ha un
   ramo "se sto riproducendo". Le eccezioni sono due righe additive:
     · battleHeatmap.js salta il giro live dei 10 s mentre il replay è
       attivo (riscriverebbe la classifica di adesso sopra quella di ieri);
     · battleFlows.js normalizza lo spessore sul danno FINALE del primo
       (state.battleReplay.maxDamage), così le frecce crescono davvero
       invece di restare sempre "piene" rispetto a chi è primo in quel
       momento.

   ⚠️ L'archivio ACCUMULA dal 2026-10-07: una battaglia chiusa prima non
   ha replay, e il bottone non compare. Una battaglia già aperta al primo
   sguardo del server ha la prima lettura come FONDO (`baseAt`): tutto il
   danno precedente arriva lì in un colpo, e il replay comincia da lì
   dichiarandolo.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { computeHighlightedIds } from './battleHeatmap.js';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';

// Il replay dura sempre lo stesso tempo, qualunque sia la battaglia: una
// di otto ore e una di quaranta minuti si guardano in mezzo minuto.
const DURATIONS = [60000, 30000, 15000];
const SPEED_LABELS = ['½×', '1×', '2×'];
const FRAME_MS = 100;
// Sotto questi tick non c'è niente da riprodurre (due letture = un salto).
const MIN_TICKS = 3;

/* ── Testi (dizionario LOCALE, chiave = inglese, 9 lingue) ── */
const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];
const T = {
  'Battle replay': ['Replay della battaglia', 'Repetición de la batalla', 'Schlacht-Wiederholung', 'Rejouer la bataille', 'Herhaling van de slag', 'Repris av striden', 'Repetição da batalha', 'إعادة المعركة'],
  'Play': ['Avvia', 'Reproducir', 'Abspielen', 'Lecture', 'Afspelen', 'Spela', 'Reproduzir', 'تشغيل'],
  'Pause': ['Pausa', 'Pausa', 'Pause', 'Pause', 'Pauze', 'Paus', 'Pausa', 'إيقاف مؤقت'],
  'Speed': ['Velocità', 'Velocidad', 'Tempo', 'Vitesse', 'Snelheid', 'Hastighet', 'Velocidade', 'السرعة'],
  'Close replay': ['Chiudi il replay', 'Cerrar la repetición', 'Wiederholung schließen', 'Fermer le replay', 'Herhaling sluiten', 'Stäng repriset', 'Fechar a repetição', 'إغلاق الإعادة'],
  'Round {n}': ['Round {n}', 'Ronda {n}', 'Runde {n}', 'Manche {n}', 'Ronde {n}', 'Rond {n}', 'Ronda {n}', 'الجولة {n}'],
  'Recorded from {time}: damage done before arrives all at once.': [
    'Registrata dalle {time}: il danno fatto prima arriva tutto in un colpo.',
    'Registrada desde las {time}: el daño anterior llega de golpe.',
    'Aufgezeichnet ab {time}: früherer Schaden kommt auf einmal.',
    'Enregistrée depuis {time} : les dégâts antérieurs arrivent d’un coup.',
    'Vastgelegd vanaf {time}: eerdere schade komt in één keer binnen.',
    'Inspelad från {time}: tidigare skada kommer på en gång.',
    'Registada desde as {time}: o dano anterior chega de uma vez.',
    'مسجّلة منذ {time}: يصل الضرر السابق دفعة واحدة.'],
};
function rT(k, vars) {
  const i = ORDINE.indexOf(getLang());
  let s = (i >= 0 && T[k]?.[i]) || k;
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(String(b));
  return s;
}

/* ── Dati ── */

const _ms = v => (typeof v === 'number' ? v : Date.parse(v || '')) || null;

/** Cumulati per lato a ogni tick, ordinati. */
function buildSnaps(tl) {
  const K = (tl.k || []).slice().sort((a, b) => a[0] - b[0]);
  const atk = {}, def = {};
  return K.map(k => {
    for (const [c, v] of Object.entries(k[3] || {})) atk[c] = v;
    for (const [c, v] of Object.entries(k[4] || {})) def[c] = v;
    return { t: k[0], atk: { ...atk }, def: { ...def } };
  });
}

/** Stessa forma di battleHeatmap.js:buildNationRanking — lato di
 *  appartenenza = quello per cui la nazione ha fatto più danno. */
function rankingOf(snap) {
  if (!snap) return [];
  const ids = new Set([...Object.keys(snap.atk), ...Object.keys(snap.def)]);
  const out = [];
  for (const id of ids) {
    const toDef = snap.atk[id] || 0;   // danno fatto per l'attacco
    const toAtk = snap.def[id] || 0;   // danno fatto per la difesa
    const totalDamage = toDef + toAtk;
    if (!totalDamage) continue;
    out.push({ countryId: id, totalDamage, damageToAttackers: toAtk, damageToDefenders: toDef,
      side: toAtk > toDef ? 'defender' : 'attacker' });
  }
  return out.sort((a, b) => b.totalDamage - a.totalDamage);
}

function lastIndexAtOrBefore(arr, t, key = x => x.t) {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (key(arr[mid]) <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/* ── Stato del modulo ── */

let _battleId = null;     // battaglia della heatmap per cui il replay è pronto
let _tl = null;
let _snaps = null;
let _S = null;            // campioni al minuto, per round e punti
let _range = null;        // { t0, t1 }
let _hud = null;
let _orig = null;         // classifica vera, rimessa all'uscita
let _T = null;            // istante mostrato
let _shownIdx = -2;
let _playing = false;
let _timer = null;
let _lastFrameAt = 0;
let _speed = 1;

/** Chiamata da renderMap a ogni ridisegno: prepara il replay quando si
 *  apre una battaglia, lo smonta quando la si chiude o si cambia. Non
 *  ridisegna mai la mappa da qui (siamo DENTRO renderMap). */
export function syncBattleReplay() {
  const on = state.coloringMode === 'battleHeatmap' && !!state.battleHeatmapData;
  const id = on ? state.battleHeatmapData.battleId : null;
  if (id === _battleId) return;
  teardown({ restore: false });
  _battleId = id;
  if (id) prepare(id);
}

async function prepare(id) {
  let tl = null;
  try {
    const { fetchBattleTimeline } = await import('../battles/battleTimeline.js');
    tl = await fetchBattleTimeline(id, { live: true });
  } catch (err) {
    console.warn('WarEra+ replay: andamento non disponibile:', err.message);
  }
  if (_battleId !== id || !tl) return;
  const snaps = buildSnaps(tl);
  if (snaps.length < MIN_TICKS) return;
  _tl = tl;
  _snaps = snaps;
  _S = (tl.s || []).slice().sort((a, b) => a[0] - b[0]);
  const created = _ms(tl.createdAt);
  const t0 = tl.baseAt ? snaps[0].t : Math.min(created || snaps[0].t, snaps[0].t);
  const t1 = Math.max(snaps[snaps.length - 1].t, _S.length ? _S[_S.length - 1][0] : 0);
  _range = { t0, t1: Math.max(t1, t0 + 60000) };
  showHud();
}

/* ── Entrare e uscire ── */

function start() {
  const d = state.battleHeatmapData;
  if (!d || d.battleId !== _battleId || !_snaps) return;
  if (!_orig) {
    _orig = { nations: d.nations, highlightedIds: d.highlightedIds, maxDamage: d.maxDamage };
    const final = rankingOf(_snaps[_snaps.length - 1]);
    state.battleReplay = { active: true, maxDamage: final[0]?.totalDamage || 1 };
    trackEvent('battle-replay-open');
  }
  // Con la scheda della battaglia aperta la regione non si vede: si
  // chiude da sola (resta il suo bottone per riaprirla).
  const body = document.getElementById('battle-tooltip-body');
  if (body && body.style.display !== 'none') document.getElementById('battle-tooltip-collapse')?.click();
}

/** Overlay a tutto schermo sopra la mappa (src/app/mapIdle.js): il
 *  replay si ferma, non si chiude — riprende da dove era. */
export function pauseBattleReplay() {
  stopPlay();
}

function teardown({ restore = true } = {}) {
  stopPlay();
  const d = state.battleHeatmapData;
  if (restore && _orig && d && d.battleId === _battleId) {
    d.nations = _orig.nations;
    d.highlightedIds = _orig.highlightedIds;
    d.maxDamage = _orig.maxDamage;
  }
  _orig = null;
  state.battleReplay = null;
  _tl = _snaps = _S = _range = null;
  _T = null;
  _shownIdx = -2;
  if (_hud) _hud.hidden = true;
}

/** Torna alla battaglia di adesso senza chiudere la heatmap. */
function exitReplay() {
  if (!_orig) return;
  stopPlay();
  const d = state.battleHeatmapData;
  if (d && d.battleId === _battleId) {
    d.nations = _orig.nations;
    d.highlightedIds = _orig.highlightedIds;
    d.maxDamage = _orig.maxDamage;
  }
  _orig = null;
  state.battleReplay = null;
  _T = null;
  _shownIdx = -2;
  renderHud();
  import('./map.js').then(m => m.renderMap());
}

/* ── Un istante ── */

function applyAt(T, { force = false } = {}) {
  _T = Math.min(Math.max(T, _range.t0), _range.t1);
  const idx = lastIndexAtOrBefore(_snaps, _T);
  renderHud();
  if (idx === _shownIdx && !force) return;
  _shownIdx = idx;
  const d = state.battleHeatmapData;
  if (!d || d.battleId !== _battleId) return;
  const list = rankingOf(_snaps[idx]);
  d.nations = list;
  d.highlightedIds = computeHighlightedIds(list);
  d.maxDamage = list[0]?.totalDamage || 0;
  import('./map.js').then(m => m.renderMap());
}

/* ── Riproduzione ── */

function tick() {
  _timer = null;
  if (!_playing || !_range) return;
  const now = performance.now();
  const dt = now - (_lastFrameAt || now);
  _lastFrameAt = now;
  const span = _range.t1 - _range.t0;
  const next = _T + dt * span / DURATIONS[_speed];
  applyAt(next);
  if (_T >= _range.t1) { stopPlay(); return; }
  _timer = setTimeout(tick, FRAME_MS);
}

function play() {
  if (!_range) return;
  start();
  if (_T == null || _T >= _range.t1) applyAt(_range.t0, { force: true });
  _playing = true;
  _lastFrameAt = 0;
  renderHud();
  tick();
}

function stopPlay() {
  _playing = false;
  clearTimeout(_timer);
  _timer = null;
  if (_hud && !_hud.hidden) renderHud();
}

/* ── Barra di controllo ── */

const fmtClock = ms => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
function fmtElapsed(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m >= 60 ? `+${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `+${m}m`;
}

function showHud() {
  if (!_hud) {
    _hud = document.createElement('div');
    _hud.id = 'wp-replay-hud';
    _hud.innerHTML = `
      <button type="button" class="wp-replay-open" data-replay="open"></button>
      <div class="wp-replay-bar">
        <button type="button" class="wp-replay-btn" data-replay="toggle"></button>
        <input type="range" class="wp-replay-range" min="0" max="1000" step="1" value="0">
        <button type="button" class="wp-replay-btn wp-replay-speed" data-replay="speed"></button>
        <button type="button" class="wp-replay-btn wp-replay-x" data-replay="close">✕</button>
        <div class="wp-replay-info"></div>
      </div>`;
    document.body.appendChild(_hud);
    _hud.addEventListener('click', (e) => {
      const a = e.target.closest('[data-replay]')?.dataset.replay;
      if (!a) return;
      e.stopPropagation();
      if (a === 'open') { start(); applyAt(_range.t0, { force: true }); play(); }
      else if (a === 'toggle') { _playing ? stopPlay() : play(); }
      else if (a === 'speed') { _speed = (_speed + 1) % DURATIONS.length; renderHud(); }
      else if (a === 'close') exitReplay();
    });
    const range = _hud.querySelector('.wp-replay-range');
    range.addEventListener('input', () => {
      if (!_range) return;
      stopPlay();
      start();
      applyAt(_range.t0 + (_range.t1 - _range.t0) * Number(range.value) / 1000);
    });
    window.addEventListener('wareraplus:langchange', () => { if (_hud && !_hud.hidden) renderHud(); });
  }
  _hud.hidden = false;
  renderHud();
}

/* La barra sta APPENA SOPRA la scheda della battaglia (battleMarkers.js,
   fissa in basso): chiusa è una striscia, aperta è alta mezzo schermo.
   Si rimisura a ogni ridisegno della barra e quando la scheda cambia
   (MutationObserver sul suo stile). Se sopra la scheda aperta non c'è
   spazio — telefono — la barra le resta sopra in sovrimpressione. */
let _tipObserver = null;
function placeHud() {
  if (!_hud) return;
  const tip = document.getElementById('battle-tooltip');
  // (offsetParent qui non serve: la scheda è position:fixed, e per un
  // elemento fisso è SEMPRE null, visibile o no.)
  const r = tip ? tip.getBoundingClientRect() : null;
  let bottom = 108;
  if (r && r.height) {
    const above = window.innerHeight - r.top + 10;
    if (above + 90 < window.innerHeight) bottom = Math.max(bottom, above);
  }
  _hud.style.bottom = `${Math.round(bottom)}px`;
  if (tip && !_tipObserver) {
    _tipObserver = new MutationObserver(() => requestAnimationFrame(placeHud));
    _tipObserver.observe(tip, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
  }
}

function renderHud() {
  if (!_hud || !_range) return;
  placeHud();
  const active = Boolean(_orig);
  _hud.classList.toggle('active', active);
  const open = _hud.querySelector('.wp-replay-open');
  open.textContent = `▶ ${rT('Battle replay')}`;
  const toggle = _hud.querySelector('[data-replay="toggle"]');
  toggle.textContent = _playing ? '⏸' : '▶';
  toggle.title = toggle.ariaLabel = rT(_playing ? 'Pause' : 'Play');
  const speed = _hud.querySelector('[data-replay="speed"]');
  speed.textContent = SPEED_LABELS[_speed];
  speed.title = rT('Speed');
  const x = _hud.querySelector('[data-replay="close"]');
  x.title = x.ariaLabel = rT('Close replay');
  if (!active) return;
  const T = _T ?? _range.t0;
  const range = _hud.querySelector('.wp-replay-range');
  if (document.activeElement !== range) range.value = String(Math.round((T - _range.t0) / (_range.t1 - _range.t0) * 1000));
  // Round e punti dal campione al minuto più vicino (prima di T).
  const si = _S?.length ? lastIndexAtOrBefore(_S, T, s => s[0]) : -1;
  const s = si >= 0 ? _S[si] : null;
  const round = s ? ` · ${rT('Round {n}', { n: s[1] })} · ${s[6] ?? 0}–${s[5] ?? 0}` : '';
  const base = _tl?.baseAt
    ? `<div class="wp-replay-note">${rT('Recorded from {time}: damage done before arrives all at once.', { time: fmtClock(_range.t0) })}</div>`
    : '';
  _hud.querySelector('.wp-replay-info').innerHTML =
    `<b>${fmtClock(T)}</b> <span>${fmtElapsed(T - _range.t0)}${round}</span>${base}`;
}
