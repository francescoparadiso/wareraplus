# Import una tantum da un archivio esterno

Cinque cose che WarEra+ **non può ricostruire da sola**, e che un archivio
di terzi aveva già registrate:

| Script | Cosa | Da dove | Copertura |
|---|---|---|---|
| `bonifici.js` | Bonifici da tesoro a tesoro | `state_transactions` (`countryMoneyTransfer`) | 1.267 righe, dal 25 apr 2026 |
| `ricchezza.js` | Ricchezza giornaliera dei giocatori | `ranking_snapshot` (`userWealth`) | 1.545.772 righe, 91 giorni consecutivi, 19 giu → 17 set 2026 |
| `prezzi.js` | Prezzi di mercato | `price_daily` | 3.605 candele, 24 risorse, dal 9 apr 2026 |
| `diplomazia.js` | Patti, guerre, nemico giurato | `country_diplomacy` | 28.440 righe, 158 giorni, dal 13 apr 2026 |
| `battaglie.js` | Battaglie aperte giorno per giorno | `battle_snapshot` | 6.405 righe, 162 giorni, dal 9 apr 2026 |

La sorgente è il dump PostgreSQL di un altro tool della comunità
(`warera_pg_20260917_204055.dump`), passato dal suo autore. Dal dump
vengono estratti file di scambio già nella forma che serve qui — l'import
non parla con PostgreSQL, legge JSON e CSV.

Il motivo per cui questi dati valgono l'import, mentre tutto il resto si
potrebbe rifare: **il gioco non li espone all'indietro.** I bonifici hanno
una finestra scorrevole di ~70 ore (`moneyTransfers.js`), la ricchezza
esiste solo come "quanto ha adesso" (`wealth_snapshot` in `plusApi/db.js`),
i prezzi solo come "quanto costa adesso", e la diplomazia di ieri non è
interrogabile in nessun modo. Un giorno non guardato è perso per sempre — a meno che
non lo stesse guardando qualcun altro.

## Prima di importare

Gli import di bonifici e ricchezza muoiono al primo giro di manutenzione se
il codice sul VPS è quello vecchio: le retention erano tarate su archivi
che si accumulano da soli, e potano quello che arriva da qui. Prezzi,
diplomazia e battaglie hanno invece bisogno di moduli e rotte che sul VPS
non esistono ancora affatto.

Quindi **prima** si schiera il codice, **poi** si importa. Le due metà
vivono in due cartelle diverse sul VPS (`~/warera-cache-server/` e
`~/warera-plus-api/`), quindi sono due scp distinti:

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/warera-cache-server.js server/moneyTransfers.js server/priceHistory.js server/dayHistory.js server/import/bonifici.js server/import/prezzi.js server/import/diplomazia.js server/import/battaglie.js ubuntu@79.72.45.17:/home/ubuntu/warera-cache-server/
```

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/plusApi/wealth.js server/plusApi/db.js server/import/ricchezza.js ubuntu@79.72.45.17:/home/ubuntu/warera-plus-api/
```

⚠️ Gli script finiscono **accanto** ai moduli, non in una sottocartella
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
- `priceHistory.js` (nuovo): campione orario dei prezzi alle :27 e rotta
  `/price-history`.
- `dayHistory.js` (nuovo): scatto giornaliero alle 02:05 di diplomazia e
  battaglie aperte (zero fetch, legge le cache già scritte) e rotta
  `/day-history`.
- `warera-cache-server.js`: aggancio dei due moduli (require, init, cron,
  rotte, `/health`).

## Importare

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key money-transfers-import.json ranking_userWealth.csv.gz price_daily.csv.gz country_diplomacy.csv.gz battle_snapshot.csv.gz ubuntu@79.72.45.17:/tmp/
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

Misurato sul VPS: ~1,5 M di righe in poco più di un minuto, e rilanciarlo
non duplica niente (`0 inserite, già presenti`) — utile, perché **può
interrompersi**: se plusApi sta scrivendo (scatto ricchezza alle 02:00,
istantanee alle :15) SQLite risponde `database is locked`. Lo script
aspetta fino a 15 secondi, ma se capita basta rilanciarlo e riprende da
dove si era fermato.

