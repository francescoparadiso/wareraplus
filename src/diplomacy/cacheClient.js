// cacheClient.js
// ══════════════════════════════════════════════════════════════
// WarEra+ — client per il server di cache su VPS esterno
// (ampsodrick.duckdns.org/warera-cache/, vedi WARERA_CACHE_BASE in
// config.js). Il server fa lui il poll periodico delle API WarEra e
// risparmia ai browser degli utenti di doverlo fare ognuno per conto suo
// — l'obiettivo è ridurre i 429, non introdurre un punto di fallimento
// nuovo: OGNI funzione qui sotto, se il server di cache non risponde, non
// risponde in tempo, o i dati sono troppo vecchi, ricade sulla stessa
// identica chiamata diretta usata prima di questo modulo. Il resto
// dell'app non deve accorgersi della differenza — stessa forma di ritorno
// della chiamata diretta che sostituisce, in ogni funzione.
//
// Forma delle risposte del server di cache (verificata dal vivo contro gli
// endpoint pubblici, non assunta):
//   /countries, /map, /regions → { fetchedAt, data: <risposta grezza WarEra,
//     stesso involucro {result:{data:...}} che avrebbe la chiamata diretta> }
//   /battles   → { fetchedAt, data: [ ...battle grezze, isActive:true... ] }
//   /alliances → { fetchedAt, data: [ { allianceId, data: <alleanza grezza> } ] }
//   /diplomacy → { fetchedAt, data: [ { countryId, data: <diplomazia grezza> } ] }
// ══════════════════════════════════════════════════════════════

import { WARERA_CACHE_BASE, WORKER_API_BASE } from './config.js';

// Oltre questa età il dato in cache è considerato inaffidabile (server
// bloccato/pm2 giù ma ancora raggiungibile via nginx con l'ultimo file
// scritto su disco) — meglio la chiamata diretta che dati vecchi silenziosi.
// Generoso rispetto ai poll (3-10 min dichiarati) per non scartare dati
// buoni per un solo ciclo di poll saltato.
const MAX_STALENESS_MS = 20 * 60 * 1000; // 20 minuti

// Timeout breve: se il VPS è giù/lento, meglio fallire rapido e ricadere
// sulla chiamata diretta piuttosto che far aspettare l'utente il timeout
// di rete di default del browser.
const FETCH_TIMEOUT_MS = 3000;

// Circuit breaker: se una chiamata al server di cache fallisce per timeout/
// rete (server giù o irraggiungibile), le chiamate successive entro questa
// finestra saltano direttamente la fetch e vanno al fallback — altrimenti
// ogni endpoint (countries+map, alleanze, diplomazia, regions, battles,
// ticker...) paga il suo FETCH_TIMEOUT_MS pieno in sequenza, fino a
//30s+ persi solo in attese quando il VPS è giù. Non scatta per errori
// applicativi (404, dato scaduto, forma inattesa): solo per "il server non
// ha risposto affatto", il segnale che indica VPS giù piuttosto che un
// singolo endpoint con un problema transitorio.
const CIRCUIT_BREAKER_MS = 2 * 60 * 1000; // 2 minuti
let _circuitOpenUntil = 0;

function _isNetworkFailure(err) {
  return err?.name === 'AbortError' || err instanceof TypeError;
}

function _circuitOpen() {
  return Date.now() < _circuitOpenUntil;
}

function _tripCircuit() {
  _circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_MS;
}

