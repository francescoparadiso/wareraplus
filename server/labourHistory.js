/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Lavoro e tasse: l'economia del salario, per nazione
   -----------------------------------------------------------------------
   L'unico pezzo del dump di terzi che non ha un corrispettivo in WarEra+ e
   nemmeno uno raggiungibile: ogni PAGAMENTO DI SALARIO del gioco, con la
   nazione del lavoratore, quella in cui opera l'azienda, quella del
   proprietario, la risorsa prodotta e la tassa trattenuta.

   Risponde a domande che finora nessuno poteva porsi con dei numeri:
   quanto lavoro se ne va all'estero, chi paga gli stipendi dei cittadini di
   una nazione, quanto incassa davvero uno stato di tassa sul lavoro.

   ── ⚠️ QUESTO ARCHIVIO È CHIUSO, E VA DETTO ───────────────────────────
   Non c'è nessun poll qui sotto, e non è una dimenticanza: sono ~550.000
   pagamenti di salario AL GIORNO (misurato sui rollup: 1,5 milioni di oro
   al giorno in stipendi). Sfogliarli da `transaction.getPaginatedTransactions`
   vorrebbe dire undicimila pagine al giorno, e campionarne una fetta
   darebbe una fotografia storta spacciata per un totale.

   Quindi la copertura è quella dell'archivio importato — 29 luglio → 17
   settembre 2026, 51 giorni — e non cresce. `from`/`to` viaggiano in ogni
   risposta perché la vista lo dichiari invece di far sembrare "oggi" un
   dato di settembre.

   ── DUE NUMERI CHE SEMBRANO LO STESSO E NON LO SONO ───────────────────
   I rollup orari aggregano per nazione del LAVORATORE: lì `tasse` è la
   tassa trattenuta SUI SALARI DEI SUOI CITTADINI, non il suo gettito.
   L'aliquota che si applica è quella della nazione dove OPERA l'azienda, e
   quei soldi finiscono nel tesoro di QUELLA nazione — che per un cittadino
   che lavora all'estero non è la sua.

   Per questo ci sono due serie separate, e il client non le somma mai:

     `d`      per nazione del lavoratore — salari incassati dai cittadini,
              tasse trattenute su quei salari, quota che arriva da aziende
              straniere;
     `gettito` per nazione dove opera l'azienda — quanto lo stato ha
              incassato davvero, ricavato dalla tabella grezza degli eventi
              (operating_country_id), non dai rollup.

   Chiamare "gettito" la prima sarebbe la stessa trappola di
   `rankings.countryBounty` (vedi server/battleArchive.js), e con lo stesso
   sintomo: un numero plausibile, dalla parte sbagliata del bonifico.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE_LAVORO = 'labour-history';
const FILE_GETTITO = 'labour-tax';

// I due file si rileggono ad ogni richiesta e sono di qualche megabyte:
// copia in memoria, come in dayHistory.js. L'unico che li scrive è un
// import che gira a server fermo (o seguito da un restart).
const _mem = new Map();

function initLabourHistory(tools) {
  deps = tools;
}

function _read(nome, vuoto) {
  if (_mem.has(nome)) return _mem.get(nome);
  const store = deps.readCache(nome, vuoto);
  _mem.set(nome, store);
  return store;
}

function _lavoro() {
  return _read(FILE_LAVORO, { from: null, to: null, world: [], countries: {} });
}

function _gettito() {
  return _read(FILE_GETTITO, { from: null, to: null, countries: {}, rates: {} });
}

/**
 * Quello che va al browser: UNA nazione, più il totale mondiale come metro
 * di paragone (la stessa scelta di /damage-timeline — "il picco è suo o è
 * di tutti?" vale anche per il lavoro).
 *
 * Senza `countryId` torna solo il mondo e la copertura: serve alla vista
 * per sapere se la sezione ha senso prima ancora di aprire una nazione.
 */
function readLabour(countryId) {
  const lavoro = _lavoro();
  const gettito = _gettito();
  const paese = countryId ? lavoro.countries[countryId] : null;

  return {
    from: lavoro.from,
    to: lavoro.to,
    // Il mondo è sempre incluso: è poco (51 righe) e senza di lui una
    // curva nazionale non si sa se sia grande o piccola.
    world: lavoro.world || [],
    countryId: countryId || null,
    // Per nazione del LAVORATORE: [giorno, salari, tasseTrattenute,
    // pagamenti, salariDaAziendeStraniere, pagamentiDaAziendeStraniere]
    days: paese?.d || null,
    // Chi paga: [nazione del proprietario, salari, pagamenti], dal più grande
    partners: paese?.p || null,
    // Per cosa si lavora: [risorsa, salari, pagamenti], dal più grande
    items: paese?.i || null,
    // Per nazione dove OPERA l'azienda: [giorno, tasse incassate, salari
    // lordi, pagamenti, pagamenti a lavoratori stranieri]
    revenue: (countryId && gettito.countries?.[countryId]) || null,
    // Aliquota media applicata nel periodo (0-1), dalla tabella grezza.
    rate: (countryId && gettito.rates?.[countryId]) ?? null,
  };
}

/** Per /health. */
function statoLabour() {
  const lavoro = _lavoro();
  const gettito = _gettito();
  return {
    dal: lavoro.from,
    al: lavoro.to,
    nazioni: Object.keys(lavoro.countries || {}).length,
    giorniMondo: (lavoro.world || []).length,
    gettito: {
      nazioni: Object.keys(gettito.countries || {}).length,
      dal: gettito.from,
      al: gettito.to,
    },
    // Non c'è un poll: questo archivio è chiuso per scelta, vedi il blocco
    // in testa al file.
    archivioChiuso: true,
  };
}

function forgetLabourCache() {
  _mem.clear();
}

module.exports = {
  initLabourHistory,
  readLabour,
  statoLabour,
  forgetLabourCache,
};
