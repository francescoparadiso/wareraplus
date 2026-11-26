/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: economia della nazione
   ------------------------------------------------------------------
   Sei cose, dalla più generale alla più fine:

     1. il TESORO di adesso (già in memoria: `rankings.countryWealth`) con
        la variazione a 7 e 30 giorni e la sua curva, dallo storico che il
        server scatta ogni giorno (/country-treasury);
     2. i BONIFICI fra tesori in entrata e in uscita (l'archivio dei
        finanziamenti, lo stesso del dettaglio battaglia) e da chi/a chi;
     3. le DONAZIONI dei giocatori, giorno per giorno: quanto ha ricevuto
        il tesoro della nazione e quanto le sue unità militari
        (/donations);
     4. il raffronto fra le due cose, in una ciambella;
     5. quanto ha ricevuto CIASCUNA unità della nazione, con donatori e
        andamento giornaliero;
     6. il CONFRONTO con le altre nazioni: donazioni ricevute per cittadino
        attivo e per punto di sviluppo (/donations-by-country).

   Fra 1 e 2, dal 2026-11-20: la FELICITÀ dei dipendenti delle aziende che
   stanno nella nazione (/employee-happiness, contata dal censimento
   notturno sulla rosa: vedi "LA FELICITÀ" in server/companyCensus.js).
   È una fotografia della notte; la curva si accumula da quel giorno.

   Una `donation` va da un giocatore (`buyerId`) a una nazione, un'unità o
   un partito (`seller*Id`): vedi server/donations.js. Non si filtra per
   nazionalità del donatore, che la riga non porta.

   ── COSA NON SI SA, E LA SCHEDA LO DICE ──────────────────────────────
   · il tesoro è `countryWealth`, MAI `country.money` (fermo da mesi: somma
     54 mila contro i 4,4 milioni della classifica);
   · bonifici e donazioni si ACCUMULANO dal giorno in cui il server ha
     cominciato a guardare: l'API ne ricorda poco. Prima di `coverageFrom`
     l'assenza di una riga NON è «nessuna donazione», e un giorno prima di
     quella data si lascia fuori dal grafico invece di disegnarlo a zero;
   · le donazioni ai partiti restano in archivio ma non si mostrano: la riga
     non porta la nazione del partito.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, flagImg } from '../mu/ui.js';
import { tipAttr } from '../shared/chartTip.js';
import { fetchMoneyTransfers } from '../battles/moneyTransfers.js';
import { state } from '../diplomacy/state.js';
import { donutHtml } from './charts.js';
import { fetchMuDirectory } from '../mu/api.js';
import { fetchDonations, fetchDonationsByCountry, fetchTreasury, fetchEmployeeHappiness, fetchCitizensWealth, getNations } from './api.js';
import { metricValue } from './metrics.js';
import { ecoT } from './i18nEco.js';
import { fetchCompanyCount, cocT, COC_RANGES } from './companyCount.js';

const W = 640, H = 150, PAD_T = 10, PAD_B = 4;
const C_TREASURY = '#e3b341';
const C_IN = '#3fb950';
const C_OUT = '#e5484d';
const C_DON = ['#e3b341', '#58a6ff'];   // dal tesoro · dalle unità
// 24 ore e 3 giorni esistono perché l'archivio delle donazioni è giovane (parte
// dal 10 novembre): 7, 30 e 90 giorni danno lo STESSO dato finché non cresce.
const RANGES = [1, 3, 7, 30, 90];
const DAY_MS = 86400_000;

const RANGE_KEY = 'we_nat_eco_range';
let _range = (() => {
  try { const v = Number(localStorage.getItem(RANGE_KEY)); return RANGES.includes(v) ? v : 30; }
  catch { return 30; }
})();

let _host = null;
let _nation = null;

/* ── utilità ───────────────────────────────────────────────────── */

/* Oro arrotondato: su cifre di settimane i centesimi sono rumore. */
const oro = (v) => {
  const n = Math.round(Number(v) || 0);
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString(document.documentElement.lang || undefined);
};
const signed = (v) => `${v > 0 ? '+' : ''}${oro(v)}`;

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(`${d}T12:00:00Z`);
function fmtData(giorno) {
  return new Date(`${giorno}T12:00:00Z`)
    .toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' });
}
function nomeDi(id) { return state.nationMap?.get(id)?.name || id; }

/** I giorni UTC da oggi - (n-1) a oggi. */
function lastDays(n) {
  const out = [];
  const t0 = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(dayOf(t0 - i * DAY_MS));
  return out;
}

/* ── ingresso ──────────────────────────────────────────────────── */

export async function renderEco(host, nation) {
  _host = host;
  _nation = nation;
  paintShell();
  await load();
}

function paintShell() {
  _host.innerHTML = `
    <h3 class="wp-nat-section-title">
      ${escapeHtml(ecoT('ecoTitle', { nation: _nation.name || '—' }))}
      <div class="wp-nat-tools">
        <div class="wp-nat-curve-range" id="wp-nat-eco-range" role="group">
          ${RANGES.map(r => `<button type="button" data-r="${r}" class="${r === _range ? 'active' : ''}">${escapeHtml(ecoT('r' + r))}</button>`).join('')}
        </div>
      </div>
    </h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('ecoSub'))}</p>
    <div id="wp-nat-eco-body"><div class="wp-nat-empty">…</div></div>`;
  _host.querySelector('#wp-nat-eco-range').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b || Number(b.dataset.r) === _range) return;
    _range = Number(b.dataset.r);
    try { localStorage.setItem(RANGE_KEY, String(_range)); } catch { /* storage negato */ }
    _host.querySelectorAll('#wp-nat-eco-range button').forEach(x => x.classList.toggle('active', x === b));
    load();
  });
}

async function load() {
  const nation = _nation;
  const range = _range;
  const [treasury, donations, transfers, directory, byCountry, happiness, citizens, companies] = await Promise.all([
    fetchTreasury(nation._id).catch(() => null),
    fetchDonations(nation._id, range).catch(() => null),
    fetchMoneyTransfers().catch(() => null),
    // Per i soldi in cassa di ogni unità: la directory è già in memoria se
    // si è aperta la scheda Unità militari, e comunque è una fetch per sessione.
    fetchMuDirectory().catch(() => null),
    fetchDonationsByCountry(range).catch(() => null),
    fetchEmployeeHappiness(nation._id).catch(() => null),
    fetchCitizensWealth(nation._id).catch(() => null),
    fetchCompanyCount(nation._id).catch(() => null),
  ]);
  // Nazione o intervallo cambiati mentre si aspettava: questo disegno è vecchio.
  if (_nation?._id !== nation._id || _range !== range || !_host?.isConnected) return;
  const body = _host.querySelector('#wp-nat-eco-body');
  if (!body) return;
  body.innerHTML = tilesAndTreasury(treasury, transfers)
    + citizensWealthHtml(citizens)
    + companyCountHtml(companies)
    + happinessHtml(happiness)
    + transfersHtml(transfers)
    + donationsHtml(donations)
    + unitsHtml(donations, directory)
    + compareHtml(byCountry);
  body.querySelector('#wp-nat-eco-units')?.addEventListener('click', openUnit);
  bindCompanyCount(body);
  bindHappyRange(body);
  body.querySelector('#wp-nat-cmp-sort')?.addEventListener('change', (e) => {
    _cmpSort = e.target.value;
    const slot = body.querySelector('#wp-nat-cmp-body');
    if (slot) { slot.innerHTML = compareBodyHtml(); revealMe(slot); }
  });
  revealMe(body.querySelector('#wp-nat-cmp-body'));
}

