# warera-cache-server

Non fa parte del build di `wareraPlus` (Vite/Vercel) — gira su un VPS separato
(vedi CLAUDE.md/memoria di progetto per l'infrastruttura: nginx + pm2 +
`warera-oracle.duckdns.org/warera-cache/`). Tenuto qui solo per versionarlo
insieme al client che lo consuma (`src/diplomacy/cacheClient.js`), non per
deployarlo da qui — il deploy resta manuale sul VPS.

## Deploy di un aggiornamento

Host attuale: `ubuntu@79.72.45.17` (`warera-oracle.duckdns.org`), chiave e
appunti in `warEra/serverOracle/`. In pratica:

Entrambi i comandi si lanciano **dal PC, dalla root del repo**
(`warEra/wareraPlus/`) — non da dentro una sessione ssh sul VPS, dove la
cartella `server/` non esiste. La chiave sta una cartella più in su, in
`warEra/serverOracle/`, da cui il `../` nel percorso.

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/warera-cache-server.js server/proxyIndex.js server/languages.js server/package.json ubuntu@79.72.45.17:/home/ubuntu/warera-cache-server/
```

Prima di riavviare conviene un controllo: il `require('./proxyIndex')` sta in
cima al file, quindi un file mancante uccide il processo al caricamento e pm2
lo riavvia in loop.

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 "cd warera-cache-server && ls -la proxyIndex.js languages.js package.json && node --check warera-cache-server.js && echo PREFLIGHT-OK"
```

Solo se stampa `PREFLIGHT-OK`:

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 "pm2 restart warera-cache && sleep 20 && pm2 logs warera-cache --lines 40 --nostream"
```

⚠️ **Da agosto 2026 i file da copiare sono quattro, non uno.**
`warera-cache-server.js` fa `require('./proxyIndex')` (radar dei proxy), che a
sua volta richiede `./languages`: se copi solo il primo, il processo non parte
proprio. `package.json` dichiara `"type": "commonjs"` — sul VPS non serviva
finché la cartella era senza package.json, ma copiarlo mette al riparo dal
caso in cui qualcosa ne crei uno.

1. Copia i file sul VPS, nella cartella dove già gira
   (sovrascrive il file esistente — la cartella `cache/` con i dati salvati
   NON va toccata, resta dov'è).
2. `pm2 restart warera-cache-server` (o il nome che hai dato al processo —
   `pm2 list` per controllare).
3. Verifica: `curl https://warera-oracle.duckdns.org/warera-cache/health`.

## Radar dei proxy (`/proxy-index`)

`pollProxyIndex()` gira ogni 6 ore (:45) e calcola, per ogni nazione, quale
altra nazione la controlla e con che sicurezza. Il client ha già un suo
punteggio (`src/proxy/radar.js`) su tre segnali pubblici; qui se ne aggiunge
il più forte, **la lingua di chi governa**, che dal browser costerebbe una
`user.getUserById` per ogni membro di governo (~1.600 chiamate).

Costo: due richieste per i governi (`government.getByCountryId` in batch da
100) più le lingue ancora sconosciute, in batch da **35** — non 100:
verificato dal vivo che 100 `user.getUserById` in un solo GET batch superano
la lunghezza massima dell'URL e tornano **HTTP 414**. La mappa
utente→lingua è persistente (`cache/user-locales.json`, TTL 30 giorni),
quindi il primo giro dopo il deploy costa ~50 richieste e i successivi quasi
niente: le elezioni rinnovano circa 1,4 volti per nazione a tornata.

Il primo giro parte all'avvio **solo se l'indice non esiste ancora**, così un
`pm2 restart` non ripaga quel conto ogni volta.

Se questo endpoint non risponde il client non se ne accorge: ricalcola in
proprio i tre segnali che sa fare e mostra quelli (misurato: 145 ms).

## Novità: directory unità militari (`/mu-directory`)

