/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Aziende per nazione, notte per notte, recuperate dai BACKUP
   -----------------------------------------------------------------------
   Perché esiste: fino al 2026-11-26 il censimento aziende teneva per
   nazione solo l'ultima notte (`latest.countries`), e lo storico del numero
   di aziende in una nazione non c'era (vedi "QUANTE AZIENDE" in
   server/companyCensus.js). Ma ogni backup del VPS contiene il
   `company-census.json` di quella notte, cioè la fotografia VERA, contata
   allora, con le regioni di allora. Non è una ricostruzione: è rileggere
   quello che il server aveva già misurato e poi sovrascritto.

   Dove li prende:
     · i settimanali di backup.sh in ~/backup/<stamp>/cache.tar.gz (dall'11
       ottobre, una domenica alla settimana);
     · i giornalieri e settimanali nel bucket (rclone, `oci:warera-backup`),
       dal 27 ottobre: il bucket li pota a 30 / 180 giorni, quindi lanciarlo
       più tardi ne trova MENO, mai di più.
   Da ogni archivio estrae solo cache/company-census.json, in streaming
   (~45 MB a copia, niente su disco), e ne tiene il giorno italiano della
   fotografia (`day`) e le aziende per nazione. Due backup della stessa notte
   (il settimanale e il giornaliero della domenica) sono la stessa
   fotografia; se differiscono (un giro forzato nello stesso giorno) vince
   quella scattata più tardi, come avrebbe fatto il server.

   Scrive cache/company-count-backfill.json; il server lo legge da sé entro
   10 minuti, senza riavvio. Le notti registrate dal giro vincono sempre su
   quelle di qui.

   Uso, sul VPS, dalla cartella del cache-server:
     node import/aziendeDaiBackup.js [--prova] [--cache <cartella>]
     [--senza-bucket] [--backup <cartella dei settimanali>]
   ═══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const args = process.argv.slice(2);
const valore = (nome) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : null;
};
const PROVA = args.includes('--prova');

function cartellaCache() {
  const esplicita = valore('--cache');
  if (esplicita) return esplicita;
  const accanto = path.join(process.cwd(), 'cache');
  if (fs.existsSync(accanto)) return accanto;
  return path.join(__dirname, '..', 'cache');
}
const CACHE_DIR = cartellaCache();
const SETTIMANALI = valore('--backup') || path.join(os.homedir(), 'backup');
const RCLONE = process.env.RCLONE || path.join(os.homedir(), 'bin', 'rclone');
const REMOTE = process.env.REMOTE || 'oci:warera-backup';
const DENTRO = 'cache/company-census.json';

if (!fs.existsSync(CACHE_DIR)) {
  console.error(`cartella cache non trovata: ${CACHE_DIR}`);
  process.exit(1);
}

const sh = (cmd) => execSync(cmd, { maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** Le copie da leggere: [etichetta, comando che stampa il company-census.json]. */
function copie() {
  const out = [];
  if (fs.existsSync(SETTIMANALI)) {
    for (const d of fs.readdirSync(SETTIMANALI).sort()) {
      const f = path.join(SETTIMANALI, d, 'cache.tar.gz');
      if (fs.existsSync(f)) out.push([`disco:${d}`, `nice -n 19 tar -xzOf '${f}' ${DENTRO}`]);
    }
  }
  if (!args.includes('--senza-bucket') && fs.existsSync(RCLONE)) {
    for (const tipo of ['giornaliero', 'settimanale']) {
      let elenco = [];
      try { elenco = sh(`'${RCLONE}' lsf ${REMOTE}/${tipo}/`).toString().split('\n').filter(Boolean); }
      catch { console.warn(`bucket ${tipo}: elenco non leggibile, salto`); }
      for (const d of elenco) {
        out.push([`bucket:${tipo}/${d}`, `'${RCLONE}' cat '${REMOTE}/${tipo}/${d}cache.tar.gz' | nice -n 19 tar -xzO ${DENTRO}`]);
      }
    }
  }
  return out;
}

const notti = {};   // giorno → { updatedAt, countries: {cid: n}, world, src }
for (const [src, cmd] of copie()) {
  let j;
  try { j = JSON.parse(sh(cmd).toString()); }
  catch (e) { console.warn(`${src}: illeggibile (${e.message.slice(0, 80)})`); continue; }
  if (!j?.day || !j.latest?.countries) { console.warn(`${src}: niente fotografia per nazione`); continue; }
  const countries = {};
  for (const [cid, perCode] of Object.entries(j.latest.countries)) {
    let n = 0;
    for (const v of Object.values(perCode)) n += Number(v?.[0]) || 0;
    countries[cid] = n;
  }
  const world = Object.values(j.latest.items || {}).reduce((s, v) => s + (Number(v?.[0]) || 0), 0);
  const prima = notti[j.day];
  if (!prima || (j.updatedAt || 0) > prima.updatedAt) notti[j.day] = { updatedAt: j.updatedAt || 0, countries, world, src };
  console.log(`${src}: notte ${j.day}, ${world} aziende, ${Object.keys(countries).length} nazioni`);
}

const giorni = Object.keys(notti).sort();
if (!giorni.length) { console.error('nessuna fotografia trovata'); process.exit(1); }
const file = {
  createdAt: Date.now(),
  note: 'Aziende per nazione dove stanno, dal company-census.json di ogni backup (vedi server/import/aziendeDaiBackup.js).',
  days: Object.fromEntries(giorni.map((g) => [g, notti[g].countries])),
  world: Object.fromEntries(giorni.map((g) => [g, notti[g].world])),
  sources: Object.fromEntries(giorni.map((g) => [g, notti[g].src])),
};
console.log(`\n${giorni.length} notti, dal ${giorni[0]} al ${giorni[giorni.length - 1]}`);
if (PROVA) { console.log('--prova: niente scritto'); process.exit(0); }
fs.writeFileSync(path.join(CACHE_DIR, 'company-count-backfill.json'), JSON.stringify(file));
console.log(`scritto ${path.join(CACHE_DIR, 'company-count-backfill.json')}`);
