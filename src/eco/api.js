/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: layer API
   ------------------------------------------------------------------
   Port del `warera/client.py` del bot Discord dell'amico (vedi
   BOT_KNOWLEDGE.md nel repo originale). Il bot parlava direttamente con
   api2.warera.io usando una `X-API-Key` server-side. Qui la key NON può
   stare nel browser (vedi config.js: ECO_PROXY_BASE), quindi ogni chiamata
   passa dal Worker Cloudflare (WORKER_API_BASE), che aggiunge lui l'header
   `X-API-Key` server-side (secret Cloudflare). Gli endpoint token-gated
   (worker.getWorkers, transaction.getPaginatedTransactions,
   company.getRecommendedRegionIdsByItemCode) funzionano solo se il worker
   inietta davvero la key — vedi la nota su X-API-Key vs Authorization in
   config.js.

   Riuso di `trpcBatchManual` (src/shared/trpcClient.js): stessa politica di
   batching GET + retry-su-429 già usata da Diplomacy, puntata sulla base
   proxy via `workerBaseUrl`. Scelto il batching GET (non `trpcCall`, che è
   POST) apposta perché la route proxy così è un semplice forward della
   query-string — nessun parsing del body lato server.

   Unwrap: api2 risponde `{result:{data:...}}` puro (nessun involucro
   superjson `.json`), e `trpcBatchManual` gestisce già entrambi i casi.
   ══════════════════════════════════════════════════════════════ */

import { ECO_PROXY_BASE } from '../diplomacy/config.js';
import { trpcBatchManual, cacheKey, cacheGet, cacheSet } from '../shared/trpcClient.js';

const NS = 'eco';
// gameConfig/prezzi cambiano pochissimo e non sono per-utente: 10 min come
// il bot originale (game_data.py: CACHE_TTL_SECONDS = 600).
const GLOBAL_TTL_MS = 10 * 60 * 1000;

/** Errore usato quando il proxy autenticato non risponde (non deployato /
 *  key non impostata / VPS giù). Il chiamante lo distingue per mostrare lo
 *  stato di setup invece di un errore generico. */
export class EcoProxyUnavailableError extends Error {
  constructor(msg) { super(msg); this.name = 'EcoProxyUnavailableError'; }
}

/**
 * Batch di chiamate alla STESSA o a procedure diverse: `calls` è un array di
 * `[procName, params]`. Ritorna un array allineato di risultati (o `null`
 * per la singola chiamata che ha fallito lato tRPC), esattamente come
 * `trpc_batch` del bot.
 */
export async function ecoBatch(calls) {
  if (!calls || !calls.length) return [];
  return trpcBatchManual(calls, { useWorker: true, workerBaseUrl: ECO_PROXY_BASE });
}

/** Singola chiamata tRPC (batch di 1). `null` se ha fallito. */
export async function ecoCall(proc, params) {
  const [out] = await ecoBatch([[proc, params || {}]]);
  return out ?? null;
}

/** Come ecoBatch ma prende un oggetto {chiave: params} e ritorna
 *  {chiave: risultato}, come `trpc_batch(inputs_by_key)` del bot — comodo
 *  per i loop indicizzati per companyId/userId. */
export async function ecoBatchByKey(proc, inputsByKey) {
  const keys = Object.keys(inputsByKey);
  if (!keys.length) return {};
  const results = await ecoBatch(keys.map(k => [proc, inputsByKey[k]]));
  const out = {};
  keys.forEach((k, i) => { out[k] = results[i] ?? null; });
  return out;
}

/* ── Dati globali (gameConfig + prezzi), cache localStorage 10 min ── */
let _mem = null; // cache di processo entro la stessa sessione/run

export async function loadGameData() {
  if (_mem && (Date.now() - _mem.ts) < GLOBAL_TTL_MS) return _mem;

  const gcKey = cacheKey(NS, 'gameConfig', {});
  const prKey = cacheKey(NS, 'prices', {});
  let gameConfig = cacheGet(gcKey);
  let prices = cacheGet(prKey);

  if (!gameConfig || !prices) {
    // Entrambi pubblici: un solo batch li prende insieme.
    const [gc, pr] = await ecoBatch([
      ['gameConfig.getGameConfig', {}],
      ['itemTrading.getPrices', {}],
    ]);
    if (!gc || !pr) {
      throw new EcoProxyUnavailableError('gameConfig/prezzi non raggiungibili tramite il proxy eco');
    }
    gameConfig = gc; prices = pr;
    cacheSet(gcKey, gameConfig, GLOBAL_TTL_MS);
    cacheSet(prKey, prices, GLOBAL_TTL_MS);
  }

  _mem = { gameConfig, prices, ts: Date.now() };
  return _mem;
}