`pollMuDirectory()` gira ogni 30 minuti (:12 e :42) e pagina a cursore
`mu.getManyPaginated` via Worker — oggi 1379 unità, 14 pagine. Salva una
versione ridotta (nome, nazione, regione, numero membri, avatar, le sei
`rankings` mu*): 557 KB invece dei 2,0 MB grezzi, perché i ~16k userId dei
membri sono i tre quarti del payload e non servono a una lista.

Il DETTAGLIO di una singola unità non passa da qui: il client chiama
`mu.getById` on-demand solo per l'unità che apre (i membri cambiano di
continuo). Finché questo file non è deployato, `/mu-directory` risponde 404
e il client ricade da solo sulla paginazione diretta — funziona, ma sono 14
richieste per ogni utente invece di una.

### Nazionalità "de facto" dei membri

Sempre dentro `pollMuDirectory`: per ogni unità si conta da quali nazioni
vengono i suoi membri, così il tool può segnalare le MU registrate sotto una
nazione ma composte in maggioranza da cittadini di un'altra (verificato:
6 delle prime 25 per danni settimanali).

La nazione di un utente si sa solo da `user.getUserLite`, una chiamata per
utente, ~4,3 KB l'una: risolvere tutti i 16k membri ad ogni giro sarebbe
~65 MB ogni 30 minuti. Si tiene quindi la mappa persistente
`mu-user-countries.json` (`userId → [countryId, timestamp]`) e ogni giro ne
risolve al massimo `MU_USER_LOOKUP_BUDGET` = 2000 fra sconosciuti e più
vecchi di 14 giorni.

**Conseguenza al primo avvio dopo il deploy**: servono ~8 giri (≈4 ore)
perché la mappa si riempia; nel frattempo la composizione esce parziale —
il campo `known` dice su quanti membri è calcolata, e il client mostra le
percentuali su quelli. La mappa viene potata ad ogni giro dei membri non
più tesserati, quindi non cresce indefinitamente (~16k voci, ~700 KB).

### Stile di gioco: guerra / economia (`/mu-playstyle-by-country`)

Dalla **stessa** risposta `user.getUserLite` già scaricata per la nazionalità
si ricava anche come gioca l'utente, guardando dove ha messo i punti abilità
(`classifyPlaystyle`). Costo aggiuntivo in chiamate: zero.

Il metodo, con le verifiche che lo sostengono, è documentato in
`src/mu/playstyle.js` — in breve: contano solo i `level` delle skill (non
`value`/`total`, che includono armi, equipaggiamento e basi che hanno tutti),
un livello *n* costa `n(n+1)/2` punti (verificato contro `spentSkillPoints`
su 900 utenti, 900 su 900), le skill neutre restano fuori, e le soglie 0,3 /
0,7 vengono dalla distribuzione reale, che è bimodale.

La mappa passa quindi da `[countryId, ts]` a `[countryId, ts, stile]`.
**Migrazione automatica**: le voci a due elementi scritte dalla versione
precedente vengono rimesse in coda di risoluzione con priorità, quindi dopo
il deploy la mappa si aggiorna da sola in ~8 giri senza cancellare niente.

Due uscite: il conteggio per unità (campo `playstyle` di ogni voce di
`/mu-directory`) e l'aggregato per nazione (`/mu-playstyle-by-country`,
qualche KB — sta in un endpoint suo perché il pannello nazione non deve
scaricare 1 MB di directory per mostrare tre numeri).

### Censimento cittadini (`/citizens`)

`user.getUsersByCountry` elenca **tutti** i cittadini di una nazione (solo
`_id` e `createdAt`, 100 per pagina, a cursore). Non e' un campione: e'
l'elenco vero. Misurato dal vivo — Italia 430 cittadini contro i 401 di
`rankings.countryActivePopulation`, e su 14 nazioni il rapporto sta stabile
a 1,07: la classifica conta gli **attivi**, questo conta gli **iscritti**.

`pollCitizens` (ogni ora, :36) chiede la pagina successiva di tutte le
nazioni che ne hanno ancora una, in batch da 100 procedure: il censimento
completo del mondo sono **13 richieste, 1,3 MB, 4 secondi** (16.784
cittadini in 180 nazioni, 12 giri). Endpoint `/citizens` → per nazione
`{ n, new24h, new7d }` (gli elenchi di userId restano sul server).