`--prova` conta e non scrive. `--da 2026-06-19` salta i due giorni isolati
(1 maggio, 1 giugno) che da soli non fanno un intervallo leggibile.
`--solo utenti.txt` (un id per riga) limita l'import a certi giocatori:
serve se sul VPS lo spazio è poco, perché **l'import completo porta il
database di plusApi a ~290 MB** (misurato: 1,5 M di righe più i due
indici). Con i soli membri delle unità italiane sono pochi MB.

Prezzi, diplomazia e battaglie, da `~/warera-cache-server/`:

```bash
node prezzi.js /tmp/price_daily.csv.gz
node diplomazia.js /tmp/country_diplomacy.csv.gz
node battaglie.js /tmp/battle_snapshot.csv.gz
pm2 restart warera-cache
```

⚠️ **Il restart dopo `diplomazia.js` e `battaglie.js` serve davvero.**
`dayHistory.js` tiene una copia in memoria dei due file (sono megabyte, e
riparsarli ad ogni richiesta del client sarebbe uno spreco): un processo
già avviato non vede l'import, e allo scatto delle 02:05 riscriverebbe su
disco la sua copia vecchia più il giorno nuovo — cancellando quello che
l'import aveva appena messo. `prezzi.js` non ha questo problema (il file
si rilegge ad ogni campione), ma il restart li copre tutti e tre.

Tutti e tre accettano `--prova`. Nessuno sovrascrive un giorno che il
server ha già fotografato da sé: i suoi valori vengono dalla stessa fonte
di oggi, e per la diplomazia hanno anche il tesoro vero (il dump porta il
campo `money`, che è un'altra cosa e resta fuori — vedi il ⚠️ in testa a
`diplomazia.js`).

`battaglie.js` scarta le battaglie di tipo `tournament`: sono fra
giocatori, non fra nazioni, e il dump ci mette "Unknown" al posto dei due
nomi (1.732 righe su 8.137).

Nessuno degli script sovrascrive dati nostri: i bonifici si deduplicano
sull'id del gioco, la ricchezza entra con `INSERT OR IGNORE`, e prezzi,
diplomazia e battaglie saltano i giorni che il server ha già scattato.

## Cosa si vede dopo

- **Finanziatori nel dettaglio battaglia**: `coverageFrom` arretra al 25
  aprile, quindi le battaglie vecchie smettono di dire "fuori portata" e
  mostrano chi ha versato.
- **Bilancio unità**: i sette giorni della serie ci sono da subito invece
  che dopo una settimana, per ogni giocatore presente nella ladder.
- **Rendite di produzione**: nella riga aperta di ogni risorsa compare
  l'andamento del prezzo, con le variazioni a 7 e 30 giorni.
- **Time machine**: cliccando una nazione il popup dice con chi era in
  guerra QUEL giorno, che patti difensivi aveva e chi era il nemico
  giurato; sotto la classifica del territorio compaiono le battaglie
  aperte quel giorno. Prima del 13 aprile (diplomazia) e del 9 aprile
  (battaglie) la vista dice "prima dell'inizio dell'archivio" invece di
  mostrare un mondo in pace.

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
curl -s "https://warera-oracle.duckdns.org/warera-cache/day-history?day=2026-07-10" | head -c 200
curl -s https://warera-oracle.duckdns.org/warera-cache/health | python3 -m json.tool | grep -A12 dayHistory
```

`coverageFrom` deve essere aprile, e `giorniInArchivio` ~91 più i giorni
che il server ha già fotografato da solo.

Dal lato del tool: aprire una battaglia di luglio nel dettaglio battaglia
(i finanziatori non devono più dire "fuori portata") e il Bilancio unità,
dove la fascia "l'archivio si sta ancora riempiendo" sparisce da sola
appena `serieCompleta` diventa vera — nessuna modifica al client serve.
