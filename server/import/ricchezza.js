/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — ricchezza giornaliera dei giocatori
   -----------------------------------------------------------------------
   `plusApi/wealth.js` fotografa la ricchezza dei membri delle unità
   italiane una volta al giorno, e il commento in testa a `wealth_snapshot`
   dice perché lo storico non si recupera: il gioco espone quanto un
   giocatore ha ADESSO e nient'altro. Sette giorni di serie arrivano dopo
   sette giorni, e un giorno saltato è perso.

   Qui entra l'archivio di un altro tool della comunità, che registra la
   classifica `userWealth` giorno per giorno: 91 giorni CONSECUTIVI dal
   19 giugno al 17 settembre 2026, tutta la ladder (~16.500 giocatori al
   giorno), più due giorni sparsi (1 maggio, 1 giugno) che restano isolati
   e da soli non fanno una differenza leggibile.

   ── LE RIGHE IMPORTATE HANNO `mu_id` VUOTO, ED È UNA SCELTA ────────────
   Il dump non dice in quale unità militasse il giocatore quel giorno.
   Riempire la colonna con l'unità di OGGI darebbe un aggregato per unità
   che copre tre mesi e attribuisce a un'unità anche i giorni in cui il
   giocatore stava altrove: un numero credibile e inventato, cioè il modo
   peggiore di sbagliare. Quindi resta NULL, e le conseguenze sono
   esattamente due:

     • la serie PER GIOCATORE (scattiRicchezza) copre tutti e tre i mesi;
     • l'aggregato PER UNITÀ (deltaRicchezzaPerMu, ultimoScattoMu) vede
       solo gli scatti veri del server, perché filtra su mu_id — ed è
       giusto così, quelli sanno di cosa parlano.

   `mu_id IS NULL` è quindi anche il marchio di provenienza: distingue una
   riga importata da una fotografata da noi, senza una colonna in più.

   ── NON SOVRASCRIVE ───────────────────────────────────────────────────
   `INSERT OR IGNORE`: se per un (giorno, giocatore) c'è già lo scatto del
   server, vince il nostro — ha mu_id, lo username del momento e un
   taken_at che è un'ora vera invece che una convenzione.

   ── USO (sul VPS, dalla cartella server/) ─────────────────────────────
   ── USO (sul VPS, da ~/warera-plus-api/) ──────────────────────────────
     node import/ricchezza.js /tmp/ranking_userWealth.csv.gz
     node import/ricchezza.js <file> --prova            ← conta e non scrive
     node import/ricchezza.js <file> --da 2026-06-19    ← salta i giorni isolati
     node import/ricchezza.js <file> --solo utenti.txt  ← un id per riga
     node import/ricchezza.js <file> --db data-dev/plus.sqlite  ← l'altro deploy

   Apre il file SQLite direttamente invece di chiedere il database a
   `db.js`: plusApi sul VPS sta in una cartella piatta (~/warera-plus-api)
   dove `../plusApi/db` non esiste, e un import che funziona in locale e
   non sul server è un import che non serve. Default: `data/plus.sqlite`
   sotto la cartella da cui si lancia, cioè il database del live.

   Prima serve aver schierato il `wealth.js` con la retention allargata:
   con i 14 giorni di prima, il primo scatto notturno pota tutto quello
   che questo script ha importato.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const { DatabaseSync } = require('node:sqlite');

const args = process.argv.slice(2);
const prova = args.includes('--prova');
const valore = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};
const daGiorno = valore('--da');
const fileSolo = valore('--solo');
const fileDb = valore('--db') || path.join(process.cwd(), 'data', 'plus.sqlite');
const sorgente = args.find((a) => !a.startsWith('--') && a !== daGiorno && a !== fileSolo && a !== valore('--db'));

if (!sorgente) {
  console.error('uso: node import/ricchezza.js <ranking_userWealth.csv[.gz]> [--prova] [--da YYYY-MM-DD] [--solo utenti.txt] [--db data/plus.sqlite]');
  process.exit(1);
}
if (!fs.existsSync(fileDb)) {
  console.error(`database non trovato: ${fileDb}\nlancia dalla cartella di plusApi, o passa --db <percorso>`);
  process.exit(1);
}

const solo = fileSolo
  ? new Set(fs.readFileSync(fileSolo, 'utf-8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  : null;

/** Le 02:00 italiane di quel giorno, cioè l'ora a cui lo scatto vero
 *  sarebbe stato preso. Il dump porta solo la data: mettere mezzanotte
 *  UTC farebbe leggere come "ieri" un intervallo che vale un giorno
 *  pieno. L'offset si chiede a Intl invece di scriverlo +02:00, così un
 *  giorno d'inverno non slitta di un'ora. */
function alleDueDiNotte(giorno) {
  const naive = Date.parse(`${giorno}T02:00:00Z`);
  if (!Number.isFinite(naive)) return null;
  const nome = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Rome', timeZoneName: 'longOffset' })
    .formatToParts(naive).find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(nome);
  const minuti = m ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3])) : 0;
  return naive - minuti * 60_000;
}

