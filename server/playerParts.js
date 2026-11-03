/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Le parti della ricchezza di un giocatore
   -----------------------------------------------------------------------
   `rankings.userWealth` è UN numero. La scheda Ricchezza di Giocatori lo
   disegna nel tempo (l'archivio c'è dal 19 giugno), ma non dice di cosa è
   fatto. Il gioco non lo scompone: nessuna procedura pubblica dà soldi,
   oggetti o equipaggiamento di un giocatore. Due pezzi però si vedono, e
   questo modulo li tiene giorno per giorno:

     · AZIENDE — la somma di `estimatedValue` di `company.getById`, che il
       censimento notturno (companyCensus.js) già legge per ogni azienda dei
       cittadini attivi: scrive `company-owner-values`, qui si legge.
       Verificato il 2026-11-03 su nove giocatori dal 1° al 14.000° posto:
       non supera MAI la ricchezza (dal 15% all'84%).
     · ORDINI D'ACQUISTO — quantità × prezzo degli ordini del giocatore, dal
       campione orario di orderMoney.js. Un MINIMO: `getTopOrders` si ferma
       a 100 ordini per libro.

   Tutto il resto — soldi, oggetti, armi, equipaggiamento — è il RESTO, e lo
   calcola il client per differenza con la ricchezza del giorno. Non si
   chiama "soldi": è anche altro, e la vista lo dice.

   ── UNO SCATTO AL GIORNO, DAL PRIMO CENSIMENTO ────────────────────────
   Come per la ricchezza, la storia non si ricostruisce: nessuna procedura
   dice quanto valevano le aziende di ieri. Lo scatto parte quando il
   censimento finisce (ogni notte, ~03:20 + un'ora e mezza) e si controlla
   ogni ora alle :50; un censimento già visto non si riconta. I giorni prima
   del primo scatto restano senza parti, e la vista lo dichiara.

   ── FORMATO ───────────────────────────────────────────────────────────
   Per colonne e per giocatore, non un file per giorno: la rotta chiede UN
   giocatore su qualche mese, e rileggere novanta file da mezzo MB per
   rispondere sarebbe il modo più caro di farlo.

       { lastCensusAt, days: ['2026-11-04', …],
         u: { userId: { s: indice del primo giorno, c: [valore|null…], o: […] } } }

   `c` è null dove il censimento non c'era (giocatore inattivo da più di tre
   giorni, o giorno saltato): "non so" e "zero" sono cose diverse. `o` è 0
   per chi non aveva ordini nei libri visti.

   Costo: ~16.000 giocatori × due numeri al giorno, 8-12 byte ciascuno:
   qualche MB al mese. Non si pota: un giorno saltato è perso per sempre.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'player-parts';
const FILE_VALORI = 'company-owner-values';
const TZ = 'Europe/Rome';

function initPlayerParts(tools) {
  deps = tools;
}

let _mem = null;
function _read() {
  if (_mem) return _mem;
  _mem = deps.readCache(FILE, { lastCensusAt: null, days: [], u: {} });
  if (!Array.isArray(_mem.days)) _mem.days = [];
  if (!_mem.u) _mem.u = {};
  return _mem;
}

function giornoDi(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

/**
 * Aggiunge il giorno se il censimento è nuovo. Gira ogni ora: quasi sempre
 * non fa niente, e va bene così — non c'è un orario fisso perché il
 * censimento dura un'ora e mezza e la sua fine si sposta.
 */
function snapshotPlayerParts() {
  if (!deps) return;
  const valori = deps.readCache(FILE_VALORI, null);
  if (!valori?.byUser || !valori.updatedAt) return;

  const store = _read();
  if (store.lastCensusAt === valori.updatedAt) return;

  const oggi = giornoDi();
  // Un censimento rifatto lo stesso giorno (giro forzato) riscrive quel
  // giorno invece di aprirne un secondo.
  let idx = store.days.indexOf(oggi);
  if (idx === -1) { store.days.push(oggi); idx = store.days.length - 1; }

  const ordini = deps.ordersByUser();           // Map userId → soldi, o null
  const conOrdini = ordini instanceof Map;
  const ids = new Set(Object.keys(valori.byUser));
  if (conOrdini) for (const id of ordini.keys()) ids.add(id);

  for (const id of ids) {
    const r = store.u[id] || (store.u[id] = { s: idx, c: [], o: [] });
    while (r.s + r.c.length < idx) { r.c.push(null); r.o.push(null); }
    const k = idx - r.s;
    r.c[k] = valori.byUser[id] ?? null;
    r.o[k] = conOrdini ? Math.round((ordini.get(id) || 0) * 100) / 100 : null;
  }

  store.lastCensusAt = valori.updatedAt;
  deps.writeCache(FILE, store, { compact: true });
  console.log(`[player-parts] ${oggi}: ${ids.size} giocatori, ${store.days.length} giorni in archivio`);
}

/**
 * Per UN giocatore: le righe `[giorno, aziende|null, ordini|null]`, più i
 * valori di adesso. `ordersNow` viene dalla memoria del campione orario
 * (c'è subito dopo un riavvio), `companiesNow` dall'ultimo censimento (null
 * finché non ne è passato uno, o se il giocatore è inattivo).
 */
function readPlayerParts(userId, giorni = 90) {
  const store = _read();
  const ordini = deps.ordersByUser();
  const valori = deps.readCache(FILE_VALORI, null);

  const rows = [];
  const r = store.u[userId];
  if (r) {
    const da = Math.max(0, store.days.length - Math.max(1, giorni));
    for (let i = Math.max(r.s, da); i < r.s + r.c.length; i++) {
      const c = r.c[i - r.s];
      const o = r.o[i - r.s];
      if (c == null && o == null) continue;
      rows.push([store.days[i], c, o]);
    }
  }

  return {
    coverageFrom: store.days[0] || null,
    days: store.days.length,
    rows,
    ordersNow: ordini instanceof Map ? Math.round((ordini.get(userId) || 0) * 100) / 100 : null,
    companiesNow: valori?.byUser && userId in valori.byUser
      ? { value: valori.byUser[userId], day: valori.day || null, at: valori.updatedAt || null }
      : null,
  };
}

/** Per /health. */
function statoPlayerParts() {
  const store = _read();
  return {
    giorni: store.days.length,
    primo: store.days[0] || null,
    ultimo: store.days.length ? store.days[store.days.length - 1] : null,
    giocatori: Object.keys(store.u).length,
    ultimoCensimento: store.lastCensusAt ? new Date(store.lastCensusAt).toISOString() : null,
  };
}

module.exports = {
  initPlayerParts,
  snapshotPlayerParts,
  readPlayerParts,
  statoPlayerParts,
};
