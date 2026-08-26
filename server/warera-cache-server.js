// warera-cache-server.js
//
// Server di cache per WarEra+.
// - Fa il poll delle API di WarEra a intervalli SCAGLIONATI (mai tutti insieme -> niente 429)
// - Copre TUTTI gli endpoint attualmente usati dal tool (country, map, region,
//   alliance, countryDiplomacy, battle, election)
// - Salva i dati su disco (file JSON, nessun database da installare)
// - Espone endpoint HTTP che il tool WarEra+ chiama al posto delle API dirette
//
// Uso: node warera-cache-server.js  (poi mettilo sotto pm2, vedi istruzioni)
//
// ══════════════════════════════════════════════════════════════
// WarEra+ round 2 — aggiunte rispetto alla versione precedente:
//
// 1) FIX pollBattles(): leggeva `b.regionId` (campo che non esiste su una
//    battaglia — verificato dal vivo contro l'API reale) invece di
//    `b.defender.region`/`b.attacker.region`. Risultato: `/battle-regions`
//    restituiva sempre `{fetchedAt:null,data:[]}`, il blocco veniva
//    silenziosamente saltato ogni singolo poll. Stesso identico bug che
//    c'era (e fu corretto) in src/diplomacy/battleHeatmap.js lato client —
//    vedi il commento lì.
//
// 2) TICKER SERVER-SIDE (pollTickerEvents): replica ESATTAMENTE la stessa
//    logica di diff che src/app/newsTicker.js fa oggi lato client via
//    localStorage (stessi campi: n.warsWith, diplomacy.swornEnemy,
//    n.rankings.countryActivePopulation.value, n.rankings.countryWealth.value
//    ?? n.money) — ma su un solo snapshot condiviso server-side invece che
//    uno per browser: niente più storia persa cambiando dispositivo, e
//    tutti gli utenti vedono lo stesso storico. A differenza del client
//    (che si limita alle top 15 nazioni più popolose per contenere il
//    volume di messaggi), qui si traccia OGNI nazione — il filtro "top N"
//    resta una scelta di visualizzazione, non di raccolta dati: meglio
//    avere lo storico completo e lasciare che sia il client a decidere
//    quanto mostrarne. Eventi accodati nello STESSO ticker-history.json già
//    usato per le elezioni (nuovo campo `category`, retrocompatibile: le
//    voci vecchie senza `category` restano implicitamente elezioni).
//
// 3) STORICO OWNERSHIP REGIONI (pollRegionsObject esteso): stesso schema
//    keyframe+eventi della time machine lato client (mai implementata sul
//    serio, era solo una bozza mai integrata), spostato qui — condiviso da
//    tutti, permanente (gli eventi non vengono MAI cancellati: una volta
//    accaduti non cambiano più, e a differenza di IndexedDB nel browser qui
//    lo spazio disco non è un problema — anni di storia sono comunque pochi
//    MB). Genesi (ts:0) seminata UNA VOLTA dal campo `initialCountry` che
//    ogni regione porta già con sé in region.getRegionsObject — quindi la
//    time machine copre "dall'inizio del mondo", non solo da quando questo
//    server ha iniziato a girare. Il periodo fra la vera nascita del mondo
//    e il primo poll utile di questo server resta però un salto netto
//    (nessun evento intermedio catturato) — non c'è modo di recuperarlo
//    senza un replay separato di tutte le battaglie storiche, volutamente
//    NON incluso qui (troppo pesante/fragile per girare nel loop di poll
//    periodico, va fatto — se mai — come script a sé, una tantum).
//    Endpoint nuovi: /region-history/range, /region-history/at?ts=,
//    /region-history/events?since=&until=.
//
// 4) BOOTSTRAP STORICO A RITMO LENTO (pollBootstrapPage): il punto (3) qui
//    sopra diceva "non incluso, troppo pesante/fragile" — questo lo fa, ma
//    UNA SOLA PAGINA (100 battaglie) AL MINUTO invece che tutte insieme, così
//    non si riaffaccia mai il rischio 429 dimostrato empiricamente durante
//    la review (bastavano poche fetch dirette per farlo scattare). Cursore
//    persistito su disco (bootstrap-state.json): sopravvive a un riavvio
//    pm2, riprende da dove si era fermato invece di ripartire da zero.
//    Le battaglie risolte grezze si accumulano in bootstrap-raw-battles.json
//    man mano — SOLO quando l'ultima pagina è stata scaricata (nextCursor
//    nullo) si fa il replay cronologico vero e proprio (_finalizeBootstrap),
//    che SOSTITUISCE interamente region-history-keyframes/events.json con
//    la ricostruzione precisa (ogni trasferimento datato al momento reale
//    della battaglia, non più un unico salto cumulativo). Se il finalize
//    fallisse per qualche motivo (es. cache regions non ancora pronta), il
//    prossimo tick lo ritenta invece di restare bloccato per sempre.
//    Limite noto, invariato dal punto (3): cattura solo i trasferimenti
//    derivati da BATTAGLIE — un cambio di proprietà per compravendita
//    regione (se esiste come meccanica) non lascerebbe traccia qui.
//    Endpoint di stato: /bootstrap-status.
//
// 5) STORICO OWNERSHIP REGIONI — SORGENTE ESTERNA (pollExternalHistory):
//    spywarera.com espone pubblicamente (https://spywarera.com/timemachine/
//    map/events) lo stesso identico dato che i punti (3)/(4) qui sopra
//    provano a ricostruire da soli — keyframe di genesi (initialOwnership) +
//    eventi di trasferimento regione — ma già completo dal 1 maggio 2025 a
//    oggi (verificato dal vivo: 11.114 eventi, ~1,3MB, aggiornato in tempo
//    reale) e più affidabile del nostro (copre solo da quando questo server
//    gira, più il backfill lento del punto 4). Ad ogni giro SOSTITUISCE
//    region-history-keyframes/events.json con la versione esterna (fonte
//    di verità) + i SOLI eventi propri catturati DOPO l'ultimo evento
//    esterno noto ("ponte" per il ritardo fra un loro poll e il prossimo).
//    Se il fetch fallisce (sito giù, formato cambiato, timeout) non si
//    tocca nulla: resta l'ultimo stato buono, e il polling orario proprio
//    (updateRegionHistory) continua ad accodare eventi come se questa
//    fonte non esistesse — nessun punto di rottura per il client, che non
//    parla mai direttamente con spywarera.com (solo questo server la
//    contatta, a intervalli). Endpoint di stato: /region-history/external-status.
//
// 6) EVENTI UFFICIALI WarEra (pollGameEvents, event.getEventsPaginated) —
//    richiesta esplicita dell'utente: aggiungere al ticker i tipi di
//    evento che pollTickerEvents (punto 2) NON può vedere perché non sono
//    un cambio di stato osservabile diffando country.getAllCountries/
//    countryDiplomacy — nuovo presidente, pace, patto difensivo, regione
//    liberata, rivoluzione, bancarotta. IN AGGIUNTA al diffing esistente,
//    non lo sostituisce: guerre/sworn/popolazione/tesoro restano come sono.
//    Stesso file di storico (ticker-history.json), nuova `category:
//    'game_event'` con `eventType` a dire quale dei tipi sopra è.
//    ATTENZIONE (a differenza del resto di questo file): i nomi dei campi
//    di event.getEventsPaginated NON sono stati verificati dal vivo contro
//    l'API reale (questo ambiente di sviluppo non raggiunge le API
//    WarEra) — si provano più candidati per ciascun campo (vedi
//    _pickCountryId/_pickPairCountries) così un nome diverso da quello
//    previsto degrada silenziosamente a "evento saltato", mai a un
//    crash o a un messaggio con la nazione sbagliata. L'evento grezzo
//    resta comunque salvato in `raw` (stesso pattern di pollElections):
//    dopo il primo giro in produzione si può controllare cache/
//    ticker-history.json e correggere i candidati se serve.
// ══════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
// WarEra+ radar dei proxy: il segnale che il browser non può calcolarsi da
// solo (la lingua di chi governa, una user.getUserById per ogni membro di
// governo). Modulo a sé, non tocca nessun poll esistente.
const { initProxyIndex, pollProxyIndex, readProxyIndex } = require('./proxyIndex');

const app = express();
const PORT = 3001;
const CACHE_DIR = path.join(__dirname, 'cache');

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

// Stesse costanti usate dal tool (src/diplomacy/config.js)
const API_BASE_URL = 'https://api6.warera.io';
// Worker Cloudflare già usato dal tool per battaglie/elezioni (rate limit
// più alto, 500/min invece di 100). Se in futuro cambia URL nel progetto,
// va aggiornato anche qui.
const WORKER_API_BASE = 'https://politicalview-proxy.fra-paradiso2.workers.dev';
// WarEra+: "crediti" statici del tool (userId fisso, sempre lo stesso) —
// prima ognuno faceva la sua chiamata separata al Worker da OGNI browser
// (src/app/authorPill.js, src/eco/main.js:enrichCreditCard). Generalizzato
// qui in un'unica mappa: aggiungere un futuro terzo credito significa solo
// aggiungere una riga sotto, nessun'altra modifica al server.
const CREDIT_PROFILES = {
  author: '69d2ed249f38d300d59a2af1', // frappa10 — pill principale (Ko-fi)
  argus:  '69cc14d4efc3f3f4291e93a9', // ArgusIA — credito Ottimizzatore industriale
};

app.use(cors({
  origin: '*', // TODO: restringere all'URL vero del tool una volta online
  // WarEra+: senza `maxAge` il browser rifa il preflight OPTIONS ogni pochi
  // secondi, e con la route proxy /trpc (che riceve anche POST, quindi
  // preflightati) sarebbe una richiesta in piu' per ogni chiamata. Il Worker
  // Cloudflare che questa route sostituisce dichiara 86400: stesso valore,
  // cosi' ogni browser lo paga una volta al giorno e non di piu'.
  maxAge: 86400,
  allowedHeaders: ['Content-Type'],
}));

// ---------------------------------------------------------------------------
// COMPRESSIONE gzip delle risposte JSON
// ---------------------------------------------------------------------------
// Le risposte qui sono JSON grandi e molto ripetitivi (migliaia di eventi con
// le stesse chiavi e gli stessi id nazione di 24 caratteri): verificato dal
// vivo, uscivano NON compresse — né da qui né da nginx — e /ticker da solo
// pesava 1,4 MB. Su rete mobile è la voce di gran lunga più cara di tutto il
// tool. Fatto con `zlib` invece del middleware `compression` apposta per non
// aggiungere una dipendenza npm da installare a mano sul VPS al deploy.
// Sotto 1 KB non si comprime: l'header e la CPU costerebbero più del
// risparmio.
const GZIP_MIN_BYTES = 1024;

app.use((req, res, next) => {
  const sendRaw = res.send.bind(res);
  res.json = (obj) => {
    const body = Buffer.from(JSON.stringify(obj), 'utf-8');
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Vary', 'Accept-Encoding');
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!wantsGzip || body.length < GZIP_MIN_BYTES) return sendRaw(body);
    zlib.gzip(body, (err, gz) => {
      if (err) return sendRaw(body); // meglio non compresso che niente
      res.set('Content-Encoding', 'gzip');
      sendRaw(gz);
    });
    return res;
  };
  next();
});

// ---------------------------------------------------------------------------
// UTILITY: cache su disco
// ---------------------------------------------------------------------------
function readCache(name, fallback) {
  const file = path.join(CACHE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (err) { console.error(`Errore leggendo cache ${name}:`, err.message); return fallback; }
}

// `compact: true` scrive senza indentazione. Serve per i file che crescono
// molto (ticker-history: con la ritenzione a 14 giorni sono decine di
// migliaia di eventi, riletti e riscritti ad ogni poll) — l'indentazione lì
// è il ~35% del file, cioè lettura, parse e scrittura più lenti ad ogni giro
// in cambio di una leggibilità che su quel file non usa nessuno.
function writeCache(name, data, { compact = false } = {}) {
  const json = compact ? JSON.stringify(data) : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(CACHE_DIR, `${name}.json`), json);
}

// Il radar riceve gli attrezzi del server invece di duplicarli: trpcBatch
// porta con sé retry, chunking e rate control già tarati. Va dopo la
// definizione di readCache/writeCache e prima di qualunque poll.
// `apiToken`/`trpcUpstream` sono per il solo segnale finanziamento: le
// transazioni vogliono la chiave, e non basta quella del Worker (401).
// Vengono passate per riferimento tardivo perché WARERA_API_TOKEN e
// TRPC_UPSTREAM sono dichiarati più in basso, insieme alla route /trpc.
initProxyIndex({
  trpcBatch: (...args) => trpcBatch(...args),
  readCache, writeCache,
  get apiToken() { return WARERA_API_TOKEN; },
  get trpcUpstream() { return TRPC_UPSTREAM; },
});

