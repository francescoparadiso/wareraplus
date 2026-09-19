/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Storico dei prezzi di mercato
   -----------------------------------------------------------------------
   Rendite di produzione (`src/market/`) risponde a "cosa conviene produrre
   ADESSO": prende `itemTrading.getPrices` ogni cinque minuti e ci calcola
   sopra la rendita al punto produzione. È la domanda giusta per chi deve
   aprire un'azienda oggi, ed è anche l'unica che il gioco sa soddisfare:
   nessuna procedura WarEra dice quanto costava l'acciaio la settimana
   scorsa.

   Questo modulo tiene quel dato invece di buttarlo. Un campione all'ora,
   ridotto a una candela al giorno per risorsa (apertura, massimo, minimo,
   chiusura, quanti campioni). Dopo un mese la vista può dire "il prezzo è
   sceso del 12% in due settimane", che è l'informazione che decide se
   aprire l'azienda o aspettare.

   ── COSTA UNA RICHIESTA ALL'ORA, PUBBLICA ─────────────────────────────
   `itemTrading.getPrices` risponde da api6 senza chiave e porta TUTTE le
   risorse in una volta: non serve il Worker, non serve il token, non si
   pagano 40 chiamate. È la stessa procedura che il client già chiama —
   qui la si chiama una volta per tutti, che è il mestiere di questo
   server.

   ── LA STORIA VECCHIA VIENE DA FUORI ──────────────────────────────────
   Da qui in avanti l'archivio cresce da solo, un campione all'ora. Quello
   che c'era PRIMA del primo avvio non si recupera dal gioco: i 90 giorni
   dal 19 giugno 2026 arrivano dal dump di un altro tool della comunità,
   importati una volta sola con `import/prezzi.js`. `coverageFrom` dice da
   quando in qua c'è qualcosa, e la vista lo dichiara invece di disegnare
   una linea che parte dal nulla.

   ⚠️ Le candele importate hanno i campioni di CHI le ha misurate (il
   campo `n`): un giorno con `n: 292` viene da un campionamento ogni cinque
   minuti, uno con `n: 24` è nostro. Non si sommano e non si confrontano —
   servono solo a sapere quanto è solida una candela.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'price-history';
const TZ = 'Europe/Rome';

// ⚠️ Non si pota più a un anno. Era 365 ("un anno di candele sta in meno di
// un megabyte"), che è vero, ma il 9 aprile 2027 avrebbe cominciato a
// cancellare le candele che `import/prezzi.js` ha portato dentro — e
// l'archivio di terzi da cui vengono ha chiuso, quindi quelle non si
// rifanno. Una candela è quanto costava una risorsa in un giorno: da tenere
// finché il gioco esiste, non per un anno.
// Il costo resta quello di prima moltiplicato per gli anni: ~40 risorse ×
// 365 giorni × una manciata di byte, meno di un MB all'anno, e il file lo
// legge solo questo processo (la route serve una finestra, non tutto).
const PAVIMENTO = '2026-04-01';   // prima di qualunque candela esistente
// Il tetto di quanto può chiedere la route in un colpo solo. Serve a non
// far spedire dieci anni di candele a chi sbaglia un parametro, non a
// nascondere l'archivio: era RETENTION_GIORNI, e lasciarlo lì avrebbe reso
// invisibile dal browser tutto quello che passa l'anno.
const MAX_FINESTRA_GIORNI = 3650;

/** Chiamato una volta dal server principale, prima di qualunque poll. */
function initPriceHistory(tools) {
  deps = tools;
}

function _read() {
  return deps.readCache(FILE, { fetchedAt: null, startedAt: null, items: {} });
}

/** Il giorno italiano di un istante: le candele sono giornate viste da
 *  qui, come `/daily-damage` e lo scatto della ricchezza. */
function giornoDi(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

function giornoMeno(giorno, quanti) {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - quanti);
  return d.toISOString().slice(0, 10);
}

/**
 * Un campione: i prezzi di adesso, versati nella candela di oggi.
 *
 * La prima lettura del giorno apre la candela, le altre ventitré la
 * allargano. Un prezzo che non arriva non chiude la candela a zero: la
 * lascia com'era, perché "non ho misurato" e "valeva zero" sono due cose
 * diverse e la seconda non succede mai.
 */
