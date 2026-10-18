/* ═══════════════════════════════════════════════════════════════════════
   UNA TANTUM — il seme del recupero dei danni per unità
   -----------------------------------------------------------------------
   server/muBattleDamage.js ricostruisce i danni giornalieri di ogni unità
   sommando la classifica per unità di ogni battaglia. Le battaglie degli
   ultimi 90 giorni le conosce dall'archivio (battle-archive.json); quelle
   prima stanno solo nel vecchio bootstrap, `cache/bootstrap-raw-battles.json`:
   15.240 battaglie, dal 2 maggio 2025 al 14 agosto 2026, 255 MB.

   Il server quel file non lo apre mai (954 MB di RAM in tutto il VPS, e
   readCache lo terrebbe intero in memoria per il tempo del parse). Lo apre
   questo script, UNA volta, in un processo suo, e ne tiene due campi per
   battaglia: id e ora di fine. Esce un file di ~600 KB,
   `cache/mu-backfill-seed.json`, che il modulo aggiunge alla coda del
   recupero al giro successivo (anche se è già partito senza: vedi
   _maybeAddSeed).

   Uso, sul VPS, dalla cartella del cache-server (dove stanno anche gli
   altri import, accanto a cache/):

       node --max-old-space-size=700 muBattleSeed.js

   Rilanciarlo non fa danni: riscrive lo stesso file, e il modulo ignora
   le battaglie già contate o già in coda.
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

// Sul VPS gli import stanno nella cartella del server, accanto a cache/; nel
// repo stanno in server/import/. Vanno bene tutti e due.
const CACHE_DIR = fs.existsSync(path.join(__dirname, 'cache'))
  ? path.join(__dirname, 'cache')
  : path.join(__dirname, '..', 'cache');
const SRC = path.join(CACHE_DIR, 'bootstrap-raw-battles.json');
const OUT = path.join(CACHE_DIR, 'mu-backfill-seed.json');

const ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

if (!fs.existsSync(SRC)) {
  console.error(`Manca ${SRC}: niente seme, il recupero si fermerà ai 90 giorni dell'archivio.`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf-8'));
const seen = new Set();
const seed = [];
for (const b of raw) {
  const id = b?._id;
  // Stessa regola di battleArchive._toRow: fine battaglia, o l'ultimo
  // aggiornamento se `endedAt` manca.
  const e = ts(b?.endedAt) || ts(b?.updatedAt);
  if (!id || !e || seen.has(id)) continue;
  // Una battaglia ancora aperta al momento del bootstrap non ha danni
  // definitivi: la conterà l'archivio, se è finita dopo.
  if (b.isActive) continue;
  seen.add(id);
  seed.push([id, e]);
}
seed.sort((a, b) => b[1] - a[1]);
fs.writeFileSync(OUT, JSON.stringify(seed));

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
console.log(`Seme scritto: ${seed.length} battaglie, dal ${day(seed[seed.length - 1][1])} al ${day(seed[0][1])} → ${OUT}`);
