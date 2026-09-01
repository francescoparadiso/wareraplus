/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Archivio dei finanziamenti fra nazioni (90 giorni)
   -----------------------------------------------------------------------
   Tiene i bonifici da tesoro a tesoro (`transaction.getPaginatedTransactions`
   con `transactionType: 'countryMoneyTransfer'`), che il dettaglio battaglia
   usa per dire CHI ha pagato perché quella battaglia esistesse.

   ── ⚠️ I 90 GIORNI SI ACCUMULANO, NON SI RECUPERANO ────────────────────
   Questo modulo NON ha un bootstrap, e non è una dimenticanza: l'API non
   ha niente da cui farlo. Misurato sul vivo il 2026-09-02, la lista dei
   trasferimenti si esaurisce a **104 righe / ~70 ore** — il cursore
   finisce lì, non c'è pagina successiva. È una finestra scorrevole, non
   uno storico.

   Quindi: da qui a novanta giorni ci si arriva ACCUMULANDO, un giro di
   poll alla volta, a partire dal primo avvio. Il giorno del deploy si
   parte con i ~3 giorni che l'API ricorda; il resto lo costruisce il
   tempo. Chi legge (`/money-transfers`) riceve anche `coverageFrom`, cioè
   da quando in qua questo archivio è affidabile: prima di quella data
   l'assenza di un bonifico NON significa che non ci sia stato, e il
   client lo deve dire in chiaro invece di mostrare una tabella vuota.

   ── PERCHÉ COSTA POCO ──────────────────────────────────────────────────
   ~36 bonifici al giorno in tutto il mondo. Un giro incrementale si ferma
   appena incontra un id già visto: in condizioni normali è UNA richiesta
   ogni venti minuti, e novanta giorni di archivio stanno in poche
   centinaia di KB.

   ⚠️ PROCEDURA TOKEN-GATED, e la chiave giusta è una sola.
   `transaction.getPaginatedTransactions` risponde 401 su api6 nudo E
   attraverso il Worker Cloudflare — verificato dal vivo qui e già prima
   in proxyIndex.js, che per lo stesso motivo non passa da `trpcBatch`.
   L'unica che apre questo endpoint è quella del VPS, la stessa che la
   route /trpc mette in `X-API-Key`: si riusa quella, presa dall'ambiente
   di pm2 (WARERA_API_TOKEN) e mai scritta nel codice.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'money-transfers';

// Stessa retention dell'archivio battaglie: le due cose si leggono
// insieme (un finanziamento senza la battaglia che lo spiega non serve).
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const PAGE = 50;
// Rete di sicurezza: in regime normale il giro si ferma alla prima pagina
// per via del taglio sugli id già visti. Se un giorno il formato cambiasse
// e il taglio non scattasse più, meglio fermarsi che sfogliare all'infinito.
const MAX_PAGES = 10;

/** Chiamato una volta dal server principale, prima di qualunque poll.
 *  `apiToken`/`trpcUpstream` arrivano come getter: sono dichiarati più in
 *  basso nel file del server, insieme alla route /trpc. */
function initMoneyTransfers(tools) {
  deps = tools;
}

function readCache(name, fb) { return deps.readCache(name, fb); }
function writeCache(name, data, opts) { return deps.writeCache(name, data, opts); }

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

function _read() {
  return readCache(FILE, {
    fetchedAt: null,
    // Quando questo archivio ha cominciato a guardare. Serve al client per
    // distinguere "nessun finanziamento" da "non c'ero ancora".
    startedAt: null,
    data: [],
  });
}

/** Una pagina di bonifici, dal più recente all'indietro.
 *  Non passa da `trpcBatch`: serve la chiave del VPS (vedi il blocco in
 *  testa) ed è paginata a cursore, mentre il batch serve a raggruppare
 *  chiamate indipendenti. Stessa scelta di proxyIndex.js.
 *
 *  ⚠️ L'input va NUDO: incapsularlo in {json: ...} fa passare la richiesta
 *  ma i filtri vengono ignorati in silenzio e torna il flusso globale di
 *  tutte le transazioni del gioco. */
