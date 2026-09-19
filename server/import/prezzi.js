/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — candele di prezzo da un archivio esterno
   -----------------------------------------------------------------------
   `server/priceHistory.js` da qui in avanti campiona i prezzi ogni ora e
   ne fa una candela al giorno. All'indietro non può: `itemTrading.getPrices`
   dice quanto costa l'acciaio ADESSO, e il gioco non pubblica nient'altro.

   Il dump di un altro tool della comunità teneva però la stessa cosa
   dall'aprile 2026, già ridotta a candele giornaliere (`price_daily`):
   3.605 righe, cioè ~40 risorse per ~90 giorni. Questo script le versa
   nell'archivio nostro, che da lì riparte da solo.

   ── COLONNE ───────────────────────────────────────────────────────────
   Il CSV estratto dal dump ha l'ordine della tabella di origine:

       item_code, day, open, CLOSE, HIGH, low, samples, ...

   cioè chiusura e massimo INVERTITI rispetto all'ordine "ohlc" che verrebbe
   da scrivere a memoria. Sbagliarlo non dà errore: dà candele con il
   massimo più basso della chiusura, che sul grafico si vedono solo se uno
   sa di doverle cercare.

   Le colonne dopo `samples` (war_score, signal, volatility) sono
   dell'altro tool — metriche sue, calcolate con soglie sue — e restano
   fuori: importare un "segnale" senza la formula che lo produce vorrebbe
   dire mostrare un giudizio di cui non rispondiamo.

   ── NON SOVRASCRIVE ───────────────────────────────────────────────────
   Se per (risorsa, giorno) c'è già una candela nostra, vince la nostra:
   l'abbiamo misurata noi e sappiamo con che passo.

   ── USO (sul VPS, da ~/warera-cache-server/) ──────────────────────────
     node prezzi.js /tmp/price_daily.csv.gz --prova
     node prezzi.js /tmp/price_daily.csv.gz
     node prezzi.js /tmp/price_daily.csv.gz --cache /percorso/cache

   Il file viene riletto ad ogni richiesta: nessun restart di pm2.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const args = process.argv.slice(2);
const prova = args.includes('--prova');
const valore = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};
// Dove sta la cache del server. Sul VPS il deploy e' una cartella PIATTA
// (~/warera-cache-server/), quindi qui accanto c'e' gia' `cache/`; nel repo
// invece questo file sta in server/import/ e la cache e' un piano sopra. Si
// prova la prima, poi la seconda: lanciarlo dalla cartella sbagliata dava
// "cartella cache non trovata" a deploy appena fatto, ed e' successo.
function cartellaCache() {
  const esplicita = valore('--cache');
  if (esplicita) return esplicita;
  const accanto = path.join(process.cwd(), 'cache');
  if (fs.existsSync(accanto)) return accanto;
  return path.join(__dirname, '..', 'cache');
}

const CACHE_DIR = cartellaCache();
const FILE = path.join(CACHE_DIR, 'price-history.json');
const sorgente = args.find((a) => !a.startsWith('--') && a !== valore('--cache'));

if (!sorgente) {
  console.error('uso: node prezzi.js <price_daily.csv[.gz]> [--prova] [--cache <cartella>]');
  process.exit(1);
}
if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}\nlancia dalla cartella del cache-server, o passa --cache <percorso>`);
  process.exit(1);
}

async function main() {
  const store = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, 'utf-8'))
    : { fetchedAt: null, startedAt: null, items: {} };
  if (!store.items) store.items = {};

  const flusso = sorgente.endsWith('.gz')
    ? fs.createReadStream(sorgente).pipe(zlib.createGunzip())
    : fs.createReadStream(sorgente);
  const righe = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  let lette = 0, aggiunte = 0, gia = 0, scartate = 0;
  let primo = null, ultimo = null;
  const risorse = new Set();

  for await (const linea of righe) {
    if (!linea) continue;
    // Il CSV estratto è separato da TAB (è il COPY di PostgreSQL così
    // com'è), non da virgole.
    const p = linea.split('\t');
    if (p.length < 7) { scartate++; continue; }
    const [code, giorno, apertura, chiusura, massimo, minimo, campioni] = p;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno)) { scartate++; continue; }
    const o = Number(apertura), c = Number(chiusura), h = Number(massimo), l = Number(minimo);
    if (![o, c, h, l].every(Number.isFinite)) { scartate++; continue; }
    lette++;
    risorse.add(code);
    if (!primo || giorno < primo) primo = giorno;
    if (!ultimo || giorno > ultimo) ultimo = giorno;

    const serie = store.items[code] || (store.items[code] = {});
    if (serie[giorno]) { gia++; continue; }
    serie[giorno] = {
      o: Math.round(o * 1e6) / 1e6,
      h: Math.round(h * 1e6) / 1e6,
      l: Math.round(l * 1e6) / 1e6,
      c: Math.round(c * 1e6) / 1e6,
      n: Number(campioni) || 0,
    };
    aggiunte++;
  }

  console.log(`righe lette:  ${lette}` + (scartate ? ` (${scartate} scartate)` : ''));
  console.log(`risorse:      ${risorse.size}`);
  console.log(`giorni:       ${primo} → ${ultimo}`);
  console.log(`candele nuove: ${aggiunte}` + (gia ? `  (${gia} gia' presenti, non toccate)` : ''));

  if (prova) {
    console.log('\n--prova: non ho scritto niente.');
    return;
  }

  // `startedAt` è "da quando questo archivio guarda": dopo l'import è il
  // giorno più vecchio che c'è davvero, non l'istante del primo campione
  // nostro. È il campo che la vista usa per non promettere tre mesi.
  const daImport = Date.parse(`${primo}T00:00:00Z`);
  if (Number.isFinite(daImport) && (!store.startedAt || daImport < store.startedAt)) {
    store.startedAt = daImport;
  }
  fs.writeFileSync(FILE, JSON.stringify(store));
  console.log(`\nscritto ${FILE}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
