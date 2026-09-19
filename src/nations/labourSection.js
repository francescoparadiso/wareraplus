/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: lavoro e tasse
   ------------------------------------------------------------------
   L'economia del salario di una nazione, per i 51 giorni in cui qualcuno
   la stava registrando: quanto hanno incassato i suoi cittadini, quanto
   di quello guadagnato lavorando FUORI casa, chi glielo ha pagato, per
   quali risorse, e quanto ha incassato lo Stato di tassa sul lavoro.

   ── DUE NUMERI CHE SEMBRANO UNO SOLO ─────────────────────────────
   «Tasse trattenute» e «gettito» stanno in due tessere diverse e non si
   sommano MAI, perché rispondono a due domande diverse:

     · trattenute = quanto è stato tolto ai salari dei suoi cittadini.
       Lo incassa la nazione dove OPERA l'azienda, che per chi lavora
       all'estero non è la sua;
     · gettito    = quanto ha incassato QUESTA nazione dalle aziende che
       operano sul suo territorio, chiunque ci lavori dentro.

   Per una nazione dove lavorano molti stranieri il secondo è molto più
   grande del primo, e il contrario per una nazione di emigranti. Metterli
   sotto la stessa etichetta sarebbe la trappola di `countryBounty` un'altra
   volta: un numero plausibile, dalla parte sbagliata del bonifico.

   ── L'ARCHIVIO È CHIUSO, E LA FASCIA LO DICE ─────────────────────
   29 luglio → 17 settembre 2026. Non cresce e non crescerà: il gioco fa
   ~550.000 pagamenti di salario al giorno e non esiste modo di sfogliarli
   (vedi server/labourHistory.js). Senza la fascia in cima, una curva che
   si ferma a settembre si leggerebbe come «hanno smesso di lavorare».
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, fmtCompact, flagImg } from '../mu/ui.js';
import { natT } from './i18n.js';
import { fetchLabour } from './api.js';
import { state } from '../diplomacy/state.js';

const W = 640, H = 150, PAD_L = 4, PAD_R = 4, PAD_T = 10, PAD_B = 18;
const ORO = '#e3b341';
const ESTERO = '#58a6ff';

let _host = null;
let _nation = null;

export async function renderLabour(host, nation) {
  _host = host;
  _nation = nation;
  host.innerHTML = '';

  const dati = await fetchLabour(nation._id);
  if (_nation?._id !== nation._id) return;   // nazione cambiata nel frattempo
  if (!dati) return;                          // server senza l'archivio: sezione assente

  paint(dati);
}

function nomeDi(countryId) {
  return state.nationMap?.get(countryId)?.name || countryId;
}

/* Oro arrotondato. Su totali di cinquantun giorni i centesimi sono
   rumore, e fmtCompact li tiene sotto i diecimila: "6317,11" in una
   classifica di barre si legge peggio di "6317". */
const oro = (v) => fmtCompact(Math.round(Number(v) || 0));

/** Somma una colonna delle righe giornaliere. */
function somma(righe, i) {
  let t = 0;
  for (const r of righe) t += Number(r[i]) || 0;
  return t;
}

function fmtData(giorno) {
  const d = new Date(`${giorno}T12:00:00Z`);
  return d.toLocaleDateString(document.documentElement.lang || undefined, { day: 'numeric', month: 'short' });
}

function paint(dati) {
  const { days, partners, items, revenue, rate, from, to } = dati;

  const salari = somma(days, 1);
  const trattenute = somma(days, 2);
  const pagamenti = somma(days, 3);
  const salariEstero = somma(days, 4);
  const quotaEstero = salari > 0 ? (salariEstero / salari) * 100 : 0;
  const gettito = revenue ? somma(revenue, 1) : null;
  // Pagamenti a lavoratori stranieri sul territorio: il rovescio della
  // quota qui sopra, e insieme dicono se una nazione esporta o importa
  // lavoro.
  const stranieriInCasa = revenue ? somma(revenue, 4) : null;
  const pagamentiInCasa = revenue ? somma(revenue, 3) : null;
  const quotaStranieri = pagamentiInCasa > 0 ? (stranieriInCasa / pagamentiInCasa) * 100 : null;

  const tessere = [
    [natT('labWages'), oro(salari), natT('labWagesHint')],
    [natT('labAbroad'), `${quotaEstero.toFixed(0)}%`, natT('labAbroadHint')],
    [natT('labWithheld'), oro(trattenute), natT('labWithheldHint')],
    [natT('labRevenue'), gettito != null ? oro(gettito) : '—', natT('labRevenueHint')],
    [natT('labRate'), rate != null ? `${Number(rate).toFixed(1)}%` : '—', natT('labRateHint')],
    [natT('labPayments'), oro(pagamenti), natT('labPaymentsHint')],
  ].map(([lab, val, hint]) => `
    <div class="wp-nat-lab-tile" title="${escapeHtml(hint)}">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val">${escapeHtml(val)}</strong>
    </div>`).join('');

  const forestieri = quotaStranieri != null
    ? `<p class="wp-nat-lab-note">${escapeHtml(natT('labInbound').replace('{pct}', quotaStranieri.toFixed(0)))}</p>`
    : '';

  _host.innerHTML = `
    <h3 class="wp-nat-section-title">${escapeHtml(natT('labTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(natT('labClosed').replace('{from}', fmtData(from)).replace('{to}', fmtData(to)))}</p>
    <div class="wp-nat-lab-tiles">${tessere}</div>
    ${forestieri}
    <div class="wp-nat-curve-card">
      <h4 class="wp-nat-chart-title">${escapeHtml(natT('labChart'))}</h4>
      <ul class="wp-nat-curve-legend">
        <li><span class="wp-nat-dot" style="background:${ORO}"></span>${escapeHtml(natT('labHome'))}</li>
        <li><span class="wp-nat-dot" style="background:${ESTERO}"></span>${escapeHtml(natT('labAway'))}</li>
      </ul>
      <div class="wp-nat-curve-slot">${graficoHtml(days)}</div>
    </div>
    <div class="wp-nat-lab-cols">
      ${elencoHtml(natT('labPartners'), natT('labPartnersHint'), partners, true)}
      ${elencoHtml(natT('labItems'), natT('labItemsHint'), items, false)}
    </div>`;
}

