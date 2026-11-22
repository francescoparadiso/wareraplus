/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche alleanze: la ricchezza nel tempo
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-22): «aggiungi lo storico della wealth
   nelle stats alleanze e nel confronto». La "Wealth" della vista è la
   somma dei TESORI delle nazioni membre (`rankings.countryWealth`, vedi
   buildMember in blocStats.js): qui c'è la stessa somma giorno per giorno.
     · nella pagina di un'alleanza un gruppo solo: area + linea, e tre
       caselle (adesso, {n} giorni fa, differenza);
     · nel "Fazione 1 vs 2" i due gruppi sullo STESSO riquadro e sugli
       stessi assi, ognuno nel colore della sua fazione, e una tabella al
       posto delle caselle — come le curve del danno (blocDamageCurves.js).

   ── DA DOVE VENGONO I NUMERI ─────────────────────────────────────
   /treasury-history?countryIds=a,b,c sul cache-server (treasuryHistory in
   server/dayHistory.js): il tesoro di ogni nazione allo scatto giornaliero
   delle 02:05 italiane, che il server fa già per la time machine. Nessun
   poll nuovo, nessuna richiesta a WarEra. La somma la fa questo modulo.
   L'ultimo punto è il valore di ADESSO, quello della tabella (`now` del
   gruppo): senza, la linea si fermerebbe alle 02:05 e la casella "adesso"
   direbbe un numero diverso dalla riga Wealth subito sopra.

   ── COSA IL GRAFICO NON DEVE FAR CREDERE ─────────────────────────
     · lo storico parte dal 19 settembre 2026 (`coverageFrom`): i giorni
       importati da aprile hanno il tesoro vuoto (l'altro tool salvava
       `money`, che non è il tesoro). La fascia sotto il titolo lo dice;
     · le nazioni sono quelle di OGGI: una nazione entrata la settimana
       scorsa conta anche per i giorni prima. È scritto nella stessa fascia;
     · un giorno in cui anche una sola nazione non ha il tesoro è un BUCO,
       la linea si spezza: una somma parziale sembrerebbe un crollo;
     · con un gruppo solo l'asse y NON parte da zero (un tesoro da 40 mila
       che ne guadagna 2 sarebbe una retta piatta) e le etichette dicono da
       dove parte; nel confronto parte da zero, perché lì la domanda è
       "quanto sono distanti" e una base tagliata la gonfierebbe.

   Senza la rotta (server non rideployato) nel 1 vs 2 la sezione non
   compare; nella pagina dell'alleanza, che le dà una sezione sua, lo dice.
   Carta, assi, legenda e tooltip sono quelli delle curve del danno
   (classi bs-cv-*, importate da blocDamageCurves.js).
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from './config.js';
import { bT } from './blocStatsI18n.js';
import { injectCurveStyles, bindCurveTip } from './blocDamageCurves.js';

const DAY_MS = 24 * 3600 * 1000;
// 0 = tutto lo storico. Oltre 30 giorni oggi non c'è altro che "tutto".
const RANGES = [7, 14, 30, 0];
const RANGE_KEY = 'we_bloc_wealth_days';
const TIMEOUT_MS = 8000;
const TTL_MS = 30 * 60 * 1000;   // uno scatto al giorno: mezz'ora basta e avanza

let _days = (() => {
  try {
    // getItem null → Number(null) = 0, che qui vuol dire "tutto": va
    // escluso prima, o la prima apertura partirebbe dall'intero storico.
    const raw = localStorage.getItem(RANGE_KEY);
    const v = raw == null ? NaN : Number(raw);
    return RANGES.includes(v) ? v : 30;
  } catch { return 30; }
})();

const rangeLabel = (d) => (d ? bT('{n}d', { n: d }) : bT('All'));

/* ── Dati ──────────────────────────────────────────────────────── */

const _cache = new Map();   // id ordinati → { at, p }

