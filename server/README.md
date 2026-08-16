# warera-cache-server

Non fa parte del build di `wareraPlus` (Vite/Vercel) — gira su un VPS separato
(vedi CLAUDE.md/memoria di progetto per l'infrastruttura: nginx + pm2 +
`ampsodrick.duckdns.org/warera-cache/`). Tenuto qui solo per versionarlo
insieme al client che lo consuma (`src/diplomacy/cacheClient.js`), non per
deployarlo da qui — il deploy resta manuale sul VPS.

## Deploy di un aggiornamento

1. Copia `warera-cache-server.js` sul VPS, nella cartella dove già gira
   (sovrascrive il file esistente — la cartella `cache/` con i dati salvati
   NON va toccata, resta dov'è).
2. `pm2 restart warera-cache-server` (o il nome che hai dato al processo —
   `pm2 list` per controllare).
3. Verifica: `curl https://ampsodrick.duckdns.org/warera-cache/health`.

## Novità di questa versione (vedi commento in testa al file)

- Fix: `pollBattles()` leggeva un campo (`regionId`) che non esiste su una
  battaglia — `/battle-regions` era sempre vuoto.
- Nuovo: storico eventi ticker (guerre/sworn enemy/popolazione/tesoro)
  calcolato qui invece che nel browser di ogni utente — stesso file
  `ticker-history.json` già usato per le elezioni, nuovo campo `category`.
- Nuovo: storico ownership delle regioni (backend della time machine) —
  `region-history-keyframes.json` (checkpoint settimanali) +
  `region-history-events.json` (ogni cambio di proprietario, per sempre).
  Endpoint: `/region-history/range`, `/region-history/at?ts=`,
  `/region-history/events?since=&until=`.

## File di cache creati la prima volta che girano i poll nuovi

Non serve crearli a mano — `writeCache()`/`readCache()` li creano/leggono da
soli, con fallback a un default vuoto finché il primo poll utile non è
passato. `region-history-keyframes.json` in particolare si autopopola con un
keyframe "genesi" (1 maggio 2025, `GENESIS_TS`, dal campo `initialCountry` di
ogni regione) al primo poll di `pollRegionsObject()` dopo il deploy.

## Round 3 — bootstrap storico a ritmo lento

Scarica **una pagina di battaglie risolte al minuto** (100 battaglie/pagina,
via il Worker) in `bootstrap-raw-battles.json`, riprendendo da dove si era
fermato a ogni riavvio (`bootstrap-state.json`). Quando ha finito (nessuna
pagina in più), fa UN SOLO replay cronologico che sostituisce interamente
`region-history-keyframes/events.json` con la ricostruzione precisa (ogni
trasferimento datato al momento reale della battaglia, non più un unico
salto cumulativo dalla genesi a "adesso").

Parte da solo al deploy, nessun comando da lanciare. Per controllare a che
punto è:

```bash
curl https://ampsodrick.duckdns.org/warera-cache/bootstrap-status
```

Risponde `{ cursor, done, finalized, pagesFetched, battlesFetched }` —
`finalized:true` significa che la ricostruzione è completa e
`region-history-*` riflette già la storia dettagliata. Se il numero di
battaglie storiche è grande può volerci da qualche ora a qualche giorno
(1 pagina/minuto = ~1440 pagine/giorno = ~144.000 battaglie/giorno) — non è
un problema lasciarlo girare in background, la time machine funziona anche
mentre il bootstrap è ancora a metà, solo con la storia meno dettagliata di
prima finché non finisce.

## Round 4 — sorgente esterna (spywarera.com), sostituisce di fatto il bootstrap

`pollExternalHistory()` sincronizza ogni ora (`:25`, più una volta subito
all'avvio) con `https://spywarera.com/timemachine/map/events` — un endpoint
JSON pubblico che ha già lo storico ownership regioni completo dal 1 maggio
2025 a oggi, più affidabile della nostra ricostruzione. Ad ogni sync
**sostituisce interamente** `region-history-keyframes/events.json` con la
versione esterna + i soli eventi propri più recenti dell'ultimo evento
esterno noto (il "ponte" per il ritardo fra un loro poll e il prossimo). Se
il fetch fallisce non tocca nulla — resta l'ultimo stato buono.

```bash
curl https://ampsodrick.duckdns.org/warera-cache/region-history/external-status
```

Risponde `{ fetchedAt, generatedAt, externalEventsCount, externalLastTs, bridgeEventsCount }`.

**Bootstrap (round 3) DISATTIVATO**: dato che questo sync sovrascrive
`region-history-*` ogni ora con una fonte già completa, il bootstrap era
ridondante (1 pagina/minuto, poteva metterci ore/giorni per un risultato che
questo round rimpiazza comunque entro l'ora) — `cron.schedule('* * * * *',
pollBootstrapPage)` e la chiamata all'avvio sono commentate. Funzione e
endpoint `/bootstrap-status` restano nel file intatti, si riattiva togliendo
i due commenti se in futuro serve di nuovo (es. spywarera.com irraggiungibile
a lungo).

## Round 5 — peso delle risposte (gzip + /ticker/summary)

**Da deployare**: finché questo file non è aggiornato sul VPS il client
continua a funzionare, ma resta sul percorso vecchio e pesante (ricade su
`/ticker` e riprova `/ticker/summary` ogni mezz'ora).

- **gzip**: le risposte JSON uscivano non compresse (né da qui né da nginx).
  Ora vengono compresse sopra 1 KB, con `zlib` invece del middleware
  `compression` per non aggiungere una dipendenza npm da installare a mano.
  Misurato su `/ticker`: 1.393.778 → 134.224 byte.
- **`/ticker/summary?since=&windows=ts1,ts2`** (nuovo): il client non usa i
  singoli eventi di popolazione/tesoro, li somma per nazione su una finestra.
  Ora la somma la fa il server: risposta di ~4 KB compressi contro 1,4 MB, e
  soprattutto non cresce più con lo storico (la ritenzione a 14 giorni la
  faceva crescere ogni giorno). `/ticker` resta invariato per i client vecchi.
  Verificato: gli aggregati coincidono esattamente con quelli calcolati dal
  client (580 valori confrontati su 2 finestre, zero differenze).
- **`ticker-history.json` scritto compatto** (senza indentazione): è il file
  che cresce di più e viene riletto e riscritto ad ogni poll.

```bash
curl -s "https://ampsodrick.duckdns.org/warera-cache/ticker/summary?since=$(( ($(date +%s) - 172800) * 1000 ))&windows=$(( ($(date +%s) - 86400) * 1000 ))" | head -c 300
```