/**
 * Barre impilate: la parte bassa è il salario guadagnato in casa, quella
 * alta quello guadagnato all'estero. Un giorno senza righe semplicemente
 * non ha barra — non è uno zero, è un giorno che l'archivio non copre.
 */
function graficoHtml(days) {
  if (!days?.length) return '';
  const max = Math.max(...days.map(r => Number(r[1]) || 0)) || 1;
  const larghezza = (W - PAD_L - PAD_R) / days.length;
  const altezza = H - PAD_T - PAD_B;

  const barre = days.map((r, i) => {
    const tot = Number(r[1]) || 0;
    const fuori = Number(r[4]) || 0;
    const casa = Math.max(0, tot - fuori);
    const x = PAD_L + i * larghezza;
    const w = Math.max(1, larghezza - 1);
    const hTot = (tot / max) * altezza;
    const hFuori = (fuori / max) * altezza;
    const hCasa = (casa / max) * altezza;
    const yTot = PAD_T + altezza - hTot;
    return `
      <rect x="${x.toFixed(1)}" y="${(PAD_T + altezza - hCasa).toFixed(1)}" width="${w.toFixed(1)}" height="${hCasa.toFixed(1)}" fill="${ORO}"/>
      <rect x="${x.toFixed(1)}" y="${yTot.toFixed(1)}" width="${w.toFixed(1)}" height="${hFuori.toFixed(1)}" fill="${ESTERO}"/>`;
  }).join('');

  const primo = days[0][0], ultimo = days[days.length - 1][0];
  return `
    <svg class="wp-nat-lab-chart" viewBox="0 0 ${W} ${H}" role="img"
         aria-label="${escapeHtml(natT('labChart'))}">
      ${barre}
      <text x="${PAD_L}" y="${PAD_T - 2}" class="wp-nat-lab-axis">${escapeHtml(oro(max))}</text>
      <text x="${PAD_L}" y="${H - 4}" class="wp-nat-lab-axis">${escapeHtml(fmtData(primo))}</text>
      <text x="${W - PAD_R}" y="${H - 4}" class="wp-nat-lab-axis" text-anchor="end">${escapeHtml(fmtData(ultimo))}</text>
    </svg>`;
}

/** Le due classifiche in fondo: chi paga, e per cosa si lavora. */
function elencoHtml(titolo, spiegazione, righe, conBandiera) {
  if (!righe?.length) return '';
  const top = righe.slice(0, 8);
  const max = Number(top[0][1]) || 1;
  const lista = top.map(r => {
    const etichetta = conBandiera ? nomeDi(r[0]) : r[0];
    const bandiera = conBandiera ? flagImg(r[0], 'wp-nat-lab-flag') : '';
    return `
      <li class="wp-nat-lab-row">
        ${bandiera}<span class="wp-nat-lab-name">${escapeHtml(etichetta)}</span>
        <span class="wp-nat-lab-bar"><span style="width:${((Number(r[1]) / max) * 100).toFixed(1)}%"></span></span>
        <span class="wp-nat-lab-num">${escapeHtml(oro(r[1]))}</span>
      </li>`;
  }).join('');
  return `
    <div class="wp-nat-lab-col">
      <h4 class="wp-nat-chart-title">${escapeHtml(titolo)}</h4>
      <p class="wp-nat-lab-sub">${escapeHtml(spiegazione)}</p>
      <ul class="wp-nat-lab-list">${lista}</ul>
    </div>`;
}
