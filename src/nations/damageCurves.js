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
     2. Come si muove il totale giorno per giorno, dove le ore si perdono
        e si vede solo la tendenza.

   ── MEDIA E STORICO LUNGO (richiesta dell'utente, 2026-10-22) ────
   «Una media del selezionato, e poter tornare più indietro di 2
   settimane». In entrambi i grafici una linea tratteggiata con la media
   della finestra scelta, detta anche in cifre sotto. La curva giornaliera
   ha ora le sue finestre (14/30/90 giorni, tutto): prima dei giorni di
   /damage-timeline usa lo scatto notturno del totale (/damage-history,
   vedi api.js: fetchDamageHistory), che arriva fino a giugno. Dove fra
   due scatti passano più giorni (backup settimanali, dump di giugno) il
   danno è una MEDIA su quei giorni: si disegna come un tratto piatto e
   tratteggiato, e il tooltip lo dice — un punto per giorno sarebbe un
   dato inventato. Il grafico orario ha anche "30g": il server ora tiene
   32 giorni di ore (prima 16), quindi si riempie da solo nei giorni dopo
   il rideploy, e finché non è pieno lo dichiara.

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
import { fetchDamageTimeline, fetchDamageHistory } from './api.js';
import { trackEvent } from '../shared/analytics.js';
import { escapeHtml, fmtCompact } from '../mu/ui.js';
import { finePoints, pillCompare, pillSegments } from '../shared/pillInstants.js';

const DMG_COLOR = '#e5484d';      // stessa tinta della "guerra" nella ciambella
const PILL_COLOR = '#a371f7';
const HOUR_MS = 3600 * 1000;

// 7 e 14 giorni dal 2026-10-15, quando il server ha cominciato a tenere
// l'ora di ogni pillola per due settimane (TAKES_KEEP_MS in
// server/damageTimeline.js). Il danno orario c'era già per 16 giorni.
// 30 giorni dal 2026-10-22: il server tiene 32 giorni di ore; oltre le due
// settimane i pillati sono quelli orari (le hh:30), la curva fine no.
const RANGES = [24, 48, 72, 7 * 24, 14 * 24, 30 * 24];
/** "24h", "7g": l'etichetta di una finestra, nei bottoni e in "{h} fa". */
const rangeLabel = (h) => (h % 24 === 0 && h > 72 ? `${h / 24}${natT('curveDayShort')}` : `${h}${natT('curveHourShort')}`);
const RANGE_KEY = 'we_nat_curve_hours';
// Finestre della curva giornaliera, in giorni; 0 = tutto l'archivio.
const DAILY_RANGES = [14, 30, 90, 0];
const DAILY_KEY = 'we_nat_curve_days';
const DAY_MS = 24 * HOUR_MS;
let _days = (() => {
  try {
    // ⚠️ Number(null) è 0, cioè "tutto": senza una scelta salvata si parte da 14.
    const raw = localStorage.getItem(DAILY_KEY);
    const v = raw == null ? NaN : Number(raw);
    return DAILY_RANGES.includes(v) ? v : 14;
  } catch { return 14; }
})();
let _history = null;   // /damage-history della nazione aperta (giorni)

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

  const [own, world, history] = await Promise.all([
    // Un'ora in più della finestra più larga: il confronto orario dei
    // pillati (pillStatsHtml) prende l'ultima ora chiusa e la stessa ora
    // 72 ore prima, che con 72 ore esatte resterebbe fuori di una.
    fetchDamageTimeline(nation._id, { hours: Math.max(...RANGES) + 1, days: 32 }),
    fetchDamageTimeline(null, { hours: Math.max(...RANGES) + 1, days: 32 }),
    fetchDamageHistory(nation._id),
  ]);
  if (_nation?._id !== nation._id) return;      // nazione cambiata nel frattempo
  _history = history;

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
          ${RANGES.map(h => `<button type="button" data-h="${h}" class="${h === _hours ? 'active' : ''}">${escapeHtml(rangeLabel(h))}</button>`).join('')}
        </div>
      </div>
      ${pillStatsHtml(own)}
      ${legendHtml(!!own.pill?.fine)}
      <div class="wp-nat-curve-slot" id="wp-nat-curve-hourly"></div>
      <div class="wp-nat-lv-tip" hidden></div>
      ${peakHtml(own, world)}
    </div>
    <div class="wp-nat-curve-card">
      <div class="wp-nat-curve-head">
        <h4 class="wp-nat-chart-title">${escapeHtml(natT('curveDaily'))}</h4>
        <div class="wp-nat-curve-range" id="wp-nat-curve-drange" role="group">
          ${DAILY_RANGES.map(d => `<button type="button" data-d="${d}" class="${d === _days ? 'active' : ''}">${escapeHtml(d ? `${d}${natT('curveDayShort')}` : natT('curveAll'))}</button>`).join('')}
        </div>
      </div>
      <div class="wp-nat-curve-slot" id="wp-nat-curve-daily"></div>
      <div class="wp-nat-lv-tip" hidden></div>
    </div>`;

  _host.querySelector('#wp-nat-curve-drange')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-d]');
    if (!btn) return;
    _days = Number(btn.dataset.d);
    trackEvent('nations-damage-days', { days: _days });
    try { localStorage.setItem(DAILY_KEY, String(_days)); } catch { /* storage negato */ }
    paint(own, world);
  });

  _host.querySelector('#wp-nat-curve-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-h]');
    if (!btn) return;
    _hours = Number(btn.dataset.h);
    trackEvent('nations-damage-range', { hours: _hours });
    try { localStorage.setItem(RANGE_KEY, String(_hours)); } catch { /* storage negato */ }
    paint(own, world);
  });

  drawHourly(own);
  drawDaily(own);
}

/* ── Fasce dichiarative ────────────────────────────────────────── */

/** Da quando in qua l'archivio guarda. Si mostra solo finché è un limite
 *  vero: passati i 14 giorni la curva è piena e la fascia sparisce (oltre,
 *  lo dice la nota sotto il grafico orario: curveHourlyFrom). */
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

/* ── Pillati: adesso, all'inizio della finestra, differenza ──
   Richiesta dell'utente (2026-10-15): «vorrei sapere quanti sono pillati
   ora precisamente e quanti lo erano in base a cosa seleziono tra
   24/48/72, e la differenza».
   ⚠️ Corretto lo stesso giorno («se l'ultimo valore è 49 perché mi segna
   39?»). La prima versione credeva che il punto orario fosse il MASSIMO
   dell'ora, e per non confrontarlo con un istante esatto ripiegava su due
   ore intere anche per "adesso": la casella mostrava l'ora chiusa
   precedente. Ma il punto orario è anch'esso un ISTANTE: _pillSlots nel
   server conta chi è pillato al CENTRO di ogni secchio, cioè alle hh:30
   (misurato: 08:00 → 39, coi quarti d'ora 15·30·39·42). Quindi:
     · ADESSO è sempre il conteggio esatto di adesso (`pill.instant.now`);
       solo un server che non lo manda ricade sull'ultima hh:30;
     · {h} FA è esatto se il registro arriva fin lì (`pill.instant.ago`),
       altrimenti il conteggio delle hh:30 più vicine a quel momento — un
       istante anche lui, al massimo mezz'ora più in là, e la casella dice
       quale. La differenza fra i due è quindi sempre fra due istanti. */
function pillStatsHtml(tl) {
  const lang = document.documentElement.lang || undefined;
  const hm = (ms) => new Date(ms).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const day = (ms) => new Date(ms).toLocaleDateString(lang, { weekday: 'short' });
  const at = (ms, withDay) => `${withDay ? `${day(ms)} ` : ''}${natT('pillAtTime').replace('{time}', hm(ms))}`;
  const cmp = pillCompare(tl, _hours);
  if (!cmp) return '';
  const { now, then, exact } = cmp;

  const diff = now.n - then.n;
  const pct = then.n ? Math.round((diff / then.n) * 100) : null;
  const sign = (v) => (v > 0 ? '+' : v < 0 ? '−' : '±');
  const cls = diff > 0 ? ' up' : diff < 0 ? ' down' : '';
  const tile = (label, n, sub, extra = '') => `
    <div class="wp-nat-pill-tile${extra}">
      <span class="wp-nat-pill-lab">${escapeHtml(label)}</span>
      <strong>${n}</strong>
      <span class="wp-nat-pill-sub">${escapeHtml(sub)}</span>
    </div>`;
  return `
    <div class="wp-nat-pill-stats">
      ${tile(natT('pillNow'), now.n, at(now.at, false))}
      ${tile(natT('pillAgo').replace('{h}', rangeLabel(_hours)), then.n, at(then.at, true))}
      ${tile(natT('pillDiff'), `${sign(diff)}${Math.abs(diff)}`,
        pct == null ? '—' : `${sign(pct)}${Math.abs(pct)}%`, ` wp-nat-pill-diff${cls}`)}
    </div>
    <p class="wp-nat-curve-note wp-nat-pill-note">${escapeHtml(exact ? natT('pillExactNote') : natT('pillHourNote').replace('{h}', rangeLabel(_hours)))}</p>`;
}

function legendHtml(fine) {
  return `
    <ul class="wp-nat-curve-legend">
      <li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>${escapeHtml(natT('curveDamage'))}</li>
      <li><span class="wp-nat-dot wp-nat-dot-line" style="background:${PILL_COLOR}"></span>${escapeHtml(natT(fine ? 'curvePilled15' : 'curvePilled'))}</li>
    </ul>`;
}

/** La riga sotto il grafico: l'ora di punta, e se coincide con quella del
 *  mondo. Serve a non far scambiare "la mia nazione picchia alle 21" per
 *  una sua caratteristica quando alle 21 picchiano tutti. */
function peakHtml(own, world) {
  // Sulla finestra scelta, come il grafico sopra: da quando la serie arriva
  // a 14 giorni, il picco "di sempre" non sarebbe più quello che si vede.
  const t0 = Date.now() - _hours * HOUR_MS;
  const rows = own.series.filter(s => s.d != null && s.t >= t0);
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

  const wRows = (world?.series || []).filter(s => s.d != null && s.t >= t0);
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

  // ── Pillati ogni 15 minuti (2026-10-15) ──
  // Il danno resta orario: è la risoluzione a cui il gioco lo aggiorna. I
  // pillati no: il server li conta a un ISTANTE ogni 15 minuti dall'ora
  // vera di ogni presa (`pill.fine`, vedi TAKES_KEEP_MS nel server), fino
  // ad ADESSO — l'ora in corso compresa, perché per le pillole non c'è
  // niente da aspettare. Prima che il registro del server arrivi così
  // indietro i punti sono null, e lì restano i punti orari: anche loro
  // istanti (le hh:30, vedi pillStatsHtml), quindi la linea continua senza
  // cambiare stile — solo più rada.
  const fine = finePoints(tl, t0);

  const maxD = Math.max(...rows.map(r => rate(r) || 0), 1);
  const maxP = Math.max(...rows.map(r => r.p || 0), ...fine.map(p => p.v || 0), 1);

  // Asse x sul TEMPO, non sull'indice: con punti di durata diversa una
  // spaziatura uniforme li mostrerebbe tutti larghi uguale, e un buco di
  // tre ore sarebbe indistinguibile da uno di trenta minuti.
  const lastTo = rows[rows.length - 1].to || (rows[rows.length - 1].t + HOUR_MS);
  const tEnd = Math.max(lastTo, fine.length ? fine[fine.length - 1].t : 0);
  // L'ora in corso: nella serie del danno non c'è (si chiude a fine ora),
  // ma i pillati sì. Una riga finta, solo per tooltip ed etichette.
  const allRows = tEnd > lastTo ? [...rows, { t: lastTo, to: lastTo + HOUR_MS, d: null, p: null, open: true }] : rows;
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
  // Un tratto di punti {t, x, v}: pieno fino a `settled`, tratteggiato dopo.
  const pillPath = (pts, settled, faint) => {
    const draw = (part, dashed) => (part.length < 2 ? '' : `<path d="${part.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)},${yP(p.v).toFixed(1)}`).join(' ')}"
      fill="none" stroke="${PILL_COLOR}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${
      dashed ? ' stroke-dasharray="4 3"' : ''}${faint ? ' stroke-opacity=".55"' : ''}/>`);
    const cutAt = pts.findIndex(p => p.t > settled);
    if (cutAt === -1) return draw(pts, false);
    // Il punto di confine sta in ENTRAMBI i tratti, altrimenti fra il
    // pieno e il tratteggiato resta un buco largo un punto.
    return draw(pts.slice(0, cutAt + 1), false) + draw(pts.slice(Math.max(0, cutAt - 1)), true);
  };
  // Ultimo tratto tratteggiato: con la curva fine dove il giro dei
  // cittadini non è ancora passato (`fresh`), senza come prima.
  const settled = fine.length ? (tl.pill?.instant?.fresh ?? Infinity) : (tl.pill?.settledUntil ?? Infinity);
  const line = pillSegments(rows, fine)
    .map(seg => pillPath(seg.map(p => ({ ...p, x: x(p.t) })), settled, false)).join('');

  // Etichette dell'ora: ogni 6 ore, nel fuso di chi guarda. Gli slot sono
  // istanti assoluti, quindi la conversione è esatta — ed è l'ora locale
  // quella che serve per decidere quando collegarsi. Si etichetta sull'ORA
  // piena, mai su una mezza, altrimenti a passo di 30 minuti l'asse
  // stamperebbe due volte lo stesso numero.
  // Oltre le 72 ore un'etichetta ogni 6 ore sarebbero 56 numeri: si passa
  // alla mezzanotte di ogni giorno, col giorno del mese.
  const long = _hours > 72;
  const labels = allRows.map(r => {
    const dt = new Date(r.t);
    if (dt.getMinutes() !== 0 || dt.getHours() % (long ? 24 : 6) !== 0) return '';
    const txt = long
      ? dt.toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'numeric' })
      : String(dt.getHours());
    return `<text class="wp-nat-curve-axis" x="${x(r.t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(txt)}</text>`;
  }).join('');

  // Zone di cattura per il tooltip: una per punto, larga quanto la sua
  // finestra vera — puntare una linea spessa 2px sarebbe impossibile.
  const hits = allRows.map((r, i) => {
    const x0 = x(r.t), x1 = x(Math.min(r.to || r.t + HOUR_MS, tEnd));
    return `<rect class="wp-nat-lv-hit" x="${x0.toFixed(1)}" y="${PAD.top}"
      width="${Math.max(1, x1 - x0).toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`;
  }).join('');

  // ── Media della finestra (2026-10-22) ──
  // Danno: un RITMO pesato sulla durata dei punti (totale ÷ ore misurate),
  // non la media dei ritmi, che darebbe a mezz'ora lo stesso peso di
  // un'ora. Pillati: la media degli istanti disegnati.
  const measured = rows.filter(r => r.d != null);
  const hoursMeasured = measured.reduce((s, r) => s + (r.min || 60) / 60, 0);
  const avgRate = hoursMeasured ? measured.reduce((s, r) => s + r.d, 0) / hoursMeasured : null;
  const pillVals = (fine.some(p => p.v != null) ? fine.map(p => p.v) : rows.map(r => r.p)).filter(v => v != null);
  const avgPill = pillVals.length ? pillVals.reduce((a, b) => a + b, 0) / pillVals.length : null;
  const avgLine = (yy, color, txt, below) => `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${yy.toFixed(1)}" y2="${yy.toFixed(1)}"
      stroke="${color}" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity=".85"/>
    <text class="wp-nat-curve-avglab" x="${W - PAD.right - 4}" y="${(below ? yy + 11 : yy - 4).toFixed(1)}" text-anchor="end" fill="${color}">${escapeHtml(txt)}</text>`;
  const avgs = (avgRate != null ? avgLine(yD(avgRate), DMG_COLOR, `${natT('curveAvgLabel')} ${fmtCompact(avgRate)}`, false) : '')
    + (avgPill != null ? avgLine(yP(avgPill), PILL_COLOR, `${natT('curveAvgLabel')} ${Math.round(avgPill)}`, true) : '');
  const avgNote = avgRate != null || avgPill != null
    ? `<p class="wp-nat-curve-note wp-nat-curve-avgnote">${escapeHtml(natT('curveAvgHourly')
      .replace('{dmg}', avgRate != null ? fmtCompact(avgRate) : '—')
      .replace('{p}', avgPill != null ? String(Math.round(avgPill)) : '—'))}</p>`
    : '';
  // La finestra chiesta è più lunga di quanto il server conserva (32
  // giorni, prima 16): si dice da quando c'è il danno, invece di lasciar
  // credere che prima non si sparasse.
  const firstMeasured = measured[0]?.t;
  const fromNote = firstMeasured && firstMeasured - t0 > 6 * HOUR_MS
    ? `<p class="wp-nat-curve-note">${escapeHtml(natT('curveHourlyFrom').replace('{date}',
      new Date(firstMeasured).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' })))}</p>`
    : '';

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-curve-svg" role="img"
      aria-label="${escapeHtml(natT('curveHourly'))}">${grid}${area}${dLine}${resetDots}${line}${avgs}${labels}${hits}</svg>`
    + avgNote + fromNote
    + (hasDamage ? '' : `<p class="wp-nat-curve-pending">${escapeHtml(natT('curveDamagePending'))}</p>`);

  bindTip(slot, allRows, (r) => hourlyTip(r, fine.filter(p => p.v != null && p.t >= r.t && p.t < (r.to || r.t + HOUR_MS))));
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

function hourlyTip(r, fine = []) {
  // La testata del tooltip e' la FINESTRA, non un istante: questo punto
  // conta il danno fatto fra due orari, e senza dirli si legge come una
  // misura presa alle 14:00 in punto.
  const from = new Date(r.t);
  const to = new Date(r.to || r.t + HOUR_MS);
  const hm = (d) => d.toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' });
  const day = from.toLocaleDateString(document.documentElement.lang || undefined, { weekday: 'short' });
  const head = `${day} ${hm(from)}\u2013${hm(to)}`;

  const dmg = r.open
    ? `<li class="wp-nat-curve-tip-open">${escapeHtml(natT('curveHourOpen'))}</li>`
    : r.d == null
    ? `<li><span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveNoData'))}</span></li>`
    : `<li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveDamage'))}</span><strong>${escapeHtml(fmtCompact(r.d))}</strong></li>
       <li><span class="wp-nat-dot" style="visibility:hidden"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveRate'))}</span><strong>${escapeHtml(fmtCompact(r.d / ((r.min || 60) / 60)))}</strong></li>`;
  // Con la curva fine: gli istanti dell'ora, ciascuno col suo orario (è il
  // dato che la linea disegna). Senza: il massimo dell'ora, come prima.
  const pill = fine.length
    ? `<li><span class="wp-nat-dot" style="background:${PILL_COLOR}"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curvePilledFine'))}</span></li>
       ${fine.map(p => `<li class="wp-nat-curve-tip-fine"><span class="wp-nat-lv-tip-name">${escapeHtml(hm(new Date(p.t)))}</span><strong>${p.v}</strong></li>`).join('')}`
    : r.p == null ? '' : `<li><span class="wp-nat-dot" style="background:${PILL_COLOR}"></span>
       <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curvePilled'))}</span><strong>${r.p}</strong></li>`;
  const reset = r.r ? `<li class="wp-nat-curve-tip-warn">${escapeHtml(natT('curveReset'))}</li>` : '';
  return `<div class="wp-nat-lv-tip-head">${escapeHtml(head)}</div>
          <ul class="wp-nat-lv-tip-list">${dmg}${pill}${reset}</ul>`;
}

