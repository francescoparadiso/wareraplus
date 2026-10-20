/* ══════════════════════════════════════════════════════════════
   WarEra+ — Andamento della battaglia: il grafico esplorabile
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-19): il grafico dell'andamento «è
   interessante ma va reso esplorabile — analizzarlo meglio, allargarlo».
   Una battaglia dura un giorno e il grafico ne mostrava ogni minuto in
   760 unità di viewBox: le barre erano più strette di un pixel, e i
   sorpassi vicini (2-3-4-5 nello stesso quarto d'ora) finivano uno
   sopra l'altro.

   Cosa fa, rispetto al disegno fisso di prima:
   1. ZOOM sull'asse dei tempi — rotella, pizzico, trascinamento per
      scegliere un intervallo, bottoni ± e "Vista intera", e una scorciatoia
      per ogni round. Tutti i grafici della sezione (danno, punti, soldi)
      condividono SEMPRE lo stesso intervallo: è un solo asse x.
   2. SPOSTAMENTO — la striscia di navigazione sotto (tutta la battaglia,
      con la finestra visibile da trascinare), Maiusc+trascina, la rotella
      orizzontale, le frecce; su telefono un dito di lato.
   3. RIQUADRO — ora, danno al minuto dei due lati, punti, round, danno
      del round e i sorpassi che cadono in quel punto.
   4. ALLARGA — il grafico occupa tutta la finestra (non la Fullscreen
      API: su iPhone non esiste per un div), Esc per tornare.
   5. SORPASSI che non si sovrappongono — le etichette troppo vicine si
      raggruppano in una sola ("2–5"); un clic sul gruppo ingrandisce
      quel tratto, e da vicino si separano da sole.

   ── Due grafici, una sezione (2026-10-20) ──────────────────────
   Richiesta dell'utente: i soldi spesi «in un'altra sezione» rispetto ai
   danni, divisi fra attaccanti e difensori, e poter «selezionare che
   linea seguire» in tutta la timeline. Quindi:
   - due STAGE (`data-kind` battle | money), ognuno con barra, striscia e
     "Allarga" suoi, ma lo stesso intervallo: zoomare l'uno sposta
     l'altro, così il tratto guardato è sempre lo stesso;
   - ogni voce della legenda è un INTERRUTTORE (`data-series`). Nel danno:
     difesa, attacco, barre del danno, punti, sorpassi. Nei soldi due
     assi indipendenti: la VOCE (totale, taglia, contratti → il tratto
     della linea) e il LATO (difesa, attacco, somma → il colore). Ogni
     voce accesa si disegna per ogni lato acceso. Di ogni gruppo ne resta
     acceso almeno uno: un grafico vuoto non è una scelta utile. Le scale
     si adattano a ciò che è acceso, il riquadro mostra solo quello.
     Le scelte stanno in localStorage (comodità di chi guarda, come uno
     zoom): sopravvivono al cambio di battaglia e al ricaricamento.

   ⚠️ Si disegna a PIXEL VERI (viewBox = larghezza del contenitore),
   non in un viewBox fisso scalato: scalando, le etichette crescevano a
   13px su uno schermo largo e calavano a 4px su telefono, e i calcoli di
   distanza fra etichette non avrebbero avuto un'unità. Per questo si
   ridisegna a ogni cambio di larghezza (ResizeObserver).

   ⚠️ Da lontano le barre si ACCORPANO a 2px: ogni barra è danno ÷ minuti
   di quel tratto (la media pesata sul tempo, non il massimo). È il dato
   onesto di "danno al minuto" a quella risoluzione; i picchi di un
   singolo minuto ricompaiono ingrandendo, e la scala verticale si adatta
   a ciò che si vede.

   Lo stato (intervallo, "allargato", interruttori) vive qui e sopravvive
   ai repaint della scheda — una battaglia in corso si ridisegna ogni
   tick, e perdere lo zoom ogni due minuti renderebbe lo zoom inutile.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../diplomacy/utils.js';
import { animationsOn } from '../shared/motion.js';
import { tlT } from './timelineI18n.js';

const MIN_SPAN_MS = 8 * 60 * 1000;   // più vicino di così si vedono 8 barre
const BUCKET_PX = 2;                 // sotto, le barre si accorpano
const PAD_L = 46, PAD_R = 12;
const PILL_Y = 10;                   // centro delle etichette dei sorpassi
const A_TOP = 22;                    // sopra: la fascia delle etichette
const M_TOP = 10;                    // grafico dei soldi: niente etichette sopra
const GAP_AB = 16, AXIS_H = 20;
const NAV_H = 30;
const FLIP_NEAR_PX = 7;              // un sorpasso "è in quel punto" entro 7px
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440].map(m => m * 60000);

/* ── Interruttori ─────────────────────────────────────────────── */

// Gruppi: di ognuno resta acceso almeno un elemento disponibile.
const GROUPS = [
  ['def', 'atk'],          // lati del danno
  ['dmg', 'pts'],          // barre del danno / punti del round
  ['mtot', 'mb', 'mc'],    // voci dei soldi
  ['mdef', 'matk', 'msum'], // lati dei soldi
];
const HIDE_KEY = 'wp_btl_tl_hidden';
// Spento di partenza: la somma dei lati (la richiesta è vederli divisi).
const DEFAULT_HIDDEN = ['msum'];

function loadHidden() {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* storage non disponibile: si parte dai valori di base */ }
  return new Set(DEFAULT_HIDDEN);
}
function saveHidden(set) {
  try { localStorage.setItem(HIDE_KEY, JSON.stringify([...set])); } catch { /* niente */ }
}
let _hidden = null;
const hid = (id) => (_hidden || (_hidden = loadHidden())).has(id);

/** Le voci dei soldi che QUESTA battaglia ha: senza salvadanaio la taglia
 *  (e quindi il totale) non si sa; senza aste aggiudicate niente contratti. */
function moneyAvail(id) {
  const m = _st?.an.money;
  if (!m) return false;
  if (id === 'mtot' || id === 'mb') return m.bountyFrom != null;
  if (id === 'mc') return m.hasContracts;
  return true;
}
/** Acceso e disponibile; se un gruppo resterebbe vuoto (scelta fatta su
 *  un'altra battaglia), il primo disponibile si considera acceso. */
function on(id) {
  const group = GROUPS.find(g => g.includes(id));
  const avail = (x) => !x.startsWith('m') || moneyAvail(x);
  if (!avail(id)) return false;
  if (!hid(id)) return true;
  if (!group) return false;   // i sorpassi: da soli, si spengono e basta
  return !group.some(x => avail(x) && !hid(x)) && group.find(avail) === id;
}

function toggleSeries(id) {
  hid(id);
  const group = GROUPS.find(g => g.includes(id));
  const avail = (x) => !x.startsWith('m') || moneyAvail(x);
  if (on(id)) {
    // non si spegne l'ultimo acceso del gruppo
    if (group && !group.some(x => x !== id && on(x))) return false;
    _hidden.add(id);
  } else {
    if (!avail(id)) return false;
    _hidden.delete(id);
  }
  saveHidden(_hidden);
  return true;
}

/* ── Stato ────────────────────────────────────────────────────── */

// key = battleId: cambiando battaglia lo zoom riparte da capo.
let _st = null;
let _cleanup = null;

/** Prepara lo stato e restituisce l'HTML (vuoto: si disegna in wireChart,
 *  quando si conosce la larghezza).
 *  @param kind 'battle' (danno e punti) | 'money' (soldi spesi) */
