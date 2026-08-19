// battleFront.js
//
// ═══════════════════════════════════════════════════════════════════════
// WarEra+ — motore "Battle Front": prima viveva in un overlay a schermo
// intero aperto da un bottone nel tooltip battaglia (vedi git history se
// serve recuperarlo); su richiesta esplicita dell'utente ("vorrei tutto
// direttamente nel tooltip, senza aprire un'altra pagina") è stato
// trasformato in un widget MONTABILE dentro un contenitore qualsiasi.
// battleMarkers.js lo monta dentro il tooltip battaglia già esistente
// (#battle-tooltip) quando l'utente clicca un marker, e lo smonta quando il
// tooltip si chiude — vedi mountBattleFront()/unmountBattleFront() in fondo
// al file.
//
// Resta DOM/CSS puro — ZERO canvas, ZERO WebGL. Il campo è una striscia
// compatta con due territori la cui larghezza segue la quota di danno di
// ciascun lato, una linea del fronte che si sposta di conseguenza, una
// linea d'origine fissa al 50%, e due manciate di "unità" (punti = fanteria,
// punti più grandi = carri) che marciano insieme al fronte. Il movimento
// del fronte/territori è affidato a `transition` CSS su `left`/`width`:
// nessun render loop per animarlo.
//
// Gli effetti "spari/esplosioni" scattano SOLO quando un poll porta un vero
// incremento di danno (vedi FX in refreshBattleData) — mai un'animazione
// ambientale. Ogni "colpo" è una coppia tracciante+impatto animata con la
// Web Animations API su un pool fisso di elementi riciclati.
//
// Dati reali: stessa pipeline di sempre — fetchBattleWallData()/
// fetchBattleWallPoll() in battleHeatmap.js (ranking + battle.getLiveBattleData
// sempre nello stesso POST batch) e battleFront/momentum.js.
// ═══════════════════════════════════════════════════════════════════════

import { state } from './state.js';
import { fetchBattleWallData, fetchBattleWallPoll } from './battleHeatmap.js';
import { getNation, escapeHtml } from './utils.js';
import { fmt, formatRate, fmtDuration, hexToRgb, clamp } from './battleFront/helpers.js';
import { pushDamageSample, updateMomentum, getLastMomentum, getMomentumAt, resetMomentum } from './battleFront/momentum.js';

const POLL_MS = 1500;
const POLL_MAX_MS = 20000;
const POLL_FAIL_LIMIT = 4;
const IS_MOBILE = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) <= 760;
const FX_POOL_SIZE = IS_MOBILE ? 3 : 5;
const FX_MAX_VOLLEY = IS_MOBILE ? 2 : 3;
// Unità per lato: MIN sempre visibile (anche il lato che sta perdendo ha
// un presidio), MAX raggiunto solo dal lato che sta facendo tutto il danno.
const MIN_UNITS = 4, MAX_UNITS = IS_MOBILE ? 7 : 10;
const TANK_SHARE = 0.25; // quota di MAX_UNITS che diventa "carro" (punto grande)
const FLAG_BASE = 'https://media.warera.io/images/flags';
// WarEra+ (richiesta esplicita dell'utente): ogni round ha, oltre al danno,
// un punteggio a tick (round.attackerPoints/defenderPoints in
// battle.getLiveBattleData — già scaricati da fetchBattleWallPoll, prima
// ignorati) — il primo lato che arriva a 300 vince il round (riferito
// dall'utente da un giro live: roundHistory registrava wonBy:"attacker" con
// attackerPoints:303, poco sopra la soglia per via del tick che l'ha
// superata). round.actualTickPoints (quanti punti vale il prossimo tick, già
// nella risposta) non è ancora usato — resta per un'estensione futura.
const ROUND_WIN_POINTS = 300;

function flagUrl(code) {
  return code ? `${FLAG_BASE}/${code.toLowerCase()}.svg?v=16` : '';
}

// ==================== STATO DI MODULO ====================
// Un solo widget montato alla volta (un solo tooltip battaglia può essere
// pinnato per volta nell'app) — niente registro/Map di istanze multiple.
let hostEl, fieldEl, fxLayer, unitsLayer;
let hud = {};
let tracerPool = { i: -1, el: [] }, blastPool = { i: -1, el: [] };
let unitSlots = { def: [], atk: [] }; // { el, isTank, offset%, y% } generati una volta al mount
let sessionAbort = null;
function getSignal() {
  if (!sessionAbort) sessionAbort = new AbortController();
  return sessionAbort.signal;
}

let currentBattleId = null;
let pollTimer = null, heartbeatTimer = null, pageHidden = false;
let pollFailCount = 0;
let lastGoodNations = null;
let prevTotalDef = null, prevTotalAtk = null, lastPollTime = 0, lastUpdateTs = 0;
let lastFrontPct = 50;
let sideFlagUrl = { defender: '', attacker: '' };
let sideName = { defender: 'Defenders', attacker: 'Attackers' };
let reduceMotion = false;

