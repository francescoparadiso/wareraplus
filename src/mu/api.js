/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: accesso ai dati
   ------------------------------------------------------------------
   Divisione server/client identica a quella già scelta per
   Alleanze vs Partiti (vedi src/diplomacy/cacheClient.js):

     · DIRECTORY (tutte le MU) → server di cache, endpoint
       /mu-directory, poll ogni 30 min (server/warera-cache-server.js:
       pollMuDirectory). Cambia lentamente, serve tutta insieme per
       cercare/ordinare, e scaricarla da ogni browser sarebbe lo stesso
       traffico moltiplicato per tutti gli utenti. Fallback: paginazione
       diretta da qui, come faceva Diplomacy per le battaglie prima del
       server di cache.
     · DETTAGLIO di UNA unità → chiamata diretta on-demand. I membri
       entrano ed escono di continuo: meglio il dato vivo di una copia
       server vecchia fino a mezz'ora, e comunque è una chiamata sola,
       fatta solo per l'unità che l'utente apre davvero.
     · CLASSIFICHE → nessuna chiamata. Verificato dal vivo che ogni MU
       porta con sé le proprie `rankings` (value/rank/tier per i sei
       tipi mu*): la classifica si ordina dalla directory già in memoria,
       quindi ranking.getRanking non serve affatto.

   La directory sta in memoria per la sessione (~550 KB di JSON): NON in
   localStorage, dove occuperebbe da sola un decimo abbondante della quota
   e verrebbe riscritta ad ogni apertura della vista.
   ══════════════════════════════════════════════════════════════ */

import { trpcCall } from '../shared/trpcClient.js';
import { WARERA_CACHE_BASE, API_BASE_URL } from '../diplomacy/config.js';

/** I sei tipi di classifica MU, nell'ordine in cui li mostriamo. Le chiavi
 *  sono anche chiavi i18n (vedi src/mu/i18n.js). */
export const MU_RANKING_TYPES = ['muWeeklyDamages', 'muDamages', 'muTerrain', 'muWealth', 'muBounty', 'muReputation'];

const CACHE_TIMEOUT_MS = 8000; // più generoso dei 3s di cacheClient: ~140 KB gzip, non un JSON da 2 KB

let _directory = null;      // array delle MU, forma "lean" del server
let _directoryPromise = null;
let _fetchedAt = null;

/** Quando la directory in memoria è stata scaricata (epoch ms), o null. */
export function directoryFetchedAt() {
  return _fetchedAt;
}

/** La directory se è già in memoria, altrimenti null — per i consumatori
 *  che NON devono provocare una fetch (ricerca globale della barra menù:
 *  vedi src/app/desktopMenuBar.js). */
export function getCachedDirectory() {
  return _directory;
}

/** Lookup O(1) di una singola MU nella directory in memoria, se c'è. Usata
 *  dai preferiti per ridisegnare nome/avatar di un pin senza rifetchare. */
export function getCachedMu(muId) {
  return _directory?.find(m => m._id === muId) || null;
}

/** Directory completa. Una sola fetch per sessione: le chiamate successive
 *  (e quelle concorrenti) riusano la stessa promise. */
export function fetchMuDirectory() {
  if (_directory) return Promise.resolve(_directory);
  if (_directoryPromise) return _directoryPromise;
  _directoryPromise = (async () => {
    try {
      const json = await _fetchCacheJson('/mu-directory');
      if (!Array.isArray(json.data) || !json.data.length) throw new Error('cache /mu-directory: forma inattesa o vuota');
      _directory = json.data;
      _fetchedAt = json.fetchedAt ?? Date.now();
    } catch (err) {
      console.warn('WarEra+ mu: directory dal server di cache non disponibile, paginazione diretta:', err.message);
      _directory = await _fetchAllMusDirect();
      _fetchedAt = Date.now();
    }
    return _directory;
  })();
  // Se fallisce anche il fallback, azzera la promise: un nuovo tentativo
  // (l'utente riapre la vista o preme "Riprova") deve riprovare davvero,
  // non riusare l'errore.
  _directoryPromise.catch(() => { _directoryPromise = null; });
  return _directoryPromise;
}

async function _fetchCacheJson(path) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CACHE_TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`cache HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** Fallback: la stessa paginazione a cursore che fa il server, ma da qui.
 *  ~14 richieste in fila (1400 MU a pagine da 100) — sotto il limite di
 *  100/min di api6, ma è comunque il percorso peggiore: si fa solo se il
 *  server di cache non risponde. Proietta sugli stessi campi del server
 *  così il resto del modulo non deve sapere da dove arriva il dato. */
async function _fetchAllMusDirect() {
  const all = [];
  let cursor;
  let guard = 0;
  do {
    const input = { limit: 100, ...(cursor ? { cursor } : {}) };
    const url = `${API_BASE_URL}/trpc/mu.getManyPaginated?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (res.status === 429) { console.warn('mu.getManyPaginated: 429, mi fermo con quello che ho'); break; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.result?.data?.items || [];
    all.push(...items.map(leanMu));
    cursor = data?.result?.data?.nextCursor || null;
    guard++;
  } while (cursor && guard < 100);
  if (!all.length) throw new Error('mu.getManyPaginated: nessuna unità');
  return all;
}

/** Stessa proiezione di server/warera-cache-server.js:leanMu — se cambia
 *  una delle due, va cambiata anche l'altra (sono la stessa forma vista da
 *  due lati). */
