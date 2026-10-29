/* ══════════════════════════════════════════════════════════════
   WarEra+ — giocatori guerra / economia nel tempo (nazione e alleanza)
   ------------------------------------------------------------------
   La ciambella della scheda dice quanti cittadini stanno sulla guerra e
   quanti sull'economia ADESSO; il pannello nazione della mappa dice di
   quanto sono cambiati da ieri. Qui c'è la curva intera: come si sono mossi
   i due numeri (e, spegnibili, ibridi e senza punti) nelle ultime 24 ore,
   fino a 90 giorni. Risponde a «questa nazione si sta mobilitando?», che il
   solo istante non può dire.

   DUE INGRESSI, UN SOLO GRAFICO:
     · renderPlaystyleTrend(host, nation)      — scheda nazione (Statistiche
       nazioni, scheda "Stile di gioco");
     · renderGroupPlaystyleTrend(host, {key, ids}) — un GRUPPO di nazioni, per
       la pagina di un'alleanza (Statistiche alleanze): le serie delle
       nazioni membre sommate (vedi mergeSeries).
   Ogni disegno ha la SUA istanza (chiusura in mountTrend): le due viste sono
   overlay diversi e restano entrambe nel DOM, quindi uno stato di modulo
   unico le avrebbe fatte ridisegnare l'una sull'altra. Finestra scelta e
   gruppi accesi sono invece preferenze, condivise e salvate.

   ZERO LAVORO NUOVO LATO SERVER: il dato è lo storico che il cache-server
   già salva ad ogni giro (`/mu-playstyle-history`, vedi
   appendPlaystyleHistory in server/warera-cache-server.js) e che il
   pannello della mappa già legge per il "da ieri". Una richiesta, qualche
   KB per nazione (per un'alleanza, una richiesta ogni 60 nazioni).

   ── COME SI LEGGE LO STORICO ─────────────────────────────────────
   Il server scrive una riga SOLO quando i numeri di una nazione cambiano
   (delta encoding): fra due righe il valore non si è mosso. Quindi la serie
   è a SCALINI — il valore in vigore a un istante è quello dell'ultima riga
   precedente — e si disegna a scalini, non con segmenti obliqui che
   inventerebbero valori intermedi. Per lo stesso motivo il valore all'inizio
   di una finestra è quello dell'ultima riga PRIMA dell'inizio: per questo si
   scarica sempre l'intera ritenzione (90 giorni) e si ritaglia qui, invece
   di chiedere al server solo la finestra scelta — che taglierebbe proprio la
   riga che serve.

   ── LA SOMMA DI UN'ALLEANZA ──────────────────────────────────────
   Le serie delle nazioni hanno righe in istanti diversi: la somma a un
   istante è, per ogni nazione, il valore dell'ultima sua riga fino a lì.
   ⚠️ Una nazione che non ha ancora righe all'inizio (il server potava anche
   la riga PRIMA del taglio, prima del 2026-10-29: una nazione che cambia di
   rado partiva "da dopo") viene riempita all'indietro col suo primo valore
   noto — sbagliato al più di una variazione, mentre uno zero sbaglierebbe
   di centinaia e farebbe comparire le nazioni una alla volta come salti che
   nel gioco non sono mai avvenuti. Quando succede lo dice una nota sotto il
   grafico (`trendGroupFill`).

   ⚠️ Cosa il grafico NON deve far credere:
     · prima della prima riga di quella nazione non si sa niente. La linea
       parte lì e una fascia lo dichiara; un tratto a zero a sinistra si
       leggerebbe come «non c'era nessuno».
     · i conteggi sono dei cittadini di cui il server ha già letto le
       abilità (`known`). Quando il server allarga la copertura il numero
       sale anche se nessuno ha cambiato stile: la nota sotto il grafico lo
       dice, e il tooltip riporta `known` accanto ai gruppi.
     · l'asse y NON parte da zero: una nazione con 800 economisti che ne
       guadagna 5 sarebbe una retta piatta. Le etichette dell'asse dicono
       sempre da dove parte.

   SVG scritto a mano come il resto della vista (damageCurves.js,
   levelPlaystyle.js): niente Chart.js, che nel bundle esiste solo per
   Political. Riusa le classi già tarate del grafico livelli e delle curve
   del danno (carta, selettore, legenda, tooltip) invece di clonarle — per
   questo importa nations.css anche quando lo monta la pagina alleanza.
   ══════════════════════════════════════════════════════════════ */

