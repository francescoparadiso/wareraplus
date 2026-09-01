// cacheClient.js
// ══════════════════════════════════════════════════════════════
// WarEra+ — client per il server di cache su VPS esterno
// (warera-oracle.duckdns.org/warera-cache/, vedi WARERA_CACHE_BASE in
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
import { trpcBatch } from './utils.js'; // WarEra+: solo per il fallback di fetchPartiesDetailViaCache

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

// WarEra+: partiti — vedi server/warera-cache-server.js:pollParties.
// Prima Political (src/political/api.js, path '/parties'/'/party') e il
// grafico Parlamento (src/panel/parliamentChart.js) chiamavano il Worker
// direttamente da OGNI browser. Fallback dentro queste funzioni (non al
// chiamante, a differenza di fetchAlliancesViaCache/fetchDiplomacyViaCache
// sopra) perché qui i punti di chiamata sono tre diversi file: centralizzare
// qui evita di triplicare lo stesso try/catch in ognuno.

/** party.getManyPaginated per una nazione — lista "leggera" (non il
 *  dettaglio pieno di ogni partito), stessa forma che ci si aspetta da
 *  ENDPOINT_MAP['/parties'] in political/api.js (json.items). */
export async function fetchPartiesForCountryViaCache(countryId) {
  try {
    const json = await _fetchCacheJson(`/parties?countryId=${encodeURIComponent(countryId)}`);
    if (!Array.isArray(json.data)) throw new Error('cache /parties: forma inattesa');
    return json.data;
  } catch (err) {
    const url = `${WORKER_API_BASE}/trpc/party.getManyPaginated?input=${encodeURIComponent(JSON.stringify({ countryId, page: 1, limit: 100 }))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json())?.result?.data;
    return Array.isArray(raw) ? raw : (raw?.items || raw?.docs || raw?.results || raw?.data || []);
  }
}

/** party.getById in batch — stesso principio di fetchAlliancesViaCache
 *  (il server tiene il dettaglio di TUTTI i partiti conosciuti, qui si
 *  filtra sul sottoinsieme richiesto), ma ritorna una Map partyId->data
 *  invece di un array: entrambi i chiamanti (political/api.js per un
 *  singolo id, parliamentChart.js per un gruppo) vogliono un lookup per
 *  id, non un elenco posizionale. */
export async function fetchPartiesDetailViaCache(partyIds) {
  try {
    const json = await _fetchCacheJson('/parties-detail');
    if (!Array.isArray(json.data)) throw new Error('cache /parties-detail: forma inattesa');
    const byId = new Map(json.data.map(item => [item.partyId, item.data]));
    const missing = partyIds.filter(id => !byId.has(id));
    if (missing.length) throw new Error(`cache /parties-detail: ${missing.length} partiti mancanti`);
    const result = new Map();
    for (const id of partyIds) result.set(id, byId.get(id));
    return result;
  } catch (err) {
    // Fallback: stessa chiamata batch diretta che c'era prima in ogni file.
    const calls = partyIds.map(id => ['party.getById', { partyId: id }]);
    const results = await trpcBatch(calls, { useWorker: true });
    const result = new Map();
    partyIds.forEach((id, i) => { if (results[i]) result.set(id, results[i]); });
    return result;
  }
}

// WarEra+: elezioni — vedi server/warera-cache-server.js:pollElections.
// Stesso principio di parties sopra: la lista per nazione è "leggera"
// (discovery), il dettaglio pieno (candidati/voti/votesStartAt/votesEndAt)
// arriva separatamente. Un'elezione chiusa è immutabile e il server la
// tiene per sempre — un'elezione ancora in candidatura/voto viene
// rinfrescata dal server ogni ~3 minuti, che è la stessa cadenza a cui
// erano già impostati TTL/poll di questo tool: sufficiente perché i
// numeri restino vicini al valore reale in game senza inseguire il
// secondo. Fallback diretto al Worker se il server di cache non risponde,
// stesso schema di fetchPartiesForCountryViaCache/fetchPartiesDetailViaCache.

/** election.getElections per una nazione — array grezzo, stessa forma
 *  attesa da ENDPOINT_MAP['/elections'] in political/api.js (json.items).
 *
 *  WarEra+: `limit` sul fallback diretto. Senza, l'API ne restituisce 10
 *  e basta (5 presidenziali + 5 congressuali) ed era il motivo per cui
 *  Political mostrava solo le ultime dieci elezioni: 100 è il massimo che
 *  accetta (200 → "Number must be less than or equal to 100") e copre
 *  tutta la storia del gioco. Il ramo del server di cache non ha bisogno
 *  del parametro: è il server a tenere lo storico completo, unendo ad ogni
 *  giro quello che già ha (vedi mergeElectionLists nel cache-server). */
export const ELECTIONS_API_MAX_LIMIT = 100;

export async function fetchElectionsForCountryViaCache(countryId) {
  try {
    const json = await _fetchCacheJson(`/elections?countryId=${encodeURIComponent(countryId)}`);
    if (!Array.isArray(json.data)) throw new Error('cache /elections: forma inattesa');
    return json.data;
  } catch (err) {
    const input = JSON.stringify({ countryId, limit: ELECTIONS_API_MAX_LIMIT });
    const url = `${WORKER_API_BASE}/trpc/election.getElections?input=${encodeURIComponent(input)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json())?.result?.data;
    return Array.isArray(raw) ? raw : (raw?.items || raw?.docs || raw?.results || raw?.data || []);
  }
}