export function chartBlockHtml(an, tl, { nationName }, kind = 'battle') {
  const key = tl.battleId || tl.createdAt;
  if (!_st || _st.key !== key) _st = { key, view: null, expanded: null, lastW: {} };
  _st.an = an;
  _st.tl = tl;
  _st.nationName = nationName;
  _st.T0 = an.S[0][0];
  _st.T1 = Math.max(an.S[an.S.length - 1][0], _st.T0 + 60000);
  _st.rounds = roundRanges(an.S, _st.T0, _st.T1);
  if (kind === 'money' && !an.money) return '';

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const roundChips = _st.rounds.length > 1 ? _st.rounds.map(r =>
    `<button type="button" class="wp-btl-tl-chipbtn" data-act="round" data-r="${r.r}">${escapeHtml(tlT('roundShort', { r: r.r }))}</button>`).join('') : '';
  const nm = (id) => escapeHtml(nationName(id) || '—');
  const title = tlT(kind === 'money' ? 'moneyTitle' : 'title');

  return `
    <div class="wp-btl-tl-stage${_st.expanded === kind ? ' is-expanded' : ''}" data-kind="${kind}">
      <div class="wp-btl-tl-xtitle">${nm(tl.defender)} <span>vs</span> ${nm(tl.attacker)} · ${escapeHtml(title)}</div>
      <div class="wp-btl-tl-bar">
        <div class="wp-btl-tl-presets">
          <button type="button" class="wp-btl-tl-chipbtn" data-act="reset">${escapeHtml(tlT('fullView'))}</button>
          ${roundChips}
        </div>
        <span class="wp-btl-tl-range" aria-live="polite"></span>
        <div class="wp-btl-tl-tools">
          <button type="button" class="wp-btl-tl-tool" data-act="out" title="${escapeHtml(tlT('zoomOut'))}" aria-label="${escapeHtml(tlT('zoomOut'))}">−</button>
          <button type="button" class="wp-btl-tl-tool" data-act="in" title="${escapeHtml(tlT('zoomIn'))}" aria-label="${escapeHtml(tlT('zoomIn'))}">+</button>
          <button type="button" class="wp-btl-tl-tool wp-btl-tl-expand" data-act="expand"></button>
        </div>
      </div>
      <div class="wp-btl-tl-plot">
        <svg class="wp-btl-tl-main" tabindex="0" role="img" aria-label="${escapeHtml(title)}"></svg>
        <div class="wp-btl-tl-tip" hidden></div>
      </div>
      <svg class="wp-btl-tl-nav" role="img" aria-label="${escapeHtml(tlT('navLabel'))}"></svg>
      <div class="wp-btl-legend">
        ${kind === 'money' ? moneyLegendHtml() : battleLegendHtml()}
        <span class="wp-btl-tl-hint">${escapeHtml(tlT(coarse ? 'hintTouch' : 'hintMouse'))} · ${escapeHtml(tlT('toggleHint'))}</span>
      </div>
    </div>`;
}

function togHtml(id, inner, title = '') {
  const av = !id.startsWith('m') || moneyAvail(id);
  return `<button type="button" class="wp-btl-key wp-btl-tl-tog${on(id) ? '' : ' is-off'}" data-series="${id}"
    aria-pressed="${on(id)}"${av ? '' : ' disabled'}${title || !av ? ` title="${escapeHtml(title || tlT('moneyUnavailable'))}"` : ''}>${inner}</button>`;
}

function battleLegendHtml() {
  return `
    ${togHtml('def', `<i class="wp-btl-tl-swdef"></i>${tlT('defender')}`)}
    ${togHtml('atk', `<i class="wp-btl-tl-swatk"></i>${tlT('attacker')}`)}
    ${togHtml('dmg', `▮ ${tlT('legendDmg')}`)}
    ${togHtml('pts', `╱ ${tlT('legendPts')}`)}
    ${togHtml('flip', `<i class="wp-btl-tl-swflip"></i>${tlT('legendFlip')}`)}`;
}

// Il tratto di una voce, come campione nella legenda e nel riquadro.
function dashSw(v) {
  return `<svg class="wp-btl-tl-dash" width="18" height="6" aria-hidden="true"><line class="wp-btl-tl-m-${v}" x1="1" x2="17" y1="3" y2="3"/></svg>`;
}

function moneyLegendHtml() {
  return `
    <span class="wp-btl-tl-leggrp"><span class="wp-btl-tl-leglbl">${tlT('legendVoce')}:</span>
      ${togHtml('mtot', `${dashSw('tot')}${tlT('moneyTotal')}`)}
      ${togHtml('mb', `${dashSw('b')}${tlT('moneyBounty')}`)}
      ${togHtml('mc', `${dashSw('c')}${tlT('moneyContracts')}`)}</span>
    <span class="wp-btl-tl-leggrp"><span class="wp-btl-tl-leglbl">${tlT('legendSide')}:</span>
      ${togHtml('mdef', `<i class="wp-btl-tl-swdef"></i>${tlT('defender')}`)}
      ${togHtml('matk', `<i class="wp-btl-tl-swatk"></i>${tlT('attacker')}`)}
      ${togHtml('msum', `<i class="wp-btl-tl-swmsum"></i>${tlT('sideSum')}`)}</span>`;
}

export function resetChart() {
  _cleanup?.();
  _cleanup = null;
  _st = null;
}

/** Inizio e fine di ogni round, per le scorciatoie R1, R2… */
function roundRanges(S, T0, T1) {
  const out = [];
  let cur = { r: S[0][1], from: T0 };
  for (let i = 1; i < S.length; i++) {
    if (S[i][1] !== S[i - 1][1]) {
      out.push({ ...cur, to: S[i][0] });
      cur = { r: S[i][1], from: S[i][0] };
    }
  }
  out.push({ ...cur, to: T1 });
  return out;
}
function roundAt(t) {
  const r = _st.rounds.find(rr => t >= rr.from && t < rr.to) || _st.rounds[_st.rounds.length - 1];
  return r?.r;
}

/* ── Formattazione ────────────────────────────────────────────── */

function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
// come nella scheda battaglia: i soldi sono cifre piccole, coi decimali
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}
const _dayKey = (ms) => new Date(ms).toDateString();
function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
function fmtDayClock(ms) {
  return new Date(ms).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/* ── Geometria ────────────────────────────────────────────────── */

function currentView() {
  const v = _st.view;
  if (!v) return { from: _st.T0, to: _st.T1 };
  return v;
}

/** Normalizza un intervallo: dentro la battaglia, non più stretto del
 *  minimo; se copre tutto torna null ("vista intera", che segue una
 *  battaglia in corso man mano che si allunga). */
function clampView(from, to) {
  const { T0, T1 } = _st;
  const full = T1 - T0;
  let span = Math.min(full, Math.max(Math.min(MIN_SPAN_MS, full), to - from));
  if (span >= full - 1000) return null;
  let f = from;
  if (to - from !== span) f = (from + to) / 2 - span / 2;
  f = Math.max(T0, Math.min(T1 - span, f));
  return { from: f, to: f + span };
}

/** Pannelli del danno: A = barre, B = punti. Quello spento non occupa
 *  spazio; l'altro si prende la sua altezza. */
function layoutBattle(W, Hhost, expanded) {
  const narrow = W < 600;
  const showA = on('dmg'), showB = on('pts');
  let aH = showA ? (narrow ? 130 : 168) : 0, bH = showB ? (narrow ? 76 : 92) : 0;
  if (!showA) bH = narrow ? 150 : 200;
  if (!showB) aH = narrow ? 170 : 230;
  const gap = showA && showB ? GAP_AB : 0;
  if (expanded && Hhost) {
    const avail = Math.max(220, Hhost - A_TOP - gap - AXIS_H);
    if (showA && showB) { aH = Math.round(avail * 0.62); bH = avail - aH; }
    else if (showA) aH = avail;
    else bH = avail;
  }
  const B_TOP = A_TOP + aH + gap;
  const BOT = B_TOP + bH;
  return { W, IW: W - PAD_L - PAD_R, aH, bH, B_TOP, BOT, H: BOT + AXIS_H, narrow, showA, showB };
}

function layoutMoney(W, Hhost, expanded) {
  const narrow = W < 600;
  let cH = narrow ? 170 : 220;
  if (expanded && Hhost) cH = Math.max(200, Hhost - M_TOP - AXIS_H);
  const BOT = M_TOP + cH;
  return { W, IW: W - PAD_L - PAD_R, cH, BOT, H: BOT + AXIS_H, narrow };
}

/** Barre accorpate: ogni tratto largo almeno BUCKET_PX è una barra, il
 *  suo valore è danno ÷ minuti del tratto. Un buco (gap) spezza sempre. */
function buckets(iv, from, to, pxPerMs) {
  const out = [];
  let lo = 0, hi = iv.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (iv[m].t1 <= from) lo = m + 1; else hi = m; }
  let cur = null;
  for (let i = Math.max(0, lo - 1); i < iv.length; i++) {
    const v = iv[i];
    if (v.t0 >= to) break;
    if (v.t1 <= from) continue;
    if (v.gap) { cur = null; continue; }
    const key = Math.floor((v.t0 - from) * pxPerMs / BUCKET_PX);
    if (!cur || cur.key !== key) {
      cur = { key, t0: v.t0, t1: v.t1, aSum: 0, dSum: 0, dt: 0, n: 0 };
      out.push(cur);
    }
    const dt = v.t1 - v.t0;
    cur.t1 = v.t1; cur.aSum += v.a * dt; cur.dSum += v.d * dt; cur.dt += dt; cur.n++;
    cur.round = v.round; cur.ad = v.ad; cur.dd = v.dd; cur.ap = v.ap; cur.dp = v.dp;
  }
  for (const b of out) { b.a = b.dt ? b.aSum / b.dt : 0; b.d = b.dt ? b.dSum / b.dt : 0; }
  return out;
}

