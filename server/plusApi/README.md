# warera-plus-api — area riservata

Processo **separato** dal cache-server, e ne girano **due istanze**: una per
il deploy live e una per il dev, con database distinti. Il perché sta in
testa a `index.js`; qui c'è solo come si mette in piedi e come si aggiorna.

| | live | dev |
|---|---|---|
| porta (solo `127.0.0.1`) | 3002 | 3003 |
| cartella dati | `data/` | `data-dev/` |
| percorso pubblico | `/warera-plus-api/` | `/warera-plus-api-dev/` |
| applicazione Discord | `WarEra+` | `WarEra+ dev` |
| origin ammesso | `wareraplus.vercel.app` | `wareraplus-dev.vercel.app`, `localhost:5173` |

⚠️ Come il cache-server, **non si deploya da Vercel**: il push su `dev` o
`main` pubblica solo il client. Questo va copiato a mano sul VPS.

## Primo impianto (una volta sola)

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 \
  "mkdir -p ~/warera-plus-api/data ~/warera-plus-api/data-dev \
   && cd ~/warera-plus-api && npm init -y && npm i express cors"
```

Poi `~/warera-plus-api/ecosystem.config.js` **sul VPS**, mai nel repo — è
l'unico file che contiene segreti:

```js
module.exports = { apps: [
  { name: 'warera-plus-api', script: 'index.js',
    node_args: '--disable-warning=ExperimentalWarning',
    env: { WP_ENV: 'live', PORT: 3002, DATA_DIR: './data',
           DISCORD_CLIENT_SECRET: '…', SESSION_SECRET: '…',
           PUBLIC_BASE: 'https://warera-oracle.duckdns.org/warera-plus-api',
           ALLOWED_ORIGINS: 'https://wareraplus.vercel.app' } },
  { name: 'warera-plus-api-dev', script: 'index.js',
    node_args: '--disable-warning=ExperimentalWarning',
    env: { WP_ENV: 'dev', PORT: 3003, DATA_DIR: './data-dev',
           DISCORD_CLIENT_SECRET: '…', SESSION_SECRET: '…',
           PUBLIC_BASE: 'https://warera-oracle.duckdns.org/warera-plus-api-dev',
           ALLOWED_ORIGINS: 'https://wareraplus-dev.vercel.app,http://localhost:5173' } },
]};
```

`chmod 600 ecosystem.config.js`, poi `pm2 start ecosystem.config.js` e
**`pm2 save`** — senza quest'ultimo i due processi non tornano su dopo un
riavvio della macchina.

I due `SESSION_SECRET` vanno **diversi** fra loro (`openssl rand -hex 32`):
firmano lo state OAuth e proteggono le sessioni, e non c'è ragione perché una
compromessa valga anche per l'altra.

Gli **Application ID** di Discord non stanno qui: sono pubblici e vivono in
`auth.js`. Solo i due *secret* passano dall'ambiente.

## nginx

Due `location` dentro il server block di `/etc/nginx/sites-available/warera-cache`,
accanto a quella del cache-server (le direttive sono ripetute per esteso in
entrambe: due blocchi corti si leggono meglio di un file incluso in piu'):

```nginx
location /warera-plus-api/ {
    proxy_pass http://127.0.0.1:3002/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;      # per gli avvisi in tempo reale (SSE)
    proxy_read_timeout 3600s; # idem
}
```

piu' la gemella `/warera-plus-api-dev/` verso la 3003. Prima di ricaricare,
sempre `sudo nginx -t`: una config rotta porterebbe giu' anche il
cache-server, che sta nello stesso file.

La barra finale in `proxy_pass http://127.0.0.1:3002/` **non è decorativa**:
è ciò che toglie il prefisso, così Express vede `/health` e non
`/warera-plus-api/health`.

## Migrazioni del database

Girano da sole all'avvio (`db.js: migrate()`), sono ripetibili e non
chiedono niente: dopo lo scp basta il `pm2 restart`. Valgono per **tutti e
due** i database — `data/` del live e `data-dev/` del dev — perché ognuno
le esegue quando il suo processo riparte.

Fatte finora:

- `account.is_admin`
- `request.apert_min_damage`, `request.apert_budget`
- `request_allow.nome` — il nome di chi si ammette o si esclude, com'era
  al momento dell'aggiunta. Il server non sa come si chiama un'unità
  militare, quindi senza questa colonna una voce riletta il giorno dopo
  era ventiquattro caratteri esadecimali.
- `wealth_snapshot` — la ricchezza giornaliera dei membri delle unità
  italiane. Tabella NUOVA, quindi nasce dalla `CREATE TABLE IF NOT EXISTS`
  dello schema e non da `migrate()`: un database che esiste già se la
  ritrova al primo riavvio, vuota.

## Il bilancio delle unita' (`wealth.js`)