// ---------------------------------------------------------------------------
// trpcBatch: stessa identica logica del tool (src/diplomacy/utils.js),
// portata lato server: combina più chiamate in un solo POST/GET batch,
// chunka automaticamente oltre 50, ritenta sui 429 con backoff esponenziale.
// ---------------------------------------------------------------------------
// WarEra+: portato da 50 a 100 — dimezza il numero di richieste HTTP al
// Worker per chunk (quindi meno probabilità di sbattere sui 500/min), il
// payload resta comunque piccolo (countryId/partyId/electionId, poche decine
// di byte a call). Se il Worker dovesse rifiutare batch così grandi (URL
// troppo lunga, improbabile ma da tenere d'occhio nei log 429), tornare a 50.
const MAX_BATCH = 100;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1200;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function trpcBatch(calls, { useWorker = false, _attempt = 1 } = {}) {
  if (!calls || !calls.length) return [];
  if (calls.length > MAX_BATCH) {
    const chunks = [];
    for (let i = 0; i < calls.length; i += MAX_BATCH) chunks.push(calls.slice(i, i + MAX_BATCH));
    const results = [];
    for (const chunk of chunks) results.push(...(await trpcBatch(chunk, { useWorker })));
    return results;
  }
  try {
    const base = useWorker ? WORKER_API_BASE : API_BASE_URL;
    const procedureNames = calls.map(([proc]) => proc).join(',');
    const batchInput = {};
    calls.forEach(([, params], idx) => { batchInput[idx] = params || {}; });
    const url = `${base}/trpc/${procedureNames}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
    const res = await fetch(url);

    if (res.status === 429) {
      if (_attempt <= MAX_RETRY_ATTEMPTS) {
        const retryAfterHeader = parseFloat(res.headers.get('Retry-After'));
        const waitMs = !isNaN(retryAfterHeader) ? retryAfterHeader * 1000 : RETRY_BASE_MS * Math.pow(2, _attempt - 1);
        await sleep(waitMs);
        return trpcBatch(calls, { useWorker, _attempt: _attempt + 1 });
      }
      console.warn('trpcBatch: 429 dopo i tentativi massimi');
      return calls.map(() => null);
    }
    if (!res.ok) throw new Error(`Batch HTTP ${res.status}`);

    const results = await res.json();
    return results.map(item => {
      if (!item || item.error) return null;
      return item.result?.data?.json ?? item.result?.data ?? null;
    });
  } catch (err) {
    console.error('trpcBatch error:', err.message);
    return calls.map(() => null);
  }
}

// ---------------------------------------------------------------------------
// FETCH dirette (non batch): stessi endpoint del tool
// ---------------------------------------------------------------------------
async function fetchCountries() {
  const res = await fetch(`${API_BASE_URL}/trpc/country.getAllCountries`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchMap() {
  const res = await fetch(`${API_BASE_URL}/trpc/map.getMapData`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchRegionsObject() {
  const res = await fetch(`${API_BASE_URL}/trpc/region.getRegionsObject`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Paginata, tramite Worker (stessa logica di battleHeatmap.js:fetchActiveBattles)
async function fetchActiveBattles() {
  const all = [];
  let cursor;
  let guard = 0;
  do {
    const input = { isActive: true, limit: 100, ...(cursor ? { cursor } : {}) };
    const url = `${WORKER_API_BASE}/trpc/battle.getBattles?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (res.status === 429) { console.warn('battle.getBattles: 429, mi fermo con quello che ho'); break; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.result?.data?.items || data?.items || [];
    all.push(...items);
    cursor = data?.result?.data?.nextCursor || data?.nextCursor || null;
    guard++;
  } while (cursor && guard < 20);
  return all;
}

// ---------------------------------------------------------------------------
// POLL: ognuna aggiorna la propria fetta di cache. Se una fallisce, resta
// valida l'ultima versione salvata su disco (nessun endpoint torna vuoto
// per un errore temporaneo).
// ---------------------------------------------------------------------------
async function pollCountries() {
  try {
    const data = await fetchCountries();
    writeCache('countries', { fetchedAt: Date.now(), data });
    console.log('[poll] countries aggiornato');
  } catch (err) { console.error('[poll] countries fallito:', err.message); }
}

async function pollMap() {
  try {
    const data = await fetchMap();
    writeCache('map', { fetchedAt: Date.now(), data });
    console.log('[poll] map aggiornato');
  } catch (err) { console.error('[poll] map fallito:', err.message); }
}

// Cambia raramente (confini/regioni), poll poco frequente. WarEra+: ora fa
// ANCHE il lavoro per la time machine (vedi updateRegionHistory sotto) — le
// due cose condividono lo stesso identico dato appena scaricato, non ha
// senso rifare la fetch due volte per due scopi diversi.
async function pollRegionsObject() {
  try {
    const data = await fetchRegionsObject();
    writeCache('regions', { fetchedAt: Date.now(), data });
    console.log('[poll] regions aggiornato');
    updateRegionHistory(data);
  } catch (err) { console.error('[poll] regions fallito:', err.message); }
}

// Dipende dalle nazioni già in cache (per gli allianceId da interrogare)
async function pollAlliances() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    const allianceIds = [...new Set(countries.map(n => n.allianceId).filter(Boolean))];
    if (!allianceIds.length) { console.log('[poll] alliances: nessuna nazione in cache ancora, salto'); return; }

    const calls = allianceIds.map(id => ['alliance.getById', { allianceId: id }]);
    const results = await trpcBatch(calls);
    const alliances = allianceIds.map((id, i) => ({ allianceId: id, data: results[i] })).filter(a => a.data);
    writeCache('alliances', { fetchedAt: Date.now(), data: alliances });
    console.log(`[poll] alliances aggiornato (${alliances.length})`);
  } catch (err) { console.error('[poll] alliances fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// PARTITI POLITICI (pollParties) — stesso principio di pollAlliances:
// prima Political View (src/political/api.js) e il grafico Parlamento nel
// pannello nazione (src/panel/parliamentChart.js) chiamavano
// party.getManyPaginated/party.getById via Worker da OGNI browser, a ogni
// apertura. Qui un solo giro condiviso: 1) lista partiti per nazione
// (discovery, come election.getElections), 2) dettaglio pieno per ogni
// partito scoperto (nome/leader/iscritti), in un solo batch per TUTTI i
// partiti conosciuti — non uno per nazione.
// ═══════════════════════════════════════════════════════════════════════
async function pollParties() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[poll] parties: nessuna nazione in cache ancora, salto'); return; }

    // 1) lista per nazione — stesso dato che oggi Political scarica live
    //    per ogni nazione visitata (party.getManyPaginated).
    const listCalls = countries.map(n => ['party.getManyPaginated', { countryId: n._id, page: 1, limit: 100 }]);
    const listResults = await trpcBatch(listCalls, { useWorker: true });

    // WarEra+: stesso fix di pollElections — un chunk 429-ato ritorna `null`
    // per ogni call al suo interno; senza questo fallback quelle nazioni
    // perdevano i partiti già noti ad ogni giro sfortunato (byCountry
    // riscritto per intero). Su fallimento si tiene il dato del giro precedente.
    const prevByCountry = readCache('parties-by-country', { data: {} }).data || {};
    const byCountry = {};
    const allPartyIds = new Set();
    countries.forEach((n, i) => {
      const raw = listResults[i];
      const items = Array.isArray(raw) ? raw : (raw?.items || raw?.docs || raw?.results || raw?.data || (raw == null ? (prevByCountry[n._id] || []) : []));
      byCountry[n._id] = items;
      items.forEach(p => { const id = p._id || p.id; if (id) allPartyIds.add(id); });
    });
    writeCache('parties-by-country', { fetchedAt: Date.now(), data: byCountry });

    // 2) dettaglio pieno, un solo batch per tutti i partiti scoperti sopra
    //    (party.getById) — trpcBatch chunka automaticamente oltre MAX_BATCH.
    // WarEra+: idem, un chunk 429-ato non deve far sparire dal risultato
    // finale i partiti di cui avevamo già il dettaglio da un giro precedente.
    const prevDetail = readCache('parties-detail', { data: [] }).data || [];
    const prevDetailById = new Map(prevDetail.map(p => [p.partyId, p.data]));
    const ids = [...allPartyIds];
    const detailCalls = ids.map(id => ['party.getById', { partyId: id }]);
    const detailResults = ids.length ? await trpcBatch(detailCalls, { useWorker: true }) : [];
    const parties = ids
      .map((id, i) => ({ partyId: id, data: detailResults[i] || prevDetailById.get(id) }))
      .filter(p => p.data);
    writeCache('parties-detail', { fetchedAt: Date.now(), data: parties });

    console.log(`[poll] parties aggiornato (${countries.length} nazioni, ${parties.length}/${ids.length} partiti)`);
  } catch (err) { console.error('[poll] parties fallito:', err.message); }
}

// Diplomazia (sworn enemy + patti difensivi) per ogni nazione. WarEra+: ora
// alimenta ANCHE il ticker server-side (vedi pollTickerEvents sotto),
// chiamata subito dopo aver scritto la cache — stesso identico dato, un
// solo giro di fetch per entrambi gli scopi.
async function pollDiplomacy() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[poll] diplomacy: nessuna nazione in cache ancora, salto'); return; }

    const calls = countries.map(n => ['countryDiplomacy.getByCountry', { countryId: n._id }]);
    const results = await trpcBatch(calls);
    const diplomacy = countries.map((n, i) => ({ countryId: n._id, data: results[i] })).filter(d => d.data);
    writeCache('diplomacy', { fetchedAt: Date.now(), data: diplomacy });
    console.log(`[poll] diplomacy aggiornato (${diplomacy.length})`);

    pollTickerEvents(countries, diplomacy);
  } catch (err) { console.error('[poll] diplomacy fallito:', err.message); }
}