import '../styles/nations.css';
import { natT } from './i18n.js';
import { fetchPlaystyleHistory, fetchPlaystyleHistoryAll } from '../mu/api.js';
import { trackEvent } from '../shared/analytics.js';
import { escapeHtml } from '../mu/ui.js';

const GROUPS = ['war', 'eco', 'mixed', 'undecided'];
// Stesse tinte della ciambella e di levelPlaystyle.js: un gruppo ha UN colore
// in tutta la scheda.
const GROUP_COLORS = { war: '#e5484d', eco: '#3fb950', mixed: '#e3b341', undecided: '#6e7681' };
// Di partenza solo guerra ed economia: sono la domanda. Ibridi e senza punti
// si riaccendono dalla legenda.
const DEFAULT_HIDDEN = 'mixed,undecided';

const HOUR_MS = 3600 * 1000;
// 90 giorni = PLAYSTYLE_HISTORY_RETENTION_MS del server (30 fino al
// 2026-10-29): oltre non c'è altro. Un server non ancora rideployato ne tiene
// ancora 30, e la fascia di copertura lo dichiara.
const RANGES = [24, 72, 7 * 24, 14 * 24, 30 * 24, 90 * 24];
const MAX_HOURS = RANGES[RANGES.length - 1];
const RANGE_KEY = 'we_nat_pstrend_hours';
const HIDDEN_KEY = 'we_nat_pstrend_hidden';

const rangeLabel = (h) => (h > 72 ? `${h / 24}${natT('curveDayShort')}` : `${h}${natT('curveHourShort')}`);

const PAD = { top: 12, right: 16, bottom: 22, left: 42 };
const H = 200;

/* ── Preferenze (condivise fra tutte le istanze) ───────────────── */
let _hours = (() => {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY));
    return RANGES.includes(v) ? v : 7 * 24;
  } catch { return 7 * 24; }
})();
const _hidden = new Set((() => {
  try { return (localStorage.getItem(HIDDEN_KEY) ?? DEFAULT_HIDDEN).split(','); } catch { return DEFAULT_HIDDEN.split(','); }
})().filter(g => GROUPS.includes(g)));

function persist(key, value) {
  try { localStorage.setItem(key, value); } catch { /* storage negato */ }
}

const since = () => Date.now() - MAX_HOURS * HOUR_MS - HOUR_MS;

/** Righe grezze [ts, war, eco, mixed, undecided, known] → oggetti, in ordine. */
function toRows(raw) {
  return (raw || [])
    .filter(r => Array.isArray(r) && Number.isFinite(r[0]))
    .map(r => ({ t: r[0], war: r[1] || 0, eco: r[2] || 0, mixed: r[3] || 0, undecided: r[4] || 0, known: r[5] || 0 }))
    .sort((a, b) => a.t - b.t);
}

/** Somma le serie di più nazioni ({ countryId: righe grezze }). Vedi la
 *  testata: per ogni nazione vale l'ultima riga fino all'istante, e prima
 *  della sua prima riga il suo primo valore noto. `filled` = almeno una
 *  nazione è stata riempita per più di un'ora. */