// ==================== WIDGET DOM ====================
function buildWidget(host) {
  reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  host.innerHTML = `
    <style>${WIDGET_CSS}</style>
    <div class="bfm-root">
      <div class="bfm-field" id="bfm-field">
        <div class="bfm-terr-atk" id="bfm-terr-atk"></div>
        <div class="bfm-origin"></div>
        <div class="bfm-frontline" id="bfm-frontline"></div>
        <div class="bfm-units" id="bfm-units"></div>
        <div class="bfm-fx" id="bfm-fx"></div>
        <div class="bfm-status" id="bfm-status">Loading battle front…</div>
      </div>
      <div class="bfm-split">
        <div class="bfm-split-head"><span id="bfm-split-scope">Current round</span><span id="bfm-rates"></span></div>
        <div class="bfm-split-bar"><div class="bfm-split-def" id="bfm-split-def" style="width:50%;"></div><div class="bfm-split-atk" id="bfm-split-atk" style="width:50%;"></div></div>
        <div class="bfm-split-nums">
          <span class="d"><b id="bfm-split-def-pct">50.0%</b><span class="dmg" id="bfm-split-def-dmg">—</span></span>
          <span class="a"><span class="dmg" id="bfm-split-atk-dmg">—</span><b id="bfm-split-atk-pct">50.0%</b></span>
        </div>
      </div>
      <div class="bfm-points" id="bfm-points" style="display:none;">
        <div class="bfm-split-head"><span>Round points</span><span class="bfm-points-target">first to ${ROUND_WIN_POINTS}</span></div>
        <div class="bfm-points-track" id="bfm-points-track">
          <div class="bfm-points-fill def" id="bfm-points-def-fill" style="width:0%;"></div>
          <div class="bfm-points-mid"></div>
          <div class="bfm-points-fill atk" id="bfm-points-atk-fill" style="width:0%;"></div>
        </div>
        <div class="bfm-split-nums">
          <span class="d"><b id="bfm-points-def-num">0</b></span>
          <span class="a"><b id="bfm-points-atk-num">0</b></span>
        </div>
      </div>
      <div class="bfm-momentum" id="bfm-momentum">
        <span class="bfm-momentum-label">Momentum</span>
        <span class="bfm-momentum-text" id="bfm-momentum-text">Gathering momentum data…</span>
      </div>
    </div>
  `;

  hud = {
    field: host.querySelector('#bfm-field'),
    terrAtk: host.querySelector('#bfm-terr-atk'),
    frontline: host.querySelector('#bfm-frontline'),
    status: host.querySelector('#bfm-status'),
    splitDef: host.querySelector('#bfm-split-def'),
    splitAtk: host.querySelector('#bfm-split-atk'),
    splitDefPct: host.querySelector('#bfm-split-def-pct'),
    splitAtkPct: host.querySelector('#bfm-split-atk-pct'),
    splitDefDmg: host.querySelector('#bfm-split-def-dmg'),
    splitAtkDmg: host.querySelector('#bfm-split-atk-dmg'),
    splitScope: host.querySelector('#bfm-split-scope'),
    rates: host.querySelector('#bfm-rates'),
    pointsWrap: host.querySelector('#bfm-points'),
    pointsDefFill: host.querySelector('#bfm-points-def-fill'),
    pointsAtkFill: host.querySelector('#bfm-points-atk-fill'),
    pointsDefNum: host.querySelector('#bfm-points-def-num'),
    pointsAtkNum: host.querySelector('#bfm-points-atk-num'),
    momentum: host.querySelector('#bfm-momentum'),
    momentumText: host.querySelector('#bfm-momentum-text'),
  };

  fieldEl = hud.field;
  fxLayer = host.querySelector('#bfm-fx');
  unitsLayer = host.querySelector('#bfm-units');

  tracerPool = { i: -1, el: [] };
  blastPool = { i: -1, el: [] };
  for (let p = 0; p < FX_POOL_SIZE; p++) {
    const t = document.createElement('div'); t.className = 'bfm-tracer'; fxLayer.appendChild(t); tracerPool.el.push(t);
    const b = document.createElement('div'); b.className = 'bfm-blast'; fxLayer.appendChild(b); blastPool.el.push(b);
  }

  // Slot unità: generati UNA VOLTA per lato (offset dal fronte + y stabili
  // per tutta la vita del widget) — solo quanti sono "attivi" ad ogni render
  // vengono resi visibili, così le unità non "saltano" di posizione ad ogni
  // poll, semplicemente marciano col fronte (stesso `left` del fronte) e
  // compaiono/spariscono in coda alla formazione quando il conteggio cambia.
  unitSlots = { def: [], atk: [] };
  for (const side of ['def', 'atk']) {
    for (let i = 0; i < MAX_UNITS; i++) {
      const isTank = i >= MAX_UNITS - Math.max(1, Math.round(MAX_UNITS * TANK_SHARE));
      const el = document.createElement('div');
      el.className = 'bfm-unit' + (isTank ? ' tank' : '') + ' ' + side;
      el.style.top = (8 + Math.random() * 84) + '%';
      unitsLayer.appendChild(el);
      unitSlots[side].push({ el, isTank, offset: 3 + Math.random() * 26 });
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange, { signal: getSignal() });
}

function showStatus(mode) {
  if (!hud.status) return;
  if (mode === 'hidden') { hud.status.style.display = 'none'; return; }
  hud.status.style.display = 'flex';
  hud.status.classList.toggle('is-error', mode === 'error');
  hud.status.textContent = mode === 'error' ? 'Connection lost — retrying…' : 'Loading battle front…';
}

// ==================== FX: traccianti + impatti ====================
function nextPooled(pool) { pool.i = (pool.i + 1) % pool.el.length; return pool.el[pool.i]; }

// reduceMotion sopprime solo lo scivolamento del tracciante (il "movimento
// sostenuto" in senso stretto) — il lampo dell'impatto resta sempre visibile,
// anche in quella modalità: vedi nota in testa al file.
function fireOne(side) {
  const w = fieldEl.clientWidth, h = fieldEl.clientHeight;
  const top = 10 + Math.random() * 80;
  const intoEnemy = 8 + Math.random() * 16;
  let startPct, endPct;
  if (side === 'def') {
    startPct = clamp(lastFrontPct - (3 + Math.random() * 6), 2, 96);
    endPct = clamp(lastFrontPct + intoEnemy, 2, 96);
  } else {
    startPct = clamp(lastFrontPct + (3 + Math.random() * 6), 2, 96);
    endPct = clamp(lastFrontPct - intoEnemy, 2, 96);
  }

  {
    const tracer = nextPooled(tracerPool);
    const dxPx = (endPct - startPct) / 100 * w;
    tracer.className = 'bfm-tracer ' + side;
    tracer.style.top = (top / 100 * h) + 'px';
    tracer.style.left = (startPct / 100 * w) + 'px';
    if (tracer._anim) tracer._anim.cancel();
    // BUG FIX (segnalato dall'utente: "non si vedono traccianti su desktop").
    // Causa: con prefers-reduced-motion:reduce attivo (comune su desktop) il
    // ramo che disegnava i traccianti era saltato del tutto — restava solo il
    // lampo d'impatto. Ora il tracciante si vede SEMPRE: a moto ridotto come
    // breve lampo statico (niente scivolamento sostenuto, rispetta comunque
    // la preferenza), altrimenti con lo scivolamento pieno di prima.
    tracer._anim = reduceMotion
      ? tracer.animate([
          { opacity: 0, transform: 'scaleX(0.6)' },
          { opacity: 1, transform: 'scaleX(1)', offset: 0.3 },
          { opacity: 0, transform: 'scaleX(1)' },
        ], { duration: 360, easing: 'ease-out' })
      : tracer.animate([
          { opacity: 0, transform: 'translateX(0px) scaleX(0.4)' },
          { opacity: 1, transform: 'translateX(0px) scaleX(1)', offset: 0.16 },
          { opacity: 1, transform: `translateX(${dxPx * 0.82}px) scaleX(1)`, offset: 0.8 },
          { opacity: 0, transform: `translateX(${dxPx}px) scaleX(1)` },
        ], { duration: 420 + Math.random() * 120, easing: 'cubic-bezier(.2,.6,.4,1)' });
  }

  const blast = nextPooled(blastPool);
  blast.className = 'bfm-blast ' + side;
  blast.style.top = (top / 100 * h) + 'px';
  blast.style.left = (endPct / 100 * w) + 'px';
  if (blast._anim) blast._anim.cancel();
  const peakScale = reduceMotion ? 1.1 : 1;
  const endScale = reduceMotion ? 1.25 : 2;
  blast._anim = blast.animate([
    { opacity: 0, transform: 'scale(0.3)', offset: 0 },
    { opacity: 1, transform: `scale(${peakScale})`, offset: 0.24 },
    { opacity: 0, transform: `scale(${endScale})`, offset: 1 },
  ], { duration: 480, delay: reduceMotion ? 0 : 320, easing: 'ease-out', fill: 'backwards' });

  flashFrontline(side);
}

function flashFrontline(side) {
  const el = hud.frontline;
  if (!el) return;
  const color = side === 'def' ? 'var(--bfm-def-strong)' : 'var(--bfm-atk-strong)';
  if (el._flash) el._flash.cancel();
  el._flash = el.animate([
    { boxShadow: '0 0 10px 1px rgba(226,172,77,0.45)' },
    { boxShadow: `0 0 18px 4px ${color}`, offset: 0.3 },
    { boxShadow: '0 0 10px 1px rgba(226,172,77,0.45)' },
  ], { duration: 480, easing: 'ease-out' });
}

function flashRate(side) {
  const el = hud.rates;
  if (!el) return;
  if (el._flash) el._flash.cancel();
  const color = side === 'def' ? 'var(--bfm-def-strong)' : 'var(--bfm-atk-strong)';
  el._flash = el.animate([
    { textShadow: '0 0 0 transparent' },
    { textShadow: `0 0 10px ${color}`, offset: 0.35 },
    { textShadow: '0 0 0 transparent' },
  ], { duration: 500, easing: 'ease-out' });
}

function spawnVolley(side, amount) {
  if (!fieldEl || !amount || amount <= 0) return;
  const n = clamp(Math.round(Math.log10(1 + amount / 1500)) + 1, 1, FX_MAX_VOLLEY);
  flashRate(side);
  for (let i = 0; i < n; i++) {
    const delay = i * (90 + Math.random() * 150);
    setTimeout(() => { if (currentBattleId) fireOne(side); }, delay);
  }
}

// ==================== TITOLO (solo per nomi/bandiere usati dal momentum) ====================
// Niente più masthead: regione e nomi nazione sono già mostrati sopra questo
// widget nel tooltip (buildBattleTooltipContent in battleMarkers.js) — qui
// servono solo per etichettare CHI nel testo del momentum qui sotto.
function applyTitle(details) {
  const atkNation = getNation(details?.attacker?.country);
  const defNation = getNation(details?.defender?.country);
  sideFlagUrl.defender = flagUrl(defNation?.code?.toLowerCase());
  sideFlagUrl.attacker = flagUrl(atkNation?.code?.toLowerCase());
  sideName.defender = defNation?.name || 'Defenders';
  sideName.attacker = atkNation?.name || 'Attackers';
}

// ==================== UNITÀ (fanteria + carri) ====================
// Conteggio per lato guidato dalla quota di danno sul totale battaglia: il
// lato che sta facendo più danno mostra una formazione più fitta. Non è una
// simulazione — è un indicatore visivo proporzionale, coerente con "chi sta
// vincendo" già mostrato dalla barra split e dal fronte.
function renderUnits(defShare) {
  const defCount = Math.round(MIN_UNITS + (MAX_UNITS - MIN_UNITS) * defShare);
  const atkCount = Math.round(MIN_UNITS + (MAX_UNITS - MIN_UNITS) * (1 - defShare));
  for (const [side, count] of [['def', defCount], ['atk', atkCount]]) {
    unitSlots[side].forEach((slot, i) => {
      const active = i < count;
      slot.el.style.opacity = active ? '1' : '0';
      if (!active) return;
      const pct = side === 'def'
        ? clamp(lastFrontPct - slot.offset, 1, 98)
        : clamp(lastFrontPct + slot.offset, 1, 98);
      slot.el.style.left = pct + '%';
    });
  }
}

// ==================== RENDER PRINCIPALE ====================
function render(defenderRanked, attackerRanked, totalDef, totalAtk, round) {
  const totalAll = totalDef + totalAtk;
  const defShare = totalAll > 0 ? totalDef / totalAll : 0.5;

  const defPct = defShare * 100;
  hud.splitDef.style.width = defPct + '%';
  hud.splitAtk.style.width = (100 - defPct) + '%';
  hud.splitDefPct.textContent = defPct.toFixed(1) + '%';
  hud.splitAtkPct.textContent = (100 - defPct).toFixed(1) + '%';

  // WarEra+ (richiesta esplicita dell'utente): accanto alle percentuali
  // servono anche i DANNI in valore assoluto. I due totali che arrivano qui
  // sono già quelli del round in corso quando `round` esiste
  // (round.defenderDamages/attackerDamages, vedi refreshBattleData); quando
  // manca, sono la somma del ranking, cioè il totale di tutta la battaglia.
  // L'etichetta sopra la barra dice QUALE dei due si sta guardando: senza,
  // lo stesso numero significherebbe due cose diverse a seconda del momento.
  if (hud.splitDefDmg) hud.splitDefDmg.textContent = fmt(totalDef);
  if (hud.splitAtkDmg) hud.splitAtkDmg.textContent = fmt(totalAtk);
  if (hud.splitScope) hud.splitScope.textContent = round ? 'Current round damage' : 'Total battle damage';

  const frontPct = clamp(50 + (defShare - 0.5) * 130, 12, 88);
  lastFrontPct = frontPct;
  hud.terrAtk.style.left = frontPct + '%';
  hud.frontline.style.left = frontPct + '%';

  renderUnits(defShare);
  renderRoundPoints(round);
}

// ==================== PUNTI ROUND (chi arriva a 300 vince) ====================
// Barra UNICA che converge verso il centro (richiesta esplicita
// dell'utente, con riferimento visivo): a differenza della barra danno
// sopra (una quota SUL TOTALE dei due lati, sempre 100% insieme), i punti
// round sono due corse INDIPENDENTI verso lo stesso traguardo
// (ROUND_WIN_POINTS) — ogni lato riempie la propria metà della barra dal
// proprio bordo esterno verso il centro (max 50% di larghezza ciascuno,
// raggiunto quando arriva a ROUND_WIN_POINTS). Visibile solo quando
// `round` esiste (round.attackerPoints/defenderPoints arrivano solo da
// battle.getLiveBattleData, non dal solo ranking) — niente barra se manca,
// invece di mostrare 0/300 fuorviante.
//
// BUG FIX (segnalato dall'utente, screenshot: barra sempre vuota anche con
// punti >0): i riempimenti erano <span> — un elemento inline ignora
// `width` per definizione CSS, qualunque sia il valore impostato via JS.
// Ora sono <div> posizionati assolutamente dentro .bfm-points-track (vedi
// WIDGET_CSS), block-level per costruzione: stesso identico bug non può
// ripresentarsi.
function renderRoundPoints(round) {
  if (!hud.pointsWrap) return;
  const defPoints = round?.defenderPoints;
  const atkPoints = round?.attackerPoints;
  const hasPoints = typeof defPoints === 'number' && typeof atkPoints === 'number';
  hud.pointsWrap.style.display = hasPoints ? 'block' : 'none';
  if (!hasPoints) return;

  // Ciascun lato può occupare al più metà barra (50%) — a ROUND_WIN_POINTS
  // il proprio riempimento tocca esattamente il divisorio centrale.
  const defPct = clamp(defPoints / ROUND_WIN_POINTS * 50, 0, 50);
  const atkPct = clamp(atkPoints / ROUND_WIN_POINTS * 50, 0, 50);
  hud.pointsDefFill.style.width = defPct + '%';
  hud.pointsAtkFill.style.width = atkPct + '%';
  hud.pointsDefNum.textContent = `${defPoints}/${ROUND_WIN_POINTS}`;
  hud.pointsAtkNum.textContent = `${atkPoints}/${ROUND_WIN_POINTS}`;
}

// ==================== MOMENTUM (una riga compatta) ====================
function renderMomentum() {
  const m = getLastMomentum();
  if (!m) {
    if (hud.momentumText) hud.momentumText.textContent = 'Gathering momentum data…';
    hud.momentum.classList.remove('is-closing', 'lead-def', 'lead-atk');
    return;
  }

  const elapsed = Math.max(0, (Date.now() - getMomentumAt()) / 1000);
  const leadNow = Math.max(0, m.lead - m.gain * elapsed);
  const etaNow = (m.gain > 0 && leadNow > 0) ? leadNow / m.gain : null;

  const leaderIsDef = m.leader === 'defender';
  const leaderVar = leaderIsDef ? '--bfm-def-strong' : '--bfm-atk-strong';
  const trailerVar = leaderIsDef ? '--bfm-atk-strong' : '--bfm-def-strong';
  const leaderName = escapeHtml(leaderIsDef ? sideName.defender : sideName.attacker);
  const trailerName = escapeHtml(leaderIsDef ? sideName.attacker : sideName.defender);

  // WarEra+ (richiesta esplicita: "vorrei che fosse più visibile la parte
  // sul momentum"). Il testo è lo stesso di prima, ma il blocco ora è un
  // riquadro con la barra di stato colorata dal lato in vantaggio invece di
  // una riga di testo da 11px persa in fondo al tooltip: le classi
  // lead-def/lead-atk/is-closing pilotano il colore del bordo e dello
  // sfondo (vedi WIDGET_CSS), così si capisce CHI sta vincendo con un
  // colpo d'occhio, senza leggere la frase.
  hud.momentum.classList.toggle('lead-def', leaderIsDef);
  hud.momentum.classList.toggle('lead-atk', !leaderIsDef);

  const closing = m.gain > 0.005 * (m.rateDef + m.rateAtk + 1);
  hud.momentum.classList.toggle('is-closing', closing);

  if (closing) {
    const etaTxt = leadNow <= 0.5 ? 'overtake imminent' : (etaNow != null ? `overtake in ~${fmtDuration(etaNow)}` : 'closing');
    hud.momentumText.innerHTML = `<b style="color:var(${trailerVar})">${trailerName}</b> closing on <b style="color:var(${leaderVar})">${leaderName}</b> — <span class="bfm-momentum-eta">${etaTxt}</span>`;
  } else {
    hud.momentumText.innerHTML = `<b style="color:var(${leaderVar})">${leaderName}</b> extending the lead`;
  }
}

// ==================== ALTRI CONTRIBUENTI (<1%) + ALL DATA (per lato) ====================
// WarEra+: richiesta esplicita — oltre ai due schieramenti aggregati (barra
// split sopra), due viste sullo stesso pannello:
//  - compatta (default): solo le nazioni che hanno contribuito con MENO
//    dell'1% del danno del PROPRIO LATO;
//  - "All data" (bottone espandi): OGNI nazione che ha fatto danno > 0,
//    divisa per lato (difensore/attaccante) — non solo quelle sotto l'1%.
//
// DENOMINATORE DELLE PERCENTUALI (richiesta esplicita): il totale del proprio
// lato, NON il totale della battaglia — stessa identica semantica della
// heatmap (battleHeatmap.js: computeHighlightedIds usa `n.totalDamage /
// sideTotal`, e la legenda dice "Share = nation damage / side total"), così i
// due numeri che l'utente vede per la stessa nazione combaciano invece di
// raccontare due cose diverse. I due totali di lato si ricavano qui dallo
// stesso array `nations` che genera le righe: non vanno MAI presi da
// totalDef/totalAtk del chiamante, che quando esiste un round live sono il
// danno del solo round corrente mentre `n.totalDamage` è cumulativo — era
// esattamente la causa delle percentuali gonfiate (94% dove il vero valore
// era 29%) segnalate in precedenza.
//
// Riusa `nations` gia' scaricato per il ranking (nessuna fetch aggiuntiva) —
// si aggiorna quindi alla stessa cadenza di tutto il resto del widget (ogni
// poll, ~1.5s, live). I contenitori DOM (colonna desktop + sezione
// collassabile mobile) vivono in battleMarkers.js/buildBattleTooltipContent;
// qui si scrive solo il contenuto, per id — stesso pattern usato dal resto
// del file per hud.*. Entrambe le viste vengono scritte ad ogni poll (e non
// solo quella attiva): il bottone "espandi" in battleMarkers.js si limita a
// mostrare/nascondere via CSS, cosi' non deve rincorrere lo stato per
// chiedere un ri-render qui.
function _contribRow(n, sideTotal) {
  const nation = getNation(n.countryId);
  const name = escapeHtml(nation?.name || n.countryId);
  const code = nation?.code?.toLowerCase();
  const pct = (sideTotal > 0 ? (n.totalDamage / sideTotal) * 100 : 0).toFixed(2);
  return `
    <div class="bfm-contrib-row">
      ${code ? `<img class="bfm-contrib-flag" src="${flagUrl(code)}" alt="" onerror="this.style.visibility='hidden'">` : '<span class="bfm-contrib-flag"></span>'}
      <span class="bfm-contrib-main">
        <span class="bfm-contrib-name">${name}</span>
        <span class="bfm-contrib-dmg">${fmt(n.totalDamage)}</span>
      </span>
      <span class="bfm-contrib-pct">${pct}%</span>
    </div>`;
}

// Una colonna della vista "All data". `side` pilota i colori (def/atk) via
// le classi, vedi injectContribStyles in battleMarkers.js. Nell'intestazione
// il totale del lato — cioè il denominatore delle percentuali della colonna,
// che altrimenti resterebbe implicito.
function _contribCol(side, label, list, sideTotal) {
  return `
    <div class="bfm-contrib-col bfm-contrib-col-${side}">
      <div class="bfm-contrib-side-title">
        ${label} <span class="bfm-contrib-side-count">(${list.length})</span>
        <span class="bfm-contrib-side-total">${fmt(sideTotal)}</span>
      </div>
      ${list.length ? list.map(n => _contribRow(n, sideTotal)).join('') : '<div class="bfm-contrib-empty">—</div>'}
    </div>`;
}

function renderOtherContributors(nations) {
  const desktopWrap = document.getElementById('battle-tooltip-contributors');
  const toggleBtn = document.getElementById('battle-contrib-toggle');
  const countEl = document.getElementById('battle-contrib-count');
  const mobileSection = document.getElementById('battle-contrib-mobile-section');
  const desktopList = document.getElementById('battle-contrib-list-desktop');
  const mobileList = document.getElementById('battle-contrib-list-mobile');
  const desktopListFull = document.getElementById('battle-contrib-list-desktop-full');
  const mobileListFull = document.getElementById('battle-contrib-list-mobile-full');
  if (!desktopWrap && !toggleBtn) return; // tooltip non (ancora) costruito

  // `all` è già filtrato a totalDamage > 0: nelle liste finiscono solo le
  // nazioni che hanno davvero fatto danno, mai quelle presenti nel ranking
  // con zero.
  const all = (nations || []).filter(n => n.totalDamage > 0);
  const defenderAll = all.filter(n => n.side === 'defender').sort((a, b) => b.totalDamage - a.totalDamage);
  const attackerAll = all.filter(n => n.side === 'attacker').sort((a, b) => b.totalDamage - a.totalDamage);

  // I due denominatori (vedi nota in testa alla sezione): stessa formula di
  // battleHeatmap.js:computeHighlightedIds.
  const defTotal = defenderAll.reduce((s, n) => s + n.totalDamage, 0);
  const atkTotal = attackerAll.reduce((s, n) => s + n.totalDamage, 0);
  const sideTotalOf = (n) => (n.side === 'defender' ? defTotal : atkTotal);

  const minor = all
    .filter(n => { const t = sideTotalOf(n); return t > 0 && (n.totalDamage / t) < 0.01; })
    .sort((a, b) => b.totalDamage - a.totalDamage);

  const rowsHtml = minor.map(n => _contribRow(n, sideTotalOf(n))).join('') || '<div class="bfm-contrib-empty">—</div>';
  if (desktopList) desktopList.innerHTML = rowsHtml;
  if (mobileList) mobileList.innerHTML = rowsHtml;

  const fullHtml = `
    <div class="bfm-contrib-cols">
      ${_contribCol('def', '🛡️ Defence', defenderAll, defTotal)}
      ${_contribCol('atk', '⚔️ Attack', attackerAll, atkTotal)}
    </div>`;
  if (desktopListFull) desktopListFull.innerHTML = fullHtml;
  if (mobileListFull) mobileListFull.innerHTML = fullHtml;

  // Il bottone compare se c'e' qualcosa di utile da mostrare in ALMENO una
  // delle due viste: la compatta (nazioni <1%) o quella completa (piu' di
  // due nazioni coinvolte in totale — con solo attaccante+difensore "All
  // data" mostrerebbe le stesse due righe gia' visibili sopra, inutile).
  const hasData = minor.length > 0 || all.length > 2;
  if (countEl) countEl.textContent = minor.length > 0 ? `(${minor.length})` : '';
  desktopWrap?.classList.toggle('bfm-contrib-has-data', hasData);
  toggleBtn?.classList.toggle('bfm-contrib-has-data', hasData);
  mobileSection?.classList.toggle('bfm-contrib-has-data', hasData);
}

// ==================== FETCH + STATO BATTAGLIA ====================
async function refreshBattleData(battleId, isInitial) {
  let nations, live, details;
  if (isInitial) {
    const res = await fetchBattleWallData(battleId);
    nations = res.nations; live = res.live; details = res.details;
  } else {
    const res = await fetchBattleWallPoll(battleId);
    nations = res.nations; live = res.live;
  }
  if (currentBattleId !== battleId) return;

  if (isInitial) applyTitle(details);

  if (!nations || !nations.length) {
    pollFailCount++;
    if (lastGoodNations && lastGoodNations.length) {
      nations = lastGoodNations;
      if (pollFailCount >= POLL_FAIL_LIMIT) showStatus('error');
    } else {
      if (pollFailCount >= POLL_FAIL_LIMIT) showStatus('error');
      return;
    }
  } else {
    pollFailCount = 0;
    lastGoodNations = nations;
    showStatus('hidden');
  }

  const defenderRanked = nations.filter(n => n.side === 'defender').sort((a, b) => b.totalDamage - a.totalDamage);
  const attackerRanked = nations.filter(n => n.side === 'attacker').sort((a, b) => b.totalDamage - a.totalDamage);

  const rankedSumDef = defenderRanked.reduce((s, n) => s + n.totalDamage, 0);
  const rankedSumAtk = attackerRanked.reduce((s, n) => s + n.totalDamage, 0);
  const round = live?.round || null;
  const totalDef = round?.defenderDamages != null ? round.defenderDamages : rankedSumDef;
  const totalAtk = round?.attackerDamages != null ? round.attackerDamages : rankedSumAtk;

  render(defenderRanked, attackerRanked, totalDef, totalAtk, round);
  // I denominatori delle percentuali se li calcola da sé, per lato, dallo
  // stesso `nations` che genera le righe — vedi la nota in testa alla sezione
  // "ALTRI CONTRIBUENTI": passargli totalDef/totalAtk da qui sarebbe sbagliato
  // (sono il round corrente, non il cumulativo).
  renderOtherContributors(nations);

  const now = performance.now();
  let rateTxt = '';
  if (pollFailCount === 0 && prevTotalDef != null && lastPollTime > 0) {
    const dt = (now - lastPollTime) / 1000;
    if (dt > 0) {
      const defRateVal = formatRate((totalDef - prevTotalDef) / dt);
      const atkRateVal = formatRate((totalAtk - prevTotalAtk) / dt);
      if (defRateVal) rateTxt += `🛡${defRateVal} `;
      if (atkRateVal) rateTxt += `⚔${atkRateVal}`;
      spawnVolley('def', totalDef - prevTotalDef);
      spawnVolley('atk', totalAtk - prevTotalAtk);
    }
  }
  if (hud.rates) hud.rates.textContent = rateTxt;
  if (pollFailCount === 0) { prevTotalDef = totalDef; prevTotalAtk = totalAtk; lastPollTime = now; }

  if (pollFailCount === 0) {
    lastUpdateTs = Date.now();
    pushDamageSample(totalDef, totalAtk);
    updateMomentum(totalDef, totalAtk);
  }
  renderMomentum();
}

function schedulePoll(battleId) {
  if (pollTimer) clearTimeout(pollTimer);
  const delay = Math.min(POLL_MAX_MS, POLL_MS * Math.pow(2, Math.min(pollFailCount, 3)));
  pollTimer = setTimeout(async () => {
    if (currentBattleId !== battleId) return;
    await refreshBattleData(battleId, false);
    if (currentBattleId === battleId) schedulePoll(battleId);
  }, delay);
}

function heartbeat() {
  if (!lastUpdateTs) return;
  renderMomentum();
}

function onVisibilityChange() {
  if (document.hidden) {
    pageHidden = true;
    if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    return;
  }
  if (!pageHidden) return;
  pageHidden = false;
  if (currentBattleId) {
    if (!pollTimer) schedulePoll(currentBattleId);
    if (!heartbeatTimer) heartbeatTimer = setInterval(heartbeat, 1000);
  }
}

// ==================== API PUBBLICA ====================
// mountBattleFront è idempotente: se un'istanza precedente è ancora attiva
// (es. l'utente ha cliccato un'altra battaglia mentre un tooltip era già
// pinnato) la smonta da sola prima di ricostruire, così battleMarkers.js
// non deve preoccuparsi dell'ordine di chiamata.
export async function mountBattleFront(host, battleId) {
  if (hostEl) unmountBattleFront();

  hostEl = host;
  buildWidget(host);
  resetMomentum();
  prevTotalDef = null; prevTotalAtk = null; lastPollTime = 0; lastUpdateTs = 0;
  pollFailCount = 0; lastGoodNations = null;
  sideName = { defender: 'Defenders', attacker: 'Attackers' };
  sideFlagUrl = { defender: '', attacker: '' };
  currentBattleId = battleId;

  showStatus('loading');
  await refreshBattleData(battleId, true);
  if (currentBattleId !== battleId) return; // smontato durante l'await

  schedulePoll(battleId);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = setInterval(heartbeat, 1000);
}

export function unmountBattleFront() {
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  pageHidden = false;
  if (sessionAbort) { sessionAbort.abort(); sessionAbort = null; }
  if (hostEl) hostEl.innerHTML = '';
  hostEl = null; fieldEl = null; fxLayer = null; unitsLayer = null;
  hud = {};
  tracerPool = { i: -1, el: [] }; blastPool = { i: -1, el: [] };
  unitSlots = { def: [], atk: [] };
  currentBattleId = null;
}

// ==================== CSS ====================
// Palette identica a prima (steel blue / ember), ma tutte le misure sono
// pensate per vivere dentro il tooltip battaglia (max ~420px di larghezza),
// non più a schermo intero.
const WIDGET_CSS = `
.bfm-root {
  --bfm-def-strong: #8fc3e8; --bfm-def-fill: #16283a;
  --bfm-atk-strong: #ef9269; --bfm-atk-fill: #391f16;
  --bfm-front: #e2ac4d; --bfm-ink-faint: #7c8695;
  margin-top: 8px;
}
.bfm-root * { box-sizing: border-box; }
/* WarEra+ (segnalato: "su desktop mancano i traccianti che ci sono su
   mobile"). Verificato dal vivo che su desktop il meccanismo funziona
   (pool creato, polling attivo, tracciante renderizzato se forzato): gli
   spari scattano solo quando il danno cresce fra due poll. Il problema è
   di LEGGIBILITÀ — il campo era alto 74px anche su desktop, con segmenti
   da 30x2px in mix-blend-mode:screen e i puntini delle unità sopra: su
   mobile lo stesso widget occupa proporzionalmente molto più schermo e
   quindi si notano. Su desktop il campo ora è più alto e traccianti/
   impatti sono più grandi e luminosi; su mobile restano com'erano, dove
   già si vedevano. */
.bfm-field { position: relative; height: ${IS_MOBILE ? 74 : 104}px; border-radius: 8px; overflow: hidden; background: var(--bfm-def-fill); }
.bfm-terr-atk { position: absolute; top: 0; right: 0; bottom: 0; left: 50%; background: var(--bfm-atk-fill); }
@media (prefers-reduced-motion: no-preference) { .bfm-terr-atk { transition: left 900ms cubic-bezier(.22,.61,.36,1); } }
.bfm-origin { position: absolute; top: 0; bottom: 0; left: 50%; width: 0; border-left: 1px dashed rgba(255,255,255,0.25); }
.bfm-frontline { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; margin-left: -1px; background: var(--bfm-front); box-shadow: 0 0 10px 1px rgba(226,172,77,0.45); }
@media (prefers-reduced-motion: no-preference) { .bfm-frontline { transition: left 900ms cubic-bezier(.22,.61,.36,1); } }
.bfm-units { position: absolute; inset: 0; }
.bfm-unit { position: absolute; top: 50%; width: 4px; height: 4px; margin: -2px 0 0 -2px; border-radius: 50%; transform: translateX(-50%); opacity: 0; }
@media (prefers-reduced-motion: no-preference) { .bfm-unit { transition: left 900ms cubic-bezier(.22,.61,.36,1), opacity 400ms; } }
.bfm-unit.def { background: var(--bfm-def-strong); }
.bfm-unit.atk { background: var(--bfm-atk-strong); }
.bfm-unit.tank { width: 8px; height: 5px; margin: -2.5px 0 0 -4px; border-radius: 1.5px; }
.bfm-fx { position: absolute; inset: 0; overflow: hidden; pointer-events: none; mix-blend-mode: screen; }
.bfm-tracer { position: absolute; height: ${IS_MOBILE ? 2 : 3}px; width: ${IS_MOBILE ? 30 : 44}px; border-radius: 2px; opacity: 0; top: 0; left: 0; transform-origin: left center; }
.bfm-tracer.def { background: linear-gradient(90deg, transparent, #eaf6ff 45%, var(--bfm-def-strong)); box-shadow: 0 0 ${IS_MOBILE ? '6px 1px' : '10px 2px'} var(--bfm-def-strong); }
.bfm-tracer.atk { background: linear-gradient(90deg, transparent, #fff2e8 45%, var(--bfm-atk-strong)); box-shadow: 0 0 ${IS_MOBILE ? '6px 1px' : '10px 2px'} var(--bfm-atk-strong); }
.bfm-blast { position: absolute; width: ${IS_MOBILE ? 16 : 22}px; height: ${IS_MOBILE ? 16 : 22}px; margin: ${IS_MOBILE ? '-8px 0 0 -8px' : '-11px 0 0 -11px'}; border-radius: 50%; opacity: 0; top: 0; left: 0; }
.bfm-blast.def { background: radial-gradient(circle, #fff 0%, var(--bfm-def-strong) 42%, transparent 72%); box-shadow: 0 0 12px 3px var(--bfm-def-strong); }
.bfm-blast.atk { background: radial-gradient(circle, #fff 0%, var(--bfm-atk-strong) 42%, transparent 72%); box-shadow: 0 0 12px 3px var(--bfm-atk-strong); }
.bfm-status {
  position: absolute; inset: 0; z-index: 2; display: flex; align-items: center; justify-content: center;
  background: rgba(5,7,10,0.72); color: #c9d4e4; font-size: 11px; letter-spacing: 0.03em;
}
.bfm-status.is-error { color: #ef9269; }

.bfm-split { margin-top: 6px; }
.bfm-split-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 3px; }
#bfm-split-scope { font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--bfm-ink-faint); }
.bfm-split-bar { height: 4px; border-radius: 2px; overflow: hidden; display: flex; background: rgba(255,255,255,0.08); }
.bfm-split-def { background: var(--bfm-def-strong); }
.bfm-split-atk { background: var(--bfm-atk-strong); }
@media (prefers-reduced-motion: no-preference) { .bfm-split-def, .bfm-split-atk { transition: width 900ms cubic-bezier(.22,.61,.36,1); } }
.bfm-split-nums { display: flex; justify-content: space-between; align-items: baseline; margin-top: 3px; font-size: 10.5px; font-variant-numeric: tabular-nums; }
.bfm-split-nums .d, .bfm-split-nums .a { display: inline-flex; align-items: baseline; gap: 5px; }
.bfm-split-nums .d { color: var(--bfm-def-strong); }
.bfm-split-nums .a { color: var(--bfm-atk-strong); }
.bfm-split-nums b { font-weight: 700; font-size: 11.5px; }
/* I danni assoluti restano visibilmente subordinati alla percentuale
   (colore più tenue, peso normale): sono il dettaglio, non il titolo. */
.bfm-split-nums .dmg { color: #d5dde8; font-weight: 500; opacity: 0.82; }
#bfm-rates { color: var(--bfm-ink-faint); font-size: 10px; }

.bfm-points { margin-top: 8px; }
.bfm-points-target { font-size: 9.5px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--bfm-ink-faint); }
/* Barra unica: due riempimenti ASSOLUTI ancorati ai bordi esterni, che
   crescono l'uno verso l'altro fino a un massimo del 50% ciascuno (si
   toccherebbero esattamente al centro se entrambi arrivassero a
   ROUND_WIN_POINTS, cosa che in pratica non succede: il round finisce
   appena il primo lato ci arriva). */
.bfm-points-track { position: relative; height: 6px; border-radius: 3px; overflow: hidden; background: rgba(255,255,255,0.08); }
.bfm-points-fill { position: absolute; top: 0; bottom: 0; }
.bfm-points-fill.def { left: 0; background: var(--bfm-def-strong); }
.bfm-points-fill.atk { right: 0; background: var(--bfm-atk-strong); }
@media (prefers-reduced-motion: no-preference) { .bfm-points-fill { transition: width 900ms cubic-bezier(.22,.61,.36,1); } }
.bfm-points-mid { position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; margin-left: -0.5px; background: rgba(255,255,255,0.25); z-index: 1; }
/* Riusa lo stesso stile numeri della barra danno sopra (.d/.a già definiti
   in .bfm-split-nums) — stessa gerarchia visiva, un solo posto da cambiare
   se cambia la palette. */

.bfm-momentum {
  margin-top: 7px; padding: 6px 9px; border-radius: 6px; border-left: 3px solid var(--bfm-ink-faint);
  background: rgba(255,255,255,0.045); line-height: 1.35;
}
.bfm-momentum.lead-def { border-left-color: var(--bfm-def-strong); }
.bfm-momentum.lead-atk { border-left-color: var(--bfm-atk-strong); }
/* Rimonta in corso: sfondo appena più caldo — segnala "sta succedendo
   qualcosa" senza urlare, il colore del bordo resta quello di chi guida. */
.bfm-momentum.is-closing { background: rgba(226,172,77,0.10); }
.bfm-momentum-label { display: block; font-size: 9px; letter-spacing: 0.09em; text-transform: uppercase; color: var(--bfm-ink-faint); margin-bottom: 2px; }
.bfm-momentum-text { display: block; font-size: 12.5px; color: #e6edf3; }
.bfm-momentum-eta { color: var(--bfm-front); font-weight: 700; }
`;