async function _fetchPage(cursor) {
  const input = { transactionType: 'countryMoneyTransfer', limit: PAGE };
  if (cursor) input.cursor = cursor;
  const url = `${deps.trpcUpstream}/transaction.getPaginatedTransactions`
    + `?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: deps.apiToken ? { 'X-API-Key': deps.apiToken } : {} });
  if (!res.ok) throw new Error(`getPaginatedTransactions: HTTP ${res.status}`);
  const data = (await res.json())?.result?.data;
  if (!data || !Array.isArray(data.items)) {
    throw new Error('getPaginatedTransactions: risposta inattesa');
  }
  return { items: data.items, nextCursor: data.nextCursor || null };
}

/** Riga compatta: chiavi corte perché il file viaggia intero verso il
 *  browser, come le righe dell'archivio battaglie.
 *  i = id (serve al dedup), f = from, t = to, m = money, a = quando. */
function _toRow(t) {
  const at = _ts(t.createdAt);
  const money = Number(t.money);
  if (!t?._id || !at || !Number.isFinite(money)) return null;
  if (!t.sellerCountryId || !t.buyerCountryId) return null;
  // seller manda, buyer riceve. Nomi dell'API, non nostri: qui non si
  // compra niente, è un bonifico da tesoro a tesoro.
  return { i: t._id, f: t.sellerCountryId, t: t.buyerCountryId, m: money, a: at };
}

/**
 * Giro incrementale. Sfoglia dal più recente e si ferma appena incontra
 * un bonifico già in archivio: in regime normale una richiesta sola.
 */
async function pollMoneyTransfers() {
  if (!deps) return;
  if (!deps.apiToken) {
    console.warn('[money-transfers] WARERA_API_TOKEN assente: archivio fermo (401 sulle transazioni)');
    return;
  }
  const store = _read();
  const known = new Set(store.data.map(r => r.i));
  const fresh = [];
  let cursor = null;
  let hitKnown = false;

  try {
    for (let page = 0; page < MAX_PAGES && !hitKnown; page++) {
      const { items, nextCursor } = await _fetchPage(cursor);
      for (const raw of items) {
        if (known.has(raw?._id)) { hitKnown = true; break; }
        const row = _toRow(raw);
        if (row) fresh.push(row);
      }
      cursor = nextCursor;
      if (!cursor) break;
    }
  } catch (err) {
    // Un giro fallito non è un problema: il prossimo ripassa dagli stessi
    // bonifici, perché il taglio è sugli id e non su un cursore salvato.
    console.error('[money-transfers] giro fallito:', err.message);
    if (!fresh.length) return;
  }

  const cutoff = Date.now() - RETENTION_MS;
  const merged = [...fresh, ...store.data]
    .filter(r => r.a >= cutoff)
    .sort((a, b) => b.a - a.a);

  writeCache(FILE, {
    fetchedAt: Date.now(),
    // Si fissa al primo giro e non si tocca più: è la data da cui in qua
    // questo archivio può dirsi completo.
    startedAt: store.startedAt || (merged.length ? Math.min(...merged.map(r => r.a)) : Date.now()),
    data: merged,
  }, { compact: true });

  if (fresh.length) console.log(`[money-transfers] +${fresh.length} (totale ${merged.length})`);
}

/** Quello che va al browser. `coverageFrom` è il confine dell'onestà: prima
 *  di quel momento questo archivio non stava ancora guardando, quindi una
 *  tabella vuota non è una risposta. */
function readMoneyTransfers() {
  const store = _read();
  return {
    fetchedAt: store.fetchedAt,
    retentionDays: RETENTION_DAYS,
    coverageFrom: store.startedAt,
    data: store.data,
  };
}

function readMoneyTransfersStatus() {
  const store = _read();
  const oldest = store.data.length ? store.data[store.data.length - 1].a : null;
  return {
    righe: store.data.length,
    ultimoGiro: store.fetchedAt ? new Date(store.fetchedAt).toISOString() : null,
    copreDa: store.startedAt ? new Date(store.startedAt).toISOString() : null,
    piuVecchio: oldest ? new Date(oldest).toISOString() : null,
    retentionDays: RETENTION_DAYS,
  };
}

module.exports = {
  initMoneyTransfers,
  pollMoneyTransfers,
  readMoneyTransfers,
  readMoneyTransfersStatus,
};