/** day,position,entity_id,"name",value — il nome è l'unico campo quotato
 *  (può contenere virgole), quindi si tagliano i tre campi davanti e
 *  l'ultimo dietro invece di scomodare un parser CSV. */
function riga(linea) {
  const a = linea.indexOf(',');
  const b = linea.indexOf(',', a + 1);
  const c = linea.indexOf(',', b + 1);
  const z = linea.lastIndexOf(',');
  if (a < 0 || b < 0 || c < 0 || z <= c) return null;
  let nome = linea.slice(c + 1, z);
  if (nome.startsWith('"') && nome.endsWith('"')) nome = nome.slice(1, -1).replace(/""/g, '"');
  const quanto = Number(linea.slice(z + 1));
  if (!Number.isFinite(quanto)) return null;
  return { giorno: linea.slice(0, a), userId: linea.slice(b + 1, c), nome, ricchezza: Math.round(quanto) };
}

async function main() {
  const db = new DatabaseSync(fileDb);
  // La tabella la crea plusApi al suo avvio: se manca, o si è sbagliato
  // database o quel processo non è mai partito. Crearla qui vorrebbe dire
  // rischiare uno schema diverso da quello vero.
  const c = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='wealth_snapshot'").get().n;
  if (!c) {
    console.error(`in ${fileDb} non c'è la tabella wealth_snapshot: database sbagliato, o plusApi non è mai partito.`);
    process.exit(1);
  }
  console.log(`database: ${fileDb}`);
  const prima = db.prepare('SELECT COUNT(*) AS n FROM wealth_snapshot').get().n;

  const ins = db.prepare(`INSERT OR IGNORE INTO wealth_snapshot
    (slot, war_user_id, wealth, username, mu_id, taken_at) VALUES (?, ?, ?, ?, NULL, ?)`);

  const flusso = sorgente.endsWith('.gz')
    ? fs.createReadStream(sorgente).pipe(zlib.createGunzip())
    : fs.createReadStream(sorgente);
  const righe = readline.createInterface({ input: flusso, crlfDelay: Infinity });

  const oreDi = new Map();     // giorno → taken_at, calcolato una volta per giorno
  const perGiorno = new Map(); // giorno → righe lette
  let lette = 0, saltate = 0, inserite = 0, aperta = false;
  const LOTTO = 20_000;

  const apri = () => { if (!prova && !aperta) { db.exec('BEGIN'); aperta = true; } };
  const chiudi = () => { if (aperta) { db.exec('COMMIT'); aperta = false; } };

  for await (const linea of righe) {
    if (!linea || linea.startsWith('day,')) continue;
    const r = riga(linea);
    if (!r) { saltate++; continue; }
    if (daGiorno && r.giorno < daGiorno) { saltate++; continue; }
    if (solo && !solo.has(r.userId)) { saltate++; continue; }
    lette++;
    perGiorno.set(r.giorno, (perGiorno.get(r.giorno) || 0) + 1);
    if (prova) continue;

    if (!oreDi.has(r.giorno)) oreDi.set(r.giorno, alleDueDiNotte(r.giorno));
    apri();
    inserite += ins.run(r.giorno, r.userId, r.ricchezza, r.nome || null, oreDi.get(r.giorno)).changes;
    // Una transazione ogni LOTTO righe: una sola da un milione e mezzo
    // tiene il journal in RAM per tutto il tempo, e una caduta a metà
    // rimanderebbe da capo.
    if (lette % LOTTO === 0) { chiudi(); process.stdout.write(`\r  ${lette} righe lette, ${inserite} inserite…`); }
  }
  chiudi();

  const dopo = prova ? prima : db.prepare('SELECT COUNT(*) AS n FROM wealth_snapshot').get().n;
  const giorni = [...perGiorno.keys()].sort();
  console.log(`\n\nrighe lette:   ${lette}` + (saltate ? ` (${saltate} saltate)` : ''));
  console.log(`giorni:        ${giorni.length}` + (giorni.length ? `  ${giorni[0]} → ${giorni.at(-1)}` : ''));
  console.log(`tabella prima: ${prima} righe`);
  if (prova) {
    console.log('\n--prova: non ho scritto niente.');
    return;
  }
  console.log(`inserite:      ${inserite}` + (lette - inserite ? `  (${lette - inserite} già presenti, non toccate)` : ''));
  console.log(`tabella dopo:  ${dopo} righe`);
  console.log('\nLe righe importate hanno mu_id vuoto: la serie per giocatore le usa,');
  console.log('l\'aggregato per unità no. È voluto — vedi il blocco in testa a questo file.');
}

main().catch((err) => { console.error(err); process.exit(1); });