/** Tacche dell'asse del tempo a passi "tondi" in ora locale. */
function timeTicks(from, to, IW, minGapPx) {
  const span = to - from;
  const want = Math.max(2, Math.floor(IW / minGapPx));
  const step = TICK_STEPS.find(s => span / s <= want) || TICK_STEPS[TICK_STEPS.length - 1];
  const off = new Date(from).getTimezoneOffset() * 60000;
  const out = [];
  for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) out.push(t);
  return out;
}

/** L'asse del tempo sotto l'ultimo pannello: con il giorno sulla prima
 *  tacca e quando cambia data. */
function xAxisHtml(from, to, x, L) {
  const x0 = PAD_L, x1 = PAD_L + L.IW;
  const ticks = timeTicks(from, to, L.IW, L.narrow ? 62 : 96);
  const multiDay = _dayKey(from) !== _dayKey(to);
  let prevDay = null;
  return ticks.map((t, i) => {
    const day = _dayKey(t);
    const txt = multiDay && (i === 0 || day !== prevDay) ? fmtDayClock(t) : fmtClock(t);
    prevDay = day;
    const est = txt.length * 5.4;
    let xx = x(t), anchor = 'middle';
    if (xx - est / 2 < x0) { xx = Math.max(x0, xx - 2); anchor = 'start'; }
    else if (xx + est / 2 > x1) { xx = Math.min(x1, xx + 2); anchor = 'end'; }
    return `<line class="wp-btl-tl-tick" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${L.BOT}" y2="${L.BOT + 3}"/>`
      + `<text class="wp-btl-axislbl" x="${xx.toFixed(1)}" y="${L.H - 5}" text-anchor="${anchor}">${escapeHtml(txt)}</text>`;
  }).join('');
}

/** Etichette dei sorpassi: quelle che si toccherebbero diventano un
 *  gruppo solo. Si ripete finché nessuna pillola si sovrappone (un gruppo
 *  allargandosi può toccare il vicino). */
function flipClusters(flips, x, x0, x1) {
  let cl = [];
  flips.forEach((f, i) => {
    const xx = x(f.t);
    if (xx < x0 - 1 || xx > x1 + 1) return;
    cl.push({ idx: [i], xs: [xx] });
  });
  const label = (c) => c.idx.length === 1 ? String(c.idx[0] + 1) : `${c.idx[0] + 1}–${c.idx[c.idx.length - 1] + 1}`;
  const width = (c) => Math.max(14, label(c).length * 5.6 + 8);
  const center = (c) => (c.xs[0] + c.xs[c.xs.length - 1]) / 2;
  for (let changed = true; changed;) {
    changed = false;
    for (let i = 1; i < cl.length; i++) {
      const a = cl[i - 1], b = cl[i];
      if (center(b) - width(b) / 2 < center(a) + width(a) / 2 + 2) {
        cl.splice(i - 1, 2, { idx: a.idx.concat(b.idx), xs: a.xs.concat(b.xs) });
        changed = true;
        break;
      }
    }
  }
  return cl.map(c => {
    const w = width(c);
    // la pillola resta dentro il grafico anche se il sorpasso è sul bordo
    const cx = Math.max(x0 + w / 2, Math.min(x1 - w / 2, center(c)));
    return { idx: c.idx, cx, w, label: label(c) };
  });
}

/** Le linee verticali dei cambi di round (con etichetta) e dei sorpassi,
 *  comuni ai due grafici: sono i riferimenti per leggerli insieme. */
function marksHtml(from, to, x, top, bot, labelY, flipTop = top) {
  const x0 = PAD_L;
  const rounds = _st.rounds.slice(1).filter(r => r.from >= from && r.from <= to).map(r => {
    const xx = x(r.from).toFixed(1);
    return `<line class="wp-btl-tl-round" x1="${xx}" x2="${xx}" y1="${top}" y2="${bot}"/>`
      + `<text class="wp-btl-axislbl" x="${(+xx + 3).toFixed(1)}" y="${labelY}">${escapeHtml(tlT('roundShort', { r: r.r }))}</text>`;
  }).join('');
  const flips = !on('flip') ? '' : _st.an.flips.map(f => {
    const xx = x(f.t);
    if (xx < x0 - 1 || xx > x(to) + 1) return '';
    return `<line class="wp-btl-tl-flip" x1="${xx.toFixed(1)}" x2="${xx.toFixed(1)}" y1="${flipTop}" y2="${bot}"/>`;
  }).join('');
  return rounds + flips;
}

/* ── Soldi spesi ──────────────────────────────────────────────── */

// pts: [t, taglia difesa, taglia attacco, contratti difesa, contratti attacco],
// cumulati (battleTimeline.js: analyzeMoney).

/** Il punto in vigore all'istante t (l'ultimo con tempo <= t). */
function moneyAt(m, t) {
  const P = m.pts;
  if (t < P[0][0]) return P[0];
  let lo = 0, hi = P.length - 1;
  while (lo < hi) { const k = (lo + hi + 1) >> 1; if (P[k][0] <= t) lo = k; else hi = k - 1; }
  return P[lo];
}

const VOCI = [['tot', 'mtot'], ['b', 'mb'], ['c', 'mc']];
const LATI = [['def', 'mdef'], ['atk', 'matk'], ['sum', 'msum']];

/** Il valore di una voce per un lato, in un punto. */
function mVal(v, s, p) {
  const b = s === 'def' ? p[1] : s === 'atk' ? p[2] : p[1] + p[2];
  const c = s === 'def' ? p[3] : s === 'atk' ? p[4] : p[3] + p[4];
  return v === 'b' ? b : v === 'c' ? c : b + c;
}
/** Le linee accese: ogni voce accesa per ogni lato acceso. */
function moneyLines() {
  const out = [];
  for (const [v, vid] of VOCI) {
    if (!on(vid)) continue;
    for (const [s, sid] of LATI) if (on(sid)) out.push({ v, s });
  }
  return out;
}

/** Le linee, a gradini: sono cumulati, fra due letture il valore resta
 *  quello della lettura prima. La scala va da 0 al valore più alto fra le
 *  linee accese alla fine del tratto visibile (sono cumulati: il massimo
 *  è sempre in fondo), come il danno si adatta a ciò che si vede.
 *  Taglia e totale partono da bountyFrom: prima la taglia non si sa, e un
 *  totale fatto di soli contratti si leggerebbe come "taglia zero". */
