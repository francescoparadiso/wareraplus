/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: danno ora per ora e curva a 14 giorni
   ------------------------------------------------------------------
   Due grafici che rispondono a due domande diverse sulla stessa nazione:

     1. A CHE ORA picchia davvero — e quanti dei suoi erano sotto pillola
        in quell'ora. Le due serie stanno di proposito nello STESSO
        grafico, su due assi: il punto non è nessuna delle due da sola, è
        se il picco di danno cade dove cade il picco di pillole. Se
        coincidono la nazione si coordina; se la linea delle pillole è
        piatta mentre le barre hanno una punta, quella punta è successa
        senza preparazione (o è arrivata da fuori: mercenari, alleati).
     2. Come si muove il totale sui 14 giorni, dove le ore si perdono e si
        vede solo la tendenza.

   ── COSA SIGNIFICA "PILLATO" ─────────────────────────────────────
   La pillola è l'item `cocain`: +60% attacco per 8 ore, poi 15,5 ore di
   malus. Un giocatore conta come pillato per tutte le ore coperte dal
   buff. Il conteggio è RICOSTRUITO all'indietro dal timestamp di fine
   buff, quindi è esatto e non campionato — vedi il blocco in testa a
   server/damageTimeline.js, dove sta tutta l'aritmetica.

   ── LE TRE COSE CHE QUESTA VISTA NON DEVE MENTIRE ────────────────
   Sono la ragione per cui questo file è più lungo di quanto due grafici
   sembrino meritare:

     · un'ora SENZA MISURA non è un'ora a zero. Il server manda `d: null`
       per le ore in cui non stava guardando (riavvio, ora precedente al
       primo campione): lì la barra non si disegna e la linea si SPEZZA,
       invece di scendere a zero e risalire — una linea che scende a zero
       si legge come "hanno smesso di sparare", che è falso;
     · il danno orario ACCUMULA dal deploy del server e non si recupera a
       ritroso (è la differenza fra due letture). La fascia in cima lo
       dichiara finché l'archivio non è pieno, come già fa la vista dei
       finanziamenti;
     · le ULTIME ore della curva pillole possono ancora crescere (il server
       rirosolve i cittadini a fette, ci mette ~2 ore a girarli tutti):
       quel tratto è tratteggiato, perché altrimenti si leggerebbe come un
       calo di fine serata che non c'è;
     · i punti NON durano tutti uguale. Il server campionava ogni ora ed
       è poi passato a ogni mezz'ora, e i secchi vecchi restano quelli
       che sono (a ritroso non si dividono a metà): ogni punto porta la
       sua durata in `min`. Due conseguenze, entrambe visibili qui:
       l'asse x va sul TEMPO e non sull'indice, altrimenti mezz'ora e
       un'ora occuperebbero la stessa larghezza; e la curva del danno
       porta un RITMO (danno all'ora) invece del totale grezzo, che al
       cambio di passo si dimezzerebbe di colpo mostrando un crollo mai
       avvenuto. Il tooltip riporta la finestra vera, inizio e fine.

   SVG scritto a mano come il resto della vista (charts.js,
   levelPlaystyle.js): niente Chart.js, che nel bundle esiste solo per
   Political.
   ══════════════════════════════════════════════════════════════ */

import { natT } from './i18n.js';
import { fetchDamageTimeline } from './api.js';
import { escapeHtml, fmtCompact } from '../mu/ui.js';

const DMG_COLOR = '#e5484d';      // stessa tinta della "guerra" nella ciambella
const PILL_COLOR = '#a371f7';
const HOUR_MS = 3600 * 1000;

const RANGES = [24, 48, 72];
const RANGE_KEY = 'we_nat_curve_hours';

let _host = null;
let _nation = null;
let _hours = (() => {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY));
    return RANGES.includes(v) ? v : 48;
  } catch { return 48; }
})();

/* ── Ingresso ──────────────────────────────────────────────────── */

