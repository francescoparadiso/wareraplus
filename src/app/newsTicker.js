/* ══════════════════════════════════════════════════════════════
   WarEra+ — News ticker diplomatico
   ------------------------------------------------------------------
   Componente NUOVO per la parte mappa/Diplomacy — ispirato al ticker
   già presente in Political (ticker.js, elezioni globali) ma con
   contenuti diversi e diversificati, "stile telegiornale":
     - battaglie in corso (nazioni più popolose)
     - elezioni in corso/imminenti (TUTTE le nazioni — le elezioni non
       sono limitate alle più popolose, su richiesta esplicita)
     - nuove guerre scoppiate di recente (nazioni più popolose)
     - cambi di sworn enemy di recente (nazioni più popolose)
     - variazione popolazione attiva di recente (idem)
     - variazione tesoro/ricchezza di recente (idem)

   Ogni categoria viene limitata a un tetto massimo (CAT_CAP) prima di
   mescolare tutto insieme: così una categoria molto numerosa (es. le
   guerre, se il mondo ne ha tante in corso) non monopolizza il ticker
   a scapito delle altre — il problema segnalato nella versione
   precedente, dove le guerre finivano per dominare quasi tutti gli
   slot disponibili.

   WarEra+ round 2: le ultime 4 categorie (guerre/sworn/popolazione/
   tesoro) NON si calcolano più confrontando con uno snapshot in
   localStorage (si perdeva cambiando dispositivo o svuotando i dati
   del browser, e non permetteva finestre di tempo precise). Ora
   arrivano già pronte come eventi dal server di cache
   (fetchTickerEventsViaCache, vedi cacheClient.js e
   server/warera-cache-server.js:pollTickerEvents) — che fa lo STESSO
   identico calcolo (stessi campi: warsWith, swornEnemy,
   countryActivePopulation, countryWealth/money) ma UNA volta sola,
   condiviso da tutti gli utenti, invece che uno storico diverso per
   ogni browser. "Recente" ora significa RECENT_WINDOW_MS (finestra
   fissa, uguale per tutti), non più "dall'ultima visita di QUESTO
   browser". Le battaglie e le elezioni restano fetch live come prima
   (non hanno bisogno di uno storico: mostrano lo stato ATTUALE).

   I testi delle notizie usano i template tradotti in shared/i18n.js
   (chiavi ticker_*) con sostituzione di variabili — solo i NOMI di
   nazioni/alleanze restano invariati (sono nomi propri, non si
   traducono).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { trpcBatch, fmtNumber } from '../diplomacy/utils.js';
import { fetchActiveBattles } from '../diplomacy/battleHeatmap.js';
import { fetchTickerEventsViaCache, fetchTickerSummaryViaCache } from '../diplomacy/cacheClient.js';
import { t } from '../shared/i18n.js';

const TOP_N = 15;
const CAT_CAP = 5; // max messaggi per categoria prima del mix finale
const REFRESH_MS = 5 * 60 * 1000;
// Finestra di "notizie recenti" per guerre/sworn/popolazione/tesoro — non
// più legata a una visita precedente (niente più localStorage), una
// finestra fissa uguale per tutti gli utenti. 48h invece di 24h per
// coprire comodamente anche chi non apre il tool tutti i giorni.
const RECENT_WINDOW_MS = 48 * 60 * 60 * 1000;

/* ── UTILS ── */
function toUTCTimestamp(dateStr) {
  if (!dateStr) return null;
  let iso = dateStr;
  if (!iso.endsWith('Z') && !iso.includes('+')) iso += 'Z';
  return new Date(iso).getTime();
}

function unwrapList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.docs)) return res.docs;
  if (Array.isArray(res.results)) return res.results;
  return [];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Limita una categoria a `max` messaggi, scegliendoli casualmente invece
// dei primi N (altrimenti sarebbero sempre gli stessi paesi/battaglie a
// comparire, ordinati per come li restituisce l'API).
function capCategory(msgs, max = CAT_CAP) {
  return shuffle(msgs).slice(0, max);
}

function getTopPopulousNations(n = TOP_N) {
  return [...state.nazioniGlobal]
    .filter(nation => nation?.rankings?.countryActivePopulation?.value != null)
    .sort((a, b) => (b.rankings.countryActivePopulation.value || 0) - (a.rankings.countryActivePopulation.value || 0))
    .slice(0, n);
}