Cosa cambia a valle:

- **utente → nazione arriva gratis**: prima la si scopriva spendendo una
  `user.getUserLite` per ogni membro di unita' militare, con ~4 ore di
  riscaldamento dopo ogni deploy. Ora il censimento la porta al primo giro,
  ed e' anche piu' corretta: chi cambiava paese restava contato nel vecchio
  (misurato: una nazione al 104% dei suoi cittadini reali).
- **stile di gioco sul censimento**: `playstyleByCountry` itera sui
  cittadini censiti, non piu' sui soli tesserati, e ogni voce porta `total`
  = cittadini della nazione. Il client mostra la copertura vera ("430 su
  430") al posto della formula "sui cittadini tesserati in una unita'
  militare". Copertura misurata dopo il primo giro: **100%**.
- la coda di risoluzione skill copre ora cittadini censiti + membri MU
  (~19k voci): stesso ordine di grandezza di prima, non lavoro in piu'.

### Nome e avatar dei giocatori (`/users-lite`)

I grafici parlamento mostrano faccia e nome di ogni eletto e di ogni membro
del governo. Il client li prendeva da `user.getUserLite`, una chiamata per
utente accorpata in batch da 50: per un blocco di venti nazioni sono ~300
utenti in sei richieste al Worker, e ogni utente arriva **intero** (~3,8 KB:
skill, ranking, statistiche) per i due campi che servono.

`resolveUsersLite` tiene una mappa `userId → [username, avatarUrl, ts]` con
TTL 7 giorni (nome e avatar cambiano di rado) e la serve in una richiesta
sola; gli utenti mancanti li scarica il server, con un tetto di 300 per
richiesta. Misurato su 36 eletti: **191 KB in 343 ms** dal Worker contro
**5,4 KB in 79 ms** da qui.

Insieme a `/elections?countryIds=` e `/elections-detail?ids=` (stessa
ragione: una richiesta per l'intero blocco invece di una per nazione), il
parlamento di un blocco da 12 nazioni è passato da ~27 richieste HTTP a 5.

### Danno di oggi (`/daily-damage`)

WarEra pubblica il danno **settimanale** cumulato di ogni nazione, mai quello
giornaliero. Il giorno di gioco però cambia alle **02:00 italiane**, quindi
alle 02:01 `Europe/Rome` (fuso esplicito nel `cron.schedule`: il server può
stare ovunque) `snapshotDailyDamage` fotografa il settimanale di tutte le
nazioni dalla cache `countries` già aggiornata — zero chiamate a WarEra.

Nello stesso scatto (stesso istante, altrimenti "danno di oggi" di una
nazione e delle sue unità non sarebbero confrontabili) c'è anche il
settimanale di ogni **unità militare**, preso dalla cache `mu-directory`:
`byCountry` e `byMu`.

Il client sottrae voce per voce (`src/shared/dailyDamage.js`, usato da
pannello nazione, pannello alleanza/sfera, statistiche alleanze e scheda
unità): differenze negative — reset settimanale del contatore — contano
zero, e chi non ha voce nello scatto resta fuori invece di far entrare in
"oggi" tutto il suo cumulato.

Al primissimo avvio, se il file non esiste, se ne fa uno subito: vale meno
(parte dall'avvio, non dal cambio giorno) e infatti il client scrive
"Since HH:MM" invece di "Today" finché non passano le 02:00.

### Quando si ricontrolla un utente

Non un TTL fisso, ma il regolamento del gioco (`gameConfig.getGameConfig()
.user.resetSkillDaysCooldown = 7`, verificato dal vivo):

- chi ha resettato le skill **meno di 7 giorni fa** non può averle
  ricambiate: si salta, è una certezza, non una stima (~27% dei membri in
  regime stazionario);
- chi **può** aver cambiato (mai resettato, o cooldown scaduto) viene
  ricontrollato entro `REFRESH_WINDOW_MS` = **2 ore**, a fette di
  `pool / 4` per giro (pollMuDirectory gira ogni 30 min), i più in ritardo
  per primi. Due ore e non un giorno perché quello che conta non è il
  singolo utente — che può cambiare al massimo una volta a settimana — ma
  l'aggregato per nazione, cioè accorgersi mentre sta succedendo che venti
  persone hanno spostato le skill sulla guerra.

`MU_USER_LOOKUP_BUDGET` (20.000) è solo un tetto di sicurezza per il cold
start e le migrazioni di schema, non il regolatore normale. Misurato:
~286 ms per chunk da 100 verso il Worker, quindi anche risolvere l'intera
popolazione (16k membri, 162 chunk) sono ~46 s e ~210 richieste/min, sotto
il limite di 500/min — e `pollMuDirectory` gira a :12/:42, minuti in cui
nessun altro poll tocca il Worker.

### Storico: `/mu-playstyle-history?countryId=…&since=…`

Una nazione può avere battaglie ovunque e restare economica (l'Italia, con
guerre in corso, ha comunque la maggioranza dei cittadini sull'economia):
il "war mode" non si legge dalle guerre ma da dove la gente mette i punti
abilità. Da qui lo storico, che risponde a "quanti sono passati alla
guerra da ieri?".

Costa **zero chiamate**: `playstyleByCountry()` gira già ad ogni poll sulla
mappa in RAM, l'unica aggiunta è non buttare via il valore precedente. Si
scrive una riga solo quando i numeri di quella nazione **cambiano**
(delta encoding): salvare 48 fotografie identiche al giorno per 151 nazioni
gonfierebbe il file senza aggiungere informazione. Formato compatto per
nazione: `[ts, war, eco, mixed, undecided, known]`, ritenzione 30 giorni —
ma l'ultimo campione di ogni nazione si tiene **sempre**, altrimenti una
nazione ferma da più di un mese sparirebbe invece di risultare "ferma".

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
curl https://warera-oracle.duckdns.org/warera-cache/bootstrap-status
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
curl https://warera-oracle.duckdns.org/warera-cache/region-history/external-status
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
curl -s "https://warera-oracle.duckdns.org/warera-cache/ticker/summary?since=$(( ($(date +%s) - 172800) * 1000 ))&windows=$(( ($(date +%s) - 86400) * 1000 ))" | head -c 300
```


## Round 6 — archivio battaglie e spese di guerra (`battleArchive.js`)

**Da deployare**: `battleArchive.js` è un file NUOVO — va copiato anche lui,
non basta aggiornare `warera-cache-server.js`.

```bash
scp server/warera-cache-server.js server/battleArchive.js <utente>@<vps>:<percorso>/
ssh <utente>@<vps> "pm2 restart warera-cache"
```

Risponde a due domande che il gioco non risponde da nessuna parte: quanto è
costata una battaglia (taglia pagata + contratti mercenari) e quanto spende
una nazione al giorno per combattere. Endpoint nuovi:

- `GET /battle-archive` — battaglie concluse degli ultimi 90 giorni, righe
  compatte (chiavi corte: il file viaggia intero verso il browser).
- `GET /war-expenses` — serie giornaliera `byDay[YYYY-MM-DD][countryId]`.
  Derivata al momento della richiesta dai due archivi: costa niente e resta
  sempre coerente con l'ultimo giro di poll.
- `GET /battle-archive/status` — stato dei due bootstrap (anche in `/health`).

### Il bootstrap gira SOLO di notte

Il primo riempimento è l'unico lavoro pesante: ~72 pagine di battaglie (ognuna
con 100 chiamate di classifica) e ~700 pagine di aste mercenarie. Gira quindi
**solo fra le 02:00 e le 06:59 italiane**, quando il gioco è vuoto, per non
contendere il rate limit ai giocatori veri. In quelle cinque ore copre tutti e
novanta i giorni, quindi **una notte sola basta**. Il cursore è su disco: un
`pm2 restart` riprende da dov'era, non ricomincia.

Il giro **incrementale** invece è attivo tutto il giorno (una o due richieste
ogni 20 minuti) e aggancia solo le battaglie e i contratti nuovi.

```bash
# quanto è avanti il bootstrap
curl -s https://warera-oracle.duckdns.org/warera-cache/battle-archive/status | head -c 600
```

### ⚠️ La trappola da non rifare

`country.getAllCountries` porta già `rankings.countryBounty`, che sembra la
risposta pronta a "quanto ha speso di taglie questa nazione", a costo zero.
**Non lo è**: misurato su tutte e 180 le nazioni, correla 0,87 col danno
totale e 0,11 con la ricchezza — è quanto i *cittadini* hanno incassato
combattendo, non quanto il governo ha pagato. La spesa vera si ricava solo
battaglia per battaglia, che è quello che fa questo modulo. Il commento in
testa a `battleArchive.js` lo ripete per chi ci passasse fra sei mesi.

## Round 7 — contatore visite (`/visits`)

Endpoint nuovo, tutto dentro `warera-cache-server.js` (nessun file in più da
copiare). Serve alla pill in fondo alla mappa (`src/app/visitorCounter.js`).

Il client manda un identificativo casuale che si è generato da solo e tiene in
localStorage; il server lo ricorda per la giornata corrente. Stesso browser
che ricarica dieci volte = una visita; domani ne conta un'altra. **Nessun IP
viene letto o salvato** — il che, oltre a essere la cosa giusta, evita anche il
problema pratico che dietro nginx `req.ip` sarebbe 127.0.0.1 per tutti.

Il totale mostrato è `VISITS_SEED + quello contato qui`. `VISITS_SEED = 1325`
sono i visitatori misurati da Vercel Analytics dalla messa online fino al
2026-08-31, giorno in cui il contatore proprio ha cominciato a girare: è la
stessa unità di misura (visite giornaliere uniche), quindi i due numeri si
sommano senza mescolare grandezze diverse. **Il seme vive qui, non nel
client**: correggerlo è un `pm2 restart`, non un deploy su Vercel.

```bash
curl -s "https://warera-oracle.duckdns.org/warera-cache/visits?id=prova"
# {"total":1326,"today":1,"seed":1325,"countedHere":1}
# `&count=0` legge senza incrementare
```

Su disco: `cache/visits.json`, che tiene il totale proprio e gli id degli
ultimi 3 giorni (servono solo a deduplicare dentro la giornata, poi si
buttano). **Non cancellarlo a un deploy**, o il conteggio proprio riparte da
zero e resta solo il seme. Vale la regola generale: la cartella `cache/` non
si tocca.

Finché non rideployi, `/visits` risponde 404 e la pill semplicemente non
compare — mai uno zero né un segnaposto, come per tutto il resto che passa dal
VPS.

### Chi c'è adesso (`online` nella risposta di `/visits`)

Stesso endpoint, campo in più. Il client ripassa una volta al minuto con
`count=0` (dice "ci sono ancora" senza gonfiare il totale) e il server conta
gli id distinti visti negli ultimi 5 minuti.

La mappa delle presenze sta **in memoria, non su disco**: vale cinque minuti, e
scriverla a ogni battito sarebbe un `writeFileSync` ogni pochi secondi per un
numero che dopo un riavvio si ricostruisce da sé nel giro di un minuto. Quindi
subito dopo un `pm2 restart` il pallino dice 1 o 2 e risale da solo — non è un
guasto.

La finestra (5 min) è volutamente più larga del battito (1 min): una scheda che
tarda un giro non deve sparire e riapparire facendo ballare il numero. Il ritmo
viaggia nella risposta (`heartbeatMs`), non in una costante nel client:
cambiarlo è un `pm2 restart`, non un deploy su Vercel.

```bash
curl -s "https://warera-oracle.duckdns.org/warera-cache/visits?id=tizio&count=0"
# {"total":1331,"today":6,"online":8,"heartbeatMs":60000,"seed":1325,"countedHere":6}
```
