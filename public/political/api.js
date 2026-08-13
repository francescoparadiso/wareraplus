/* ══════════════════════════════════════════════════════════════════
   API — comunicazione diretta con le API ufficiali WarEra (tRPC)
   ------------------------------------------------------------------
   In precedenza tutte le richieste passavano da un Cloudflare Worker
   che faceva da proxy CORS verso un cache-service custom
   (warera-cache.giallorosso.duckdns.org), il quale esponeva path
   "REST-like" (/countries, /election, /party, /user, ...) con
   payload identici a quelli delle procedure tRPC ufficiali.

   Questo file elimina quell'intermediario: `localFetch(path, params)`
   mantiene la stessa firma di prima (nessuna modifica richiesta negli
   altri file dell'app), ma internamente traduce path+params nella
   corrispondente procedure tRPC ufficiale e la invoca in batching,
   secondo il meccanismo descritto in warera-api-batching.md.
   ══════════════════════════════════════════════════════════════════ */

/* ── MAPPA ENDPOINT (vecchio path worker → procedure tRPC ufficiale) ──
   Verificate 1:1 contro la documentazione ufficiale/community:
     - /countries → country.getAllCountries
     - /party     → party.getById
     - /user      → user.getUserLite
   Le altre (election.*, parties-by-country, government) seguono lo
   stesso pattern di naming delle procedure confermate. Se il nome
   reale di una procedure risultasse diverso, va corretto SOLO qui. */
const ENDPOINT_MAP = {
  '/countries':  { proc: 'country.getAllCountries',        params: () => ({}) },
  '/party':      { proc: 'party.getById',                  params: p => ({ partyId: p.id }) },
  '/parties':    { proc: 'party.getManyPaginated',          params: p => ({ countryId: p.countryId, page: p.page || 1, limit: p.limit || 100 }) },
  '/user':       { proc: 'user.getUserLite',                params: p => ({ userId: p.id }) },
  '/election':   { proc: 'election.getElection',            params: p => ({ electionId: p.id }) },
  '/elections':  { proc: 'election.getElections',            params: p => ({ countryId: p.countryId }) },
  '/government': { proc: 'government.getByCountryId',       params: p => ({ countryId: p.countryId }) },
  '/article':    { proc: 'article.getArticleLiteById',       params: p => ({ articleId: p.id }) },
};

/* NB: niente più routing verso gateway.warerastats.io (401 senza key
   propria) — tutte le chiamate passano ora dal Worker proprietario
   (API_BASE, vedi config.js), che aggiunge la API key server-side e
   alza il limite di rate a 500. */

/* ── BATCH CLIENT (porting JS del pattern warera-api-batching.md) ──
   - Fino a MAX_BATCH procedure tRPC in un solo POST (?batch=1)
   - Retry con backoff esponenziale su 429 / 5xx (2s, 4s, 8s)
   - 413 → payload troppo grande (non dovrebbe accadere con MAX_BATCH=50)
   - Risposte item-per-item: unwrap di result.data, null se "error"
   - Fallback a chiamate singole se l'intero batch fallisce
   La coda si auto-raggruppa nel micro-task corrente: tutte le
   localFetch() lanciate nello stesso "giro" (es. Promise.all su una
   lista di utenti) finiscono in un unico POST batch, automaticamente. */
const MAX_BATCH = 50;
const _BACKOFF_BASE = 2000; // ms

let _batchQueue = [];
let _flushScheduled = false;

function _scheduleFlush() {
  if (_flushScheduled) return;
  _flushScheduled = true;
  queueMicrotask(_flushBatchQueue);
}

