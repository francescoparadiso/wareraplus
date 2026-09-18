/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — La giornata storica: diplomazia e battaglie di un giorno
   -----------------------------------------------------------------------
   La time machine nasce con uno scope ridotto scritto in chiaro in testa a
   src/app/timeMachine.js: al click mostra SOLO ownership della regione,
   nome e bandiera, «niente popolazione/ricchezza/sviluppo del momento
   storico — quei dati non sono mai stati salvati nel tempo, mostrarli
   sarebbe fuorviante (sembrerebbero valori storici ma sarebbero quelli di
   OGGI)».

   Quel vincolo era vero e resta vero per tutto ciò che nessuno ha
   registrato. Per QUESTI quattro campi non lo è più:

       patti difensivi · guerre in corso · nemico giurato · tesoro

   perché l'archivio di un altro tool li ha salvati giorno per giorno da
   aprile 2026 (import/diplomazia.js), e da qui in avanti li salva questo
   modulo. Sono valori di QUEL giorno, non di oggi: è esattamente la
   differenza che lo scope originale proteggeva.

   ── ZERO FETCH ────────────────────────────────────────────────────────
   Lo scatto giornaliero non chiama WarEra: legge le cache che il server
   riempie già (`countries` per tesoro e guerre, `diplomacy` per patti e
   nemico giurato, `battles` per le battaglie aperte). Stessa scelta di
   damageTimeline.js — un dato in più che non costa una richiesta in più.

   ── I PATTI SONO PATTI, NON ALLEANZE ──────────────────────────────────
   `allies` nel dump importato è simmetrico ma NON forma cricche (misurato
   sul 17 settembre: 180 nazioni, zero coppie asimmetriche, il 72% dei
   triangoli mancante). Sono quindi patti difensivi a due, non membri di
   una stessa alleanza — cioè `defensivePacts` della procedura
   countryDiplomacy, che è quello che lo scatto scrive da qui in avanti.
   Le due meta' della serie dicono la stessa cosa, ed e' il motivo per cui
   si possono attaccare.

   ── LE BATTAGLIE: DUE META' CHE NON PORTANO LE STESSE COLONNE ─────────
   Le righe importate vengono da `battle_snapshot`, che tiene potenza dei
   due schieramenti, colpi e bilancio — ma NON il danno, NON le taglie e
   NON la regione. Gli scatti nostri leggono la cache `battles`, che ha
   anche il danno. Quindi una riga vecchia ha meno colonne di una nuova, e
   il client mostra quello che c'e': un campo assente resta assente, non
   diventa zero. Per il danno e i costi l'archivio vero resta
   battleArchive.js — questo e' "cosa stava succedendo quel giorno", non
   una seconda contabilita'.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE_DIPL = 'day-history-diplomacy';
const FILE_BATT = 'day-history-battles';
const TZ = 'Europe/Rome';

// Poco più di un anno: la serie importata parte dal 13 aprile 2026 e da lì
// cresce di ~180 righe di diplomazia e ~50 di battaglie al giorno.
const RETENTION_GIORNI = 400;

// I due file si rileggono ad ogni richiesta del client, e sono di qualche
// megabyte: la copia in memoria evita di riparsarli ogni volta. È sicuro
// perché l'unico che li scrive è questo processo, e la scrittura passa
// sempre da _write().
const _mem = new Map(); // nome file → oggetto

function initDayHistory(tools) {
  deps = tools;
}

function _read(nome) {
  if (_mem.has(nome)) return _mem.get(nome);
  const store = deps.readCache(nome, { fetchedAt: null, startedAt: null, days: {} });
  if (!store.days) store.days = {};
  _mem.set(nome, store);
  return store;
}

function _write(nome, store) {
  _mem.set(nome, store);
  deps.writeCache(nome, store, { compact: true });
}

/** Il giorno italiano, come `/daily-damage` e lo scatto della ricchezza. */
function giornoDi(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

function giornoMeno(giorno, quanti) {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - quanti);
  return d.toISOString().slice(0, 10);
}

function _pota(store, oggi) {
  const taglio = giornoMeno(oggi, RETENTION_GIORNI);
  for (const giorno of Object.keys(store.days)) if (giorno < taglio) delete store.days[giorno];
}

/**
 * Lo scatto del giorno. Gira alle 02:05 italiane, dopo il cambio giorno di
 * gioco e dopo il poll delle nazioni delle 02:00.
 *
 * Riscrive il giorno se c'è già: uno scatto ripetuto (riavvio pm2) deve
 * lasciare l'ultimo stato letto, non due righe per lo stesso giorno.
 */
