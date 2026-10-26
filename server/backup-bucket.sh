#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════
#  WarEra+ — backup portato FUORI dal VPS (Oracle Object Storage)
#  ---------------------------------------------------------------------
#  Perché esiste: `backup.sh` scrive sullo stesso disco degli archivi, e
#  il suo stesso commento lo dice — una copia lì protegge da un bug di
#  potatura, non dalla perdita della macchina. Questo script fa una copia
#  con `backup.sh` e la carica nel bucket `warera-backup` (eu-milan-1),
#  che vive su sistemi separati dalle VM: sopravvive a un disco rotto, a
#  una VM cancellata o al trasloco sulla A1.
#
#  ── GIORNALIERO E SETTIMANALE ─────────────────────────────────────────
#  Ogni giorno una copia in `giornaliero/<stamp>/`; la domenica invece in
#  `settimanale/<stamp>/`, ed è la copia che `backup.sh` ha appena fatto
#  alle 04:00 in ~/backup (non se ne fa una seconda). La pulizia NON la
#  fa questo script: sono le regole di ciclo di vita del bucket
#  (giornaliero/ dopo 30 giorni, settimanale/ dopo 180). ~240 MB a copia,
#  quindi ~13 GB a regime sui 20 GB del piano gratuito.
#
#  ── PERCHÉ IL VPS NON PUÒ CANCELLARE ──────────────────────────────────
#  Il VPS entra nel bucket come "instance principal" (dynamic group
#  `warera-vps-backup`): nessuna chiave sul disco. E la policy gli dà solo
#  OBJECT_CREATE / INSPECT / READ — niente DELETE, niente OVERWRITE. Chi
#  prendesse il VPS può aggiungere file al bucket, non svuotarlo. Per lo
#  stesso motivo i caricamenti multipart interrotti li pulisce la regola
#  del bucket (7 giorni), non rclone.
#
#  ── USO ───────────────────────────────────────────────────────────────
#    ./backup-bucket.sh                → giornaliero (settimanale la domenica)
#    ./backup-bucket.sh giornaliero    → forza il tipo
#  Da cron, ogni giorno alle 04:30 UTC (dopo il backup.sh della domenica):
#    30 4 * * * /home/ubuntu/warera-cache-server/backup-bucket.sh >> /home/ubuntu/backup/backup-bucket.log 2>&1
#  Richiede ~/bin/rclone (≥ 1.61, quello di apt è troppo vecchio) e il
#  remote `oci` in ~/.config/rclone/rclone.conf — vedi server/README.md.
# ═══════════════════════════════════════════════════════════════════════
set -euo pipefail

RCLONE="${RCLONE:-$HOME/bin/rclone}"
REMOTE="${REMOTE:-oci:warera-backup}"
QUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$HOME/backup-bucket-tmp"
SETTIMANALI="$HOME/backup"

if [ "$(date -u +%u)" = 7 ]; then TIPO=settimanale; else TIPO=giornaliero; fi
TIPO="${1:-$TIPO}"

echo "[bucket] $(date -Is) tipo=$TIPO"

# ── 1. La copia da caricare ────────────────────────────────────────────
# La domenica c'è già quella di backup.sh delle 04:00: si usa quella.
SORGENTE=""
if [ "$TIPO" = settimanale ]; then
  oggi="$(date -u +%Y%m%d)"
  ultima="$(ls -1d "$SETTIMANALI"/"$oggi"-* 2>/dev/null | sort | tail -n 1 || true)"
  [ -n "$ultima" ] && SORGENTE="$ultima"
fi
if [ -z "$SORGENTE" ]; then
  rm -rf "$TMP"
  nice -n 19 ionice -c3 "$QUI/backup.sh" "$TMP"
  SORGENTE="$(ls -1d "$TMP"/20*-* | sort | tail -n 1)"
fi
STAMP="$(basename "$SORGENTE")"
DEST="$REMOTE/$TIPO/$STAMP"

# ── 2. Caricamento e verifica ──────────────────────────────────────────
# --immutable: un file già presente e diverso è un errore, mai una
# sovrascrittura (che comunque la policy rifiuterebbe).
"$RCLONE" copy "$SORGENTE" "$DEST" --immutable --retries 5 --low-level-retries 20
"$RCLONE" check "$SORGENTE" "$DEST" --one-way
echo "[bucket] caricato e verificato: $DEST ($(du -sh "$SORGENTE" | cut -f1))"

# ── 3. Pulizia della copia temporanea (mai di quelle settimanali) ──────
rm -rf "$TMP"
