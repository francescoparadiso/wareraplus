# Bot Discord dei contratti — lo sportello

Gira sul **secondo VPS** e non ha un database: parla con `warera-plus-api`
(`server/plusApi/bot.js`, sul VPS 1), che resta l'unico posto in cui si decide
chi può cosa. Le ragioni di progetto stanno nelle testate di `contratti.js`
(il bot) e `plusApi/bot.js` (il server): qui c'è solo come si mette in piedi.

## Cosa fa

Un solo comando, **`/contract-desk post`**, pubblica lo **sportello**: un
messaggio fisso nel canale con le richieste (raggruppate per battaglia, con il
link) e i bottoni. Tutto il resto si fa da lì.

| bottone | chi | cosa |
|---|---|---|
| 📝 **Request a contract** | tutti i comandanti collegati | sceglie battaglia e lato da un menu, poi compila un modulo (danno, taglia ogni 1.000, solo professionisti, nota) |
| **Edit mine** | chi ha chiesto | corregge una richiesta **ancora in attesa** (dopo l'approvazione i numeri non cambiano: si ritira e si rifà) |
| **Withdraw mine** | chi ha chiesto | ritira una propria richiesta |
| **Refresh** · 📋 **Show all (N more)** | tutti | riscrive lo sportello · elenca tutto quello che non entra |
| 🗳️ **Pending (n)** | governo | sceglie una richiesta in attesa e la decide (Approve / Reject) |
| **Open / Close desk** | governo | chiude lo sportello: niente nuove richieste, né da Discord né **dal sito** |
| 📣 **Who's tagged** | tutti | chi viene taggato e chi non lo è perché non ha collegato Discord |

In più, ogni richiesta nuova arriva come **carta** con Approve / Reject (poi
*I opened the auction* / *Withdraw*), **taggando** chi nel governo può approvare
(`manageMercenaryContracts`, presidente, vice, deroghe, meno le revoche). Lo
sportello è il quadro d'insieme, la carta è quella che suona sul telefono. Se un
altro vince l'asta ("rubato") il governo viene taggato di nuovo. L'unità riceve
gli avvisi nel suo canale (`/contract-desk post scope:My military unit`).

Sportello e carte si **riscrivono da sole** quando qualcosa cambia, anche se si
decide dal sito.

Si taggano **solo** le persone che hanno collegato Discord e personaggio al
tool: gli altri non hanno un id Discord che il server conosca. Il bot li elenca
per nome, senza tag.

Se il bot non chiede nulla per 90 secondi, gli avvisi tornano ai **webhook** (se
ce n'è uno). Quando un ambito ha un canale del bot, il webhook di quell'ambito
tace, altrimenti ogni avviso comparirebbe due volte.

## Controllare la coda: `/contract-queue`

Due viste, in risposta visibile solo a chi la chiede (opzione `public` per
postarla nel canale):

- **`/contract-queue unit`** — per i comandanti: le richieste della propria
  unità, con la **posizione in coda** presso ogni nazione ("2 of 4 waiting"), da
  quanto sono in attesa e il **tempo tipico di decisione** di quel governo
  (mediana degli ultimi 7 giorni, solo da 3 decisioni in su).
- **`/contract-queue nation`** — per chi può approvare: tutta la coda della
  nazione dalla più vecchia (in attesa → approvate ma asta non aperta → asta
  aperta → chiuse nelle ultime 24 h), con 🔥 su chi aspetta da più di 30 minuti.
  Agli altri risponde che serve un ruolo di governo.

Sotto la coda ci sono i bottoni: **Request a contract** per tutti (ai comandanti
anche *Edit mine* / *Withdraw mine*) e **Refresh**; nella coda della nazione un
menu per **decidere** una richiesta (in attesa → Approve / Reject; approvata →
*I opened the auction*), che apre la sua carta in un messaggio a parte.

## Burst e lista

- **Burst damage**: un campo facoltativo del modulo di richiesta (e di *Edit
  mine*) per dichiarare quanto danno l'unità può fare **subito**, all'apertura
  dell'asta. Compare sulla carta ("Burst now"), nelle righe di sportello e coda
  ("1M dmg (burst 500k)") e negli avvisi. Svuotando il campo in modifica lo si
  toglie. Colonna `request.burst_damage` (migrazione automatica).
- **La lista sotto ogni richiesta nuova**: la carta con i tag porta con sé un
  secondo riquadro, "Queue right now — N waiting", con tutta la coda della
  nazione in ordine di arrivo e la richiesta della carta segnata "← this one".
  Finché la richiesta è in attesa il riquadro si aggiorna con la carta; una volta
  decisa resta la sola carta.

## Risposta automatica a "10m pro"

Se qualcuno scrive a mano "10m pro" (o "5 m pros", "pro 10m"…) nel canale di uno
sportello, il bot risponde rimandandolo allo sportello (con il link al
messaggio); se non ha collegato l'account, gli dice prima di accedere a
`wareraplus.vercel.app` con Discord e collegare il personaggio. Una volta ogni 10
minuti per persona e canale, solo nei canali con uno sportello, mai ai bot. Serve
il suffisso (`k`/`m`/`mil`/`b`): "10 pro" da solo non basta.

⚠️ Richiede l'intent **privilegiato** *Message Content*, da abilitare a mano:
Developer Portal → l'applicazione → **Bot** → *Privileged Gateway Intents* →
**Message Content Intent** → Save, poi `sudo systemctl restart contratti-bot`.
Finché non è abilitato il bot **non cade**: `index.js` rifiuta il login con
l'intent, riprova senza e lo scrive nel log (`journalctl -u contratti-bot`:
"parto senza" / "connesso (senza lettura dei messaggi)"). Sotto i 100 server non
serve nessuna verifica.

## 1. Discord Developer Portal

L'applicazione è la stessa del login, **"WarEra+"**
(`1544716064087347242`, già in `plusApi/auth.js`): il bot è un *bot user*
aggiunto ad essa, il login OAuth non cambia.

1. Developer Portal → l'applicazione → **Bot** → *Reset Token* → copiarlo (si
   vede una volta sola). **Il token Discord non va in chat né nel repo**: va
   solo nel file `/etc/contratti-bot.env` del VPS 2 (punto 3).