/* ── BATTAGLIE IN CORSO (nazioni più popolose) ──
   Separata in fetch (dati grezzi, nessuna traduzione) + format (testo
   tradotto): così un cambio lingua può ri-generare i messaggi dalla
   cache senza rifare le chiamate di rete — vedi _rebuildMessages sotto. */
async function fetchRelevantBattles(topIds) {
  try {
    const battles = await fetchActiveBattles();
    return (battles || []).filter(b => topIds.has(b.attacker?.country) || topIds.has(b.defender?.country));
  } catch (_) {
    return [];
  }
}

function formatBattleMessages(battles) {
  const messages = [];
  battles.forEach(b => {
    const atk = state.nationMap.get(b.attacker?.country);
    const def = state.nationMap.get(b.defender?.country);
    if (!atk || !def) return;
    messages.push(t('ticker_battle', { a: atk.name, b: def.name }));
  });
  return messages;
}

/* ── ELEZIONI IN CORSO / IMMINENTI — TUTTE le nazioni, non solo le
   più popolose (richiesta esplicita: le elezioni vanno mostrate
   sempre, indipendentemente dalla popolazione della nazione).
   Anche qui separata in fetch + format, stesso motivo di cui sopra. ── */
async function fetchElectionsRaw(allNations) {
  try {
    const calls = allNations.map(n => ['election.getElections', { countryId: n._id }]);
    // trpcBatch chunka automaticamente oltre i 50 per POST (vedi utils.js),
    // quindi anche con 100+ nazioni restano poche richieste totali.
    const results = await trpcBatch(calls, { useWorker: true });
    return allNations.map((nation, idx) => ({ nation, items: unwrapList(results[idx]) }));
  } catch (_) {
    return [];
  }
}

function formatElectionMessages(electionsRaw) {
  const now = Date.now();
  const messages = [];
  electionsRaw.forEach(({ nation, items }) => {
    items.forEach(e => {
      const start = toUTCTimestamp(e.votesStartAt);
      const end = toUTCTimestamp(e.votesEndAt);
      if (!start || !end) return;
      const type = e.type === 'president' ? t('ticker_type_presidential') : (e.type === 'congress' ? t('ticker_type_congress') : e.type);
      if (now >= start && now <= end) {
        messages.push(t('ticker_election_live', { nation: nation.name, type }));
      } else if (now < start) {
        messages.push(t('ticker_election_candidacy', { nation: nation.name, type }));
      }
    });
  });
  return messages;
}

/* ── EVENTI SERVER-SIDE (guerre, sworn enemy, popolazione, tesoro) —
   letti dal server di cache invece che diffati localmente, limitati alle
   nazioni più popolose per la visualizzazione (il server li tiene TUTTI,
   il filtro "top N" resta solo qui). ── */
const PUNCTUAL_CATEGORIES = new Set(['war', 'sworn_new', 'sworn_removed']);
const EMPTY_AGG = { population: {}, wealth: {} };
const SUMMARY_RETRY_MS = 30 * 60 * 1000;
let _summaryUnavailableUntil = 0;

