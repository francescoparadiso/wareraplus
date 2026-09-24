/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: la scheda PREZZI
   ------------------------------------------------------------------
   La domanda: «quanto vale adesso, e da dove viene quel prezzo». È la
   scheda nuova della sezione — le altre due (Rendite, Ottimizzatore)
   esistevano già come viste separate e qui sono state solo affiancate.

   ── DUE OROLOGI, COME NELLE RENDITE ────────────────────────────────
   · il prezzo di ADESSO e il libro ordini: `itemTrading.getPrices` e
     `tradingOrder.getTopOrders`, PUBBLICHE, dirette su api6, TTL 5
     minuti. Sono gli stessi dati che carica `src/market/api.js`, e
     infatti li si chiede a lui: aprire questa scheda dopo le Rendite
     non ricompra niente, e viceversa. Un refresh = una richiesta HTTP.
   · lo STORICO: `/price-history` sul server di cache, una candela al
     giorno. Senza fallback e senza scuse — WarEra dice quanto costa
     adesso e basta, quindi se il server non risponde questa scheda
     mostra i prezzi di adesso e dichiara che l'archivio manca.

   ⚠️ Lo storico è anche il pezzo che **non si rifà**: fino al
   2026-09-19 lo teneva anche l'archivio di terzi da cui viene
   `server/import/prezzi.js`, che ha chiuso. Da lì in poi la sola copia
   è il VPS (vedi server/README.md, "Backup"). Per questo la scheda
   dichiara sempre da che giorno l'archivio guarda davvero, invece di
   intitolare "un anno" una linea che copre dodici giorni.

   ── NIENTE FETCH PROPRIE ───────────────────────────────────────────
   Questo file non chiama mai `fetch`: tutto passa da
   `src/market/api.js`. Se domani serve un dato nuovo, si aggiunge là e
   lo si legge qui — non si apre una seconda strada verso le API, che
   è il modo in cui tornano i 429 che il batching esiste per evitare.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from '../mu/ui.js';
import { ecoT } from './i18n.js';
import { candleChartSvg, attachCandleExplorer } from './candleChart.js';
import { variazione, priceChartSvg } from '../market/priceChart.js';
import {
  loadMarketData, loadPriceHistory, priceSeries, priceHistoryCoverage,
  priceAgeMs, PRICE_TTL_MS,
} from '../market/api.js';

// ── Stato della scheda ──────────────────────────────────────────────
// Vive quanto la sezione: tornare sui Prezzi dopo un giro sulle Rendite
// ritrova la risorsa aperta e il periodo scelto.
let _container = null;
let _data = null;          // quello che torna da loadMarketData
let _history = null;       // presente o no: la sezione andamento dipende da questo
let _aperta = null;        // codice della risorsa aperta, null = elenco
let _giorni = 90;          // periodo del grafico
let _mode = 'candles';     // 'candles' | 'line'
let _cerca = '';
let _sort = { key: 'code', dir: 1 };
let _loading = false;
let _timer = null;

const RANGES = [
  { g: 30, key: 'r30' }, { g: 90, key: 'r90' }, { g: 365, key: 'r365' }, { g: 3650, key: 'rAll' },
];

// ── Numeri ──────────────────────────────────────────────────────────
/* Stessa regola delle Rendite: il mercato lavora sui millesimi (grain a
   0,0767), quindi i decimali si scelgono in base alla grandezza invece
   di troncare a due e cancellare le differenze che contano. */
function gold(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const d = Math.abs(v) < 1 ? 4 : Math.abs(v) < 100 ? 3 : 2;
  return v.toFixed(d);
}
function deltaHtml(v) {
  if (v == null || !Number.isFinite(v)) return '<span class="wp-ecn-dim">—</span>';
  const cls = v > 0.05 ? 'wp-ecn-up' : v < -0.05 ? 'wp-ecn-down' : 'wp-ecn-flat';
  const segno = v > 0 ? '+' : v < 0 ? '−' : '';
  return `<span class="wp-ecn-delta ${cls}">${segno}${Math.abs(v).toFixed(1)}%</span>`;
}
/* WarEra+ — Segnalato: nella scheda di una risorsa le tre variazioni
   stavano in fila senza dire rispetto a cosa (nell'elenco lo dicono le
   intestazioni delle colonne, qui non c'e' niente sopra). Ora ognuna porta
   il periodo e il giorno con cui confronta, e nel title il prezzo di
   partenza. Stesso calcolo di `variazione` (market/priceChart.js): l'ultima
   chiusura contro quella di N giorni prima, o la prima dopo se quel giorno
   e' un buco — per questo il giorno si scrive, invece di dare per scontato
   che "7g" sia esattamente sette giorni fa. */
