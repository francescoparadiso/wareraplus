/* ══════════════════════════════════════════════════════════════════
   WarEra+ — Political View: api.js come modulo ES (Fase 2, Stage 3)
   ------------------------------------------------------------------
   Conversione di public/political/api.js. `localFetch(path, params, opts)`
   mantiene la stessa firma e lo stesso comportamento esterno (stesso
   ENDPOINT_MAP, stessa normalizzazione items/docs/results/data, stesso
   TTL automatico per-endpoint) — ma il batching/retry/coda a
   queueMicrotask e il fallback a chiamate singole ora vivono in
   src/shared/trpcClient.js (trpcCall, modalità "auto-batch", condivisa
   col resto dell'app), invocato qui con { useWorker: true } per
   riprodurre bit-per-bit il comportamento originale (Political passa
   sempre dal Worker Cloudflare, mai diretto su api6.warera.io).

   Cache: usa cacheKey/cacheGet/cacheSet di trpcClient.js con
   namespace 'pol' → chiavi we_pol_<path>_<params> invece di
   we_<path>_<params>. Cambio di chiave visibile solo come "reset
   cache atteso una tantum" al primo caricamento post-conversione
   (repopolata automaticamente, TTL breve comunque) — non un bug.

   loadPartyColors invariata (fetch diretto del CSV, non passa da tRPC),
   ma scrive ora sulla Map esportata da config.js invece che sulla
   variabile bare _csvColorMap.
   ══════════════════════════════════════════════════════════════════ */

import { trpcCall, cacheKey, cacheGet, cacheSet } from '../shared/trpcClient.js';
import { CACHE_TTL_SHORT, CACHE_TTL_LONG, csvColorMap } from './config.js';
import { showLoading, hideLoading } from './loading.js';
import { fetchPartiesForCountryViaCache, fetchPartiesDetailViaCache, fetchElectionsForCountryViaCache, fetchElectionDetailViaCache } from '../diplomacy/cacheClient.js';

const CACHE_NAMESPACE = 'pol';

/* ── MAPPA ENDPOINT (vecchio path worker → procedure tRPC ufficiale) ──
   Copiata invariata da public/political/api.js. */
const ENDPOINT_MAP = {
  '/countries':  { proc: 'country.getAllCountries',        params: () => ({}) },
  '/party':      { proc: 'party.getById',                  params: p => ({ partyId: p.id }) }, // WarEra+: bypassato in _localFetchImpl, vedi sotto — lasciato solo come riferimento
  '/parties':    { proc: 'party.getManyPaginated',          params: p => ({ countryId: p.countryId, page: p.page || 1, limit: p.limit || 100 }) }, // idem
  '/user':       { proc: 'user.getUserLite',                params: p => ({ userId: p.id }) },
  '/election':   { proc: 'election.getElection',            params: p => ({ electionId: p.id }) },
  '/elections':  { proc: 'election.getElections',            params: p => ({ countryId: p.countryId }) },
  '/government': { proc: 'government.getByCountryId',       params: p => ({ countryId: p.countryId }) },
  '/article':    { proc: 'article.getArticleLiteById',       params: p => ({ articleId: p.id }) },
};

/* ── API (firma invariata rispetto all'originale) ──
   showLoading/hideLoading chiamate esplicitamente qui al posto del
   monkey-patch di window.localFetch dell'originale (vedi loading.js) —
   stesso comportamento visibile (loader mostrato per l'intera durata
   della chiamata, cache-hit incluso, esattamente come prima). */
export async function localFetch(path, params = {}, { useCache = true, ttl = null } = {}) {
  showLoading(`Fetching ${path}...`);
  try {
    return await _localFetchImpl(path, params, { useCache, ttl });
  } finally {
    hideLoading();
  }
}

async function _localFetchImpl(path, params, { useCache, ttl }) {
  const key = cacheKey(CACHE_NAMESPACE, path, params);
  if (useCache) {
    const cached = cacheGet(key);
    if (cached) return cached;
  }

  const cleanPath = '/' + path.replace('/api/', '').replace(/^\//, '');

  // WarEra+: partiti ed elezioni serviti dalla cache Oracle invece che dal
  // Worker — vedi server/warera-cache-server.js:pollParties/pollElections
  // e cacheClient.js. Bypassa ENDPOINT_MAP/trpcCall SOLO per questi
  // quattro path, tutto il resto della funzione (normalizzazione items,
  // cache locale, TTL) invariato.
  let json;
  if (cleanPath === '/parties') {
    json = { items: await fetchPartiesForCountryViaCache(params.countryId) };
  } else if (cleanPath === '/party') {
    const detailMap = await fetchPartiesDetailViaCache([params.id]);
    json = detailMap.get(params.id) || null;
  } else if (cleanPath === '/elections') {
    json = { items: await fetchElectionsForCountryViaCache(params.countryId) };
  } else if (cleanPath === '/election') {
    json = await fetchElectionDetailViaCache(params.id);
  } else {
    const mapping = ENDPOINT_MAP[cleanPath];
    if (!mapping) throw new Error(`Nessuna mappatura tRPC per l'endpoint ${cleanPath}`);
    const trpcParams = mapping.params(params);
    json = await trpcCall(mapping.proc, trpcParams, { useWorker: true });
  }

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

export async function loadPartyColors(csvUrl) {
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
        if (id && color) csvColorMap.set(id, color);
      }
    });
    console.log(`🎨 ${csvColorMap.size} colors loaded from CSV`);
  } catch (err) {
    console.warn('CSV colors not loaded:', err.message);
  }
}