function mergeSeries(byCountry) {
  const lists = Object.values(byCountry || {}).map(toRows).filter(l => l.length);
  if (!lists.length) return { rows: [], filled: false };
  const times = [...new Set(lists.flatMap(l => l.map(r => r.t)))].sort((a, b) => a - b);
  const t0 = times[0];
  const filled = lists.some(l => l[0].t - t0 > HOUR_MS);
  const idx = lists.map(() => 0);
  const cur = lists.map(l => l[0]);                // all'indietro: il primo valore noto
  const rows = times.map(t => {
    const sum = { t, war: 0, eco: 0, mixed: 0, undecided: 0, known: 0 };
    lists.forEach((l, i) => {
      while (idx[i] < l.length && l[idx[i]].t <= t) cur[i] = l[idx[i]++];
      for (const k of ['war', 'eco', 'mixed', 'undecided', 'known']) sum[k] += cur[i][k];
    });
    return sum;
  });
  return { rows, filled };
}

/* ── Ingressi ──────────────────────────────────────────────────── */

/**
 * Disegna la sezione di una NAZIONE dentro `host`. Se il server non ha lo
 * storico (o la nazione non ci compare) la sezione NON compare: svuota
 * l'host e basta — stesso degrado voluto delle curve del danno.
 */
export function renderPlaystyleTrend(host, nation) {
  return mountTrend(host, {
    title: true,
    load: async () => ({ rows: toRows(await fetchPlaystyleHistory(nation._id, since())), filled: false }),
  });
}

/** Lo stesso per un GRUPPO di nazioni (`ids`): la pagina di un'alleanza.
 *  Il titolo non c'è: lo mette la sezione che lo contiene. */
export function renderGroupPlaystyleTrend(host, { ids }) {
  return mountTrend(host, {
    title: false,
    load: async () => mergeSeries(await fetchPlaystyleHistoryAll(ids || [], since())),
  });
}

async function mountTrend(host, { title, load }) {
  host._wpTrend?.ro?.disconnect();
  const inst = { host, title, rows: null, filled: false, ro: null, lastWidth: 0 };
  host._wpTrend = inst;
  host.innerHTML = `<div class="wp-nat-curve-loading">${escapeHtml(natT('trendLoading'))}</div>`;

  const { rows, filled } = await load();
  if (host._wpTrend !== inst) return;              // ridisegnata nel frattempo
  inst.rows = rows;
  inst.filled = filled;
  if (!rows.length) { host.innerHTML = ''; return; }
  paint(inst);
}

function paint(inst) {
  const host = inst.host;
  if (!host.isConnected || host._wpTrend !== inst) return;
  const pts = windowPoints(inst);
  const first = pts[0];

  host.innerHTML = `
    ${inst.title ? `<h3 class="wp-nat-section-title">${escapeHtml(natT('trendTitle'))}</h3>` : ''}
    <div class="wp-nat-curve-card">
      <div class="wp-nat-curve-head">
        <ul class="wp-nat-legend wp-nat-lv-legend" data-trend="legend">
          ${GROUPS.map(g => `
            <li><button type="button" class="wp-nat-lv-key${_hidden.has(g) ? ' off' : ''}" data-group="${g}">
              <span class="wp-nat-dot" style="background:${GROUP_COLORS[g]}"></span>${escapeHtml(natT(g))}
            </button></li>`).join('')}
        </ul>
        <div class="wp-nat-curve-range" data-trend="range" role="group">
          ${RANGES.map(h => `<button type="button" data-h="${h}" class="${h === _hours ? 'active' : ''}">${escapeHtml(rangeLabel(h))}</button>`).join('')}
        </div>
      </div>
      ${statsHtml(pts)}
      <div class="wp-nat-curve-slot" data-trend="slot"></div>
      <div class="wp-nat-lv-tip" hidden></div>
      ${first.partial ? `<p class="wp-nat-curve-note">${escapeHtml(natT('trendCoverage').replace('{date}', fmtDate(first.at)))}</p>` : ''}
      ${inst.filled ? `<p class="wp-nat-curve-note">${escapeHtml(natT('trendGroupFill'))}</p>` : ''}
      <p class="wp-nat-curve-peak">${escapeHtml(natT('trendNote'))}</p>
    </div>`;

  host.querySelector('[data-trend="legend"]').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-group]');
    if (!btn) return;
    const g = btn.dataset.group;
    if (_hidden.has(g)) _hidden.delete(g); else _hidden.add(g);
    persist(HIDDEN_KEY, [..._hidden].join(','));
    trackEvent('nations-trend-group', { group: g, on: !_hidden.has(g) });
    paint(inst);
  });
  host.querySelector('[data-trend="range"]').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-h]');
    if (!btn) return;
    _hours = Number(btn.dataset.h);
    persist(RANGE_KEY, String(_hours));
    trackEvent('nations-trend-range', { hours: _hours });
    paint(inst);
  });

  const slot = host.querySelector('[data-trend="slot"]');
  inst.lastWidth = slot.clientWidth || 0;
  draw(inst);
  // La scheda "Stile di gioco" si disegna anche quando è nascosta: lì la
  // larghezza vale zero e il grafico uscirebbe al minimo di 320px.
  inst.ro?.disconnect();
  inst.ro = new ResizeObserver(() => {
    const w = slot.clientWidth || 0;
    if (Math.abs(w - inst.lastWidth) < 2) return;
    inst.lastWidth = w;
    draw(inst);
  });
  inst.ro.observe(slot);
}