// WarEra+ perf (mobile) — questa funzione scaricava lo storico GREZZO degli
// eventi e lo aggregava nel browser: migliaia di micro-variazioni per
// mostrarne una decina di righe. Con la ritenzione del server portata a 14
// giorni quello scarico è diventato insostenibile — misurato: 843 KB per una
// finestra di 24h, 1,4 MB con l'ancora "ultima visita" indietro di due
// giorni, non compresso, ripetuto ad OGNI refresh (5 minuti) e destinato a
// crescere ogni giorno.
//
// Ora la somma per nazione la fa il server (/ticker/summary): la risposta
// sta in pochi KB e non cresce con lo storico. Il vecchio percorso resta come
// FALLBACK per il caso in cui il server non abbia ancora l'endpoint (il
// deploy sul VPS è manuale e indipendente da questo repo): stesso risultato,
// solo pagato caro.
async function fetchRecentStats() {
  // La finestra scaricata deve coprire la PIÙ AMPIA fra quelle che poi
  // vengono aggregate: quella fissa (RECENT_WINDOW_MS, guerre/sworn) e
  // quella dell'ultima visita, che può essere molto più indietro.
  const since = Math.min(Date.now() - RECENT_WINDOW_MS, _visitAnchor || Infinity);
  const w24 = Date.now() - DAY_MS;
  const wVisit = visitWindowTs();
  const windows = wVisit ? [w24, wVisit] : [w24];

  try {
    if (Date.now() < _summaryUnavailableUntil) throw new Error('/ticker/summary assente, ritento più tardi');
    const s = await fetchTickerSummaryViaCache(since, windows);
    _summaryUnavailableUntil = 0;
    return {
      punctual: s.punctual,
      agg24: s.aggregates[w24] || EMPTY_AGG,
      aggVisit: wVisit ? (s.aggregates[wVisit] || EMPTY_AGG) : null,
    };
  } catch (errSummary) {
    // Server ancora senza l'endpoint (il deploy sul VPS è manuale): inutile
    // riprovarci ogni 5 minuti e riempire la console di 404. Si riprova fra
    // mezz'ora, così una tab lasciata aperta ricomincia da sola a usare la
    // versione leggera appena il server viene aggiornato.
    _summaryUnavailableUntil = Date.now() + SUMMARY_RETRY_MS;
    try {
      const events = await fetchTickerEventsViaCache(since);
      return {
        punctual: events.filter(e => PUNCTUAL_CATEGORIES.has(e.category)),
        agg24: _aggregate(events, w24),
        aggVisit: wVisit ? _aggregate(events, wVisit) : null,
      };
    } catch (err) {
      console.warn('WarEra+ newsTicker: eventi server non disponibili:', err.message);
      return { punctual: [], agg24: EMPTY_AGG, aggVisit: null };
    }
  }
}

