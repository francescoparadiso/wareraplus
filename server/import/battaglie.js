/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — battaglie aperte, giorno per giorno
   -----------------------------------------------------------------------
   Riempie `cache/day-history-battles.json` (server/dayHistory.js) con la
   tabella `battle_snapshot` del dump: 8.137 fotografie di battaglia, dal
   9 aprile al 17 settembre 2026, una per battaglia e per giorno.

   ⚠️ NON è un secondo archivio battaglie, e non va fuso con quello vero
   (`battleArchive.js`). Quello tiene danno, taglie pagate e contratti
   mercenari; qui non c'è NIENTE di tutto ciò — `battle_snapshot` porta
   potenza dei due schieramenti, colpi totali e bilancio, e non ha né la
   regione né gli id delle nazioni (solo nomi e codici ISO). Serve a una
   domanda diversa: «cosa stava succedendo quel giorno», che è la domanda
   della time machine.

   ── LE COLONNE DEL DUMP ───────────────────────────────────────────────
       battle_id, day, war_id, type, is_active, attacker_name,
       defender_name, attacker_power, defender_power, front_intensity,
       total_hits, power_delta, balance, rounds_to_win,
       attacker_rounds_won, defender_rounds_won, started_at,
       attacker_code, defender_code, updated_at

   Si tiene una riga per (battaglia, giorno). Una battaglia lunga compare
   quindi in più giorni con numeri diversi, ed è giusto così: la time
   machine chiede un giorno, non una battaglia.

   ── USO (sul VPS, da ~/warera-cache-server/) ──────────────────────────
     node battaglie.js /tmp/battle_snapshot.csv.gz --prova
     node battaglie.js /tmp/battle_snapshot.csv.gz
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
const CACHE_DIR = valore('--cache') || path.join(__dirname, '..', 'cache');
const FILE = path.join(CACHE_DIR, 'day-history-battles.json');
const sorgente = args.find((a) => !a.startsWith('--') && a !== valore('--cache'));

if (!sorgente) {
  console.error('uso: node battaglie.js <battle_snapshot.csv[.gz]> [--prova] [--cache <cartella>]');
  process.exit(1);
}
if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}\nlancia dalla cartella del cache-server, o passa --cache <percorso>`);
  process.exit(1);
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const testo = (v) => (v && v !== '\\N' ? v : null);

async function main() {
  const store = fs.existsSync(FILE)
    ? JSON.parse(fs.readFileSync(FILE, 'utf-8'))
    : { fetchedAt: null, startedAt: null, days: {} };
  if (!store.days) store.days = {};

  const flusso = sorgente.endsWith('.gz')
    ? fs.createReadStream(sorgente).pipe(zlib.createGunzip())
    : fs.createReadStream(sorgente);
  const righe = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  const nuovi = new Map();
  let lette = 0, scartate = 0;

  for await (const linea of righe) {
    if (!linea) continue;
    const p = linea.split('\t');
    if (p.length < 19) { scartate++; continue; }
    const [battleId, giorno, , tipo, , attNome, difNome, attPot, difPot, , colpi, , bilancio] = p;
    const attCod = p[17], difCod = p[18];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(giorno) || !battleId) { scartate++; continue; }
    // I tornei si saltano: sono fra giocatori, non fra nazioni — il dump
    // infatti ci mette "Unknown" al posto dei due nomi (1.732 righe su
    // 8.137, tutte e sole quelle di tipo tournament). Su una mappa che
    // racconta la giornata di un mondo diviso in nazioni non dicono niente.
    if (tipo === 'tournament' || attNome === 'Unknown' || difNome === 'Unknown') { scartate++; continue; }
    lette++;
    if (!nuovi.has(giorno)) nuovi.set(giorno, []);
    // Stesso schema degli scatti nostri (vedi dayHistory.js: snapshotDay).
    // Le ultime due colonne — il danno — restano null: il dump non ce l'ha,
    // e uno zero qui direbbe "battaglia senza colpi".
    nuovi.get(giorno).push([
      battleId,
      testo(tipo) || 'war',
      testo(attNome), testo(attCod),
      testo(difNome), testo(difCod),
      num(attPot), num(difPot),
      num(colpi),
      testo(bilancio),
      null, null,
    ]);
  }

  let aggiunti = 0, saltati = 0;
  for (const [giorno, rs] of nuovi) {
    if (store.days[giorno]) { saltati++; continue; }
    store.days[giorno] = rs;
    aggiunti++;
  }

  const giorni = [...nuovi.keys()].sort();
  const perGiorno = giorni.length ? Math.round(lette / giorni.length) : 0;
  console.log(`righe lette:   ${lette}` + (scartate ? ` (${scartate} scartate)` : ''));
  console.log(`giorni nel file: ${giorni.length}  ${giorni[0]} → ${giorni.at(-1)}  (~${perGiorno} battaglie/giorno)`);
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