function moneyPaths(m, from, to, x, top, h) {
  const lines = moneyLines();
  const end = moneyAt(m, to);
  const max = Math.max(1, ...lines.map(l => mVal(l.v, l.s, end)));
  const yM = (v) => top + h - v / max * (h - 4);
  const xL = x(from) - 2, xR = x(to) + 2;
  const path = (val, start) => {
    const P = m.pts;
    let d = '';
    for (let i = 0; i < P.length; i++) {
      const t = P[i][0];
      if (start != null && t < start) continue;
      if (t > to) break;
      // un punto superato dal successivo prima di "from" non si vede
      if (i + 1 < P.length && P[i + 1][0] <= from && !(start != null && P[i + 1][0] < start)) continue;
      const xx = Math.max(xL, x(t)).toFixed(1);
      const yy = yM(val(P[i])).toFixed(1);
      d += d ? `H${xx}V${yy}` : `M${xx} ${yy}`;
    }
    if (d) d += `H${Math.min(xR, x(m.pts[m.pts.length - 1][0])).toFixed(1)}`;
    return d;
  };
  const svg = `
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${top + 8}" text-anchor="end">${fmtMoney(max)}</text>
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${top + h}" text-anchor="end">0</text>
    <g clip-path="url(#wp-btl-tl-clip-money)">
      ${lines.map(l => `<path class="wp-btl-tl-m wp-btl-tl-m-${l.v} wp-btl-tl-ms-${l.s}" d="${path(p => mVal(l.v, l.s, p), l.v === 'c' ? null : m.bountyFrom)}"/>`).join('')}
    </g>`;
  return { svg, yM, lines };
}

/* ── Disegno ──────────────────────────────────────────────────── */

const _geo = {};   // l'ultimo disegno di ogni grafico, per riquadro e gesti

function draw(stage) {
  const kind = stage.dataset.kind;
  const svg = stage.querySelector('.wp-btl-tl-main');
  const host = stage.querySelector('.wp-btl-tl-plot');
  if (!svg || !host || !_st) return;
  const W = Math.max(280, Math.round(host.clientWidth));
  _st.lastW[kind] = W;
  const expanded = _st.expanded === kind;
  const { from, to } = currentView();
  if (kind === 'money') drawMoney(stage, svg, W, expanded ? host.clientHeight : 0, from, to);
  else drawBattle(stage, svg, W, expanded ? host.clientHeight : 0, from, to);
  drawNav(stage, W, from, to);
  updateBar(stage, from, to);
}