/* ── 1. tesoro + tessere ───────────────────────────────────────── */

function treasuryAt(points, ago) {
  // L'ultimo punto a `ago` giorni o più fa. Se la storia comincia dopo,
  // null: non si inventa un confronto con un giorno che non si conosce.
  const target = dayOf(Date.now() - ago * DAY_MS);
  let found = null;
  for (const [d, v] of points) { if (d <= target) found = v; else break; }
  return found;
}

function tilesAndTreasury(treasury, transfers) {
  const id = _nation._id;
  const wealth = _nation.rankings?.countryWealth;
  const now = Number(wealth?.value);
  const rank = wealth?.rank;
  const delta = (ago) => {
    const old = treasury ? treasuryAt(treasury, ago) : null;
    return old != null && Number.isFinite(now) ? now - old : null;
  };
  const d7 = delta(7), d30 = delta(30);

  const since = Date.now() - _range * DAY_MS;
  const inside = (transfers?.transfers || []).filter(t => t.at >= since);
  const recv = inside.filter(t => t.to === id).reduce((s, t) => s + t.money, 0);
  const sent = inside.filter(t => t.from === id).reduce((s, t) => s + t.money, 0);

  const tile = (lab, val, cls = '', tip = '') => `
    <div class="wp-nat-lab-tile"${tip ? ` title="${escapeHtml(tip)}"` : ''}>
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val ${cls}">${escapeHtml(val)}</strong>
    </div>`;
  const sgn = (v) => (v == null ? '' : v >= 0 ? 'wp-nat-up' : 'wp-nat-down');

  const tiles = [
    tile(ecoT('ecoTreasury'), Number.isFinite(now) ? oro(now) : '—', '', ecoT('ecoTreasuryNote')),
    tile(ecoT('ecoRank'), rank ? `#${rank}` : '—'),
    tile(ecoT('ecoChange7'), d7 == null ? '—' : signed(d7), sgn(d7)),
    tile(ecoT('ecoChange30'), d30 == null ? '—' : signed(d30), sgn(d30)),
    tile(ecoT('ecoRecv'), transfers ? oro(recv) : '—', 'wp-nat-up'),
    tile(ecoT('ecoSent'), transfers ? oro(sent) : '—', 'wp-nat-down'),
    tile(ecoT('ecoNet'), transfers ? signed(recv - sent) : '—', transfers ? sgn(recv - sent) : ''),
  ].join('');

  const pts = (treasury || []).filter(([d]) => d >= dayOf(since));
  // Il punto di oggi non è ancora nello storico (scatto alle 02:05): si
  // aggiunge il valore in memoria, che è lo stesso dato più fresco.
  if (Number.isFinite(now) && (!pts.length || pts[pts.length - 1][0] < dayOf(Date.now()))) {
    pts.push([dayOf(Date.now()), now]);
  }
  const chart = treasury && pts.length > 1
    ? lineChartHtml(pts)
    : `<p class="wp-nat-lab-note">${escapeHtml(ecoT('ecoNoHist'))}</p>`;

  return `
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('ecoTreasuryChart'))}</h4>
      <div class="wp-nat-curve-slot">${chart}</div>
    </div>`;
}

/* WarEra+ (2026-11-22) — la ricchezza dei CITTADINI accanto al tesoro.
   Richiesta dell'utente: «la treasury mostra la wealth nazionale, io voglio
   anche vedere lo storico dell'aggregato della wealth dei cittadini». Una
   carta a sé e non una seconda linea sul grafico del tesoro: è un ordine di
   grandezza sopra, e sullo stesso asse il tesoro diventerebbe piatto.
   Stesso intervallo dei bottoni in cima alla scheda. Ogni giocatore conta per
   la nazione di cui era cittadino QUEL giorno (vedi readCitizensWealth in
   server/playerParts.js), quindi lo storico parte dal primo giro e non si
   allunga all'indietro con la nazionalità di oggi. */
const C_CITIZENS = '#58a6ff';

function citizensWealthHtml(cit) {
  const since = Date.now() - _range * DAY_MS;
  const pts = (cit?.days || []).filter(([d, v]) => d >= dayOf(since) && Number.isFinite(v)).map(([d, v]) => [d, v]);
  const last = cit?.days?.length ? cit.days[cit.days.length - 1] : null;
  const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const body = cit && pts.length > 1
    ? lineChartHtml(pts, { color: C_CITIZENS, label: ecoT('citChart'), aria: ecoT('citChart') })
    : `<p class="wp-nat-lab-note">${escapeHtml(ecoT('citNoHist'))}</p>`;
  return `
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('citChart'))}</h4>
      ${last ? `<p class="wp-nat-lab-note">${escapeHtml(ecoT('citLatest', { v: oro(last[1]), n: Number(last[2] || 0).toLocaleString(document.documentElement.lang || undefined), date: fmtDay(last[0]) }))}</p>` : ''}
      <div class="wp-nat-curve-slot">${body}</div>
      ${cit?.from ? `<p class="wp-nat-lab-note">${escapeHtml(ecoT('citNote', { date: fmtDay(cit.from) }))}</p>` : ''}
    </div>`;
}

/** Linea (con area) di una serie [giorno, valore]: asse x proporzionale al
 *  tempo, perché lo storico ha buchi e i buchi non devono sembrare
 *  continuità. Etichette in HTML, non nell'SVG, per restare leggibili su
 *  telefono (vedi la nota in labourSection.js). */
/*  WarEra+ (2026-11-26): `breakDays` interrompe linea e area dove due punti
 *  vicini distano più di tanti giorni (le notti senza backup delle aziende:
 *  unirle direbbe che lo sappiamo); un punto rimasto solo fra due buchi si
 *  disegna come pallino. `tipExtra(i)` aggiunge righe al tooltip del punto. */