/** Come sopra ma per PIÙ nazioni in una richiesta sola: la usa il pannello
 *  alleanza, che disegna il parlamento di ogni membro. Con una richiesta per
 *  nazione un blocco da venti faceva venti round-trip — è il motivo per cui
 *  i congressi comparivano più lentamente di quando la stessa fase passava
 *  da un solo batch tRPC.
 *
 *  Ritorna { countryId: [elezioni] }. Un server vecchio, che `countryIds`
 *  non lo conosce, risponde con un array vuoto (ramo `countryId` mancante):
 *  in quel caso si ricade sulle richieste singole, come prima. */
export async function fetchElectionsForCountriesViaCache(countryIds) {
  if (!countryIds?.length) return {};
  const qs = `countryIds=${encodeURIComponent(countryIds.join(','))}`;
  const json = await _fetchCacheJson(`/elections?${qs}`);
  const data = json?.data;
  if (!data || Array.isArray(data)) throw new Error('cache /elections: countryIds non supportato');
  return data;
}

/** election.getElection — dettaglio pieno di una elezione (candidati,
 *  votes{}, votesCount, votesStartAt/votesEndAt). Chiusa → dato permanente
 *  dalla cache, mai una chiamata a WarEra. Candidatura/voto → l'ultimo dato
 *  che il server ha, aggiornato da lui ogni ~3 minuti. Niente controllo di
 *  staleness via _fetchCacheJson qui: un'elezione chiusa può restare ferma
 *  per mesi nel file e sarebbe scartata come "scaduta" ad ogni richiesta
 *  pur essendo valida per definizione (è immutabile) — uso quindi
 *  _fetchCacheJsonRaw, col fallback diretto solo se il server non risponde
 *  affatto (rete giù, non "dato vecchio"). */
