/* ══════════════════════════════════════════════════════════════
   WarEra+ — Client tRPC unificato (Fase 2)
   ------------------------------------------------------------------
   Prima di questo modulo esistevano DUE implementazioni indipendenti
   dello stesso concetto ("accorpa più procedure tRPC in un solo POST
   per ridurre il rate-limit"):

     - `trpcBatch` in src/diplomacy/utils.js — batching MANUALE (il
       chiamante raccoglie `calls[]` esplicitamente), richiesta GET,
       retry solo su 429, backoff base 1200ms, nessun fallback a
       chiamate singole se il batch intero fallisce.
     - `localFetch` in public/political/api.js — batching AUTOMATICO
       (coda che si auto-flush a `queueMicrotask`, tutte le chiamate
       lanciate nello stesso giro di event loop finiscono in un solo
       POST), retry su 429 E 5xx, backoff base 2000ms, fallback a
       chiamate singole se il batch fallisce completamente.

   Le due policy sono DIVERSE per scelta, non per svista (429-only e
   backoff più corto per Diplomacy, che parla diretto con api6.warera.io
   nella maggior parte dei casi; 429+5xx più aggressivo per Political,
   che passa sempre dal Worker Cloudflare). Unificarle su un'unica
   policy sarebbe un cambio di comportamento non richiesto — questo
   modulo le espone entrambe come funzioni distinte che condividono
   solo le parti davvero comuni (URL building, unwrap dei risultati
   secondo il formato di ciascun lato, cache localStorage namespaced).

   `src/diplomacy/utils.js` NON viene toccato in questa fase (resta
   la sua implementazione locale di `trpcBatch`, come da vincolo
   CLAUDE.md sulle "uniche due modifiche" ammesse a quel modulo) — la
   funzione `trpcBatchManual` qui sotto è lo stesso algoritmo, tenuto
   disponibile per riuso futuro. Chi consuma davvero questo file oggi
   è `src/political/api.js` (Stage 3), tramite `trpcCall`.

   URL BUILDING — nota sul doppio `/trpc`: le basi passate a questo
   modulo (`baseUrl`/`workerBaseUrl`) vanno SEMPRE fornite SENZA
   suffisso `/trpc` finale (comportamento di
   `src/diplomacy/config.js: WORKER_API_BASE`). Il suffisso viene
   aggiunto una sola volta qui, internamente. Il vecchio
   `public/political/config.js: API_BASE` includeva invece `/trpc` già
   nella costante — quel valore viene normalizzato (tolto il suffisso)
   nella conversione a `src/political/config.js` (Stage 2). Se in un
   refactor futuro qualcuno reintroduce una base URL con `/trpc` già
   incluso, il risultato è un `/trpc/trpc/...` rotto: da qui il motivo
   di questo commento esplicito.
   ══════════════════════════════════════════════════════════════ */

import { API_BASE_URL, WORKER_API_BASE } from '../diplomacy/config.js';
import { fetchWithProxyChain } from './trpcProxy.js';
import { trackThrottled } from './analytics.js';

const MAX_BATCH = 50;

/* ── CACHE localStorage, namespaced per evitare collisioni tra Diplomacy
   e Political sotto lo stesso prefisso storico `we_*` ── */
export function cacheKey(namespace, path, params) {
  return `we_${namespace}_${path}_${JSON.stringify(params)}`;
}

export function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
    return data;
  } catch (_) { return null; }
}

export function cacheSet(key, data, ttl) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now(), ttl })); } catch (_) {}
}

/** Di default pulisce solo le chiavi del proprio namespace (`we_<namespace>_`),
 *  non l'intero `we_*` — comportamento visibile invariato rispetto a oggi,
 *  dato che Diplomacy non ha mai scritto cache localStorage: pulire "solo
 *  Political" equivale in pratica a quello che cacheClear() di Political fa
 *  già oggi. Passa `namespace = null` per il vecchio comportamento
 *  "pulisci tutto we_*", se in futuro serve un reset globale esplicito. */
export function cacheClear(namespace) {
  try {
    const prefix = namespace ? `we_${namespace}_` : 'we_';
    Object.keys(localStorage).filter(k => k.startsWith(prefix)).forEach(k => localStorage.removeItem(k));
  } catch (_) {}
}