async function _fetchCacheJson(path) {
  if (_circuitOpen()) throw new Error('cache: circuit breaker aperto (server irraggiungibile di recente)');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
    const json = await res.json();
    if (typeof json.fetchedAt === 'number' && (Date.now() - json.fetchedAt) > MAX_STALENESS_MS) {
      throw new Error(`cache dato scaduto (${Math.round((Date.now() - json.fetchedAt) / 1000)}s)`);
    }
    return json;
  } catch (err) {
    if (_isNetworkFailure(err)) _tripCircuit();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Come _fetchCacheJson, ma per gli endpoint che NON hanno equivalente
// diretto su WarEra (ticker storico, storico regioni: sono calcolati SUL
// server di cache, non esiste una "chiamata diretta" a cui ricadere) —
// niente controllo di freschezza `fetchedAt` (questi endpoint non lo
// espongono, la risposta è già filtrata/elaborata), il chiamante decide lui
// cosa fare se il server non risponde (per il ticker: niente eventi extra;
// per la time machine: mostrare che non è disponibile, non una mappa vuota).
async function _fetchCacheJsonRaw(path) {
  if (_circuitOpen()) throw new Error('cache: circuit breaker aperto (server irraggiungibile di recente)');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (_isNetworkFailure(err)) _tripCircuit();
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/** country.getAllCountries — ritorna l'array nazioni, stessa forma di
 *  `(await fetch(...)).json().result.data` che sostituisce. */
export async function fetchCountriesViaCache() {
  const json = await _fetchCacheJson('/countries');
  const arr = json.data?.result?.data;
  if (!Array.isArray(arr)) throw new Error('cache /countries: forma inattesa');
  return arr;
}

/** map.getMapData — ritorna l'oggetto { map, countryLabels, ... }, stessa
 *  forma di `(await fetch(...)).json().result.data`. */
export async function fetchMapDataViaCache() {
  const json = await _fetchCacheJson('/map');
  const data = json.data?.result?.data;
  if (!data?.map) throw new Error('cache /map: forma inattesa');
  return data;
}

/** region.getRegionsObject — ritorna l'oggetto {regionId: region}, stessa
 *  forma di quanto ritorna la fetch diretta in regions.js. */
export async function fetchRegionsViaCache() {
  const json = await _fetchCacheJson('/regions');
  const data = json.data?.result?.data ?? json.data;
  if (!data || typeof data !== 'object') throw new Error('cache /regions: forma inattesa');
  return data;
}

/** battle.getBattles({isActive:true}) — il server di cache pagina già lui
 *  lato suo, quindi qui basta UNA fetch invece della paginazione a cursore
 *  che fa fetchActiveBattles() in battleHeatmap.js. Ritorna l'array di
 *  battaglie grezze, stessa forma degli `items` che quella funzione
 *  accumula. */
export async function fetchActiveBattlesViaCache() {
  const json = await _fetchCacheJson('/battles');
  if (!Array.isArray(json.data)) throw new Error('cache /battles: forma inattesa');
  return json.data;
}

/** alliance.getById in batch — filtra sul sottoinsieme di allianceId
 *  richiesti (il server tiene la cache di TUTTE le alleanze), ritorna
 *  l'array di alleanze grezze nello stesso ordine/forma di
 *  `trpcBatch(calls).filter(Boolean)` in main.js. */
export async function fetchAlliancesViaCache(allianceIds) {
  const json = await _fetchCacheJson('/alliances');
  if (!Array.isArray(json.data)) throw new Error('cache /alliances: forma inattesa');
  const wanted = new Set(allianceIds);
  const byId = new Map(json.data.map(item => [item.allianceId, item.data]));
  // Se anche solo un id richiesto manca dalla cache, meglio ricadere sulla
  // chiamata diretta per QUEL sottoinsieme piuttosto che restituire un
  // elenco incompleto silenzioso (es. alleanza appena creata, poll non
  // ancora passato).
  const missing = allianceIds.filter(id => wanted.has(id) && !byId.has(id));
  if (missing.length) throw new Error(`cache /alliances: ${missing.length} alleanze mancanti`);
  return allianceIds.map(id => byId.get(id)).filter(Boolean);
}

/** countryDiplomacy.getByCountry in batch — stesso principio di
 *  fetchAlliancesViaCache: filtra sul sottoinsieme richiesto, fallisce (e
 *  fa ricadere il chiamante sulla via diretta) se manca qualcosa. Ritorna
 *  una Map countryId -> { swornEnemy, defensivePacts }, già nella forma
 *  che main.js scrive in state.diplomacyData. */
export async function fetchDiplomacyViaCache(countryIds) {
  const json = await _fetchCacheJson('/diplomacy');
  if (!Array.isArray(json.data)) throw new Error('cache /diplomacy: forma inattesa');
  const byId = new Map(json.data.map(item => [item.countryId, item.data]));
  const missing = countryIds.filter(id => !byId.has(id));
  if (missing.length) throw new Error(`cache /diplomacy: ${missing.length} nazioni mancanti`);

  const result = new Map();
  for (const id of countryIds) {
    const data = byId.get(id);
    if (!data) continue;
    result.set(id, {
      swornEnemy: data.swornEnemy?.enemy || null,
      defensivePacts: (data.defensivePacts || []).map(p => p.partner),
    });
  }
  return result;
}

// ══════════════════════════════════════════════════════════════
// Endpoint SENZA equivalente diretto — calcolati sul server di cache
// (storico ticker guerre/sworn enemy/popolazione/tesoro, storico ownership
// regioni per la time machine). Nessun fallback possibile: se il server
// non risponde, questi due "extra" semplicemente non sono disponibili
// (non è mai stato possibile prima di questo server, quindi non è una
// regressione — a differenza degli endpoint sopra, che avevano già un
// percorso diretto da prima).
// ══════════════════════════════════════════════════════════════

/** Eventi ticker (guerre/sworn enemy/popolazione/tesoro/elezioni) accaduti
 *  da `sinceTs` in poi. Ogni evento ha { id, category, timestamp,
 *  countryId, ...dettagli specifici della categoria } — vedi
 *  server/warera-cache-server.js:pollTickerEvents per lo schema esatto
 *  per categoria. I nomi nazione NON sono inclusi: si risolvono lato
 *  client via state.nationMap (il server tiene solo gli id). */
export async function fetchTickerEventsViaCache(sinceTs) {
  const json = await _fetchCacheJsonRaw(`/ticker?since=${encodeURIComponent(sinceTs)}`);
  if (!Array.isArray(json)) throw new Error('cache /ticker: forma inattesa');
  return json;
}

/** Versione AGGREGATA del ticker: gli eventi puntuali (guerre/sworn) tali e
 *  quali da `sinceTs`, e per ogni finestra in `windowTs` la somma già fatta
 *  per nazione di popolazione e tesoro.
 *
 *  Serve a non scaricare più lo storico grezzo: il client aggregava migliaia
 *  di eventi per mostrarne una decina, e con la ritenzione server a 14 giorni
 *  quello scarico era arrivato a 1,4 MB ogni 5 minuti (su rete mobile, la
 *  voce più cara del tool). Qui l'aggregazione la fa il server e la risposta
 *  sta in pochi KB.
 *
 *  Ritorna { now, oldestEvent, punctual: [...], aggregates: { <ts>:
 *  { population: {countryId: delta}, wealth: {countryId: pct} } } }.
 *  Lancia se il server non ha ancora l'endpoint (deploy non fatto): il
 *  chiamante ricade su fetchTickerEventsViaCache. */
export async function fetchTickerSummaryViaCache(sinceTs, windowTs) {
  const windows = windowTs.filter(w => Number.isFinite(w) && w > 0);
  const qs = `since=${encodeURIComponent(sinceTs)}&windows=${encodeURIComponent(windows.join(','))}`;
  const json = await _fetchCacheJsonRaw(`/ticker/summary?${qs}`);
  if (!json || !Array.isArray(json.punctual) || !json.aggregates) {
    throw new Error('cache /ticker/summary: forma inattesa');
  }
  return json;
}

// ══════════════════════════════════════════════════════════════
// FALLBACK time machine — sorgente esterna spywarera.com (via worker)
// ------------------------------------------------------------------
// Lo storico ownership è calcolato SOLO dal server di cache: se quello è giù,
// la time machine era inutilizzabile (nessun percorso diretto). spywarera.com
// espone lo STESSO dato (initialOwnership + events), ma senza header CORS —
// il browser non può leggerla direttamente. Passa quindi dal worker Cloudflare
// (route /timemachine/events, passthrough + CORS + cache edge 5 min). Da quei
// dati ricostruiamo qui range/at/events con lo stesso replay che fa il server
// (genesi + eventi ordinati per ts), così i tre metodi sotto degradano da soli
// come tutti gli altri di questo file. Scaricato UNA sola volta per sessione
// (~1,3MB) e tenuto in memoria; se anche il worker è giù, il metodo rilancia e
// il chiamante (timeMachine.js) mostra il toast "server storico offline".
const EXTERNAL_HISTORY_URL = `${WORKER_API_BASE}/timemachine/events`;
const EXTERNAL_HISTORY_TIMEOUT_MS = 30000; // ~1,3MB e cresce, margine largo
// Genesi: stessa costante del server (1 maggio 2025) — vedi GENESIS_TS in
// server/warera-cache-server.js.
const FALLBACK_GENESIS_TS = Date.UTC(2025, 4, 1);

let _externalHistoryPromise = null;
function _loadExternalHistory() {
  if (_externalHistoryPromise) return _externalHistoryPromise;
  _externalHistoryPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EXTERNAL_HISTORY_TIMEOUT_MS);
    try {
      const res = await fetch(EXTERNAL_HISTORY_URL, { signal: controller.signal });
      if (!res.ok) throw new Error(`fallback storico HTTP ${res.status}`);
      const data = await res.json();
      if (!data || typeof data.initialOwnership !== 'object' || !Array.isArray(data.events)) {
        throw new Error('fallback storico: formato inatteso (initialOwnership/events)');
      }
      // spywarera non garantisce l'ordine: normalizziamo ts e ordiniamo qui.
      const events = data.events
        .map(e => ({ ts: Date.parse(e.ts), regionId: e.regionId, toCountry: e.toCountry }))
        .filter(e => Number.isFinite(e.ts) && e.regionId)
        .sort((a, b) => a.ts - b.ts);
      console.warn(`[region-history] fallback spywarera attivo: ${events.length} eventi caricati (server di cache non disponibile)`);
      return { initialOwnership: data.initialOwnership, events };
    } finally {
      clearTimeout(timeout);
    }
  })();
  // Se il caricamento fallisce, azzera la promise così un tentativo successivo
  // (es. l'utente riapre la time machine) riprova invece di riusare l'errore.
  _externalHistoryPromise.catch(() => { _externalHistoryPromise = null; });
  return _externalHistoryPromise;
}