// Battaglie attive + dettagli regione di ciascuna (stesso giro, dati coerenti fra loro)
async function pollBattles() {
  try {
    const battles = await fetchActiveBattles();
    writeCache('battles', { fetchedAt: Date.now(), data: battles });

    // WarEra+ FIX: una battaglia non ha MAI un campo `regionId` in cima —
    // verificato dal vivo contro l'API reale (stesso bug, stessa causa, già
    // corretto lato client in src/diplomacy/battleHeatmap.js: l'id regione
    // sta solo dentro defender.region/attacker.region). Prima di questa
    // correzione regionIds era sempre vuoto, quindi /battle-regions non
    // veniva MAI scritto e restava per sempre {fetchedAt:null,data:[]}.
    const regionIds = [...new Set(
      battles.map(b => b.defender?.region || b.attacker?.region).filter(Boolean)
    )];
    if (regionIds.length) {
      const calls = regionIds.map(id => ['region.getById', { regionId: id }]);
      const results = await trpcBatch(calls);
      const regionDetails = regionIds.map((id, i) => ({ regionId: id, data: results[i] })).filter(r => r.data);
      writeCache('battle-regions', { fetchedAt: Date.now(), data: regionDetails });
    }
    console.log(`[poll] battles aggiornato (${battles.length} attive)`);
  } catch (err) { console.error('[poll] battles fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// UNITÀ MILITARI (pollMuDirectory) — solo la DIRECTORY, non i dettagli.
//
// Verificato dal vivo prima di scrivere questo blocco (mu.getManyPaginated,
// mu.getById, ranking.getRanking sugli endpoint reali):
//
//   · paginazione a CURSORE come battle.getBattles ({items, nextCursor}),
//     non a pagina come party.getManyPaginated. Oggi 1379 MU = 14 pagine
//     da 100.
//   · ogni item della lista è GIÀ l'oggetto completo: `mu.getById` non
//     aggiunge un solo campo rispetto a quello che la lista restituisce.
//     Comprese le `rankings` (muWeeklyDamages/muDamages/muTerrain/
//     muWealth/muBounty/muReputation, ognuna {value, rank, tier}) — le
//     classifiche del client si calcolano da qui, senza mai chiamare
//     ranking.getRanking.
//   · `members` è un array di userId (niente nome/avatar): il client li
//     risolve con user.getUserLite quando apre UNA unità, non qui.
//
// PROIEZIONE: l'elenco grezzo pesa 2,0 MB (555 KB gzip) e i 16k userId dei
// membri sono i tre quarti del peso — inutili in una lista che mostra solo
// "quanti membri". Si scrive quindi una versione ridotta (557 KB, ~140 KB
// gzip con la compressione già attiva su questo server): i campi che
// servono a cercare, ordinare e disegnare le card, più le rankings.
//
// Il DETTAGLIO di una singola MU resta client-side on-demand (mu.getById
// diretto, vedi src/mu/api.js): i membri entrano/escono di continuo, e
// tenerne una copia server per ~1400 unità di cui l'utente ne apre due
// sarebbe spreco di poll e di dato vecchio.
// ═══════════════════════════════════════════════════════════════════════
const MU_RANKING_TYPES = ['muWeeklyDamages', 'muDamages', 'muTerrain', 'muWealth', 'muBounty', 'muReputation'];

async function fetchAllMus() {
  const all = [];
  let cursor;
  let guard = 0;
  do {
    const input = { limit: 100, ...(cursor ? { cursor } : {}) };
    const url = `${WORKER_API_BASE}/trpc/mu.getManyPaginated?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (res.status === 429) { console.warn('mu.getManyPaginated: 429, mi fermo con quello che ho'); break; }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = data?.result?.data?.items || data?.items || [];
    all.push(...items);
    cursor = data?.result?.data?.nextCursor || data?.nextCursor || null;
    guard++;
  } while (cursor && guard < 100); // 14 pagine oggi: guard largo, le MU crescono
  return all;
}

function leanMu(m) {
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

// ── Nazionalità "de facto" ────────────────────────────────────────────
// Una MU è registrata sotto una nazione (campo `country`) ma i suoi membri
// possono essere in maggioranza di un'altra: in quel caso, di fatto, è di
// quell'altra. Per saperlo serve la nazione di OGNI membro, e l'unica fonte
// è `user.getUserLite` — un utente per chiamata, ~4,3 KB di risposta a
// testa, 16k membri in totale: risolverli tutti ad ogni giro sarebbe ~65 MB
// ogni 30 minuti, fuori discussione.
//
// La nazione di un utente però cambia raramente: si tiene quindi una mappa
// PERSISTENTE userId → [countryId, quando l'abbiamo chiesto, stile di gioco,
// ultimo reset skill noto] (mu-user-countries.json).
//
// Lo STILE DI GIOCO ('w' guerra / 'e' economia / 'm' misto / 'u' nessun
// punto speso) esce dalla STESSA risposta user.getUserLite già scaricata per
// la nazione: vedi classifyPlaystyle. Non costa quindi una sola chiamata in
// più — è il motivo per cui sta qui dentro e non in un poll suo.
//
// QUANDO ricontrollare un utente — non un TTL fisso, ma il regolamento vero
// del gioco (verificato dal vivo: gameConfig.getGameConfig().user.
// resetSkillDaysCooldown = 7): chi ha resettato le skill meno di 7 giorni fa
// NON PUÒ averle ricambiate, è una certezza del gioco, non una stima —
// va saltato del tutto finché il cooldown non scade (BLOCCATO). Chi invece
// può aver cambiato (mai resettato, o cooldown scaduto) non ha nessuna
// scadenza nota da sfruttare: bisogna ricontrollarlo, ma non tutti insieme
// in un solo giro — il pool "libero" è tipicamente il 60-70% dei membri
// (misurato dal vivo: 65,7% su un campione di 300), scaricarlo intero
// farebbe un picco invece di un flusso. Si ricontrolla quindi a fette,
// i più in ritardo prima (`windowShare` più sotto), completando il giro
// del pool ogni REFRESH_WINDOW_MS.
//
// Ancora incompleta, la composizione esce parziale, non sbagliata: si
// riporta anche `known` (quanti membri sono stati risolti) così il client
// sa quanto pesa il dato.
//
// La mappa viene potata ad ogni giro ai soli utenti che sono membri di
// qualche MU adesso: senza potatura crescerebbe per sempre.
const MU_USER_COUNTRIES_FILE = 'mu-user-countries';
const RESET_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;   // gameConfig.user.resetSkillDaysCooldown
// Ogni utente "libero" (mai resettato, o oltre il cooldown) viene
// ricontrollato entro questa finestra. Due ore, non un giorno: quello che
// interessa non è il singolo utente — che per regolamento può cambiare al
// massimo una volta ogni 7 giorni — ma l'AGGREGATO per nazione, cioè
// accorgersi che venti persone hanno spostato le skill sulla guerra mentre
// sta succedendo, non il giorno dopo. Con 24h, chi apriva il tool alle 16
// poteva vedere ancora la fotografia delle 15 del giorno prima.
const REFRESH_WINDOW_MS = 2 * 60 * 60 * 1000;
const REFRESH_CYCLES_PER_WINDOW = 4;                 // pollMuDirectory gira ogni 30 min: 4 giri in 2 ore
// Tetto di sicurezza per giro — NON il vero limitatore: quello è `dailyShare`
// più sotto, che spalma il refresh dei "liberi" sui 48 giri del giorno a
// prescindere da questo numero. Questo tetto entra in gioco solo quando
// `unknown` (nuovi membri o voci da migrare) è grande — cold start dopo un
// deploy, o l'aggiunta di un campo come questo stesso `lastSkillsResetAt`.
//
// Misurato dal vivo contro il Worker (stesso client di trpcBatch, chunk da
// 100 come sempre): ~286ms a chunk. Risolvere l'INTERA popolazione di oggi
// (16.122 membri, 162 chunk) richiederebbe ~46s e ~210 richieste/min,
// comodamente sotto il limite di 500/min del Worker — e pollMuDirectory
// gira a :12/:42, minuti in cui nessun altro poll (battles, elections,
// parties: vedi i cron.schedule più sotto) tocca il Worker. Il tetto è
// quindi fissato ben sopra la popolazione reale: non deve mai essere lui
// a rallentare una migrazione o un primo riempimento.
const MU_USER_LOOKUP_BUDGET = 20000;

// ── Stile di gioco: guerra / economia ─────────────────────────────────
// Ogni skill dell'utente è un oggetto { level, value, weapon, equipment,
// total, ... }. Conta SOLO `level`: è l'unica parte che il giocatore ha
// scelto. `value`/`total` includono la base che hanno tutti (esempio reale:
// criticalDamages vale 100 anche con level 0), le armi, l'equipaggiamento e
// la percentuale da grado militare — usarli farebbe risultare guerriero
// chiunque abbia raccolto un fucile.
//
// I livelli non costano uguale: portare una skill a livello n costa
// n(n+1)/2 punti cumulati. Verificato su 900 utenti campionati dalle
// classifiche (ricchezza, danni, livello, territorio, casse): la somma dei
// costi su tutte le skill coincide con leveling.spentSkillPoints per 900 su
// 900. Contare i livelli invece dei punti sovrastimerebbe le skill basse
// (livello 8 costa 36 punti, livello 2 ne costa 3).
//
// Le skill neutre (energy/health/hunger) restano fuori: le prende chiunque
// (15% dei punti in mediana) e includerle schiaccerebbe solo l'indice verso
// il centro.
//
// Soglie 0,3 / 0,7: la distribuzione dell'indice è nettamente bimodale —
// sui 900 campionati, 682 stanno sopra 0,8 o sotto 0,2, e la fascia centrale
// è il 5%. Controllo che l'indice descriva il gioco reale e non se stesso:
// chi sta sopra 0,7 ha danni mediani 47,3M contro 20,1M, chi sta sotto 0,3
// ha ricchezza mediana 40.070 contro 25.560 (danni e ricchezza non entrano
// nel calcolo, sono due misure indipendenti).
const WAR_SKILLS = ['attack', 'criticalChance', 'criticalDamages', 'armor', 'precision', 'dodge', 'lootChance'];
const ECO_SKILLS = ['companies', 'entrepreneurship', 'production', 'management'];
const skillCost = n => (n * (n + 1)) / 2;

/** 'w' | 'e' | 'm' | 'u' — una lettera sola perché finisce in 16k voci di
 *  un file che viene riletto e riscritto ad ogni poll. */
function classifyPlaystyle(user) {
  const pts = key => skillCost(user?.skills?.[key]?.level || 0);
  const war = WAR_SKILLS.reduce((s, k) => s + pts(k), 0);
  const eco = ECO_SKILLS.reduce((s, k) => s + pts(k), 0);
  if (war + eco === 0) return 'u'; // nessun punto speso: indeciso, non neutrale
  const index = war / (war + eco);
  if (index >= 0.7) return 'w';
  if (index <= 0.3) return 'e';
  return 'm';
}

/** Conteggio degli stili fra i membri di una MU. `known` è su quanti membri
 *  è calcolato: finché la mappa utenti si riempie, il totale non torna con
 *  memberCount, e il client deve poterlo dire. */
function muPlaystyle(members, userCountries) {
  const out = { war: 0, eco: 0, mixed: 0, undecided: 0, known: 0 };
  for (const id of members || []) {
    const mode = userCountries[id]?.[2];
    if (!mode) continue;
    out.known++;
    if (mode === 'w') out.war++;
    else if (mode === 'e') out.eco++;
    else if (mode === 'm') out.mixed++;
    else out.undecided++;
  }
  return out;
}

/** Stessa scomposizione ma per NAZIONE, sui cittadini che militano in una
 *  unità militare. È l'unico insieme di utenti di cui conosciamo le skill:
 *  WarEra non espone un elenco dei cittadini di un paese, quindi questo NON
 *  è un censimento della popolazione — è un campione (i tesserati), e come
 *  tale va etichettato nell'interfaccia. */

// ── Storico degli aggregati per nazione ───────────────────────────────
// Serve a rispondere a "quanti cittadini sono passati alla guerra da ieri?",
// che è la domanda vera dietro il concetto di nazione in "war mode": una
// nazione può avere battaglie ovunque e restare economica (l'Italia, con
// battaglie in corso, ha comunque la maggioranza dei cittadini sull'economia),
// quindi lo stato di guerra non si legge dalle guerre ma da dove la gente
// mette i punti abilità.
//
// Costa ZERO chiamate: playstyleByCountry() gira già ad ogni poll sulla
// mappa che abbiamo in RAM. L'unica aggiunta è non buttare via il valore
// precedente.
//
// Si scrive una riga solo quando i numeri di quella nazione CAMBIANO
// davvero (delta encoding): la maggior parte delle nazioni resta ferma per
// giri interi, e salvare 48 fotografie identiche al giorno per 151 nazioni
// gonfierebbe il file senza aggiungere informazione.
const MU_PLAYSTYLE_HISTORY_FILE = 'mu-playstyle-history';
const PLAYSTYLE_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 giorni
// Tetto ai `countryIds` di /mu-playstyle-history: il blocco piu' grande in
// gioco ha poche decine di nazioni, il limite e' solo per non far costruire a
// una richiesta arbitraria una risposta arbitrariamente grande.
const MU_PLAYSTYLE_HISTORY_MAX_IDS = 60;

/** Aggiunge allo storico le nazioni i cui conteggi sono cambiati rispetto
 *  all'ultimo campione salvato. Formato compatto per nazione:
 *  [ts, war, eco, mixed, undecided, known]. */
function appendPlaystyleHistory(byCountry, now) {
  const history = readCache(MU_PLAYSTYLE_HISTORY_FILE, { data: {} }).data || {};
  const cutoff = now - PLAYSTYLE_HISTORY_RETENTION_MS;
  let changed = 0;

  for (const [countryId, c] of Object.entries(byCountry)) {
    const series = history[countryId] || (history[countryId] = []);
    const last = series[series.length - 1];
    const sameAsLast = last
      && last[1] === c.war && last[2] === c.eco
      && last[3] === c.mixed && last[4] === c.undecided && last[5] === c.known;
    if (sameAsLast) continue;
    series.push([now, c.war, c.eco, c.mixed, c.undecided, c.known]);
    changed++;
  }

  // Potatura per ritenzione, tenendo però SEMPRE l'ultimo campione di ogni
  // nazione: se una nazione non cambia da più di 30 giorni, buttare via
  // tutta la sua serie la farebbe sparire dallo storico invece di dire
  // "ferma da un mese".
  for (const [countryId, series] of Object.entries(history)) {
    const kept = series.filter(row => row[0] >= cutoff);
    history[countryId] = kept.length ? kept : series.slice(-1);
  }

  writeCache(MU_PLAYSTYLE_HISTORY_FILE, { fetchedAt: now, data: history }, { compact: true });
  return changed;
}

function playstyleByCountry(userCountries, censusMap, counts) {
  const byCountry = {};
  const row = (country) => byCountry[country]
    || (byCountry[country] = { war: 0, eco: 0, mixed: 0, undecided: 0, known: 0, total: counts?.[country] ?? null });

  // Con il censimento la nazione di un utente è quella di ADESSO (vedi
  // pollCitizens): si conta lì, non dove lo aveva visto l'ultima
  // risoluzione delle skill — che può essere di ore prima, e chi ha
  // cambiato paese restava contato nel vecchio (misurato: una nazione al
  // 104% dei suoi cittadini reali). `total` dice su quanti cittadini è
  // calcolata la fotografia, così il client mostra la copertura vera
  // invece di una formula sul campione.
  if (censusMap?.size) {
    for (const [userId, country] of censusMap) {
      const r = row(country);
      const mode = userCountries[userId]?.[2];
      if (!mode) continue;             // cittadino censito ma skill non ancora note
      r.known++;
      if (mode === 'w') r.war++;
      else if (mode === 'e') r.eco++;
      else if (mode === 'm') r.mixed++;
      else r.undecided++;
    }
    return byCountry;
  }

  // Censimento non ancora disponibile (primo avvio): comportamento
  // precedente, sui soli utenti di cui conosciamo nazione e stile.
  for (const entry of Object.values(userCountries)) {
    const [country, , mode] = entry;
    if (!country || !mode) continue;
    const r = row(country);
    r.known++;
    if (mode === 'w') r.war++;
    else if (mode === 'e') r.eco++;
    else if (mode === 'm') r.mixed++;
    else r.undecided++;
  }
  return byCountry;
}


/** Composizione per nazione dei membri: totale, quanti risolti, e le prime
 *  CINQUE nazioni per numero di membri. Misurato sulle 60 MU di vertice: una
 *  MU ha 1 nazionalità in mediana, 3 al 90° percentile, 6 al massimo — e le
 *  prime tre coprono già il 99% dei membri. Cinque quindi non taglia nulla in
 *  pratica, e costa byte solo sulle poche unità davvero eterogenee (per le
 *  altre l'array contiene solo quello che c'è). Il client mostra comunque un
 *  "+N" per il resto, calcolato da `known`. */
function muComposition(members, userCountries) {
  const counts = new Map();
  let known = 0;
  for (const id of members || []) {
    const entry = userCountries[id];
    if (!entry) continue;
    known++;
    counts.set(entry[0], (counts.get(entry[0]) || 0) + 1);
  }
  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([country, n]) => ({ country, n }));
  return { total: (members || []).length, known, top };
}

async function pollMuDirectory() {
  try {
    const mus = await fetchAllMus();
    // Stesso principio di pollParties/pollElections: se un giro torna
    // molto più corto del precedente è quasi sempre un 429 a metà
    // paginazione, non lo scioglimento improvviso di metà delle unità —
    // meglio tenere la directory precedente che pubblicarne una monca.
    const prev = readCache('mu-directory', { data: [] }).data || [];
    if (prev.length && mus.length < prev.length * 0.5) {
      console.warn(`[poll] mu-directory: solo ${mus.length} MU contro ${prev.length} del giro precedente, tengo le vecchie`);
      return;
    }

    const now = Date.now();
    const userCountries = readCache(MU_USER_COUNTRIES_FILE, { data: {} }).data || {};

    // Censimento (pollCitizens): nazione di ADESSO per ogni cittadino. Dove
    // c'è, vince sulla nazione memorizzata insieme alle skill, che è vecchia
    // quanto l'ultima risoluzione di quell'utente. Le voci nuove nascono qui
    // con la nazione già giusta e restano in attesa solo delle skill.
    const censusMap = citizenCountryMap();
    for (const [userId, country] of censusMap) {
      const entry = userCountries[userId];
      if (entry) entry[0] = country;
      else userCountries[userId] = [country, 0, null, null]; // ts 0 = skill mai risolte, priorità massima
    }

    // Chi va (ri)chiesto, in ordine di priorità:
    //   1) chi non conosciamo affatto (nuovo membro) — sempre, subito;
    //   2) chi è in mappa da prima che salvassimo lastSkillsResetAt (voci a
    //      meno di 4 elementi, da una versione precedente di questo file)
    //      — trattato come "dovuto subito", è la migrazione automatica
    //      della mappa dopo il deploy, senza cancellarla;
    //   3) chi è "libero" (mai resettato, o oltre il cooldown di 7 giorni)
    //      ed è passato più di un giorno dall'ultimo controllo — ma solo
    //      una FETTA per giro (dailyShare), i più in ritardo prima, per
    //      spalmare il refresh giornaliero sui 48 giri del giorno invece
    //      di scaricarlo tutto in un colpo.
    // Chi è ancora dentro il cooldown non entra proprio in lista: è
    // CERTO che non sia cambiato, controllarlo sarebbe puro spreco.
    const unknown = [];
    const eligibleDue = []; // [id, ultimo controllo] — "liberi" e scaduto il giorno
    const currentMembers = new Set();
    for (const m of mus) {
      for (const id of m.members || []) currentMembers.add(id);
    }
    // La coda copre i membri di unità E tutti i cittadini censiti: lo stile
    // di gioco per nazione ora si calcola sul censimento, quindi servono le
    // skill di chiunque, non solo di chi è tesserato. È lo stesso ordine di
    // grandezza (~15k cittadini contro ~16k membri), non lavoro in più.
    const candidates = new Set([...currentMembers, ...censusMap.keys()]);
    for (const id of candidates) {
      const entry = userCountries[id];
      if (!entry || entry.length < 4 || !entry[2]) { unknown.push(id); continue; }
      const lastReset = entry[3];
      const locked = lastReset && (now - Date.parse(lastReset)) < RESET_COOLDOWN_MS;
      if (locked) continue; // bloccato dal cooldown: non può essere cambiato, si salta
      if (now - entry[1] >= REFRESH_WINDOW_MS) eligibleDue.push([id, entry[1]]);
    }
    eligibleDue.sort((a, b) => a[1] - b[1]); // i più in ritardo prima
    const windowShare = Math.max(50, Math.ceil(eligibleDue.length / REFRESH_CYCLES_PER_WINDOW));
    const dueBatch = eligibleDue.slice(0, windowShare).map(([id]) => id);

    const toResolve = [...new Set([...unknown, ...dueBatch])].slice(0, MU_USER_LOOKUP_BUDGET);
    if (toResolve.length) {
      const users = await trpcBatch(toResolve.map(id => ['user.getUserLite', { userId: id }]), { useWorker: true });
      toResolve.forEach((id, i) => {
        const u = users[i];
        // Quinto elemento (aggiunto dopo): la fotografia statistica del
        // cittadino, per l'elenco cittadini di Statistiche nazioni
        // (/country-citizens). getUserLite la porta GIA' con se' — prima
        // veniva scartata e restavano solo nazione e stile di gioco.
        // In coda all'array apposta: [0..3] restano quello che erano,
        // nessun consumatore esistente da aggiornare.
        if (u?.country) userCountries[id] = [u.country, now, classifyPlaystyle(u), u.dates?.lastSkillsResetAt || null, citizenStats(u)];
      });
    }

    // Potatura: via chi non è né cittadino censito né membro di un'unità
    // (account cancellati, o membri usciti quando il censimento non c'è
    // ancora — nel qual caso vale il criterio di prima).
    for (const id of Object.keys(userCountries)) {
      if (!currentMembers.has(id) && !censusMap.has(id)) delete userCountries[id];
    }
    writeCache(MU_USER_COUNTRIES_FILE, { fetchedAt: now, data: userCountries }, { compact: true });

    const data = mus.map(m => {
      const lean = leanMu(m);
      lean.composition = muComposition(m.members, userCountries);
      lean.playstyle = muPlaystyle(m.members, userCountries);
      return lean;
    });
    writeCache('mu-directory', { fetchedAt: now, data }, { compact: true });

    // Aggregato per nazione: 165 nazioni per quattro numeri, qualche KB —
    // sta in un file suo perché il pannello nazione non deve scaricarsi
    // l'intera directory (~1 MB) per mostrare tre conteggi.
    const byCountry = playstyleByCountry(userCountries, censusMap, citizenCounts());
    writeCache('mu-playstyle-by-country', { fetchedAt: now, data: byCountry });
    const historyChanged = appendPlaystyleHistory(byCountry, now);

    // La mappa copre ora cittadini censiti + membri di unità (l'unione),
    // quindi il totale non si confronta più coi soli membri MU.
    const tracked = Object.keys(userCountries).length;
    const styled = Object.values(userCountries).filter(e => e[2]).length;
    console.log(`[poll] mu-directory aggiornato (${mus.length} MU, ${tracked} utenti seguiti — ${currentMembers.size} membri MU + ${censusMap.size} cittadini censiti, ${styled} con stile di gioco noto, ${eligibleDue.length} in attesa di refresh (presi ${dueBatch.length}/${windowShare} di quota per giro), ${toResolve.length} risolti in questo giro, ${historyChanged} nazioni con storico aggiornato)`);
  } catch (err) { console.error('[poll] mu-directory fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// ELEZIONI (pollElections) — stessa idea di pollParties: la lista per
// nazione (discovery) va sempre riscritta, il DETTAGLIO di ogni elezione
// invece si scarica una volta sola se è chiusa (immutabile per sempre),
// e si ricontrolla ad ogni giro finché non lo è (candidatura o voto
// ancora in corso). File-per-elezione (cache/elections/<id>.json) invece
// di un unico blob: una volta scritta con resolved:true, un'elezione
// chiusa non viene MAI PIÙ riletta/riscritta — a differenza di
// ticker-history.json (che invece va riscritto per intero ad ogni giro,
// da cui il `compact:true` lì), qui non c'è nessun motivo di toccare un
// file già scritto e definitivo.
//
// `votesStartAt`/`votesEndAt`/`votesCount`/`votes{userId:count}` sono i
// nomi di campo confermati sul dettaglio (election.getElection) — li usa
// già il client (src/political/congress.js, src/political/presidential.js).
// Compaiono SOLO nel dettaglio, non nella lista (election.getElections dà
// solo _id/type/createdAt) — da cui la necessità di aprire il dettaglio
// per sapere se un'elezione è risolta o no.
// ═══════════════════════════════════════════════════════════════════════
const ELECTIONS_DIR = path.join(CACHE_DIR, 'elections');
if (!fs.existsSync(ELECTIONS_DIR)) fs.mkdirSync(ELECTIONS_DIR);

function readElectionDetail(electionId) {
  const file = path.join(ELECTIONS_DIR, `${electionId}.json`);
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (err) { console.error(`Errore leggendo election ${electionId}:`, err.message); return null; }
}

function writeElectionDetail(electionId, payload) {
  fs.writeFileSync(path.join(ELECTIONS_DIR, `${electionId}.json`), JSON.stringify(payload));
}

function isElectionResolved(electionData) {
  const endTs = Date.parse(electionData?.votesEndAt || 0);
  return Number.isFinite(endTs) && endTs < Date.now();
}

async function pollElections() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[poll] elections: nessuna nazione in cache ancora, salto'); return; }

    const calls = countries.map(n => ['election.getElections', { countryId: n._id }]);
    const results = await trpcBatch(calls, { useWorker: true });

    // ── ticker (invariato) ──
    const storico = readCache('ticker-history', []);
    const idEsistenti = new Set(storico.map(e => e.id));
    const nuoviTicker = [];

    // ── lista completa per nazione, sempre riscritta (compatta: solo gli
    //    item grezzi della lista, non il dettaglio pesante con candidati/voti) ──
    // WarEra+: fix bug segnalato — trpcBatch chunka a MAX_BATCH e, se un
    // chunk prende 429 e supera i retry, ritorna `null` per OGNI call di
    // quel chunk (silenzioso, solo un warn). Prima si scriveva `[]` per quelle
    // nazioni, cancellando anche i dati buoni del giro precedente (byCountry
    // viene scritto per intero ogni volta). Ora su fallimento si tiene il
    // dato precedente invece di azzerarlo — un chunk rate-limitato lascia le
    // nazioni coinvolte "ferme all'ultimo giro buono" invece che vuote.
    const prevByCountry = readCache('elections-by-country', { data: {} }).data || {};
    const byCountry = {};

    // ── quali electionId serve dettagliare in questo giro: non le ho mai
    //    scaricate, O l'ultima volta non erano ancora risolte ──
    const needsDetail = []; // [{electionId, countryId}]

    countries.forEach((n, i) => {
      // WarEra+: fix bug reale trovato in produzione — election.getElections
      // via batch NON torna un array nudo, torna { items: [...] } (come
      // party.getManyPaginated, vedi pollParties sopra). `Array.isArray(raw)`
      // da solo era SEMPRE false → ogni nazione, ogni giro, finiva nel ramo
      // di fallback, a prescindere da 429/errori (i log erano puliti perché
      // non falliva nulla, scartava silenziosamente un oggetto valido).
      // Stesso pattern di unwrap di pollParties; `raw == null` resta l'unico
      // caso che tiene il dato del giro precedente (fallimento batch vero).
      const raw = results[i];
      const items = Array.isArray(raw) ? raw : (raw?.items || raw?.docs || raw?.results || raw?.data || (raw == null ? (prevByCountry[n._id] || []) : []));
      byCountry[n._id] = items;

      items.forEach(item => {
        const id = item.id || item._id || `${n._id}-${item.startedAt || item.createdAt}`;

        if (!idEsistenti.has(id)) {
          nuoviTicker.push({
            id, category: 'election', // retrocompatibile: voci vecchie senza `category` restano implicitamente elezioni
            timestamp: item.startedAt || item.createdAt || Date.now(),
            countryId: n._id, raw: item,
          });
        }

        const existing = readElectionDetail(id);
        if (!existing || !existing.resolved) needsDetail.push({ electionId: id, countryId: n._id });
      });
    });

    writeCache('elections-by-country', { fetchedAt: Date.now(), data: byCountry });

    const aggiornatoTicker = trimTickerHistory([...storico, ...nuoviTicker]);
    writeCache('ticker-history', aggiornatoTicker, { compact: true });
    console.log(`[poll] elections/ticker aggiornato (+${nuoviTicker.length} nuove, ${needsDetail.length} dettagli da (ri)scaricare)`);

    // ── dettaglio: batch separato, solo per candidatura/voto ancora aperti
    //    o mai scaricati — le elezioni già chiuse non arrivano mai qui ──
    if (needsDetail.length) {
      const detailCalls = needsDetail.map(({ electionId }) => ['election.getElection', { electionId }]);
      const detailResults = await trpcBatch(detailCalls, { useWorker: true });
      let scaricate = 0, risolteOra = 0;
      needsDetail.forEach(({ electionId }, i) => {
        const data = detailResults[i];
        if (!data) return; // fallita, il prossimo giro ritenta (resta come prima o assente)
        const resolved = isElectionResolved(data);
        writeElectionDetail(electionId, { fetchedAt: Date.now(), resolved, data });
        scaricate++;
        if (resolved) risolteOra++;
      });
      console.log(`[poll] election detail: ${scaricate}/${needsDetail.length} scaricate (${risolteOra} appena risolte, non più toccate d'ora in poi)`);
    }
  } catch (err) { console.error('[poll] elections fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// CREDITI STATICI DEL TOOL (pollCreditProfiles) — un solo poll ogni 6 ore
// per TUTTI i profili in CREDIT_PROFILES, in un'unica chiamata batch
// (stesso principio di pollAlliances/pollDiplomacy: una fetch per N id,
// non N fetch separate). Ognuno cambia di rado (nome/avatar), ma prima
// veniva richiesto al Worker da OGNI browser che apriva la relativa
// sezione del tool (pill principale, credito Ottimizzatore).
// ═══════════════════════════════════════════════════════════════════════
async function pollCreditProfiles() {
  try {
    const keys = Object.keys(CREDIT_PROFILES);
    const calls = keys.map(k => ['user.getUserLite', { userId: CREDIT_PROFILES[k] }]);
    const results = await trpcBatch(calls, { useWorker: true });
    const data = {};
    keys.forEach((k, i) => { if (results[i]) data[k] = results[i]; });
    writeCache('credit-profiles', { fetchedAt: Date.now(), data });
    console.log(`[poll] credit profiles aggiornato (${Object.keys(data).length}/${keys.length})`);
  } catch (err) { console.error('[poll] credit profiles fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// EVENTI UFFICIALI WarEra (event.getEventsPaginated) — vedi nota (6) in
// testa al file. Tipi scelti: news-worthy senza essere troppo frequenti
// (esclusi warDeclared duplicato del diffing, allianceMember* troppo
// granulari, regionTransfer/countryMoneyTransfer/depositDiscovered/
// resistanceIncreased/battleEnded/battleOpened ecc. — tutti tipi che
// l'API offre ma che qui si è scelto di non mostrare per non sommergere
// il ticker).
//
// SCHEMA REALE (esempio fornito dall'utente da un giro live, 2026-05-12):
//   { _id, countries: [id, id], priority, data: { type, ...campi
//     specifici del tipo }, createdAt, updatedAt }
// Confermati dal vivo: peaceMade, allianceFormed, allianceBroken,
// regionLiberated (data.fromCountry/data.toCountry), battleEnded,
// depositDiscovered, countryMoneyTransfer (questi ultimi tre esclusi
// deliberatamente, vedi sopra). newPresident/revolutionStarted/
// revolutionEnded/bankruptcy/defensivePactFormed/defensivePactBroken NON
// sono comparsi nel campione: restano un'ipotesi (stessa forma { countries,
// data: { type } } delle altre) da verificare al primo giro reale su questi
// tipi — se il nome campo fosse diverso, l'evento viene scartato lato
// client senza crash (vedi newsTicker.js:formatGameEventMessages).
// ═══════════════════════════════════════════════════════════════════════
const GAME_EVENT_TYPES = [
  'newPresident',
  'peace_agreement',
  'peaceMade',
  'allianceFormed',
  'allianceBroken',
  'defensivePactFormed',
  'defensivePactBroken',
  'regionLiberated',
  'revolutionStarted',
  'revolutionEnded',
  'bankruptcy',
];

// Chiamata GLOBALE (nessun countryId): un solo poll copre tutte le
// nazioni, non uno per country come le elezioni — a differenza di
// election.getElections, event.getEventsPaginated accetta countryId come
// filtro OPZIONALE (vedi doc endpoint), quindi omesso restituisce il feed
// mondiale. Se in produzione risultasse invece filtrato implicitamente
// (es. sull'account anonimo del token), va rivisto per un giro per
// country come pollElections — l'evento grezzo salvato in `raw` aiuta a
// capirlo dal primo giro.
async function fetchGameEvents() {
  const input = { limit: 100, eventTypes: GAME_EVENT_TYPES };
  const url = `${API_BASE_URL}/trpc/event.getEventsPaginated?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const payload = data?.result?.data ?? data;
  return Array.isArray(payload) ? payload : (payload?.items || []);
}

// Stesso schema append-only + dedupe-per-id di pollElections, accodato
// allo stesso ticker-history.json (vedi nota (6)). id/timestamp/type presi
// dai campi REALI confermati (_id, createdAt, data.type) — non più
// candidati multipli come al primo giro (quello restava necessario solo
// per i tipi non ancora visti dal vivo, gestito lato client).
async function pollGameEvents() {
  try {
    const items = await fetchGameEvents();

    const storico = readCache('ticker-history', []);
    const idEsistenti = new Set(storico.map(e => e.id));
    const nuovi = [];
    items.forEach(item => {
      const id = item._id || item.id;
      if (!id || idEsistenti.has(id)) return;
      const type = item.data?.type || item.type;
      if (!GAME_EVENT_TYPES.includes(type)) return; // paracadute se l'API ignorasse il filtro eventTypes
      nuovi.push({
        id,
        category: 'game_event',
        eventType: type,
        timestamp: Date.parse(item.createdAt) || Date.now(),
        raw: item, // dato grezzo: countries[]/data.* letti lato client (newsTicker.js)
      });
    });

    if (!nuovi.length) { console.log('[poll] game events: nessun evento nuovo'); return; }
    const aggiornato = trimTickerHistory([...storico, ...nuovi]);
    writeCache('ticker-history', aggiornato, { compact: true });
    console.log(`[poll] game events aggiornato (+${nuovi.length})`);
  } catch (err) { console.error('[poll] game events fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// TICKER SERVER-SIDE — guerre/sworn enemy/popolazione/tesoro
// (vedi nota (2) in testa al file: stessa logica di newsTicker.js, un solo
// snapshot condiviso invece che uno per browser in localStorage)
// ═══════════════════════════════════════════════════════════════════════
const TICKER_STATS_SNAPSHOT_FILE = 'ticker-stats-snapshot';

// ── Ritenzione dello storico ticker ──────────────────────────────────────
// Prima lo storico veniva tagliato con un `.slice(-5000)` secco. Il problema
// non è il numero in sé ma il fatto che sia un tetto a CONTEGGIO: la finestra
// TEMPORALE coperta si accorcia da sola man mano che il mondo produce più
// eventi. Misurato dal vivo sul server in produzione: 5000 eventi coprivano
// appena 26 ore, cioè il client non poteva nemmeno garantire un confronto
// "rispetto a ieri" affidabile, e "dall'ultima visita" era impossibile per
// chi non apriva il tool da un giorno.
// Ora si taglia per ETÀ (la finestra è quella che serve al client, a
// prescindere dal volume) con un tetto a conteggio che resta solo come rete
// di sicurezza contro una crescita anomala.
const TICKER_RETENTION_MS = 14 * 24 * 60 * 60 * 1000; // 14 giorni
const TICKER_MAX_EVENTS = 120000;                      // ~2 settimane ai volumi attuali

function trimTickerHistory(list) {
  const cutoff = Date.now() - TICKER_RETENTION_MS;
  return list
    .filter(e => (e.timestamp || 0) >= cutoff)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-TICKER_MAX_EVENTS);
}

function buildStatsSnapshot(countries, diplomacy) {
  const diplByCountry = new Map(diplomacy.map(d => [d.countryId, d.data]));
  const snap = {};
  countries.forEach(n => {
    snap[n._id] = {
      wars: [...(n.warsWith || [])].sort(),
      sworn: diplByCountry.get(n._id)?.swornEnemy?.enemy || null,
      population: n?.rankings?.countryActivePopulation?.value ?? null,
      wealth: n?.rankings?.countryWealth?.value ?? n?.money ?? null,
    };
  });
  return snap;
}

function pollTickerEvents(countries, diplomacy) {
  try {
    const prevSnap = readCache(TICKER_STATS_SNAPSHOT_FILE, null);
    const currSnap = buildStatsSnapshot(countries, diplomacy);
    writeCache(TICKER_STATS_SNAPSHOT_FILE, currSnap);

    // Primo giro dall'avvio del server: niente da confrontare, si salva
    // solo la base di partenza (stesso comportamento del client al primo
    // avvio in assoluto).
    if (!prevSnap) { console.log('[poll] ticker stats: primo snapshot, nessun evento'); return; }

    const now = Date.now();
    const events = [];
    const nameOf = () => null; // il nome nazione lo risolve il client (ha già tutte le country in cache)

    countries.forEach(n => {
      const id = n._id;
      const prev = prevSnap[id];
      const curr = currSnap[id];
      if (!prev || !curr) return; // nazione nuova, niente da diffare ancora

      // --- guerre nuove ---
      const prevWars = new Set(prev.wars);
      curr.wars.forEach(enemyId => {
        if (!prevWars.has(enemyId)) {
          events.push({ id: `war-${id}-${enemyId}-${now}`, category: 'war', timestamp: now, countryId: id, enemyId });
        }
      });

      // --- cambio sworn enemy ---
      if (prev.sworn !== curr.sworn) {
        if (curr.sworn) {
          events.push({ id: `sworn_new-${id}-${now}`, category: 'sworn_new', timestamp: now, countryId: id, enemyId: curr.sworn });
        } else if (prev.sworn) {
          events.push({ id: `sworn_removed-${id}-${now}`, category: 'sworn_removed', timestamp: now, countryId: id, enemyId: prev.sworn });
        }
      }

      // --- variazione popolazione ---
      // `value`/`prevValue` sono NUOVI (campi aggiuntivi, retrocompatibili:
      // le voci vecchie ne sono prive e il client sa cavarsela lo stesso).
      // Servono perché il client aggrega su finestre arbitrarie ("ultime 24h",
      // "dall'ultima visita"): con i soli `delta`/`pct` per-evento deve
      // sommarli/comporli, accumulando l'errore di arrotondamento di ogni
      // passo; avendo i valori assoluti fa `ultimo.value - primo.prevValue` e
      // ottiene il dato ESATTO in un colpo solo, qualunque sia la finestra.
      if (typeof prev.population === 'number' && typeof curr.population === 'number' && prev.population !== curr.population) {
        events.push({
          id: `population-${id}-${now}`, category: 'population', timestamp: now, countryId: id,
          delta: curr.population - prev.population,
          value: curr.population, prevValue: prev.population,
        });
      }

      // --- variazione tesoro (in %, come il client — evita div/0) ---
      if (typeof prev.wealth === 'number' && typeof curr.wealth === 'number' && prev.wealth !== curr.wealth && prev.wealth !== 0) {
        const pct = (curr.wealth - prev.wealth) / Math.abs(prev.wealth) * 100;
        // `pct` era arrotondato a 1 decimale: le micro-variazioni di un
        // singolo poll finivano a 0.0 e riempivano lo storico di eventi
        // senza informazione (misurato: 4585 eventi wealth su 5000 totali,
        // gran parte con pct 0). Tre decimali per non perdere il segnale, e
        // niente evento quando anche a quella precisione la variazione è
        // nulla — è solo rumore di arrotondamento che consuma ritenzione.
        const pctRounded = Math.round(pct * 1000) / 1000;
        if (pctRounded !== 0) {
          events.push({
            id: `wealth-${id}-${now}`, category: 'wealth', timestamp: now, countryId: id,
            pct: pctRounded,
            value: curr.wealth, prevValue: prev.wealth,
          });
        }
      }
    });
    nameOf(); // no-op, tenuto solo a documentare che i nomi si risolvono lato client

    if (!events.length) { console.log('[poll] ticker stats: nessuna variazione'); return; }

    const storico = readCache('ticker-history', []);
    const aggiornato = trimTickerHistory([...storico, ...events]);
    writeCache('ticker-history', aggiornato, { compact: true });
    console.log(`[poll] ticker stats: +${events.length} eventi (guerre/sworn/pop/tesoro)`);
  } catch (err) { console.error('[poll] ticker stats fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// CENSIMENTO CITTADINI (/citizens)
// -----------------------------------------------------------------------
// `user.getUsersByCountry` elenca TUTTI i cittadini di una nazione (solo
// _id e createdAt, 100 per pagina, a cursore): non un campione, l'elenco
// vero. Verificato dal vivo: 430 cittadini per l'Italia contro i 401 di
// `rankings.countryActivePopulation`, e su 14 nazioni il rapporto sta
// stabile a 1,07 — la classifica conta gli ATTIVI, questo conta gli
// iscritti.
//
// Serve a tre cose:
//   1) il numero di cittadini di adesso, che prima non esisteva come dato
//      (c'era solo la popolazione attiva della classifica);
//   2) la mappa utente → nazione, che finora si ricavava spendendo una
//      `user.getUserLite` per ogni membro di unità militare: da qui arriva
//      gratis, quindi tutto il budget di lookup resta per le skill e la
//      composizione delle MU non ha più bisogno di ~4 ore di riscaldamento
//      dopo un deploy. È anche più CORRETTA: chi cambia nazione restava
//      contato dove stava (misurato: Paesi Bassi al 104% dei suoi
//      cittadini reali);
//   3) lo stile di gioco per nazione calcolato sul censimento, con la
//      copertura vera esposta al client (`known` su `total`) invece della
//      formula "sui cittadini tesserati in una unità militare".
//
// Costo: le prime pagine di tutte le nazioni stanno in due richieste batch
// (100 procedure l'una), poi un giro per ogni pagina in più delle nazioni
// grandi — una dozzina di richieste in tutto, non 180.
// ═══════════════════════════════════════════════════════════════════════
const CITIZENS_FILE = 'citizens-by-country';
const CITIZENS_PAGE = 100;          // massimo accettato da user.getUsersByCountry
const CITIZENS_MAX_ROUNDS = 40;     // guardia: 4000 cittadini per nazione

async function pollCitizens() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[poll] citizens: nessuna nazione in cache ancora, salto'); return; }

    const now = Date.now();
    const idsByCountry = new Map(countries.map(c => [c._id, []]));
    const newestByCountry = new Map();   // countryId -> [createdAt...] (solo recenti, per i "nuovi")
    // Ogni giro chiede la pagina successiva di TUTTE le nazioni che ne hanno
    // ancora una: le nazioni piccole finiscono al primo, le grandi tirano
    // avanti da sole senza far aspettare le altre.
    let pending = countries.map(c => ({ id: c._id, cursor: null }));
    let round = 0;
    while (pending.length && round < CITIZENS_MAX_ROUNDS) {
      round++;
      const calls = pending.map(p => ['user.getUsersByCountry', {
        countryId: p.id, limit: CITIZENS_PAGE, ...(p.cursor ? { cursor: p.cursor } : {}),
      }]);
      const results = await trpcBatch(calls, { useWorker: true });
      const next = [];
      results.forEach((res, i) => {
        const p = pending[i];
        if (!res?.items) return;          // pagina fallita: la nazione resta con quel che ha
        const list = idsByCountry.get(p.id);
        if (!newestByCountry.has(p.id)) newestByCountry.set(p.id, []);
        const recent = newestByCountry.get(p.id);
        for (const u of res.items) {
          list.push(u._id);
          if (u.createdAt) recent.push(u.createdAt);
        }
        if (res.nextCursor) next.push({ id: p.id, cursor: res.nextCursor });
      });
      pending = next;
    }

    const DAY = 24 * 60 * 60 * 1000;
    const data = {};
    let total = 0;
    for (const [countryId, ids] of idsByCountry) {
      const dates = newestByCountry.get(countryId) || [];
      let new24h = 0, new7d = 0;
      for (const d of dates) {
        const age = now - Date.parse(d);
        if (age <= DAY) new24h++;
        if (age <= 7 * DAY) new7d++;
      }
      data[countryId] = { n: ids.length, ids, new24h, new7d };
      total += ids.length;
    }
    writeCache(CITIZENS_FILE, { fetchedAt: now, data }, { compact: true });
    console.log(`[poll] citizens aggiornato: ${total} cittadini in ${idsByCountry.size} nazioni, ${round} giri`);
  } catch (err) { console.error('[poll] citizens fallito:', err.message); }
}

/* ═══════════════════════════════════════════════════════════════════════
   ELENCO CITTADINI CON STATISTICHE (/country-citizens)
   -----------------------------------------------------------------------
   La vista "Statistiche nazioni" del client vuole i cittadini di una
   nazione con i loro numeri. Dal browser sarebbe impossibile: il gioco
   espone solo gli id (user.getUsersByCountry) e poi una chiamata per
   utente — 3.500 richieste per le nazioni grandi.

   Qui invece non costa nulla di nuovo: pollMuDirectory risolve GIA'
   user.getUserLite per tutti i cittadini censiti (gli serve per lo stile
   di gioco), quindi basta tenere da parte anche i numeri che quella
   risposta contiene. L'endpoint li rilegge e li unisce al censimento.

   Compatto di proposito (array di valori, non oggetti con chiavi
   ripetute 3.500 volte): a chiavi estese la sola Serbia sarebbe ~700 KB.
   ═══════════════════════════════════════════════════════════════════════ */

const PS_CODE = { w: 'war', e: 'eco', m: 'mixed', u: 'undecided' };

function citizenStats(u) {
  return [
    u.username || null,
    u.avatarUrl || null,
    u.leveling?.level ?? null,
    u.militaryRank ?? null,
    u.rankings?.weeklyUserDamages?.value ?? 0,
    u.rankings?.userDamages?.value ?? u.stats?.damagesCount ?? 0,
    u.rankings?.userWealth?.value ?? 0,
    u.rankings?.userBounty?.value ?? 0,
    u.skills?.attack?.total ?? null,
    Date.parse(u.dates?.lastConnectionAt) || null,
  ];
}

/** Mappa userId → countryId dal censimento (autorevole: è la nazione di
 *  adesso). Vuota finché il primo giro non è passato. */
function citizenCountryMap() {
  const cache = readCache(CITIZENS_FILE, { data: {} });
  const map = new Map();
  for (const [countryId, row] of Object.entries(cache.data || {})) {
    for (const id of row.ids || []) map.set(id, countryId);
  }
  return map;
}

/** Quanti cittadini ha ogni nazione, dal censimento. */
function citizenCounts() {
  const cache = readCache(CITIZENS_FILE, { data: {} });
  const out = {};
  for (const [countryId, row] of Object.entries(cache.data || {})) out[countryId] = row.n || 0;
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// NOME + AVATAR DEI GIOCATORI (/users-lite)
// -----------------------------------------------------------------------
// I grafici parlamento mostrano faccia e nome di ogni eletto e di ogni
// membro del governo. Il client li prendeva da `user.getUserLite`, una
// chiamata per utente accorpata in batch da 50: per un blocco di venti
// nazioni sono ~300 utenti in sei richieste al Worker, ognuna che
// interroga WarEra dal vivo. E `user.getUserLite` risponde con TUTTO
// l'utente (skill, ranking, statistiche: ~3,8 KB a testa) mentre qui
// servono due campi.
//
// Qui il server tiene una mappa userId → [username, avatarUrl, ts] e la
// serve in una richiesta sola, letta da disco. Gli utenti che non ha
// ancora li chiede lui a WarEra (stesso trpcBatch degli altri poll, quindi
// con retry e rate control) una volta sola: nome e avatar cambiano di
// rado, da cui il TTL lungo. Misurato su 36 eletti: 191 KB in 343 ms dal
// Worker contro 5,4 KB in 79 ms da qui (il primo giro, quello in cui il
// server li scarica, costa ~200 ms).
// ═══════════════════════════════════════════════════════════════════════
const USERS_LITE_FILE = 'users-lite';
const USERS_LITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// Tetto per richiesta: oltre non si va a chiedere a WarEra nello stesso
// giro (si risponde con quello che c'è, il resto arriva alla prossima
// apertura). Un blocco molto numeroso resta comunque sotto.
const USERS_LITE_MAX_FETCH = 300;

let _usersLite = null;   // { userId: [username, avatarUrl, ts] }
function _loadUsersLite() {
  if (!_usersLite) _usersLite = readCache(USERS_LITE_FILE, {});
  return _usersLite;
}

async function resolveUsersLite(ids) {
  const store = _loadUsersLite();
  const now = Date.now();
  const missing = ids.filter(id => {
    const row = store[id];
    return !row || (now - (row[2] || 0)) > USERS_LITE_TTL_MS;
  }).slice(0, USERS_LITE_MAX_FETCH);

  if (missing.length) {
    try {
      const results = await trpcBatch(missing.map(id => ['user.getUserLite', { userId: id }]), { useWorker: true });
      missing.forEach((id, i) => {
        const u = results[i];
        if (u) store[id] = [u.username || null, u.avatarUrl || null, now];
      });
      writeCache(USERS_LITE_FILE, store, { compact: true });
      console.log(`[users-lite] risolti ${missing.length} utenti (${Object.keys(store).length} in mappa)`);
    } catch (err) {
      console.error('[users-lite] risoluzione fallita:', err.message);
    }
  }

  const out = {};
  for (const id of ids) {
    const row = store[id];
    if (row) out[id] = { username: row[0], avatarUrl: row[1] };
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// DANNO DI OGGI — scatto del danno settimanale al cambio giorno di gioco
// -----------------------------------------------------------------------
// WarEra espone per ogni nazione solo il danno SETTIMANALE cumulato
// (rankings.weeklyCountryDamages) e quello di sempre: il danno "di oggi"
// non esiste come dato. Però il giorno di gioco cambia alle 02:00 italiane
// (indicazione dell'utente), quindi basta fotografare lì il cumulato
// settimanale: da quel momento in poi
//
//     danno di oggi = settimanale ora − settimanale alle 02:00
//
// Lo scatto lo fa il server e non il browser perché deve esistere anche se
// alle 02:00 non c'è nessuno col tool aperto — ed è uno solo per tutti,
// non uno per dispositivo.
//
// Il cumulato settimanale si azzera al reset della settimana di gioco: in
// quel giro la differenza verrebbe negativa. Il client la tratta come "il
// contatore è ripartito" e mostra il valore corrente (vedi
// todayDamageLine in src/diplomacy/blocStats.js) — qui si conserva solo il
// numero grezzo, senza interpretarlo.
// ═══════════════════════════════════════════════════════════════════════
const DAILY_DAMAGE_FILE = 'daily-damage-baseline';
const DAILY_DAMAGE_TZ = 'Europe/Rome';

/** Fotografa il danno settimanale di ogni nazione E di ogni unità militare
 *  dalle cache già aggiornate (nessuna chiamata a WarEra: pollCountries gira
 *  ogni 10 minuti e pollMuDirectory ogni 30, quindi alle 02:00 i dati sono
 *  al massimo di mezz'ora prima).
 *
 *  Le MU stanno nello stesso scatto e non in uno separato perché il
 *  significato è identico e il momento deve essere lo stesso: due file
 *  distinti scattati in istanti diversi renderebbero non confrontabili
 *  "danno di oggi di una nazione" e "danno di oggi delle sue unità". */
function snapshotDailyDamage() {
  try {
    // Stesso srotolamento degli altri poll: la cache countries conserva la
    // risposta tRPC grezza, l'array sta sotto data.result.data.
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.warn('[daily-damage] cache countries vuota, scatto saltato'); return; }
    const byCountry = {};
    for (const n of countries) {
      const v = n?.rankings?.weeklyCountryDamages?.value;
      if (typeof v === 'number') byCountry[n._id] = v;
    }

    const mus = readCache('mu-directory', { data: [] })?.data || [];
    const byMu = {};
    for (const m of mus) {
      const v = m?.rankings?.muWeeklyDamages?.value;
      if (typeof v === 'number') byMu[m._id] = v;
    }

    writeCache(DAILY_DAMAGE_FILE, { takenAt: Date.now(), tz: DAILY_DAMAGE_TZ, byCountry, byMu }, { compact: true });
    console.log(`[daily-damage] scatto salvato: ${Object.keys(byCountry).length} nazioni, ${Object.keys(byMu).length} unità`);
  } catch (err) { console.error('[daily-damage] scatto fallito:', err.message); }
}

// ═══════════════════════════════════════════════════════════════════════
// STORICO OWNERSHIP REGIONI — backend della time machine
// (vedi nota (3) in testa al file)
// ═══════════════════════════════════════════════════════════════════════
const REGION_KEYFRAMES_FILE = 'region-history-keyframes';
const REGION_EVENTS_FILE = 'region-history-events';
const KEYFRAME_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // un nuovo keyframe ogni 7 giorni
// Data di inizio del mondo di gioco, indicata dall'utente — usata come
// timestamp del keyframe genesi invece della sentinella ts:0 (round 1: era
// il 1 gennaio 1970, "1 gen 1970" mostrato allo slider non aveva senso).
const GENESIS_TS = Date.UTC(2025, 4, 1); // mese 0-based: 4 = maggio

// regionsObj: il valore grezzo di region.getRegionsObject, {regionId: region}
// dove region.country è l'owner attuale e region.initialCountry quello di
// nascita — entrambi verificati dal vivo contro l'API reale.
function updateRegionHistory(regionsObj) {
  const now = Date.now();
  const raw = regionsObj?.result?.data ?? regionsObj;
  if (!raw || typeof raw !== 'object') return;

  const currentMap = {};
  for (const [regionId, region] of Object.entries(raw)) currentMap[regionId] = region.country ?? null;

  let keyframes = readCache(REGION_KEYFRAMES_FILE, []);
  let events = readCache(REGION_EVENTS_FILE, []);

  // Genesi: seminata UNA SOLA VOLTA, dal campo initialCountry di ogni
  // regione — copre "dall'inizio del mondo", non solo da quando questo
  // server ha iniziato a girare (vedi nota (3) in testa al file per il
  // limite: il periodo fra la vera nascita e il primo poll utile resta un
  // salto netto, nessun evento intermedio).
  if (!keyframes.length) {
    const genesis = {};
    for (const [regionId, region] of Object.entries(raw)) genesis[regionId] = region.initialCountry ?? null;
    keyframes.push({ ts: GENESIS_TS, regions: genesis });
    writeCache(REGION_KEYFRAMES_FILE, keyframes);
    console.log('[region-history] keyframe genesi seminato da initialCountry (ts: 1 maggio 2025)');
  } else if (keyframes[0].ts === 0) {
    // Migrazione one-shot: la versione precedente seminava la genesi a
    // ts:0 (sentinella, non una vera data) — corretta qui alla data reale,
    // così lo storico/slider già raccolto resta valido senza dover
    // cancellare nulla (gli eventi accodati dopo hanno già timestamp
    // reali, solo il PRIMO keyframe andava corretto).
    keyframes[0].ts = GENESIS_TS;
    writeCache(REGION_KEYFRAMES_FILE, keyframes);
    console.log('[region-history] migrazione: genesi ts:0 -> 1 maggio 2025');
  }

  // Diff rispetto all'ultimo stato noto (ultimo keyframe + eventi
  // applicabili fino ad ora, cioè lo stato "adesso" prima di questo poll).
  const lastKnown = _reconstructRegionsAt(keyframes, events, now);
  const changes = [];
  for (const [regionId, countryId] of Object.entries(currentMap)) {
    const prevCountryId = lastKnown.regions[regionId];
    if (prevCountryId !== undefined && prevCountryId !== countryId) {
      changes.push({ ts: now, regionId, fromCountry: prevCountryId, toCountry: countryId });
    }
  }
  if (changes.length) {
    events = [...events, ...changes]; // MAI troncato: vedi nota (3), il passato non pesa quasi nulla su disco
    writeCache(REGION_EVENTS_FILE, events);
    recomputeContestCounts();
    console.log(`[region-history] +${changes.length} trasferimenti regione registrati`);
  }

  // Nuovo keyframe periodico (checkpoint per non dover rigiocare TUTTI gli
  // eventi dalla genesi a ogni ricostruzione, via via che la storia cresce).
  const latestKeyframeTs = Math.max(...keyframes.map(k => k.ts));
  if (now - latestKeyframeTs >= KEYFRAME_INTERVAL_MS) {
    keyframes.push({ ts: now, regions: currentMap });
    writeCache(REGION_KEYFRAMES_FILE, keyframes);
    console.log(`[region-history] nuovo keyframe periodico (${keyframes.length} totali)`);
  }
}

// Stessa identica logica di reconstructAt() nella bozza client mai
// integrata (timeMachine.js) — qui gira UNA VOLTA sul server invece che in
// ogni browser: trova il keyframe più recente <= targetTs, applica sopra
// gli eventi fra quel keyframe e targetTs.
function _reconstructRegionsAt(keyframes, events, targetTs) {
  if (!keyframes.length) return { ts: null, regions: {} };
  const usable = keyframes.filter(k => k.ts <= targetTs);
  const base = usable.length
    ? usable.reduce((a, b) => (b.ts > a.ts ? b : a))
    : keyframes.reduce((a, b) => (b.ts < a.ts ? b : a)); // targetTs prima di tutto: usa il più vecchio disponibile

  const regions = { ...base.regions };
  events
    .filter(e => e.ts > base.ts && e.ts <= targetTs)
    .sort((a, b) => a.ts - b.ts)
    .forEach(e => { regions[e.regionId] = e.toCountry; });

  return { ts: base.ts, regions };
}

// ═══════════════════════════════════════════════════════════════════════
// BOOTSTRAP STORICO A RITMO LENTO — vedi nota (4) in testa al file.
// Una pagina di battaglie risolte (isActive:false) ogni minuto, finché non
// finiscono; poi un replay cronologico UNA TANTUM che sostituisce
// region-history-keyframes/events.json con la ricostruzione precisa.
// ═══════════════════════════════════════════════════════════════════════
const BOOTSTRAP_STATE_FILE = 'bootstrap-state';
const BOOTSTRAP_RAW_FILE = 'bootstrap-raw-battles';
// Puro paracadute anti-loop-infinito (es. bug lato API che non restituisce
// mai nextCursor:null) — a 1 pagina/minuto sono comunque ~14 giorni prima
// di fermarsi, non un limite che ci si aspetta di toccare davvero.
const BOOTSTRAP_MAX_PAGES = 20000;

// ═══════════════════════════════════════════════════════════════════════
// AGGREGATI PER SINGOLA REGIONE (heatmap "Regioni contese" e "Intensità
// bellica storica" del client, src/diplomacy/contestedHeatmap.js e
// warIntensityHeatmap.js). Entrambi derivano da dati che sono GIÀ qui:
// nessuna nuova chiamata alle API WarEra, solo due letture di file.
// ═══════════════════════════════════════════════════════════════════════

/** {regionId: quante volte ha cambiato padrone}. Ricalcolato ad ogni
 *  riscrittura di REGION_EVENTS_FILE — il file è scritto in tre punti
 *  (updateRegionHistory, pollExternalHistory, _finalizeBootstrap) e la
 *  chiamata sta accanto a ciascuno, invece di duplicare il conteggio.
 *  Il client sa comunque contarseli da solo dagli eventi grezzi se questo
 *  endpoint non c'è (server non ancora aggiornato): qui si risparmiano
 *  ~112 KB gzip di download per ogni utente, non si abilita la vista. */
function recomputeContestCounts() {
  const events = readCache(REGION_EVENTS_FILE, []);
  const counts = {};
  for (const e of events) {
    if (!e || !e.regionId) continue;
    counts[e.regionId] = (counts[e.regionId] || 0) + 1;
  }
  writeCache('region-contest-counts', { fetchedAt: Date.now(), data: counts });
}

/** {regionId: danno totale di tutte le battaglie risolte lì}. Campi
 *  verificati dal vivo su battle.getBattles(isActive:false):
 *  `attacker.damages` / `defender.damages` (totali di battaglia) e
 *  `defender.region` come teatro dello scontro — gli stessi che
 *  _resolveBattleOutcome già usa per region/country.
 *
 *  Calcolato UNA VOLTA su un dataset fermo (il poll del bootstrap è
 *  disattivato di proposito nello scheduler): un cron periodico
 *  rimacinerebbe 15.000 battaglie per ottenere ogni volta lo stesso
 *  numero. Gira dopo il finalize del bootstrap e, per i server già
 *  finalizzati prima di questa aggiunta, una volta all'avvio se il file
 *  non esiste ancora. */
function computeHistoricalWarIntensity() {
  const battles = readCache(BOOTSTRAP_RAW_FILE, []);
  if (!battles.length) {
    console.log('[compute] war intensity: nessuna battaglia nel bootstrap, salto');
    return;
  }
  const intensity = {};
  for (const b of battles) {
    const regionId = b.defender?.region ?? b.attacker?.region ?? null;
    if (!regionId) continue;
    const dmg = (b.attacker?.damages || 0) + (b.defender?.damages || 0);
    if (!dmg) continue;
    intensity[regionId] = (intensity[regionId] || 0) + dmg;
  }
  writeCache('region-war-intensity', { fetchedAt: Date.now(), data: intensity });
  console.log(`[compute] war intensity: ${Object.keys(intensity).length} regioni su ${battles.length} battaglie risolte`);
}

async function _fetchResolvedBattlesPage(cursor) {
  const input = { isActive: false, limit: 100, ...(cursor ? { cursor } : {}) };
  const url = `${WORKER_API_BASE}/trpc/battle.getBattles?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url);
  if (res.status === 429) throw new Error('429 su battle.getBattles(isActive:false) — riprovo al prossimo minuto');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.result?.data?.items || data?.items || [];
  const nextCursor = data?.result?.data?.nextCursor || data?.nextCursor || null;
  return { items, nextCursor };
}

// Stessa logica della bozza mai integrata lato client (timeMachine.js,
// mai deployata) — provata qui, non indovinata: campi verificati dal vivo
// contro l'API reale (defender.region/attacker.region, attacker/defender
// .country, .wonRoundsCount, .roundsToWin — vedi src/diplomacy/battleMarkers.js
// e battleHeatmap.js, che li usano già per le battaglie ATTIVE).
function _resolveBattleOutcome(battle) {
  const regionId = battle.defender?.region ?? battle.attacker?.region ?? null;
  if (!regionId) return null;

  const attackerCountry = battle.attacker?.country ?? null;
  const defenderCountry = battle.defender?.country ?? null;

  let winnerCountry =
    battle.winnerCountry ??
    battle.winner ??
    (battle.result?.winner === 'attacker' ? attackerCountry
      : battle.result?.winner === 'defender' ? defenderCountry : null);

  if (!winnerCountry && typeof battle.roundsToWin === 'number') {
    const aWon = battle.attacker?.wonRoundsCount ?? 0;
    const dWon = battle.defender?.wonRoundsCount ?? 0;
    if (aWon >= battle.roundsToWin) winnerCountry = attackerCountry;
    else if (dWon >= battle.roundsToWin) winnerCountry = defenderCountry;
  }
  if (!winnerCountry) return null; // non determinabile coi campi noti — salta, non indovina

  const ts = Date.parse(battle.updatedAt || battle.createdAt || 0) || Date.now();
  const toCountry = winnerCountry === attackerCountry ? attackerCountry : defenderCountry;
  return { regionId, ts, toCountry, battleId: battle._id };
}

/** Replay cronologico completo: genesi (initialCountry) + ogni battaglia
 *  risolta in ordine di tempo reale. SOSTITUISCE region-history-keyframes/
 *  events.json — non li somma a quanto il poll orario diff-based aveva già
 *  accumulato nel frattempo (quegli eventi erano un'approssimazione più
 *  grezza, superata da questa ricostruzione più precisa). Ritorna true se
 *  è andato a buon fine (per marcare bootstrap-state come "finalized").
 */
function _finalizeBootstrap(rawBattles) {
  try {
    const regionsCache = readCache('regions', null);
    const raw = regionsCache?.data?.result?.data ?? regionsCache?.data;
    if (!raw) {
      console.warn('[bootstrap] finalize: cache regioni non ancora pronta, riprovo al prossimo minuto');
      return false;
    }

    const outcomes = [];
    let undetermined = 0;
    for (const b of rawBattles) {
      const o = _resolveBattleOutcome(b);
      if (o) outcomes.push(o); else undetermined++;
    }
    outcomes.sort((a, b) => a.ts - b.ts);

    const genesisRegions = {};
    for (const [regionId, region] of Object.entries(raw)) genesisRegions[regionId] = region.initialCountry ?? null;

    const regions = { ...genesisRegions };
    const events = [];
    for (const o of outcomes) {
      const from = regions[o.regionId] ?? null;
      if (from === o.toCountry) continue; // nessun cambio reale (es. il difensore ha vinto e teneva già)
      regions[o.regionId] = o.toCountry;
      events.push({ ts: o.ts, regionId: o.regionId, fromCountry: from, toCountry: o.toCountry });
    }

    writeCache(REGION_KEYFRAMES_FILE, [
      { ts: GENESIS_TS, regions: genesisRegions },
      { ts: Date.now(), regions }, // stato finale ricostruito, ancoraggio comodo per le query più recenti
    ]);
    writeCache(REGION_EVENTS_FILE, events);
    recomputeContestCounts();
    computeHistoricalWarIntensity();

    console.log(
      `[bootstrap] FINALIZE completato: ${rawBattles.length} battaglie risolte, ` +
      `${outcomes.length} determinabili, ${events.length} trasferimenti reali applicati ` +
      `(${undetermined} non determinabili — nessun campo vincitore riconosciuto)`
    );
    return true;
  } catch (err) {
    console.error('[bootstrap] finalize fallito:', err.message);
    return false;
  }
}

async function pollBootstrapPage() {
  const st = readCache(BOOTSTRAP_STATE_FILE, { cursor: null, done: false, finalized: false, pagesFetched: 0 });
  if (st.finalized) return; // tutto fatto, non c'è più nulla da fare

  if (st.done) {
    // Fetch completo ma un finalize precedente non è andato a buon fine —
    // ritenta invece di restare bloccato per sempre.
    const raw = readCache(BOOTSTRAP_RAW_FILE, []);
    if (_finalizeBootstrap(raw)) { st.finalized = true; writeCache(BOOTSTRAP_STATE_FILE, st); }
    return;
  }

  if (st.pagesFetched >= BOOTSTRAP_MAX_PAGES) {
    console.error(`[bootstrap] limite di sicurezza (${BOOTSTRAP_MAX_PAGES} pagine) raggiunto, mi fermo qui`);
    st.done = true;
    writeCache(BOOTSTRAP_STATE_FILE, st);
    return;
  }

  try {
    const { items, nextCursor } = await _fetchResolvedBattlesPage(st.cursor);
    const raw = readCache(BOOTSTRAP_RAW_FILE, []);
    raw.push(...items);
    writeCache(BOOTSTRAP_RAW_FILE, raw);

    st.pagesFetched++;
    st.cursor = nextCursor;

    if (!nextCursor) {
      st.done = true;
      writeCache(BOOTSTRAP_STATE_FILE, st);
      console.log(`[bootstrap] fetch completato: ${st.pagesFetched} pagine, ${raw.length} battaglie risolte totali`);
      if (_finalizeBootstrap(raw)) { st.finalized = true; writeCache(BOOTSTRAP_STATE_FILE, st); }
    } else {
      writeCache(BOOTSTRAP_STATE_FILE, st);
      console.log(`[bootstrap] pagina ${st.pagesFetched} (${items.length} battaglie, ${raw.length} totali)`);
    }
  } catch (err) {
    // Nessun avanzamento del cursore: il prossimo tick ritenta la STESSA pagina.
    console.error('[bootstrap] pagina fallita, riprovo al prossimo minuto:', err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// STORICO OWNERSHIP REGIONI — SORGENTE ESTERNA (spywarera.com)
// (vedi nota (5) in testa al file)
// ═══════════════════════════════════════════════════════════════════════
const EXTERNAL_HISTORY_URL = 'https://spywarera.com/timemachine/map/events';
const EXTERNAL_HISTORY_TIMEOUT_MS = 20000; // risposta ~1,3MB e cresce, margine largo
const EXTERNAL_HISTORY_STATUS_FILE = 'region-history-external-status';

async function _fetchExternalHistory() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTERNAL_HISTORY_TIMEOUT_MS);
  try {
    const res = await fetch(EXTERNAL_HISTORY_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.initialOwnership !== 'object' || !Array.isArray(data.events)) {
      throw new Error('formato inatteso (initialOwnership/events mancanti)');
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Sincronizza region-history-keyframes/events.json con spywarera.com,
 *  trattandolo come fonte di verità (più affidabile del nostro polling) e
 *  usando i nostri eventi già catturati solo per il "ponte" oltre l'ultimo
 *  evento che spywarera conosce. Fallisce in modo silenzioso (log + return):
 *  nessun impatto sul client, che legge sempre e solo i file locali.
 */
async function pollExternalHistory() {
  let external;
  try {
    external = await _fetchExternalHistory();
  } catch (err) {
    console.error('[region-history-external] fetch spywarera fallito, mantengo lo stato attuale:', err.message);
    return;
  }

  const externalEvents = external.events
    .map(e => ({ ts: Date.parse(e.ts), regionId: e.regionId, toCountry: e.toCountry }))
    .filter(e => Number.isFinite(e.ts))
    .sort((a, b) => a.ts - b.ts);

  const externalLastTs = externalEvents.length
    ? externalEvents[externalEvents.length - 1].ts
    : GENESIS_TS;

  // Ponte: nostri eventi già osservati DOPO l'ultimo evento noto a
  // spywarera — copre il ritardo fra il loro poll e "adesso".
  const ownEvents = readCache(REGION_EVENTS_FILE, []);
  const bridgeEvents = ownEvents.filter(e => e.ts > externalLastTs);
  const mergedEvents = [...externalEvents, ...bridgeEvents];

  writeCache(REGION_KEYFRAMES_FILE, [{ ts: GENESIS_TS, regions: external.initialOwnership }]);
  writeCache(REGION_EVENTS_FILE, mergedEvents);
  recomputeContestCounts();
  writeCache(EXTERNAL_HISTORY_STATUS_FILE, {
    fetchedAt: Date.now(),
    generatedAt: external.generatedAt,
    externalEventsCount: externalEvents.length,
    externalLastTs,
    bridgeEventsCount: bridgeEvents.length,
  });

  console.log(
    `[region-history-external] sync con spywarera.com: ${externalEvents.length} eventi esterni ` +
    `(fino a ${new Date(externalLastTs).toISOString()}) + ${bridgeEvents.length} eventi propri più recenti`
  );
}

// ---------------------------------------------------------------------------
// SCHEDULER: ogni endpoint ha un proprio intervallo e un proprio offset
// (minuto di partenza), così le chiamate a WarEra non si accumulano mai
// nello stesso istante. Sintassi cron: minuto ora giornoMese mese giornoSett.
// ---------------------------------------------------------------------------
cron.schedule('0,10,20,30,40,50 * * * *', pollCountries);              // ogni 10 min, :00
cron.schedule('5,20,35,50 * * * *', pollMap);                          // ogni 15 min, :05
cron.schedule('15 * * * *', pollRegionsObject);                        // ogni ora, :15 (alimenta anche la region-history)
cron.schedule('3,13,23,33,43,53 * * * *', pollAlliances);              // ogni 10 min, :03
cron.schedule('11,21,31,41,51 * * * *', pollParties);                  // ogni 10 min, :11
cron.schedule('8,23,38,53 * * * *', pollDiplomacy);                    // ogni 15 min, :08 (alimenta anche il ticker stats)
cron.schedule('1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49,52,55,58 * * * *', pollBattles); // ogni 3 min, :01
cron.schedule('2,5,8,11,14,17,20,23,26,29,32,35,38,41,44,47,50,53,56,59 * * * *', pollElections); // ogni 3 min, :02
cron.schedule('9,24,39,54 * * * *', pollGameEvents);                  // ogni 15 min, :09 (nota 6)
cron.schedule('12,42 * * * *', pollMuDirectory);            // ogni 30 min, :12 (directory unità militari)
cron.schedule('36 * * * *', pollCitizens);                  // ogni ora, :36 (censimento cittadini)
// Bootstrap storico — DISATTIVATO (round 4): troppo lento (1 pagina/min,
// poteva metterci ore/giorni) e comunque reso ridondante da
// pollExternalHistory qui sotto, che sovrascrive region-history-keyframes/
// events.json entro l'ora con una fonte già completa e più affidabile.
// Funzione e endpoint /bootstrap-status lasciati intatti (nessun dato
// perso, si può riattivare togliendo il commento) — vedi nota (4)/(5) in
// testa al file.
// cron.schedule('* * * * *', pollBootstrapPage);
// Sync con la sorgente esterna — offset :25, dopo pollRegionsObject (:15)
// così il "ponte" filtra eventi propri già scritti in quel giro, ma non è
// un requisito stretto (i due giri non si sovrappongono mai per orario).
cron.schedule('25 * * * *', pollExternalHistory);
cron.schedule('18 */6 * * *', pollCreditProfiles);          // ogni 6 ore, :18
cron.schedule('45 */6 * * *', pollProxyIndex);               // ogni 6 ore, :45 (radar dei proxy)
// Cambio giorno di gioco: 02:00 italiane, non UTC — da cui il fuso
// esplicito (il server può stare ovunque). Minuto :01 per essere sicuri di
// leggere il giro di pollCountries delle :00.
cron.schedule('1 2 * * *', snapshotDailyDamage, { timezone: DAILY_DAMAGE_TZ });

// Primo giro completo all'avvio (in ordine: countries prima, perché tutto
// il resto dipende dalla cache delle nazioni), così non si parte a vuoto.
(async () => {
  await pollCountries();
  await pollCitizens();   // dipende da countries; deve girare PRIMA di pollMuDirectory
  await pollMap();
  await pollRegionsObject();
  await pollAlliances();
  await pollParties();
  await pollDiplomacy();
  await pollBattles();
  await pollElections();
  await pollGameEvents();
  await pollMuDirectory();
  // await pollBootstrapPage(); // disattivato, vedi nota sopra al cron.schedule commentato
  await pollExternalHistory(); // sync subito con spywarera invece di aspettare fino a 1h
  await pollCreditProfiles();
  // Primissimo avvio: senza scatto il "danno di oggi" resterebbe muto fino
  // alle 02:00 successive. Se ne fa uno subito — vale meno (parte da adesso,
  // non dal cambio giorno), e infatti il client mostra l'ora dello scatto
  // invece di dire "oggi" quando non è delle 02:00.
  if (!readCache(DAILY_DAMAGE_FILE, null)) snapshotDailyDamage();

  // Aggregati per regione: il conteggio delle contese si riallinea da solo
  // al prossimo evento, ma su un server già avviato da tempo il prossimo
  // evento può essere fra ore — meglio averli subito. L'intensità bellica
  // gira su un dataset fermo: una volta sola, se non è già stata calcolata.
  // Radar dei proxy: al primo avvio in assoluto costa ~50 richieste (deve
  // risolvere la lingua di tutti i membri di governo). Ai riavvii successivi
  // l'indice c'è già e ci pensa il cron, così un pm2 restart non paga quel
  // conto ogni volta.
  if (!readCache('proxy-index', null)) pollProxyIndex();

  if (!readCache('region-contest-counts', null)) recomputeContestCounts();
  if (!readCache('region-war-intensity', null)) computeHistoricalWarIntensity();
})();

// ---------------------------------------------------------------------------
// ENDPOINT esposti al tool WarEra+ (nginx li smista da /warera-cache/*)
// ---------------------------------------------------------------------------
app.get('/countries', (req, res) => res.json(readCache('countries', { fetchedAt: null, data: [] })));
app.get('/map', (req, res) => res.json(readCache('map', { fetchedAt: null, data: [] })));
app.get('/regions', (req, res) => res.json(readCache('regions', { fetchedAt: null, data: [] })));
app.get('/alliances', (req, res) => res.json(readCache('alliances', { fetchedAt: null, data: [] })));

app.get('/parties', (req, res) => {
  const { countryId } = req.query;
  const cache = readCache('parties-by-country', { fetchedAt: null, data: {} });
  const list = countryId ? (cache.data[countryId] || []) : [];
  res.json({ fetchedAt: cache.fetchedAt, data: list });
});

app.get('/parties-detail', (req, res) => res.json(readCache('parties-detail', { fetchedAt: null, data: [] })));

// `countryId` = una nazione (risposta: array, forma storica).
// `countryIds` = più nazioni in UNA richiesta (risposta: {countryId: array}).
// La seconda serve al pannello alleanza, che disegna il parlamento di ogni
// membro: una richiesta per nazione significava venti round-trip per un
// blocco da venti, ed è la ragione per cui i congressi comparivano più
// lentamente di quando la stessa fase passava da un solo batch tRPC.
// Il file di cache è già tutto in memoria qui: servirne venti fette o una
// costa lo stesso.
app.get('/elections', (req, res) => {
  const { countryId, countryIds } = req.query;
  const cache = readCache('elections-by-country', { fetchedAt: null, data: {} });
  if (countryIds) {
    const out = {};
    for (const id of String(countryIds).split(',').map(s => s.trim()).filter(Boolean)) {
      out[id] = cache.data[id] || [];
    }
    return res.json({ fetchedAt: cache.fetchedAt, data: out });
  }
  const list = countryId ? (cache.data[countryId] || []) : [];
  res.json({ fetchedAt: cache.fetchedAt, data: list });
});

app.get('/election/:id', (req, res) => {
  const detail = readElectionDetail(req.params.id);
  if (!detail) return res.json({ fetchedAt: null, resolved: false, data: null });
  res.json(detail);
});

// Stessa ragione di `countryIds` qui sopra, per i DETTAGLI elezione: il
// pannello alleanza ne chiede uno per nazione. Risposta {electionId: data},
// con le elezioni mai viste dal server semplicemente assenti.
app.get('/elections-detail', (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const out = {};
  for (const id of ids) {
    const detail = readElectionDetail(id);
    if (detail?.data) out[id] = detail.data;
  }
  res.json({ data: out });
});

// Nome e avatar dei giocatori indicati — vedi resolveUsersLite.
app.get('/users-lite', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ data: {} });
  try {
    res.json({ data: await resolveUsersLite(ids) });
  } catch (err) {
    console.error('[users-lite] richiesta fallita:', err.message);
    res.json({ data: {} });
  }
});

// Quanti cittadini ha ogni nazione ADESSO (censimento, vedi pollCitizens),
// piu' quanti si sono registrati nelle ultime 24 ore e negli ultimi 7 giorni.
// Gli elenchi di userId restano sul server: al client servono i conteggi.
app.get('/citizens', (req, res) => {
  const cache = readCache(CITIZENS_FILE, { fetchedAt: null, data: {} });
  const out = {};
  for (const [countryId, row] of Object.entries(cache.data || {})) {
    if (req.query.countryId && req.query.countryId !== countryId) continue;
    out[countryId] = { n: row.n || 0, new24h: row.new24h || 0, new7d: row.new7d || 0 };
  }
  res.json({ fetchedAt: cache.fetchedAt, data: out });
});

// Cittadini di UNA nazione con le loro statistiche (vedi citizenStats).
// `limit` taglia l'elenco ai piu' forti per danno settimanale: il client
// non ha bisogno di 3.500 righe tutte insieme, e la risposta resta sotto
// il centinaio di KB.
app.get('/country-citizens', (req, res) => {
  const countryId = String(req.query.countryId || '');
  if (!countryId) return res.status(400).json({ error: 'countryId mancante' });
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 5000);

  const census = readCache(CITIZENS_FILE, { fetchedAt: null, data: {} });
  const row = census.data?.[countryId];
  if (!row) return res.json({ fetchedAt: census.fetchedAt, total: 0, known: 0, data: [] });

  const userCountries = readCache(MU_USER_COUNTRIES_FILE, { data: {} }).data || {};
  const out = [];
  for (const id of row.ids || []) {
    const entry = userCountries[id];
    const st = entry?.[4];
    if (!st) continue;              // skill/stat non ancora risolte per questo utente
    out.push({
      id,
      u: st[0], a: st[1], lv: st[2], mr: st[3],
      wk: st[4], dmg: st[5], w: st[6], b: st[7], atk: st[8], seen: st[9],
      // classifyPlaystyle qui dentro ritorna il codice compatto ('w'/'e'/
      // 'm'/'u', vedi muPlaystyle), non l'oggetto della gemella client:
      // si espande al nome che il client usa.
      ps: PS_CODE[entry[2]] || null,
    });
  }
  out.sort((a, b) => (b.wk || 0) - (a.wk || 0));
  res.json({
    fetchedAt: census.fetchedAt,
    total: row.n || (row.ids?.length ?? 0),
    known: out.length,
    data: out.slice(0, limit),
  });
});

app.get('/diplomacy', (req, res) => res.json(readCache('diplomacy', { fetchedAt: null, data: [] })));
app.get('/battles', (req, res) => res.json(readCache('battles', { fetchedAt: null, data: [] })));
app.get('/battle-regions', (req, res) => res.json(readCache('battle-regions', { fetchedAt: null, data: [] })));

app.get('/mu-directory', (req, res) => res.json(readCache('mu-directory', { fetchedAt: null, data: [] })));
app.get('/mu-playstyle-by-country', (req, res) => res.json(readCache('mu-playstyle-by-country', { fetchedAt: null, data: {} })));
// Scatto del danno settimanale al cambio giorno di gioco — vedi
// snapshotDailyDamage. { takenAt, tz, byCountry: {countryId: danno} }
app.get('/daily-damage', (req, res) => res.json(readCache(DAILY_DAMAGE_FILE, { takenAt: null, tz: DAILY_DAMAGE_TZ, byCountry: {}, byMu: {} })));

// Storico di UNA nazione: [[ts, war, eco, mixed, undecided, known], ...].
// Una nazione per richiesta e non tutto insieme: il file intero è di qualche
// MB, la serie di un paese sono decine di KB. `since` (epoch ms) taglia la
// coda vecchia lato server, così il client non scarica un mese per
// disegnare un confronto di 24 ore.
//
// `countryIds` (elenco separato da virgole) serve al pannello ALLEANZA, che
// somma i movimenti di tutte le nazioni membre: una richiesta sola invece di
// una per nazione, perche' ogni richiesta rilegge e riparsa da zero l'intero
// file di storico (qualche MB) — ventuno richieste in parallelo per un blocco
// grande sarebbero ventuno parse. La risposta in quel caso e' un oggetto
// { countryId: serie }, non un array: forma diversa apposta, cosi' un client
// che chiede `countryId` (singolo) non riceve mai qualcosa di inatteso.
app.get('/mu-playstyle-history', (req, res) => {
  const { countryId, countryIds } = req.query;
  const cache = readCache(MU_PLAYSTYLE_HISTORY_FILE, { fetchedAt: null, data: {} });
  const since = req.query.since ? Number(req.query.since) : 0;
  const seriesOf = id => (cache.data[id] || []).filter(row => row[0] >= since);

  if (countryIds) {
    const ids = String(countryIds).split(',').map(s => s.trim()).filter(Boolean).slice(0, MU_PLAYSTYLE_HISTORY_MAX_IDS);
    const data = {};
    for (const id of ids) data[id] = seriesOf(id);
    return res.json({ fetchedAt: cache.fetchedAt, data });
  }

  if (!countryId) return res.json({ fetchedAt: cache.fetchedAt, data: [] });
  res.json({ fetchedAt: cache.fetchedAt, countryId, data: seriesOf(countryId) });
});

app.get('/ticker', (req, res) => {
  const storico = readCache('ticker-history', []);
  const since = req.query.since ? Number(req.query.since) : 0;
  res.json(storico.filter(e => e.timestamp >= since));
});

// ── /ticker/summary — versione AGGREGATA di /ticker ────────────────────────
// Perché esiste: il client non usa i singoli eventi di popolazione/tesoro,
// li aggrega per nazione su una finestra e mostra un solo messaggio per
// nazione. Scaricare l'intero storico grezzo per farlo significa spedire
// megabyte (misurato: 1,4 MB già con 43 ore di storico, e la ritenzione è a
// 14 giorni) ogni 5 minuti a ogni browser — su mobile è insostenibile.
// Qui l'aggregazione la fa il server, una volta, e manda qualche KB.
//
// L'aggregazione è la STESSA di src/app/newsTicker.js:_aggregate — se ne
// tocchi una vanno allineate entrambe:
//   - popolazione: additiva -> ultimo.value - primo.prevValue (esatto), o
//     somma dei delta per le voci vecchie senza value/prevValue;
//   - tesoro: variazioni PERCENTUALI successive, che non si sommano -> si
//     compongono moltiplicando i fattori (fallback), o valore assoluto.
// Le soglie di visualizzazione (MIN_TREASURY_PCT) e il filtro sulle top N
// nazioni restano al client: qui si aggrega e basta.
//
// Query: ?since=<ts>            finestra degli eventi PUNTUALI (guerre/sworn)
//        &windows=<ts1>,<ts2>   una o più finestre da aggregare
function _aggregateTickerWindow(events, sinceTs) {
  const pop = new Map();    // countryId -> { delta, firstPrev, last }
  const wealth = new Map(); // countryId -> { factor, firstPrev, last }

  for (const e of events) {
    if (!(e.timestamp >= sinceTs)) continue;
    if (e.category === 'population') {
      const cur = pop.get(e.countryId) || { delta: 0, firstPrev: null, last: null };
      if (typeof e.delta === 'number') cur.delta += e.delta;
      if (typeof e.prevValue === 'number' && cur.firstPrev === null) cur.firstPrev = e.prevValue;
      if (typeof e.value === 'number') cur.last = e.value;
      pop.set(e.countryId, cur);
    } else if (e.category === 'wealth') {
      const cur = wealth.get(e.countryId) || { factor: 1, firstPrev: null, last: null };
      if (typeof e.pct === 'number') cur.factor *= (1 + e.pct / 100);
      if (typeof e.prevValue === 'number' && cur.firstPrev === null) cur.firstPrev = e.prevValue;
      if (typeof e.value === 'number') cur.last = e.value;
      wealth.set(e.countryId, cur);
    }
  }

  const population = {};
  for (const [id, v] of pop) {
    const exact = (v.firstPrev !== null && v.last !== null) ? v.last - v.firstPrev : null;
    const d = exact !== null ? exact : v.delta;
    if (d) population[id] = d;
  }

  const wealthPct = {};
  for (const [id, v] of wealth) {
    const exact = (v.firstPrev !== null && v.last !== null && v.firstPrev !== 0)
      ? (v.last - v.firstPrev) / Math.abs(v.firstPrev) * 100
      : null;
    const pct = exact !== null ? exact : (v.factor - 1) * 100;
    // Arrotondato a 3 decimali: oltre è rumore, e ogni cifra in più è peso
    // in rete moltiplicato per il numero di nazioni e di finestre.
    const rounded = Math.round(pct * 1000) / 1000;
    if (rounded) wealthPct[id] = rounded;
  }

  return { population, wealth: wealthPct };
}

app.get('/ticker/summary', (req, res) => {
  const storico = readCache('ticker-history', []);
  const windows = String(req.query.windows || '')
    .split(',')
    .map(w => Number(w))
    .filter(w => Number.isFinite(w) && w > 0);
  const since = req.query.since ? Number(req.query.since) : Math.min(...windows, Date.now());

  // Un solo passaggio sullo storico per isolare la parte utile: tutto ciò
  // che è più vecchio della finestra più larga richiesta non serve a niente.
  const oldest = Math.min(since, ...(windows.length ? windows : [since]));
  const recenti = storico.filter(e => e.timestamp >= oldest);

  // Eventi puntuali: hanno un istante e un testo proprio, vanno mandati
  // com'è (sono poche decine, non è quello il peso).
  const punctual = recenti.filter(e =>
    (e.category === 'war' || e.category === 'sworn_new' || e.category === 'sworn_removed' || e.category === 'game_event')
    && e.timestamp >= since);

  const aggregates = {};
  for (const w of windows) aggregates[w] = _aggregateTickerWindow(recenti, w);

  res.json({ now: Date.now(), oldestEvent: recenti.length ? recenti[0].timestamp : null, punctual, aggregates });
});

// WarEra+ nuovi — time machine
app.get('/region-history/range', (req, res) => {
  const keyframes = readCache(REGION_KEYFRAMES_FILE, []);
  const events = readCache(REGION_EVENTS_FILE, []);
  if (!keyframes.length) return res.json({ min: null, max: null });
  const allTs = [...keyframes.map(k => k.ts), ...events.map(e => e.ts), Date.now()];
  res.json({ min: Math.min(...allTs), max: Math.max(...allTs) });
});

app.get('/region-history/at', (req, res) => {
  const ts = req.query.ts ? Number(req.query.ts) : Date.now();
  const keyframes = readCache(REGION_KEYFRAMES_FILE, []);
  const events = readCache(REGION_EVENTS_FILE, []);
  const result = _reconstructRegionsAt(keyframes, events, ts);
  res.json({ requestedTs: ts, baseTs: result.ts, regions: result.regions });
});

app.get('/region-history/contested', (req, res) => res.json(readCache('region-contest-counts', { fetchedAt: null, data: {} })));

app.get('/region-history/war-intensity', (req, res) => res.json(readCache('region-war-intensity', { fetchedAt: null, data: {} })));

app.get('/region-history/events', (req, res) => {
  const since = req.query.since ? Number(req.query.since) : 0;
  const until = req.query.until ? Number(req.query.until) : Date.now();
  const events = readCache(REGION_EVENTS_FILE, []);
  res.json(events.filter(e => e.ts >= since && e.ts <= until));
});

app.get('/bootstrap-status', (req, res) => {
  const st = readCache(BOOTSTRAP_STATE_FILE, { cursor: null, done: false, finalized: false, pagesFetched: 0 });
  const battlesFetched = readCache(BOOTSTRAP_RAW_FILE, []).length;
  res.json({ ...st, battlesFetched });
});

app.get('/region-history/external-status', (req, res) => {
  res.json(readCache(EXTERNAL_HISTORY_STATUS_FILE, {
    fetchedAt: null, generatedAt: null, externalEventsCount: 0, externalLastTs: null, bridgeEventsCount: 0,
  }));
});

app.get('/credit-profiles', (req, res) => res.json(readCache('credit-profiles', { fetchedAt: null, data: {} })));

// Radar dei proxy: punteggio completo per nazione, con le evidenze che lo
// compongono. Il client lo innesta su quello che ha calcolato da solo
// (src/proxy/radar.js: applyServerIndex) e se questo non risponde resta il
// suo — degrada, non si rompe.
app.get('/proxy-index', (req, res) => res.json(readProxyIndex()));

// ═══════════════════════════════════════════════════════════════════════
// PROXY tRPC — sostituisce il Worker Cloudflare per le chiamate del CLIENT
// ═══════════════════════════════════════════════════════════════════════
// Perche' esiste: il Worker Cloudflare (politicalview-proxy) e' un
// passthrough verso api2.warera.io che aggiunge `X-API-Key` server-side,
// e il piano gratuito ha un tetto di 100.000 richieste al giorno. Il tool
// lo ha superato per la prima volta il 2026-08-24. Il tetto conta le
// richieste, quindi cresce col numero di utenti: e' un limite strutturale,
// non un picco da smussare.
//
// Questa route fa ESATTAMENTE quello che fa il Worker — stesso upstream
// (api2, non api6: e' quello che il Worker usa), stesso header, stesso
// passthrough di status e body — ma su un server che non ha quel tetto.
// Il client la preferisce e ricade sul Worker se non risponde
// (src/diplomacy/config.js: TRPC_PROXY_BASE), quindi il Worker resta
// deployato come rete di sicurezza: se questo VPS cade, si torna al
// comportamento precedente invece di rompersi. Stessa regola di tutto il
// resto di questo file (vedi cacheClient.js).
//
// NB il token NON e' nel codice: si legge da `WARERA_API_TOKEN`
// nell'ambiente di pm2 (equivalente del secret Cloudflare). Senza, la
// route funziona lo stesso ma senza key: rate limit di WarEra a 100/min
// invece di 500 e 401 sui tre endpoint token-gated dell'Ottimizzatore
// industriale. `/health` dice se e' caricato — mai il valore.
//
// Da montare PRIMA di /health e dopo gli altri endpoint: il path e'
// /trpc/* per specchiare quello del Worker, cosi' lato client basta
// cambiare la base URL e nient'altro.
const TRPC_UPSTREAM = 'https://api2.warera.io/trpc';
const PROXY_TIMEOUT_MS = 25000;
const WARERA_API_TOKEN = process.env.WARERA_API_TOKEN || '';

// Freno per IP: qui non c'e' Cloudflare davanti a fermare gli abusi, e
// questa route e' un proxy pubblico verso un'API con la NOSTRA key (stessa
// esposizione che ha oggi il Worker, non una nuova — ma li' c'era uno
// scudo). Il tetto e' volutamente alto: un utente vero, col muro battaglia
// aperto e i marker sulla mappa, sta sotto le ~60 richieste/minuto, e piu'
// utenti possono condividere lo stesso IP (NAT domestico, scuola, mobile).
// Serve solo a fermare uno script impazzito, non a fare da rate limit fine:
// quello vero lo fa WarEra col suo 500/min sul token.
const PROXY_RATE_WINDOW_MS = 60 * 1000;
const PROXY_RATE_MAX = 1200;
const _proxyHits = new Map(); // ip -> { count, windowStart }

function _proxyRateExceeded(ip) {
  const now = Date.now();
  const rec = _proxyHits.get(ip);
  if (!rec || now - rec.windowStart >= PROXY_RATE_WINDOW_MS) {
    _proxyHits.set(ip, { count: 1, windowStart: now });
    return false;
  }
  rec.count++;
  return rec.count > PROXY_RATE_MAX;
}

// La mappa cresce con gli IP visti: ripulita ogni 5 minuti dalle finestre
// scadute, altrimenti e' un leak lento su un processo che sta su per mesi.
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of _proxyHits) {
    if (now - rec.windowStart >= PROXY_RATE_WINDOW_MS) _proxyHits.delete(ip);
  }
}, 5 * 60 * 1000).unref?.();

async function _trpcProxy(req, res) {
  const ip = req.headers['x-real-ip'] || req.ip || 'sconosciuto';
  if (_proxyRateExceeded(ip)) {
    res.status(429).set('Retry-After', '60').send('Too many requests');
    return;
  }

  // nginx toglie /warera-cache, il mount app.use('/trpc') toglie /trpc:
  // qui req.path e' gia' '/battle.getBattles', da appendere all'upstream.
  const suffix = req.path;
  const search = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  const target = TRPC_UPSTREAM + suffix + search;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS);
  try {
    const headers = {
      // `identity`: stesso accorgimento del Worker — con la compressione
      // attiva i body di errore di WarEra tornavano corrotti.
      'Accept-Encoding': 'identity',
    };
    if (WARERA_API_TOKEN) headers['X-API-Key'] = WARERA_API_TOKEN;

    const init = { method: req.method, headers, signal: controller.signal };
    if (req.method === 'POST') {
      headers['Content-Type'] = req.headers['content-type'] || 'application/json';
      init.body = await _readRawBody(req);
    }

    const upstream = await fetch(target, init);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.status(upstream.status);
    res.set('Content-Type', upstream.headers.get('content-type') || 'application/json');
    // Il 429 di WarEra deve arrivare al client COME 429, con il suo
    // Retry-After: e' su quello che trpcBatch calcola il backoff.
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) res.set('Retry-After', retryAfter);

    // Stesso criterio del middleware gzip in testa al file (che intercetta
    // solo res.json, non res.send: qui il body e' gia' un Buffer grezzo).
    const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (!wantsGzip || buf.length < GZIP_MIN_BYTES) return res.send(buf);
    zlib.gzip(buf, (err, gz) => {
      if (err) return res.send(buf);
      res.set('Content-Encoding', 'gzip');
      res.set('Vary', 'Accept-Encoding');
      res.send(gz);
    });
  } catch (err) {
    // 502, non 500: il client deve distinguere "il proxy non ce l'ha fatta"
    // (-> ricadi sul Worker) da un errore applicativo.
    console.error('[proxy] fallito:', req.path.slice(0, 120), '-', err.message);
    if (!res.headersSent) res.status(502).send('Proxy error: ' + err.message);
  } finally {
    clearTimeout(timer);
  }
}

/** Body grezzo della richiesta: qui non c'e' express.json() (voluto — il
 *  proxy deve inoltrare i byte esatti che ha ricevuto, non un JSON
 *  ri-serializzato). */
function _readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// `app.use` e non `app.get('/trpc/*')`: qui gira Express 5, dove i wildcard
// devono essere nominati (`/trpc/*splat`) e la vecchia forma fa fallire
// l'avvio. Montato su prefisso funziona in entrambe le versioni, e dentro
// l'handler `req.path` e' gia' la parte DOPO /trpc.
app.use('/trpc', _trpcProxy);

app.get('/health', (req, res) => res.json({
  status: 'ok',
  now: Date.now(),
  // Solo se c'e', mai il valore: serve a verificare dopo un deploy che
  // pm2 abbia davvero l'env var, senza doverla stampare.
  trpcProxy: { ready: true, apiKey: WARERA_API_TOKEN ? 'caricata' : 'MANCANTE' },
}));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Cache server WarEra+ in ascolto su http://127.0.0.1:${PORT}`);
});