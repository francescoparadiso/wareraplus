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

import { WARERA_CACHE_BASE } from './config.js';

// Oltre questa età il dato in cache è considerato inaffidabile (server
// bloccato/pm2 giù ma ancora raggiungibile via nginx con l'ultimo file
// scritto su disco) — meglio la chiamata diretta che dati vecchi silenziosi.
// Generoso rispetto ai poll (3-10 min dichiarati) per non scartare dati
// buoni per un solo ciclo di poll saltato.
const MAX_STALENESS_MS = 20 * 60 * 1000; // 20 minuti

// Timeout breve: se il VPS è giù/lento, meglio fallire rapido e ricadere
// sulla chiamata diretta piuttosto che far aspettare l'utente il timeout
// di rete di default del browser.
const FETCH_TIMEOUT_MS = 6000;

async function _fetchCacheJson(path) {
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
    return await res.json();
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

/** Range temporale coperto dallo storico ownership regioni — { min, max }
 *  in epoch ms. `min` è sempre 0 (sentinella "genesi/inizio del mondo",
 *  non una vera data — vedi commento in region-history-keyframes lato
 *  server), `max` è il momento più recente conosciuto (~adesso). */
export async function fetchRegionHistoryRangeViaCache() {
  const json = await _fetchCacheJsonRaw('/region-history/range');
  if (json.min == null || json.max == null) throw new Error('cache /region-history/range: nessuno storico ancora disponibile');
  return json;
}

/** Ricostruzione server-side dell'ownership delle regioni a un istante
 *  `ts` (epoch ms). Ritorna { requestedTs, baseTs, regions: {regionId:
 *  countryId} } — tutto il lavoro di keyframe+replay lo fa il server,
 *  qui non c'è altro che una fetch. */
export async function fetchRegionHistoryAtViaCache(ts) {
  const json = await _fetchCacheJsonRaw(`/region-history/at?ts=${encodeURIComponent(ts)}`);
  if (!json.regions) throw new Error('cache /region-history/at: forma inattesa');
  return json;
}
