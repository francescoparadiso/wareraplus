/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — lavoro e tasse
   -----------------------------------------------------------------------
   Riempie `cache/labour-history.json` e `cache/labour-tax.json`
   (server/labourHistory.js) con i due aggregati ricavati dal dump.

   A differenza degli altri import qui NON si legge un CSV grezzo: le due
   tabelle di partenza sono enormi (9,4 milioni di eventi salario e 1,7
   milioni di rollup orari) e l'aggregazione si fa una volta sola in
   locale, dove il dump c'è. Sul VPS arrivano già i due JSON compatti —
   1 MB e 256 KB — e questo script li valida e li mette al loro posto.

   ── DUE FILE PERCHÉ SONO DUE NUMERI DIVERSI ───────────────────────────
   `labour-history` aggrega per nazione del LAVORATORE (salari incassati
   dai suoi cittadini, tasse trattenute su quei salari, da quali nazioni
   arrivano i datori, per quali risorse).

   `labour-tax` aggrega per nazione dove OPERA l'azienda, che è quella che
   incassa davvero la tassa: l'aliquota applicata è la sua, e i soldi vanno
   nel suo tesoro. Per un cittadino che lavora all'estero le due nazioni
   sono diverse, ed è tutto il punto.

   ⚠️ `rate` è in PERCENTO, non una frazione: 6.0 vuol dire 6%. Verificato
   sui dati — tasse/salari fa 0,0600 dove il campo dice 6.0. Trattarlo come
   frazione darebbe aliquote del 600%.

   ── USO (sul VPS, da ~/warera-cache-server/) ──────────────────────────
     node lavoro.js /tmp/labour-history-import.json /tmp/labour-tax-import.json --prova
     node lavoro.js /tmp/labour-history-import.json /tmp/labour-tax-import.json
     pm2 restart warera-cache

   Il restart serve: labourHistory.js tiene i due file in memoria.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const prova = args.includes('--prova');
const valore = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};

// Stessa regola degli altri import: cartella di lavoro prima (deploy
// piatto sul VPS), cartella del repo poi.
function cartellaCache() {
  const esplicita = valore('--cache');
  if (esplicita) return esplicita;
  const accanto = path.join(process.cwd(), 'cache');
  if (fs.existsSync(accanto)) return accanto;
  return path.join(__dirname, '..', 'cache');
}

const CACHE_DIR = cartellaCache();
const sorgenti = args.filter((a) => !a.startsWith('--') && a !== valore('--cache'));

if (sorgenti.length < 2) {
  console.error('uso: node lavoro.js <labour-history-import.json> <labour-tax-import.json> [--prova] [--cache <cartella>]');
  process.exit(1);
}
if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}\nlancia dalla cartella del cache-server, o passa --cache <percorso>`);
  process.exit(1);
}

const [fileLavoro, fileGettito] = sorgenti;

function leggi(p, campi) {
  const d = JSON.parse(fs.readFileSync(p, 'utf-8'));
  for (const c of campi) {
    if (!(c in d)) throw new Error(`${path.basename(p)}: manca il campo "${c}"`);
  }
  return d;
}

const lavoro = leggi(fileLavoro, ['from', 'to', 'world', 'countries']);
const gettito = leggi(fileGettito, ['from', 'to', 'countries', 'rates']);

const nazioni = Object.keys(lavoro.countries).length;
const giorni = lavoro.world.length;
const salariTot = lavoro.world.reduce((s, r) => s + (r[1] || 0), 0);
const gettitoTot = Object.values(gettito.countries)
  .reduce((s, righe) => s + righe.reduce((x, r) => x + (r[1] || 0), 0), 0);

console.log(`lavoro:  ${nazioni} nazioni, ${giorni} giorni, ${lavoro.from} → ${lavoro.to}`);
console.log(`         ${Math.round(salariTot).toLocaleString('it-IT')} di salari nel periodo`);
console.log(`gettito: ${Object.keys(gettito.countries).length} nazioni operative, ${gettito.from} → ${gettito.to}`);
console.log(`         ${Math.round(gettitoTot).toLocaleString('it-IT')} di tasse sul lavoro incassate`);

if (lavoro.from !== gettito.from || lavoro.to !== gettito.to) {
  console.warn(`⚠️  i due file coprono periodi diversi (${lavoro.from}→${lavoro.to} contro ${gettito.from}→${gettito.to}).`);
}

if (prova) {
  console.log('\n--prova: non ho scritto niente.');
  process.exit(0);
}

fs.writeFileSync(path.join(CACHE_DIR, 'labour-history.json'), JSON.stringify(lavoro));
fs.writeFileSync(path.join(CACHE_DIR, 'labour-tax.json'), JSON.stringify(gettito));
console.log(`\nscritti in ${CACHE_DIR}: labour-history.json, labour-tax.json`);
console.log('ricordati del pm2 restart warera-cache: i due file stanno in memoria.');
