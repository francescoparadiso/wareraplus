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

   ── Il muro (richiesta dell'utente, 2026-10-21) ────────────────
   Sulla mappa si vedeva solo il danno per nazione; ora sotto il cursore
   c'è anche il MURO della scheda battaglia (battleFront.js) che va avanti
   e indietro: stessa formula (fronte = 50 + (quota difensori − 0,5) × 130,
   fra 12 e 88), stessi colori, difensori a sinistra. Il dato è il danno
   del ROUND in corso dei campioni al minuto (`s` di /battle-timeline),
   quindi a ogni cambio di round il muro torna al centro, come nel gioco.

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
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';

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
  'Attackers take the lead': ['Gli attaccanti passano avanti', 'Los atacantes toman la delantera', 'Die Angreifer gehen in Führung', 'Les attaquants prennent l’avantage', 'De aanvallers nemen de leiding', 'Anfallarna tar ledningen', 'Os atacantes passam à frente', 'المهاجمون يتقدمون'],
  'Defenders take the lead': ['I difensori passano avanti', 'Los defensores toman la delantera', 'Die Verteidiger gehen in Führung', 'Les défenseurs prennent l’avantage', 'De verdedigers nemen de leiding', 'Försvararna tar ledningen', 'Os defensores passam à frente', 'المدافعون يتقدمون'],
  '{name} joins': ['Entra {name}', 'Entra {name}', '{name} steigt ein', '{name} entre', '{name} doet mee', '{name} går in', 'Entra {name}', 'تنضم {name}'],
  'Front line: damage share in the current round': ['Il muro: quota di danno nel round in corso', 'El frente: reparto del daño en la ronda actual', 'Die Front: Schadensanteil in der laufenden Runde', 'Le front : part des dégâts dans la manche en cours', 'Het front: aandeel in de schade deze ronde', 'Fronten: andel av skadan i pågående rond', 'A frente: parte do dano na ronda atual', 'خط الجبهة: حصة الضرر في الجولة الحالية'],
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

/* ── Il muro a un istante ──
   Campioni `s`: [t, round, ticks, dannoAtk, dannoDef, puntiAtk, puntiDef, …],
   danno del round in corso. Il server salva un campione solo quando
   qualcosa cambia, quindi fino a un minuto prima del successivo il valore
   è fermo: si scivola verso il successivo solo in quell'ultimo minuto (e
   mai a cavallo di due round, dove il danno riparte da zero). */
const WALL_SPAN = 130, WALL_MIN = 12, WALL_MAX = 88;   // come battleFront.js: render()

function wallAt(T) {
  if (!_S?.length) return null;
  const i = lastIndexAtOrBefore(_S, T, s => s[0]);
  if (i < 0) return null;
  const a = _S[i], b = _S[i + 1];
  let atk = a[3] || 0, def = a[4] || 0;
  if (b && b[1] === a[1]) {
    const from = Math.max(a[0], b[0] - 60000);
    if (T > from) {
      const f = (T - from) / (b[0] - from);
      atk += ((b[3] || 0) - atk) * f;
      def += ((b[4] || 0) - def) * f;
    }
  }
  const tot = atk + def;
  const defShare = tot > 0 ? def / tot : 0.5;
  return { defShare, front: Math.min(WALL_MAX, Math.max(WALL_MIN, 50 + (defShare - 0.5) * WALL_SPAN)) };
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
let _marks = [];          // { t, kind: 'flip'|'entry', side, country }

/* ── Segni sul cursore (richiesta dell'utente) ──
   I SORPASSI (cambio di chi fa più danno nel round) e gli INGRESSI delle
   nazioni che pesano, come li calcola la scheda battaglia
   (src/battles/battleTimeline.js: analyzeTimeline). Un clic ci porta il
   replay. Tetti: 12 sorpassi e 8 ingressi, i più grossi — su una
   battaglia lunga sarebbero decine di tacche una sopra l'altra. */
const MAX_FLIPS = 12;
const MAX_ENTRIES = 8;

function buildMarks(an) {
  if (!an) return [];
  const flips = (an.flips || []).slice(0, MAX_FLIPS).map(f => ({ t: f.t, kind: 'flip', side: f.side }));
  const entries = (an.entries || [])
    .filter(e => !e.minor)
    .sort((a, b) => (b.total || 0) - (a.total || 0))
    .slice(0, MAX_ENTRIES)
    .map(e => ({ t: e.at, kind: 'entry', side: e.side, country: e.country }));
  return [...flips, ...entries].sort((a, b) => a.t - b.t);
}

function marksHtml() {
  if (!_range || !_marks.length) return '';
  const span = _range.t1 - _range.t0;
  return _marks.map((m, i) => {
    const left = Math.max(0, Math.min(100, (m.t - _range.t0) / span * 100)).toFixed(2);
    if (m.kind === 'flip') {
      const title = rT(m.side === 'attacker' ? 'Attackers take the lead' : 'Defenders take the lead');
      return `<button type="button" class="wp-replay-mark flip ${m.side}" style="left:${left}%" data-replay-mark="${i}" title="${title} · ${fmtClock(m.t)}" aria-label="${title}"></button>`;
    }
    const n = state.nationMap.get(m.country);
    const flag = n ? getFlagUrl(getNationCode(m.country, n)) : null;
    const title = rT('{name} joins', { name: n?.name || '—' });
    return `<button type="button" class="wp-replay-mark entry ${m.side}" style="left:${left}%" data-replay-mark="${i}" title="${title} · ${fmtClock(m.t)}" aria-label="${title}">${flag ? `<img src="${flag}" alt="" onerror="this.remove()">` : ''}</button>`;
  }).join('');
}

/** Chiamata da renderMap a ogni ridisegno: prepara il replay quando si
 *  apre una battaglia, lo smonta quando la si chiude o si cambia. Non
 *  ridisegna mai la mappa da qui (siamo DENTRO renderMap). */
export function syncBattleReplay() {
  // WarEra+: il replay è del danno, non serve nella vista Bonus battaglia.
  const on = state.coloringMode === 'battleHeatmap' && !!state.battleHeatmapData && !state.bonusHeatmap;
  const id = on ? state.battleHeatmapData.battleId : null;
  if (id === _battleId) return;
  teardown({ restore: false });
  _battleId = id;
  if (id) prepare(id);
}

async function prepare(id) {
  let tl = null;
  let an = null;
  try {
    const { fetchBattleTimeline, analyzeTimeline } = await import('../battles/battleTimeline.js');
    tl = await fetchBattleTimeline(id, { live: true });
    if (tl) { try { an = analyzeTimeline(tl); } catch { an = null; } }
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
  _marks = buildMarks(an);
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
  _marks = [];
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
        <div class="wp-replay-track">
          <div class="wp-replay-marks"></div>
          <input type="range" class="wp-replay-range" min="0" max="1000" step="1" value="0">
        </div>
        <button type="button" class="wp-replay-btn wp-replay-speed" data-replay="speed"></button>
        <button type="button" class="wp-replay-btn wp-replay-x" data-replay="close">✕</button>
        <div class="wp-replay-wall" hidden>
          <div class="wp-replay-wall-atk"></div>
          <div class="wp-replay-wall-origin"></div>
          <div class="wp-replay-wall-front"></div>
          <span class="wp-replay-wall-pct d"></span>
          <span class="wp-replay-wall-pct a"></span>
        </div>
        <div class="wp-replay-info"></div>
      </div>`;
    document.body.appendChild(_hud);
    _hud.addEventListener('click', (e) => {
      // Un segno sul cursore: il replay salta lì e si ferma.
      const mark = e.target.closest('[data-replay-mark]');
      if (mark) {
        e.stopPropagation();
        const m = _marks[Number(mark.dataset.replayMark)];
        if (m && _range) { stopPlay(); start(); applyAt(m.t, { force: true }); trackEvent('battle-replay-mark', { kind: m.kind }); }
        return;
      }
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
   fissa in basso), centrata sulla scheda e non sullo schermo: chiusa è
   una striscia, aperta è alta mezzo schermo. Si rimisura a ogni
   ridisegno della barra e quando la scheda cambia (MutationObserver sul
   suo stile, più lo scroll interno).
   Se sopra la scheda non c'è posto — "Battle spending" aperto, finestra
   bassa, telefono — la barra entra NELLA scheda, sul disegno della
   battaglia sotto i nomi dei due lati: è l'unico punto che copre una
   decorazione e non dei numeri. Prima restava a 108px dal fondo, cioè
   in mezzo alla tabella per nazione. */
let _tipObserver = null;
function placeHud() {
  if (!_hud) return;
  const tip = document.getElementById('battle-tooltip');
  const card = document.getElementById('battle-tooltip-main') || tip;
  // (offsetParent qui non serve: la scheda è position:fixed, e per un
  // elemento fisso è SEMPRE null, visibile o no.)
  const r = card ? card.getBoundingClientRect() : null;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const s = _hud.style;
  if (!r || !r.height) {
    s.top = ''; s.left = ''; s.transform = '';
    s.bottom = '';
    return;
  }
  const h = _hud.offsetHeight || 36;
  const w = _hud.offsetWidth || 160;
  // TOP_BAR: barra menù + ticker, la stessa riserva della card
  // (battleMarkers.js, max-height): sopra la card solo se c'è posto SOTTO
  // la barra, se no il bottone finiva sopra il menù.
  const GAP = 10, MARGIN = 8, TOP_BAR = 64;
  let top;
  if (r.top - GAP - h >= TOP_BAR) {
    top = r.top - GAP - h;
  } else {
    // Sotto la riga coi nomi dei lati (primo figlio del corpo), o sotto
    // l'intestazione se la scheda è ripiegata.
    const body = card.querySelector('#battle-tooltip-body');
    const anchor = (body && body.style.display !== 'none' && body.firstElementChild) || card.firstElementChild;
    const a = anchor ? anchor.getBoundingClientRect() : r;
    // Con la card che scorre dentro, la riga dei nomi può essere salita
    // fuori vista: la barra resta comunque dentro il bordo della card.
    top = Math.min(Math.max(a.bottom + 6, r.top + 6, MARGIN), vh - h - MARGIN);
  }
  const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, MARGIN), vw - w - MARGIN);
  s.bottom = 'auto';
  s.transform = 'none';
  s.top = `${Math.round(top)}px`;
  s.left = `${Math.round(left)}px`;
  if (tip && !_tipObserver) {
    _tipObserver = new MutationObserver(() => requestAnimationFrame(placeHud));
    _tipObserver.observe(tip, { attributes: true, subtree: true, attributeFilter: ['style', 'class'] });
    tip.addEventListener('scroll', () => requestAnimationFrame(placeHud), { capture: true, passive: true });
    window.addEventListener('resize', () => { if (_hud && !_hud.hidden) placeHud(); });
  }
}

function renderHud() {
  if (!_hud || !_range) return;
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
  // Si misura DOPO aver scritto i testi: la posizione dipende da quanto
  // è larga e alta la barra in quel momento.
  if (!active) { placeHud(); return; }
  const marksEl = _hud.querySelector('.wp-replay-marks');
  if (marksEl && marksEl.dataset.for !== String(_battleId)) {
    marksEl.innerHTML = marksHtml();
    marksEl.dataset.for = String(_battleId);
  }
  const T = _T ?? _range.t0;
  const range = _hud.querySelector('.wp-replay-range');
  if (document.activeElement !== range) range.value = String(Math.round((T - _range.t0) / (_range.t1 - _range.t0) * 1000));
  const wallEl = _hud.querySelector('.wp-replay-wall');
  const wall = wallAt(T);
  wallEl.hidden = !wall;
  if (wall) {
    wallEl.style.setProperty('--front', `${wall.front.toFixed(2)}%`);
    const dp = Math.round(wall.defShare * 100);
    wallEl.querySelector('.d').textContent = `${dp}%`;
    wallEl.querySelector('.a').textContent = `${100 - dp}%`;
    wallEl.title = rT('Front line: damage share in the current round');
  }
  // Round e punti dal campione al minuto più vicino (prima di T).
  const si = _S?.length ? lastIndexAtOrBefore(_S, T, s => s[0]) : -1;
  const s = si >= 0 ? _S[si] : null;
  const round = s ? ` · ${rT('Round {n}', { n: s[1] })} · ${s[6] ?? 0}–${s[5] ?? 0}` : '';
  const base = _tl?.baseAt
    ? `<div class="wp-replay-note">${rT('Recorded from {time}: damage done before arrives all at once.', { time: fmtClock(_range.t0) })}</div>`
    : '';
  _hud.querySelector('.wp-replay-info').innerHTML =
    `<b>${fmtClock(T)}</b> <span>${fmtElapsed(T - _range.t0)}${round}</span>${base}`;
  placeHud();
}