/* ── Serie della finestra ──────────────────────────────────────── */

/** I punti a scalini della finestra scelta: il valore in vigore all'inizio
 *  (l'ultima riga prima), le righe dentro la finestra, e un punto finale a
 *  «adesso» col valore ancora in vigore. `at` è l'ora della riga vera (il
 *  punto iniziale ha `t` = inizio finestra); `partial` = prima della prima
 *  riga non si sa niente. */
function windowPoints(inst) {
  const rows = inst.rows;
  const now = Date.now();
  const t0 = now - _hours * HOUR_MS;
  let before = null;
  for (const r of rows) { if (r.t <= t0) before = r; else break; }
  const pts = [];
  if (before) pts.push({ ...before, t: t0, at: before.t, partial: false });
  for (const r of rows) if (r.t > t0 && r.t <= now) pts.push({ ...r, at: r.t, partial: false });
  if (!pts.length) pts.push({ ...rows[rows.length - 1], at: rows[rows.length - 1].t, partial: false });
  if (!before) pts[0].partial = true;
  pts.push({ ...pts[pts.length - 1], t: now, end: true });
  return pts;
}

/* ── Riquadri: valore adesso e variazione ──────────────────────── */

function statsHtml(pts) {
  const groups = GROUPS.filter(g => !_hidden.has(g));
  if (!groups.length) return '';
  const a = pts[0], b = pts[pts.length - 1];
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  const since = a.partial ? natT('trendDeltaSince').replace('{date}', fmtDate(a.at)) : null;
  return `
    <div class="wp-nat-trend-stats">
      ${groups.map(g => {
        const diff = b[g] - a[g];
        const d = `${sign(diff)}${Math.abs(diff).toLocaleString(lang())}`;
        const sub = (since || natT('trendDelta').replace('{h}', rangeLabel(_hours))).replace('{d}', d);
        return `
        <div class="wp-nat-pill-tile wp-nat-trend-tile" style="--c:${GROUP_COLORS[g]}">
          <span class="wp-nat-pill-lab">${escapeHtml(natT(g))}</span>
          <strong>${b[g].toLocaleString(lang())}</strong>
          <span class="wp-nat-pill-sub">${escapeHtml(sub)}</span>
        </div>`;
      }).join('')}
    </div>`;
}

/* ── Grafico a scalini ─────────────────────────────────────────── */

