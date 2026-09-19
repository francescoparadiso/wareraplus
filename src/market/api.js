/* ══════════════════════════════════════════════════════════════
   WarEra+ — Rendite di produzione: layer dati
   ------------------------------------------------------------------
   Tre pezzi, tre politiche diverse — perché cambiano a ritmi diversi e
   costano cose diverse:

   1. PREZZI (`itemTrading.getPrices`) e LIBRO ORDINI
      (`tradingOrder.getTopOrders`, uno per risorsa). Pubblici: rispondono
      da api6 SENZA chiave, quindi non passano dal proxy e non consumano
      il budget del Worker. Sono anche l'unica cosa che si muove di
      continuo, quindi hanno il TTL più corto (5 minuti) e un
      aggiornamento automatico mentre la vista è aperta. Le 21 chiamate
      stanno in un solo batch GET (tetto 50, vedi shared/trpcClient.js).

   2. MIGLIORI REGIONI (`company.getRecommendedRegionIdsByItemCode`, una
      per risorsa). Token-gated: passa da ecoBatch → proxy VPS, Worker
      come rete (shared/trpcProxy.js). Cambia solo quando un giacimento
      nasce o scade — ore, non minuti — quindi TTL 30 minuti e cache in
      localStorage: alla riapertura la tabella è già piena mentre i
      prezzi si rinfrescano.

   3. REGIONI e NAZIONI: zero fetch. Nomi, paese e giacimenti stanno in
      `state.regionData`, tasse e bonus nazionali in `state.nazioniGlobal`
      — entrambi caricati da Diplomacy al boot. Se la mappa non ha ancora
      finito, i nomi delle sole regioni citate si risolvono in un batch
      (`region.getById`), come fa già l'Ottimizzatore.

   DEGRADO (regola di progetto: il proxy è un'ottimizzazione, mai un
   nuovo punto di fallimento). Se le raccomandazioni non arrivano, la
   tabella resta in piedi con prezzi, costo materie prime, rendita base e
   paga di pareggio — cioè tutto ciò che non dipende dal bonus — e lo
   dichiara in chiaro. Se cadono anche i prezzi, allora sì, non c'è vista.
   ══════════════════════════════════════════════════════════════ */

