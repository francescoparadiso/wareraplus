/* ═══════════════════════════════════════════════════════════════════════
   IMPORT UNA TANTUM — bonifici fra tesori da un archivio esterno
   -----------------------------------------------------------------------
   `server/moneyTransfers.js` non ha un bootstrap e non può averlo: l'API
   tiene una finestra scorrevole di ~70 ore e il cursore finisce lì. I 90
   giorni si accumulano dal primo avvio, e quello che è successo prima non
   esiste più da nessuna parte — a meno che qualcun altro non stesse
   guardando mentre succedeva.

   È il caso: l'archivio di un altro tool della comunità registra le
   transazioni di stato da aprile 2026. Questo script prende le righe già
   ridotte alla forma di WarEra+ e le fonde nell'archivio nostro.

   ── COSA NON FA ───────────────────────────────────────────────────────
   Non tocca le righe che il poll ha già raccolto: il dedup è sull'id
   della transazione, che è quello del gioco e non di chi l'ha salvata.
   Non inventa `coverageFrom`: lo riporta al bonifico più vecchio che
   dopo la fusione c'è davvero, perché è esattamente ciò che quel campo
   promette al client.

   ── USO (sul VPS, da ~/warera-cache-server/) ──────────────────────────
     node bonifici.js /tmp/money-transfers-import.json
     node bonifici.js /tmp/money-transfers-import.json --prova   ← non scrive

   Dopo: `pm2 restart warera-cache` non serve — il file viene riletto ad
   ogni richiesta. Serve invece aver già schierato il `moneyTransfers.js`
   con la retention allargata, altrimenti il primo giro di poll pota
   quello che questo script ha appena scritto.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

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
const FILE = path.join(CACHE_DIR, 'money-transfers.json');
const sorgente = args.find((a) => !a.startsWith('--') && a !== valore('--cache'));

if (!sorgente) {
  console.error('uso: node import/bonifici.js <file.json> [--prova] [--cache <cartella>]');
  process.exit(1);
}
if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}\nlancia dalla cartella del cache-server, o passa --cache <percorso>`);
  process.exit(1);
}

/** `a` può arrivare in ISO (leggibile nel file di scambio) o già in ms.
 *  L'archivio lo vuole in ms: è così che lo confronta il client. */
function quando(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : null;
}

function riga(r) {
  const a = quando(r?.a);
  const m = Number(r?.m);
  if (!r?.i || !r?.f || !r?.t || !a || !Number.isFinite(m)) return null;
  return { i: String(r.i), f: String(r.f), t: String(r.t), m, a };
}

const inGresso = JSON.parse(fs.readFileSync(sorgente, 'utf-8'));
if (!Array.isArray(inGresso)) {
  console.error('il file deve contenere un array di righe {i,f,t,m,a}');
  process.exit(1);
}

const importate = [];
let scartate = 0;
for (const r of inGresso) {
  const ok = riga(r);
  if (ok) importate.push(ok); else scartate++;
}

const store = fs.existsSync(FILE)
  ? JSON.parse(fs.readFileSync(FILE, 'utf-8'))
  : { fetchedAt: null, startedAt: null, data: [] };
const esistenti = Array.isArray(store.data) ? store.data : [];

// Il dedup è sull'id del gioco: se il poll aveva già visto un bonifico,
// la sua riga resta quella (stesso contenuto, ma è la nostra).
const visti = new Set(esistenti.map((r) => r.i));
const nuove = importate.filter((r) => !visti.has(r.i));

const fuse = [...esistenti, ...nuove].sort((a, b) => b.a - a.a);
const piuVecchio = fuse.length ? fuse[fuse.length - 1].a : null;

const iso = (t) => (t ? new Date(t).toISOString().slice(0, 16).replace('T', ' ') : '—');
console.log(`file di scambio: ${importate.length} righe valide` + (scartate ? `, ${scartate} scartate` : ''));
console.log(`archivio prima:  ${esistenti.length} righe, copertura dal ${iso(store.startedAt)}`);
console.log(`nuove da fondere: ${nuove.length}`);
console.log(`archivio dopo:   ${fuse.length} righe, copertura dal ${iso(piuVecchio)}`);

if (prova) {
  console.log('\n--prova: non ho scritto niente.');
  process.exit(0);
}

fs.writeFileSync(FILE, JSON.stringify({
  fetchedAt: store.fetchedAt,
  // `startedAt` è una promessa al client ("prima di qui non stavo
  // guardando"), e dopo la fusione la promessa può arretrare davvero.
  startedAt: piuVecchio,
  data: fuse,
}));
console.log(`\nscritto ${FILE}`);
