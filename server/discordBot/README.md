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
| 🏛️ **Government** (· n waiting) | tutti lo vedono, **lo usa il governo** | apre un pannello **privato** con SOLO i comandi che chi preme può usare: 🗳️ *Pending* e ⚡ *Ask burst* (chi approva), 🔒 *Open / Close desk* e 📏 *Limits* (chi gestisce la nazione), 📣 *Who's tagged* (tutti). Chiudere lo sportello vieta nuove richieste, da Discord e **dal sito**; **aprire** passa dal modulo dei tetti (vedi sotto). A chi non è del governo il bot risponde con una frase |

⚠️ Un messaggio di Discord è **identico per tutti**: non si possono mostrare certi bottoni solo a certe persone. Per questo sullo sportello ce n'è uno solo, e i comandi veri stanno nel pannello privato (`GET /bot/permessi`, `wp:gv:<azione>:<board>`). Le **carte** delle richieste (Approve / Reject) stanno nel canale del governo e restano visibili a chi ci scrive: chi non può approvare riceve un rifiuto se preme.

In più, ogni richiesta nuova arriva come **carta** con Approve / Reject (poi
*I opened the auction* / *Withdraw*), **taggando** chi nel governo può approvare
(`manageMercenaryContracts`, presidente, vice, deroghe, meno le revoche). Lo
sportello è il quadro d'insieme, la carta è quella che suona sul telefono. Se un
altro vince l'asta ("rubato") il governo viene taggato di nuovo. L'unità riceve
gli avvisi nel suo canale (`/contract-desk post scope:My military unit`).

## Una board per battaglia (istanze separate)

Una nazione non ha uno sportello solo: ha **una board per battaglia**, ognuna un'istanza a sé
con il **suo canale, la sua coda, i suoi tetti e il suo Open/Close**.