export async function fetchElectionDetailViaCache(electionId) {
  try {
    const json = await _fetchCacheJsonRaw(`/election/${encodeURIComponent(electionId)}`);
    if (json.data) return json.data;
    throw new Error('cache /election: non ancora disponibile'); // mai vista dal server, poll non ancora passato
  } catch (err) {
    const url = `${WORKER_API_BASE}/trpc/election.getElection?input=${encodeURIComponent(JSON.stringify({ electionId }))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json())?.result?.data ?? null;
  }
}

/** Dettagli di PIÙ elezioni in una richiesta (gemello di
 *  fetchElectionsForCountriesViaCache, stesso motivo: un blocco da venti
 *  nazioni chiedeva venti dettagli separati).
 *
 *  Ritorna { electionId: dettaglio } con dentro SOLO quelle che il server
 *  ha già visto. Le mancanti le recupera il chiamante una per una col
 *  percorso singolo, che ha il suo fallback diretto — così un server senza
 *  questo endpoint (404 → oggetto vuoto) si comporta esattamente come
 *  prima, solo senza il risparmio. */
export async function fetchElectionDetailsViaCache(electionIds) {
  if (!electionIds?.length) return {};
  try {
    const qs = `ids=${encodeURIComponent(electionIds.join(','))}`;
    const json = await _fetchCacheJsonRaw(`/elections-detail?${qs}`);
    return (json?.data && typeof json.data === 'object') ? json.data : {};
  } catch (err) {
    return {};
  }
}

/** Nome e avatar di più giocatori in una richiesta (server/warera-cache-server.js:
 *  /users-lite). Sostituisce `user.getUserLite` chiamato per ogni utente e
 *  accorpato in batch da 50: i ~300 eletti di un blocco erano sei richieste
 *  al Worker, ognuna che interroga WarEra dal vivo, e ogni utente arriva
 *  intero (~3,8 KB: skill, ranking, statistiche) per due campi che servono.
 *  Misurato su 36 eletti: 191 KB in 343 ms via Worker contro 5,4 KB in
 *  79 ms da qui.
 *
 *  Ritorna Map(userId → { username, avatarUrl }) con dentro solo quelli che
 *  il server ha saputo risolvere. Lancia se l'endpoint non c'è (deploy non
 *  fatto): il chiamante ricade sulle chiamate dirette di prima.
 *
 *  Nessun timeout corto qui: la prima volta che un parlamento nuovo passa di
 *  qui il server deve andare a chiedere gli utenti a WarEra, e con un tetto
 *  di 300 può metterci qualche secondo. Dalle volte successive è immediato. */
export async function fetchUsersLiteViaCache(userIds) {
  if (!userIds?.length) return new Map();
  const qs = `ids=${encodeURIComponent(userIds.join(','))}`;
  const res = await fetch(`${WARERA_CACHE_BASE}/users-lite?${qs}`);
  if (!res.ok) throw new Error(`cache /users-lite: HTTP ${res.status}`);
  const json = await res.json();
  if (!json?.data || typeof json.data !== 'object') throw new Error('cache /users-lite: forma inattesa');
  return new Map(Object.entries(json.data));
}

/** Censimento cittadini per nazione (server/warera-cache-server.js:
 *  pollCitizens, che pagina user.getUsersByCountry per tutte le nazioni).
 *  È il numero di cittadini di ADESSO — cosa diversa dalla popolazione
 *  ATTIVA di `rankings.countryActivePopulation`, che è quella che il gioco
 *  mette in classifica: misurato, gli iscritti sono ~1,07 volte gli attivi.
 *
 *  Ritorna { countryId: { n, new24h, new7d } }, o null se il server non ha
 *  l'endpoint: chi chiama nasconde il dato invece di fallire. */
let _citizens = null;
let _citizensPromise = null;
export function fetchCitizensViaCache() {
  if (_citizens) return Promise.resolve(_citizens);
  if (_citizensPromise) return _citizensPromise;
  _citizensPromise = _fetchCacheJsonRaw('/citizens')
    .then(json => {
      if (!json?.data || typeof json.data !== 'object') throw new Error('forma inattesa');
      _citizens = json.data;
      return _citizens;
    })
    .catch(err => {
      console.warn('WarEra+ cache: /citizens non disponibile:', err.message);
      _citizensPromise = null; // riprovabile alla prossima apertura
      return null;
    });
  return _citizensPromise;
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

/** Scatto del danno settimanale per nazione preso al cambio giorno di gioco
 *  (02:00 italiane) dal server di cache — vedi snapshotDailyDamage in
 *  server/warera-cache-server.js. Con questo il "danno di oggi", che WarEra
 *  non espone, si ricava per differenza dal settimanale corrente.
 *
 *  Ritorna { takenAt, tz, byCountry } oppure null se il server non ce l'ha
 *  (deploy non fatto, server giù): è un di più, chi chiama nasconde la riga
 *  e non fallisce. */
export async function fetchDailyDamageBaselineViaCache() {
  try {
    const json = await _fetchCacheJsonRaw('/daily-damage');
    if (!json || typeof json.byCountry !== 'object' || !json.takenAt) return null;
    return json;
  } catch (err) {
    console.warn('WarEra+ cache: /daily-damage non disponibile:', err.message);
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════
   WarEra+ — Archivio battaglie e spese di guerra
   ------------------------------------------------------------------
   Calcolati SOLO sul server di cache (server/battleArchive.js): il costo
   di una battaglia sono due chiamate di classifica a battaglia e ~40
   battaglie al giorno, quindi novanta giorni non si ricostruiscono da un
   browser. Come per la time machine, "non c'è chiamata diretta
   equivalente" — ma a differenza sua qui il fallback esiste, ed è una
   FINESTRA RIDOTTA calcolata dal vivo (vedi src/battles/api.js): poche
   pagine di battaglie recenti, con le taglie caricate solo per la riga
   che l'utente apre. Meglio una settimana di dati veri che una schermata
   vuota.

   Le due funzioni qui ritornano `null` quando il server non risponde:
   è il chiamante a decidere se ripiegare, non questo modulo.
   ══════════════════════════════════════════════════════════════ */

/** Righe compatte dell'archivio (chiavi corte, vedi _toRow nel modulo
 *  server). Ritorna { fetchedAt, retentionDays, data: [...] } o null. */
export async function fetchBattleArchiveViaCache() {
  try {
    const json = await _fetchCacheJsonRaw('/battle-archive');
    if (!json || !Array.isArray(json.data)) return null;
    return json;
  } catch (err) {
    console.warn('WarEra+ cache: /battle-archive non disponibile:', err.message);
    return null;
  }
}

/** Contatore visite: { total, today, seed, countedHere }.
 *  `visitorId` è l'identificativo casuale che il browser si è generato da
 *  solo (vedi src/app/visitorCounter.js) e serve al server per non contare
 *  due volte lo stesso browser nello stesso giorno. Passando `count:false`
 *  si legge il numero senza incrementarlo.
 *  Ritorna null se il server non risponde: il contatore semplicemente non
 *  compare, come ogni altra cosa che dipende dal VPS. */
export async function fetchVisitsViaCache(visitorId, { count = true } = {}) {
  try {
    const q = `?id=${encodeURIComponent(visitorId || '')}${count ? '' : '&count=0'}`;
    const json = await _fetchCacheJsonRaw(`/visits${q}`);
    if (!json || !Number.isFinite(json.total)) return null;
    return json;
  } catch (err) {
    console.warn('WarEra+ cache: /visits non disponibile:', err.message);
    return null;
  }
}

/** Serie giornaliera per nazione: { fetchedAt, retentionDays, tz, byDay }
 *  con byDay[YYYY-MM-DD][countryId] = {bounty, contracts, contractCount,
 *  battles}. Ritorna null se il server non ce l'ha. */
export async function fetchWarExpensesViaCache() {
  try {
    const json = await _fetchCacheJsonRaw('/war-expenses');
    if (!json || typeof json.byDay !== 'object') return null;
    return json;
  } catch (err) {
    console.warn('WarEra+ cache: /war-expenses non disponibile:', err.message);
    return null;
  }
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

// ══════════════════════════════════════════════════════════════
// HEATMAP STORICHE PER REGIONE (viste "Regioni contese" e "Intensità
// bellica") — vedi src/diplomacy/contestedHeatmap.js e warIntensityHeatmap.js
// ══════════════════════════════════════════════════════════════

/** {regionId: quante volte ha cambiato padrone}. Il server lo pre-calcola
 *  (/region-history/contested, poche centinaia di righe); se non risponde —
 *  o se non è ancora stato aggiornato con quell'endpoint — lo si conta qui
 *  dallo stesso storico che usa la time machine: ~112 KB gzip di eventi,
 *  UNA volta per sessione, con lo stesso fallback esterno di
 *  fetchRegionHistoryEventsViaCache. Vale la fetch in più: la vista
 *  funziona lo stesso invece di restare grigia in attesa di un deploy. */
let _contestedPromise = null;
export function fetchContestedRegionsViaCache() {
  if (_contestedPromise) return _contestedPromise;
  _contestedPromise = (async () => {
    try {
      const json = await _fetchCacheJsonRaw('/region-history/contested');
      if (!json?.data || typeof json.data !== 'object') throw new Error('forma inattesa');
      return json.data;
    } catch (err) {
      console.warn('[contested] endpoint del server non disponibile, conteggio lato client:', err.message);
      const events = await fetchRegionHistoryEventsViaCache(0, Date.now());
      const counts = {};
      for (const e of events) {
        if (!e?.regionId) continue;
        counts[e.regionId] = (counts[e.regionId] || 0) + 1;
      }
      return counts;
    }
  })();
  _contestedPromise.catch(() => { _contestedPromise = null; }); // riprovabile
  return _contestedPromise;
}

/** {regionId: danno totale storico}. Nessun fallback possibile: il calcolo
 *  vive sulle battaglie risolte del bootstrap, che stanno SOLO sul server di
 *  cache. Rilancia se l'endpoint non c'è — il chiamante mostra la nota
 *  "serve il server aggiornato" invece di una mappa muta. */
let _warIntensityPromise = null;
export function fetchWarIntensityViaCache() {
  if (_warIntensityPromise) return _warIntensityPromise;
  _warIntensityPromise = (async () => {
    const json = await _fetchCacheJsonRaw('/region-history/war-intensity');
    if (!json?.data || typeof json.data !== 'object') throw new Error('cache /region-history/war-intensity: forma inattesa');
    return json.data;
  })();
  _warIntensityPromise.catch(() => { _warIntensityPromise = null; });
  return _warIntensityPromise;
}

// WarEra+: "crediti" statici del tool (userId fisso) — vedi
// server/warera-cache-server.js:pollCreditProfiles (poll ogni 6 ore, un
// solo batch per tutti). Prima ognuno chiamava il Worker separatamente da
// OGNI browser per lo stesso identico dato, per tutti uguale. Mappa
// duplicata qui SOLO per il fallback diretto (se il server di cache non
// risponde) — la fonte di verità resta CREDIT_PROFILES sul server.
const CREDIT_PROFILE_USER_IDS = {
  author: '69d2ed249f38d300d59a2af1', // frappa10 — pill principale (authorPill.js)
  argus:  '69cc14d4efc3f3f4291e93a9', // ArgusIA — credito Ottimizzatore (eco/main.js)
};

async function _fallbackCreditProfile(userId) {
  const url = `${WORKER_API_BASE}/trpc/user.getUserLite?input=${encodeURIComponent(JSON.stringify({ userId }))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json())?.result?.data ?? null;
}

/** user.getUserLite per un "credito" statico del tool — `key` è una delle
 *  chiavi in CREDIT_PROFILE_USER_IDS ('author', 'argus', ...). Ritorna
 *  l'oggetto utente grezzo (già "srotolato", niente involucro
 *  {result:{data:...}}), stessa forma che i chiamanti si aspettavano dalla
 *  chiamata diretta che sostituisce. */
export async function fetchCreditProfileViaCache(key) {
  const userId = CREDIT_PROFILE_USER_IDS[key];
  if (!userId) throw new Error(`credit profile sconosciuto: '${key}'`);
  try {
    const json = await _fetchCacheJson('/credit-profiles');
    const data = json.data?.[key];
    if (!data) throw new Error(`cache /credit-profiles: '${key}' assente`);
    return data;
  } catch (err) {
    return _fallbackCreditProfile(userId);
  }
}