/**
 * Disegna la sezione dentro `host`. Se il server non ha l'endpoint la
 * sezione NON compare: svuota l'host e basta. È il degrado voluto (stessa
 * regola del Bilancio unità), non un guasto da segnalare all'utente, che
 * di un endpoint non rideployato non può fare niente.
 */
export async function renderDamageCurves(host, nation) {
  _host = host;
  _nation = nation;
  host.innerHTML = `<div class="wp-nat-curve-loading">${escapeHtml(natT('curveLoading'))}</div>`;

  const [own, world] = await Promise.all([
    fetchDamageTimeline(nation._id, { hours: Math.max(...RANGES) }),
    fetchDamageTimeline(null, { hours: Math.max(...RANGES) }),
  ]);
  if (_nation?._id !== nation._id) return;      // nazione cambiata nel frattempo

  if (!own || !own.known || !own.series.length) { host.innerHTML = ''; return; }
  paint(own, world);
}

function paint(own, world) {
  if (!_host) return;
  _host.innerHTML = `
    <h3 class="wp-nat-section-title">${escapeHtml(natT('curveTitle'))}</h3>
    ${coverageHtml(own)}
    <div class="wp-nat-curve-card">
      <div class="wp-nat-curve-head">
        <h4 class="wp-nat-chart-title">${escapeHtml(natT('curveHourly'))}</h4>
        <div class="wp-nat-curve-range" id="wp-nat-curve-range" role="group">
          ${RANGES.map(h => `<button type="button" data-h="${h}" class="${h === _hours ? 'active' : ''}">${h}${escapeHtml(natT('curveHourShort'))}</button>`).join('')}
        </div>
      </div>
      ${legendHtml()}
      <div class="wp-nat-curve-slot" id="wp-nat-curve-hourly"></div>
      <div class="wp-nat-lv-tip" hidden></div>
      ${peakHtml(own, world)}
    </div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(natT('curveDaily'))}</h4>
      <div class="wp-nat-curve-slot" id="wp-nat-curve-daily"></div>
      <div class="wp-nat-lv-tip" hidden></div>
    </div>`;

  _host.querySelector('#wp-nat-curve-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-h]');
    if (!btn) return;
    _hours = Number(btn.dataset.h);
    try { localStorage.setItem(RANGE_KEY, String(_hours)); } catch { /* storage negato */ }
    paint(own, world);
  });

  drawHourly(own);
  drawDaily(own);
}

/* ── Fasce dichiarative ────────────────────────────────────────── */

/** Da quando in qua l'archivio guarda. Si mostra solo finché è un limite
 *  vero: passati i 14 giorni la curva è piena e la fascia sparisce. */
