/* ══════════════════════════════════════════════════════════════
   WarEra+ — Prezzi: layer dati
   ------------------------------------------------------------------
   Due pezzi, due politiche diverse — perché cambiano a ritmi diversi:

   1. PREZZI (`itemTrading.getPrices`) e LIBRO ORDINI
      (`tradingOrder.getTopOrders`, uno per risorsa). Pubblici: rispondono
      da api6 SENZA chiave, quindi non passano dal proxy e non consumano
      il budget del Worker. Sono l'unica cosa che si muove di continuo,
      quindi hanno il TTL più corto (5 minuti) e un aggiornamento
      automatico mentre la scheda è aperta. Le 21 chiamate stanno in un
      solo batch GET (tetto 50, vedi shared/trpcClient.js).

   2. STORICO dal server di cache (`/price-history`), una candela al
      giorno. Senza ripiego: vedi più sotto.

   Il file sta in src/market/ per storia: lo usava anche la vista Rendite
   di produzione, tolta il 2026-10-30 (con i dipendenti la paga non la
   decidi tu e il gioco mostra già il guadagno). Con lei se ne sono andati
   le regioni consigliate, il valore del punto e le formule di rendita; chi
   le cercasse le trova nella storia di git.
   ══════════════════════════════════════════════════════════════ */

import { trpcBatchManual } from '../shared/trpcClient.js';
import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { loadGameData } from '../eco/api.js';

/** Prezzi e libro ordini: quello che si muove. L'utente ha chiesto
 *  esplicitamente "almeno una volta all'ora, più spesso è meglio" — 5
 *  minuti è il compromesso: una richiesta HTTP a giro, pubblica. */
export const PRICE_TTL_MS = 5 * 60 * 1000;

/* Cache di processo: sopravvive alla chiusura dell'overlay (riaprire non
   deve ricominciare da zero) ma non al reload. */
let _mem = { prices: null, book: null, pricesTs: 0 };

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

/**
 * Carica (o rinfresca) prezzi e libro ordini.
 *
 * @param {{ force?: boolean }} opts `force` ignora il TTL (bottone Aggiorna)
 * @returns {Promise<{gameConfig, items, prices, book, pricesTs}>}
 */
export async function loadMarketData({ force = false } = {}) {
  const { gameConfig } = await loadGameData();
  const items = producibleItems(gameConfig);

  if (force || !_mem.prices || (Date.now() - _mem.pricesTs) > PRICE_TTL_MS) {
    const { prices, book } = await fetchPricesAndBook(items);
    _mem.prices = prices; _mem.book = book; _mem.pricesTs = Date.now();
  }
  return { gameConfig, items, prices: _mem.prices, book: _mem.book, pricesTs: _mem.pricesTs };
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
