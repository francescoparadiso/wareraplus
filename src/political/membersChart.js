/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: iscritti ai partiti, il grafico esplorabile
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-19): nella Storia politica dell'Italia
   mancava Mos Maiorum — «anche se ha solo 2 player ora è interessante
   vederne il declino» — e il grafico andava reso esplorabile.

   Mancava perché il riquadro teneva i SEI partiti più grandi ADESSO:
   un partito in declino è proprio quello che quel taglio butta fuori.
   Ora ci sono tutti, e il "gomitolo" che il taglio voleva evitare si
   scioglie dalla legenda invece che a monte:

   1. LEGENDA cliccabile — clic nasconde/mostra un partito, doppio clic
      lo lascia da solo. La scala verticale si adatta ai partiti visibili
      nel tratto visibile: un partito da 2 iscritti, da solo, riempie il
      grafico e il suo declino si legge. Di partenza si vedono gli 8 più
      grandi di SEMPRE (non di adesso, per lo stesso motivo); gli altri
      sono in legenda, spenti.
   2. ZOOM sull'asse dei tempi — rotella, pizzico, trascinamento per
      scegliere un tratto, bottoni ± e scorciatoie (vista intera, ultimi
      N giorni).
   3. SPOSTAMENTO — la striscia sotto (tutto il periodo, con la finestra
      da trascinare), Maiusc+trascina, rotella orizzontale, frecce; su
      telefono un dito di lato.
   4. RIQUADRO — data e ora, iscritti di ogni partito visibile in quel
      momento e lo scarto dall'inizio del tratto visibile.
   5. ALLARGA — tutta la finestra, Esc per tornare.

   Stessa meccanica di src/battles/timelineChart.js (stessi gesti, stessa
   scelta di disegnare a PIXEL VERI e ridisegnare a ogni cambio di
   larghezza), ma un modulo a parte: là ci sono due lati, barre e
   sorpassi, qui N serie a gradini — in comune c'è il gesto, non il
   disegno.

   ⚠️ Le serie sono CAMBI (il server scrive un punto solo quando il
   numero cambia): il valore resta quello fino al punto successivo, e
   l'ultimo si prolunga fino ad adesso. Prima del primo punto di un
   partito il valore è un BUCO, non zero — nato dopo che il server ha
   cominciato a guardare.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from './config.js';
import { getLang } from './i18n.js';
import { pT } from './plusI18n.js';
import { animationsOn } from '../shared/motion.js';

const HOUR = 36e5, DAY = 864e5;
const MIN_SPAN = 3 * HOUR;           // il server legge ogni 10 minuti
const PAD_L = 36, PAD_R = 14, TOP = 10, AXIS_H = 22;
const NAV_H = 30;
const DEFAULT_VISIBLE = 8;
const PRESET_DAYS = [30, 14, 7, 2];
const TICK_STEPS = [1, 2, 3, 6, 12].map(h => h * HOUR).concat([1, 2, 3, 7, 14, 30, 61].map(d => d * DAY));

/* ── Stato ────────────────────────────────────────────────────── */

// key = nazione: cambiando nazione zoom e partiti nascosti ripartono.
let _st = null;
let _cleanup = null;
let _geo = null;

/**
 * @param {{key:string, from:number|null, until:number,
 *          series:Array<{pid:string, name:string, color:string, pts:Array<[number, number|null]>, label:string}>}} o
 *   `label` è l'HTML già pronto della riga di legenda (pillola + numeri).
 */