2. Nessun intent privilegiato (bastano quelli di base).
3. **OAuth2 → URL Generator**: scope `bot` + `applications.commands`, permessi
   *View Channel, Send Messages, Embed Links* → invito nel
   server.

⚠️ Per il **dev** serve l'altra applicazione ("WarEra+ dev"), con il suo token:
il bot del live e quello del dev sono due applicazioni diverse.

## 2. Sul VPS 1 — attivare le rotte `/bot`

Un segreto casuale in `ecosystem.config.js` **sul VPS** (mai nel repo), uno per
istanza di plusApi (live e dev):

```bash
openssl rand -hex 32     # due volte: uno per live, uno per dev
```

```js
// dentro env: { … } di 'warera-plus-api' e di 'warera-plus-api-dev'
BOT_TOKEN: '<il segreto>',
```

Poi codice nuovo e rilettura dell'ambiente (vedi `plusApi/README.md`, "Aggiornare":
con un `ecosystem.config.js` cambiato serve
`pm2 restart ecosystem.config.js --update-env && pm2 save`).
`/health` deve dire `bot.token: "caricato"`; `bot.vivo` diventa `true` appena il
bot parte.

## 3. Sul VPS 2

È l'istanza `a1-creator` (Ubuntu, **10.0.0.10**, 954 MB di RAM, Node 24,
**niente pm2**: lì i servizi sono unit systemd, come `buzzelle` e
`oci-a1-creator`). Non ha un IP pubblico raggiungibile da qui: si passa dal VPS 1
con la stessa chiave. Nessun bot Discord c'è già su quella macchina, quindi
questo è un servizio nuovo.

```bash
KEY=../Server/ssh-key-2026-08-18.key
PROXY="ssh -i $KEY -W %h:%p ubuntu@79.72.45.17"

# dal PC: copia il codice
scp -i $KEY -o "ProxyCommand=$PROXY" -r server/discordBot ubuntu@10.0.0.10:/tmp/contratti-bot

# entra
ssh -i $KEY -o "ProxyCommand=$PROXY" ubuntu@10.0.0.10
```