function coverageHtml(tl) {
  const from = tl.coverageFrom;
  if (!from) return '';
  const days = (Date.now() - from) / (24 * HOUR_MS);
  if (days >= 14) return '';
  const when = new Date(from).toLocaleDateString(document.documentElement.lang || undefined, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
  return `<p class="wp-nat-curve-note">${escapeHtml(natT('curveCoverage').replace('{date}', when))}</p>`;
}

function legendHtml() {
  return `
    <ul class="wp-nat-curve-legend">
      <li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>${escapeHtml(natT('curveDamage'))}</li>
      <li><span class="wp-nat-dot wp-nat-dot-line" style="background:${PILL_COLOR}"></span>${escapeHtml(natT('curvePilled'))}</li>
    </ul>`;
}

/** La riga sotto il grafico: l'ora di punta, e se coincide con quella del
 *  mondo. Serve a non far scambiare "la mia nazione picchia alle 21" per
 *  una sua caratteristica quando alle 21 picchiano tutti. */
function peakHtml(own, world) {
  const rows = own.series.filter(s => s.d != null);
  if (rows.length < 3) return '';
  // Il confronto e' sul RITMO, non sul totale del secchio: fra un punto da
  // un'ora e uno da mezza vincerebbe sempre il primo per il solo fatto di
  // durare il doppio.
  const rate = (r) => r.d / ((r.min || 60) / 60);
  const peak = rows.reduce((a, b) => (rate(b) > rate(a) ? b : a));
  if (!peak.d) return '';

  const hm = (ms) => new Date(ms).toLocaleTimeString(document.documentElement.lang || undefined, {
    hour: '2-digit', minute: '2-digit',
  });
  const hour = `${hm(peak.t)}\u2013${hm(peak.to || peak.t + HOUR_MS)}`;
  let out = `<p class="wp-nat-curve-peak">${escapeHtml(natT('curvePeak').replace('{hour}', hour).replace('{dmg}', fmtCompact(peak.d)))}`;

  // Pillole nella stessa ora: è il confronto per cui i due dati stanno
  // sullo stesso grafico.
  if (peak.p != null) out += ` ${escapeHtml(natT('curvePeakPilled').replace('{n}', String(peak.p)))}`;

  const wRows = (world?.series || []).filter(s => s.d != null);
  if (wRows.length >= 3) {
    const wPeak = wRows.reduce((a, b) => (b.d > a.d ? b : a));
    const same = new Date(wPeak.t).getUTCHours() === new Date(peak.t).getUTCHours();
    out += ` ${escapeHtml(natT(same ? 'curvePeakWorldSame' : 'curvePeakWorldDiff'))}`;
  }
  return `${out}</p>`;
}

/* ── Grafico orario: barre danno + linea pillati ───────────────── */

const PAD = { top: 14, right: 44, bottom: 22, left: 46 };

function drawHourly(tl) {
  const slot = _host?.querySelector('#wp-nat-curve-hourly');
  if (!slot) return;

  const now = Date.now();
  const t0 = now - _hours * HOUR_MS;
  const rows = tl.series.filter(s => s.t >= t0);
  if (!rows.length) { slot.innerHTML = `<p class="wp-nat-empty">${escapeHtml(natT('curveEmpty'))}</p>`; return; }

  const W = Math.max(slot.clientWidth || 0, 320);
  const H = 210;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  // Le prime ore dopo un deploy: le pillole ci sono gia' (ricostruite
  // all'indietro), il danno no (si chiude uno slot alla volta). Senza questa
  // distinzione l'asse sinistro si tarerebbe sul minimo tecnico di 1 e
  // stamperebbe "1 / 0,8 / 0,5" accanto a un grafico senza curva: numeri
  // veri di una scala che non misura niente.
  const hasDamage = rows.some(r => r.d != null);

  // ⚠️ La curva del danno porta un RITMO (danno all'ora), non il totale
  // grezzo del secchio. La serie mescola punti da 60 e da 30 minuti — il
  // server ha cambiato passo strada facendo e ogni punto dichiara il suo
  // (`min`) — e disegnare i valori grezzi farebbe crollare la curva a meta'
  // esattamente dove il passo si dimezza: un dimezzamento che non e' mai
  // successo nel gioco, solo nel campionamento. Il tooltip riporta poi
  // ANCHE il totale della finestra, che e' il numero che si va a cercare.
  const rate = (r) => (r.d == null ? null : r.d / ((r.min || 60) / 60));

  const maxD = Math.max(...rows.map(r => rate(r) || 0), 1);
  const maxP = Math.max(...rows.map(r => r.p || 0), 1);

  // Asse x sul TEMPO, non sull'indice: con punti di durata diversa una
  // spaziatura uniforme li mostrerebbe tutti larghi uguale, e un buco di
  // tre ore sarebbe indistinguibile da uno di trenta minuti.
  const tEnd = rows[rows.length - 1].to || (rows[rows.length - 1].t + HOUR_MS);
  const tStart = rows[0].t;
  const span = Math.max(1, tEnd - tStart);
  const x = (t) => PAD.left + ((t - tStart) / span) * plotW;
  const xMid = (r) => x(r.t + ((r.to || r.t + HOUR_MS) - r.t) / 2);
  const yD = (v) => PAD.top + plotH - (v / maxD) * plotH;
  const yP = (v) => PAD.top + plotH - (v / maxP) * plotH;

  // Griglia + asse sinistro (danno/ora) e destro (pillati): due unità sullo
  // stesso riquadro, ognuna con le sue etichette dalla sua parte, così non
  // si può leggere un numero sull'asse sbagliato.
  const ticks = 4;
  let grid = '';
  for (let k = 0; k <= ticks; k++) {
    const y = PAD.top + (plotH / ticks) * k;
    const dv = maxD * (1 - k / ticks);
    const pv = maxP * (1 - k / ticks);
    grid += `<line class="wp-nat-lv-gridline" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}"/>
      ${hasDamage ? `<text class="wp-nat-curve-axis" x="${PAD.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(fmtCompact(dv))}</text>` : ''}
      <text class="wp-nat-curve-axis wp-nat-curve-axis-r" x="${W - PAD.right + 6}" y="${(y + 3.5).toFixed(1)}">${Math.round(pv)}</text>`;
  }

  // Curva del danno con la sua area sotto, spezzata sui buchi come quella
  // delle pillole: dove il server non stava guardando la linea si
  // interrompe, non scende a zero.
  const dSegs = segments(rows, rate);
  const area = dSegs.map(seg => {
    if (seg.length < 2) return '';
    const d = seg.map(({ i, v }, k) => `${k ? 'L' : 'M'}${xMid(rows[i]).toFixed(1)},${yD(v).toFixed(1)}`).join(' ');
    const base = (PAD.top + plotH).toFixed(1);
    return `<path d="${d} L${xMid(rows[seg[seg.length - 1].i]).toFixed(1)},${base} L${xMid(rows[seg[0].i]).toFixed(1)},${base} Z"
      fill="${DMG_COLOR}" fill-opacity=".12"/>`;
  }).join('');
  const dLine = dSegs.map(seg => {
    if (seg.length < 2) return '';
    const d = seg.map(({ i, v }, k) => `${k ? 'L' : 'M'}${xMid(rows[i]).toFixed(1)},${yD(v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${DMG_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join('');
  // Lo slot in cui il contatore settimanale e' ripartito porta un valore
  // parziale: si segna con un pallino cavo invece di sparire dentro la
  // curva come se fosse una misura piena.
  const resetDots = rows.map(r => (r.r && r.d != null
    ? `<circle cx="${xMid(r).toFixed(1)}" cy="${yD(rate(r)).toFixed(1)}" r="3" fill="var(--wp-ov-surface, #161b22)" stroke="${DMG_COLOR}" stroke-width="1.6"/>`
    : '')).join('');

  // Linea pillati, spezzata sui buchi (vedi segments()) e poi ancora sul
  // confine dell'assestamento: SOLO la coda ancora incompleta va
  // tratteggiata. Tratteggiare tutta la linea perché finisce nella zona
  // provvisoria direbbe che l'intera curva è incerta, che è il contrario
  // di quello che c'è da comunicare.
  const settled = tl.pill?.settledUntil ?? Infinity;
  const path = (pts, dashed) => {
    if (pts.length < 2) return '';
    const d = pts.map(({ i, v }, k) => `${k ? 'L' : 'M'}${xMid(rows[i]).toFixed(1)},${yP(v).toFixed(1)}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${PILL_COLOR}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"${dashed ? ' stroke-dasharray="4 3"' : ''}/>`;
  };
  const line = segments(rows, r => r.p).map(seg => {
    const cutAt = seg.findIndex(({ i }) => rows[i].t > settled);
    if (cutAt === -1) return path(seg, false);
    // Il punto di confine sta in ENTRAMBI i tratti, altrimenti fra il
    // pieno e il tratteggiato resta un buco largo uno slot.
    return path(seg.slice(0, cutAt + 1), false) + path(seg.slice(Math.max(0, cutAt - 1)), true);
  }).join('');

  // Etichette dell'ora: ogni 6 ore, nel fuso di chi guarda. Gli slot sono
  // istanti assoluti, quindi la conversione è esatta — ed è l'ora locale
  // quella che serve per decidere quando collegarsi. Si etichetta sull'ORA
  // piena, mai su una mezza, altrimenti a passo di 30 minuti l'asse
  // stamperebbe due volte lo stesso numero.
  const labels = rows.map(r => {
    const dt = new Date(r.t);
    if (dt.getMinutes() !== 0 || dt.getHours() % 6 !== 0) return '';
    return `<text class="wp-nat-curve-axis" x="${x(r.t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${dt.getHours()}</text>`;
  }).join('');

  // Zone di cattura per il tooltip: una per punto, larga quanto la sua
  // finestra vera — puntare una linea spessa 2px sarebbe impossibile.
  const hits = rows.map((r, i) => {
    const x0 = x(r.t), x1 = x(r.to || r.t + HOUR_MS);
    return `<rect class="wp-nat-lv-hit" x="${x0.toFixed(1)}" y="${PAD.top}"
      width="${Math.max(1, x1 - x0).toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`;
  }).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-curve-svg" role="img"
      aria-label="${escapeHtml(natT('curveHourly'))}">${grid}${area}${dLine}${resetDots}${line}${labels}${hits}</svg>`
    + (hasDamage ? '' : `<p class="wp-nat-curve-pending">${escapeHtml(natT('curveDamagePending'))}</p>`);

  bindTip(slot, rows, hourlyTip);
}

/** Spezza la serie in tratti continui, saltando i valori nulli: una linea
 *  che attraversa un buco inventa i punti che non ci sono. */
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

function hourlyTip(r) {
  // La testata del tooltip e' la FINESTRA, non un istante: questo punto
  // conta il danno fatto fra due orari, e senza dirli si legge come una
  // misura presa alle 14:00 in punto.
  const from = new Date(r.t);
  const to = new Date(r.to || r.t + HOUR_MS);
  const hm = (d) => d.toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' });
  const day = from.toLocaleDateString(document.documentElement.lang || undefined, { weekday: 'short' });
  const head = `${day} ${hm(from)}\u2013${hm(to)}`;

  const dmg = r.d == null
    ? `<li><span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveNoData'))}</span></li>`
    : `<li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveDamage'))}</span><strong>${escapeHtml(fmtCompact(r.d))}</strong></li>
       <li><span class="wp-nat-dot" style="visibility:hidden"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveRate'))}</span><strong>${escapeHtml(fmtCompact(r.d / ((r.min || 60) / 60)))}</strong></li>`;
  const pill = r.p == null ? '' : `<li><span class="wp-nat-dot" style="background:${PILL_COLOR}"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curvePilled'))}</span><strong>${r.p}</strong></li>`;
  const reset = r.r ? `<li class="wp-nat-curve-tip-warn">${escapeHtml(natT('curveReset'))}</li>` : '';
  return `<div class="wp-nat-lv-tip-head">${escapeHtml(head)}</div>
          <ul class="wp-nat-lv-tip-list">${dmg}${pill}${reset}</ul>`;
}

/* ── Curva a 14 giorni ─────────────────────────────────────────── */

function drawDaily(tl) {
  const slot = _host?.querySelector('#wp-nat-curve-daily');
  if (!slot) return;

  const rows = (tl.daily || []).filter(r => r.d != null);
  if (rows.length < 2) { slot.innerHTML = `<p class="wp-nat-empty">${escapeHtml(natT('curveDailyEmpty'))}</p>`; return; }

  const W = Math.max(slot.clientWidth || 0, 320);
  const H = 180;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxD = Math.max(...rows.map(r => r.d), 1);
  const step = rows.length > 1 ? plotW / (rows.length - 1) : plotW;

  const x = (i) => PAD.left + i * step;
  const y = (v) => PAD.top + plotH - (v / maxD) * plotH;

  const ticks = 4;
  let grid = '';
  for (let k = 0; k <= ticks; k++) {
    const yy = PAD.top + (plotH / ticks) * k;
    grid += `<line class="wp-nat-lv-gridline" x1="${PAD.left}" y1="${yy.toFixed(1)}" x2="${W - PAD.right}" y2="${yy.toFixed(1)}"/>
      <text class="wp-nat-curve-axis" x="${PAD.left - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(fmtCompact(maxD * (1 - k / ticks)))}</text>`;
  }

  const pts = rows.map((r, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(r.d).toFixed(1)}`).join(' ');
  const area = `${pts} L${x(rows.length - 1).toFixed(1)},${(PAD.top + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.top + plotH).toFixed(1)} Z`;

  // I giorni PARZIALI (il primo dell'archivio, quello in corso) hanno un
  // pallino vuoto: il loro totale è più basso solo perché conta meno ore,
  // e un pallino pieno lo farebbe leggere come un calo.
  const dots = rows.map((r, i) => `<circle class="wp-nat-curve-dot" cx="${x(i).toFixed(1)}" cy="${y(r.d).toFixed(1)}" r="3.2"
     fill="${r.partial ? 'var(--wp-ov-surface, #161b22)' : DMG_COLOR}" stroke="${DMG_COLOR}" stroke-width="1.6"/>`).join('');

  const labels = rows.map((r, i) => {
    if (rows.length > 8 && i % 2) return '';
    const dt = new Date(`${r.day}T00:00:00Z`);
    const txt = dt.toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'numeric' });
    return `<text class="wp-nat-curve-axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(txt)}</text>`;
  }).join('');

  const hits = rows.map((r, i) => `<rect class="wp-nat-lv-hit" x="${(x(i) - step / 2).toFixed(1)}" y="${PAD.top}"
    width="${step.toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-curve-svg" role="img"
      aria-label="${escapeHtml(natT('curveDaily'))}">
      ${grid}
      <path d="${area}" fill="${DMG_COLOR}" fill-opacity=".13"/>
      <path d="${pts}" fill="none" stroke="${DMG_COLOR}" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${labels}${hits}</svg>`;

  bindTip(slot, rows, dailyTip);
}

function dailyTip(r) {
  const dt = new Date(`${r.day}T00:00:00Z`);
  const head = dt.toLocaleDateString(document.documentElement.lang || undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  const pill = r.pPeak == null ? '' : `<li><span class="wp-nat-dot" style="background:${PILL_COLOR}"></span>
      <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curvePilledPeak'))}</span><strong>${r.pPeak}</strong></li>`;
  const partial = r.partial
    ? `<li class="wp-nat-curve-tip-warn">${escapeHtml(natT('curvePartialDay').replace('{n}', String(r.hours)))}</li>`
    : '';
  return `<div class="wp-nat-lv-tip-head">${escapeHtml(head)}</div>
    <ul class="wp-nat-lv-tip-list">
      <li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>
        <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveDamage'))}</span><strong>${escapeHtml(fmtCompact(r.d))}</strong></li>
      ${pill}${partial}
    </ul>`;
}

/* ── Tooltip: stesso meccanismo di levelPlaystyle.js ───────────── */

function bindTip(slot, rows, build) {
  const tip = slot.parentElement?.querySelector('.wp-nat-lv-tip');
  if (!tip) return;

  slot.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.wp-nat-lv-hit');
    if (!hit) { tip.hidden = true; return; }
    const r = rows[Number(hit.dataset.i)];
    if (!r) { tip.hidden = true; return; }
    tip.innerHTML = build(r);
    tip.hidden = false;
    // Il tooltip resta dentro la carta: oltre metà larghezza esce a
    // sinistra del cursore invece che a destra.
    const box = slot.parentElement.getBoundingClientRect();
    const left = e.clientX - box.left;
    const flip = left > box.width / 2;
    tip.style.left = `${Math.max(4, Math.min(box.width - tip.offsetWidth - 4, flip ? left - tip.offsetWidth - 12 : left + 12))}px`;
    tip.style.top = `${Math.max(4, e.clientY - box.top - tip.offsetHeight - 10)}px`;
  });
  slot.addEventListener('mouseleave', () => { tip.hidden = true; });
}