function confrontoHtml(serie, giorni, chiave) {
  const pct = variazione(serie, giorni);
  const ultimo = serie?.[serie.length - 1];
  let rif = null;
  if (ultimo) {
    const b = new Date(`${ultimo[0]}T12:00:00Z`);
    b.setUTCDate(b.getUTCDate() - giorni);
    rif = serie.find(r => r[0] >= b.toISOString().slice(0, 10)) || null;
  }
  const giorno = rif ? new Intl.DateTimeFormat(lingua(), { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${rif[0]}T12:00:00Z`)) : null;
  const title = rif ? ecoT('vsCloseTitle', { date: giorno, price: gold(rif[4]), last: gold(ultimo[4]) }) : '';
  return `<span class="wp-ecn-dchg"${title ? ` title="${escapeHtml(title)}"` : ''}>
      <em>${escapeHtml(ecoT(chiave))}</em> ${deltaHtml(pct)}
      ${giorno && pct != null ? `<small>${escapeHtml(ecoT('sinceDay', { date: giorno }))}</small>` : ''}
    </span>`;
}

function eta(ms) {
  if (ms < 0) return '—';
  const m = Math.round(ms / 60000);
  return m < 1 ? '<1 min' : `${m} min`;
}
function lingua() {
  return (localStorage.getItem('we_lang') || navigator.language || 'it').slice(0, 2);
}

// ── Le righe ────────────────────────────────────────────────────────
/** Una riga per risorsa, con dentro tutto quello che serve a disegnarla
 *  e a ordinarla. Niente fetch: legge quello che c'è già in mano. */
function righe() {
  if (!_data) return [];
  const { gameConfig, items, prices, book } = _data;
  return items.map(code => {
    const item = gameConfig.items[code] || {};
    const serie = priceSeries(code);
    const b = book?.[code] || {};
    return {
      code,
      type: item.type === 'raw' ? 'raw' : 'product',
      price: prices?.[code] ?? null,
      bid: b.bid ?? null, bidQty: b.bidQty ?? 0,
      ask: b.ask ?? null, askQty: b.askQty ?? 0,
      serie,
      d1: variazione(serie, 1),
      d7: variazione(serie, 7),
      d30: variazione(serie, 30),
    };
  });
}

function filtrate() {
  const q = _cerca.trim().toLowerCase();
  const list = righe().filter(r => !q || r.code.toLowerCase().includes(q));
  const k = _sort.key, dir = _sort.dir;
  return list.sort((a, b) => {
    const va = a[k], vb = b[k];
    if (typeof va === 'string') return va.localeCompare(vb) * dir;
    // Chi non ha il dato finisce in fondo in entrambi i versi: un null
    // ordinato come zero direbbe "è crollato del 100%".
    if (va == null && vb == null) return 0;
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir;
  });
}

// ── Disegno: l'elenco ───────────────────────────────────────────────
const COLONNE = [
  { key: 'code', label: 'price', testo: true },
  { key: 'price', label: 'price' },
  { key: 'bid', label: 'sellAt' },
  { key: 'ask', label: 'buyAt' },
  { key: 'd1', label: 'd1' },
  { key: 'd7', label: 'd7' },
  { key: 'd30', label: 'd30' },
];

function elencoHtml() {
  const list = filtrate();
  if (!list.length) return `<div class="wp-ecn-empty">${escapeHtml(ecoT('empty'))}</div>`;

  const head = `
    <div class="wp-ecn-thead">
      <button type="button" class="wp-ecn-th${_sort.key === 'code' ? ' active' : ''}" data-sort="code">${escapeHtml(ecoT('resource'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'price' ? ' active' : ''}" data-sort="price">${escapeHtml(ecoT('price'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'bid' ? ' active' : ''}" data-sort="bid">${escapeHtml(ecoT('sellAt'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'ask' ? ' active' : ''}" data-sort="ask">${escapeHtml(ecoT('buyAt'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'd1' ? ' active' : ''}" data-sort="d1">${escapeHtml(ecoT('d1'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'd7' ? ' active' : ''}" data-sort="d7">${escapeHtml(ecoT('d7'))}</button>
      <button type="button" class="wp-ecn-th wp-ecn-num${_sort.key === 'd30' ? ' active' : ''}" data-sort="d30">${escapeHtml(ecoT('d30'))}</button>
      <span class="wp-ecn-th wp-ecn-spark"></span>
    </div>`;

  const body = list.map(r => `
    <div class="wp-ecn-row" role="button" tabindex="0" data-code="${escapeHtml(r.code)}">
      <span class="wp-ecn-item">
        <span class="wp-ecn-code">${escapeHtml(r.code)}</span>
        <span class="wp-ecn-type wp-ecn-type-${r.type}">${escapeHtml(ecoT(r.type === 'raw' ? 'raw' : 'product'))}</span>
      </span>
      <span class="wp-ecn-num wp-ecn-price">${escapeHtml(gold(r.price))}</span>
      <span class="wp-ecn-num">${escapeHtml(gold(r.bid))}</span>
      <span class="wp-ecn-num">${escapeHtml(gold(r.ask))}</span>
      <span class="wp-ecn-num">${deltaHtml(r.d1)}</span>
      <span class="wp-ecn-num">${deltaHtml(r.d7)}</span>
      <span class="wp-ecn-num">${deltaHtml(r.d30)}</span>
      <span class="wp-ecn-spark">${r.serie.length > 1 ? priceChartSvg(r.serie.slice(-30), { fmt: gold }) : ''}</span>
    </div>`).join('');

  return `<div class="wp-ecn-table">${head}${body}</div>`;
}

// ── Disegno: la risorsa aperta ──────────────────────────────────────
// La finestra disegnata per ultima: wire() ci aggancia l'esploratore dopo
// che il grafico e' nel documento (vedi attachCandleExplorer).
let _finestra = null;

function dettaglioHtml(code) {
  _finestra = null;
  const r = righe().find(x => x.code === code);
  if (!r) return elencoHtml();

  // Il grafico guarda solo la finestra scelta. Il taglio si fa sui
  // GIORNI e non sulle ultime N candele: con dei buchi dentro, "le
  // ultime 30 righe" possono coprire due mesi.
  const dal = new Date(Date.now() - _giorni * 86400000).toISOString().slice(0, 10);
  const finestra = r.serie.filter(c => c[0] >= dal);
  const ultima = r.serie[r.serie.length - 1] || null;

  const grafico = finestra.length > 1
    ? candleChartSvg(finestra, { fmt: gold, lingua: lingua(), mode: _mode })
    : '';
  if (grafico) _finestra = finestra;

  const spread = (r.ask != null && r.bid != null) ? r.ask - r.bid : null;

  return `
    <div class="wp-ecn-detail">
      <button type="button" class="wp-ecn-back" data-back="1">← ${escapeHtml(ecoT('backToList'))}</button>

      <header class="wp-ecn-dhead">
        <h3>${escapeHtml(r.code)}
          <span class="wp-ecn-type wp-ecn-type-${r.type}">${escapeHtml(ecoT(r.type === 'raw' ? 'raw' : 'product'))}</span>
        </h3>
        <div class="wp-ecn-dprice">
          <strong>${escapeHtml(gold(r.price))}</strong>
          ${confrontoHtml(r.serie, 1, 'd1')} ${confrontoHtml(r.serie, 7, 'd7')} ${confrontoHtml(r.serie, 30, 'd30')}
        </div>
      </header>

      <div class="wp-ecn-book">
        <span><em>${escapeHtml(ecoT('sellAt'))}</em> ${escapeHtml(gold(r.bid))}
          ${r.bidQty ? `<span class="wp-ecn-dim">×${r.bidQty}</span>` : ''}</span>
        <span><em>${escapeHtml(ecoT('buyAt'))}</em> ${escapeHtml(gold(r.ask))}
          ${r.askQty ? `<span class="wp-ecn-dim">×${r.askQty}</span>` : ''}</span>
        <span><em>${escapeHtml(ecoT('spread'))}</em> ${escapeHtml(gold(spread))}</span>
        ${ultima ? `
          <span><em>${escapeHtml(ecoT('open'))}</em> ${escapeHtml(gold(ultima[1]))}</span>
          <span><em>${escapeHtml(ecoT('high'))}</em> ${escapeHtml(gold(ultima[2]))}</span>
          <span><em>${escapeHtml(ecoT('low'))}</em> ${escapeHtml(gold(ultima[3]))}</span>` : ''}
      </div>

      ${_history ? `
        <div class="wp-ecn-chartbar">
          <span class="wp-ecn-dim">${escapeHtml(ecoT('range'))}</span>
          ${RANGES.map(x => `<button type="button" class="wp-ecn-chip${_giorni === x.g ? ' active' : ''}" data-range="${x.g}">${escapeHtml(ecoT(x.key))}</button>`).join('')}
          <span class="wp-ecn-sep"></span>
          <button type="button" class="wp-ecn-chip${_mode === 'candles' ? ' active' : ''}" data-mode="candles">${escapeHtml(ecoT('candles'))}</button>
          <button type="button" class="wp-ecn-chip${_mode === 'line' ? ' active' : ''}" data-mode="line">${escapeHtml(ecoT('line'))}</button>
        </div>
        <div class="wp-ecn-chartwrap">${grafico || `<p class="wp-ecn-note">${escapeHtml(ecoT('noSeries'))}</p>`}</div>
        <p class="wp-ecn-note">${grafico ? `${escapeHtml(ecoT('exploreHint'))} ` : ''}${escapeHtml(ecoT('gap'))}</p>`
      : `<p class="wp-ecn-note">${escapeHtml(ecoT('noHistory'))}</p>`}
    </div>`;
}

// ── Lo scheletro della scheda ───────────────────────────────────────
function paint() {
  if (!_container) return;
  const copertura = priceHistoryCoverage();

  _container.innerHTML = `
    <div class="wp-ecn-prices">
      <header class="wp-ecn-phead">
        <div>
          <h2>${escapeHtml(ecoT('pricesTitle'))}</h2>
          <p class="wp-ecn-sub">${escapeHtml(ecoT('pricesSub'))}</p>
        </div>
        <div class="wp-ecn-tools">
          <input type="search" class="wp-ecn-search" placeholder="${escapeHtml(ecoT('search'))}" value="${escapeHtml(_cerca)}">
          <span class="wp-ecn-dim">${escapeHtml(ecoT('updated'))} ${eta(priceAgeMs())}</span>
          <button type="button" class="wp-ecn-refresh"${_loading ? ' disabled' : ''}>${
            escapeHtml(_loading ? ecoT('refreshing') : ecoT('refresh'))}</button>
        </div>
      </header>

      ${copertura ? `<p class="wp-ecn-note">${escapeHtml(ecoT('coverage', { d: copertura }))}</p>` : ''}

      ${!_data ? `<div class="wp-ecn-loading">${escapeHtml(ecoT('loading'))}</div>`
        : _aperta ? dettaglioHtml(_aperta) : elencoHtml()}
    </div>`;

  wire();
}

function wire() {
  const root = _container;
  if (!root) return;

  const cerca = root.querySelector('.wp-ecn-search');
  if (cerca) {
    cerca.addEventListener('input', () => {
      _cerca = cerca.value;
      // Solo il corpo: ridisegnare l'intestazione perderebbe il fuoco
      // dentro il campo mentre si scrive.
      const tbl = root.querySelector('.wp-ecn-table');
      if (tbl) tbl.outerHTML = elencoHtml();
      wireRows();
    });
  }

  root.querySelector('.wp-ecn-refresh')?.addEventListener('click', () => aggiorna({ force: true }));

  root.querySelectorAll('.wp-ecn-th[data-sort]').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      _sort = _sort.key === k ? { key: k, dir: -_sort.dir } : { key: k, dir: k === 'code' ? 1 : -1 };
      paint();
    });
  });

  root.querySelector('[data-back]')?.addEventListener('click', () => { _aperta = null; paint(); });

  root.querySelectorAll('[data-range]').forEach(b => {
    b.addEventListener('click', async () => {
      _giorni = Number(b.dataset.range);
      // Un periodo più largo di quello già scaricato costa una richiesta
      // al server; gli altri no (vedi loadPriceHistory).
      _history = await loadPriceHistory(_giorni) || _history;
      paint();
    });
  });
  root.querySelectorAll('[data-mode]').forEach(b => {
    b.addEventListener('click', () => { _mode = b.dataset.mode; paint(); });
  });

  // Il grafico si esplora: passaggio del mouse, clic per fissare, frecce.
  const wrap = root.querySelector('.wp-ecn-chartwrap');
  if (wrap && _finestra && _aperta) disegnaAllaMisura(wrap);

  wireRows();
}

/* WarEra+ — audit mobile 2026-09-24. Il grafico nasceva a 880x320 e il
   browser lo stirava sulla larghezza vera (preserveAspectRatio="none"): su
   un telefono largo 313px tutto si stringeva al 36% in orizzontale, testo
   degli assi compreso, che diventava illeggibile. Ora, appena il grafico è
   nel documento, lo si ridisegna alla misura del suo contenitore (e di
   nuovo se la finestra cambia), così un pixel del disegno è un pixel dello
   schermo e le etichette restano etichette. L'esploratore riceve la stessa
   misura, altrimenti la guida non cadrebbe sulle candele. */
let _resizeObs = null;
function disegnaAllaMisura(wrap) {
  const svg = wrap.querySelector('.wp-ecn-chart');
  if (!svg) return;
  const w = Math.round(svg.clientWidth), h = Math.round(svg.clientHeight);
  if (w > 50 && h > 50) {
    const nuovo = candleChartSvg(_finestra, { w, h, fmt: gold, lingua: lingua(), mode: _mode });
    if (nuovo) svg.outerHTML = nuovo;
  }
  wrap.querySelectorAll('.wp-ecn-guide, .wp-ecn-tip').forEach(e => e.remove());
  attachCandleExplorer(wrap, _finestra, { w: w > 50 ? w : 880, h: h > 50 ? h : 320, fmt: gold, lingua: lingua(), t: ecoT });

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

function wireRows() {
  _container?.querySelectorAll('.wp-ecn-row[data-code]').forEach(el => {
    const apri = () => { _aperta = el.dataset.code; paint(); };
    el.addEventListener('click', apri);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apri(); }
    });
  });
}

// ── Caricamento ─────────────────────────────────────────────────────
async function aggiorna({ force = false } = {}) {
  if (_loading) return;
  _loading = true;
  paint();
  try {
    // `pricesOnly`: le regioni consigliate servono alle Rendite, non qui,
    // e sono l'unica chiamata di tutta la sezione che passa dal proxy.
    _data = await loadMarketData({ force, pricesOnly: true });
  } catch (err) {
    console.warn('[economia/prezzi] prezzi non disponibili:', err.message);
  } finally {
    _loading = false;
  }
  paint();
}

/** Il giro automatico mentre la scheda è sotto gli occhi. Lo ferma
 *  `stopPricesTab()`, chiamato da main.js quando si cambia scheda o si
 *  chiude la sezione: un timer dietro un overlay invisibile è lo stesso
 *  errore corretto una volta in src/market/main.js. */
function avviaTimer() {
  fermaTimer();
  _timer = setInterval(() => {
    if (document.hidden) return;   // scheda del browser in secondo piano
    aggiorna();
  }, PRICE_TTL_MS);
}
function fermaTimer() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export async function initPricesTab(container) {
  _container = container;
  paint();
  // Lo storico prima dei prezzi: è quello che può mancare, e la scheda
  // deve sapere già al primo disegno se la sezione andamento esiste.
  _history = await loadPriceHistory(_giorni);
  await aggiorna();
  avviaTimer();
}

/** Ridisegna con la lingua nuova, a sezione già aperta. */
export function retranslatePricesTab() {
  if (_container) paint();
}

export function stopPricesTab() {
  fermaTimer();
}