async function pollPrices() {
  if (!deps) return;
  let prezzi = null;
  try {
    const [res] = await deps.trpcBatch([['itemTrading.getPrices', {}]]);
    prezzi = res;
  } catch (err) {
    console.error('[price-history] getPrices fallita:', err.message);
    return;
  }
  if (!prezzi || typeof prezzi !== 'object') {
    console.warn('[price-history] risposta inattesa da getPrices');
    return;
  }

  const store = _read();
  const oggi = giornoDi();
  let toccate = 0;

  for (const [code, valore] of Object.entries(prezzi)) {
    const p = Number(valore);
    if (!Number.isFinite(p) || p <= 0) continue;
    const serie = store.items[code] || (store.items[code] = {});
    const candela = serie[oggi];
    if (!candela) {
      serie[oggi] = { o: p, h: p, l: p, c: p, n: 1 };
    } else {
      candela.c = p;
      if (p > candela.h) candela.h = p;
      if (p < candela.l) candela.l = p;
      candela.n++;
    }
    toccate++;
  }

  // Si butta solo quello che sta PRIMA dell'archivio, cioè niente: resta
  // come rete contro etichette malformate. Vedi PAVIMENTO in testa.
  const taglio = PAVIMENTO;
  for (const serie of Object.values(store.items)) {
    for (const giorno of Object.keys(serie)) if (giorno < taglio) delete serie[giorno];
  }

  store.fetchedAt = Date.now();
  // Si fissa al primo campione e non si tocca più, come nei bonifici: è la
  // data da cui in qua l'archivio può dirsi suo. L'import storico lo
  // sposta indietro da sé, perché guarda le candele e non l'orologio.
  if (!store.startedAt) store.startedAt = Date.now();
  deps.writeCache(FILE, store, { compact: true });
  console.log(`[price-history] campione ${oggi}: ${toccate} risorse`);
}

/**
 * Quello che va al browser: una finestra di giorni, per risorsa, in righe
 * compatte `[giorno, o, h, l, c, n]`.
 *
 * Compatte e non oggetti perché il file viaggia intero: 40 risorse × 90
 * giorni sono 3.600 candele, che a chiavi ripetute sarebbero tre volte
 * tanto per niente.
 */
function readPriceHistory(giorni = 90) {
  const store = _read();
  const dal = giornoMeno(giornoDi(), Math.max(1, Math.min(giorni, MAX_FINESTRA_GIORNI)));
  const items = {};
  let piuVecchio = null;

  for (const [code, serie] of Object.entries(store.items)) {
    const righe = [];
    for (const [giorno, k] of Object.entries(serie)) {
      if (piuVecchio === null || giorno < piuVecchio) piuVecchio = giorno;
      if (giorno < dal) continue;
      righe.push([giorno, k.o, k.h, k.l, k.c, k.n]);
    }
    if (!righe.length) continue;
    righe.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    items[code] = righe;
  }

  return {
    fetchedAt: store.fetchedAt,
    // Il giorno più vecchio che c'è DAVVERO, non quello richiesto: la
    // vista non deve promettere tre mesi quando ne ha dodici giorni.
    coverageFrom: piuVecchio,
    tz: TZ,
    retentionDays: null,   // niente potatura a giorni: vedi PAVIMENTO in testa
    items,
  };
}

/** Per /health. */
function statoPriceHistory() {
  const store = _read();
  const codici = Object.keys(store.items);
  let primo = null;
  let ultimo = null;
  let candele = 0;
  for (const serie of Object.values(store.items)) {
    for (const giorno of Object.keys(serie)) {
      candele++;
      if (!primo || giorno < primo) primo = giorno;
      if (!ultimo || giorno > ultimo) ultimo = giorno;
    }
  }
  return {
    risorse: codici.length,
    candele,
    primoGiorno: primo,
    ultimoGiorno: ultimo,
    ultimoCampione: store.fetchedAt ? new Date(store.fetchedAt).toISOString() : null,
    retentionDays: null,   // niente potatura a giorni: vedi PAVIMENTO in testa
  };
}

module.exports = {
  initPriceHistory,
  pollPrices,
  readPriceHistory,
  statoPriceHistory,
};