function drawBattle(stage, svg, W, Hhost, from, to) {
  const L = layoutBattle(W, Hhost, _st.expanded === 'battle');
  const { IW, aH, bH, B_TOP, BOT, H } = L;
  const { an } = _st;
  const pxPerMs = IW / (to - from);
  const x = (t) => PAD_L + (t - from) * pxPerMs;
  const x0 = PAD_L, x1 = PAD_L + IW;
  const showD = on('def'), showT = on('atk');

  const bk = buckets(an.iv, from, to, pxPerMs);
  const maxRate = Math.max(1, ...bk.flatMap(b => [showD ? b.d : 0, showT ? b.a : 0]));
  const mid = A_TOP + aH / 2;
  const half = aH / 2 - 2;
  const maxPts = Math.max(300, ...an.S.map(s => Math.max(showT ? s[5] : 0, showD ? s[6] : 0)));
  const yP = (p) => B_TOP + bH - p / maxPts * bH;

  // Barre: un <path> per lato invece di un <rect> per minuto (una
  // battaglia di un giorno sono 1.400 minuti, e qui si ridisegna a ogni
  // scatto di rotella).
  let pd = '', pa = '';
  if (L.showA) {
    for (const b of bk) {
      const bx = Math.max(x0, x(b.t0));
      const bw = Math.max(0.8, Math.min(x1, x(b.t1)) - bx - (b.n === 1 && pxPerMs * (b.t1 - b.t0) > 4 ? 0.6 : 0));
      const hd = showD ? b.d / maxRate * half : 0, ha = showT ? b.a / maxRate * half : 0;
      if (hd > 0.05) pd += `M${bx.toFixed(1)} ${(mid - hd).toFixed(1)}h${bw.toFixed(1)}V${mid.toFixed(1)}h${(-bw).toFixed(1)}Z`;
      if (ha > 0.05) pa += `M${bx.toFixed(1)} ${mid.toFixed(1)}h${bw.toFixed(1)}v${ha.toFixed(1)}h${(-bw).toFixed(1)}Z`;
    }
  }

  // Punti: spezzate per round e per lato, interrotte dai buchi; solo il
  // tratto visibile più un campione per parte (la linea entra dal bordo).
  const lines = { a: [], d: [] };
  if (L.showB) {
    const S = an.S;
    let lo = 0;
    while (lo < S.length - 1 && S[lo + 1][0] < from) lo++;
    let hi = S.length - 1;
    while (hi > 0 && S[hi - 1][0] > to) hi--;
    let segA = [], segD = [];
    const flush = () => {
      if (segA.length > 1) lines.a.push(segA.join(' '));
      if (segD.length > 1) lines.d.push(segD.join(' '));
      segA = []; segD = [];
    };
    for (let i = lo; i <= hi; i++) {
      const s = S[i], p = S[i - 1];
      if (i > lo && p && (p[1] !== s[1] || s[0] - p[0] > an.gapMs)) flush();
      const xx = x(s[0]).toFixed(1);
      segA.push(`${xx},${yP(s[5]).toFixed(1)}`);
      segD.push(`${xx},${yP(s[6]).toFixed(1)}`);
    }
    flush();
  }

  const clusters = on('flip') ? flipClusters(an.flips, x, x0, x1) : [];
  const pills = clusters.map((c, ci) => {
    const multi = c.idx.length > 1;
    // gambetta dal gruppo a ogni sorpasso, perché la pillola non sta più
    // sopra la sua linea
    const legs = multi ? c.idx.map(i => {
      const fx = Math.max(x0, Math.min(x1, x(an.flips[i].t))).toFixed(1);
      return `<path class="wp-btl-tl-leg" d="M${c.cx.toFixed(1)} ${PILL_Y + 6}L${fx} ${A_TOP}"/>`;
    }).join('') : '';
    return `${legs}<g class="wp-btl-tl-pill${multi ? ' is-group' : ''}" data-cl="${ci}" tabindex="-1">
        <rect x="${(c.cx - c.w / 2).toFixed(1)}" y="${PILL_Y - 7}" width="${c.w.toFixed(1)}" height="14" rx="7"/>
        <text x="${c.cx.toFixed(1)}" y="${PILL_Y + 3}">${c.label}</text>
      </g>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.innerHTML = `
    <defs><clipPath id="wp-btl-tl-clip"><rect x="${x0}" y="0" width="${IW}" height="${H}"/></clipPath></defs>
    ${L.showA ? `
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${A_TOP + 9}" text-anchor="end">${fmtNum(maxRate)}</text>
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${A_TOP + aH - 2}" text-anchor="end">${fmtNum(maxRate)}</text>
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${mid + 3}" text-anchor="end">0</text>
    <line class="wp-btl-axis" x1="${x0}" x2="${x1}" y1="${mid}" y2="${mid}"/>
    <path class="wp-btl-tl-def" d="${pd}"/>
    <path class="wp-btl-tl-atk" d="${pa}"/>` : ''}
    ${L.showB ? `
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${B_TOP + 8}" text-anchor="end">${maxPts}</text>
    <text class="wp-btl-axislbl" x="${PAD_L - 4}" y="${B_TOP + bH}" text-anchor="end">0</text>
    <line class="wp-btl-tl-goal" x1="${x0}" x2="${x1}" y1="${yP(300).toFixed(1)}" y2="${yP(300).toFixed(1)}"/>
    <g clip-path="url(#wp-btl-tl-clip)">
      ${showD ? lines.d.map(pts => `<polyline class="wp-btl-tl-pdef" points="${pts}"/>`).join('') : ''}
      ${showT ? lines.a.map(pts => `<polyline class="wp-btl-tl-patk" points="${pts}"/>`).join('') : ''}
    </g>` : ''}
    <line class="wp-btl-axis" x1="${x0}" x2="${x1}" y1="${BOT}" y2="${BOT}"/>
    ${marksHtml(from, to, x, A_TOP, BOT, (L.showB ? B_TOP : A_TOP) + 9, PILL_Y + 7)}
    ${xAxisHtml(from, to, x, L)}
    <rect class="wp-btl-tl-brush" x="0" y="${A_TOP}" width="0" height="${BOT - A_TOP}" visibility="hidden"/>
    <line class="wp-btl-tl-cursor" x1="0" x2="0" y1="${A_TOP}" y2="${BOT}" visibility="hidden"/>
    <circle class="wp-btl-tl-dot wp-btl-tl-dotdef" r="3.2" cx="0" cy="0" visibility="hidden"/>
    <circle class="wp-btl-tl-dot wp-btl-tl-dotatk" r="3.2" cx="0" cy="0" visibility="hidden"/>
    <rect class="wp-btl-tl-hit" x="${x0}" y="${A_TOP}" width="${IW}" height="${BOT - A_TOP}"/>
    ${pills}`;

  _geo.battle = { from, to, pxPerMs, x0, x1, IW, bk, clusters, yP, showB: L.showB, H };
}

function drawMoney(stage, svg, W, Hhost, from, to) {
  const L = layoutMoney(W, Hhost, _st.expanded === 'money');
  const { IW, cH, BOT, H } = L;
  const pxPerMs = IW / (to - from);
  const x = (t) => PAD_L + (t - from) * pxPerMs;
  const x0 = PAD_L, x1 = PAD_L + IW;
  const money = moneyPaths(_st.an.money, from, to, x, M_TOP, cH);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.innerHTML = `
    <defs><clipPath id="wp-btl-tl-clip-money"><rect x="${x0}" y="0" width="${IW}" height="${H}"/></clipPath></defs>
    ${marksHtml(from, to, x, M_TOP, BOT, M_TOP + 9)}
    ${money.svg}
    <line class="wp-btl-axis" x1="${x0}" x2="${x1}" y1="${BOT}" y2="${BOT}"/>
    ${xAxisHtml(from, to, x, L)}
    <rect class="wp-btl-tl-brush" x="0" y="${M_TOP}" width="0" height="${cH}" visibility="hidden"/>
    <line class="wp-btl-tl-cursor" x1="0" x2="0" y1="${M_TOP}" y2="${BOT}" visibility="hidden"/>
    ${money.lines.map(l => `<circle class="wp-btl-tl-dot wp-btl-tl-mdot wp-btl-tl-mdot-${l.s}" data-v="${l.v}" data-s="${l.s}" r="3" cx="0" cy="0" visibility="hidden"/>`).join('')}
    <rect class="wp-btl-tl-hit" x="${x0}" y="${M_TOP}" width="${IW}" height="${cH}"/>`;

  _geo.money = { from, to, pxPerMs, x0, x1, IW, clusters: [], yM: money.yM, H };
}

/** La striscia di navigazione: tutta la battaglia, i round, i sorpassi e
 *  la finestra visibile. Sotto il danno l'area è il danno dei lati accesi;
 *  sotto i soldi è quanto si è speso in tutto, cumulato. */
function drawNav(stage, W, from, to) {
  const nav = stage.querySelector('.wp-btl-tl-nav');
  if (!nav) return;
  const kind = stage.dataset.kind;
  const { T0, T1, an } = _st;
  const IW = W - PAD_L - PAD_R;
  const pxPerMs = IW / (T1 - T0);
  const x = (t) => PAD_L + (t - T0) * pxPerMs;
  const top = 3, h = NAV_H - 6;
  let d = '';
  if (kind === 'money') {
    const m = an.money;
    const max = Math.max(1, mVal('tot', 'sum', m.pts[m.pts.length - 1]));
    d = `M${x(T0).toFixed(1)} ${top + h}`;
    for (const p of m.pts) d += `H${x(p[0]).toFixed(1)}V${(top + h - mVal('tot', 'sum', p) / max * h).toFixed(1)}`;
    d += `H${x(T1).toFixed(1)}V${top + h}Z`;
  } else {
    const bk = buckets(an.iv, T0, T1, pxPerMs);
    const sum = (b) => (on('def') ? b.d : 0) + (on('atk') ? b.a : 0);
    const max = Math.max(1, ...bk.map(sum));
    for (const b of bk) {
      const hh = sum(b) / max * h;
      if (hh > 0.1) d += `M${x(b.t0).toFixed(1)} ${(top + h).toFixed(1)}v${(-hh).toFixed(1)}h${Math.max(0.8, x(b.t1) - x(b.t0)).toFixed(1)}v${hh.toFixed(1)}Z`;
    }
  }
  const rounds = _st.rounds.slice(1).map(r => `<line class="wp-btl-tl-round" x1="${x(r.from).toFixed(1)}" x2="${x(r.from).toFixed(1)}" y1="${top}" y2="${top + h}"/>`).join('');
  const flips = on('flip') ? an.flips.map(f => `<line class="wp-btl-tl-navflip" x1="${x(f.t).toFixed(1)}" x2="${x(f.t).toFixed(1)}" y1="${top}" y2="${top + 5}"/>`).join('') : '';
  const wx0 = x(from), wx1 = x(to);
  const zoomed = Boolean(_st.view);
  nav.setAttribute('viewBox', `0 0 ${W} ${NAV_H}`);
  nav.setAttribute('width', W);
  nav.setAttribute('height', NAV_H);
  nav.innerHTML = `
    <rect class="wp-btl-tl-navbg" x="${PAD_L}" y="${top}" width="${IW}" height="${h}" rx="3"/>
    <path class="wp-btl-tl-navarea" d="${d}"/>
    ${rounds}${flips}
    ${zoomed ? `<rect class="wp-btl-tl-navdim" x="${PAD_L}" y="${top}" width="${Math.max(0, wx0 - PAD_L).toFixed(1)}" height="${h}"/>
    <rect class="wp-btl-tl-navdim" x="${wx1.toFixed(1)}" y="${top}" width="${Math.max(0, PAD_L + IW - wx1).toFixed(1)}" height="${h}"/>` : ''}
    <rect class="wp-btl-tl-navwin${zoomed ? ' is-zoomed' : ''}" x="${wx0.toFixed(1)}" y="${top - 1}" width="${Math.max(2, wx1 - wx0).toFixed(1)}" height="${h + 2}" rx="3"/>
    ${zoomed ? `<rect class="wp-btl-tl-navgrip" x="${(wx0 - 2).toFixed(1)}" y="${top + h / 2 - 6}" width="4" height="12" rx="2"/>
    <rect class="wp-btl-tl-navgrip" x="${(wx1 - 2).toFixed(1)}" y="${top + h / 2 - 6}" width="4" height="12" rx="2"/>` : ''}
    <rect class="wp-btl-tl-navbrush" x="0" y="${top - 1}" width="0" height="${h + 2}" visibility="hidden"/>`;
  _geo[kind].nav = { x, T0, T1, pxPerMs, wx0, wx1 };
}

/** Bottoni, intervallo scritto, stato "allargato" e interruttori. */
function updateBar(stage, from, to) {
  const zoomed = Boolean(_st.view);
  const kind = stage.dataset.kind;
  const range = stage.querySelector('.wp-btl-tl-range');
  if (range) {
    range.textContent = zoomed
      ? (_dayKey(from) === _dayKey(to) ? `${fmtDayClock(from)} – ${fmtClock(to)}` : `${fmtDayClock(from)} – ${fmtDayClock(to)}`)
      : '';
  }
  stage.querySelectorAll('[data-act="reset"]').forEach(b => b.classList.toggle('active', !zoomed));
  stage.querySelectorAll('[data-act="round"]').forEach(b => {
    const r = _st.rounds.find(rr => String(rr.r) === b.dataset.r);
    const v = r && roundView(r);
    b.classList.toggle('active', Boolean(zoomed && v && Math.abs(v.from - from) < 60000 && Math.abs(v.to - to) < 60000));
  });
  const out = stage.querySelector('[data-act="out"]');
  if (out) out.disabled = !zoomed;
  const inn = stage.querySelector('[data-act="in"]');
  if (inn) inn.disabled = to - from <= MIN_SPAN_MS + 1000;
  const ex = stage.querySelector('[data-act="expand"]');
  if (ex) {
    const isEx = _st.expanded === kind;
    const lbl = tlT(isEx ? 'collapse' : 'expand');
    ex.innerHTML = `<span aria-hidden="true">${isEx ? '⤡' : '⤢'}</span> ${escapeHtml(lbl)}`;
    ex.setAttribute('aria-pressed', String(isEx));
  }
  stage.querySelectorAll('[data-series]').forEach(b => {
    const v = on(b.dataset.series);
    b.classList.toggle('is-off', !v);
    b.setAttribute('aria-pressed', String(v));
  });
}

function roundView(r) {
  const pad = (r.to - r.from) * 0.02;
  return clampView(r.from - pad, r.to + pad) || { from: _st.T0, to: _st.T1 };
}

/* ── Riquadro ─────────────────────────────────────────────────── */

function flipLineHtml(i) {
  const f = _st.an.flips[i];
  const leader = f.side === 'attacker' ? _st.tl.attacker : _st.tl.defender;
  return `<div class="wp-btl-tl-tipflip wp-btl-tl-${f.side}"><span class="wp-btl-tl-tipnum">${i + 1}</span>`
    + `${tlT('flipLine', { n: escapeHtml(_st.nationName(leader) || '—'), r: f.round })}`
    + ` <em>${escapeHtml(fmtClock(f.t))}</em></div>`;
}

function nearFlips(g, px) {
  if (!on('flip')) return [];
  const near = [];
  _st.an.flips.forEach((f, i) => {
    if (Math.abs(g.x0 + (f.t - g.from) * g.pxPerMs - px) <= FLIP_NEAR_PX) near.push(i);
  });
  return near;
}

function dayPrefix(g, t) {
  return _dayKey(g.from) !== _dayKey(g.to)
    ? `${new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })}, ` : '';
}

/** Riquadro del danno: { html, dots:[{cls, y}] } o null. */
function battleTipAt(px) {
  const g = _geo.battle;
  if (!g || px < g.x0 || px > g.x1) return null;
  const t = g.from + (px - g.x0) / g.pxPerMs;
  // la barra sotto il cursore (o la più vicina entro 3px: fra due barre
  // accorpate c'è uno spiraglio)
  let b = null;
  for (const bb of g.bk) {
    const bx0 = g.x0 + (bb.t0 - g.from) * g.pxPerMs, bx1 = g.x0 + (bb.t1 - g.from) * g.pxPerMs;
    if (px >= bx0 - 3 && px <= bx1 + 3) { b = bb; if (px >= bx0 && px <= bx1) break; }
    if (bx0 > px + 3) break;
  }
  const near = nearFlips(g, px);
  if (!b && !near.length) return null;
  const head = b
    ? (b.n > 1 ? `${fmtClock(b.t0)}–${fmtClock(b.t1)}` : fmtClock(b.t1))
    : fmtClock(t);
  const dmg = on('dmg'), pts = on('pts');
  const row = (side) => {
    const isD = side === 'defender';
    const parts = [];
    if (dmg) parts.push(`<b>${fmtNum(isD ? b.d : b.a)}${tlT('perMin')}</b>`);
    if (pts) parts.push(`${isD ? b.dp : b.ap} ${tlT('points')}`);
    return `<div><i class="wp-btl-tl-sw${isD ? 'def' : 'atk'}"></i>${tlT(side)}: ${parts.join(' · ')}</div>`;
  };
  const dots = [];
  if (b && g.showB) {
    if (on('def')) dots.push({ cls: '.wp-btl-tl-dotdef', y: g.yP(b.dp) });
    if (on('atk')) dots.push({ cls: '.wp-btl-tl-dotatk', y: g.yP(b.ap) });
  }
  return {
    dots,
    html: `
      <div class="wp-btl-tl-tiphead">${escapeHtml(dayPrefix(g, b ? b.t1 : t) + head)}${b ? ` · ${tlT('tipRound', { r: b.round })}` : ''}</div>
      ${b ? `
      ${on('def') ? row('defender') : ''}
      ${on('atk') ? row('attacker') : ''}
      ${dmg ? `<div class="wp-btl-tl-tipsub">${tlT('tipRoundDmg')}: ${fmtNum(b.dd)} · ${fmtNum(b.ad)}</div>` : ''}
      ${b.n > 1 ? `<div class="wp-btl-tl-tipsub">${tlT('tipAvg', { n: b.n })}</div>` : ''}` : ''}
      ${near.map(flipLineHtml).join('')}`,
  };
}

/** Riquadro dei soldi: una tabellina voce × lato, solo ciò che è acceso. */
function moneyTipAt(px) {
  const g = _geo.money;
  if (!g || px < g.x0 || px > g.x1) return null;
  const m = _st.an.money;
  const t = g.from + (px - g.x0) / g.pxPerMs;
  const p = moneyAt(m, t);
  const knowB = m.bountyFrom != null && t >= m.bountyFrom;
  const sides = LATI.filter(([, id]) => on(id)).map(([s]) => s);
  const voci = VOCI.filter(([, id]) => on(id)).map(([v]) => v);
  const sideLbl = { def: tlT('defShort'), atk: tlT('atkShort'), sum: tlT('sideSum') };
  const vLbl = { tot: tlT('moneyTotal'), b: tlT('moneyBounty'), c: tlT('moneyContracts') };
  const known = (v) => v === 'c' || knowB;
  const dots = [];
  for (const v of voci) for (const s of sides) {
    if (known(v)) dots.push({ cls: `.wp-btl-tl-mdot[data-v="${v}"][data-s="${s}"]`, y: g.yM(mVal(v, s, p)) });
  }
  const near = nearFlips(g, px);
  return {
    dots,
    html: `
      <div class="wp-btl-tl-tiphead">${escapeHtml(dayPrefix(g, t) + fmtClock(t))} · ${tlT('tipRound', { r: roundAt(t) })}</div>
      <div class="wp-btl-tl-tipsub">${tlT('moneyTipHead')}</div>
      <table class="wp-btl-tl-tiptab">
        <tr><th></th>${sides.map(s => `<th class="wp-btl-tl-tt-${s}">${escapeHtml(sideLbl[s])}</th>`).join('')}</tr>
        ${voci.map(v => `<tr><td>${dashSw(v)}${escapeHtml(vLbl[v])}</td>${
          sides.map(s => `<td>${known(v) ? fmtMoney(mVal(v, s, p)) : '—'}</td>`).join('')}</tr>`).join('')}
      </table>
      ${near.map(flipLineHtml).join('')}`,
  };
}

/* ── Gesti ────────────────────────────────────────────────────── */

export function wireChart(root) {
  _cleanup?.();
  _cleanup = null;
  const stages = [...root.querySelectorAll('.wp-btl-tl-stage')];
  if (!stages.length || !_st) return;
  const offs = [];
  const on_ = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };

  // Un solo ridisegno per fotogramma, per TUTTI i grafici: l'intervallo è
  // uno, e quello che non si tocca deve seguire.
  let raf = 0;
  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      for (const st of stages) if (st.isConnected) draw(st);
    });
  };
  const drawAll = () => { for (const st of stages) if (st.isConnected) draw(st); };
  const hides = [];
  const hideAllTips = () => hides.forEach(f => f());

  let tween = 0;
  const setView = (v, { animate = false } = {}) => {
    cancelAnimationFrame(tween);
    hideAllTips();
    if (!animate || !animationsOn()) { _st.view = v; redraw(); return; }
    const a = currentView();
    const b = v || { from: _st.T0, to: _st.T1 };
    const start = performance.now(), dur = 240;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      _st.view = k < 1 ? { from: a.from + (b.from - a.from) * e, to: a.to + (b.to - a.to) * e } : v;
      drawAll();
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  };

  // L'overlay della sezione sta a z-index 6000, sotto le barre del menu
  // (7000): un figlio `position: fixed` non può uscire da quel piano, per
  // quanto alto sia il suo z-index. Da allargato si alza l'overlay intero.
  const raiseHost = stages[0].closest('.wp-political-overlay');
  const raise = (v) => raiseHost?.classList.toggle('wp-btl-tl-raised', v);
  raise(Boolean(_st.expanded));
  const toggleExpanded = (kind) => {
    _st.expanded = _st.expanded === kind ? null : kind;
    raise(Boolean(_st.expanded));
    hideAllTips();
    for (const st of stages) st.classList.toggle('is-expanded', st.dataset.kind === _st.expanded);
    drawAll();
    const st = stages.find(s => s.dataset.kind === kind);
    if (_st.expanded) st?.querySelector('.wp-btl-tl-main')?.focus({ preventScroll: true });
    else st?.scrollIntoView({ block: 'nearest' });
  };
  on_(document, 'keydown', (e) => {
    if (e.key === 'Escape' && _st?.expanded && stages[0].isConnected) {
      e.stopPropagation();
      toggleExpanded(_st.expanded);
    }
  }, true);

  for (const stage of stages) wireStage(stage, { on: on_, redraw, setView, hides, toggleExpanded, drawAll });
  drawAll();

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => {
      if (!_st) return;
      if (_st.expanded || stages.some(st => Math.abs(st.querySelector('.wp-btl-tl-plot').clientWidth - (_st.lastW[st.dataset.kind] || 0)) >= 1)) redraw();
    })
    : null;
  for (const st of stages) ro?.observe(st.querySelector('.wp-btl-tl-plot'));

  _cleanup = () => {
    offs.forEach(f => f());
    raise(false);
    ro?.disconnect();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(tween);
  };
}

function wireStage(stage, { on, redraw, setView, hides, toggleExpanded, drawAll }) {
  const kind = stage.dataset.kind;
  const svg = stage.querySelector('.wp-btl-tl-main');
  const nav = stage.querySelector('.wp-btl-tl-nav');
  const tip = stage.querySelector('.wp-btl-tl-tip');
  const plot = stage.querySelector('.wp-btl-tl-plot');
  const G = () => _geo[kind];

  const zoomAt = (t, factor, opt) => {
    const { from, to } = currentView();
    const span = to - from;
    const ns = Math.max(MIN_SPAN_MS, span * factor);
    setView(clampView(t - (t - from) * ns / span, t - (t - from) * ns / span + ns), opt);
  };
  const panBy = (dt) => {
    if (!_st.view) return;
    const { from, to } = _st.view;
    setView(clampView(from + dt, to + dt));
  };
  // il puntatore può essere già sparito (dito alzato fra due eventi): la
  // cattura è un di più, non deve far saltare il gesto
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* niente */ } };
  const svgX = (e) => e.clientX - svg.getBoundingClientRect().left;
  const tAt = (px) => G().from + (px - G().x0) / G().pxPerMs;

  /* riquadro */
  let pinned = false;
  function hideTip() {
    tip.hidden = true;
    pinned = false;
    svg.querySelectorAll('.wp-btl-tl-cursor, .wp-btl-tl-dot').forEach(el => el.setAttribute('visibility', 'hidden'));
  }
  hides.push(hideTip);
  const showTip = (px, clientY, html, dots = []) => {
    const cursor = svg.querySelector('.wp-btl-tl-cursor');
    cursor?.setAttribute('x1', px.toFixed(1));
    cursor?.setAttribute('x2', px.toFixed(1));
    cursor?.setAttribute('visibility', 'visible');
    svg.querySelectorAll('.wp-btl-tl-dot').forEach(el => el.setAttribute('visibility', 'hidden'));
    for (const d of dots) {
      const el = svg.querySelector(d.cls);
      if (!el) continue;
      el.setAttribute('cx', px.toFixed(1)); el.setAttribute('cy', d.y.toFixed(1)); el.setAttribute('visibility', 'visible');
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const pr = plot.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const cx = sr.left - pr.left + px;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = cx + 14;
    if (left + w > pr.width) left = cx - w - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    const y = clientY - pr.top - 10;
    tip.style.top = `${Math.max(0, Math.min(pr.height - h, y))}px`;
  };
  const tipAtPointer = (e) => {
    const pill = e.target.closest?.('.wp-btl-tl-pill');
    if (pill) {
      const c = G().clusters[+pill.dataset.cl];
      if (!c) return hideTip();
      const html = c.idx.map(flipLineHtml).join('')
        + (c.idx.length > 1 ? `<div class="wp-btl-tl-tipsub">${tlT('clusterHint')}</div>` : '');
      showTip(c.cx, e.clientY, html);
      return;
    }
    const px = svgX(e);
    const r = kind === 'money' ? moneyTipAt(px) : battleTipAt(px);
    if (!r) return hideTip();
    showTip(px, e.clientY, r.html, r.dots);
  };

  /* clic su un'etichetta: il gruppo si ingrandisce, il singolo porta
     alla sua riga nella lista dei sorpassi */
  const pillClick = (pill) => {
    const c = G().clusters[+pill.dataset.cl];
    if (!c) return;
    const ts = c.idx.map(i => _st.an.flips[i].t);
    if (c.idx.length > 1) {
      const a = Math.min(...ts), b = Math.max(...ts);
      const pad = Math.max((b - a) * 0.6, 4 * 60000);
      setView(clampView(a - pad, b + pad), { animate: true });
      return;
    }
    if (_st.expanded) return;
    const row = stage.parentElement?.querySelector(`.wp-btl-tl-fliprow[data-flip="${c.idx[0]}"]`);
    if (!row) return;
    row.scrollIntoView({ behavior: animationsOn() ? 'smooth' : 'auto', block: 'center' });
    row.classList.remove('wp-btl-tl-flash');
    void row.offsetWidth;
    row.classList.add('wp-btl-tl-flash');
  };

  /* puntatori sul grafico */
  const pts = new Map();     // pointerId -> {x, y}
  let drag = null;           // { mode: 'brush'|'pan'|'pinch'|'tap'|'pill', ... }
  const brushEl = () => svg.querySelector('.wp-btl-tl-brush');

  on(svg, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pill = e.target.closest?.('.wp-btl-tl-pill');
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [p1, p2] = [...pts.values()];
      const sr = svg.getBoundingClientRect();
      const cx = (p1.x + p2.x) / 2 - sr.left;
      drag = { mode: 'pinch', d0: Math.max(20, Math.abs(p1.x - p2.x)), v0: currentView(), t: tAt(cx), cx };
      hideTip();
      return;
    }
    if (pill) { drag = { mode: 'pill', pill, x: e.clientX, y: e.clientY }; return; }
    const px = svgX(e);
    if (e.pointerType === 'mouse') {
      if (px < G().x0 || px > G().x1) return;
      if (e.shiftKey && _st.view) drag = { mode: 'pan', x: e.clientX, v0: _st.view };
      else drag = { mode: 'brush', px0: px };
      capture(svg, e.pointerId);
      e.preventDefault();
    } else {
      drag = { mode: 'tap', x: e.clientX, y: e.clientY, at: Date.now(), v0: _st.view };
    }
  });
  on(svg, 'pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) { if (e.pointerType === 'mouse') tipAtPointer(e); return; }
    if (drag.mode === 'pinch' && pts.size >= 2) {
      const [p1, p2] = [...pts.values()];
      const d = Math.max(20, Math.abs(p1.x - p2.x));
      const span0 = drag.v0.to - drag.v0.from;
      const ns = Math.max(MIN_SPAN_MS, span0 * drag.d0 / d);
      const sr = svg.getBoundingClientRect();
      const cx = (p1.x + p2.x) / 2 - sr.left;
      const f = drag.t - (cx - G().x0) / G().IW * ns;
      _st.view = clampView(f, f + ns);
      redraw();
      return;
    }
    if (drag.mode === 'brush') {
      const px = Math.max(G().x0, Math.min(G().x1, svgX(e)));
      const r = brushEl();
      if (Math.abs(px - drag.px0) > 3 && r) {
        r.setAttribute('x', Math.min(px, drag.px0).toFixed(1));
        r.setAttribute('width', Math.abs(px - drag.px0).toFixed(1));
        r.setAttribute('visibility', 'visible');
      }
      tipAtPointer(e);
      return;
    }
    if (drag.mode === 'pan') {
      const dt = -(e.clientX - drag.x) / G().pxPerMs;
      _st.view = clampView(drag.v0.from + dt, drag.v0.to + dt);
      hideTip();
      redraw();
      return;
    }
    if (drag.mode === 'tap') {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) && _st.view) {
        drag = { mode: 'pan', x: drag.x, v0: _st.view };
        capture(svg, e.pointerId);
        hideTip();
      }
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    const d = drag;
    if (d?.mode === 'pinch') { if (pts.size < 2) drag = null; return; }
    drag = null;
    if (!d) return;
    if (d.mode === 'pill') {
      if (Math.abs(e.clientX - d.x) < 8 && Math.abs(e.clientY - d.y) < 8) {
        if (e.pointerType !== 'mouse' && d.pill.classList.contains('is-group') === false && !pinned) {
          // su telefono il primo tocco su un sorpasso singolo apre il
          // riquadro; il secondo porta alla riga
          tipAtPointer(e); pinned = true; return;
        }
        pillClick(d.pill);
      }
      return;
    }
    if (d.mode === 'brush') {
      brushEl()?.setAttribute('visibility', 'hidden');
      if (e.type !== 'pointerup') return;
      const px = Math.max(G().x0, Math.min(G().x1, svgX(e)));
      if (Math.abs(px - d.px0) > 6) {
        const a = tAt(Math.min(px, d.px0)), b = tAt(Math.max(px, d.px0));
        setView(clampView(a, b));
      }
      return;
    }
    if (d.mode === 'tap' && e.type === 'pointerup') {
      if (Math.abs(e.clientX - d.x) < 10 && Math.abs(e.clientY - d.y) < 10) {
        tipAtPointer(e);
        pinned = !tip.hidden;
      }
    }
  };
  on(svg, 'pointerup', end);
  on(svg, 'pointercancel', end);
  on(svg, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) hideTip(); });
  // un tocco fuori dal grafico chiude il riquadro fissato
  on(document, 'pointerdown', (e) => { if (pinned && !svg.contains(e.target)) hideTip(); });

  /* rotella: in su ingrandisce, in giù rimpicciolisce; di lato (o con
     Maiusc) sposta. A vista intera la rotella in giù NON si prende: la
     pagina deve poter scorrere oltre il grafico. */
  on(svg, 'wheel', (e) => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit, dy = e.deltaY * unit;
    if (!e.ctrlKey && (Math.abs(dx) > Math.abs(dy) || e.shiftKey)) {
      if (!_st.view) return;
      e.preventDefault();
      panBy((e.shiftKey && !dx ? dy : dx) / G().pxPerMs);
      return;
    }
    if (dy > 0 && !_st.view && !e.ctrlKey) return;
    e.preventDefault();
    const px = Math.max(G().x0, Math.min(G().x1, svgX(e)));
    zoomAt(tAt(px), Math.exp(dy * (e.ctrlKey ? 0.01 : 0.0018)));
    tipAtPointer(e);
  }, { passive: false });

  on(svg, 'keydown', (e) => {
    const { from, to } = currentView();
    const mid = (from + to) / 2;
    if (e.key === 'ArrowLeft') panBy(-(to - from) * 0.2);
    else if (e.key === 'ArrowRight') panBy((to - from) * 0.2);
    else if (e.key === '+' || e.key === '=') zoomAt(mid, 0.6, { animate: true });
    else if (e.key === '-' || e.key === '_') zoomAt(mid, 1 / 0.6, { animate: true });
    else if (e.key === '0' || e.key === 'Home') setView(null, { animate: true });
    else return;
    e.preventDefault();
  });

  /* striscia di navigazione */
  let nd = null;
  on(nav, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const n = G().nav;
    const px = e.clientX - nav.getBoundingClientRect().left;
    const grip = e.pointerType === 'mouse' ? 6 : 14;
    const zoomed = Boolean(_st.view);
    if (zoomed && Math.abs(px - n.wx0) <= grip) nd = { mode: 'left' };
    else if (zoomed && Math.abs(px - n.wx1) <= grip) nd = { mode: 'right' };
    else if (zoomed && px > n.wx0 && px < n.wx1) nd = { mode: 'move', px0: px, v0: _st.view };
    else nd = { mode: 'brush', px0: px };
    capture(nav, e.pointerId);
    hideTip();
    e.preventDefault();
  });
  on(nav, 'pointermove', (e) => {
    const n = G().nav;
    const px = e.clientX - nav.getBoundingClientRect().left;
    if (!nd) {
      if (e.pointerType !== 'mouse') return;
      const zoomed = Boolean(_st.view);
      nav.style.cursor = zoomed && (Math.abs(px - n.wx0) <= 6 || Math.abs(px - n.wx1) <= 6) ? 'ew-resize'
        : zoomed && px > n.wx0 && px < n.wx1 ? 'grab' : 'crosshair';
      return;
    }
    const t = n.T0 + (Math.max(PAD_L, Math.min(PAD_L + G().IW, px)) - PAD_L) / n.pxPerMs;
    const v = currentView();
    if (nd.mode === 'left') { _st.view = clampView(Math.min(t, v.to - MIN_SPAN_MS), v.to); redraw(); }
    else if (nd.mode === 'right') { _st.view = clampView(v.from, Math.max(t, v.from + MIN_SPAN_MS)); redraw(); }
    else if (nd.mode === 'move') {
      const dt = (px - nd.px0) / n.pxPerMs;
      _st.view = clampView(nd.v0.from + dt, nd.v0.to + dt);
      redraw();
    } else if (nd.mode === 'brush') {
      const r = nav.querySelector('.wp-btl-tl-navbrush');
      const cpx = Math.max(PAD_L, Math.min(PAD_L + G().IW, px));
      if (r && Math.abs(cpx - nd.px0) > 3) {
        r.setAttribute('x', Math.min(cpx, nd.px0).toFixed(1));
        r.setAttribute('width', Math.abs(cpx - nd.px0).toFixed(1));
        r.setAttribute('visibility', 'visible');
      }
    }
  });
  const navEnd = (e) => {
    const d = nd;
    nd = null;
    if (!d || d.mode !== 'brush' || e.type !== 'pointerup') return;
    const n = G().nav;
    const px = Math.max(PAD_L, Math.min(PAD_L + G().IW, e.clientX - nav.getBoundingClientRect().left));
    const ta = n.T0 + (Math.min(px, d.px0) - PAD_L) / n.pxPerMs;
    const tb = n.T0 + (Math.max(px, d.px0) - PAD_L) / n.pxPerMs;
    if (Math.abs(px - d.px0) > 4) { setView(clampView(ta, tb)); return; }
    // un tocco fuori dalla finestra: la finestra si centra lì
    if (_st.view) {
      const span = _st.view.to - _st.view.from;
      setView(clampView(ta - span / 2, ta + span / 2), { animate: true });
    }
  };
  on(nav, 'pointerup', navEnd);
  on(nav, 'pointercancel', navEnd);

  /* bottoni e interruttori della legenda */
  on(stage, 'click', (e) => {
    const tog = e.target.closest?.('button[data-series]');
    if (tog && stage.contains(tog)) {
      if (toggleSeries(tog.dataset.series)) { hideTip(); drawAll(); }
      return;
    }
    const btn = e.target.closest?.('button[data-act]');
    if (!btn || !stage.contains(btn)) return;
    const { from, to } = currentView();
    const mid = (from + to) / 2;
    const act = btn.dataset.act;
    if (act === 'in') zoomAt(mid, 0.5, { animate: true });
    else if (act === 'out') zoomAt(mid, 2, { animate: true });
    else if (act === 'reset') setView(null, { animate: true });
    else if (act === 'round') {
      const r = _st.rounds.find(rr => String(rr.r) === btn.dataset.r);
      if (r) setView(roundView(r), { animate: true });
    } else if (act === 'expand') toggleExpanded(kind);
  });
}