/* ── Curva giorno per giorno ──────────────────────────────────── */

const dayStart = (day) => Date.parse(`${day}T00:00:00Z`);

/** I giorni da disegnare, in ordine: quelli di /damage-timeline (ore
 *  sommate, coi pillati) e, PRIMA di loro, quelli dello scatto notturno
 *  (/damage-history): totale del giorno dopo meno totale del giorno. Fra
 *  due scatti distanti più giorni il valore è la media per giorno, con
 *  `n` = quanti giorni copre. */
function dailyItems(tl) {
  const recent = (tl.daily || []).filter(r => r.d != null)
    .map(r => ({ t0: dayStart(r.day), t1: dayStart(r.day) + DAY_MS, v: r.d, n: 1, r }));
  const firstRecent = recent.length ? recent[0].t0 : Infinity;
  const snaps = (_history || []).filter(h => Number.isFinite(h.total)).sort((a, b) => dayStart(a.day) - dayStart(b.day));
  const old = [];
  for (let i = 1; i < snaps.length; i++) {
    const t0 = dayStart(snaps[i - 1].day), t1 = dayStart(snaps[i].day);
    if (t0 >= firstRecent) break;
    const n = Math.round((t1 - t0) / DAY_MS);
    const diff = snaps[i].total - snaps[i - 1].total;
    if (n < 1 || !(diff >= 0)) continue;
    old.push({ t0, t1: Math.min(t1, firstRecent), v: diff / n, n });
  }
  return [...old, ...recent];
}

