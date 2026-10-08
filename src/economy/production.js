/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: la scheda PRODUZIONE
   ------------------------------------------------------------------
   Tre domande che nessuna vista sapeva fare: per ogni risorsa quante
   aziende ci lavorano, quanti dipendenti ci sono sopra, e quanto rende
   allo Stato che le ospita. Con un filtro per nazione la stessa tabella
   risponde a «di cosa vive il NOSTRO gettito».

   ── TUTTO DAL SERVER, NESSUN RIPIEGO ───────────────────────────────
   Il dato è il censimento notturno di `server/companyCensus.js`: le
   aziende dei ~16.000 cittadini attivi e i salari pagati da quelle con
   dipendenti, misurati giorno per giorno. Dal browser servirebbero
   ~50.000 chiamate e la chiave API, quindi non c'è una strada diretta a
   cui ricadere: senza server la scheda lo dice e basta, come il danno
   ora per ora (src/nations/damageCurves.js).

   ── ⚠️ "TASSE SUI SALARI", NON "TUTTO IL GETTITO" ─────────────────
   Il numero è salari pagati × aliquota sul reddito della nazione dove
   opera l'azienda: misurato, non stimato. Ma NON contiene la tassa sul
   lavoro in proprio né quella di mercato, e la scheda lo scrive sotto
   la tabella. Chiamarlo "quanto guadagna lo Stato" senza la riga sotto
   sarebbe la stessa trappola di `rankings.countryBounty` (vedi
   server/battleArchive.js): un numero plausibile, che non è quello.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, countryName, flagImg, fmtCompact, fmtFull } from '../mu/ui.js';
import { state } from '../diplomacy/state.js';
import { fetchCompanyCensusViaCache } from '../diplomacy/cacheClient.js';
import { candleChartSvg, attachCandleExplorer } from './candleChart.js';
import { plusT } from './i18nPlus.js';
import { ecoT } from './i18n.js';

let _container = null;
let _census = null;        // risposta per il mondo (o per la nazione filtrata)
let _detail = null;        // risposta con `item` = risorsa aperta
let _country = null;       // filtro nazione, null = mondo
let _aperta = null;        // codice risorsa aperta, null = elenco
let _cerca = '';
let _sort = { key: 'tax', dir: -1 };
let _loading = false;
let _resizeObs = null;

const DAYS = 30;

