# Import una tantum da un archivio esterno

Due cose che WarEra+ **non può ricostruire da sola**, e che un archivio di
terzi aveva già registrate:

| Cosa | Da dove | Copertura |
|---|---|---|
| Bonifici da tesoro a tesoro | `state_transactions` (`countryMoneyTransfer`) | 1.267 righe, dal 25 apr 2026 |
| Ricchezza giornaliera dei giocatori | `ranking_snapshot` (`userWealth`) | 1.545.772 righe, 91 giorni consecutivi, 19 giu → 17 set 2026 |

La sorgente è il dump PostgreSQL di un altro tool della comunità
(`warera_pg_20260917_204055.dump`), passato dal suo autore. Dal dump
vengono estratti file di scambio già nella forma che serve qui — l'import
non parla con PostgreSQL, legge un JSON e un CSV.

Il motivo per cui questi due dati valgono l'import, mentre tutto il resto
si potrebbe rifare: **il gioco non li espone all'indietro.** I bonifici
hanno una finestra scorrevole di ~70 ore (`moneyTransfers.js`), la
ricchezza esiste solo come "quanto ha adesso" (`wealth_snapshot` in
`plusApi/db.js`). Un giorno non guardato è perso per sempre — a meno che
non lo stesse guardando qualcun altro.

## Prima di importare

Entrambi gli import muoiono al primo giro di manutenzione se il codice sul
VPS è quello vecchio: le retention erano tarate su archivi che si
accumulano da soli, e potano quello che arriva da qui.

Quindi **prima** si schiera il codice, **poi** si importa. Le due metà
vivono in due cartelle diverse sul VPS (`~/warera-cache-server/` e
`~/warera-plus-api/`), quindi sono due scp distinti:

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/moneyTransfers.js server/import/bonifici.js ubuntu@79.72.45.17:/home/ubuntu/warera-cache-server/
```

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/plusApi/wealth.js server/plusApi/db.js server/import/ricchezza.js ubuntu@79.72.45.17:/home/ubuntu/warera-plus-api/
```

⚠️ I due script finiscono **accanto** ai moduli, non in una sottocartella
`import/`: entrambi i deploy sono cartelle piatte. Lanciandoli da lì i
percorsi di default (`cache/` e `data/plus.sqlite`) sono già giusti.

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 "pm2 restart warera-cache warera-plus-api warera-plus-api-dev"
```

Cosa è cambiato nel codice, e perché:

- `moneyTransfers.js`: retention 90 → 180 giorni (i bonifici importati
  partono da aprile).
- `plusApi/wealth.js`: `RETENTION_GIORNI` 14 → 180, e le due letture più
  frequenti passano un confine al database.
- `plusApi/db.js`: nuovo indice `idx_wealth_user_slot (war_user_id, slot)`
  — la chiave primaria comincia da `slot`, e la serie di un'unità cercava
  per giocatore. Misurato su 1,5 M di righe: 14 ms con l'indice.

## Importare

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key money-transfers-import.json ranking_userWealth.csv.gz ubuntu@79.72.45.17:/tmp/
```

Bonifici, da `~/warera-cache-server/` (il file viene riletto ad ogni
richiesta: nessun restart):

```bash
node bonifici.js /tmp/money-transfers-import.json --prova
node bonifici.js /tmp/money-transfers-import.json
```

Ricchezza, da `~/warera-plus-api/` — `--db` perché i deploy sono due e il
default è quello del live:

```bash
node --disable-warning=ExperimentalWarning ricchezza.js /tmp/ranking_userWealth.csv.gz --da 2026-06-19 --prova
node --disable-warning=ExperimentalWarning ricchezza.js /tmp/ranking_userWealth.csv.gz --da 2026-06-19
node --disable-warning=ExperimentalWarning ricchezza.js /tmp/ranking_userWealth.csv.gz --da 2026-06-19 --db data-dev/plus.sqlite
```

Misurato in locale su Node 24: ~1,5 M di righe in poco più di un minuto,
rilanciarlo non duplica niente (`0 inserite, già presenti`).

`--prova` conta e non scrive. `--da 2026-06-19` salta i due giorni isolati
(1 maggio, 1 giugno) che da soli non fanno un intervallo leggibile.
`--solo utenti.txt` (un id per riga) limita l'import a certi giocatori:
serve se sul VPS lo spazio è poco, perché **l'import completo porta il
database di plusApi a ~290 MB** (misurato: 1,5 M di righe più i due
indici). Con i soli membri delle unità italiane sono pochi MB.

Nessuno dei due script sovrascrive dati nostri: i bonifici si deduplicano
sull'id del gioco, la ricchezza entra con `INSERT OR IGNORE` e lo scatto
del server vince sempre.

## Cosa si vede dopo

- **Finanziatori nel dettaglio battaglia**: `coverageFrom` arretra al 25
  aprile, quindi le battaglie vecchie smettono di dire "fuori portata" e
  mostrano chi ha versato.
- **Bilancio unità**: i sette giorni della serie ci sono da subito invece
  che dopo una settimana, per ogni giocatore presente nella ladder.

⚠️ Le righe importate hanno **`mu_id` vuoto** (il dump non dice in quale
unità stava il giocatore quel giorno, e riempirlo con l'unità di oggi
sarebbe un numero credibile e inventato). Conseguenza: la **scheda del
singolo giocatore** usa i tre mesi importati, l'**elenco per unità**
continua a contare solo gli scatti veri del server, perché aggrega su
`mu_id`. È voluto, ed è scritto anche in testa a `import/ricchezza.js`.

## Verifiche

```bash
curl -s https://warera-oracle.duckdns.org/warera-cache/money-transfers | head -c 300
curl -s https://warera-oracle.duckdns.org/warera-plus-api/health | python3 -m json.tool | grep -A8 ricchezza
```

`coverageFrom` deve essere aprile, e `giorniInArchivio` ~91 più i giorni
che il server ha già fotografato da solo.

Dal lato del tool: aprire una battaglia di luglio nel dettaglio battaglia
(i finanziatori non devono più dire "fuori portata") e il Bilancio unità,
dove la fascia "l'archivio si sta ancora riempiendo" sparisce da sola
appena `serieCompleta` diventa vera — nessuna modifica al client serve.