async function _fallbackRange() {
  await _loadExternalHistory(); // garantisce che i dati siano disponibili
  // max = adesso: _fallbackAt(now) rigioca tutti gli eventi e dà lo stato
  // corrente, coerente con range.max ~ "oggi" del server.
  return { min: FALLBACK_GENESIS_TS, max: Date.now() };
}
async function _fallbackAt(ts) {
  const { initialOwnership, events } = await _loadExternalHistory();
  const regions = { ...initialOwnership };
  for (const e of events) {
    if (e.ts > ts) break; // eventi ordinati per ts
    regions[e.regionId] = e.toCountry;
  }
  return { requestedTs: ts, baseTs: FALLBACK_GENESIS_TS, regions };
}
async function _fallbackEvents(sinceTs, untilTs) {
  const { events } = await _loadExternalHistory();
  return events
    .filter(e => e.ts >= sinceTs && e.ts <= untilTs)
    .map(e => ({ ts: e.ts, regionId: e.regionId, toCountry: e.toCountry }));
}

/** Range temporale coperto dallo storico ownership regioni — { min, max }
 *  in epoch ms. `min` è la genesi (1 maggio 2025), `max` è il momento più
 *  recente conosciuto (~adesso). Fallback su spywarera se la cache è giù. */
export async function fetchRegionHistoryRangeViaCache() {
  try {
    const json = await _fetchCacheJsonRaw('/region-history/range');
    if (json.min == null || json.max == null) throw new Error('cache /region-history/range: nessuno storico ancora disponibile');
    return json;
  } catch (err) {
    console.warn('[region-history] range dal server di cache non disponibile, fallback spywarera:', err.message);
    return _fallbackRange();
  }
}

