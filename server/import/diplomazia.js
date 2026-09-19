/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — diplomazia giorno per giorno
   -----------------------------------------------------------------------
   Riempie `cache/day-history-diplomacy.json` (server/dayHistory.js) con la
   tabella `country_diplomacy` del dump: per ogni nazione e per ogni
   giorno, patti difensivi, guerre in corso, nemico giurato e tesoro.

   28.440 righe, dal 13 aprile al 17 settembre 2026. Da lì in avanti ci
   pensa lo scatto delle 02:05.

   ── LE COLONNE ────────────────────────────────────────────────────────
       country_id, day, country_name, country_code, allies[], wars_with[],
       sworn_enemy, money

   `allies` sono PATTI DIFENSIVI, non membri di una stessa alleanza: la
   relazione è simmetrica ma non forma cricche (misurato sul 17 settembre:
   180 nazioni, zero coppie asimmetriche, 72% dei triangoli mancante).
   Corrisponde quindi a `defensivePacts`, che è quello che lo scatto
   giornaliero scrive — le due metà della serie dicono la stessa cosa.

   ⚠️ `money` qui è il campo `money` dell'altro tool, non `countryWealth`.
   Sui valori del 17 settembre sta sulle centinaia (100, 107, 300) mentre
   il tesoro vero sta sui milioni: è il saldo "money" del documento
   nazione, quello che in WarEra+ sappiamo essere fermo da mesi (vedi la
   nota in testa a dayHistory.js). Si importa lo stesso perché è quello che
   c'è, ma va in una colonna DICHIARATA come tale: il client mostra il
   tesoro solo per i giorni che vengono dai nostri scatti, dove è
   countryWealth. Meglio una colonna vuota che due numeri diversi sotto lo
   stesso nome.

   ── USO (sul VPS, da ~/warera-cache-server/) ──────────────────────────
     node diplomazia.js /tmp/country_diplomacy.csv.gz --prova
     node diplomazia.js /tmp/country_diplomacy.csv.gz
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
const FILE = path.join(CACHE_DIR, 'day-history-diplomacy.json');
const sorgente = args.find((a) => !a.startsWith('--') && a !== valore('--cache'));

if (!sorgente) {
  console.error('uso: node diplomazia.js <country_diplomacy.csv[.gz]> [--prova] [--cache <cartella>]');
  process.exit(1);
}
if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}\nlancia dalla cartella del cache-server, o passa --cache <percorso>`);
  process.exit(1);
}

/** `{a,b,c}` di PostgreSQL → array. Vuoto = `{}`. */
function lista(campo) {
  const dentro = (campo || '').trim().replace(/^\{/, '').replace(/\}$/, '');
  if (!dentro) return [];
  return dentro.split(',').map(s => s.replace(/^"|"$/g, '').trim()).filter(Boolean).sort();
}

async function main() {
  const store = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, 'utf-8'))
    : { fetchedAt: null, startedAt: null, days: {} };
  if (!store.days) store.days = {};

  const flusso = sorgente.endsWith('.gz')
    ? fs.createReadStream(sorgente).pipe(zlib.createGunzip())
    : fs.createReadStream(sorgente);
  const righe = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  const nuovi = new Map();   // giorno → righe
  let lette = 0, scartate = 0;

  for await (const linea of righe) {
    if (!linea) continue;
    const p = linea.split('\t');
    if (p.length < 8) { scartate++; continue; }
    const [countryId, giorno, , , allies, wars, sworn] = p;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || !countryId) { scartate++; continue; }
    lette++;
    if (!nuovi.has(giorno)) nuovi.set(giorno, []);
    nuovi.get(giorno).push([
      countryId,
      lista(wars),
      lista(allies),
      sworn && sworn !== '\\N' ? sworn : null,
      // Il tesoro NON si importa: vedi il ⚠️ in testa a questo file.
      null,
    ]);
  }

  // Un giorno che il server ha già fotografato da sé vince: i suoi valori
  // hanno il tesoro vero e vengono dalla stessa fonte di oggi.
  let aggiunti = 0, saltati = 0;
  for (const [giorno, rs] of nuovi) {
    if (store.days[giorno]) { saltati++; continue; }
    store.days[giorno] = rs;
    aggiunti++;
  }

  const giorni = [...nuovi.keys()].sort();
  console.log(`righe lette:   ${lette}` + (scartate ? ` (${scartate} scartate)` : ''));
  console.log(`giorni nel file: ${giorni.length}  ${giorni[0]} → ${giorni.at(-1)}`);
  console.log(`giorni aggiunti: ${aggiunti}` + (saltati ? `  (${saltati} gia' presenti, non toccati)` : ''));

  if (prova) {
    console.log('\n--prova: non ho scritto niente.');
    return;
  }

  const primo = Date.parse(`${giorni[0]}T00:00:00Z`);
  if (Number.isFinite(primo) && (!store.startedAt || primo < store.startedAt)) store.startedAt = primo;
  fs.writeFileSync(FILE, JSON.stringify(store));
  console.log(`\nscritto ${FILE} (${Math.round(fs.statSync(FILE).size / 1024)} KB)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