export function membersChartHtml({ key, series, from, until }) {
  const all = series.map(s => ({ ...s, pts: s.pts.slice().sort((a, b) => a[0] - b[0]) }));
  const first = Math.min(...all.map(s => s.pts[0]?.[0] ?? Infinity));
  const T0 = Number.isFinite(from) ? Math.min(from, first) : first;
  const T1 = Math.max(until, T0 + HOUR, ...all.map(s => s.pts.at(-1)?.[0] ?? 0));
  if (!_st || _st.key !== key) {
    const byMax = all.map(s => ({ pid: s.pid, m: Math.max(0, ...s.pts.map(p => p[1] || 0)) }))
      .sort((a, b) => b.m - a.m);
    _st = { key, view: null, expanded: false, lastW: 0, focus: null,
      hidden: new Set(byMax.slice(DEFAULT_VISIBLE).map(s => s.pid)) };
  }
  Object.assign(_st, { series: all, T0, T1 });
  if (_st.view) _st.view = clampView(_st.view.from, _st.view.to);

  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const presets = PRESET_DAYS.filter(d => d * DAY < (T1 - T0) * 0.8).map(d =>
    `<button type="button" class="wp-pol-mc-chip" data-act="last" data-d="${d}">${escapeHtml(pT('mc_days', { n: d }))}</button>`).join('');
  const keys = all.map(s => `
    <button type="button" class="wp-pol-mem-row wp-pol-mc-key${_st.hidden.has(s.pid) ? ' is-off' : ''}" data-pid="${escapeHtml(s.pid)}" aria-pressed="${!_st.hidden.has(s.pid)}">${s.label}</button>`).join('');

  return `
    <div class="wp-pol-mc-stage${_st.expanded ? ' is-expanded' : ''}">
      <div class="wp-pol-mc-xtitle">${escapeHtml(pT('members_over_time'))}</div>
      <div class="wp-pol-mc-bar">
        <div class="wp-pol-mc-presets">
          <button type="button" class="wp-pol-mc-chip" data-act="reset">${escapeHtml(pT('mc_full'))}</button>
          ${presets}
        </div>
        <span class="wp-pol-mc-range" aria-live="polite"></span>
        <div class="wp-pol-mc-tools">
          <button type="button" class="wp-pol-mc-tool" data-act="out" title="${escapeHtml(pT('mc_zoom_out'))}" aria-label="${escapeHtml(pT('mc_zoom_out'))}">−</button>
          <button type="button" class="wp-pol-mc-tool" data-act="in" title="${escapeHtml(pT('mc_zoom_in'))}" aria-label="${escapeHtml(pT('mc_zoom_in'))}">+</button>
          <button type="button" class="wp-pol-mc-tool" data-act="expand"></button>
        </div>
      </div>
      <div class="wp-pol-mc-plot">
        <svg class="wp-pol-mc-main" tabindex="0" role="img" aria-label="${escapeHtml(pT('members_over_time'))}"></svg>
        <div class="wp-pol-mc-tip" hidden></div>
      </div>
      <svg class="wp-pol-mc-nav" role="img" aria-label="${escapeHtml(pT('mc_nav'))}"></svg>
      <div class="wp-pol-mem-list wp-pol-mc-legend">${keys}</div>
      <div class="wp-pol-mc-foot">
        <button type="button" class="wp-pol-mc-chip" data-act="showall" hidden>${escapeHtml(pT('mc_show_all'))}</button>
        <span class="wp-pol-mc-hint">${escapeHtml(pT(coarse ? 'mc_hint_touch' : 'mc_hint_mouse'))}</span>
      </div>
    </div>`;
}

/** Stacca i gesti (la scheda sta per essere ridisegnata o chiusa). Lo
 *  stato resta: tornando sulla stessa nazione zoom e legenda ci sono. */
export function disposeMembersChart() {
  _cleanup?.();
  _cleanup = null;
}

/* ── Dati ─────────────────────────────────────────────────────── */

/** Indice dell'ultimo punto con t <= ts (-1 se nessuno). */
function _idxAt(pts, ts) {
  let lo = 0, hi = pts.length - 1, r = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (pts[m][0] <= ts) { r = m; lo = m + 1; } else hi = m - 1;
  }
  return r;
}
/** Il valore a un istante: l'ultimo cambio prima di lì; prima del primo
 *  punto non si sa (null), non è zero. */
function valueAt(pts, ts) {
  const i = _idxAt(pts, ts);
  return i < 0 ? null : pts[i][1];
}

const visibleSeries = () => _st.series.filter(s => !_st.hidden.has(s.pid));

/* ── Formattazione ────────────────────────────────────────────── */