const lang = () => document.documentElement.lang || undefined;
const fmtDate = (ms) => new Date(ms).toLocaleDateString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Tacche "tonde" sull'asse y: passo 1·2·5×10^n, mai sotto 1 (sono conteggi
 *  di persone). L'asse si allarga alle tacche, non il contrario. */
function niceAxis(lo, hi, n = 4) {
  const raw = Math.max(1, (hi - lo) / n);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, [1, 2, 5, 10].map(m => m * mag).find(s => s >= raw));
  const start = Math.max(0, Math.floor(lo / step) * step);
  const end = Math.max(start + step, Math.ceil(hi / step) * step);
  const ticks = [];
  for (let v = start; v <= end + 1e-9; v += step) ticks.push(v);
  return { start, end, ticks };
}

/** Tacche del tempo sull'asse x, allineate all'ora/mezzanotte LOCALE. */
function timeTicks(t0, t1, plotW) {
  const steps = [1, 2, 3, 6, 12, 24, 48, 168];
  const target = Math.max(2, Math.floor(plotW / 90));
  const stepH = steps.find(h => (t1 - t0) / (h * HOUR_MS) <= target) || steps[steps.length - 1];
  const out = [];
  const d = new Date(t0);
  if (stepH < 24) {
    d.setMinutes(0, 0, 0);
    while (d.getTime() < t0 || d.getHours() % stepH !== 0) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= t1; d.setHours(d.getHours() + stepH)) out.push(d.getTime());
  } else {
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < t0) d.setDate(d.getDate() + 1);
    for (; d.getTime() <= t1; d.setDate(d.getDate() + stepH / 24)) out.push(d.getTime());
  }
  return { ticks: out, stepH };
}