function lineChartHtml(points, { fmt = oro, color = C_TREASURY, label = ecoT('ecoTreasury'), aria = ecoT('ecoTreasuryChart'), breakDays = 0, tipExtra = null } = {}) {
  const t0 = dayMs(points[0][0]);
  const t1 = dayMs(points[points.length - 1][0]);
  const span = Math.max(1, t1 - t0);
  const vals = points.map(p => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const h = H - PAD_T - PAD_B;
  const x = (d) => ((dayMs(d) - t0) / span) * W;
  const y = (v) => PAD_T + h - ((v - lo) / (hi - lo)) * h;

  const segs = [];
  points.forEach((p, i) => {
    if (!i || (breakDays && dayMs(p[0]) - dayMs(points[i - 1][0]) > breakDays * DAY_MS)) segs.push([]);
    segs[segs.length - 1].push(p);
  });
  const segPath = (seg) => seg.map(([d, v], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const path = segs.map(segPath).join(' ');
  const area = segs.filter(s => s.length > 1).map(s =>
    `${segPath(s)} L${x(s[s.length - 1][0]).toFixed(1)},${H - PAD_B} L${x(s[0][0]).toFixed(1)},${H - PAD_B} Z`).join(' ');
  const soli = segs.filter(s => s.length === 1).map(([[d, v]]) =>
    `<line x1="${x(d).toFixed(1)}" x2="${x(d).toFixed(1)}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" stroke="${color}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`).join('');
  // WarEra+ (2026-11-20): ogni colonna porta il suo cursore — linea verticale
  // e punto sul valore — acceso quando è quella puntata (hover, o wp-tip-on al
  // tocco). L'SVG è preserveAspectRatio="none": il punto è una linea di
  // lunghezza zero con estremo tondo e tratto non scalato, così resta un
  // cerchio invece di diventare un'ellisse.
  const hits = points.map(([d, v], i) => {
    const xa = i ? (x(points[i - 1][0]) + x(d)) / 2 : 0;
    const xb = i < points.length - 1 ? (x(d) + x(points[i + 1][0])) / 2 : W;
    const px = x(d).toFixed(1), py = y(v).toFixed(1);
    return `<g class="wp-nat-cur-col">
        <g class="wp-nat-cur">
          <line class="wp-nat-cur-line" x1="${px}" x2="${px}" y1="0" y2="${H - PAD_B}" vector-effect="non-scaling-stroke"/>
          <line class="wp-nat-cur-dot" x1="${px}" x2="${px}" y1="${py}" y2="${py}" stroke="${color}" vector-effect="non-scaling-stroke"/>
        </g>
        <rect class="wp-tip-hit" x="${xa.toFixed(1)}" y="0" width="${Math.max(1, xb - xa).toFixed(1)}" height="${H}"${tipAttr(
      fmtData(d), `${label}\t${fmt(v)}`, ...(tipExtra ? tipExtra(i) : []))}/>
      </g>`;
  }).join('');

  return `
    <div class="wp-nat-lab-axisrow wp-nat-lab-axis-top"><span>${escapeHtml(fmt(Math.max(...vals)))}</span><span>${escapeHtml(fmt(Math.min(...vals)))}</span></div>
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(aria)}">
      <path d="${area}" fill="${color}" fill-opacity=".14"/>
      <path d="${path}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${soli}
      ${hits}
    </svg>
    <div class="wp-nat-lab-axisrow"><span>${escapeHtml(fmtData(points[0][0]))}</span><span>${escapeHtml(fmtData(points[points.length - 1][0]))}</span></div>`;
}

/* ── 1a. quante aziende stanno nella nazione (/company-count) ──── */

/* WarEra+ (2026-11-26) — richiesta dell'utente: il numero di aziende nelle
   regioni della nazione e la sua curva a 7/30/60/90 giorni. Ha il SUO
   selettore e non quello in cima alla scheda: quello va da 24 ore a 90
   giorni per le donazioni, qui il dato è uno a notte e 24 ore non
   direbbero niente. Dati, perimetro e buchi: vedi src/nations/companyCount.js. */
const C_COMPANIES = '#a371f7';
const COC_KEY = 'we_nat_coc_range';
const COC_FKEY = 'we_nat_coc_filter';
/* Filtro attive / inattive (seconda richiesta dello stesso giorno): ogni voce
   dice quale numero prendere da una riga [cid, tot, attive, disabilitate].
   null = quella notte il conto non c'era, e il punto non si disegna. */
const COC_FILTERS = {
  all: (r) => r[1],
  active: (r) => r[2],
  inactive: (r) => (r[2] == null ? null : r[1] - r[2]),
  disabled: (r) => r[3],
};
const FILTER_LBL = { all: 'fAll', active: 'fActive', inactive: 'fInactive', disabled: 'fDisabled' };
let _cocRange = (() => {
  try { const v = Number(localStorage.getItem(COC_KEY)); return COC_RANGES.includes(v) ? v : 30; }
  catch { return 30; }
})();
let _cocFilter = (() => {
  try { const v = localStorage.getItem(COC_FKEY); return v in COC_FILTERS ? v : 'all'; }
  catch { return 'all'; }
})();
let _coc = null;

function companyCountHtml(d) {
  _coc = d;
  return `<div class="wp-nat-curve-card" id="wp-nat-coc">${companyCountBody()}</div>`;
}

/** [giorno, tot, attive, disabilitate, dal backup] da una riga della serie.
 *  La prima forma della rotta era [giorno, tot, dal backup]. */
const cocPoint = (p) => (p.length === 3 ? [p[0], p[1], null, null, p[2]] : [p[0], p[1], p[2] ?? null, p[3] ?? null, p[4] || 0]);

function companyCountBody() {
  const d = _coc;
  const nome = _nation.name || '—';
  const head = `
    <div class="wp-nat-curve-head">
      <h4 class="wp-nat-chart-title" data-sec="eco-companies">${escapeHtml(cocT('title'))}</h4>
      <div class="wp-nat-curve-range" id="wp-nat-coc-range" role="group">
        ${COC_RANGES.map(r => `<button type="button" data-r="${r}" class="${r === _cocRange ? 'active' : ''}">${escapeHtml(cocT('r' + r))}</button>`).join('')}
      </div>
    </div>`;
  if (!d) return `${head}<p class="wp-nat-lab-note">${escapeHtml(cocT('none'))}</p>`;

  const lang = document.documentElement.lang || undefined;
  const intero = (v) => (v == null ? '—' : Number(v).toLocaleString(lang));
  const pct = (a, b) => (a == null || !b ? '—' : `${decimale((a / b) * 100, 1)}%`);
  const fmtDay = (g) => new Date(`${g}T12:00:00Z`).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
  const val = COC_FILTERS[_cocFilter];
  const righe = d.countries.map(r => [r[0], Number(r[1]) || 0, r[2] ?? null, r[3] ?? null]);
  const mia = righe.find(r => r[0] === _nation._id) || [_nation._id, 0, null, null];
  // La serie del filtro scelto: [giorno, valore, dal backup].
  const serie = (d.series || []).map(cocPoint)
    .map(p => [p[0], val([null, p[1], p[2], p[3]]), p[4]])
    .filter(p => p[1] != null);
  const ora = val(mia);
  const classifica = righe.filter(r => val(r) != null).sort((a, b) => val(b) - val(a));
  const pos = classifica.findIndex(r => r[0] === _nation._id);
  const mondo = classifica.reduce((s, r) => s + val(r), 0);

  // Il confronto vuole la notte giusta o quella prima: con un buco di più
  // notti si lascia «—» invece di confrontare con un giorno diverso.
  const fa = (n) => {
    const bersaglio = dayOf(dayMs(d.day) - n * DAY_MS);
    const ieri = dayOf(dayMs(bersaglio) - DAY_MS);
    const r = serie.find(p => p[0] === bersaglio) || serie.find(p => p[0] === ieri);
    return r && ora != null ? ora - r[1] : null;
  };
  const d7 = fa(7), d30 = fa(30);
  const sgn = (v) => (v == null ? '' : v >= 0 ? 'wp-nat-up' : 'wp-nat-down');
  const signedInt = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${intero(v)}`);
  const tile = (lab, v, cls = '') => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val ${cls}">${escapeHtml(v)}</strong>
    </div>`;
  const etichetta = _cocFilter === 'all' ? cocT('now') : `${cocT(FILTER_LBL[_cocFilter])} · ${cocT('now')}`;
  const tiles = [
    tile(etichetta, intero(ora)),
    tile(cocT('ch7'), signedInt(d7), sgn(d7)),
    tile(cocT('ch30'), signedInt(d30), sgn(d30)),
    tile(cocT('share'), ora == null ? '—' : pct(ora, mondo)),
    tile(cocT('rank'), pos >= 0 && ora > 0 ? cocT('rankOf', { r: pos + 1, n: classifica.length }) : '—'),
    tile(cocT('activeShare'), pct(mia[2], mia[1]), mia[2] == null ? '' : mia[2] / (mia[1] || 1) >= 0.5 ? 'wp-nat-up' : 'wp-nat-down'),
  ].join('');
  const ripartizione = mia[2] != null || mia[3] != null
    ? `<p class="wp-nat-lab-note">${escapeHtml(cocT('split', {
      a: mia[2] == null ? '—' : `${intero(mia[2])} (${pct(mia[2], mia[1])})`,
      i: mia[2] == null ? '—' : `${intero(mia[1] - mia[2])} (${pct(mia[1] - mia[2], mia[1])})`,
      d: mia[3] == null ? '—' : `${intero(mia[3])} (${pct(mia[3], mia[1])})`,
    }))}</p>` : '';

  const dal = dayOf(dayMs(d.day) - (_cocRange - 1) * DAY_MS);
  const pts = serie.filter(p => p[0] >= dal);
  const grafico = pts.length > 1
    ? lineChartHtml(pts.map(p => [p[0], p[1]]), {
      fmt: intero, color: C_COMPANIES, label: cocT(_cocFilter === 'all' ? 'lbl' : FILTER_LBL[_cocFilter]),
      aria: cocT('chart', { nation: nome }),
      breakDays: 1.5, tipExtra: (i) => (pts[i][2] ? [cocT('fromBackup')] : []),
    })
    : `<p class="wp-nat-lab-note">${escapeHtml(cocT('noHist'))}</p>`;

  // Una nota sola su «da quando»: ogni filtro ha la sua data, e la nota dei
  // backup dice già da quando parte lo storico.
  const note = [];
  const daQuando = serie[0]?.[0];
  if (_cocFilter === 'active' || _cocFilter === 'inactive') {
    if (d.workersFrom) note.push(cocT('wFrom', { d: fmtDay(d.workersFrom) }));
  } else if (_cocFilter === 'disabled') {
    note.push(d.disabledFrom ? cocT('dFrom', { d: fmtDay(d.disabledFrom) }) : cocT('dNone'));
  } else if (d.coverageFrom && d.recordedFrom && d.coverageFrom < d.recordedFrom) {
    note.push(cocT('cover', { d: fmtDay(d.coverageFrom), r: fmtDay(d.recordedFrom) }));
  } else if (daQuando && daQuando > dal) {
    note.push(cocT('coverShort', { d: fmtDay(daQuando) }));
  }
  return `${head}
    <p class="wp-nat-lab-note">${escapeHtml(cocT('sub', { nation: nome }))}</p>
    <div class="wp-nat-curve-range wp-nat-coc-filter" id="wp-nat-coc-filter" role="group" aria-label="${escapeHtml(cocT('fLbl'))}">
      ${Object.keys(COC_FILTERS).map(f => `<button type="button" data-f="${f}" class="${f === _cocFilter ? 'active' : ''}">${escapeHtml(cocT(FILTER_LBL[f]))}</button>`).join('')}
    </div>
    <div class="wp-nat-lab-tiles">${tiles}</div>
    ${ripartizione}
    <div class="wp-nat-curve-slot">${grafico}</div>
    ${note.map(n => `<p class="wp-nat-lab-note">${escapeHtml(n)}</p>`).join('')}
    <p class="wp-nat-lab-note">${escapeHtml(cocT('what'))}</p>
    <p class="wp-nat-lab-note">${escapeHtml(cocT('scope', { d: fmtDay(d.day) }))}</p>`;
}

function bindCompanyCount(body) {
  body.querySelector('#wp-nat-coc')?.addEventListener('click', (e) => {
    const r = e.target.closest('#wp-nat-coc-range button[data-r]');
    const f = e.target.closest('#wp-nat-coc-filter button[data-f]');
    if (r && Number(r.dataset.r) !== _cocRange) {
      _cocRange = Number(r.dataset.r);
      try { localStorage.setItem(COC_KEY, String(_cocRange)); } catch { /* storage negato */ }
    } else if (f && f.dataset.f !== _cocFilter) {
      _cocFilter = f.dataset.f;
      try { localStorage.setItem(COC_FKEY, _cocFilter); } catch { /* storage negato */ }
    } else return;
    const card = body.querySelector('#wp-nat-coc');
    if (card) card.innerHTML = companyCountBody();
  });
}

/* ── 1b. felicità dei dipendenti (/employee-happiness) ─────────── */

const C_HAPPY = '#58a6ff';
const decimale = (v, d = 1) => (v == null || !Number.isFinite(v) ? '—'
  : v.toLocaleString(document.documentElement.lang || undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
/* 'primaDonna' → 'Prima donna': i tratti non hanno un dizionario, come
   nell'Ottimizzatore (humanize di src/eco/main.js). */
const umano = (code) => {
  const s = String(code).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function causaNome(k) {
  if (k === 't:?') return ecoT('hapR_hiddenTrait');
  if (k.startsWith('t:')) return `${umano(k.slice(2))} (${ecoT('hapTrait')})`;
  const nota = ecoT(`hapR_${k}`);
  return nota === `hapR_${k}` ? umano(k) : nota;
}

/** Istogramma a decine (0–10 … 90–100), colori dal rosso al verde. */
function happyHistHtml(hist) {
  const max = Math.max(...hist, 1);
  const tot = hist.reduce((s, v) => s + v, 0) || 1;
  const bw = W / hist.length;
  const hh = 110;
  const bars = hist.map((n, i) => {
    const h = (n / max) * (hh - 8);
    const hue = Math.round((i / 9) * 120);   // 0 rosso … 120 verde
    return `<rect x="${(i * bw + 3).toFixed(1)}" y="${(hh - h).toFixed(1)}" width="${(bw - 6).toFixed(1)}" height="${Math.max(h, n ? 1 : 0).toFixed(1)}" fill="hsl(${hue} 60% 50%)" fill-opacity=".8"${tipAttr(
      `${i * 10}–${i * 10 + 10}`, `${ecoT('hapCount')}\t${n.toLocaleString()} (${decimale((n / tot) * 100)}%)`)}/>`;
  }).join('');
  return `
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${hh}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ecoT('hapDist'))}">${bars}</svg>
    <div class="wp-nat-lab-axisrow"><span>0</span><span>50</span><span>100</span></div>`;
}

function happinessHtml(d) {
  const title = `<h3 class="wp-nat-section-title" data-sec="eco-happiness">${escapeHtml(ecoT('hapTitle'))}</h3>`;
  if (!d) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('hapNone'))}</p>`;
  const nome = _nation.name || '—';
  const s = d.country;
  if (!s) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('hapNoCountry', { nation: nome }))}</p>`;

  const pos = d.ranking.findIndex(r => r[0] === _nation._id);
  const iP = (p) => d.percentiles.indexOf(p);
  const tile = (lab, val, cls = '', tip = '') => `
    <div class="wp-nat-lab-tile"${tip ? ` title="${escapeHtml(tip)}"` : ''}>
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val ${cls}">${escapeHtml(val)}</strong>
    </div>`;
  const tiles = [
    tile(ecoT('hapMean'), decimale(s.mean), d.world && s.mean >= d.world.mean ? 'wp-nat-up' : 'wp-nat-down'),
    tile(ecoT('hapMedian'), decimale(s.p?.[iP(50)])),
    tile(ecoT('hapRange'), `${decimale(s.p?.[iP(10)], 0)} – ${decimale(s.p?.[iP(90)], 0)}`),
    tile(ecoT('hapWorld'), d.world ? decimale(d.world.mean) : '—'),
    tile(ecoT('hapRank'), pos >= 0 ? ecoT('hapRankOf', { r: pos + 1, n: d.ranking.length }) : ecoT('hapNoRank', { n: d.minRanking })),
    tile(ecoT('hapProd'), s.prod != null ? `${s.prod > 0 ? '+' : ''}${decimale(s.prod)}%` : '—', s.prod > 0 ? 'wp-nat-up' : s.prod < 0 ? 'wp-nat-down' : '', ecoT('hapProdNote')),
    tile(ecoT('hapCount'), s.n.toLocaleString(), '', [s.tax != null ? ecoT('hapTax', { t: decimale(s.tax, 2) }) : '', s.quit ? ecoT('hapQuit', { n: s.quit }) : ''].filter(Boolean).join(' · ')),
  ].join('');

  // Le cause per peso: quota di dipendenti toccati × effetto medio.
  const cause = Object.entries(s.contrib || {})
    .map(([k, [quota, delta]]) => ({ k, quota, delta, peso: Math.abs(quota * delta) }))
    .sort((a, b) => b.peso - a.peso);
  const righe = cause.map(c => `
        <li class="wp-nat-lab-row">
          <span class="wp-nat-lab-name">${escapeHtml(causaNome(c.k))}</span>
          <span class="wp-nat-lab-bar"${tipAttr(causaNome(c.k), `${ecoT('hapShare')}\t${decimale(c.quota * 100, 0)}%`, `${ecoT('hapDelta')}\t${c.delta > 0 ? '+' : ''}${decimale(c.delta)}`)}><span style="width:${(c.quota * 100).toFixed(1)}%;background:${c.delta >= 0 ? C_IN : C_OUT}"></span></span>
          <span class="wp-nat-lab-num ${c.delta >= 0 ? 'wp-nat-up' : 'wp-nat-down'}">${escapeHtml(`${c.delta > 0 ? '+' : ''}${decimale(c.delta)}`)}</span>
        </li>`).join('');

  _hapDays = d.countryDays;
  _hapDay = d.day;

  return `${title}
    <p class="wp-nat-curve-note">${escapeHtml(ecoT(d.scope === 'all' ? 'hapSubAll' : 'hapSub', { nation: nome, d: fmtData(d.day) }))}</p>
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('hapDist'))}</h4>
      <div class="wp-nat-curve-slot">${happyHistHtml(s.hist)}</div>
    </div>
    <div class="wp-nat-lab-col">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('hapCauses'))}</h4>
      <p class="wp-nat-lab-note">${escapeHtml(ecoT('hapCauseNote'))}</p>
      <ul class="wp-nat-lab-list">${righe}</ul>
    </div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('hapChart'))}</h4>
      <div class="wp-nat-curve-range wp-nat-coc-filter" id="wp-nat-hap-range" role="group">
        ${COC_RANGES.map(r => `<button type="button" data-r="${r}" class="${r === _hapRange ? 'active' : ''}">${escapeHtml(cocT('r' + r))}</button>`).join('')}
      </div>
      <div id="wp-nat-hap-curve">${happyCurveHtml()}</div>
    </div>`;
}

/* WarEra+ (2026-11-26) — richiesta dell'utente: la curva della felicità
   «su più periodi», come le aziende. Stesso selettore 7/30/60/90 giorni e
   stessa memoria per chi guarda, filtrato qui sulla serie già arrivata (il
   server la manda tutta: una riga a notte). La serie parte dal primo giro con
   la rosa valida, quindi una finestra più lunga dello storico lo dice; le
   notti scartate (rose perse) restano un buco e la linea si interrompe. */
const HAP_KEY = 'we_nat_hap_range';
let _hapRange = (() => {
  try { const v = Number(localStorage.getItem(HAP_KEY)); return COC_RANGES.includes(v) ? v : 30; }
  catch { return 30; }
})();
let _hapDays = [];
let _hapDay = null;

function happyCurveHtml() {
  const oggi = _hapDay || dayOf(Date.now());
  const dal = dayOf(dayMs(oggi) - (_hapRange - 1) * DAY_MS);
  const curva = (_hapDays || []).filter(([g]) => g >= dal).map(([g, m]) => [g, m]);
  const grafico = curva.length > 1
    ? lineChartHtml(curva, { fmt: (v) => decimale(v), color: C_HAPPY, label: ecoT('hapChartLbl'), aria: ecoT('hapChart'), breakDays: 1.5 })
    : `<p class="wp-nat-lab-note">${escapeHtml(ecoT('hapNoHist'))}</p>`;
  const primo = _hapDays?.[0]?.[0];
  const nota = primo && primo > dal
    ? `<p class="wp-nat-lab-note">${escapeHtml(cocT('coverShort', { d: fmtData(primo) }))}</p>` : '';
  return `<div class="wp-nat-curve-slot">${grafico}</div>${nota}`;
}

function bindHappyRange(body) {
  body.querySelector('#wp-nat-hap-range')?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-r]');
    if (!b || Number(b.dataset.r) === _hapRange) return;
    _hapRange = Number(b.dataset.r);
    try { localStorage.setItem(HAP_KEY, String(_hapRange)); } catch { /* storage negato */ }
    body.querySelectorAll('#wp-nat-hap-range button').forEach(x => x.classList.toggle('active', x === b));
    const slot = body.querySelector('#wp-nat-hap-curve');
    if (slot) slot.innerHTML = happyCurveHtml();
  });
}

/* ── 2. bonifici fra tesori ────────────────────────────────────── */

function transfersHtml(data) {
  const title = `<h3 class="wp-nat-section-title" data-sec="eco-transfers">${escapeHtml(ecoT('trTitle'))}</h3>`;
  if (!data) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('trServer'))}</p>`;

  const id = _nation._id;
  const since = Date.now() - _range * DAY_MS;
  const rows = data.transfers.filter(t => t.at >= since && (t.to === id || t.from === id));
  const agg = (pick) => {
    const m = new Map();
    for (const t of rows) {
      const k = pick(t);
      if (k) m.set(k, (m.get(k) || 0) + t.money);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  const from = agg(t => (t.to === id ? t.from : null));
  const to = agg(t => (t.from === id ? t.to : null));

  // La copertura conta solo se cade DENTRO la finestra scelta: altrimenti
  // l'archivio copre tutto l'intervallo e la nota sarebbe rumore.
  const cov = data.coverageFrom && data.coverageFrom > since
    ? `<p class="wp-nat-curve-note">${escapeHtml(ecoT('trCoverage', { d: fmtData(dayOf(data.coverageFrom)) }))}</p>`
    : '';
  const lists = (from.length || to.length)
    ? `<div class="wp-nat-lab-cols">${list(ecoT('trFrom'), from, C_IN)}${list(ecoT('trTo'), to, C_OUT)}</div>`
    : `<div class="wp-nat-empty">${escapeHtml(ecoT('trNone'))}</div>`;
  return title + cov + lists + transferLogHtml(rows, id);
}

/** Ogni bonifico col suo orario, dal più recente: «quando sono arrivati».
 *  Ora locale di chi guarda, come il resto del tool. Dentro un riquadro con
 *  altezza massima: in 90 giorni sono centinaia di righe. */
function transferLogHtml(rows, id) {
  if (!rows.length) return '';
  const lang = document.documentElement.lang || undefined;
  const items = rows.slice().sort((a, b) => b.at - a.at).map(t => {
    const incoming = t.to === id;
    const other = incoming ? t.from : t.to;
    const when = new Date(t.at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `
      <li class="wp-nat-trlog-row">
        <time datetime="${new Date(t.at).toISOString()}">${escapeHtml(when)}</time>
        <span class="wp-nat-trlog-dir ${incoming ? 'wp-nat-up' : 'wp-nat-down'}">${escapeHtml(ecoT(incoming ? 'trIn' : 'trOut'))}</span>
        <span class="wp-nat-trlog-who">${flagImg(other, 'wp-nat-lab-flag')}${escapeHtml(nomeDi(other))}</span>
        <b class="wp-nat-trlog-amt ${incoming ? 'wp-nat-up' : 'wp-nat-down'}">${incoming ? '+' : '−'}${escapeHtml(oro(t.money))}</b>
      </li>`;
  }).join('');
  return `
    <div class="wp-nat-lab-col wp-nat-trlog">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('trLogTitle', { n: rows.length }))}</h4>
      <ul class="wp-nat-trlog-list">${items}</ul>
    </div>`;
}

function list(titolo, righe, colore) {
  if (!righe.length) return '';
  const max = righe[0][1] || 1;
  return `
    <div class="wp-nat-lab-col">
      <h4 class="wp-nat-chart-title">${escapeHtml(titolo)}</h4>
      <ul class="wp-nat-lab-list">${righe.map(([id, v]) => `
        <li class="wp-nat-lab-row">
          ${flagImg(id, 'wp-nat-lab-flag')}<span class="wp-nat-lab-name">${escapeHtml(nomeDi(id))}</span>
          <span class="wp-nat-lab-bar"><span style="width:${((v / max) * 100).toFixed(1)}%;background:${colore}"></span></span>
          <span class="wp-nat-lab-num">${escapeHtml(oro(v))}</span>
        </li>`).join('')}</ul>
    </div>`;
}

/* ── 3-4. donazioni dei giocatori (transazioni «donation») ─────── */

/* Una `donation` ha `buyerId` (il giocatore che DONA) e `sellerCountryId` /
   `sellerMuId` / `sellerPartyId` (chi RICEVE: il verso del gioco, vedi la
   testata di server/donations.js). Qui: cosa ha ricevuto il tesoro della
   nazione e cosa le sue unità, giorno per giorno. */

/** Il server ha righe ma non ha capito chi dà o chi riceve? */
function unreadable(d) {
  const c = d?.classified;
  return !!c && c.rows > 0 && (c.giver === 0 || c.receiver === 0);
}

function donationsHtml(d) {
  const title = `<h3 class="wp-nat-section-title" data-sec="eco-donations">${escapeHtml(ecoT('donTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('donSub'))}</p>`;
  if (!d) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donNoServer'))}</p>`;
  if (!d.classified?.rows) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donNotYet'))}</p>`;
  if (unreadable(d)) return `${title}<p class="wp-nat-notice">${escapeHtml(ecoT('donShape', { n: d.classified.rows }))}</p>`;

  const sumDaily = (i) => d.daily.reduce((s, r) => s + (Number(r[i]) || 0), 0);
  const fromTre = d.treasury?.money ?? sumDaily(1);
  const fromMu = d.byMu.reduce((s, m) => s + m.money, 0);

  const tile = (lab, val, sub = '') => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val">${escapeHtml(val)}</strong>${sub ? `<span class="wp-nat-lab-note">${escapeHtml(sub)}</span>` : ''}
    </div>`;
  const tiles = [
    tile(ecoT('donFromTreasury'), oro(fromTre), ecoT('donCount', { n: d.treasury?.n ?? 0 })),
    tile(ecoT('donFromUnits'), oro(fromMu), ecoT('donCount', { n: d.byMu.reduce((s, m) => s + m.n, 0) })),
    tile(ecoT('colRecipients'), String(d.treasury?.donors ?? 0), ecoT('donFromTreasury')),
  ].join('');

  // Giorni mostrati: dall'inizio della finestra, ma mai prima di quando
  // l'archivio ha cominciato a guardare. Un giorno senza righe DENTRO la
  // copertura è davvero zero; uno fuori è sconosciuto e non si disegna.
  const cover = d.coverageFrom ? dayOf(d.coverageFrom) : null;
  const days = lastDays(d.days).filter(g => !cover || g >= cover);
  const byDay = new Map(d.daily.map(r => [r[0], r]));
  const series = days.map(g => {
    const r = byDay.get(g);
    return { day: g, parts: [Number(r?.[1]) || 0, Number(r?.[2]) || 0] };
  });
  const labels = [ecoT('donFromTreasury'), ecoT('donFromUnits')];

  const note = cover && cover > dayOf(Date.now() - (d.days - 1) * DAY_MS)
    ? `<p class="wp-nat-curve-note">${escapeHtml(ecoT('donCoverage', { d: fmtData(cover) }))}</p>` : '';

  const donut = donutHtml({
    title: ecoT('cmpVsTreasury'),
    slices: [
      { label: labels[0], value: fromTre, color: C_DON[0] },
      { label: labels[1], value: fromMu, color: C_DON[1] },
    ],
    totalFmt: oro,
  });

  return `${title}${note}
    <div class="wp-nat-lab-tiles">${tiles}</div>
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(ecoT('donChart'))}</h4>
      <ul class="wp-nat-curve-legend">${labels.map((l, i) =>
        `<li><span class="wp-nat-dot" style="background:${C_DON[i]}"></span>${escapeHtml(l)}</li>`).join('')}</ul>
      <div class="wp-nat-curve-slot">${stackedBarsHtml(series, labels)}</div>
    </div>
    <section class="wp-nat-charts">${donut}</section>
    <p class="wp-nat-lab-note">${escapeHtml(ecoT('donWhat'))}</p>`;
}

/** Barre impilate giorno per giorno (UTC). */
function stackedBarsHtml(series, labels) {
  if (!series.length) return '';
  const max = Math.max(...series.map(s => s.parts.reduce((a, b) => a + b, 0)), 1);
  const w = W / series.length;
  const h = H - PAD_T - PAD_B;
  const bars = series.map((s, i) => {
    let y = PAD_T + h;
    const x = i * w;
    const total = s.parts.reduce((a, b) => a + b, 0);
    const rects = s.parts.map((v, k) => {
      const hh = (v / max) * h;
      y -= hh;
      return hh > 0 ? `<rect x="${(x + 0.5).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${hh.toFixed(1)}" fill="${C_DON[k]}"/>` : '';
    }).join('');
    return rects + `<rect class="wp-tip-hit" x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${H}"${tipAttr(
      fmtData(s.day),
      `${ecoT('total')}\t${oro(total)}`,
      ...s.parts.map((v, k) => `${labels[k]}\t${oro(v)}`))}/>`;
  }).join('');
  return `
    <div class="wp-nat-lab-axisrow wp-nat-lab-axis-top">${escapeHtml(oro(max))}</div>
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ecoT('donChart'))}">${bars}</svg>
    <div class="wp-nat-lab-axisrow"><span>${escapeHtml(fmtData(series[0].day))}</span><span>${escapeHtml(fmtData(series[series.length - 1].day))}</span></div>`;
}

/* ── 5. quanto ha pagato ciascuna unità ────────────────────────── */

function unitsHtml(d, directory) {
  if (!d || !d.classified?.rows || unreadable(d)) return '';
  const title = `<h3 class="wp-nat-section-title" data-sec="eco-units">${escapeHtml(ecoT('cmpTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('cmpSub'))}</p>`;
  if (!d.byMu?.length) return `${title}<div class="wp-nat-empty">${escapeHtml(ecoT('cmpNone'))}</div>`;

  const cover = d.coverageFrom ? dayOf(d.coverageFrom) : null;
  const days = lastDays(d.days).filter(g => !cover || g >= cover);
  // «In cassa ora» = `rankings.muWealth` della directory, il valore di
  // ricchezza dell'unità secondo il gioco (l'oggetto unità non ha un campo
  // tesoro a parte). È il valore di ADESSO, non quello del periodo scelto.
  const wealthOf = new Map((directory || []).map(m => [m._id, m.rankings?.muWealth?.value]));
  const head = ['colUnit', 'colGiven', 'colTreasuryNow', 'colRecipients', 'colCount', 'colAvg', 'colPerDay']
    .map((k, i) => `<span class="${i && i < 6 ? 'wp-nat-num' : ''}"${k === 'colTreasuryNow' ? ` title="${escapeHtml(ecoT('colTreasuryHint'))}"` : ''}>${escapeHtml(ecoT(k))}</span>`).join('');

  const max = d.byMu[0].money || 1;
  const body = d.byMu.map(m => `
      <a class="wp-nat-ecot-row" href="#" data-mu="${escapeHtml(m.id)}">
        <span class="wp-nat-cname"><span class="wp-nat-cnick">${escapeHtml(m.name)}</span></span>
        <span class="wp-nat-num money wp-nat-ecot-bar"><i style="width:${((m.money / max) * 100).toFixed(1)}%"></i><b>${escapeHtml(oro(m.money))}</b></span>
        <span class="wp-nat-num">${Number.isFinite(wealthOf.get(m.id)) ? escapeHtml(oro(wealthOf.get(m.id))) : '—'}</span>
        <span class="wp-nat-num">${m.donors}</span>
        <span class="wp-nat-num">${m.n}</span>
        <span class="wp-nat-num">${escapeHtml(oro(m.n ? m.money / m.n : 0))}</span>
        <span>${sparkHtml(days, m.daily, m.name)}</span>
      </a>`).join('');

  return `${title}
    <div class="wp-nat-mut-wrap"><div class="wp-nat-ecot" id="wp-nat-eco-units">
      <div class="wp-nat-ecot-row wp-nat-mut-head">${head}</div>${body}
    </div></div>`;
}

/** Minibarre giornaliere di un'unità, sullo stesso asse dei giorni. */
function sparkHtml(days, daily, name) {
  if (days.length < 2) return '—';
  const by = new Map(daily.map(([g, v]) => [g, v]));
  const vals = days.map(g => by.get(g) || 0);
  const max = Math.max(...vals, 1);
  const w = 100 / days.length;
  const bars = vals.map((v, i) => v > 0
    ? `<rect x="${(i * w).toFixed(2)}" y="${(20 - (v / max) * 20).toFixed(2)}" width="${Math.max(0.6, w - 0.4).toFixed(2)}" height="${((v / max) * 20).toFixed(2)}" fill="${C_DON[1]}"/>`
    : '').join('');
  return `<svg class="wp-nat-spark" viewBox="0 0 100 20" preserveAspectRatio="none"${tipAttr(name, `${ecoT('colPerDay')}\t${oro(vals.reduce((a, b) => a + b, 0) / days.length)}`)}>${bars}</svg>`;
}

/* ── 6. confronto con le altre nazioni ─────────────────────────── */

/* Donazioni ricevute (tesoro + unità registrate lì) rapportate ai cittadini
   attivi e al development: «quanto doniamo rispetto a quanto siamo». Il
   periodo è quello scelto in cima alla scheda e la finestra è la stessa per
   tutte le nazioni.
   ⚠️ Una nazione con pochissimi cittadini attivi farebbe un rapporto enorme
   con una donazione sola: i rapporti classificano solo chi ne ha almeno
   MIN_POP, e la scheda lo dice. Le nazioni senza rapporto restano in elenco,
   in fondo e senza posizione. La tabella le mostra TUTTE in un riquadro che
   scorre, con la nazione aperta già in vista. */
const MIN_POP = 10;
const CMP_SORTS = [
  { key: 'perCit', label: 'cmpPerCit' },
  { key: 'perDev', label: 'cmpPerDev' },
  { key: 'total', label: 'cmpTotal' },
  { key: 'tre', label: 'cmpTre' },
  { key: 'uni', label: 'cmpUni' },
];
let _cmpSort = 'perCit';
let _cmpData = null;

/** Un rapporto piccolo ha bisogno dei decimali, uno grande no. */
function ratio(v) {
  if (v == null) return '—';
  if (v >= 100) return oro(v);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function cmpRows(data) {
  const byId = new Map(data.countries.map(r => [r[0], r]));
  const out = [];
  for (const n of getNations()) {
    const r = byId.get(n._id);
    const tre = r?.[1] || 0, uni = r?.[2] || 0, total = tre + uni;
    if (!total && n._id !== _nation._id) continue;
    const pop = metricValue(n, 'pop'), dev = metricValue(n, 'dev');
    const ok = pop >= MIN_POP;
    out.push({
      id: n._id, name: n.name || n._id, tre, uni, total, donors: r?.[5] || 0, pop, dev,
      perCit: ok ? total / pop : null,
      perDev: ok && dev > 0 ? total / dev : null,
    });
  }
  return out;
}

function compareHtml(data) {
  if (!data?.countries?.length) return '';
  _cmpData = data;
  return `
    <h3 class="wp-nat-section-title" data-sec="eco-compare">
      ${escapeHtml(ecoT('cmpNatTitle'))}
      <div class="wp-nat-tools">
        <label class="wp-nat-sort">
          <span>${escapeHtml(ecoT('muSortBy'))}</span>
          <select id="wp-nat-cmp-sort">${CMP_SORTS.map(s =>
            `<option value="${s.key}"${s.key === _cmpSort ? ' selected' : ''}>${escapeHtml(ecoT(s.label))}</option>`).join('')}</select>
        </label>
      </div>
    </h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('cmpNatSub'))} ${escapeHtml(ecoT('cmpMinPop', { n: MIN_POP }))}</p>
    ${coverageNote(data)}
    <div id="wp-nat-cmp-body">${compareBodyHtml()}</div>`;
}

/** Dentro il riquadro che scorre, porta la riga della nazione aperta in vista
 *  (di solito è a metà classifica e senza questo resterebbe fuori schermo).
 *  Si scorre il riquadro e NON la pagina: scrollIntoView avrebbe mosso anche
 *  quella. */
function revealMe(slot) {
  const box = slot?.querySelector('.wp-nat-cmpt-scroll');
  const me = box?.querySelector('.wp-nat-cmpt-me');
  if (!box || !me) return;
  const head = box.querySelector('.wp-nat-mut-head')?.offsetHeight || 0;
  // Posizione della riga DENTRO il riquadro, dai rettangoli a schermo:
  // offsetTop è relativo al primo antenato posizionato, che qui non è il riquadro.
  const top = me.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
  box.scrollTop = Math.max(0, top - head - (box.clientHeight - head) / 2 + me.offsetHeight / 2);
}

/** Se il periodo scelto è più lungo di quello che l'archivio copre, dice che il
 *  dato è lo stesso di quello più corto: senza, cambiare periodo e vedere gli
 *  stessi numeri sembra un guasto. */
function coverageNote(data) {
  if (!data.coverageFrom) return '';
  const have = Math.max(1, Math.ceil((Date.now() - data.coverageFrom) / DAY_MS));
  if (have >= data.days) return '';
  return `<p class="wp-nat-notice">${escapeHtml(ecoT('cmpCoverage', { d: fmtData(dayOf(data.coverageFrom)), n: have }))}</p>`;
}

function compareBodyHtml() {
  const rows = cmpRows(_cmpData);
  const key = _cmpSort;
  const val = (r) => r[key];
  // Chi non ha il rapporto (pochi cittadini) va in fondo e non ha posizione.
  rows.sort((a, b) => (val(b) ?? -1) - (val(a) ?? -1));
  const ranked = rows.filter(r => val(r) != null);
  const rankOf = new Map(ranked.map((r, i) => [r.id, i + 1]));
  const meId = _nation._id;
  const me = rows.find(r => r.id === meId);

  const rowHtml = (r) => {
    const rk = rankOf.get(r.id);
    return `
      <div class="wp-nat-cmpt-row${r.id === meId ? ' wp-nat-cmpt-me' : ''}">
        <span class="wp-nat-cname"><span class="wp-nat-rank">${rk ? `#${rk}` : '—'}</span>${flagImg(r.id, 'wp-nat-lab-flag')}<span class="wp-nat-cnick">${escapeHtml(r.name)}</span></span>
        <span class="wp-nat-num">${escapeHtml(oro(r.total))}</span>
        <span class="wp-nat-num">${escapeHtml(oro(r.tre))}</span>
        <span class="wp-nat-num">${escapeHtml(oro(r.uni))}</span>
        <span class="wp-nat-num wp-nat-cmpt-key${key === 'perCit' ? ' on' : ''}">${escapeHtml(ratio(r.perCit))}</span>
        <span class="wp-nat-num wp-nat-cmpt-key${key === 'perDev' ? ' on' : ''}">${escapeHtml(ratio(r.perDev))}</span>
        <span class="wp-nat-num">${r.donors}</span>
      </div>`;
  };
  const head = ['colNation', 'cmpTotal', 'cmpTre', 'cmpUni', 'cmpPerCit', 'cmpPerDev', 'colRecipients']
    .map((k, i) => `<span class="${i ? 'wp-nat-num' : ''}">${escapeHtml(ecoT(k))}</span>`).join('');

  const line = rankOf.has(meId)
    ? `<p class="wp-nat-lab-note">${escapeHtml(ecoT('cmpRank', { name: me.name, r: rankOf.get(meId), n: ranked.length }))}</p>`
    : (me ? `<p class="wp-nat-lab-note">${escapeHtml(ecoT('cmpNoRank', { name: me.name, n: MIN_POP }))}</p>` : '');

  return `${line}
    <div class="wp-nat-mut-wrap wp-nat-cmpt-scroll"><div class="wp-nat-cmpt">
      <div class="wp-nat-cmpt-row wp-nat-mut-head">${head}</div>
      ${rows.map(rowHtml).join('')}
    </div></div>`;
}

async function openUnit(e) {
  const a = e.target.closest('a[data-mu]');
  if (!a) return;
  e.preventDefault();
  const [nat, mu] = await Promise.all([import('../app/nationsOverlay.js'), import('../app/muOverlay.js')]);
  nat.closeNationsView();
  mu.openMuView(a.dataset.mu);
}