const _lang = () => getLang() || 'en';
const _dayKey = (ms) => new Date(ms).toDateString();
function fmtDay(ms, withYear = false) {
  return new Date(ms).toLocaleDateString(_lang(), withYear
    ? { day: 'numeric', month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' });
}
function fmtClock(ms) {
  return new Date(ms).toLocaleTimeString(_lang(), { hour: '2-digit', minute: '2-digit' });
}
const fmtDayClock = (ms) => `${fmtDay(ms)} ${fmtClock(ms)}`;

/* ── Geometria ────────────────────────────────────────────────── */

function currentView() {
  return _st.view || { from: _st.T0, to: _st.T1 };
}

/** Dentro il periodo registrato, non più stretto del minimo; se copre
 *  tutto torna null ("vista intera", che segue l'adesso). */
function clampView(from, to) {
  const { T0, T1 } = _st;
  const full = T1 - T0;
  const span = Math.min(full, Math.max(Math.min(MIN_SPAN, full), to - from));
  if (span >= full - 60000) return null;
  let f = from;
  if (to - from !== span) f = (from + to) / 2 - span / 2;
  f = Math.max(T0, Math.min(T1 - span, f));
  return { from: f, to: f + span };
}

/** Scala verticale a numeri interi "tondi", con un filo d'aria sopra. */
function niceScale(v) {
  if (!(v > 0)) return { max: 1, step: 1 };
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const mults = p >= 10 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  const step = Math.max(1, mults.map(m => m * p).find(s => s >= raw));
  return { max: Math.ceil(v * 1.04 / step) * step || step, step };
}

function timeTicks(from, to, IW, minGapPx) {
  const want = Math.max(2, Math.floor(IW / minGapPx));
  const step = TICK_STEPS.find(s => (to - from) / s <= want) || TICK_STEPS.at(-1);
  const off = new Date(from).getTimezoneOffset() * 60000;
  const out = [];
  for (let t = Math.ceil((from - off) / step) * step + off; t <= to; t += step) out.push(t);
  return { ticks: out, step };
}

/** Il tracciato a gradini di una serie fra `from` e `to` (più un punto
 *  per parte: la linea entra ed esce dal bordo, il clip la taglia). */
function stepPath(pts, x, y, from, to, until) {
  let d = '', pen = false, i = Math.max(0, _idxAt(pts, from)), reachedEnd = true;
  for (; i < pts.length; i++) {
    const [t, v] = pts[i];
    const X = x(t).toFixed(1);
    if (v == null) { if (pen) d += `H${X}`; pen = false; }
    else if (!pen) { d += `M${X},${y(v).toFixed(1)}`; pen = true; }
    else d += `H${X}V${y(v).toFixed(1)}`;
    if (t > to) { reachedEnd = false; break; }
  }
  if (pen && reachedEnd) d += `H${x(until).toFixed(1)}`;
  return d;
}

/* ── Disegno ──────────────────────────────────────────────────── */

function draw(stage) {
  const svg = stage.querySelector('.wp-pol-mc-main');
  const host = stage.querySelector('.wp-pol-mc-plot');
  if (!svg || !host || !_st) return;
  const W = Math.max(280, Math.round(host.clientWidth));
  _st.lastW = W;
  const narrow = W < 600;
  const plotH = _st.expanded && host.clientHeight
    ? Math.max(200, host.clientHeight - TOP - AXIS_H)
    : (narrow ? 200 : 250);
  const H = TOP + plotH + AXIS_H;
  const IW = W - PAD_L - PAD_R;
  const x0 = PAD_L, x1 = PAD_L + IW, yBase = TOP + plotH;
  const { from, to } = currentView();
  const pxPerMs = IW / (to - from);
  const x = (t) => PAD_L + (t - from) * pxPerMs;

  const vis = visibleSeries();
  let maxV = 0, changes = 0;
  for (const s of vis) {
    const v0 = valueAt(s.pts, from);
    if (v0 != null) maxV = Math.max(maxV, v0);
    for (const [t, v] of s.pts) {
      if (t < from || t > to || v == null) continue;
      maxV = Math.max(maxV, v);
      changes++;
    }
  }
  const sc = niceScale(maxV);
  const y = (v) => yBase - v / sc.max * plotH;

  let grid = '';
  for (let v = 0; v <= sc.max + 1e-9; v += sc.step) {
    const yy = y(v).toFixed(1);
    grid += `<line class="wp-pol-ch-grid" x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}"/>`
      + `<text class="wp-pol-ch-lab" x="${x0 - 6}" y="${(+yy + 3).toFixed(1)}" text-anchor="end">${v}</text>`;
  }

  // Pallini sui cambi solo quando c'è spazio per vederli uno per uno.
  const dots = changes && changes < IW / 7;
  const lines = vis.map(s => {
    const d = stepPath(s.pts, x, y, from, to, _st.T1);
    if (!d) return '';
    const dd = dots ? s.pts.filter(([t, v]) => t >= from && t <= to && v != null)
      .map(([t, v]) => `<circle cx="${x(t).toFixed(1)}" cy="${y(v).toFixed(1)}" r="2.3"/>`).join('') : '';
    return `<g class="wp-pol-mc-ser${_st.focus === s.pid ? ' is-focus' : ''}" data-pid="${escapeHtml(s.pid)}" style="--pc:${s.color}">
      <path d="${d}"/>${dd}</g>`;
  }).join('');

  // Asse del tempo: per giorni sopra il giorno, per ore sotto (con la
  // data sulla prima tacca e quando cambia).
  const { ticks, step } = timeTicks(from, to, IW, narrow ? 64 : 92);
  const multiYear = new Date(from).getFullYear() !== new Date(to).getFullYear();
  let prevDay = null;
  const xLabels = ticks.map((t, i) => {
    const day = _dayKey(t);
    const txt = step >= DAY ? fmtDay(t, multiYear)
      : (i === 0 || day !== prevDay) ? fmtDayClock(t) : fmtClock(t);
    prevDay = day;
    const est = txt.length * 5.6;
    let xx = x(t), anchor = 'middle';
    if (xx - est / 2 < x0) { xx = Math.max(x0, xx - 2); anchor = 'start'; }
    else if (xx + est / 2 > x1) { xx = Math.min(x1, xx + 2); anchor = 'end'; }
    return `<line class="wp-pol-mc-tick" x1="${x(t).toFixed(1)}" x2="${x(t).toFixed(1)}" y1="${yBase}" y2="${yBase + 3}"/>`
      + `<text class="wp-pol-ch-lab" x="${xx.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}">${escapeHtml(txt)}</text>`;
  }).join('');

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.classList.toggle('has-focus', Boolean(_st.focus && vis.some(s => s.pid === _st.focus)));
  svg.innerHTML = `
    <defs><clipPath id="wp-pol-mc-clip"><rect x="${x0}" y="0" width="${IW}" height="${yBase + 2}"/></clipPath></defs>
    ${grid}
    <g clip-path="url(#wp-pol-mc-clip)">${lines}</g>
    ${vis.length ? '' : `<text class="wp-pol-ch-lab" x="${(x0 + x1) / 2}" y="${TOP + plotH / 2}" text-anchor="middle">${escapeHtml(pT('mc_none_visible'))}</text>`}
    ${xLabels}
    <rect class="wp-pol-mc-brush" x="0" y="${TOP}" width="0" height="${plotH}" visibility="hidden"/>
    <line class="wp-pol-mc-cursor" x1="0" x2="0" y1="${TOP}" y2="${yBase}" visibility="hidden"/>
    <g class="wp-pol-mc-hdots"></g>
    <rect class="wp-pol-mc-hit" x="${x0}" y="${TOP}" width="${IW}" height="${plotH}"/>`;

  _geo = { from, to, pxPerMs, x0, x1, IW, y };
  drawNav(stage.querySelector('.wp-pol-mc-nav'), W, from, to);
  updateBar(stage, from, to);
}

/** La striscia: tutto il periodo con i partiti visibili, e la finestra. */
function drawNav(nav, W, from, to) {
  if (!nav) return;
  const { T0, T1 } = _st;
  const IW = W - PAD_L - PAD_R;
  const pxPerMs = IW / (T1 - T0);
  const x = (t) => PAD_L + (t - T0) * pxPerMs;
  const top = 3, h = NAV_H - 6;
  const vis = visibleSeries();
  const max = Math.max(1, ...vis.flatMap(s => s.pts.map(p => p[1] || 0)));
  const y = (v) => top + h - v / max * (h - 2);
  const lines = vis.map(s => `<path class="wp-pol-mc-navline" style="stroke:${s.color}" d="${stepPath(s.pts, x, y, T0, T1, T1)}"/>`).join('');
  const wx0 = x(from), wx1 = x(to);
  const zoomed = Boolean(_st.view);
  nav.setAttribute('viewBox', `0 0 ${W} ${NAV_H}`);
  nav.setAttribute('width', W);
  nav.setAttribute('height', NAV_H);
  nav.innerHTML = `
    <rect class="wp-pol-mc-navbg" x="${PAD_L}" y="${top}" width="${IW}" height="${h}" rx="3"/>
    ${lines}
    ${zoomed ? `<rect class="wp-pol-mc-navdim" x="${PAD_L}" y="${top}" width="${Math.max(0, wx0 - PAD_L).toFixed(1)}" height="${h}"/>
    <rect class="wp-pol-mc-navdim" x="${wx1.toFixed(1)}" y="${top}" width="${Math.max(0, PAD_L + IW - wx1).toFixed(1)}" height="${h}"/>` : ''}
    <rect class="wp-pol-mc-navwin${zoomed ? ' is-zoomed' : ''}" x="${wx0.toFixed(1)}" y="${top - 1}" width="${Math.max(2, wx1 - wx0).toFixed(1)}" height="${h + 2}" rx="3"/>
    ${zoomed ? `<rect class="wp-pol-mc-navgrip" x="${(wx0 - 2).toFixed(1)}" y="${top + h / 2 - 6}" width="4" height="12" rx="2"/>
    <rect class="wp-pol-mc-navgrip" x="${(wx1 - 2).toFixed(1)}" y="${top + h / 2 - 6}" width="4" height="12" rx="2"/>` : ''}
    <rect class="wp-pol-mc-navbrush" x="0" y="${top - 1}" width="0" height="${h + 2}" visibility="hidden"/>`;
  _geo.nav = { T0, pxPerMs, wx0, wx1 };
}

function lastView(days) {
  return clampView(_st.T1 - days * DAY, _st.T1) || null;
}

/** Bottoni, intervallo scritto, legenda. */
function updateBar(stage, from, to) {
  const zoomed = Boolean(_st.view);
  const range = stage.querySelector('.wp-pol-mc-range');
  if (range) {
    range.textContent = !zoomed ? ''
      : to - from >= 3 * DAY ? `${fmtDay(from)} – ${fmtDay(to)}`
      : _dayKey(from) === _dayKey(to) ? `${fmtDayClock(from)} – ${fmtClock(to)}`
      : `${fmtDayClock(from)} – ${fmtDayClock(to)}`;
  }
  stage.querySelectorAll('[data-act="reset"]').forEach(b => b.classList.toggle('active', !zoomed));
  stage.querySelectorAll('[data-act="last"]').forEach(b => {
    const v = lastView(+b.dataset.d);
    b.classList.toggle('active', Boolean(zoomed && v && Math.abs(v.from - from) < 60000 && Math.abs(v.to - to) < 60000));
  });
  const out = stage.querySelector('[data-act="out"]');
  if (out) out.disabled = !zoomed;
  const inn = stage.querySelector('[data-act="in"]');
  if (inn) inn.disabled = to - from <= MIN_SPAN + 60000;
  const ex = stage.querySelector('[data-act="expand"]');
  if (ex) {
    const lbl = pT(_st.expanded ? 'mc_collapse' : 'mc_expand');
    ex.innerHTML = `<span aria-hidden="true">${_st.expanded ? '⤡' : '⤢'}</span> ${escapeHtml(lbl)}`;
    ex.setAttribute('aria-pressed', String(_st.expanded));
  }
  stage.querySelectorAll('.wp-pol-mc-key').forEach(k => {
    const off = _st.hidden.has(k.dataset.pid);
    k.classList.toggle('is-off', off);
    k.setAttribute('aria-pressed', String(!off));
  });
  const all = stage.querySelector('[data-act="showall"]');
  if (all) all.hidden = !_st.hidden.size;
}

/* ── Riquadro ─────────────────────────────────────────────────── */

function tipAt(px) {
  const g = _geo;
  if (!g || px < g.x0 || px > g.x1) return null;
  const t = g.from + (px - g.x0) / g.pxPerMs;
  const rows = visibleSeries()
    .map(s => ({ s, v: valueAt(s.pts, t), v0: valueAt(s.pts, g.from) }))
    .filter(r => r.v != null)
    .sort((a, b) => b.v - a.v);
  if (!rows.length) return null;
  const html = `
    <div class="wp-pol-mc-tiphead">${escapeHtml(fmtDayClock(t))}</div>
    ${rows.map(({ s, v, v0 }) => {
      const d = v0 != null ? v - v0 : null;
      const dh = d ? ` <span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${d}</span>` : '';
      return `<div class="wp-pol-mc-tiprow"><i style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span><b>${v}</b>${dh}</div>`;
    }).join('')}
    <div class="wp-pol-mc-tipsub">${escapeHtml(pT('mc_delta_since', { date: fmtDayClock(g.from) }))}</div>`;
  return { t, rows, html };
}

/* ── Gesti ────────────────────────────────────────────────────── */

export function wireMembersChart(root) {
  disposeMembersChart();
  const stage = root.querySelector('.wp-pol-mc-stage');
  if (!stage || !_st) return;
  const svg = stage.querySelector('.wp-pol-mc-main');
  const nav = stage.querySelector('.wp-pol-mc-nav');
  const tip = stage.querySelector('.wp-pol-mc-tip');
  const plot = stage.querySelector('.wp-pol-mc-plot');
  const offs = [];
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); offs.push(() => el.removeEventListener(ev, fn, opt)); };

  let raf = 0;
  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; if (stage.isConnected) draw(stage); });
  };
  draw(stage);

  let tween = 0;
  const setView = (v, { animate = false } = {}) => {
    cancelAnimationFrame(tween);
    hideTip();
    if (!animate || !animationsOn()) { _st.view = v; redraw(); return; }
    const a = currentView();
    const b = v || { from: _st.T0, to: _st.T1 };
    const start = performance.now(), dur = 240;
    const step = (now) => {
      const k = Math.min(1, (now - start) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      _st.view = k < 1 ? { from: a.from + (b.from - a.from) * e, to: a.to + (b.to - a.to) * e } : v;
      draw(stage);
      if (k < 1) tween = requestAnimationFrame(step);
    };
    tween = requestAnimationFrame(step);
  };
  const zoomAt = (t, factor, opt) => {
    const { from, to } = currentView();
    const span = to - from;
    const ns = Math.max(MIN_SPAN, span * factor);
    const f = t - (t - from) * ns / span;
    setView(clampView(f, f + ns), opt);
  };
  const panBy = (dt) => {
    if (!_st.view) return;
    setView(clampView(_st.view.from + dt, _st.view.to + dt));
  };
  const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* il dito è già alzato */ } };
  const svgX = (e) => e.clientX - svg.getBoundingClientRect().left;
  const tAt = (px) => _geo.from + (px - _geo.x0) / _geo.pxPerMs;

  /* riquadro */
  let pinned = false;
  function hideTip() {
    tip.hidden = true;
    pinned = false;
    svg.querySelector('.wp-pol-mc-cursor')?.setAttribute('visibility', 'hidden');
    const hd = svg.querySelector('.wp-pol-mc-hdots');
    if (hd) hd.innerHTML = '';
  }
  const tipAtPointer = (e) => {
    const px = svgX(e);
    const r = tipAt(px);
    if (!r) return hideTip();
    const cursor = svg.querySelector('.wp-pol-mc-cursor');
    cursor?.setAttribute('x1', px.toFixed(1));
    cursor?.setAttribute('x2', px.toFixed(1));
    cursor?.setAttribute('visibility', 'visible');
    const hd = svg.querySelector('.wp-pol-mc-hdots');
    if (hd) hd.innerHTML = r.rows.map(({ s, v }) =>
      `<circle r="3.4" cx="${px.toFixed(1)}" cy="${_geo.y(v).toFixed(1)}" style="fill:${s.color}"/>`).join('');
    tip.innerHTML = r.html;
    tip.hidden = false;
    const pr = plot.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    const cx = sr.left - pr.left + px;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = cx + 14;
    if (left + w > pr.width) left = cx - w - 14;
    tip.style.left = `${Math.max(0, left)}px`;
    tip.style.top = `${Math.max(0, Math.min(pr.height - h, e.clientY - pr.top - 10))}px`;
  };

  /* puntatori sul grafico */
  const pts = new Map();
  let drag = null;   // { mode: 'brush'|'pan'|'pinch'|'tap', ... }
  const brushEl = () => svg.querySelector('.wp-pol-mc-brush');

  on(svg, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [p1, p2] = [...pts.values()];
      const cx = (p1.x + p2.x) / 2 - svg.getBoundingClientRect().left;
      drag = { mode: 'pinch', d0: Math.max(20, Math.abs(p1.x - p2.x)), v0: currentView(), t: tAt(cx) };
      hideTip();
      return;
    }
    const px = svgX(e);
    if (e.pointerType === 'mouse') {
      if (px < _geo.x0 || px > _geo.x1) return;
      drag = e.shiftKey && _st.view ? { mode: 'pan', x: e.clientX, v0: _st.view } : { mode: 'brush', px0: px };
      capture(svg, e.pointerId);
      e.preventDefault();
    } else {
      drag = { mode: 'tap', x: e.clientX, y: e.clientY };
    }
  });
  on(svg, 'pointermove', (e) => {
    if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!drag) { if (e.pointerType === 'mouse') tipAtPointer(e); return; }
    if (drag.mode === 'pinch' && pts.size >= 2) {
      const [p1, p2] = [...pts.values()];
      const d = Math.max(20, Math.abs(p1.x - p2.x));
      const span0 = drag.v0.to - drag.v0.from;
      const ns = Math.max(MIN_SPAN, span0 * drag.d0 / d);
      const cx = (p1.x + p2.x) / 2 - svg.getBoundingClientRect().left;
      const f = drag.t - (cx - _geo.x0) / _geo.IW * ns;
      _st.view = clampView(f, f + ns);
      redraw();
      return;
    }
    if (drag.mode === 'brush') {
      const px = Math.max(_geo.x0, Math.min(_geo.x1, svgX(e)));
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
      const dt = -(e.clientX - drag.x) / _geo.pxPerMs;
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
    if (d.mode === 'brush') {
      brushEl()?.setAttribute('visibility', 'hidden');
      if (e.type !== 'pointerup') return;
      const px = Math.max(_geo.x0, Math.min(_geo.x1, svgX(e)));
      if (Math.abs(px - d.px0) > 6) setView(clampView(tAt(Math.min(px, d.px0)), tAt(Math.max(px, d.px0))));
      return;
    }
    if (d.mode === 'tap' && e.type === 'pointerup' && Math.abs(e.clientX - d.x) < 10 && Math.abs(e.clientY - d.y) < 10) {
      tipAtPointer(e);
      pinned = !tip.hidden;
    }
  };
  on(svg, 'pointerup', end);
  on(svg, 'pointercancel', end);
  on(svg, 'pointerleave', (e) => { if (e.pointerType === 'mouse' && !drag) hideTip(); });
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
      panBy((e.shiftKey && !dx ? dy : dx) / _geo.pxPerMs);
      return;
    }
    if (dy > 0 && !_st.view && !e.ctrlKey) return;
    e.preventDefault();
    const px = Math.max(_geo.x0, Math.min(_geo.x1, svgX(e)));
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
  const navPx = (e) => e.clientX - nav.getBoundingClientRect().left;
  const navT = (px) => _geo.nav.T0 + (Math.max(PAD_L, Math.min(PAD_L + _geo.IW, px)) - PAD_L) / _geo.nav.pxPerMs;
  on(nav, 'pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const n = _geo.nav, px = navPx(e);
    const grip = e.pointerType === 'mouse' ? 6 : 14;
    const zoomed = Boolean(_st.view);
    if (zoomed && Math.abs(px - n.wx0) <= grip) nd = { mode: 'left' };
    else if (zoomed && Math.abs(px - n.wx1) <= grip) nd = { mode: 'right' };
    else if (zoomed && px > n.wx0 && px < n.wx1) nd = { mode: 'move', px0: px, v0: _st.view };
    else nd = { mode: 'brush', px0: Math.max(PAD_L, Math.min(PAD_L + _geo.IW, px)) };
    capture(nav, e.pointerId);
    hideTip();
    e.preventDefault();
  });
  on(nav, 'pointermove', (e) => {
    const n = _geo.nav, px = navPx(e);
    if (!nd) {
      if (e.pointerType !== 'mouse') return;
      const zoomed = Boolean(_st.view);
      nav.style.cursor = zoomed && (Math.abs(px - n.wx0) <= 6 || Math.abs(px - n.wx1) <= 6) ? 'ew-resize'
        : zoomed && px > n.wx0 && px < n.wx1 ? 'grab' : 'crosshair';
      return;
    }
    const t = navT(px);
    const v = currentView();
    if (nd.mode === 'left') { _st.view = clampView(Math.min(t, v.to - MIN_SPAN), v.to); redraw(); }
    else if (nd.mode === 'right') { _st.view = clampView(v.from, Math.max(t, v.from + MIN_SPAN)); redraw(); }
    else if (nd.mode === 'move') {
      const dt = (px - nd.px0) / n.pxPerMs;
      _st.view = clampView(nd.v0.from + dt, nd.v0.to + dt);
      redraw();
    } else {
      const r = nav.querySelector('.wp-pol-mc-navbrush');
      const cpx = Math.max(PAD_L, Math.min(PAD_L + _geo.IW, px));
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
    const px = Math.max(PAD_L, Math.min(PAD_L + _geo.IW, navPx(e)));
    const ta = navT(Math.min(px, d.px0)), tb = navT(Math.max(px, d.px0));
    if (Math.abs(px - d.px0) > 4) { setView(clampView(ta, tb)); return; }
    // un tocco fuori dalla finestra: la finestra si centra lì
    if (_st.view) {
      const span = _st.view.to - _st.view.from;
      setView(clampView(ta - span / 2, ta + span / 2), { animate: true });
    }
  };
  on(nav, 'pointerup', navEnd);
  on(nav, 'pointercancel', navEnd);

  /* legenda: clic nasconde/mostra, doppio clic lascia quel partito da
     solo (un secondo doppio clic sullo stesso li riaccende tutti). Il
     doppio clic si riconosce a mano: `dblclick` arriva DOPO due click,
     cioè dopo aver già spento e riacceso la serie. */
  let lastKey = null;   // { pid, at, before }: lo stato PRIMA del primo clic
  const toggleKey = (pid) => {
    const now = Date.now();
    if (lastKey && lastKey.pid === pid && now - lastKey.at < 350) {
      const { before } = lastKey;
      lastKey = null;
      const others = _st.series.filter(s => s.pid !== pid).map(s => s.pid);
      const alreadySolo = !before.has(pid) && others.every(p => before.has(p));
      _st.hidden = alreadySolo ? new Set() : new Set(others);
    } else {
      lastKey = { pid, at: now, before: new Set(_st.hidden) };
      if (_st.hidden.has(pid)) _st.hidden.delete(pid);
      else _st.hidden.add(pid);
    }
    hideTip();
    redraw();
  };
  const legend = stage.querySelector('.wp-pol-mc-legend');
  const setFocus = (pid) => {
    if (_st.focus === pid) return;
    _st.focus = pid;
    svg.classList.toggle('has-focus', Boolean(pid && !_st.hidden.has(pid)));
    svg.querySelectorAll('.wp-pol-mc-ser').forEach(g => g.classList.toggle('is-focus', g.dataset.pid === pid));
  };
  if (legend) {
    on(legend, 'pointerover', (e) => {
      if (e.pointerType !== 'mouse') return;
      setFocus(e.target.closest?.('.wp-pol-mc-key')?.dataset.pid || null);
    });
    on(legend, 'pointerleave', () => setFocus(null));
  }

  /* bottoni */
  on(stage, 'click', (e) => {
    const key = e.target.closest?.('.wp-pol-mc-key');
    if (key && stage.contains(key)) {
      // i link dentro la pillola (se mai ce ne fossero) restano link
      if (e.target.closest('a')) return;
      toggleKey(key.dataset.pid);
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
    else if (act === 'last') setView(lastView(+btn.dataset.d), { animate: true });
    else if (act === 'showall') { _st.hidden = new Set(); redraw(); }
    else if (act === 'expand') toggleExpanded(!_st.expanded);
  });

  // L'overlay di Political sta sotto le barre del menu: un figlio fixed
  // non esce dal suo piano, quindi da allargato si alza l'overlay intero
  // (stesso trucco di timelineChart.js).
  // ⚠️ E il riquadro .panel di Political ha `backdrop-filter: blur()`, che
  // fa da contenitore ai figli fixed: senza toglierlo, "tutta la finestra"
  // diventava una striscia alta quanto la scheda (verificato: 138 px).
  const raiseHost = stage.closest('.wp-political-overlay');
  const card = stage.closest('.panel');
  const raise = (v) => {
    raiseHost?.classList.toggle('wp-pol-mc-raised', v);
    card?.classList.toggle('wp-pol-mc-open', v);
  };
  raise(_st.expanded);
  const toggleExpanded = (v) => {
    _st.expanded = v;
    raise(v);
    stage.classList.toggle('is-expanded', v);
    hideTip();
    draw(stage);
    if (v) svg.focus({ preventScroll: true });
    else stage.scrollIntoView({ block: 'nearest' });
  };
  on(document, 'keydown', (e) => {
    if (e.key === 'Escape' && _st?.expanded && stage.isConnected) { e.stopPropagation(); toggleExpanded(false); }
  }, true);

  const ro = typeof ResizeObserver === 'function'
    ? new ResizeObserver(() => { if (_st && (_st.expanded || Math.abs(plot.clientWidth - _st.lastW) >= 1)) redraw(); })
    : null;
  ro?.observe(plot);

  _cleanup = () => {
    offs.forEach(f => f());
    raise(false);
    ro?.disconnect();
    cancelAnimationFrame(raf);
    cancelAnimationFrame(tween);
  };
}