function lingua() {
  return (localStorage.getItem('we_lang') || navigator.language || 'it').slice(0, 2);
}
function fmtDay(g) {
  return new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${g}T12:00:00Z`));
}
// Oro: i salari di una risorsa vanno da qualche decimo a decine di migliaia.
const oro = (v) => (v == null || !Number.isFinite(v) || v === 0 ? '—' : fmtCompact(v));

// ── Righe ──────────────────────────────────────────────────────────
function righe() {
  const items = _census?.items || {};
  return Object.entries(items).map(([code, v]) => ({
    code, companies: v[0], withWorkers: v[1], workers: v[2], wages: v[3], tax: v[4],
  }));
}

function filtrate() {
  const q = _cerca.trim().toLowerCase();
  const list = righe().filter(r => !q || r.code.toLowerCase().includes(q));
  const { key, dir } = _sort;
  return list.sort((a, b) => (key === 'code' ? a.code.localeCompare(b.code) * dir : ((a[key] || 0) - (b[key] || 0)) * dir));
}

const COLONNE = [
  { key: 'code', label: 'resource', testo: true },
  { key: 'companies', label: 'companies' },
  { key: 'withWorkers', label: 'withWorkers' },
  { key: 'workers', label: 'workers' },
  { key: 'wages', label: 'wagesDay' },
  { key: 'tax', label: 'taxDay' },
];

function testataHtml() {
  return `<div class="wp-ecn-pthead">${COLONNE.map(c => `
    <button type="button" class="wp-ecn-pth${c.testo ? '' : ' wp-ecn-num'}${_sort.key === c.key ? ' active' : ''}"
            data-sort="${c.key}">${escapeHtml(plusT(c.label))}${_sort.key === c.key ? (_sort.dir > 0 ? ' ▲' : ' ▼') : ''}</button>`).join('')}
  </div>`;
}

function elencoHtml() {
  const list = filtrate();
  if (!list.length) return `<div class="wp-ecn-empty">${escapeHtml(ecoT('empty'))}</div>`;
  const tot = list.reduce((a, r) => {
    a.companies += r.companies; a.withWorkers += r.withWorkers; a.workers += r.workers;
    a.wages += r.wages || 0; a.tax += r.tax || 0; return a;
  }, { companies: 0, withWorkers: 0, workers: 0, wages: 0, tax: 0 });
  const riga = (r) => `
    <div class="wp-ecn-prow" role="button" tabindex="0" data-code="${escapeHtml(r.code)}">
      <span class="wp-ecn-code">${escapeHtml(r.code)}</span>
      <span class="wp-ecn-num">${escapeHtml(fmtFull(r.companies))}</span>
      <span class="wp-ecn-num">${escapeHtml(fmtFull(r.withWorkers))}</span>
      <span class="wp-ecn-num">${escapeHtml(fmtFull(r.workers))}</span>
      <span class="wp-ecn-num">${escapeHtml(oro(r.wages))}</span>
      <span class="wp-ecn-num wp-ecn-price">${escapeHtml(oro(r.tax))}</span>
    </div>`;
  return `
    <div class="wp-ecn-ptable">
      ${testataHtml()}
      ${list.map(riga).join('')}
      <div class="wp-ecn-prow wp-ecn-ptotal">
        <span>${escapeHtml(plusT('total'))}</span>
        <span class="wp-ecn-num">${escapeHtml(fmtFull(tot.companies))}</span>
        <span class="wp-ecn-num">${escapeHtml(fmtFull(tot.withWorkers))}</span>
        <span class="wp-ecn-num">${escapeHtml(fmtFull(tot.workers))}</span>
        <span class="wp-ecn-num">${escapeHtml(oro(tot.wages))}</span>
        <span class="wp-ecn-num wp-ecn-price">${escapeHtml(oro(tot.tax))}</span>
      </div>
    </div>
    <p class="wp-ecn-note">${escapeHtml(plusT('rowHint'))}</p>`;
}

// ── La risorsa aperta ──────────────────────────────────────────────
/** La serie del grafico, nella forma del grafico a candele: [giorno, t,
 *  t, t, t, null, salari]. Le quattro uguali perché la linea legge la
 *  chiusura e la scala legge massimo e minimo. */
function serieGrafico(code) {
  const src = (_detail?.series || _census?.series || {})[code] || [];
  return src.map(([g, w, t]) => [g, t, t, t, t, null, w]);
}

let _finestra = null;

function dettaglioHtml(code) {
  _finestra = null;
  const fonte = _detail?.item === code ? _detail : _census;
  const v = fonte?.items?.[code];
  if (!v) return elencoHtml();
  const serie = serieGrafico(code);
  if (serie.length > 1) _finestra = serie;
  const paesi = _detail?.item === code ? (_detail.countries || []) : null;
  const totTasse = paesi ? paesi.reduce((a, r) => a + (r[5] || 0), 0) : 0;

  const tabellaPaesi = !paesi ? `<div class="wp-ecn-loading">${escapeHtml(plusT('loading'))}</div>`
    : !paesi.length ? `<p class="wp-ecn-note">${escapeHtml(plusT('noCountries'))}</p>`
      : `
      <div class="wp-ecn-ptable wp-ecn-pcountries">
        <div class="wp-ecn-pthead">
          <span class="wp-ecn-pth">${escapeHtml(plusT('country'))}</span>
          <span class="wp-ecn-pth wp-ecn-num">${escapeHtml(plusT('companies'))}</span>
          <span class="wp-ecn-pth wp-ecn-num">${escapeHtml(plusT('workers'))}</span>
          <span class="wp-ecn-pth wp-ecn-num">${escapeHtml(plusT('rate'))}</span>
          <span class="wp-ecn-pth wp-ecn-num">${escapeHtml(plusT('taxDay'))}</span>
          <span class="wp-ecn-pth wp-ecn-num">${escapeHtml(plusT('share'))}</span>
        </div>
        ${paesi.map(([cid, c, , w, , t, rate]) => `
          <div class="wp-ecn-prow wp-ecn-prow-static${cid === _country ? ' wp-ecn-prow-mine' : ''}">
            <span class="wp-ecn-pcountry">${flagImg(cid, 'wp-ecn-flag')}<span>${escapeHtml(countryName(cid))}</span></span>
            <span class="wp-ecn-num">${escapeHtml(fmtFull(c))}</span>
            <span class="wp-ecn-num">${escapeHtml(fmtFull(w))}</span>
            <span class="wp-ecn-num">${rate == null ? '—' : `${escapeHtml(fmtFull(rate))}%`}</span>
            <span class="wp-ecn-num wp-ecn-price">${escapeHtml(oro(t))}</span>
            <span class="wp-ecn-num">${totTasse > 0 && t > 0
              ? escapeHtml(new Intl.NumberFormat(lingua(), { style: 'percent', maximumFractionDigits: 1 }).format(t / totTasse))
              : '—'}</span>
          </div>`).join('')}
      </div>`;

  return `
    <div class="wp-ecn-detail">
      <button type="button" class="wp-ecn-back" data-back="1">← ${escapeHtml(plusT('back'))}</button>
      <header class="wp-ecn-dhead">
        <h3>${escapeHtml(code)}${_country ? ` <span class="wp-ecn-dim">· ${escapeHtml(countryName(_country))}</span>` : ''}</h3>
      </header>
      <div class="wp-ecn-book">
        <span><em>${escapeHtml(plusT('companies'))}</em> ${escapeHtml(fmtFull(v[0]))}</span>
        <span><em>${escapeHtml(plusT('withWorkers'))}</em> ${escapeHtml(fmtFull(v[1]))}</span>
        <span><em>${escapeHtml(plusT('workers'))}</em> ${escapeHtml(fmtFull(v[2]))}</span>
        <span><em>${escapeHtml(plusT('wagesDay'))}</em> ${escapeHtml(oro(v[3]))}</span>
        <span><em>${escapeHtml(plusT('taxDay'))}</em> ${escapeHtml(oro(v[4]))}</span>
      </div>
      <h4 class="wp-ecn-psec">${escapeHtml(plusT('chartTax'))}</h4>
      <div class="wp-ecn-chartwrap">${_finestra
        ? candleChartSvg(_finestra, { fmt: oro, lingua: lingua(), mode: 'line' })
        : `<p class="wp-ecn-note">${escapeHtml(plusT('noSeries'))}</p>`}</div>
      <h4 class="wp-ecn-psec">${escapeHtml(plusT('whereTitle'))}</h4>
      ${tabellaPaesi}
    </div>`;
}

// ── Scheletro ──────────────────────────────────────────────────────
function noteHtml() {
  const c = _census;
  if (!c?.available) return '';
  const cov = c.coverage || {};
  const parti = [
    plusT('noteActive', {
      owners: fmtFull(cov.owners), companies: fmtFull(cov.companies), workers: fmtFull(cov.workers),
      day: c.day ? fmtDay(c.day) : '—',
    }),
    plusT('noteAvg', { n: c.averageDays || 0 }),
    plusT('noteTax'),
  ];
  // I giorni ricostruiti a ritroso esistono solo se il primo censimento
  // ha riempito un mese intero: si dichiarano finché sono nella finestra.
  if (c.measuredFrom && c.wagesFrom && c.measuredFrom > c.wagesFrom) {
    parti.push(plusT('noteBackfill', { d: fmtDay(c.measuredFrom) }));
  }
  return parti.map(p => `<p class="wp-ecn-note">${escapeHtml(p)}</p>`).join('');
}

function opzioniPaesi() {
  const nazioni = [...(state.nationMap?.values?.() || [])]
    .filter(n => n?._id && n?.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  return `<option value="">${escapeHtml(plusT('allCountries'))}</option>`
    + nazioni.map(n => `<option value="${escapeHtml(n._id)}"${n._id === _country ? ' selected' : ''}>${escapeHtml(n.name)}</option>`).join('');
}

function paint() {
  if (!_container) return;
  let corpo;
  if (_loading && !_census) corpo = `<div class="wp-ecn-loading">${escapeHtml(plusT('loading'))}</div>`;
  else if (!_census) corpo = `<div class="wp-ecn-empty">${escapeHtml(plusT('notAvailable'))}</div>`;
  else if (!_census.available) corpo = `<div class="wp-ecn-empty">${escapeHtml(plusT('notYet'))}</div>`;
  else corpo = _aperta ? dettaglioHtml(_aperta) : `<div class="wp-ecn-plist">${elencoHtml()}</div>`;

  _container.innerHTML = `
    <div class="wp-ecn-prices wp-ecn-prod">
      <header class="wp-ecn-phead">
        <div>
          <h2>${escapeHtml(plusT('prodTitle'))}</h2>
          <p class="wp-ecn-sub">${escapeHtml(plusT('prodSub'))}</p>
        </div>
        <div class="wp-ecn-tools">
          ${_aperta ? '' : `<input type="search" class="wp-ecn-search" placeholder="${escapeHtml(plusT('search'))}" value="${escapeHtml(_cerca)}">`}
          <select class="wp-ecn-select" aria-label="${escapeHtml(plusT('country'))}">${opzioniPaesi()}</select>
        </div>
      </header>
      ${corpo}
      ${_census?.available && !_aperta ? noteHtml() : ''}
    </div>`;
  wire();
}

function wire() {
  const root = _container;
  if (!root) return;

  const cerca = root.querySelector('.wp-ecn-search');
  cerca?.addEventListener('input', () => {
    _cerca = cerca.value;
    // Solo l'elenco: ridisegnare l'intestazione perderebbe il fuoco
    // dentro il campo mentre si scrive.
    const lista = root.querySelector('.wp-ecn-plist');
    if (lista) lista.innerHTML = elencoHtml();
    wireTabella();
  });

  root.querySelector('.wp-ecn-select')?.addEventListener('change', async (e) => {
    _country = e.target.value || null;
    await carica();
  });

  root.querySelector('[data-back]')?.addEventListener('click', () => { _aperta = null; _detail = null; paint(); });

  const wrap = root.querySelector('.wp-ecn-chartwrap');
  if (wrap && _finestra && _aperta) disegnaAllaMisura(wrap);

  wireTabella();
}

function wireTabella() {
  const root = _container;
  root?.querySelectorAll('.wp-ecn-pth[data-sort]').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      _sort = _sort.key === k ? { key: k, dir: -_sort.dir } : { key: k, dir: k === 'code' ? 1 : -1 };
      paint();
    });
  });
  root?.querySelectorAll('.wp-ecn-prow[data-code]').forEach(el => {
    const apri = () => apriRisorsa(el.dataset.code);
    el.addEventListener('click', apri);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(); }
    });
  });
}

/* Stessa ragione di prices.js: il grafico si ridisegna alla misura vera
   del contenitore, o su un telefono le etichette si stringono al 36%. */
function disegnaAllaMisura(wrap) {
  const svg = wrap.querySelector('.wp-ecn-chart');
  if (!svg) return;
  const w = Math.round(svg.clientWidth), h = Math.round(svg.clientHeight);
  if (w > 50 && h > 50) {
    const nuovo = candleChartSvg(_finestra, { w, h, fmt: oro, lingua: lingua(), mode: 'line' });
    if (nuovo) svg.outerHTML = nuovo;
  }
  wrap.querySelectorAll('.wp-ecn-guide, .wp-ecn-tip').forEach(e => e.remove());
  attachCandleExplorer(wrap, _finestra, {
    w: w > 50 ? w : 880, h: h > 50 ? h : 320, fmt: oro, lingua: lingua(), t: ecoT,
    righe: (r) => [
      [escapeHtml(plusT('taxLbl')), escapeHtml(oro(r[4]))],
      [escapeHtml(plusT('wagesLbl')), escapeHtml(oro(r[6]))],
    ],
  });
  _resizeObs?.disconnect();
  let ultimaW = w;
  _resizeObs = new ResizeObserver(() => {
    const nw = Math.round(wrap.querySelector('.wp-ecn-chart')?.clientWidth || 0);
    if (!nw || Math.abs(nw - ultimaW) < 8 || !wrap.isConnected) return;
    ultimaW = nw;
    disegnaAllaMisura(wrap);
  });
  _resizeObs.observe(wrap);
}

// ── Caricamento ────────────────────────────────────────────────────
async function apriRisorsa(code) {
  _aperta = code;
  _detail = null;
  paint();
  const d = await fetchCompanyCensusViaCache({ item: code, countryId: _country, days: DAYS });
  if (_aperta !== code) return;   // l'utente è già tornato indietro
  _detail = d?.available ? d : { item: code, countries: [] };
  paint();
}

async function carica() {
  _loading = true;
  paint();
  _census = await fetchCompanyCensusViaCache({ countryId: _country, days: DAYS });
  _loading = false;
  if (_aperta) await apriRisorsa(_aperta);
  else paint();
}

export async function initProductionTab(container) {
  _container = container;
  // Riapertura della scheda: il censimento cambia una volta al giorno, e
  // la memoria del client lo tiene 10 minuti — niente da ricaricare.
  if (_census) { paint(); return; }
  await carica();
}

export function retranslateProductionTab() {
  if (_container) paint();
}

export function stopProductionTab() {
  _resizeObs?.disconnect();
}
