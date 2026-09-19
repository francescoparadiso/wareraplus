#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  WarEra+ — backup degli archivi che non si rifanno
#  ---------------------------------------------------------------------
#  Perché esiste: fino al 2026-09-19 gran parte di questi dati esisteva
#  anche nel database di un altro tool della comunità, da cui è venuto
#  `import/`. Quel database chiude. Da qui in poi il VPS è l'UNICA copia
#  al mondo di: bonifici fra tesori dal 25 aprile, ricchezza giornaliera
#  dal 19 giugno, prezzi dal 9 aprile, diplomazia dal 13 aprile,
#  battaglie aperte dal 9 aprile, salari e tasse di 51 giorni.
#
#  Nessuno di questi si ricostruisce: il gioco espone solo l'ADESSO. Un
#  disco perso qui non è un disservizio, è la cancellazione di cinque
#  mesi di storia di WarEra.
#
#  ── COSA SALVA, E COSA NO ─────────────────────────────────────────────
#  Salva `cache/` (gli archivi del cache-server) e i due `plus.sqlite`
#  (live e dev). NON salva `cache/bootstrap-raw-battles.json`: sono 244 MB
#  di risposte grezze, ed è l'unico file qui dentro che si RIFÀ da solo
#  (il bootstrap notturno lo riscarica dall'API, vedi battleArchive.js).
#  Tenerlo quadruplicherebbe il peso di ogni copia per l'unica cosa che
#  non serve conservare.
#
#  ── PERCHÉ `VACUUM INTO` E NON `cp` ───────────────────────────────────
#  plusApi scrive mentre giriamo (istantanee alle :15, scatto alle 02:00)
#  e SQLite è in modalità WAL: copiare il file con `cp` prende un
#  database a metà, senza il WAL che lo completa. `VACUUM INTO` chiede a
#  SQLite una copia COERENTE e già compattata, senza fermare nessuno.
#
#  ── USO ───────────────────────────────────────────────────────────────
#    ./backup.sh              → una copia in ~/backup/, ruota le vecchie
#    ./backup.sh /altra/dir   → altrove
#  Da cron (domenica alle 04:00, quando il gioco è vuoto e il bootstrap
#  battaglie ha finito):
#    0 4 * * 0 /home/ubuntu/warera-cache-server/backup.sh >> /home/ubuntu/backup/backup.log 2>&1
#
#  ⚠️ Una copia sullo STESSO disco non è un backup: protegge da un bug di
#  potatura o da un import sbagliato, non dalla perdita della macchina.
#  Il passo che conta è portarsela via — vedi server/README.md.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

DEST="${1:-$HOME/backup}"
COPIE_DA_TENERE="${COPIE_DA_TENERE:-4}"
CACHE_DIR="$HOME/warera-cache-server/cache"
PLUS_DIR="$HOME/warera-plus-api/data"
PLUS_DEV_DIR="$HOME/warera-plus-api/data-dev"

STAMP="$(date +%Y%m%d-%H%M)"
WORK="$DEST/$STAMP"
mkdir -p "$WORK"

echo "[backup] $STAMP → $WORK"

# ── 1. Gli archivi del cache-server ────────────────────────────────────
if [ -d "$CACHE_DIR" ]; then
  tar -czf "$WORK/cache.tar.gz" \
      --exclude='bootstrap-raw-battles.json' \
      -C "$(dirname "$CACHE_DIR")" "$(basename "$CACHE_DIR")"
  echo "[backup] cache.tar.gz $(du -h "$WORK/cache.tar.gz" | cut -f1)"
else
  echo "[backup] ATTENZIONE: $CACHE_DIR non esiste, saltato"
fi

# ── 2. I due database di plusApi ───────────────────────────────────────
salva_sqlite() {
  local sorgente="$1/plus.sqlite" nome="$2"
  [ -f "$sorgente" ] || { echo "[backup] $sorgente non esiste, saltato"; return 0; }
  # `readOnly` no: VACUUM INTO deve poter leggere il WAL. Non scrive sulla
  # sorgente, scrive solo la copia.
  node --disable-warning=ExperimentalWarning -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('$sorgente');
    db.exec(\"VACUUM INTO '$WORK/$nome.sqlite'\");
    db.close();
  "
  gzip -f "$WORK/$nome.sqlite"
  echo "[backup] $nome.sqlite.gz $(du -h "$WORK/$nome.sqlite.gz" | cut -f1)"
}
salva_sqlite "$PLUS_DIR" plus
salva_sqlite "$PLUS_DEV_DIR" plus-dev

# ── 3. Cosa c'era dentro, in chiaro ────────────────────────────────────
# Un backup che non dice cosa contiene si scopre incompleto il giorno in
# cui serve. Questo file si legge senza scompattare niente.
{
  echo "backup WarEra+ del $(date -Is)"
  echo
  echo "## righe negli archivi che non si rifanno"
  for f in money-transfers price-history day-history-diplomacy day-history-battles labour-history; do
    [ -f "$CACHE_DIR/$f.json" ] && echo "  $f.json  $(du -h "$CACHE_DIR/$f.json" | cut -f1)"
  done
  echo
  echo "## ricchezza giornaliera (plusApi live)"
  node --disable-warning=ExperimentalWarning -e "
    const { DatabaseSync } = require('node:sqlite');
    try {
      const db = new DatabaseSync('$PLUS_DIR/plus.sqlite', { readOnly: true });
      const t = db.prepare('SELECT COUNT(*) n, MIN(slot) a, MAX(slot) b FROM wealth_snapshot').get();
      console.log('  righe ' + t.n + ', dal ' + t.a + ' al ' + t.b);
    } catch (e) { console.log('  non leggibile: ' + e.message); }
  " 2>/dev/null || echo "  non leggibile"
  echo
  df -h / | tail -1
} > "$WORK/CONTENUTO.txt"

# ── 4. Rotazione ───────────────────────────────────────────────────────
# Si tiene COPIE_DA_TENERE cartelle. Il database cresce di ~1,1 GB
# all'anno, quindi anche le copie crescono: se un giorno il disco stringe,
# la risposta è alzare la cadenza o portarle via più spesso, non potare
# l'archivio (vedi PAVIMENTO in plusApi/wealth.js).
cd "$DEST"
ls -1d 20*-* 2>/dev/null | sort -r | tail -n +"$((COPIE_DA_TENERE + 1))" | while read -r vecchia; do
  echo "[backup] rimuovo la copia vecchia $vecchia"
  rm -rf "$vecchia"
done

echo "[backup] fatto: $(du -sh "$WORK" | cut -f1) in $WORK"
df -h / | tail -1
