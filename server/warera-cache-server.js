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

app.use(cors({
  origin: '*' // TODO: restringere all'URL vero del tool una volta online
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

// ---------------------------------------------------------------------------
// trpcBatch: stessa identica logica del tool (src/diplomacy/utils.js),
// portata lato server: combina più chiamate in un solo POST/GET batch,
// chunka automaticamente oltre 50, ritenta sui 429 con backoff esponenziale.
// ---------------------------------------------------------------------------
const MAX_BATCH = 50;
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

// Ticker storico: elezioni per ogni nazione, append-only (accumula storia
// più profonda di quella che il browser potrebbe mai tenere in cache)
async function pollElections() {
  try {
    const countriesCache = readCache('countries', null);
    const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
    if (!countries.length) { console.log('[poll] elections: nessuna nazione in cache ancora, salto'); return; }

    const calls = countries.map(n => ['election.getElections', { countryId: n._id }]);
    const results = await trpcBatch(calls, { useWorker: true });

    const storico = readCache('ticker-history', []);
    const idEsistenti = new Set(storico.map(e => e.id));
    const nuovi = [];
    countries.forEach((n, i) => {
      const items = Array.isArray(results[i]) ? results[i] : [];
      items.forEach(item => {
        const id = item.id || item._id || `${n._id}-${item.startedAt || item.createdAt}`;
        if (idEsistenti.has(id)) return;
        nuovi.push({
          id,
          category: 'election', // vedi nota in testa al file: retrocompatibile con le voci vecchie senza questo campo
          timestamp: item.startedAt || item.createdAt || Date.now(),
          countryId: n._id,
          raw: item,
        });
      });
    });

    const aggiornato = trimTickerHistory([...storico, ...nuovi]);
    writeCache('ticker-history', aggiornato, { compact: true });
    console.log(`[poll] elections/ticker aggiornato (+${nuovi.length})`);
  } catch (err) { console.error('[poll] elections fallito:', err.message); }
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
cron.schedule('8,23,38,53 * * * *', pollDiplomacy);                    // ogni 15 min, :08 (alimenta anche il ticker stats)
cron.schedule('1,4,7,10,13,16,19,22,25,28,31,34,37,40,43,46,49,52,55,58 * * * *', pollBattles); // ogni 3 min, :01
cron.schedule('2,7,12,17,22,27,32,37,42,47,52,57 * * * *', pollElections); // ogni 5 min, :02
cron.schedule('9,24,39,54 * * * *', pollGameEvents);                  // ogni 15 min, :09 (nota 6)
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

// Primo giro completo all'avvio (in ordine: countries prima, perché tutto
// il resto dipende dalla cache delle nazioni), così non si parte a vuoto.
(async () => {
  await pollCountries();
  await pollMap();
  await pollRegionsObject();
  await pollAlliances();
  await pollDiplomacy();
  await pollBattles();
  await pollElections();
  await pollGameEvents();
  // await pollBootstrapPage(); // disattivato, vedi nota sopra al cron.schedule commentato
  await pollExternalHistory(); // sync subito con spywarera invece di aspettare fino a 1h
})();

// ---------------------------------------------------------------------------
// ENDPOINT esposti al tool WarEra+ (nginx li smista da /warera-cache/*)
// ---------------------------------------------------------------------------
app.get('/countries', (req, res) => res.json(readCache('countries', { fetchedAt: null, data: [] })));
app.get('/map', (req, res) => res.json(readCache('map', { fetchedAt: null, data: [] })));
app.get('/regions', (req, res) => res.json(readCache('regions', { fetchedAt: null, data: [] })));
app.get('/alliances', (req, res) => res.json(readCache('alliances', { fetchedAt: null, data: [] })));
app.get('/diplomacy', (req, res) => res.json(readCache('diplomacy', { fetchedAt: null, data: [] })));
app.get('/battles', (req, res) => res.json(readCache('battles', { fetchedAt: null, data: [] })));
app.get('/battle-regions', (req, res) => res.json(readCache('battle-regions', { fetchedAt: null, data: [] })));

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

app.get('/health', (req, res) => res.json({ status: 'ok', now: Date.now() }));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Cache server WarEra+ in ascolto su http://127.0.0.1:${PORT}`);
});