// WarEra+ (richiesta esplicita dell'utente: "sarebbe utile sapere quando
// sono successe alcune notizie, come quella del nemico giurato e delle
// dichiarazioni di guerra"). Solo per gli eventi PUNTUALI (guerra, nemico
// giurato): quelli aggregati su una finestra — popolazione e tesoro — non
// hanno un istante a cui appendere un orario, hanno un intervallo, e l'ora
// lì sarebbe fuorviante.
//
// Fuso orario: `toLocaleTimeString` senza `timeZone` esplicito usa già
// quello del dispositivo di chi guarda, che è la cosa chiesta ed è anche
// più utile di UTC (nessuna conversione mentale). Se l'evento non è di
// oggi si antepone la data breve, altrimenti "alle 16:53" su una notizia
// di tre giorni fa direbbe l'ora giusta ma lascerebbe intendere oggi.
// La lingua segue quella scelta nell'app: `document.documentElement.lang`
// è già tenuto aggiornato dallo switch lingua della shell.
function _fmtEventTime(ts) {
  if (!ts || !Number.isFinite(ts)) return '';
  const d = new Date(ts);
  const locale = document.documentElement.lang || undefined;
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return time;
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${time}`;
}

// Appende l'orario al messaggio già tradotto, invece di passarlo come
// segnaposto {time} dentro ogni stringa: le chiavi di traduzione delle
// guerre/sworn restano quelle di prima in tutte e 9 le lingue, e la
// parentesi è identica ovunque (un orario non ha bisogno di essere
// tradotto). Meno superficie da tenere in sync.
function _withTime(msg, ts) {
  const time = _fmtEventTime(ts);
  return time ? `${msg} (${time})` : msg;
}

function formatWarMessages(events, topIds) {
  const nameOf = id => state.nationMap.get(id)?.name || id;
  return events
    .filter(e => e.category === 'war' && topIds.has(e.countryId))
    .map(e => _withTime(t('ticker_new_war', { a: nameOf(e.countryId), b: nameOf(e.enemyId) }), e.timestamp));
}

function formatSwornMessages(events, topIds) {
  const nameOf = id => state.nationMap.get(id)?.name || id;
  return events
    .filter(e => (e.category === 'sworn_new' || e.category === 'sworn_removed') && topIds.has(e.countryId))
    .map(e => _withTime(e.category === 'sworn_new'
      ? t('ticker_sworn_new', { a: nameOf(e.countryId), b: nameOf(e.enemyId) })
      : t('ticker_sworn_removed', { a: nameOf(e.countryId), b: nameOf(e.enemyId) }), e.timestamp));
}

// WarEra+ — variazione popolazione attiva / tesoro, in DUE finestre distinte
// (richiesta esplicita dell'utente: tenere sia "rispetto a ieri" sia
// "dall'ultima visita").
//
// Prima qui si emetteva UN messaggio per OGNI evento del server. Guardando i
// dati veri quegli eventi sono micro-variazioni di un singolo poll
// (verificato sul server di cache: `delta: 1` cittadino, `pct: 0` sul
// tesoro), quindi producevano notizie senza contenuto tipo "Italy: +1
// cittadini attivi". Ora gli eventi vengono AGGREGATI per nazione su una
// finestra, e la stessa aggregazione viene fatta due volte con due finestre
// diverse — 24 ore fisse, e "da quando l'utente ha guardato l'ultima volta".
//
// Perché "ultima visita" torna a passare da localStorage dopo che era stato
// tolto (vedi nota in testa al file): quello che era sbagliato tenere nel
// browser era lo STORICO degli eventi (si perdeva cambiando dispositivo).
// Il MOMENTO dell'ultima visita è invece per definizione un dato locale di
// quel browser — non esiste un valore "condiviso" sensato. Qui in
// localStorage finisce solo un timestamp; gli eventi restano tutti sul
// server.
const DAY_MS = 24 * 60 * 60 * 1000;
// Sotto questa soglia la variazione di tesoro è rumore di arrotondamento:
// non merita uno slot nel ticker.
const MIN_TREASURY_PCT = 0.1;
// Ricaricare la pagina non è "una nuova visita": sotto questo scarto la
// sessione è considerata la stessa e l'ancora non si sposta, altrimenti dopo
// ogni F5 "dall'ultima visita" coprirebbe due minuti e non direbbe nulla.
const VISIT_SESSION_GAP_MS = 30 * 60 * 1000;
// Tetto all'ancora: oltre, "dall'ultima visita" diventerebbe un cumulo poco
// leggibile — e comunque il server non conserva lo storico all'infinito
// (vedi TICKER_RETENTION_MS in server/warera-cache-server.js).
const VISIT_MAX_AGE_MS = 14 * DAY_MS;
const VISIT_ANCHOR_KEY = 'we_ticker_visit_anchor';
const VISIT_SEEN_KEY = 'we_ticker_last_seen';

// Ancora della visita corrente, decisa UNA volta al boot e poi stabile per
// tutta la sessione (le chiamate successive di refreshNews non la spostano,
// altrimenti la finestra si accorcerebbe ad ogni giro). `null` = prima
// visita in assoluto da questo browser: nessun messaggio "dall'ultima
// visita", non ci sarebbe niente di sensato da confrontare.
let _visitAnchor = null;

function initVisitAnchor() {
  let seen = 0, anchor = 0;
  try {
    seen = Number(localStorage.getItem(VISIT_SEEN_KEY)) || 0;
    anchor = Number(localStorage.getItem(VISIT_ANCHOR_KEY)) || 0;
  } catch (err) { return; } // storage negato (modalità privata): si resta senza la finestra "ultima visita"

  const now = Date.now();
  if (!seen) {
    _visitAnchor = null; // prima visita: solo la finestra 24h
  } else if (now - seen >= VISIT_SESSION_GAP_MS) {
    _visitAnchor = seen; // sessione nuova: si confronta con quando avevo smesso di guardare
  } else {
    _visitAnchor = anchor || seen; // ricarica dentro la stessa sessione: ancora invariata
  }
  if (_visitAnchor) _visitAnchor = Math.max(_visitAnchor, now - VISIT_MAX_AGE_MS);

  try {
    if (_visitAnchor) localStorage.setItem(VISIT_ANCHOR_KEY, String(_visitAnchor));
    localStorage.setItem(VISIT_SEEN_KEY, String(now));
  } catch (err) { /* quota/privata: l'ancora resta valida per questa sessione */ }
}

// Inizio della finestra "dall'ultima visita", o null se quella categoria di
// notizie non ha senso in questa sessione: prima visita in assoluto, oppure
// ancora troppo recente perché un confronto dica qualcosa. Unico punto di
// verità — la usano sia il fetch (per sapere quali finestre chiedere al
// server) sia il formatting.
function visitWindowTs() {
  if (!_visitAnchor || Date.now() - _visitAnchor < 60 * 60 * 1000) return null;
  return _visitAnchor;
}

// Aggiorna solo "quando ho guardato l'ultima volta" (non l'ancora): serve a
// far sì che alla PROSSIMA sessione il confronto parta da quando l'utente ha
// davvero smesso di guardare, non da quando aveva aperto la pagina.
function touchLastSeen() {
  try { localStorage.setItem(VISIT_SEEN_KEY, String(Date.now())); } catch (err) { /* ignora */ }
}

// Aggrega gli eventi di UNA finestra per nazione. Due grandezze, due modi:
//  - popolazione: variazioni assolute di teste, additive → somma.
//  - tesoro: variazioni PERCENTUALI successive, che NON si sommano (+10%
//    poi +10% fa +21%, non +20%) → si compongono moltiplicando i fattori.
// Quando gli eventi portano i valori assoluti (`value`/`prevValue`, campi
// aggiunti al server) si usa direttamente `ultimo.value - primo.prevValue`:
// esatto e immune all'errore che si accumula componendo tanti passi
// arrotondati. Il ramo delta/pct resta per le voci vecchie, ancora in
// circolazione finché lo storico non si è rinnovato.
//
// NB: questa funzione è ora il solo percorso di FALLBACK (server senza
// /ticker/summary). Il calcolo qui e quello in
// server/warera-cache-server.js:_aggregateTickerWindow devono restare
// identici — stessa forma di ritorno { population: {id: delta}, wealth:
// {id: pct} }, senza filtri di visualizzazione (top N e soglia tesoro si
// applicano dopo, in _emit).
function _aggregate(events, sinceTs) {
  const pop = new Map();     // countryId -> { delta, firstPrev, last }
  const wealth = new Map();  // countryId -> { factor, firstPrev, last }

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
    if (pct) wealthPct[id] = pct;
  }

  return { population, wealth: wealthPct };
}

// Da un aggregato (server o fallback locale) ai messaggi tradotti. Qui —
// non nell'aggregazione — si applicano i filtri di VISUALIZZAZIONE: solo le
// nazioni più popolose, e solo variazioni di tesoro sopra la soglia di
// rumore.
function _emit(agg, topIds, nameOf, popKey, wealthKey) {
  if (!agg) return [];
  const messages = [];
  for (const [countryId, delta] of Object.entries(agg.population || {})) {
    if (!topIds.has(countryId) || !delta) continue;
    messages.push(t(popKey, {
      nation: nameOf(countryId),
      sign: delta > 0 ? '+' : '−',
      delta: fmtNumber(Math.abs(Math.round(delta))),
    }));
  }
  for (const [countryId, pct] of Object.entries(agg.wealth || {})) {
    if (!topIds.has(countryId) || Math.abs(pct) < MIN_TREASURY_PCT) continue;
    messages.push(t(wealthKey, {
      nation: nameOf(countryId),
      sign: pct > 0 ? '+' : '−',
      pct: Math.abs(pct).toFixed(1),
    }));
  }
  return messages;
}

// Finestra fissa 24h — "rispetto a ieri".
function formatStatsMessages(stats, topIds) {
  const nameOf = id => state.nationMap.get(id)?.name || id;
  return _emit(stats.agg24, topIds, nameOf, 'ticker_population_24h', 'ticker_treasury_24h');
}

// Finestra "dall'ultima visita" — categoria separata da quella 24h, così
// capCategory le limita indipendentemente e una non mangia gli slot
// dell'altra nel mix finale. Vuota quando l'ancora manca (prima visita) o è
// troppo recente perché il confronto dica qualcosa (vedi visitWindowTs).
function formatSinceVisitMessages(stats, topIds) {
  const nameOf = id => state.nationMap.get(id)?.name || id;
  return _emit(stats.aggVisit, topIds, nameOf, 'ticker_population_change', 'ticker_treasury_change');
}

/* ── RENDER (RAF, scroll continuo) — stesso principio del ticker di
   Political (ticker.js), riscritto qui per il nostro DOM/track. ── */
let _tickerMessages = [];
let _tickerPos = 0;
// WarEra+ fix: prima l'incremento era fisso PER CHIAMATA RAF
// (_tickerPos += 0.5 ad ogni frame), non per tempo reale trascorso.
// Quando il thread principale è occupato (es. eventi mousemove sulla
// mappa MapLibre, hover sui tooltip nazione/battaglia), il browser
// chiama requestAnimationFrame meno spesso — il ticker avanzava quindi
// di meno nello stesso tempo reale, apparendo "rallentato" muovendo il
// mouse. Ora la velocità è espressa in pixel/secondo e il movimento è
// calcolato dal tempo REALMENTE trascorso tra una chiamata e l'altra
// (delta-time), indipendentemente da quanti frame vengono saltati.
const _tickerSpeedPxPerSec = 30;
let _tickerLastFrameTime = 0;
let _tickerRunning = false;
let _tickerUnitWidth = 0;

function _tickerLoop(now) {
  if (!_tickerRunning) return;
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) { requestAnimationFrame(_tickerLoop); return; }

  if (!_tickerLastFrameTime) _tickerLastFrameTime = now;
  const deltaSeconds = Math.min((now - _tickerLastFrameTime) / 1000, 0.25); // clamp per evitare salti enormi dopo una pausa lunga (es. tab in background)
  _tickerLastFrameTime = now;

  // WarEra+ perf: niente scritture di stile (reflow) mentre la tab non è
  // visibile — deltaSeconds resta comunque aggiornato sopra così alla
  // ripresa non c'è un salto, semplicemente non si anima "a vuoto".
  if (!document.hidden && !track.matches(':hover')) {
    _tickerPos += _tickerSpeedPxPerSec * deltaSeconds;
    if (_tickerUnitWidth > 0 && _tickerPos >= _tickerUnitWidth) _tickerPos -= _tickerUnitWidth;
    track.style.transform = `translateX(${-_tickerPos}px)`;
  }
  requestAnimationFrame(_tickerLoop);
}

function _rebuildTrack() {
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) return;
  const msgs = _tickerMessages.length ? _tickerMessages : [t('ticker_no_news')];
  // Tripla ripetizione per avere sempre contenuto avanti durante il loop.
  const html = [...msgs, ...msgs, ...msgs]
    .map(msg => `<span class="wp-ticker-message">🔹 ${msg}</span><span class="wp-ticker-sep">✦</span>`)
    .join('');
  track.innerHTML = html;
  requestAnimationFrame(() => { _tickerUnitWidth = track.scrollWidth / 3; });
}

// WarEra+: dati grezzi dell'ultimo aggiornamento riuscito, tenuti in
// cache per poter ri-generare i messaggi TRADOTTI (_rebuildMessages)
// senza rifare le chiamate di rete quando cambia solo la lingua.
let _lastRawData = null;

async function refreshNews() {
  try {
    if (!state.nazioniGlobal?.length) return;
    const topNations = getTopPopulousNations();
    if (!topNations.length) return;
    const topIds = new Set(topNations.map(n => n._id));

    const [battles, electionsRaw, stats] = await Promise.all([
      fetchRelevantBattles(topIds),
      fetchElectionsRaw(state.nazioniGlobal), // TUTTE le nazioni
      fetchRecentStats(), // guerre/sworn/popolazione/tesoro, dal server di cache
    ]);

    // "Ho guardato fin qui": sposta solo il segnalino dell'ultima occhiata,
    // NON l'ancora di questa sessione (vedi initVisitAnchor) — serve perché
    // alla prossima apertura il confronto parta da quando l'utente ha
    // davvero smesso di guardare.
    touchLastSeen();

    _lastRawData = { topIds, battles, electionsRaw, stats };
    _rebuildMessages();
  } catch (err) {
    console.warn('WarEra+ newsTicker: errore aggiornamento', err);
  }
}

// Ricostruisce i messaggi (tradotti) dai dati grezzi già scaricati,
// SENZA alcuna chiamata di rete — usata sia dal refresh periodico (dopo
// il fetch) sia da un cambio lingua (dati invariati, cambia solo il
// testo). Rifare tutto refreshNews() ad ogni cambio lingua avrebbe
// richiesto nuove chiamate per TUTTE le nazioni (elezioni), rischiando
// di ricreare il problema dei 429 già risolto altrove.
function _rebuildMessages() {
  if (!_lastRawData) return;
  const { topIds, battles, electionsRaw, stats } = _lastRawData;

  const battleMsgsRaw = formatBattleMessages(battles);
  const electionMsgsRaw = formatElectionMessages(electionsRaw);
  const warMsgsRaw = formatWarMessages(stats.punctual, topIds);
  const swornMsgsRaw = formatSwornMessages(stats.punctual, topIds);
  const statsMsgsRaw = formatStatsMessages(stats, topIds);
  const sinceVisitMsgsRaw = formatSinceVisitMessages(stats, topIds);

  // Cap per categoria PRIMA di unire e mescolare: garantisce
  // diversificazione anche quando una categoria (tipicamente le
  // guerre) avrebbe molti più elementi delle altre.
  const mixed = [
    ...capCategory(battleMsgsRaw),
    ...capCategory(electionMsgsRaw),
    ...capCategory(warMsgsRaw),
    ...capCategory(swornMsgsRaw),
    ...capCategory(statsMsgsRaw),
    ...capCategory(sinceVisitMsgsRaw),
  ];
  const all = shuffle(mixed).slice(0, 30);
  _tickerMessages = all.length ? all : [t('ticker_no_news')];
  _rebuildTrack();
}

/* ══════════════════════════════════════════════════════════════
   Vista "News" (Approfondimenti) — richiesta esplicita dell'utente:
   "un notiziario con tutte le info del ticker".
   ------------------------------------------------------------------
   Il ticker mostra a rotazione un SOTTOINSIEME delle notizie (max 5 per
   categoria, mescolate, tagliate a 30 — vedi _rebuildMessages): serve a
   dare un assaggio, non l'elenco completo. La vista News mostra invece
   TUTTO, raggruppato per categoria e senza mescolare.

   Perché sta qui e non in newsView.js: le funzioni format* e i dati
   grezzi già scaricati (_lastRawData) vivono in questo modulo. Esporre
   i gruppi già formattati evita sia di duplicare la logica dei testi
   sia — soprattutto — di rifare le stesse chiamate di rete (le elezioni
   sono una chiamata per OGNI nazione: rifarle all'apertura della vista
   riaprirebbe il problema dei 429 che il batching ha risolto).
   ══════════════════════════════════════════════════════════════ */

// Chiavi stabili (non testi): la vista le traduce con il proprio
// dizionario, così aggiungere una lingua non tocca questo file.
export function getNewsGroups() {
  if (!_lastRawData) return null;
  const { topIds, battles, electionsRaw, stats } = _lastRawData;
  return [
    { key: 'battles', icon: '⚔️', messages: formatBattleMessages(battles) },
    { key: 'elections', icon: '🗳️', messages: formatElectionMessages(electionsRaw) },
    { key: 'wars', icon: '💥', messages: formatWarMessages(stats.punctual, topIds) },
    { key: 'sworn', icon: '🎯', messages: formatSwornMessages(stats.punctual, topIds) },
    { key: 'stats24', icon: '📊', messages: formatStatsMessages(stats, topIds) },
    { key: 'sinceVisit', icon: '👁️', messages: formatSinceVisitMessages(stats, topIds) },
  ];
}

// La vista News può essere aperta prima che il primo refresh del ticker
// sia arrivato (o dopo un fallimento): in quel caso rifà il giro una
// volta sola invece di mostrare una pagina vuota. Se i dati ci sono già,
// non tocca la rete.
export async function ensureNewsData({ force = false } = {}) {
  if (!force && _lastRawData) return getNewsGroups();
  await refreshNews();
  return getNewsGroups();
}

export function startNewsTicker() {
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) return;
  _tickerPos = 0;
  _tickerRunning = true;
  initVisitAnchor(); // PRIMA di refreshNews: decide da quando scaricare gli eventi
  requestAnimationFrame(_tickerLoop);
  refreshNews();
  setInterval(refreshNews, REFRESH_MS);

  // Senza questo, cambiando lingua i messaggi già mostrati restavano
  // nella lingua precedente fino al prossimo ciclo di aggiornamento (5
  // minuti). _rebuildMessages riformatta dai dati già scaricati, senza
  // rifare le chiamate di rete (che rifare per ogni cambio lingua
  // avrebbe rischiato di ricreare il problema dei 429 già risolto).
  window.addEventListener('wareraplus:langchange', () => { _rebuildMessages(); });
}