/** Ricostruzione server-side dell'ownership delle regioni a un istante
 *  `ts` (epoch ms). Ritorna { requestedTs, baseTs, regions: {regionId:
 *  countryId} } — tutto il lavoro di keyframe+replay lo fa il server,
 *  qui non c'è altro che una fetch. */
export async function fetchRegionHistoryAtViaCache(ts) {
  try {
    const json = await _fetchCacheJsonRaw(`/region-history/at?ts=${encodeURIComponent(ts)}`);
    if (!json.regions) throw new Error('cache /region-history/at: forma inattesa');
    return json;
  } catch (err) {
    return _fallbackAt(ts);
  }
}

/** Tutti gli eventi di trasferimento regione fra `sinceTs` e `untilTs`
 *  (epoch ms, entrambi inclusi) — { ts, regionId, toCountry }[], NON
 *  ordinato per garanzia del server (va ordinato lato chiamante). Usata da
 *  timeMachine.js per "salta al prossimo/precedente evento" e per "di
 *  chi è questa regione dal —" nel popup di click: una sola fetch per
 *  sessione (l'intero storico, ~1-2MB), non una per interazione. */
export async function fetchRegionHistoryEventsViaCache(sinceTs, untilTs) {
  try {
    const json = await _fetchCacheJsonRaw(`/region-history/events?since=${encodeURIComponent(sinceTs)}&until=${encodeURIComponent(untilTs)}`);
    if (!Array.isArray(json)) throw new Error('cache /region-history/events: forma inattesa');
    return json;
  } catch (err) {
    return _fallbackEvents(sinceTs, untilTs);
  }
}