function draw(inst) {
  const slot = inst.host.querySelector('[data-trend="slot"]');
  if (!slot || !inst.rows) return;
  const groups = GROUPS.filter(g => !_hidden.has(g));
  if (!groups.length) {
    slot.innerHTML = `<p class="wp-nat-empty">${escapeHtml(natT('trendNoGroup'))}</p>`;
    return;
  }

  const pts = windowPoints(inst);
  const tStart = Date.now() - _hours * HOUR_MS;
  const tEnd = pts[pts.length - 1].t;
  const W = Math.max(slot.clientWidth || 0, 320);
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  let lo = Infinity, hi = -Infinity;
  for (const p of pts) for (const g of groups) { lo = Math.min(lo, p[g]); hi = Math.max(hi, p[g]); }
  // Un po' d'aria sopra e sotto: una retta piatta non deve stare sul bordo.
  const pad = Math.max(2, Math.round((hi - lo) * 0.12));
  const axis = niceAxis(lo - pad, hi + pad);

  const x = (t) => PAD.left + ((t - tStart) / Math.max(1, tEnd - tStart)) * plotW;
  const y = (v) => PAD.top + plotH - ((v - axis.start) / Math.max(1, axis.end - axis.start)) * plotH;
  const f = (n) => n.toFixed(1);

  let grid = '';
  for (const v of axis.ticks) {
    grid += `<line class="wp-nat-lv-gridline" x1="${PAD.left}" y1="${f(y(v))}" x2="${W - PAD.right}" y2="${f(y(v))}"/>
      <text class="wp-nat-curve-axis" x="${PAD.left - 6}" y="${f(y(v) + 3.5)}" text-anchor="end">${escapeHtml(v.toLocaleString(lang()))}</text>`;
  }

  const { ticks, stepH } = timeTicks(tStart, tEnd, plotW);
  let labels = '';
  for (const t of ticks) {
    const dt = new Date(t);
    const isDate = stepH >= 24 || dt.getHours() === 0;
    const txt = isDate
      ? dt.toLocaleDateString(lang(), { day: 'numeric', month: 'numeric' })
      : dt.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
    labels += `<text class="wp-nat-curve-axis" x="${f(x(t))}" y="${H - 6}" text-anchor="middle">${escapeHtml(txt)}</text>`;
  }

  const paths = groups.map(g => {
    let d = `M${f(x(pts[0].t))},${f(y(pts[0][g]))}`;
    for (let k = 1; k < pts.length; k++) d += ` H${f(x(pts[k].t))} V${f(y(pts[k][g]))}`;
    return `<path d="${d}" fill="none" stroke="${GROUP_COLORS[g]}" stroke-width="2" stroke-linejoin="round"/>
      <circle cx="${f(x(tEnd))}" cy="${f(y(pts[pts.length - 1][g]))}" r="3.2" fill="${GROUP_COLORS[g]}"/>`;
  }).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-curve-svg" role="img"
      aria-label="${escapeHtml(natT('trendTitle'))}">
      ${grid}${labels}${paths}
      <line class="wp-nat-trend-cursor" y1="${PAD.top}" y2="${PAD.top + plotH}" x1="0" x2="0" hidden/>
      <rect class="wp-nat-trend-hit" x="${PAD.left}" y="${PAD.top}" width="${plotW}" height="${plotH}"/></svg>`;

  bindHover(slot, pts.filter(p => !p.end), { W, plotW, tStart, tEnd });
}

/* ── Tooltip: il valore in vigore sotto il cursore ─────────────── */

function bindHover(slot, pts, ctx) {
  const svg = slot.querySelector('svg');
  const card = slot.parentElement;
  const tip = card?.querySelector('.wp-nat-lv-tip');
  const cursor = svg?.querySelector('.wp-nat-trend-cursor');
  if (!svg || !tip || !cursor) return;

  const hide = () => { tip.hidden = true; cursor.setAttribute('hidden', ''); };
  const move = (e) => {
    const box = svg.getBoundingClientRect();
    const px = (e.clientX - box.left) / (box.width / ctx.W);   // l'SVG può essere scalato dal CSS
    if (px < PAD.left || px > ctx.W - PAD.right) { hide(); return; }
    const t = ctx.tStart + ((px - PAD.left) / ctx.plotW) * (ctx.tEnd - ctx.tStart);
    // Scalini: vale l'ultima riga a quell'istante o prima.
    let p = pts[0];
    for (const r of pts) { if (r.t <= t) p = r; else break; }

    cursor.setAttribute('x1', px.toFixed(1));
    cursor.setAttribute('x2', px.toFixed(1));
    cursor.removeAttribute('hidden');

    const head = new Date(t).toLocaleString(lang(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    tip.innerHTML = `<div class="wp-nat-lv-tip-head">${escapeHtml(head)}</div>
      <ul class="wp-nat-lv-tip-list">
        ${GROUPS.map(g => `<li${_hidden.has(g) ? ' style="opacity:.5"' : ''}><span class="wp-nat-dot" style="background:${GROUP_COLORS[g]}"></span>
          <span class="wp-nat-lv-tip-name">${escapeHtml(natT(g))}</span><strong>${p[g].toLocaleString(lang())}</strong></li>`).join('')}
        <li><span class="wp-nat-dot" style="visibility:hidden"></span>
          <span class="wp-nat-lv-tip-name">${escapeHtml(natT('trendKnown'))}</span><strong>${p.known.toLocaleString(lang())}</strong></li>
        <li class="wp-nat-curve-tip-open">${escapeHtml(natT('trendReading').replace('{when}', fmtDate(p.at)))}</li>
      </ul>`;
    tip.hidden = false;

    // Il tooltip resta dentro la carta: oltre metà larghezza passa a sinistra.
    const cb = card.getBoundingClientRect();
    const left = e.clientX - cb.left;
    const flip = left > cb.width / 2;
    tip.style.left = `${Math.max(4, Math.min(cb.width - tip.offsetWidth - 4, flip ? left - tip.offsetWidth - 12 : left + 12))}px`;
    tip.style.top = `${Math.max(4, e.clientY - cb.top - tip.offsetHeight - 10)}px`;
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', hide);
}