Poi, sul VPS 2:

```bash
sudo useradd --system --home-dir /opt/contratti-bot --shell /usr/sbin/nologin contratti
sudo mkdir -p /opt/contratti-bot && sudo cp -r /tmp/contratti-bot/. /opt/contratti-bot/
cd /opt/contratti-bot && sudo npm install --omit=dev
sudo chown -R contratti: /opt/contratti-bot

# i segreti, a mano (mai nel repo, mai in chat)
sudo install -m 600 /dev/null /etc/contratti-bot.env
sudo nano /etc/contratti-bot.env
```

`/etc/contratti-bot.env`:

```
DISCORD_TOKEN=<token del bot dal punto 1>
PLUS_API_BASE=https://warera-oracle.duckdns.org/warera-plus-api-dev
PLUS_BOT_TOKEN=<il BOT_TOKEN dell'istanza scelta, punto 2>
GUILD_ID=<id del server Discord di prova>
```

```bash
sudo cp /opt/contratti-bot/contratti-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now contratti-bot
journalctl -u contratti-bot -n 30 --no-pager      # deve dire "[contratti] in ascolto"
```

Il servizio ha `MemoryMax=200M`: sulla macchina c'è anche `buzzelle`
(`MemoryMax=850M`), e 954 MB sono pochi.

**Provare prima sul dev**: `PLUS_API_BASE` con `/warera-plus-api-dev`, `GUILD_ID`
di un server di prova (i comandi compaiono subito; senza `GUILD_ID` sono globali
e ci mettono fino a un'ora). Per il live: `/warera-plus-api`, il `BOT_TOKEN` del
live, senza `GUILD_ID`, poi `sudo systemctl restart contratti-bot`.

Aggiornare il codice: `scp` come sopra, `sudo cp -r /tmp/contratti-bot/. /opt/contratti-bot/`,
`sudo systemctl restart contratti-bot`. Lo stato (`contratti-state.json`: cursore
degli avvisi, messaggi di carte e sportelli) sta in `/opt/contratti-bot` e **non
si cancella** né si sovrascrive col `cp` (il file non è nel repo).

## 4. Provare

1. Chi governa la nazione lancia `/contract-desk post scope:My nation` nel canale
   dei contratti: compare lo sportello.
2. Un comandante preme **Request a contract**, sceglie battaglia/lato, compila il
   modulo: arriva la carta, con i ministri collegati taggati.
3. Un ministro preme **Approve** → il comandante riceve l'avviso nel canale
   dell'unità (`/contract-desk post scope:My military unit`).
4. **I opened the auction** → parte il controllo del watcher; se un'altra unità
   vince, il governo viene taggato.

## Convivere con un altro bot nello stesso processo

Due processi con lo stesso token Discord ricevono **entrambi** ogni interazione
e si litigano la risposta. Se un giorno lo sportello deve stare dentro un altro
bot della stessa applicazione, `contratti.js` si aggancia al suo `Client`:

```js
const { attach } = require('./contratti');
attach(client, { apiBase: process.env.PLUS_API_BASE, botToken: process.env.PLUS_BOT_TOKEN });
```

⚠️ Se quel bot chiama `commands.set([...])` ad ogni avvio, cancella
`/contract-desk`: `attach` registra con `commands.create` (uno alla volta) per
questo.

## Limiti noti

- L'unità da cui si chiede è quella in cui il comandante sta **in gioco**; per
  le deroghe su un'altra unità si usa il sito.
- Il primo avvio parte dall'ultimo evento, non dalla coda: gli avvisi di prima
  restano ai webhook.
- Le carte si ricordano 14 giorni; una carta più vecchia non si riscrive più, ma
  i bottoni funzionano. Gli sportelli si ricordano finché non si rimuovono.
- Il menu di "Request a contract" mostra al massimo 25 coppie battaglia/lato
  (le più calde per danno): è il tetto di Discord per un menu.