function snapshotDay() {
  if (!deps) return;
  const oggi = giornoDi();

  const countriesCache = deps.readCache('countries', null);
  const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
  if (!countries.length) {
    console.warn('[day-history] nessuna nazione in cache: scatto saltato');
    return;
  }
  const diplCache = deps.readCache('diplomacy', null);
  const diplByCountry = new Map((diplCache?.data || []).map(d => [d.countryId, d.data]));

  // ── diplomazia ──────────────────────────────────────────────────────
  const righeDipl = countries.map(n => [
    n._id,
    [...(n.warsWith || [])].sort(),
    [...(diplByCountry.get(n._id)?.defensivePacts || [])].sort(),
    diplByCountry.get(n._id)?.swornEnemy?.enemy || null,
    // Il tesoro è countryWealth, non `money`: quest'ultimo è fermo da
    // mesi (vedi la nota nel README del server).
    n?.rankings?.countryWealth?.value ?? null,
  ]);

  const storeD = _read(FILE_DIPL);
  storeD.days[oggi] = righeDipl;
  storeD.fetchedAt = Date.now();
  if (!storeD.startedAt) storeD.startedAt = Date.now();
  _pota(storeD, oggi);
  _write(FILE_DIPL, storeD);

  // ── battaglie aperte ────────────────────────────────────────────────
  // Schema della riga, valido anche per l'import (import/battaglie.js):
  //   0 id · 1 tipo · 2 nome att · 3 codice att · 4 nome dif · 5 codice dif
  //   6 potenza att · 7 potenza dif · 8 colpi · 9 bilancio
  //   10 danno att · 11 danno dif
  // 6-9 li porta solo il dump, 10-11 solo gli scatti nostri: le due metà
  // riempiono colonne diverse, e quella che manca resta null.
  // I tornei restano fuori da entrambe le metà: sono fra giocatori, non
  // fra nazioni (l'import li riconosce dai due nomi "Unknown", qui non
  // hanno le due nazioni).
  const nome = new Map(countries.map(n => [n._id, n.name]));
  const codice = new Map(countries.map(n => [n._id, (n.code || '').toLowerCase()]));
  const battles = deps.readCache('battles', null)?.data || [];
  const righeBatt = battles.filter(b => b.attacker?.country && b.defender?.country).map(b => {
    const ac = b.attacker.country;
    const dc = b.defender.country;
    return [
      b._id,
      b.type || 'war',
      nome.get(ac) || null, codice.get(ac) || null,
      nome.get(dc) || null, codice.get(dc) || null,
      // Potenza: il dump la porta, la cache no — resta null e il client
      // non disegna la barra invece di disegnarla a zero.
      null, null,
      null,                                   // colpi: idem
      null,                                   // bilancio: idem
      b.attacker?.damages ?? null,            // danno: ce l'hanno solo gli scatti nostri
      b.defender?.damages ?? null,
    ];
  });

  const storeB = _read(FILE_BATT);
  storeB.days[oggi] = righeBatt;
  storeB.fetchedAt = Date.now();
  if (!storeB.startedAt) storeB.startedAt = Date.now();
  _pota(storeB, oggi);
  _write(FILE_BATT, storeB);

  console.log(`[day-history] scatto ${oggi}: ${righeDipl.length} nazioni, ${righeBatt.length} battaglie aperte`);
}

/** Il giorno più vecchio presente, o null. */
function _primoGiorno(store) {
  let primo = null;
  for (const giorno of Object.keys(store.days)) if (!primo || giorno < primo) primo = giorno;
  return primo;
}

/**
 * Quello che va al browser: un giorno solo.
 *
 * Il client ne chiede uno per posizione dello slider che l'utente ferma,
 * non uno per fotogramma di playback — per questo la risposta è per giorno
 * e non un blocco unico da tre mesi.
 */
function readDay(giorno) {
  const storeD = _read(FILE_DIPL);
  const storeB = _read(FILE_BATT);
  const chiesto = /^\d{4}-\d{2}-\d{2}$/.test(giorno || '') ? giorno : giornoDi();
  return {
    day: chiesto,
    diplomacy: storeD.days[chiesto] || null,
    battles: storeB.days[chiesto] || null,
    // Da quando in qua c'è qualcosa: prima di questo giorno una risposta
    // vuota significa "non stavo guardando", e il client lo dice invece di
    // mostrare una nazione senza né guerre né patti.
    coverageFrom: { diplomacy: _primoGiorno(storeD), battles: _primoGiorno(storeB) },
  };
}

/** Per /health. */
function statoDayHistory() {
  const storeD = _read(FILE_DIPL);
  const storeB = _read(FILE_BATT);
  const giorniD = Object.keys(storeD.days);
  const giorniB = Object.keys(storeB.days);
  return {
    diplomazia: {
      giorni: giorniD.length,
      primo: _primoGiorno(storeD),
      ultimo: giorniD.length ? giorniD.sort().at(-1) : null,
    },
    battaglie: {
      giorni: giorniB.length,
      primo: _primoGiorno(storeB),
      ultimo: giorniB.length ? giorniB.sort().at(-1) : null,
    },
    ultimoScatto: storeD.fetchedAt ? new Date(storeD.fetchedAt).toISOString() : null,
    retentionDays: RETENTION_GIORNI,
  };
}

/** Serve agli script di import: dopo aver scritto i file da fuori, la
 *  copia in memoria di questo processo è vecchia. In pratica non capita
 *  (l'import gira mentre il server è su, ma i file li rilegge al riavvio),
 *  ed è qui perché il giorno che capita il sintomo sarebbe "ho importato e
 *  non si vede niente". */
function forgetDayHistoryCache() {
  _mem.clear();
}

module.exports = {
  initDayHistory,
  snapshotDay,
  readDay,
  statoDayHistory,
  forgetDayHistoryCache,
};