function _flushBatchQueue() {
  _flushScheduled = false;
  const queue = _batchQueue;
  _batchQueue = [];
  if (!queue.length) return;

  for (let i = 0; i < queue.length; i += MAX_BATCH) {
    _sendBatch(queue.slice(i, i + MAX_BATCH));
  }
}

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _sendBatch(chunk, attempt = 1) {
  const procs = chunk.map(c => c.proc).join(',');
  const body = {};
  chunk.forEach((c, idx) => { body[idx] = c.params; });
  const url = `${API_BASE}/${procs}?batch=1`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    return _fallbackToSingleCalls(chunk, networkErr);
  }

  if (res.status === 429) {
    if (attempt <= 3) {
      const retryAfterHeader = parseFloat(res.headers.get('Retry-After'));
      const waitMs = !isNaN(retryAfterHeader) ? retryAfterHeader * 1000 : _BACKOFF_BASE * Math.pow(2, attempt - 1);
      await _sleep(waitMs);
      return _sendBatch(chunk, attempt + 1);
    }
    return _fallbackToSingleCalls(chunk, new Error('HTTP 429 → rate limit exceeded after retries'));
  }

  if (res.status >= 500) {
    if (attempt <= 3) {
      await _sleep(_BACKOFF_BASE * Math.pow(2, attempt - 1));
      return _sendBatch(chunk, attempt + 1);
    }
    return _fallbackToSingleCalls(chunk, new Error(`HTTP ${res.status} → server error after retries`));
  }

  if (res.status === 413) {
    return _fallbackToSingleCalls(chunk, new Error('HTTP 413 → batch payload too large'));
  }

  if (res.status !== 200 && res.status !== 207) {
    return _fallbackToSingleCalls(chunk, new Error(`HTTP ${res.status} → batch request failed`));
  }

  let results;
  try {
    results = await res.json();
  } catch (parseErr) {
    return _fallbackToSingleCalls(chunk, parseErr);
  }

  chunk.forEach((c, idx) => {
    const item = results[idx];
    if (item && item.result) {
      c.resolve(item.result.data);
    } else {
      // item fallito nel batch (chiave "error") → null, come da doc
      c.resolve(null);
    }
  });
}

/* ── Fallback a chiamate singole (pattern 5 della documentazione) ── */
async function _fallbackToSingleCalls(chunk, cause) {
  console.warn('Batch fallito, fallback a chiamate singole:', cause?.message || cause);
  for (const c of chunk) {
    try {
      const data = await _sendSingle(c.proc, c.params);
      c.resolve(data);
    } catch (err) {
      c.reject(err);
    }
  }
}

async function _sendSingle(proc, params) {
  const url = `${API_BASE}/${proc}?input=${encodeURIComponent(JSON.stringify(params))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} → ${proc}`);
  const json = await res.json();
  if (json && json.result) return json.result.data;
  throw new Error(`Unexpected response shape for ${proc}`);
}

function _callTrpc(proc, params) {
  return new Promise((resolve, reject) => {
    _batchQueue.push({ proc, params, resolve, reject });
    _scheduleFlush();
  });
}

/* ── API (firma invariata rispetto alla versione col Worker) ── */
async function localFetch(path, params = {}, { useCache = true, ttl = null } = {}) {
  const key = cacheKey(path, params);
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  const cleanPath = '/' + path.replace('/api/', '').replace(/^\//, '');
  const mapping = ENDPOINT_MAP[cleanPath];
  if (!mapping) throw new Error(`Nessuna mappatura tRPC per l'endpoint ${cleanPath}`);

  const trpcParams = mapping.params(params);
  let json = await _callTrpc(mapping.proc, trpcParams);

  if (Array.isArray(json)) json = { items: json };
  if (json && !json.items) {
    if (Array.isArray(json.docs))    json.items = json.docs;
    else if (Array.isArray(json.results)) json.items = json.results;
    else if (Array.isArray(json.data))    json.items = json.data;
  }

  if (useCache) {
    const autoTtl = ttl ?? (cleanPath === '/election' ? CACHE_TTL_SHORT : CACHE_TTL_LONG);
    cacheSet(key, json, autoTtl);
  }
  return json;
}

async function loadPartyColors(csvUrl) {
  try {
    const res = await fetch(csvUrl);
    if (!res.ok) throw new Error('CSV not found');
    const text = await res.text();
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const parts = line.split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const id = parts[0];
        const color = parts[parts.length - 1];
        if (id && color) _csvColorMap.set(id, color);
      }
    });
    console.log(`🎨 ${_csvColorMap.size} colors loaded from CSV`);
  } catch (err) {
    console.warn('CSV colors not loaded:', err.message);
  }
}