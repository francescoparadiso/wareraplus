/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Chi è arrivato e chi se n'è andato (trasferimenti di cittadini)
   -----------------------------------------------------------------------
   Richiesta dell'utente: «una lista di tutti i giocatori che si sono
   trasferiti o che hanno lasciato il paese negli ultimi 7 giorni».

   WarEra non pubblica niente del genere. Non esiste una procedura "chi ha
   cambiato nazione": `user.getUserLite` dice dove uno sta ADESSO, e basta.
   Un trasferimento quindi non è un dato che si scarica — è una DIFFERENZA
   fra due fotografie, e qualcuno deve aver scattato la prima.

   ── ZERO CHIAMATE NUOVE ────────────────────────────────────────────────
   Le fotografie ci sono già: `pollCitizens` (warera-cache-server.js) gira
   ogni ora alle :36 e ricostruisce l'elenco COMPLETO dei cittadini di ogni
   nazione (`user.getUsersByCountry`, non un campione — l'elenco vero).
   Quel giro finora buttava via tutto tranne il conteggio. Qui la sua
   mappa utente → nazione viene confrontata con quella dell'ora prima, e
   quello che cambia è, per definizione, un trasferimento.

   Costo: zero richieste a WarEra, un file di snapshot (~17.000 voci) e un
   file di eventi che cresce di qualche decina di righe al giorno.

   ── ⚠️ ACCUMULA, NON RECUPERA ──────────────────────────────────────────
   Come i bonifici fra tesori e come il danno orario: prima del primo
   scatto non c'è niente da confrontare, e a ritroso non esiste da nessuna
   parte. I sette giorni pieni arrivano una settimana dopo il deploy, e
   un'ora saltata è persa. `coverageFrom` dice da quando in qua questo
   archivio stava guardando: serve al client per non spacciare un buco di
   copertura per «non si è mosso nessuno».

   ── ⚠️ LA GUARDIA CONTRO LE PARTENZE FINTE ─────────────────────────────
   `pollCitizens` sfoglia a cursore e una pagina che fallisce viene
   saltata in silenzio (la nazione resta con quello che ha). Se si
   diffasse una fotografia così, duecento cittadini "spariti" per una
   pagina persa diventerebbero duecento partenze inventate — il tipo di
   bug che nessuno nota perché il risultato è credibile.

   Quindi: se il censimento nuovo è sensibilmente più piccolo del
   precedente (nel totale o in una singola nazione), il giro viene
   SCARTATO INTERO. Non si diffa e non si sovrascrive la fotografia
   buona: al giro dopo si riparte da quella. Meglio un'ora di buco
   dichiarata che una lista di partenze finte.

   ⚠️ Ma una pagina persa è un incidente di UN giro, e un calo vero resta.
   Il 20 set 2026 la Siria è passata davvero da 416 a ~245 cittadini: la
   guardia, confrontando sempre con la stessa fotografia vecchia, ha
   scartato ogni giro per quattro giorni e ha fermato l'archivio di TUTTE
   le nazioni. Per questo la guardia ricorda il calo sospetto (`suspect`
   nella fotografia) e, se CONFIRM_ROUNDS giri di fila rivedono lo stesso
   numero (entro CONFIRM_TOLERANCE), lo prende per vero e diffa. I
   movimenti di quel giro portano l'ora in cui è stato confermato, non
   quella in cui sono avvenuti: tardi di qualche ora, ma veri.

   ── COSA VIENE REGISTRATO, E COSA NO ───────────────────────────────────
   - TRASFERIMENTO: c'era in A, adesso è in B. Ha origine e destinazione.
   - USCITA: c'era in A, adesso non è in NESSUN elenco. Account cancellato
     o comunque fuori dal censimento. Destinazione ignota (`t: null`).
   - Un id che compare per la prima volta NON viene registrato: è un
     account nuovo, non un trasferimento. I nuovi iscritti li conta già
     `pollCitizens` (`new24h`/`new7d`), che è la sede giusta.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const SNAP_FILE = 'citizen-snapshot';   // { at, map: { userId: countryId } }
const MOVES_FILE = 'citizen-moves';     // { startedAt, data: [ {u, f, t, a} ] }

// Trenta giorni: la vista ne chiede sette, ma un mese permette di
// allargare la finestra senza dover riaccumulare da zero. Le righe sono
// poche decine al giorno, lo spazio non è un problema.
const RETENTION_DAYS = 30;

// Sotto queste soglie il censimento nuovo è considerato monco e il giro si
// butta. 0.90 sul totale mondiale (una pagina persa di una nazione grande
// non arriva a spostare il 10% del mondo, ma due o tre sì) e 0.70 sulla
// singola nazione (sotto, la sua lista è chiaramente troncata: nessuna
// nazione perde un terzo dei cittadini in un'ora).
const MIN_TOTAL_RATIO = 0.90;
const MIN_COUNTRY_RATIO = 0.70;
// Sotto questo numero di cittadini la percentuale non dice niente (una
// nazione da 4 persone che ne perde 2 è a 0,5 senza che sia successo
// niente di strano): le piccole non fanno scattare la guardia.
const SMALL_COUNTRY = 25;
// Un calo che si ripresenta uguale per tre giri di fila (tre ore) non è
// una pagina persa: è la nazione che si è svuotata davvero. "Uguale" =
// entro il 10% del numero visto al primo scarto.
const CONFIRM_ROUNDS = 3;
const CONFIRM_TOLERANCE = 0.10;

function initCitizenMoves(tools) {
  deps = tools;
}

function readCache(name, fb) { return deps.readCache(name, fb); }
function writeCache(name, data, opts) { return deps.writeCache(name, data, opts); }

function _readSnap() { return readCache(SNAP_FILE, { at: null, map: null }); }
function _readMoves() { return readCache(MOVES_FILE, { startedAt: null, fetchedAt: null, data: [] }); }

/**
 * Confronta il censimento appena fatto con quello dell'ora prima e
 * registra gli spostamenti. Chiamata da pollCitizens con la stessa
 * `idsByCountry` che sta per scrivere in cache — nessuna rilettura,
 * nessuna chiamata.
 *
 * @param {Map<string,string[]>} idsByCountry countryId → [userId]
 * @param {number} now
 */
function recordCensus(idsByCountry, now) {
  if (!deps || !idsByCountry) return;

  // Fotografia di adesso: utente → nazione. Il conteggio per nazione
  // serve solo alla guardia qui sotto.
  const map = {};
  const sizes = {};
  let total = 0;
  for (const [countryId, ids] of idsByCountry) {
    sizes[countryId] = ids.length;
    total += ids.length;
    for (const id of ids) map[id] = countryId;
  }
  if (!total) {
    console.warn('[citizen-moves] censimento vuoto: giro scartato');
    return;
  }

  const prev = _readSnap();

  // Primo giro assoluto: non c'è niente da confrontare. Si salva la
  // fotografia e si fissa da quando in qua questo archivio guarda.
  if (!prev.map) {
    writeCache(SNAP_FILE, { at: now, map, sizes }, { compact: true });
    const store = _readMoves();
    writeCache(MOVES_FILE, {
      startedAt: store.startedAt || now,
      fetchedAt: now,
      data: store.data,
    }, { compact: true });
    console.log(`[citizen-moves] prima fotografia: ${total} cittadini, da qui si comincia a contare`);
    return;
  }

  // ── Guardia: fotografia monca? ────────────────────────────────────
  const prevSizes = prev.sizes || {};
  const prevTotal = Object.values(prevSizes).reduce((s, n) => s + n, 0)
    || Object.keys(prev.map).length;
  // Cosa non torna in questo giro: chiave → numero visto adesso. `*` è il
  // totale mondiale, le altre chiavi sono nazioni.
  const drops = {};
  if (prevTotal && total < prevTotal * MIN_TOTAL_RATIO) drops['*'] = total;
  for (const [countryId, n] of Object.entries(sizes)) {
    const before = prevSizes[countryId] || 0;
    if (before >= SMALL_COUNTRY && n < before * MIN_COUNTRY_RATIO) drops[countryId] = n;
  }
  if (Object.keys(drops).length) {
    // Stesso calo del giro prima? Allora la serie continua, altrimenti
    // riparte da uno. Si confronta col numero del PRIMO scarto, così una
    // nazione che continua a scendere non viene confermata a metà strada.
    const s = prev.suspect;
    const same = s && Object.keys(drops).every(k =>
      s.sizes[k] != null && Math.abs(drops[k] - s.sizes[k]) <= s.sizes[k] * CONFIRM_TOLERANCE);
    const streak = same ? s.streak + 1 : 1;
    const desc = Object.entries(drops).map(([k, n]) =>
      k === '*' ? `totale ${prevTotal}→${n}` : `${k} ${prevSizes[k]}→${n}`).join(', ');
    if (streak < CONFIRM_ROUNDS) {
      writeCache(SNAP_FILE, {
        ...prev,
        suspect: { streak, sizes: same ? s.sizes : drops },
      }, { compact: true });
      console.warn(`[citizen-moves] calo sospetto (${desc}), giro ${streak}/${CONFIRM_ROUNDS}: scartato, fotografia precedente conservata`);
      return;
    }
    console.log(`[citizen-moves] calo confermato per ${streak} giri di fila (${desc}): è vero, si diffa`);
  }

  // ── Il diff vero ──────────────────────────────────────────────────
  // u = utente, f = da (nazione precedente), t = a (null se sparito),
  // a = quando. Chiavi corte: il file viaggia intero verso il browser,
  // come le righe dell'archivio bonifici.
  const fresh = [];
  for (const [userId, before] of Object.entries(prev.map)) {
    const after = map[userId];
    if (after === before) continue;
    if (after) fresh.push({ u: userId, f: before, t: after, a: now });
    else fresh.push({ u: userId, f: before, t: null, a: now });
  }
  // Gli id nuovi (in `map` ma non in `prev.map`) sono account appena
  // creati: non sono trasferimenti e non entrano qui. Vedi il blocco in
  // testa.

  const store = _readMoves();
  const floor = now - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const merged = [...fresh, ...store.data]
    .filter(r => r.a >= floor)
    .sort((a, b) => b.a - a.a);

  writeCache(SNAP_FILE, { at: now, map, sizes }, { compact: true });
  writeCache(MOVES_FILE, {
    startedAt: store.startedAt || prev.at || now,
    fetchedAt: now,
    data: merged,
  }, { compact: true });

  if (fresh.length) {
    const gone = fresh.filter(r => !r.t).length;
    console.log(`[citizen-moves] +${fresh.length} movimenti (${fresh.length - gone} trasferimenti, ${gone} usciti dal censimento), ${merged.length} in archivio`);
  }
}

/**
 * Movimenti di UNA nazione, divisi in arrivi e partenze.
 * `coverageFrom` è il confine dell'onestà: prima di quel momento questo
 * archivio non stava ancora guardando, quindi una lista vuota non è una
 * risposta — ed è il client a doverlo dire.
 */
function readCitizenMoves(countryId, days) {
  const store = _readMoves();
  const since = Date.now() - (days || 7) * 24 * 60 * 60 * 1000;
  const arrivals = [];
  const departures = [];
  for (const r of store.data) {
    if (r.a < since) break;   // l'archivio è ordinato dal più recente
    if (r.t === countryId) arrivals.push({ u: r.u, from: r.f, at: r.a });
    else if (r.f === countryId) departures.push({ u: r.u, to: r.t, at: r.a });
  }
  return {
    fetchedAt: store.fetchedAt,
    coverageFrom: store.startedAt,
    retentionDays: RETENTION_DAYS,
    arrivals,
    departures,
  };
}

function statoCitizenMoves() {
  const store = _readMoves();
  const snap = _readSnap();
  const oldest = store.data.length ? store.data[store.data.length - 1].a : null;
  return {
    movimenti: store.data.length,
    cittadiniInFotografia: snap.map ? Object.keys(snap.map).length : 0,
    ultimaFotografia: snap.at ? new Date(snap.at).toISOString() : null,
    copreDa: store.startedAt ? new Date(store.startedAt).toISOString() : null,
    piuVecchio: oldest ? new Date(oldest).toISOString() : null,
    retentionDays: RETENTION_DAYS,
  };
}

module.exports = {
  initCitizenMoves,
  recordCensus,
  readCitizenMoves,
  statoCitizenMoves,
};