export function leanMu(m) {
  const out = {
    _id: m._id,
    name: m.name,
    country: m.country,
    region: m.region,
    memberCount: Array.isArray(m.members) ? m.members.length : 0,
    level: m.leveling?.level ?? 1,
    monthlyDamages: m.leveling?.monthlyDamages ?? 0,
    reputation: m.mercenaryReputation ?? 0,
    createdAt: m.createdAt,
  };
  if (m.avatarUrl) out.avatarUrl = m.avatarUrl;
  const rankings = {};
  for (const type of MU_RANKING_TYPES) {
    const r = m.rankings?.[type];
    if (r) rankings[type] = { value: r.value, rank: r.rank, tier: r.tier };
  }
  if (Object.keys(rankings).length) out.rankings = rankings;
  return out;
}

/** Scomposizione guerra/economia per NAZIONE, calcolata dal server sui
 *  cittadini che militano in una unità militare (l'unico insieme di utenti
 *  di cui si conoscano le skill: WarEra non espone l'elenco dei cittadini
 *  di un paese). Qualche KB — sta in un endpoint separato apposta, così il
 *  pannello nazione non deve scaricarsi l'intera directory MU per mostrare
 *  tre conteggi.
 *
 *  Una sola fetch per sessione: chi chiama può farlo a ogni apertura del
 *  pannello. Ritorna null se il server non risponde — è un di più, non deve
 *  far fallire il pannello. */
let _byCountry = null;
let _byCountryPromise = null;
export function fetchPlaystyleByCountry() {
  if (_byCountry) return Promise.resolve(_byCountry);
  if (_byCountryPromise) return _byCountryPromise;
  _byCountryPromise = _fetchCacheJson('/mu-playstyle-by-country')
    .then(json => {
      if (!json?.data || typeof json.data !== 'object') throw new Error('forma inattesa');
      _byCountry = json.data;
      return _byCountry;
    })
    .catch(err => {
      console.warn('WarEra+ mu: /mu-playstyle-by-country non disponibile:', err.message);
      _byCountryPromise = null; // riprovabile alla prossima apertura
      return null;
    });
  return _byCountryPromise;
}

/** Storico degli aggregati guerra/economia di UNA nazione:
 *  [[ts, war, eco, mixed, undecided, known], ...] dal più vecchio al più
 *  recente. Serve a dire "X cittadini sono passati alla guerra da ieri",
 *  che è la domanda vera: una nazione può avere battaglie ovunque e restare
 *  economica, quindi il "war mode" si legge da dove la gente mette i punti
 *  abilità, non dalle guerre in corso.
 *
 *  `sinceMs` taglia lato server (il file intero è di qualche MB, la serie
 *  di 24 ore sono pochi KB). Ritorna [] se il server non risponde: è un di
 *  più, non deve far fallire il pannello. */
export async function fetchPlaystyleHistory(countryId, sinceMs) {
  try {
    const qs = `countryId=${encodeURIComponent(countryId)}&since=${encodeURIComponent(sinceMs)}`;
    const json = await _fetchCacheJson(`/mu-playstyle-history?${qs}`);
    return Array.isArray(json?.data) ? json.data : [];
  } catch (err) {
    console.warn('WarEra+ mu: /mu-playstyle-history non disponibile:', err.message);
    return [];
  }
}

/** Come sopra ma per PIÙ nazioni in una richiesta sola: serve al pannello
 *  alleanza, che somma i movimenti di tutti i membri. Una richiesta per
 *  nazione costerebbe al server una rilettura completa del file di storico
 *  ciascuna (vedi commento all'endpoint).
 *
 *  Ritorna { countryId: serie }. Un server vecchio, che il parametro
 *  `countryIds` non lo conosce, risponde `data: []` — da cui l'oggetto
 *  vuoto: il pannello mostra la fotografia senza la tendenza, come quando il
 *  server non c'è affatto. */
export async function fetchPlaystyleHistoryMany(countryIds, sinceMs) {
  if (!countryIds?.length) return {};
  try {
    const qs = `countryIds=${encodeURIComponent(countryIds.join(','))}&since=${encodeURIComponent(sinceMs)}`;
    const json = await _fetchCacheJson(`/mu-playstyle-history?${qs}`);
    const data = json?.data;
    return (data && !Array.isArray(data) && typeof data === 'object') ? data : {};
  } catch (err) {
    console.warn('WarEra+ mu: /mu-playstyle-history (multi) non disponibile:', err.message);
    return {};
  }
}

/** Dettaglio pieno di UNA unità (mu.getById). Verificato dal vivo: la
 *  risposta è identica all'item della directory più `members` (array di
 *  userId) e `roles` ({managers, commanders}) — cioè esattamente i campi
 *  che la proiezione lean toglie. */
export function fetchMuDetail(muId) {
  return trpcCall('mu.getById', { muId });
}

/** Nome/avatar/livello/danni dei membri. `trpcCall` accoda da sé tutte le
 *  chiamate dello stesso giro di event loop in un unico POST batch (vedi
 *  src/shared/trpcClient.js), quindi un Promise.all qui è UNA richiesta,
 *  non una per membro — il massimo osservato è 25 membri per unità.
 *  Un utente che fallisce non fa fallire gli altri: torna null al suo posto. */
export function fetchUsersLite(userIds) {
  return Promise.all(userIds.map(id =>
    trpcCall('user.getUserLite', { userId: id }).catch(() => null)
  ));
}