function _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// WarEra+ perf/robustezza: né _sendAutoBatch né _sendSingle avevano un
// timeout sulla fetch (a differenza di cacheClient.js, che ne usa uno da
// 6s) — una richiesta che resta appesa (rete degradata, worker sovraccarico)
// bloccava l'intera catena a valle: _fallbackToSingleCalls processa il
// chunk in sequenza (un `await` alla volta), quindi un solo item appeso
// blocca tutti quelli dopo di lui nello stesso chunk. Sintomo osservato:
// "Loading counter stuck, forcing reset" in loading.js (il suo timer di
// sicurezza da 15s scatta perché showLoading/hideLoading restano sbilanciati
// per una richiesta mai risolta, non per una vera perdita di riferimento).
const FETCH_TIMEOUT_MS = 8000;
async function _fetchWithTimeout(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function _resolveBase(useWorker, baseUrl, workerBaseUrl) {
  return useWorker ? (workerBaseUrl ?? WORKER_API_BASE) : (baseUrl ?? API_BASE_URL);
}

/* ══════════════════════════════════════════════════════════════
   MODALITÀ MANUALE (stile Diplomacy: src/diplomacy/utils.js trpcBatch)
   GET, retry SOLO su 429, backoff base 1200ms, nessun fallback a
   chiamate singole. Il chiamante raccoglie `calls[]` esplicitamente.
   ══════════════════════════════════════════════════════════════ */
const MANUAL_MAX_RETRY_ATTEMPTS = 3;
const MANUAL_RETRY_BASE_MS = 1200;

export async function trpcBatchManual(calls, { useWorker = false, baseUrl, workerBaseUrl, onRateLimit, _attempt = 1 } = {}) {
  if (!calls || !calls.length) return [];
  if (calls.length > MAX_BATCH) {
    const chunks = [];
    for (let i = 0; i < calls.length; i += MAX_BATCH) chunks.push(calls.slice(i, i + MAX_BATCH));
    const results = [];
    for (const chunk of chunks) results.push(...(await trpcBatchManual(chunk, { useWorker, baseUrl, workerBaseUrl, onRateLimit })));
    return results;
  }

  try {
    const base = _resolveBase(useWorker, baseUrl, workerBaseUrl);
    const procedureNames = calls.map(([proc]) => proc).join(',');
    const batchInput = {};
    calls.forEach(([, params], idx) => { batchInput[idx] = params || {}; });
    const suffix = `/trpc/${procedureNames}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
    // WarEra+ (vedi shared/trpcProxy.js): VPS prima, Worker come rete.
    const res = await fetchWithProxyChain(base, b => `${b}${suffix}`, u => fetch(u));

    if (res.status === 429) {
      if (_attempt <= MANUAL_MAX_RETRY_ATTEMPTS) {
        const retryAfterHeader = parseFloat(res.headers.get('Retry-After'));
        const waitMs = !isNaN(retryAfterHeader) ? retryAfterHeader * 1000 : MANUAL_RETRY_BASE_MS * Math.pow(2, _attempt - 1);
        await _sleep(waitMs);
        return trpcBatchManual(calls, { useWorker, baseUrl, workerBaseUrl, onRateLimit, _attempt: _attempt + 1 });
      }
      if (typeof onRateLimit === 'function') onRateLimit();
      return calls.map(() => null);
    }
    if (!res.ok) throw new Error(`Batch HTTP ${res.status}`);

    const results = await res.json();
    return results.map(item => {
      if (!item || item.error) {
        if (item?.error) console.warn('trpcBatchManual item error:', item.error);
        return null;
      }
      // Unwrap "stile Diplomacy": alcune risposte superjson annidano il
      // payload reale sotto .json, altre no — entrambi i casi coperti.
      return item.result?.data?.json ?? item.result?.data ?? null;
    });
  } catch (err) {
    console.error('trpcBatchManual error:', err);
    return calls.map(() => null);
  }
}

/* ══════════════════════════════════════════════════════════════
   MODALITÀ AUTO-BATCH (stile Political: public/political/api.js)
   POST, coda con auto-flush a queueMicrotask (tutte le trpcCall()
   lanciate nello stesso giro di event loop finiscono in un unico
   POST), retry su 429 E 5xx (backoff base 2000ms), fallback a
   chiamate singole se il batch intero fallisce.
   ══════════════════════════════════════════════════════════════ */
const AUTO_BACKOFF_BASE = 2000;
const AUTO_MAX_RETRY_ATTEMPTS = 3;

// Una coda per combinazione (useWorker, baseUrl, workerBaseUrl) — nella
// pratica oggi Political usa sempre useWorker:true con le basi di default,
// quindi in genere una sola coda attiva. La chiave distingue comunque casi
// futuri con basi diverse, per non mischiare batch destinati a endpoint diversi.
const _queues = new Map(); // queueKey -> { items: [], flushScheduled: bool }

function _queueFor(useWorker, baseUrl, workerBaseUrl) {
  const qKey = `${useWorker ? 'w' : 'd'}:${baseUrl || ''}:${workerBaseUrl || ''}`;
  let q = _queues.get(qKey);
  if (!q) { q = { items: [], flushScheduled: false, useWorker, baseUrl, workerBaseUrl }; _queues.set(qKey, q); }
  return q;
}

function _scheduleFlush(q) {
  if (q.flushScheduled) return;
  q.flushScheduled = true;
  queueMicrotask(() => _flushQueue(q));
}

function _flushQueue(q) {
  q.flushScheduled = false;
  const items = q.items;
  q.items = [];
  if (!items.length) return;
  for (let i = 0; i < items.length; i += MAX_BATCH) {
    _sendAutoBatch(items.slice(i, i + MAX_BATCH), q);
  }
}

async function _sendAutoBatch(chunk, q, attempt = 1) {
  const base = _resolveBase(q.useWorker, q.baseUrl, q.workerBaseUrl);
  const procs = chunk.map(c => c.proc).join(',');
  const body = {};
  chunk.forEach((c, idx) => { body[idx] = c.params; });
  const suffix = `/trpc/${procs}?batch=1`;
  const payload = JSON.stringify(body);

  let res;
  try {
    // WarEra+ (vedi shared/trpcProxy.js): VPS prima, Worker come rete. Il
    // body e' una stringa gia' pronta, quindi rispedirlo sulla seconda base
    // non costa una ri-serializzazione.
    res = await fetchWithProxyChain(base, b => `${b}${suffix}`, u => _fetchWithTimeout(u, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    }));
  } catch (networkErr) {
    return _fallbackToSingleCalls(chunk, base, networkErr);
  }

  if (res.status === 429 || res.status >= 500) {
    if (attempt <= AUTO_MAX_RETRY_ATTEMPTS) {
      const retryAfterHeader = parseFloat(res.headers.get('Retry-After'));
      const waitMs = !isNaN(retryAfterHeader) ? retryAfterHeader * 1000 : AUTO_BACKOFF_BASE * Math.pow(2, attempt - 1);
      await _sleep(waitMs);
      return _sendAutoBatch(chunk, q, attempt + 1);
    }
    // WarEra+ (richiesta esplicita: "controlla soprattutto l'errore 429").
    // Qui SOLO dopo che i retry sono esauriti — è il lato Political dello
    // stesso "l'utente ha davvero sentito il rate limit" già tracciato per
    // Diplomacy in utils.js:showRateLimitTooltip. Nome evento diverso da
    // quello Diplomacy (dashboard separabili: due policy di retry diverse
    // per scelta, vedi commento in testa al file) ma stesso principio di
    // throttle — un rate-limit vero arriva quasi sempre come raffica di
    // richieste parallele che falliscono insieme.
    // 429 e 5xx tracciati separatamente: sono problemi diversi (rate limit
    // lato client vs errore del server), l'utente ha chiesto in particolare
    // il 429.
    trackThrottled(res.status === 429 ? 'rate-limit-429-political' : 'server-error-5xx-political', { status: res.status });
    return _fallbackToSingleCalls(chunk, base, new Error(`HTTP ${res.status} → rate limit/server error after retries`));
  }

  if (res.status === 413) {
    return _fallbackToSingleCalls(chunk, base, new Error('HTTP 413 → batch payload too large'));
  }

  if (res.status !== 200 && res.status !== 207) {
    return _fallbackToSingleCalls(chunk, base, new Error(`HTTP ${res.status} → batch request failed`));
  }

  let results;
  try {
    results = await res.json();
  } catch (parseErr) {
    return _fallbackToSingleCalls(chunk, base, parseErr);
  }

  chunk.forEach((c, idx) => {
    const item = results[idx];
    if (item && item.result) {
      // Unwrap "stile Political": qui NON si sbuccia .json — comportamento
      // storico di public/political/api.js, preservato bit-a-bit.
      c.resolve(item.result.data);
    } else {
      c.resolve(null);
    }
  });
}

async function _fallbackToSingleCalls(chunk, base, cause) {
  console.warn('trpcCall: batch fallito, fallback a chiamate singole:', cause?.message || cause);
  for (const c of chunk) {
    try {
      const data = await _sendSingle(base, c.proc, c.params);
      c.resolve(data);
    } catch (err) {
      c.reject(err);
    }
  }
}

async function _sendSingle(base, proc, params) {
  const suffix = `/trpc/${proc}?input=${encodeURIComponent(JSON.stringify(params))}`;
  // WarEra+ (vedi shared/trpcProxy.js): anche il fallback a chiamate singole
  // passa dalla catena. Se il proxy e' gia' in cooldown, chainFor ritorna
  // solo il Worker e questo e' un normale fetch, come prima.
  const res = await fetchWithProxyChain(base, b => `${b}${suffix}`, u => _fetchWithTimeout(u));
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${proc}`);
  const json = await res.json();
  if (json && json.result) return json.result.data;
  throw new Error(`Unexpected response shape for ${proc}`);
}

/**
 * Chiamata singola auto-accodata: tutte le trpcCall() lanciate nello
 * stesso giro di event loop (es. dentro un Promise.all) finiscono in un
 * unico POST batch, senza che il chiamante debba raccogliere le calls a
 * mano — equivalente a `localFetch`/`_callTrpc` di Political.
 */
export function trpcCall(proc, params, { useWorker = false, baseUrl, workerBaseUrl } = {}) {
  return new Promise((resolve, reject) => {
    const q = _queueFor(useWorker, baseUrl, workerBaseUrl);
    q.items.push({ proc, params, resolve, reject });
    _scheduleFlush(q);
  });
}