import { trpcBatchManual, cacheKey, cacheGet, cacheSet } from '../shared/trpcClient.js';
import { ECO_PROXY_BASE, WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { state } from '../diplomacy/state.js';
import { loadGameData } from '../eco/api.js';

const NS = 'mkt';

/** Prezzi e libro ordini: quello che si muove. L'utente ha chiesto
 *  esplicitamente "almeno una volta all'ora, più spesso è meglio" — 5
 *  minuti è il compromesso: una richiesta HTTP a giro, pubblica. */
export const PRICE_TTL_MS = 5 * 60 * 1000;
/** Regioni consigliate: un giacimento dura giorni, il bonus nazionale
 *  cambia con le elezioni. Mezz'ora è già generoso. */
export const REGION_TTL_MS = 30 * 60 * 1000;

/* Cache di processo: sopravvive alla chiusura dell'overlay (riaprire non
   deve ricominciare da zero) ma non al reload, dove subentra
   localStorage per le sole regioni consigliate. */
let _mem = { prices: null, book: null, pricesTs: 0, regions: null, regionsTs: 0 };

/** Le risorse che si possono davvero produrre: hanno punti produzione e
 *  sono scambiabili. Oggi sono 20 (9 materie prime + 11 prodotti). */
export function producibleItems(gameConfig) {
  return Object.entries(gameConfig.items)
    .filter(([, it]) => it.productionPoints && it.isTradable)
    .map(([code]) => code)
    .sort();
}

/* ── 1. Prezzi + libro ordini (pubblici, diretti su api6) ────────── */
async function fetchPricesAndBook(items) {
  const calls = [['itemTrading.getPrices', {}]];
  for (const code of items) calls.push(['tradingOrder.getTopOrders', { itemCode: code, limit: 3 }]);

  const res = await trpcBatchManual(calls);
  const prices = res[0];
  if (!prices) throw new Error('prezzi non disponibili');

  const book = {};
  items.forEach((code, i) => {
    const o = res[i + 1];
    if (!o) return;
    // Migliore domanda = a quanto vendo SUBITO; migliore offerta = a
    // quanto compro subito. Le quantità servono a marcare i prezzi
    // sottili: il prezzo migliore per 12 pezzi non è un prezzo.
    const bid = (o.buyOrders || [])[0] || null;
    const ask = (o.sellOrders || [])[0] || null;
    book[code] = {
      bid: bid ? bid.price : null,
      bidQty: bid ? bid.quantity : 0,
      ask: ask ? ask.price : null,
      askQty: ask ? ask.quantity : 0,
    };
  });
  return { prices, book };
}

/* ── 2. Migliori regioni per risorsa (serve la API key) ──────────── */
async function fetchBestRegions(items) {
  const calls = items.map(code => ['company.getRecommendedRegionIdsByItemCode', { itemCode: code }]);
  const res = await trpcBatchManual(calls, { useWorker: true, workerBaseUrl: ECO_PROXY_BASE });
  const out = {};
  let any = false;
  items.forEach((code, i) => {
    const list = Array.isArray(res[i]) ? res[i] : [];
    if (list.length) any = true;
    out[code] = list;
  });
  if (!any) throw new Error('regioni consigliate non disponibili');
  return out;
}

/* ── 3. Regioni citate: dalla memoria, altrimenti in batch ───────── */
async function resolveRegions(regionIds) {
  const known = state.regionData || {};
  const missing = [...regionIds].filter(id => !known[id]);
  if (!missing.length) return known;

  const res = await trpcBatchManual(missing.map(id => ['region.getById', { regionId: id }]));
  // Copia, non mutazione: `state.regionData` è dato condiviso con la
  // mappa e questa vista non deve scriverci dentro.
  const merged = { ...known };
  missing.forEach((id, i) => { if (res[i]) merged[id] = res[i]; });
  return merged;
}

/**
 * Carica (o rinfresca) tutto il necessario alla vista.
 *
 * @param {{ force?: boolean, pricesOnly?: boolean }} opts
 *   `force` ignora i TTL (bottone Aggiorna), `pricesOnly` salta le
 *   regioni anche se scadute (giro automatico leggero).
 * @returns {Promise<{gameConfig, items, prices, book, regionsByItem,
 *   regionById, pricesTs, regionsTs, regionsError}>}
 */
export async function loadMarketData({ force = false, pricesOnly = false } = {}) {
  const { gameConfig } = await loadGameData();
  const items = producibleItems(gameConfig);
  const now = Date.now();

  if (force || !_mem.prices || (now - _mem.pricesTs) > PRICE_TTL_MS) {
    const { prices, book } = await fetchPricesAndBook(items);
    _mem.prices = prices; _mem.book = book; _mem.pricesTs = Date.now();
  }

  const regionsStale = !_mem.regions || (Date.now() - _mem.regionsTs) > REGION_TTL_MS;
  let regionsError = null;

  if (regionsStale && !_mem.regions) {
    // Al primo giro si guarda anche in localStorage: dopo un reload la
    // tabella è completa subito, senza aspettare il proxy.
    const key = cacheKey(NS, 'bestRegions', {});
    const cached = cacheGet(key);
    if (cached) { _mem.regions = cached.byItem; _mem.regionsTs = cached.ts; }
  }

  if (!pricesOnly && (force || !_mem.regions || (Date.now() - _mem.regionsTs) > REGION_TTL_MS)) {
    try {
      const byItem = await fetchBestRegions(items);
      _mem.regions = byItem; _mem.regionsTs = Date.now();
      cacheSet(cacheKey(NS, 'bestRegions', {}), { byItem, ts: _mem.regionsTs }, REGION_TTL_MS);
    } catch (err) {
      regionsError = err.message || String(err);
      // Si tiene quello che c'era: una raccomandazione di mezz'ora fa è
      // incomparabilmente meglio di una colonna vuota.
    }
  }

  const regionIds = new Set();
  for (const list of Object.values(_mem.regions || {})) {
    for (const r of list) regionIds.add(r.regionId);
  }
  const regionById = regionIds.size ? await resolveRegions(regionIds) : (state.regionData || {});

  return {
    gameConfig,
    items,
    prices: _mem.prices,
    book: _mem.book,
    regionsByItem: _mem.regions || {},
    regionById,
    pricesTs: _mem.pricesTs,
    regionsTs: _mem.regionsTs,
    regionsError,
  };
}

/** Quanto sono vecchi i prezzi adesso (ms). -1 se non ce ne sono. */
export function priceAgeMs() {
  return _mem.pricesTs ? Date.now() - _mem.pricesTs : -1;
}

/* ── 4. Storico dei prezzi (solo server di cache) ────────────────── */
/* Una candela al giorno per risorsa, da /price-history. È l'unico pezzo
   di questa vista che WarEra non sa dare in nessun modo: `getPrices` è
   il prezzo di adesso, e ieri non esiste da nessuna parte. Quindi qui non
   c'è fallback — se il server non risponde la sezione "andamento" non
   compare, e il resto della tabella non se ne accorge.

   Una sola richiesta per apertura della vista: le candele cambiano una
   volta all'ora, non ogni cinque minuti come i prezzi. */

const HISTORY_TIMEOUT_MS = 4000;
const HISTORY_DAYS = 90;
let _history = null;      // { items, coverageFrom, fetchedAt } | null
let _historyTried = false;
// Quanti giorni copre quello che abbiamo già chiesto. La riga espansa
// delle Rendite ne vuole 90; la scheda Prezzi della sezione Economia
// lascia scegliere fino a "tutto". Si tiene il RAGGIO PIÙ LARGO già
// scaricato: chiedere 30 dopo aver chiesto 365 non deve buttare via
// l'anno per poi ricomprarlo al clic dopo.
let _historyDays = 0;

/**
 * @param {number} days quanti giorni indietro servono (default 90, come
 *   prima). Una richiesta nuova parte solo se si chiede più indietro di
 *   quanto già in mano.
 */
export async function loadPriceHistory(days = HISTORY_DAYS) {
  if (_historyTried && (days <= _historyDays || _history === null)) return _history;
  _historyTried = true;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HISTORY_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/price-history?days=${days}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.items !== 'object') throw new Error('forma inattesa');
    _history = data;
    _historyDays = days;
    return _history;
  } catch (err) {
    // Server vecchio (rotta assente → 404) o VPS giù: nessun grafico,
    // nessun messaggio d'errore. È una sezione in più, non un guasto.
    console.warn('[market] storico prezzi non disponibile:', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Le candele di una risorsa, dal più vecchio: [giorno, o, h, l, c, n].
 *  Array vuoto se lo storico non c'è o quella risorsa non c'era. */
export function priceSeries(code) {
  return _history?.items?.[code] || [];
}

/** Da che giorno l'archivio guarda davvero (stringa YYYY-MM-DD) o null.
 *  Serve a non intitolare "90 giorni" una linea che ne copre dodici. */
export function priceHistoryCoverage() {
  return _history?.coverageFrom || null;
}