async function fetchTreasury(ids) {
  const list = [...new Set((ids || []).filter(Boolean))].sort();
  if (!list.length) return null;
  const key = list.join(',');
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;

  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${WARERA_CACHE_BASE}/treasury-history?countryIds=${key}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Senza l'eco di `countryIds` non è una risposta di questa rotta.
      return json && Array.isArray(json.countryIds) && Array.isArray(json.days) ? json : null;
    } catch (err) {
      console.warn('WarEra+ blocStats: /treasury-history non disponibile:', err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  _cache.set(key, { at: Date.now(), p });
  p.then(v => { if (!v && _cache.get(key)?.p === p) _cache.delete(key); });
  return p;
}

/** Ora (ms) di uno scatto: le 02:05 italiane di quel giorno, a un'ora
 *  circa di precisione (ora legale o no) — basta per l'asse. */
const dayTime = (day) => Date.parse(`${day}T01:05:00Z`);

/** [{ t, day, v }] sommati sul gruppo; v null se manca anche una nazione. */
function sumSeries(json, ids, now) {
  const list = ids.filter(id => json.series?.[id]);
  const out = json.days.map((day, i) => {
    let s = 0;
    for (const id of list) {
      const v = json.series[id][i];
      if (v == null) return { t: dayTime(day), day, v: null };
      s += v;
    }
    return { t: dayTime(day), day, v: s };
  });
  if (Number.isFinite(now) && out.length) out.push({ t: Date.now(), day: null, v: now, live: true });
  return out;
}

/* ── Ingresso ──────────────────────────────────────────────────── */

/**
 * Disegna lo storico dentro `host` per uno o due gruppi
 * ({ label, color, ids, now }). `emptyText`: cosa scrivere se il server
 * non ha la rotta (null = la sezione resta vuota). `title`: un titolo
 * proprio, per dove non c'è l'intestazione di una sezione (il 1 vs 2).
 */
export async function renderGroupWealth(host, groups, { emptyText = null, title = false } = {}) {
  const token = Symbol('wealth');
  host._wpWealth = token;
  injectCurveStyles();
  injectStyles();
  host.innerHTML = `<div class="bs-cv-loading">${bT('Loading wealth history…')}</div>`;

  const data = await Promise.all(groups.map(g => fetchTreasury(g.ids)));
  if (host._wpWealth !== token || !host.isConnected) return;
  const ready = groups
    .map((g, i) => (data[i] ? { ...g, rows: sumSeries(data[i], g.ids, g.now), from: data[i].coverageFrom } : null))
    .filter(g => g && g.rows.some(r => r.v != null && !r.live));
  if (!ready.length) {
    host.innerHTML = emptyText ? `<p class="bs-cv-empty">${esc(emptyText)}</p>` : '';
    return;
  }
  paint(host, ready, groups.length, title);
}

function paint(host, groups, asked, title) {
  const multi = asked > 1;
  const from = groups.map(g => g.from).filter(Boolean).sort()[0];
  host.innerHTML = `
    <div class="bs-cv bs-wh">
      ${title ? `<div class="bs-cv-title">${bT('Wealth over time')}</div>` : ''}
      <p class="bs-cv-note">${esc(bT('Sum of the treasuries of today\'s member nations, read once a day (02:05 Italian time) plus the value now. Recorded since {date}: earlier days were never saved, and a nation that joined later counts for the whole period.', { date: fmtDay(from, true) }))}</p>
      ${multi && asked > groups.length ? `<p class="bs-cv-note">${bT('One of the two sides has no wealth history yet.')}</p>` : ''}
      <div class="bs-cv-card">
        <div class="bs-cv-head">
          ${legendHtml(groups, multi)}
          <div class="bs-cv-range" role="group">
            ${RANGES.map(d => `<button type="button" data-d="${d}" class="${d === _days ? 'active' : ''}">${rangeLabel(d)}</button>`).join('')}
          </div>
        </div>
        ${statsHtml(groups, multi)}
        <div class="bs-cv-slot" data-slot="wealth"></div>
        <div class="bs-cv-tip" hidden></div>
      </div>
    </div>`;

  host.querySelector('.bs-cv-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-d]');
    if (!btn) return;
    _days = Number(btn.dataset.d);
    try { localStorage.setItem(RANGE_KEY, String(_days)); } catch { /* storage negato */ }
    paint(host, groups, asked, title);
  });

  const slot = host.querySelector('[data-slot="wealth"]');
  draw(slot, groups, multi);
  // Disegnato a sezione chiusa (larghezza 0) uscirebbe a 300px: si
  // ridisegna appena il contenitore prende la sua larghezza vera.
  if (typeof ResizeObserver === 'function' && slot) {
    let lastW = slot.clientWidth;
    const ro = new ResizeObserver(() => {
      if (!slot.isConnected) { ro.disconnect(); return; }
      const w = slot.clientWidth;
      if (w && Math.abs(w - lastW) > 4) { lastW = w; draw(slot, groups, multi); }
    });
    ro.observe(slot);
  }
}

