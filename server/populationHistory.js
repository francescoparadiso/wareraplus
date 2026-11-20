/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — La popolazione nel tempo
   -----------------------------------------------------------------------
   Richiesta dell'utente (2026-11-20): «un grafico sull'andamento della
   popolazione totale nel tempo». Il numero è quello che il gioco chiama
   popolazione di una nazione, `rankings.countryActivePopulation`: i
   cittadini ATTIVI (chi non si collega da 3 giorni esce dal conto e ci
   rientra quando torna). La somma su tutte le nazioni è la popolazione
   attiva del mondo. Nessuna procedura la dà nel tempo: `country.*` dice
   quanto vale ADESSO, e `rankingSnapshot.getHistory` (v0.28.3) parte dal
   16 novembre 2026 e va chiesto nazione per nazione.

   ── ZERO FETCH ─────────────────────────────────────────────────────────
   Lo scatto legge la cache `countries`, che il server rinfresca già ogni
   10 minuti, e si fa a ogni giro della diplomazia (ogni 15): stessa scelta
   di dayHistory.js e damageTimeline.js.

   ── COSA SI TIENE ──────────────────────────────────────────────────────
     · `hours`: per ogni ora UTC ('YYYY-MM-DDTHH') il totale del mondo,
       l'ultimo letto in quell'ora;
     · `days`: per ogni giorno UTC il valore di ogni nazione, l'ultimo letto;
     · `hc` (dal 2026-11-20, per il grafico di ogni nazione): per ogni ora
       UTC il valore di ogni nazione, come array allineato a `cids` (null
       dove manca), così 90 giorni sono ~390.000 numeri e non altrettante
       chiavi in RAM.
   I primi due crescono di poco (8.760 numeri l'anno il primo, ~180 il
   secondo al giorno, ~2 MB l'anno): non si potano, come gli altri archivi
   che non si possono rifare (vedi «PAVIMENTO» in CLAUDE.md). `hc` sì, a
   ORE_NAZIONE_GIORNI: oltre quel limite di una nazione resta il valore di
   ogni giorno in `days`, si perde solo il dettaglio dentro la giornata.

   ── I PRIMI 14 GIORNI ──────────────────────────────────────────────────
   Il ticker (`ticker-history`) tiene da due settimane un evento per ogni
   cambio di popolazione di una nazione, con il valore di prima e quello
   di dopo, letti dalla stessa cache ogni 15 minuti. Partendo dai valori di
   adesso e disfacendo gli eventi all'indietro si ritrovano i valori di
   ogni ora: non è una stima, è la stessa serie letta a ritroso. Lo si fa
   UNA volta, quando l'archivio è vuoto, e la risposta dice da quando a
   quando le ore sono ricostruite (`rebuiltFrom`/`rebuiltTo`). Prima
   dell'inizio del ticker non esiste niente, e la serie parte da lì.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'population-history';
const HOUR_MS = 3600 * 1000;
// Deve coincidere con TICKER_RETENTION_MS del server: prima di questo
// istante il ticker non ha eventi, quindi la ricostruzione non va oltre.
const TICKER_GIORNI = 14;
// Le ore per nazione (`hc`): 90 giorni, poi resta il giorno (vedi testata).
const ORE_NAZIONE_GIORNI = 90;

const oraDi = (ms) => new Date(ms).toISOString().slice(0, 13);
const giornoDi = (ms) => new Date(ms).toISOString().slice(0, 10);
const popDi = (n) => {
  const v = Number(n?.rankings?.countryActivePopulation?.value);
  return Number.isFinite(v) ? v : null;
};

let _mem = null;
let _cacheRisposta = new Map();   // countryId|'' → risposta (si azzera a ogni scatto)

function initPopulationHistory(tools) {
  deps = tools;
}

function _read() {
  if (_mem) return _mem;
  _mem = deps.readCache(FILE, null) || { startedAt: null, rebuiltFrom: null, rebuiltTo: null, hours: {}, days: {} };
  if (!_mem.hours) _mem.hours = {};
  if (!_mem.days) _mem.days = {};
  if (!_mem.cids) _mem.cids = [];
  if (!_mem.hc) _mem.hc = {};
  return _mem;
}

function _write(store) {
  _mem = store;
  _cacheRisposta = new Map();
  deps.writeCache(FILE, store, { compact: true });
}

/** I valori di adesso, nazione per nazione (solo chi ha un numero). */
function _valori(countries) {
  const out = {};
  for (const n of countries || []) {
    const v = popDi(n);
    if (n?._id && v != null) out[n._id] = v;
  }
  return out;
}

const _somma = (valori) => Object.values(valori).reduce((s, v) => s + v, 0);

/** {cid: v} → array allineato a store.cids (le nazioni nuove si accodano). */
function _riga(store, valori) {
  for (const cid of Object.keys(valori)) if (!store.cids.includes(cid)) store.cids.push(cid);
  return store.cids.map((cid) => (valori[cid] ?? null));
}

/* La ricostruzione a ritroso dal ticker (vedi testata). Gli eventi si
   disfano dal più recente: `valori` è, a ogni passo, lo stato DOPO tutti
   gli eventi rimasti. Il totale di un'ora è lo stato alla sua fine. */
function _ricostruisci(store, valoriOra, adesso) {
  const eventi = (deps.readCache('ticker-history', []) || [])
    .filter((e) => e?.category === 'population' && e.countryId && Number.isFinite(e.prevValue) && Number.isFinite(e.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  const inizio = adesso - TICKER_GIORNI * 24 * HOUR_MS;
  const valori = { ...valoriOra };
  let k = 0;
  let ore = 0;
  let oreNaz = 0;
  // Dall'ora PRIMA di quella corrente (quella la scrive lo scatto) all'indietro.
  for (let fine = Math.floor(adesso / HOUR_MS) * HOUR_MS; fine > inizio; fine -= HOUR_MS) {
    while (k < eventi.length && eventi[k].timestamp >= fine) {
      valori[eventi[k].countryId] = eventi[k].prevValue;
      k++;
    }
    const ora = oraDi(fine - 1);
    if (store.hours[ora] == null) { store.hours[ora] = _somma(valori); ore++; }
    if (!store.hc[ora]) { store.hc[ora] = _riga(store, valori); oreNaz++; }
    // Il giorno si chiude con la sua ultima ora.
    if (ora.endsWith('T23')) {
      const g = ora.slice(0, 10);
      if (!store.days[g]) store.days[g] = { ...valori };
    }
  }
  if (oreNaz) {
    store.hcRebuiltFrom = Math.floor(inizio / HOUR_MS) * HOUR_MS + HOUR_MS;
    store.hcRebuiltTo = Math.floor(adesso / HOUR_MS) * HOUR_MS;
  }
  if (ore) {
    store.rebuiltFrom = Math.floor(inizio / HOUR_MS) * HOUR_MS + HOUR_MS;
    store.rebuiltTo = Math.floor(adesso / HOUR_MS) * HOUR_MS;
  }
  console.log(`[population] ricostruite ${ore} ore del mondo e ${oreNaz} per nazione dal ticker (${eventi.length} eventi)`);
}

/** Lo scatto: chiamato dopo ogni giro della diplomazia con le nazioni in cache. */
function snapshotPopulation(countries) {
  if (!deps) return;
  try {
    const valori = _valori(countries);
    // Un giro con metà delle nazioni senza numero darebbe un crollo finto.
    const prima = Object.keys(_read().days[giornoDi(Date.now())] || {}).length;
    if (Object.keys(valori).length < Math.max(50, prima * 0.9)) {
      console.warn(`[population] solo ${Object.keys(valori).length} nazioni con popolazione: scatto saltato`);
      return;
    }
    const store = _read();
    const adesso = Date.now();
    // Le ore per nazione sono arrivate dopo il primo deploy: si ricostruiscono
    // anche se quelle del mondo ci sono già (la funzione non tocca le ore piene).
    if (!Object.keys(store.hours).length || !Object.keys(store.hc).length) _ricostruisci(store, valori, adesso);
    store.hours[oraDi(adesso)] = _somma(valori);
    store.hc[oraDi(adesso)] = _riga(store, valori);
    const limite = oraDi(adesso - ORE_NAZIONE_GIORNI * 24 * HOUR_MS);
    for (const o of Object.keys(store.hc)) if (o < limite) delete store.hc[o];
    store.days[giornoDi(adesso)] = valori;
    if (!store.startedAt) store.startedAt = adesso;
    _write(store);
  } catch (err) {
    console.error('[population] scatto fallito:', err.message);
  }
}

/** /population-history[?countryId=]: il mondo ora per ora, e se chiesta una
 *  nazione giorno per giorno. Tempi in ms (inizio dell'ora / mezzogiorno UTC). */
function readPopulationHistory(countryId = null) {
  if (!deps) return { available: false };
  const chiave = countryId || '';
  if (_cacheRisposta.has(chiave)) return _cacheRisposta.get(chiave);
  const store = _read();
  const ore = Object.keys(store.hours).sort();
  if (!ore.length) return { available: false };
  const out = {
    available: true,
    startedAt: store.startedAt,
    rebuiltFrom: store.rebuiltFrom,
    rebuiltTo: store.rebuiltTo,
    world: ore.map((o) => [Date.parse(`${o}:00:00Z`), store.hours[o]]),
  };
  if (countryId) {
    out.countryId = countryId;
    out.country = Object.keys(store.days).sort()
      .filter((g) => store.days[g][countryId] != null)
      .map((g) => [Date.parse(`${g}T12:00:00Z`), store.days[g][countryId]]);
    // Ora per ora (ultimi ORE_NAZIONE_GIORNI): il client usa queste dove ci
    // sono e i giorni di `country` prima.
    const i = store.cids.indexOf(countryId);
    out.countryHours = i < 0 ? [] : Object.keys(store.hc).sort()
      .filter((o) => store.hc[o][i] != null)
      .map((o) => [Date.parse(`${o}:00:00Z`), store.hc[o][i]]);
    out.countryRebuiltFrom = store.hcRebuiltFrom || null;
    out.countryRebuiltTo = store.hcRebuiltTo || null;
  }
  _cacheRisposta.set(chiave, out);
  return out;
}

function statoPopulationHistory() {
  if (!deps) return null;
  const store = _read();
  const ore = Object.keys(store.hours).sort();
  return {
    ore: ore.length,
    dal: ore[0] || null,
    al: ore.at(-1) || null,
    ricostruiteFinoA: store.rebuiltTo ? new Date(store.rebuiltTo).toISOString() : null,
    ultimoTotale: ore.length ? store.hours[ore.at(-1)] : null,
    oreNazione: Object.keys(store.hc).length,
  };
}

module.exports = { initPopulationHistory, snapshotPopulation, readPopulationHistory, statoPopulationHistory };