function drawDaily(tl) {
  const slot = _host?.querySelector('#wp-nat-curve-daily');
  if (!slot) return;

  const today0 = dayStart(new Date().toISOString().slice(0, 10));
  const from = _days ? today0 - (_days - 1) * DAY_MS : -Infinity;
  const items = dailyItems(tl).filter(it => it.t1 > from);
  if (items.length < 2) { slot.innerHTML = `<p class="wp-nat-empty">${escapeHtml(natT('curveDailyEmpty'))}</p>`; return; }

  const W = Math.max(slot.clientWidth || 0, 320);
  const H = 190;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxD = Math.max(...items.map(it => it.v), 1);

  // Asse sul TEMPO, non sull'indice: un tratto di una settimana (media)
  // deve occupare sette giorni di larghezza, non uno.
  const tStart = Math.max(items[0].t0, from);
  const tEnd = items[items.length - 1].t1;
  const x = (t) => PAD.left + ((t - tStart) / Math.max(1, tEnd - tStart)) * plotW;
  const y = (v) => PAD.top + plotH - (v / maxD) * plotH;
  const startOf = (it) => Math.max(it.t0, tStart);

  const ticks = 4;
  let grid = '';
  for (let k = 0; k <= ticks; k++) {
    const yy = PAD.top + (plotH / ticks) * k;
    grid += `<line class="wp-nat-lv-gridline" x1="${PAD.left}" y1="${yy.toFixed(1)}" x2="${W - PAD.right}" y2="${yy.toFixed(1)}"/>
      <text class="wp-nat-curve-axis" x="${PAD.left - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${escapeHtml(fmtCompact(maxD * (1 - k / ticks)))}</text>`;
  }

  // Un giorno è un punto al suo centro; un tratto di più giorni (media) è
  // piatto da un capo all'altro. Fra due punti la linea è piena, se uno
  // dei due è una media è tratteggiata.
  const pts = [];
  items.forEach(it => {
    if (it.n > 1) { pts.push({ t: startOf(it), v: it.v, avg: true }, { t: it.t1, v: it.v, avg: true }); }
    else pts.push({ t: (startOf(it) + it.t1) / 2, v: it.v });
  });
  let solid = '', dashed = '';
  for (let k = 1; k < pts.length; k++) {
    const seg = `M${x(pts[k - 1].t).toFixed(1)},${y(pts[k - 1].v).toFixed(1)} L${x(pts[k].t).toFixed(1)},${y(pts[k].v).toFixed(1)} `;
    if (pts[k - 1].avg || pts[k].avg) dashed += seg; else solid += seg;
  }
  const base = (PAD.top + plotH).toFixed(1);
  const area = `M${x(pts[0].t).toFixed(1)},${base} ${pts.map(p => `L${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(pts[pts.length - 1].t).toFixed(1)},${base} Z`;

  // I giorni PARZIALI (il primo dell'archivio, quello in corso) hanno un
  // pallino vuoto: il loro totale è più basso solo perché conta meno ore,
  // e un pallino pieno lo farebbe leggere come un calo. Con molti giorni
  // i pallini si tolgono: diventerebbero una seconda linea.
  const many = items.length > 45;
  const dots = many ? '' : items.filter(it => it.n === 1).map(it => `<circle class="wp-nat-curve-dot" cx="${x((startOf(it) + it.t1) / 2).toFixed(1)}" cy="${y(it.v).toFixed(1)}" r="3.2"
     fill="${it.r?.partial ? 'var(--wp-ov-surface, #161b22)' : DMG_COLOR}" stroke="${DMG_COLOR}" stroke-width="1.6"/>`).join('');

  // Media del periodo: giorni pieni pesati per quanti giorni coprono (un
  // tratto settimanale vale sette giorni); i parziali restano fuori.
  let sum = 0, cnt = 0;
  for (const it of items) {
    if (it.r?.partial) continue;
    const span = (it.t1 - startOf(it)) / DAY_MS;
    sum += it.v * span; cnt += span;
  }
  const avg = cnt ? sum / cnt : null;
  const avgSvg = avg == null ? '' : `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"
      stroke="${DMG_COLOR}" stroke-width="1.2" stroke-dasharray="5 4" stroke-opacity=".85"/>
    <text class="wp-nat-curve-avglab" x="${W - PAD.right - 4}" y="${(y(avg) - 4).toFixed(1)}" text-anchor="end" fill="${DMG_COLOR}">${escapeHtml(`${natT('curveAvgLabel')} ${fmtCompact(avg)}`)}</text>`;

  // Etichette: circa una ogni 80 px, sulla mezzanotte di un giorno.
  const lang = document.documentElement.lang || undefined;
  const nLab = Math.max(2, Math.floor(plotW / 80));
  const stepDays = Math.max(1, Math.round((tEnd - tStart) / DAY_MS / nLab));
  let labels = '';
  for (let t = dayStart(new Date(tStart).toISOString().slice(0, 10)); t <= tEnd; t += stepDays * DAY_MS) {
    if (t < tStart) continue;
    const txt = new Date(t).toLocaleDateString(lang, { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
    labels += `<text class="wp-nat-curve-axis" x="${x(t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(txt)}</text>`;
  }

  const hits = items.map((it, i) => `<rect class="wp-nat-lv-hit" x="${x(startOf(it)).toFixed(1)}" y="${PAD.top}"
    width="${Math.max(1, x(it.t1) - x(startOf(it))).toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="wp-nat-curve-svg" role="img"
      aria-label="${escapeHtml(natT('curveDaily'))}">
      ${grid}
      <path d="${area}" fill="${DMG_COLOR}" fill-opacity=".13"/>
      <path d="${solid}" fill="none" stroke="${DMG_COLOR}" stroke-width="2" stroke-linejoin="round"/>
      <path d="${dashed}" fill="none" stroke="${DMG_COLOR}" stroke-width="2" stroke-dasharray="4 3" stroke-opacity=".8"/>
      ${avgSvg}${dots}${labels}${hits}</svg>`
    + (avg == null ? '' : `<p class="wp-nat-curve-note wp-nat-curve-avgnote">${escapeHtml(natT('curveAvgDaily').replace('{dmg}', fmtCompact(avg)))}</p>`);

  bindTip(slot, items, dailyItemTip);
}

/** Tooltip di un punto della curva giornaliera: un giorno di
 *  /damage-timeline (coi pillati), un giorno dello scatto notturno, o un
 *  tratto di più giorni con la sua media. */
function dailyItemTip(it) {
  if (it.r) return dailyTip(it.r);
  const lang = document.documentElement.lang || undefined;
  const fmtDay = (t) => new Date(t).toLocaleDateString(lang, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const head = it.n > 1 ? `${fmtDay(it.t0)} – ${fmtDay(it.t1 - DAY_MS)}` : fmtDay(it.t0);
  const note = it.n > 1
    ? `<li class="wp-nat-curve-tip-warn">${escapeHtml(natT('curveAvgDays').replace(/\{n\}/g, String(it.n)))}</li>`
    : '';
  return `<div class="wp-nat-lv-tip-head">${escapeHtml(head)}</div>
    <ul class="wp-nat-lv-tip-list">
      <li><span class="wp-nat-dot" style="background:${DMG_COLOR}"></span>
        <span class="wp-nat-lv-tip-name">${escapeHtml(natT('curveDamage'))}</span><strong>${escapeHtml(fmtCompact(it.v))}</strong></li>
      ${note}
    </ul>`;
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