Uno scatto al giorno della ricchezza di ogni membro delle unita' italiane —
registrate in Italia o italiane *de facto* — alle **02:00 italiane**. La
differenza fra due scatti e' quello che quel giocatore ha guadagnato o
speso nel giorno in mezzo, ed e' l'unico modo di saperlo: il gioco espone
la ricchezza di adesso e nient'altro.

Il **primo giorno** si scatta anche in mezzo, ogni 4 ore, cosi' un
raffronto c'e' gia' la sera stessa invece che il giorno dopo: quegli
scatti hanno un'etichetta con l'ora (`2026-09-04T20`) accanto a quella
del giorno (`2026-09-04`), e ogni colonna dichiara quante ore copre. Il
rodaggio finisce da se' appena in archivio ci sono due giorni, e da li'
la serie mostrata usa solo gli scatti giornalieri.

⚠️ **Lo storico non si recupera a ritroso, si accumula.** I sette giorni
pieni arrivano dopo una settimana, e un giorno saltato e' perso per
sempre. Stesso vincolo dei
bonifici fra tesori (`server/moneyTransfers.js`), e come la' va detto
nell'interfaccia invece di far sembrare un buco di copertura un "non ha
speso niente". Cancellare `wealth_snapshot` butta via dati che non
tornano piu'.

Non serve nessuna variabile d'ambiente nuova: le unita' italiane si
leggono dal cache-server sulla loopback (`http://127.0.0.1:3001`,
sovrascrivibile con `CACHE_BASE`) e la nazione si cerca per codice
(`WEALTH_COUNTRY_CODE`, `IT` di suo). Quindi per questa modifica il
`pm2 restart` normale basta — non c'e' `ecosystem.config.js` da rileggere.

Costo: una richiesta al cache-server, una ventina di `mu.getById` e i
membri risolti a blocchi di 30 con `user.getUserLite`. Tutte procedure
pubbliche: nessuna chiave, nessun consumo del Worker.

Lo scatto parte da se' al primo avvio con l'archivio vuoto, a qualunque
ora — quel primo intervallo copre meno di 24 ore e la vista lo dichiara.
`/health` riporta `ricchezza` con giorni in archivio, primo e ultimo, e
l'esito dell'ultimo scatto. Un amministratore puo' forzarne uno con
`POST /wealth/scatta`.

## Aggiornare

```bash
scp -i ../serverOracle/ssh-key-2026-08-18.key server/plusApi/*.js server/plusApi/package.json \
  ubuntu@79.72.45.17:/home/ubuntu/warera-plus-api/
```

⚠️ `*.js` e non `*` — `ecosystem.config.js` sta solo sul VPS e non va
sovrascritto, e le cartelle `data/` e `data-dev/` non si toccano mai.

Poi il preflight, e solo se stampa `PREFLIGHT-OK`:

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 \
  "cd warera-plus-api && node --check index.js && node --check auth.js && node --check db.js && node --check wealth.js && echo PREFLIGHT-OK"
```

```bash
ssh -i ../serverOracle/ssh-key-2026-08-18.key ubuntu@79.72.45.17 \
  "pm2 restart warera-plus-api warera-plus-api-dev && pm2 logs warera-plus-api-dev --lines 20 --nostream"
```

⚠️ **Se hai cambiato `ecosystem.config.js` — cioè i segreti o gli origin —
quel comando NON basta.** `pm2 restart <nome>` rilegge il codice ma tiene
l'ambiente con cui il processo era stato avviato, e `--update-env` prende
quello della *shell*, non del file. Il sintomo è preciso e ingannevole: hai
appena messo il secret vero, `/health` continua a dire `SEGNAPOSTO`, e sembra
che la modifica non sia stata salvata. Per rileggere il file serve passarlo:

```bash
cd ~/warera-plus-api && pm2 restart ecosystem.config.js --update-env && pm2 save
```

## Verifica

```bash
curl -s https://warera-oracle.duckdns.org/warera-plus-api-dev/health
```

Dichiara cosa manca senza stampare mai un valore: `discord.clientSecret`
(`caricato` / `SEGNAPOSTO` / `MANCANTE`), `sessionSecret` (`caricato` / `EFFIMERO`, cioè le
sessioni cadono ad ogni restart), `allowedOrigins` e i conteggi del database.
Dopo un redeploy che perde una env var il sintomo sarebbe altrimenti "il
login non funziona", e si perde un'ora a cercarlo nel posto sbagliato.

## Se qualcosa non va

**`Invalid OAuth2 redirect_uri`** — `PUBLIC_BASE` non combacia col redirect
registrato su Discord. Deve essere identico carattere per carattere:
`/health` stampa quello che il server sta usando.

**Il login torna con `wp_auth_error=origin_non_ammessa`** — l'URL da cui è
partita la richiesta non è in `ALLOWED_ORIGINS`. Succede quando cambia il
dominio del deploy.

**Deslogga di continuo** — `SESSION_SECRET` non è nell'ambiente e ne viene
generato uno nuovo ad ogni avvio. `/health` lo dice: `EFFIMERO`.