/* ── Pezzi di testo ────────────────────────────────────────────── */

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
/** Per l'asse: senza decimali inutili ("100K", non "100.0K"). */
const fmtAxis = (n) => fmt(n).replace(/\.0+(?=[KMB])/, '').replace(/(\.\d*?)0+(?=[KMB])/, '$1');
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const lang = () => document.documentElement.lang || undefined;
function fmtDay(day, withYear = false) {
  if (!day) return '—';
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(lang(), { day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

/** Le righe dentro la finestra scelta (l'ultimo punto, adesso, sempre). */
function inWindow(rows) {
  if (!_days) return rows;
  const t0 = Date.now() - _days * DAY_MS - DAY_MS / 2;
  return rows.filter(r => r.t >= t0);
}

function legendHtml(groups, multi) {
  if (!multi) {
    return `<ul class="bs-cv-legend"><li><span class="bs-cv-sw" style="background:${groups[0].color}"></span>${bT('Treasury of member nations')}</li></ul>`;
  }
  return `<ul class="bs-cv-legend">
    ${groups.map(g => `<li><span class="bs-cv-sw" style="background:${g.color}"></span>${esc(g.label)}</li>`).join('')}
  </ul>`;
}

/** Adesso, all'inizio della finestra e differenza. */
function compare(g) {
  const rows = inWindow(g.rows).filter(r => r.v != null);
  if (rows.length < 2) return null;
  const first = rows[0], last = rows[rows.length - 1];
  const d = last.v - first.v;
  return { first, last, d, pct: first.v ? (d / first.v) * 100 : null };
}

function statsHtml(groups, multi) {
  const rows = groups.map(g => ({ g, c: compare(g) })).filter(r => r.c);
  if (!rows.length) return '';
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  const dTxt = (c) => `${sign(c.d)}${fmt(Math.abs(c.d))}`;
  const pTxt = (c) => (c.pct == null ? '—' : `${sign(c.pct)}${Math.abs(c.pct).toFixed(1)}%`);
  const cls = (c) => (c.d > 0 ? ' up' : c.d < 0 ? ' down' : '');
  const when = (r) => (r.live ? bT('now') : fmtDay(r.day));
  const startLabel = _days ? bT('{n} days ago', { n: _days }) : bT('Start');
  if (!multi) {
    const { c } = rows[0];
    const tile = (label, n, sub, extra = '') => `<div class="bs-cv-ptile bs-wh-tile${extra}"><span>${esc(label)}</span><strong>${n}</strong><em>${esc(sub)}</em></div>`;
    return `<div class="bs-cv-pills">
      ${tile(bT('Now'), fmt(c.last.v), when(c.last))}
      ${tile(startLabel, fmt(c.first.v), when(c.first))}
      ${tile(bT('Change'), dTxt(c), pTxt(c), ` bs-cv-pdiff${cls(c)}`)}
    </div>`;
  }
  return `<table class="bs-cv-ptable bs-wh-table">
    <thead><tr><th></th><th>${esc(bT('Now'))}</th><th>${esc(startLabel)}</th><th>${esc(bT('Change'))}</th></tr></thead>
    <tbody>${rows.map(({ g, c }) => `<tr>
      <td class="bs-cv-pname"><span class="bs-cv-sw" style="background:${g.color}"></span><span>${esc(g.label)}</span></td>
      <td><strong>${fmt(c.last.v)}</strong><em>${esc(when(c.last))}</em></td>
      <td><strong>${fmt(c.first.v)}</strong><em>${esc(when(c.first))}</em></td>
      <td class="bs-cv-pdiff${cls(c)}"><strong>${dTxt(c)}</strong><em>${pTxt(c)}</em></td>
    </tr>`).join('')}</tbody>
  </table>`;
}

/* ── Grafico ───────────────────────────────────────────────────── */

const PAD = { top: 14, right: 16, bottom: 22, left: 52 };

function segments(rows, get) {
  const out = [];
  let cur = [];
  rows.forEach((r, i) => {
    const v = get(r);
    if (v == null) { if (cur.length > 1) out.push(cur); cur = []; return; }
    cur.push({ i, v });
  });
  if (cur.length > 1) out.push(cur);
  return out;
}

/** Un passo "tondo" per l'asse: 1, 2 o 5 per una potenza di dieci. */
function niceStep(span) {
  const raw = span / 4;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

function draw(slot, groups, multi) {
  if (!slot) return;
  // Righe = unione dei giorni dei gruppi (più il punto di adesso); ogni
  // riga porta un valore per gruppo.
  const byKey = new Map();
  groups.forEach((g, gi) => {
    for (const r of inWindow(g.rows)) {
      const k = r.live ? 'live' : r.day;
      let row = byKey.get(k);
      if (!row) { row = { t: r.t, day: r.day, live: !!r.live, v: groups.map(() => null) }; byKey.set(k, row); }
      row.v[gi] = r.v;
      if (r.live) row.t = Math.max(row.t, r.t);
    }
  });
  const rows = [...byKey.values()].sort((a, b) => a.t - b.t);
  const values = rows.flatMap(r => r.v).filter(v => v != null);
  if (rows.length < 2 || !values.length) { slot.innerHTML = `<p class="bs-cv-empty">${bT('Not enough days recorded yet.')}</p>`; return; }

  const W = Math.max(slot.clientWidth || 0, 300);
  const H = 200;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  let lo = multi ? 0 : Math.min(...values);
  let hi = Math.max(...values);
  if (hi === lo) { hi += Math.max(1, Math.abs(hi) * 0.05); if (!multi) lo -= Math.max(1, Math.abs(lo) * 0.05); }
  const step = niceStep(hi - lo);
  lo = multi ? 0 : Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;

  const tStart = rows[0].t, tEnd = rows[rows.length - 1].t;
  const span = Math.max(1, tEnd - tStart);
  const x = (t) => PAD.left + ((t - tStart) / span) * plotW;
  const y = (v) => PAD.top + plotH - ((v - lo) / (hi - lo)) * plotH;

  let grid = '';
  for (let v = lo; v <= hi + step / 2; v += step) {
    const yy = y(v);
    grid += `<line class="bs-cv-grid" x1="${PAD.left}" y1="${yy.toFixed(1)}" x2="${W - PAD.right}" y2="${yy.toFixed(1)}"/>
      <text class="bs-cv-axis" x="${PAD.left - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
  }

  const base = (PAD.top + plotH).toFixed(1);
  let body = '';
  groups.forEach((g, gi) => {
    const segs = segments(rows, r => r.v[gi]);
    const pathOf = (seg) => seg.map(({ i, v }, k) => `${k ? 'L' : 'M'}${x(rows[i].t).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (!multi) {
      body += segs.map(seg => `<path d="${pathOf(seg)} L${x(rows[seg[seg.length - 1].i].t).toFixed(1)},${base} L${x(rows[seg[0].i].t).toFixed(1)},${base} Z"
        fill="${g.color}" fill-opacity=".13"/>`).join('');
    }
    body += segs.map(seg => `<path d="${pathOf(seg)}" fill="none" stroke="${g.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`).join('');
    // Il punto di adesso: un pallino vuoto, perché non è uno scatto delle
    // 02:05 ma il valore dal vivo.
    const li = rows.findIndex(r => r.live);
    if (li >= 0 && rows[li].v[gi] != null) {
      body += `<circle cx="${x(rows[li].t).toFixed(1)}" cy="${y(rows[li].v[gi]).toFixed(1)}" r="3.4" stroke="${g.color}" stroke-width="1.8" fill="var(--wp-ov-surface, #161b22)"/>`;
    }
  });

  // Etichette dei giorni: al massimo ~7, a passo costante.
  const dayRows = rows.filter(r => !r.live);
  const every = Math.max(1, Math.ceil(dayRows.length / 7));
  const labels = dayRows.map((r, i) => {
    if ((dayRows.length - 1 - i) % every) return '';
    const txt = new Date(`${r.day}T12:00:00Z`).toLocaleDateString(lang(), { day: 'numeric', month: 'numeric' });
    return `<text class="bs-cv-axis" x="${x(r.t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(txt)}</text>`;
  }).join('');

  // Fasce sensibili: da metà strada col punto prima a metà strada col dopo.
  const mid = (i) => (i <= 0 ? x(rows[0].t) : i >= rows.length ? x(rows[rows.length - 1].t) : (x(rows[i - 1].t) + x(rows[i].t)) / 2);
  const hits = rows.map((r, i) => {
    const a = mid(i), b = mid(i + 1);
    return `<rect class="bs-cv-hit" x="${a.toFixed(1)}" y="${PAD.top}" width="${Math.max(1, b - a).toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`;
  }).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bs-cv-svg" role="img"
    aria-label="${esc(bT('Wealth over time'))}">${grid}${body}${labels}${hits}</svg>`;

  bindCurveTip(slot, rows, (r) => {
    const i = rows.indexOf(r);
    const prev = rows[i - 1];
    const head = r.live
      ? bT('Now (live)')
      : new Date(`${r.day}T12:00:00Z`).toLocaleDateString(lang(), { weekday: 'short', day: 'numeric', month: 'short' });
    const items = groups.map((g, gi) => {
      const v = r.v[gi];
      const name = multi ? `<li class="bs-cv-tip-group"><span class="bs-cv-sw" style="background:${g.color}"></span>${esc(g.label)}</li>` : '';
      if (v == null) return name + `<li><span>${bT('not measured')}</span></li>`;
      const pv = prev?.v[gi];
      const d = pv != null ? v - pv : null;
      return name + `<li><span>${bT('Wealth')}</span><strong>${fmt(v)}</strong></li>`
        + (d != null ? `<li><span>${bT('vs previous point')}</span><strong>${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}</strong></li>` : '');
    }).join('');
    return `<div class="bs-cv-tip-head">${esc(head)}</div><ul>${items}</ul>`;
  });
}

/* ── Stile (solo quello che le curve del danno non hanno) ───────── */

let _styled = false;
function injectStyles() {
  if (_styled) return;
  _styled = true;
  const s = document.createElement('style');
  s.id = 'bs-wh-styles';
  s.textContent = `
    .bs-wh{margin-top:4px}
    /* Le regole delle curve del danno colorano i numeri di viola (pillati):
       qui verde = ricchezza nelle caselle, neutro nella tabella del 1 vs 2
       (il colore lì è quello della fazione, nel quadratino), e la
       differenza verde o rossa. Selettori lunghi quanto quelli che battono. */
    .bs-wh .bs-cv-ptile.bs-wh-tile strong{color:#3fb950}
    .bs-wh .bs-cv-ptable.bs-wh-table td strong{color:#c9d1d9}
    .bs-wh .bs-cv-ptile.bs-cv-pdiff strong,.bs-wh .bs-cv-ptable td.bs-cv-pdiff strong{color:#c9d1d9}
    .bs-wh .bs-cv-ptile.bs-cv-pdiff.up strong,.bs-wh .bs-cv-ptable td.bs-cv-pdiff.up strong{color:#3fb950}
    .bs-wh .bs-cv-ptile.bs-cv-pdiff.down strong,.bs-wh .bs-cv-ptable td.bs-cv-pdiff.down strong{color:#f85149}
    .bs-wh .bs-cv-ptile.bs-cv-pdiff.up{background:rgba(63,185,80,.08);border-color:rgba(63,185,80,.45)}
    .bs-wh .bs-cv-ptile.bs-cv-pdiff.down{background:rgba(248,81,73,.07);border-color:rgba(248,81,73,.4)}
    body.light-theme .bs-wh .bs-cv-ptile.bs-wh-tile strong{color:#1a7f37}
    body.light-theme .bs-wh .bs-cv-ptable.bs-wh-table td strong,body.light-theme .bs-wh .bs-cv-ptile.bs-cv-pdiff strong,body.light-theme .bs-wh .bs-cv-ptable td.bs-cv-pdiff strong{color:#24292f}
    body.light-theme .bs-wh .bs-cv-ptile.bs-cv-pdiff.up strong,body.light-theme .bs-wh .bs-cv-ptable td.bs-cv-pdiff.up strong{color:#1a7f37}
    body.light-theme .bs-wh .bs-cv-ptile.bs-cv-pdiff.down strong,body.light-theme .bs-wh .bs-cv-ptable td.bs-cv-pdiff.down strong{color:#cf222e}
  `;
  document.head.appendChild(s);
}