- `/contract-desk post scope:My nation battle:<cerca>` apre la board di UNA battaglia in
  corso della tua nazione (autocompletamento; ✅ = ce l'ha già). Senza `battle` è la
  **board generale**, che prende le richieste delle battaglie senza una board propria
  (è lo sportello unico di prima: le board esistenti sono diventate generali, senza
  cambiare niente).
- **Una richiesta va alla board della sua battaglia**; se non c'è, alla generale; se la
  nazione ha board ma **nessuna per quella battaglia** (e non ha la generale) viene
  rifiutata con `nessuna_board_per_battaglia`. Una nazione senza board funziona come
  prima (webhook, sito).
- **La coda è per battaglia**: chi aspetta sulla battaglia X non è "dietro" a chi aspetta
  sulla Y (aste e decisioni diverse). Vale ovunque: sito, `/contract-queue`, menu delle
  decisioni, lista sotto le carte. Nella coda di tutta la nazione le battaglie sono blocchi
  separati.
- Ogni board ha i suoi **tetti** e il suo **aperto/chiuso**; chiuderne una non tocca le altre.
  "Request a contract" dalla board di una battaglia chiede per quella battaglia, senza
  scegliere; "Ask burst" elenca solo i suoi contratti.
- **Spostare una board in un altro canale**: rilancia `/contract-desk post` con la stessa
  battaglia (o senza, per la generale). Il vecchio messaggio si cancella e le **carte delle
  richieste vive di QUELLA board** (max 40, in ordine di coda) si ricreano nel canale nuovo;
  le altre board non si toccano. Aprire la board di una battaglia porta lì anche le carte
  che stavano nella generale.
- `/contract-desk remove battle:…` toglie la board di una battaglia (le sue richieste
  tornano alla generale, se c'è); senza `battle` toglie la generale.
- ⚠️ **Le unità hanno ancora un solo canale** (`bot_channel`), a parte: spostare la nazione
  non sposta l'unità, e il bot lo scrive nella risposta (`altri` di `POST /bot/canale`).
- Le board sono nella tabella `bot_board` (`country_id`, `battle_id` — '' = generale —,
  canale, aperto, tetti). Una board di una battaglia finita resta finché non la togli.

Sportello e carte si **riscrivono da sole** quando qualcosa cambia, anche se si
decide dal sito.

Si taggano **solo** le persone che hanno collegato Discord e personaggio al
tool: gli altri non hanno un id Discord che il server conosca. Il bot li elenca
per nome, senza tag.

Se il bot non chiede nulla per 90 secondi, gli avvisi tornano ai **webhook** (se
ce n'è uno). Quando un ambito ha un canale del bot, il webhook di quell'ambito
tace, altrimenti ogni avviso comparirebbe due volte.

## Tetti alle richieste: 📏 *Limits* (governo)

Chi apre lo sportello (bottone **Open desk**) o preme **Limits** vede un modulo con
due campi facoltativi, già compilati con i valori di adesso:

- **Max damage per request** (es. `20m`);
- **Max bounty per 1,000 damage** (es. `0.1`).

Vuoto = nessun tetto. I tetti compaiono nell'intestazione dello sportello
("📏 Limits per request") e valgono per **ogni nuova richiesta e per ogni modifica che
cambia danno o taglia**, da Discord (modulo e `/contract`) e dal **sito**: il server
risponde `422 oltre_il_tetto` con il campo e il tetto, e il bot dice quale numero è troppo
alto. Le richieste già in coda non si toccano (correggere la nota di una richiesta
vecchia non è bloccato da un tetto arrivato dopo), e **chiudere** lo sportello non
cancella i tetti. Si salvano **per board** in `bot_board.max_damage` / `max_rate`; `POST /bot/scrivania/stato` li imposta, `GET /bot/limiti` li legge
(leggera, solo database: un modulo va aperto entro 3 s dal clic).

## Chiedere il burst: ⚡ *Ask burst* (governo)

Bottone della riga del governo sullo sportello. Elenca i **contratti ancora in
corso** della nazione (menu a scelta multipla, con la voce **«All active
contracts»** in cima) e per ogni contratto scelto manda un **messaggio privato**
ai comandanti dell'unità (chi ha fatto la richiesta, il proprietario e i
comandanti, se collegati con `/register`): "fate il **burst adesso** su
*[battaglia](link)* e **chiudete il contratto**", con il burst dichiarato in
richiesta se c'è. Niente nel canale: la richiesta è per loro, non per la chat.
Chi ha più contratti riceve UN messaggio con l'elenco.

- **Riscontro a chi chiede**: sempre, nel messaggio effimero, contratto per
  contratto: a chi è arrivato il DM, chi **non** è raggiungibile (DM chiusi o nessun
  server in comune col bot: lo si pinga a mano) e i contratti **non partiti** col
  motivo (già chiesto da poco, non più attivo, nessun comandante collegato).

- **Attivo e non finito**: l'asta è stata vinta dall'unità concordata (`conforme`,
  o `parametri_diversi`), la battaglia è ancora in corso e il **round dell'asta è
  ancora il round corrente** della battaglia (un contratto vale per un round). Il
  gioco non dice pubblicamente quanto danno ha fatto l'unità
  (`mercenaryContract.*` chiede il login), quindi "finito" è "il round è cambiato o la
  battaglia è finita". Lo decide il server (`plusApi/bot.js: contrattiAttivi`) anche
  al momento del clic.
- **Solo governo** (chi approva o gestisce la nazione), mai più di una volta ogni
  **10 minuti** per lo stesso contratto; chi chiede non si pinga da solo.
- Le aste vinte di una battaglia si leggono **tutte**: `getPaginatedAuctions` è a
  cursore (50 per pagina, dalla più recente) e `asteVinte` in `plusApi/bot.js`
  segue `nextCursor` fino a 30 pagine.

## Chiedere un contratto in una riga: `/contract`

La stessa richiesta del bottone *Request a contract*, per chi sa già cosa vuole:

`/contract battle:<cerca mentre scrivi> damage:10m rate:0.05 [side] [burst:5m] [pro] [note]`

- **battle**: si cerca scrivendo (autocompletamento, le battaglie su cui la propria
  unità può chiedere, le più calde per prime). **side** si può omettere se ne è
  possibile uno solo; se ne sono possibili due il bot lo chiede.
- **damage** e **burst** sono testo come nel modulo: `10m`, `500k`, `1,000,000`.
- Stesse regole di sempre: stesso server, stessi permessi, sportello chiuso → rifiuta.

## Controllare la coda: `/contract-queue`

Due viste, in risposta visibile solo a chi la chiede (opzione `public` per
postarla nel canale):

- **`/contract-queue unit`** — per i comandanti: le richieste della propria
  unità, con la **posizione in coda** presso ogni nazione ("2 of 4 waiting"), da
  quanto sono in attesa e il **tempo tipico di decisione** di quel governo
  (mediana degli ultimi 7 giorni, solo da 3 decisioni in su).
- **`/contract-queue nation`** — per chi può approvare: tutta la coda della
  nazione dalla più vecchia (in attesa → approvate ma asta non aperta → asta
  aperta), con 🔥 su chi aspetta da più di 30 minuti. Mostra solo ciò che è
  ancora aperto: le richieste chiuse (vinte, rubate, senza offerte, ritirate) non
  compaiono né qui né nella lista sotto una richiesta nuova; l'esito resta sulla
  carta e nello sportello. Agli altri risponde che serve un ruolo di governo.

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
  Ad ogni cambiamento di quella nazione (richiesta nuova, modifica, decisione,
  asta, esito) il riquadro si **riscrive su tutte le carte ancora in attesa**, ognuna
  con la propria richiesta segnata e lo stesso conteggio: una carta di venti minuti
  fa non resta ferma a "5 waiting". Una volta decisa, la carta resta la sola carta.

## Tenere lo sportello in vista

Nei canali con uno sportello il bot fa due cose perché non si perda sotto la chat:

- **Lo pinna** (una volta, con successo) se il ruolo del bot ha *Pin Messages* o
  *Manage Messages*; senza il permesso lo scrive nel log e va avanti.
- **Manda un promemoria** (istruzioni + link allo sportello) se lo sportello **non è
  fra gli ultimi 10 messaggi** del canale **e** qualcuno ha scritto negli
  **ultimi 3 minuti**. Il promemoria conta come "sportello in vista": il
  prossimo arriva solo dopo altri 10 messaggi, e mai prima di 5 minuti. Se nel
  canale ci sono due sportelli (nazione e unità) basta che uno sia in vista; il
  link va a quello della nazione. L'emoji `:Behehehehe:` del server viene
  inserita se esiste, altrimenti si omette.
- Il promemoria porta anche la **coda di adesso** ("Current queue — N waiting",
  solo posizioni, dalla più vecchia), così chi legge vede subito quanto c'è davanti.
  La coda si **riscrive** ad ogni cambiamento della nazione (come le liste sotto le
  carte), sull'ultimo promemoria del canale; testo e bottoni restano. Se i dati
  non arrivano, il promemoria parte senza coda. Solo nei canali con lo sportello
  della nazione.
- Il promemoria ha i **bottoni** sotto: 🔗 *Link my character* (apre il modulo di
  `/register`), 📝 *Request a contract*, *Edit mine*, *Withdraw mine* e 📋 *My
  queue* (la coda della propria unità), così non serve andare allo sportello
  pinnato per chiedere un contratto. Sono gli stessi id e gli stessi gestori dello
  sportello.

Il controllo parte 20 secondi dopo l'ultimo messaggio (una raffica di messaggi è
un solo controllo) e legge gli ultimi 10 messaggi (serve *Read Message History*).
Parametri in `attach(..., { ricordo: { debounceMs, ultimiN, attivitaMs, ognigMs } })`.

## Registrarsi dal bot: `/register`

Collega il personaggio di gioco **senza passare dal sito**. Il modulo chiede il
nome di gioco → si sceglie fra gli omonimi (con la nazione) → il bot dà un codice
`WP-XXXXXX` da mettere nel nome di una propria azienda → *Verify*. È la **stessa
verifica del sito** (`plusApi/verify.js`: le tre azioni cerca / inizia / controlla
sono funzioni usate da entrambi): cambia solo come si prova chi sei su Discord.
Sul sito con OAuth, dal bot con l'id che Discord firma in ogni interazione, che
non è una prova più debole. Il personaggio si prova ugualmente col codice
nell'azienda, quindi nessuno può collegarsi al personaggio di un altro.

- L'account nasce quando si chiede il codice (non alla ricerca) ed è lo stesso
  che il sito trova al primo login (stesso `discord_id`).
- Il codice dura 30 minuti, si controlla al massimo ogni 8 secondi; un
  personaggio può essere collegato a un solo account Discord.
- Chi non ha aziende non può verificarsi: lo dice, e serve un admin
  (`/verify/admin-link`), come sul sito.
- Gli errori "non collegato" di tutti i comandi, e la risposta a "10m pro",
  ora mandano a `/register` invece che al sito.

## Messaggi privati al comandante

Quando un contratto viene **approvato** e quando viene **postato** (il governo
preme *I opened the auction*), il bot manda un **messaggio privato** a chi ha
fatto la richiesta e al proprietario e ai comandanti dell'unità (letti dal gioco),
se hanno collegato Discord al tool — con battaglia, link, cifre (burst compreso)
e chi ha agito. Non si avvisa chi ha appena compiuto l'azione. Arriva anche se
l'unità non ha un canale configurato; l'avviso nel canale dell'unità resta.
`server/plusApi/dm.js` scrive l'evento (`scope_type = 'dm'`), il bot lo consegna.
Eventi più vecchi di 2 ore si scartano; con i messaggi privati chiusi Discord
rifiuta (50007) e il bot lo lascia cadere in silenzio.

Nei menu di scelta (*Pending*, sotto la coda, *Edit/Withdraw mine*) ogni voce
mostra anche il **burst** e la **nota** della richiesta, accorciata con "…" se non
entra nei 100 caratteri che Discord concede.

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
