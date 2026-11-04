/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: layer API
   ------------------------------------------------------------------
   Port del `warera/client.py` del bot Discord dell'amico (vedi
   BOT_KNOWLEDGE.md nel repo originale). Il bot parlava direttamente con
   api2.warera.io usando una `X-API-Key` server-side. Qui la key NON può
   stare nel browser (vedi config.js: ECO_PROXY_BASE), quindi ogni chiamata
   passa dal proxy (VPS, poi Worker Cloudflare), che aggiunge lui l'header
   `X-API-Key` server-side. Dalla v0.27 gli endpoint token-gated che
   servono qui sono `work.getStatsByCompany` (produzione e salari giorno
   per giorno) e, dal 2026-10-28, `employee.getCompanyRoster` (la rosa dei
   dipendenti): tutto il resto è pubblico. Tutti e due devono stare
   nell'allowlist del proxy VPS (TRPC_ALLOWED nel cache-server).

   Riuso di `trpcBatchManual` (src/shared/trpcClient.js): stessa politica di
   batching GET + retry-su-429 già usata da Diplomacy, puntata sulla base
   proxy via `workerBaseUrl`. Scelto il batching GET (non `trpcCall`, che è
   POST) apposta perché la route proxy così è un semplice forward della
   query-string — nessun parsing del body lato server.

   Unwrap: api2 risponde `{result:{data:...}}` puro (nessun involucro
   superjson `.json`), e `trpcBatchManual` gestisce già entrambi i casi.
   ══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, ECO_PROXY_BASE } from '../diplomacy/config.js';
import { IS_DEV_BUILD } from '../shared/deployEnv.js';
import { trpcBatchManual, cacheKey, cacheGet, cacheSet } from '../shared/trpcClient.js';

/* ══════════════════════════════════════════════════════════════
   WarEra+ — Interruttore verso il server di prova del gioco
   ------------------------------------------------------------------
   Prima di un aggiornamento WarEra mette la versione nuova su
   apidev.warera.io: un mondo separato (id diversi dal live), con le
   procedure nuove già accese. Per scrivere l'Ottimizzatore della v0.27
   PRIMA del rilascio serviva poterlo puntare lì, e solo lì.

   Si accende con `?api=dev` nell'URL e resta acceso per la scheda
   (sessionStorage; `?api=live` lo spegne). SOLO su build non-live: in
   produzione il parametro è ignorato, quindi un link condiviso per
   sbaglio non porta nessun giocatore sul mondo di prova.

   La chiave di apidev NON è quella del VPS (vale solo sul server di
   prova): la incolla chi sviluppa in un campo che compare solo in questa
   modalità, e resta in MEMORIA — mai localStorage, mai nell'URL. Stessa
   regola della chiave utente di shared/trpcProxy.js. Le chiamate vanno
   dritte ad apidev (CORS `*` con `x-api-key`, verificato il 2026-10-23):
   niente VPS né Worker, che parlano col mondo live.

   Solo l'Ottimizzatore lo segue (e Rendite, che chiede a loadGameData la
   config): mappa e resto del tool restano sul live, perché mescolare due
   mondi con id diversi non avrebbe senso.
   ══════════════════════════════════════════════════════════════ */
const DEV_API_BASE = 'https://apidev.warera.io';
const TARGET_KEY = 'we_eco_api';
const DEV_MAX_BATCH = 50;

function _readTarget() {
  if (!IS_DEV_BUILD) return 'live';
  try {
    const p = new URLSearchParams(location.search).get('api');
    if (p === 'dev' || p === 'live') sessionStorage.setItem(TARGET_KEY, p);
    return sessionStorage.getItem(TARGET_KEY) === 'dev' ? 'dev' : 'live';
  } catch (_) { return 'live'; }
}
const _target = _readTarget();
let _devKey = '';

/** true se l'Ottimizzatore sta parlando con apidev (solo build di prova). */
export function isDevApi() { return _target === 'dev'; }
export function setDevApiKey(key) { _devKey = String(key || '').trim(); }
export function hasDevApiKey() { return Boolean(_devKey); }

async function _devBatch(calls) {
  if (calls.length > DEV_MAX_BATCH) {
    const out = [];
    for (let i = 0; i < calls.length; i += DEV_MAX_BATCH) out.push(...(await _devBatch(calls.slice(i, i + DEV_MAX_BATCH))));
    return out;
  }
  const names = calls.map(([p]) => p).join(',');
  const input = Object.fromEntries(calls.map(([, params], i) => [i, params || {}]));
  const url = `${DEV_API_BASE}/trpc/${names}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, _devKey ? { headers: { 'X-API-Key': _devKey } } : undefined);
      if (res.status === 429) { await new Promise(r => setTimeout(r, 1200 * 2 ** (attempt - 1))); continue; }
      const json = await res.json();
      return json.map(item => {
        if (!item || item.error) {
          if (item?.error) console.warn('[eco/apidev] item error:', item.error.message);
          return null;
        }
        return item.result?.data ?? null;
      });
    } catch (err) {
      console.error('[eco/apidev] batch error:', err);
      return calls.map(() => null);
    }
  }
  return calls.map(() => null);
}

const NS = _target === 'dev' ? 'ecodev' : 'eco';
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
  if (_target === 'dev') return _devBatch(calls);
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

/* WarEra+ v0.27 — quanto vale in monete UN punto produzione, secondo il
   gioco (scambi di materie prime degli ultimi 7 giorni). È la base del
   salario dei dipendenti: paga oraria = Produzione ÷ 4 × questo valore ×
   aspettativa del dipendente (70–130%). Pubblica, ma vuole l'input VUOTO
   (con `{}` risponde 400), quindi niente batch: una GET a parte. Prima
   della v0.27 la procedura non esiste (404) → null, e chi la usa lo sa. */
let _pp = { v: null, ts: 0 };
export async function loadPpMoneyValue() {
  if (_pp.ts && (Date.now() - _pp.ts) < GLOBAL_TTL_MS) return _pp.v;
  const base = _target === 'dev' ? DEV_API_BASE : API_BASE_URL;
  try {
    const res = await fetch(`${base}/trpc/gameStat.getPpMoneyValue`);
    const json = res.ok ? await res.json() : null;
    const v = Number(json?.result?.data);
    _pp = { v: Number.isFinite(v) && v > 0 ? v : null, ts: Date.now() };
  } catch (_) {
    _pp = { v: null, ts: Date.now() };
  }
  return _pp.v;
}

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
