# CLAUDE.md — WarEra+

Guida di contesto per Claude Code su questo repository. Per la storia completa
delle decisioni architetturali e la roadmap dettagliata, vedi `README.md`
(più esteso di questo file — leggilo se serve capire il "perché", non
solo il "cosa").

## Cos'è questo progetto

WarEra+ è nato per unire due tool esistenti del gioco WarEra in un'unica app,
ed è poi cresciuto ben oltre quei due:

- **Diplomacy View** (esistente) — mappa strategica interattiva (MapLibre GL):
  alleanze, guerre, NAP, sfere d'influenza, battaglie live, statistiche.
  Portata qui **quasi 1:1**, era già scritta a moduli ES con Vite. È la vista
  principale dell'app; sopra a quella base sono state innestate parecchie
  aggiunte WarEra+ (vedi "Modifiche al codice Diplomacy" più sotto).
- **Political View** (esistente) — elezioni presidenziali/congresso, partiti,
  senato. **Convertita a moduli ES in `src/political/` (Fase 2, completata)**:
  gira in-page dentro `#wp-political-root`, montata via `import()` dinamico
  alla prima apertura (code-split). L'originale a script globali resta in
  `public/political/` come riferimento/rollback fisico, **non più raggiunto da
  alcun path attivo** dell'app (niente più iframe).
- **WarEra Eco Optimizer di ArgusIA** (esistente, di terzi) — bot Discord
  portato a moduli ES in `src/eco/` come "Ottimizzatore industriale". Stessa
  logica (Competenze / Posizione / Lavoratori), più una sezione Assunzioni
  nuova e una veste grafica al posto degli embed Discord. Dal 2026-09-19 è
  una **scheda** della sezione Economia (`src/economy/`), insieme alle
  Rendite di produzione e alla scheda Prezzi.
  ⚠️ **L'attribuzione ad ArgusIA (card in cima alla vista) non va rimossa**,
  nemmeno ora che è "solo" una scheda di una sezione più grande.

Tutto il resto è **nuovo di WarEra+**: pannello nazione, Unità Militari,
Statistiche nazioni, Rendite di produzione, News + ticker, Time machine,
Guida, barre menù, preferiti, PWA, server di cache, temi mappa, viste mappa
aggiuntive.

La mappa è la vista principale. Un pannello laterale nazione
(`src/panel/countryPanel.js`) fa da ponte: si apre cliccando una nazione,
mostra dati già in memoria (zero fetch aggiuntive), e un bottone "Espandi"
apre Political View in-page nello stesso overlay. Le sezioni pesanti stanno
sotto "Approfondimenti" nelle barre menù, ognuna in overlay con `import()`
dinamico.

## Due deploy: live e dev

Il tool esiste in **due copie pubblicate**, distinte dal branch:

- **live** — branch `main` → `https://wareraplus.vercel.app/`. È quella che
  usano le persone e quella citata negli articoli.
- **dev** — branch `dev` → `https://wareraplus-dev.vercel.app/`. Stesso
  codice, URL diverso, **origin diverso**: quindi localStorage, service
  worker e cache sono suoi e non toccano quelli del live.

⚠️ **Dal 2026-09-02 il dev NON è più un preview del progetto principale.**
È un **secondo progetto Vercel** (`wareraplus-dev`) sullo stesso repo
GitHub, che tratta `dev` come proprio *branch di produzione*. Il motivo:
serviva un indirizzo apribile da chi non ha un account Vercel — i preview
stanno dietro Deployment Protection e chiedono l'SSO a chiunque altro — e
serviva stabile, perché finisce nell'allowlist CORS del server e nei
redirect di Discord per l'area riservata. I preview veri degli altri branch
restano protetti come prima.

La conseguenza da ricordare: **là dentro `VERCEL_ENV` vale `'production'`**,
perché Vercel guarda il branch di produzione DEL PROGETTO e non il nome del
branch. Per questo `vite.config.js` legge prima `WP_DEPLOY_ENV`, impostata a
`preview` fra le env var di quel progetto: senza, il dev si crederebbe live
e riaccenderebbe i tre contatori qui sotto. Se un giorno il cartellino `DEV`
sparisce dal dev, è quella variabile che non è arrivata alla build.

Il flusso è: si lavora e si spinge su `dev` — il che pubblica il progetto
dev — e solo quando va bene si porta su `main` (merge o fast-forward), che
pubblica il live.

**Cosa cambia fra i due**, tutto deciso a build time da `WP_DEPLOY_ENV` /
`VERCEL_ENV` e raccolto in `src/shared/deployEnv.js` (`IS_LIVE`,
`DEPLOY_ENV`):

| | live | dev / locale |
|---|---|---|
| Vercel Web Analytics (`inject()`) | sì | no |
| Umami (`initAnalytics()` in `shared/analytics.js`) | sì | no |
| Pill visite (`initVisitorCounter`, POST su `/visits`) | sì | no |
| Service worker PWA | precache normale | `selfDestroying` |
| Cartellino in basso a sinistra | — | `DEV` / `LOCAL` |
| `<meta name="robots">` | — | `noindex, nofollow` |
| `WARERA_PLUS_API_BASE` (area riservata) | `/warera-plus-api` | `/warera-plus-api-dev` |

Le ultime due sono nate col dev pubblico: un URL raggiungibile da Google
prima o poi porta un giocatore a segnalare un bug già corretto in live, e
l'area riservata scrive su un database che non deve essere quello vero.

Le stesse tre cose sono spente anche con **`?wallpaper=1`** (lo sfondo di
Wallpaper Engine, `src/shared/wallpaper.js: IS_WALLPAPER`), pure sul live:
uno sfondo resta acceso tutto il giorno su ogni desktop e si ricarica a
ogni avvio di Windows.

Le prime tre sono **contatori pubblici condivisi**: il server di cache non sa
da quale deploy arrivi una richiesta, quindi senza questo gate ogni ricarica
in dev alzerebbe il totale visite mostrato ai veri utenti. Regola generale:
**qualunque cosa nuova che scriva su un contatore o su uno stato condiviso va
messa dietro `IS_LIVE`.**

Il service worker in dev si auto-disinstalla di proposito: un preview serve a
vedere se una modifica funziona, e un SW che serve il bundle precedente dalla
cache è il modo migliore per guardare una modifica che c'è e credere che non
ci sia. Conseguenza accettata: il comportamento PWA si prova solo in live.

Il **server di cache e il Worker Cloudflare sono condivisi** dai due deploy —
non esiste un VPS di prova. Il CORS del server è `origin: '*'`, quindi il
preview funziona senza toccare nulla; ma le richieste del dev consumano lo
stesso budget del Worker e la stessa cache del VPS. Per il traffico di
sviluppo normale è irrilevante; per un test che martella le API, no.

## Stack & comandi

```bash
npm install
npm run dev       # vite dev, con service worker attivo anche in sviluppo
npm run build     # genera dist/
npm run preview   # testa la build in locale
```

- **Build tool**: Vite 5, `type: module`, deploy target Vercel (root path `/`,
  vedi `vercel.json`).
- **Dipendenze runtime**: `maplibre-gl`, `topojson-client`, più (dalla Fase 2)
  `chart.js`, `d3`, `tom-select`, `sortablejs` — tutte in `package.json`,
  importate da `src/political/*` come moduli npm (niente più CDN). Analytics:
  `@vercel/analytics` (`inject()` in `src/main.js`) + Umami (tag in
  `index.html`, wrapper in `src/shared/analytics.js`). Il vecchio
  `public/political/` (invariato, non più caricato) usa ancora i propri CDN
  interni ma non è più raggiunto da nessun path attivo.
- **PWA**: `vite-plugin-pwa` (Workbox). Precache completo, tranne le
  illustrazioni dell'oceano e il vecchio `public/political/` (globIgnores).
  Runtime caching differenziato per API tRPC (network-first, 10 min TTL), immagini/bandiere
  (cache-first, 30gg), CSV esterni (stale-while-revalidate).
  Config in `vite.config.js`.
- **Endpoint** (tutti in `src/diplomacy/config.js`): `API_BASE_URL`
  (`api6.warera.io`), `WORKER_API_BASE` (Worker Cloudflare, nasconde la API
  key — usato da Political e, come `ECO_PROXY_BASE`, dagli endpoint
  token-gated dell'Ottimizzatore), `WARERA_CACHE_BASE` (server di cache su
  VPS, vedi sotto), `CACHE_API_BASE_URL` (`gateway.warerastats.io`, di terzi),
  `TRPC_PROXY_BASE` (= `WARERA_CACHE_BASE`: il VPS espone la stessa route
  `/trpc/*` del Worker, vedi sotto). Nessuna variabile d'ambiente richiesta
  lato client.
- **Le chiamate `{ useWorker: true }` NON vanno più dritte al Worker**:
  passano da `src/shared/trpcProxy.js`, che prova prima `TRPC_PROXY_BASE`
  (VPS) e ricade sul Worker se non risponde, con cooldown di 2 minuti per non
  ripagare il tentativo fallito ad ogni chiamata. Motivo: il piano gratuito
  del Worker ha un tetto di 100.000 richieste/giorno, superato il
  2026-08-24, e il tetto sale col numero di utenti. Il Worker resta
  deployato come rete di sicurezza — non rimuoverlo. Per tornare indietro
  basta mettere `TRPC_PROXY_BASE` a stringa vuota.
- **Chiave API dell'utente** (oggi solo nello sfondo Wallpaper Engine):
  `setUserApiKey()` in `trpcProxy.js` mette DAVANTI a VPS e Worker una
  base diretta su `api2.warera.io` con la chiave di chi guarda (CORS di
  WarEra accetta `X-API-Key` da qualunque origin). ⚠️ Una chiave sbagliata
  NON viene rifiutata sulle procedure pubbliche (200 come un anonimo):
  la verifica vera è una chiamata a una procedura protetta
  (`transaction.getPaginatedTransactions`, limit 1). I `doFetch` dei
  chiamanti ricevono un secondo argomento con gli header in più.
- Il proxy `/trpc` del VPS ha una **micro-cache di 10 s** sulle risposte
  200 e accorpa le richieste identiche in volo: la key condivisa ha un
  tetto solo (500/min) per tutto il tool. `/health` → `trpcProxy.cache`.

## Struttura del progetto

L'albero commentato file per file — cosa fa ogni modulo, da dove prende i
dati, i ⚠️ di ciascuno — sta in **`STRUTTURA.md`**: leggilo prima di
toccare un'area che non conosci, e aggiorna lì la riga del modulo quando
ne aggiungi o ne sposti uno. In breve:

- `src/main.js` è l'entry point (deep-link, init dei componenti nuovi);
  `src/diplomacy/` la mappa e le sue viste, con `state.js` come unico stato;
- una cartella per sezione (`political/`, `mu/`, `nations/`, `players/`,
  `economy/` + `eco/` + `market/`, `battles/`, `guide/`, `private/`),
  ognuna aperta in overlay da `src/app/*Overlay.js` con `import()`;
- `src/panel/` il pannello laterale, `src/app/` lo shell (barre menù,
  ticker, time machine, tasto Indietro, sfondo), `src/shared/` i pezzi comuni;
- `server/` il cache-server del VPS e i suoi archivi, `wallpaper/` lo
  sfondo di Wallpaper Engine, `public/political/` il Political originale
  (non più usato).

⚠️ **Attenzione ai nomi duplicati tra le due varianti di Political**:
`config.js`, `main.js`, `ui.js`, `i18n.js`, `api.js`, `loading.js`,
`ticker.js`, `parliament.js`, `senate.js`, `congress.js`, `presidential.js`,
`party.js`, `organizer.js`, `panels.js`, `style.css` esistono **sia** in
`src/political/` (moduli ES, ATTIVA) **sia** in `public/political/` (script
globali, legacy/rollback, non più caricata). Contenuti quasi identici ma non
collegati: modifiche vanno fatte in `src/political/`, non in
`public/political/` (che resta com'era, invariata). Specifica sempre il path
completo quando chiedi modifiche — "modifica config.js" da solo è ambiguo tra
tre file (`src/diplomacy/config.js`, `src/political/config.js`,
`public/political/config.js`), e `main.js`/`api.js`/`i18n.js` esistono in
ancora più copie (`src/mu/`, `src/nations/`, `src/eco/`, `src/guide/`,
`src/market/`, `src/economy/`).

## Come comunicano Diplomacy, lo shell e Political (in-page dalla Fase 2)

Con Political ora in-page (niente più iframe), la comunicazione è più
semplice: chiamate di funzione dirette (import statici o `import()` dinamico)
al posto del confine cross-document. Resta un solo meccanismo cross-cutting:

1. **Eventi custom su `window`** (cross-script, stesso documento) — es.
   `wareraplus:diplomacy-ready` (emesso da `diplomacy/main.js` a fine
   `refreshData()`), `wareraplus:langchange` (shell, a cui si riagganciano
   tutte le viste per ritradursi a overlay già aperto),
   `wareraplus:panel-resized`, `wareraplus:pins-changed` (Preferiti).
   Anche `wareraplus:elections-ready`/`wareraplus:open-senate`
   (`src/political/congress.js`) sopravvivono per ora invariati (Stage 7 della
   Fase 2 li ha preservati com'erano) benché non serva più attraversare un
   confine iframe — semplificarli a chiamata diretta è un refactor possibile
   ma non ancora fatto.
2. **Dependency injection esplicita** per le dipendenze forward tra moduli
   `src/political/*` (es. `setCongressDeps`, `setPresidentialDeps`,
   `SenateView.setSenateDeps`, chiamate una sola volta da
   `src/political/main.js: initPoliticalView()`) — sostituisce gli
   identificatori nudi risolti a runtime che lo script classico originale
   dava per scontati via hoisting globale.
3. **`localStorage` condiviso** (stessa origin) — es. `we_theme`, letto da
   Political al boot (`src/political/config.js: initTheme()`, chiamata da
   `initPoliticalView()`). Per l'aggiornamento *live* di tema e lingua
   (`src/app/themeSync.js`, `src/app/langSync.js`) si chiamano direttamente
   le funzioni importate da `src/political/config.js` via `import()`
   dinamico — niente più `contentWindow`, stesso documento.

## Modifiche al codice Diplomacy esistente

All'inizio le aggiunte erano solo due; oggi non è più così — parecchi moduli
Diplomacy portano innesti WarEra+ (cercali col commento `WarEra+`, presente in
`main.js`, `map.js`, `ui.js`, `config.js`, `utils.js`, `nationTooltip.js`,
`labels.js`, `battleMarkers.js`…), più una decina di file nuovi nella stessa
cartella (heatmap delle viste nuove, bordi, oceano/temi, cacheClient).

Le due aggiunte storiche restano il modello da seguire:

1. `src/diplomacy/main.js` — riga finale di `refreshData()` che spara
   `wareraplus:diplomacy-ready`.
2. `src/diplomacy/nationTooltip.js` — il bottone "View Political Situation"
   prova ad aprire l'overlay in-app; se il modulo non è disponibile, ricade
   sul comportamento originale (link `target="_blank"`).

**Il principio vale ancora**: quando tocchi `src/diplomacy/*`, fai cambiamenti
**additivi con fallback** e marcali con un commento `WarEra+` che spiega
perché — non riscritture del comportamento esistente.

## Il server di cache (`server/warera-cache-server.js`)

Node su VPS esterno (`WARERA_CACHE_BASE`), gestito con pm2. Polla le API
WarEra una volta per tutti invece di lasciare che lo faccia ogni browser —
serve a ridurre i 429. Espone fra gli altri: `/money-transfers`, `/mu-directory`,
`/mu-playstyle-by-country`, `/mu-playstyle-history`, `/country-citizens`,
`/citizen-moves`, `/migration-flows`, `/battle-timeline`,
`/daily-damage`, `/damage-history`, `/damage-timeline`, `/damage-pulse`, `/price-history`, `/day-history`,
`/alliance-history`,
`/labour-history`, `/company-census`, `/player-wealth`,
`/political-history`, `/political-overview`, `/presidents`,
`/ticker` + `/ticker/summary`,
`/region-history/{at,range,events,contested,war-intensity}`, `/alliances`,
`/battles`, `/elections`, `/parties`, `/users-lite`, `/credit-profiles`,
`/mu-damage-history`,
`/visits`, `/health`.

Espone inoltre **`/trpc/*`**: un proxy passthrough verso `api2.warera.io`
che aggiunge `X-API-Key` server-side, cioè esattamente quello che fa il
Worker Cloudflare, ma senza il tetto di 100k richieste/giorno. La key si
legge da `WARERA_API_TOKEN` nell'ambiente di pm2, **non** dal codice:
`/health` riporta `trpcProxy.apiKey` = `caricata` / `MANCANTE` (mai il
valore). Senza key la route funziona lo stesso ma WarEra limita a 100/min e
risponde 401 sui tre endpoint token-gated dell'Ottimizzatore — quindi dopo
un redeploy che perde l'env var il sintomo è "Ottimizzatore in stato setup".
Lato client ci arriva `src/shared/trpcProxy.js` (vedi sopra).

Nelle **rotte** i file di cache non si rileggono a ogni richiesta: un file
servito com'è passa da `sendCacheFile` (letto e compresso una volta per
versione), uno da filtrare da `readCacheShared` (parsato una volta per
versione, oggetto CONDIVISO: mai modificarlo). `readCache` resta per i poll
e per chi scrive (`/visits`). Mai `readCacheShared` su file enormi letti di
rado (`bootstrap-raw-battles`, 255 MB): resterebbero in RAM, e il VPS ne ha
954 MB in tutto.

Regola di progetto in `src/diplomacy/cacheClient.js`: **ogni** funzione ha un
fallback se il VPS non risponde — il server è un'ottimizzazione, mai un nuovo
punto di fallimento. Vedi il ⚠️ in fondo per cosa degrada e come.

## Pattern da conoscere prima di toccare le chiamate API

- **Batching tRPC**: `src/diplomacy/utils.js: trpcBatch` (Diplomacy, invariato)
  e `src/shared/trpcClient.js` (usato da Political via `src/political/api.js`)
  accorpano più procedure tRPC in un solo POST/GET (`?batch=1`), con retry a
  backoff esponenziale su 429/5xx e fallback a chiamate singole se l'intero
  batch fallisce. **Non aggiungere fetch dirette a ripetizione in loop** —
  usa questi helper, altrimenti si riaffacciano i 429 che questo pattern è
  nato per risolvere. Le due policy di retry/batching (manuale-GET-429-only
  per Diplomacy, auto-batch-POST-429+5xx per Political) sono **deliberatamente
  diverse**, esposte come modalità distinte di `trpcClient.js`
  (`trpcBatchManual` vs `trpcCall`) — non unificarle silenziosamente.
- **Prima di aggiungere una fetch, guarda se il dato c'è già**: `state` di
  Diplomacy (`state.nazioniGlobal`, `state.mapDataGlobal`, `state.labelsData`,
  `state.nationBaseColorMap`) copre gran parte dei casi a costo zero — è quello
  che fanno `shared/countries.js`, `nations/api.js`, `timeMachineMap.js`.
- **Prezzi e libro ordini sono PUBBLICI**: `itemTrading.getPrices` e
  `tradingOrder.getTopOrders` rispondono da `API_BASE_URL` senza chiave, e
  `src/market/api.js` li prende così — un solo batch, nessun consumo del
  budget del Worker. La chiave (quindi il proxy) serve solo per
  `company.getRecommendedRegionIdsByItemCode`, che è anche l'unica fonte
  ammessa del bonus produzione: **il bonus non si ricalcola mai lato
  client**, né qui né in `src/eco/gameData.js`.
- **`useWorker: true`** instrada attraverso il Worker Cloudflare
  (`WORKER_API_BASE`, limite 500/min invece di 100) — usato SOLO per
  battaglie ed elezioni/parlamenti/Political, e per gli endpoint token-gated
  dell'Ottimizzatore (`ECO_PROXY_BASE`), non per tutte le chiamate.
- **Cache**: `localStorage`-based con TTL, chiave prefissata `we_<namespace>_`
  (`we_pol_*` per Political via `trpcClient.js`; Diplomacy non ha mai avuto
  cache). `cacheClear(namespace)` pulisce solo il proprio namespace di
  default. Dati grossi (directory MU, ~550 KB) stanno in MEMORIA per la
  sessione, mai in localStorage.

## Cose note, non bug da "scoprire" di nuovo

- `src/diplomacy/blocs.js` importa `EXTERNAL_BLOCS_URL`/`HARDCODED_BLOCS` da
  `config.js`, che non li esporta. **Preesistente al progetto originale**,
  non introdotto qui. Nessun impatto: l'unico `import` di `blocs.js` in
  `main.js` è commentato, quindi non gira mai. Se vuoi riattivarlo, va prima
  sistemato `config.js`.
- Alcuni file hanno line-ending misti (CRLF in alcuni moduli come
  `blocs.js`, `patterns.js`, `population.js`, `naps.js` — LF nel resto).
  Non normalizzare "a sorpresa" in un commit non richiesto, genera diff
  giganti fuori tema.
- **Toast non unificato**: Political usa ancora `alert()`/`setStatus()`
  inline invece di `showToast` di Diplomacy — follow-up separato a basso
  rischio, deciso esplicitamente e non fatto durante il cutover.

## Convenzioni di stile osservate nel codice

- Commenti a blocco con separatori `═══` per spiegare *perché* un modulo
  NUOVO esiste e come si aggancia al codice esistente — segui questo stile
  per nuovi file, è denso di contesto ed è lo standard di questo repo.
  Codice invariato copiato dai tool originali NON segue questo stile — non
  riformattarlo per uniformità, resta un diff inutile.
- Namespace CSS/DOM id per i componenti nuovi: prefisso `wp-` (`wp-panel`,
  `wp-political-overlay`, `wp-checkBlocLabels`, ecc.) per distinguerli da
  quelli originali di Diplomacy/Political.
- Stato applicativo Diplomacy centralizzato nell'oggetto singolo `state`
  (`src/diplomacy/state.js`), mutato in place — non introdurre un secondo
  store parallelo.
- **i18n a 9 lingue** (EN/IT/ES/DE/FR/NL/SV/PT/AR) ovunque. Le etichette
  usate da una sola vista stanno in un dizionario LOCALE a quella vista
  (`src/mu/i18n.js`, `src/nations/i18n.js`, `src/guide/i18n.js`, le costanti
  `*_DICT` nelle barre menù e in `newsView.js`); solo quelle davvero
  condivise dallo shell vanno in `src/shared/i18n.js`.
- **Niente barre di scorrimento di sistema**: mai le native grigie — regola
  globale in `shell.css`, cursore nella tinta della sezione.

## Cose da verificare se stai debuggando in queste aree

- `country.getAllCountries` e `map.getMapData` rispondono come atteso da
  `API_BASE_URL` (`https://api6.warera.io`) in `src/diplomacy/config.js`.
- Il Worker Cloudflare (`politicalview-proxy...workers.dev`, usato sia da
  `public/political/config.js` sia da `src/diplomacy/config.js` come
  `WORKER_API_BASE`) accetta richieste dal dominio Vercel attuale (CORS).
- Il server di cache risponde (`/health`) — se no, tutto deve degradare, non
  rompersi.
- Comportamento del pannello nazione sotto i 768px (`shell.css`).

## Roadmap (non iniziare senza richiesta esplicita)

Fase 2 (fusione moduli ES per Political) **completata**. Fase 3 **completata**
(Esplora Unità Militari + Statistiche nazioni con storico, confronti e
grafici). Fase 5 (proxy/cache dedicato) è di fatto **realizzata** con
`server/warera-cache-server.js`, anche se le chiamate dirette non sono state
sostituite tutte: il server affianca gli endpoint WarEra, non li rimpiazza.
Resta aperta la Fase 4 (dashboard unificata mappa+pannello permanenti,
non più overlay a tutto schermo). Dettagli in `README.md`.

⚠️ **Il cache-server va rideployato a mano ad ogni modifica di
`server/warera-cache-server.js`** (scp + `pm2 restart`, vedi
`server/README.md`) — il push su main deploya solo il client su Vercel.
Le funzionalità che dipendono dal server degradano da sole finché non lo
fai: la directory MU ricade sulla paginazione diretta dal browser (~4,5 s
e 14 richieste per utente invece di una), e le colonne "Composizione" e
"Guerra / Eco" dell'elenco restano vuote, insieme alla sezione stile di
gioco del pannello nazione. Nella scheda della singola unità gli stessi
due dati sono invece calcolati dal vivo sui membri appena scaricati, e
funzionano sempre. Dopo un deploy servono ~8 giri di poll (~4 ore) perché
la mappa utente→nazione/stile si riempia. L'elenco cittadini di Statistiche
nazioni dipende dallo stesso server (`/country-citizens`): senza deploy
ricade su una risoluzione diretta dal browser limitata a 150 cittadini per
nazione, dichiarata in chiaro nell'interfaccia. Ogni vista con riepilogo apre
il pannello da sola su desktop e resta dietro la linguetta "Vedi dettagli" su
mobile — stessa regola del riepilogo sfere, vedi `src/panel/viewOverview.js`.
La vista un tempo chiamata "Guerra vs Commercio" si chiama "Guerra vs Eco":
misura la build economica dei giocatori, non il commercio.

La sezione **Battaglie** (`src/battles/*`) dipende dai due endpoint nuovi
`/battle-archive` e `/war-expenses`: **finché non rideployi il server** parte
in "modalità ridotta", dichiarata in chiaro nell'interfaccia — l'archivio si
ferma alle ~400 battaglie più recenti sfogliate dal browser (~10 giorni), i
costi si caricano a richiesta riga per riga con un bottone, e le "Spese di
guerra" mostrano i soli contratti mercenari degli ultimi due giorni, senza la
colonna taglie. Dopo il deploy serve **una notte** perché si riempia: il
bootstrap gira SOLO fra le 02:00 e le 06:59 italiane (richiesta esplicita:
mai sfogliare l'archivio mentre il gioco è pieno di gente), e in quelle cinque
ore copre tutti e novanta i giorni. `/health` riporta `battleArchive` con lo
stato dei due bootstrap.

I **finanziatori** nel dettaglio battaglia dipendono da `/money-transfers`:
finché non rideployi funzionano lo stesso, ma sulla sola finestra che l'API
espone da sé (~3 giorni), quindi una battaglia più vecchia dice "fuori
portata" invece di elencare i finanziatori. Dopo il deploy la copertura
**non si riempie di colpo**: parte dai ~3 giorni che l'API ricorda e cresce
di un giorno al giorno fino ai novanta — non esiste modo di recuperarli a
ritroso, il dato semplicemente non c'è più da nessuna parte. Il campo
`coverageFrom` nella risposta è quello che la vista usa per non spacciare
un buco di copertura per un "nessuno ha finanziato".

Le **battaglie in corso** in cima all'archivio sono l'unica parte della
sezione che NON dipende da un rideploy: arrivano da `/battles`, che il server
serve già, e senza server ricadono sul Worker come i marker della mappa.

I **danni nel tempo** del 1 vs 1 delle unità (`src/mu/muCompare.js` +
`server/muBattleDamage.js`) dipendono da `/mu-damage-history`: senza
rideploy la rotta risponde 404 e il riquadro "Danni nel tempo" non compare,
mentre il resto del confronto è identico. Dopo il deploy il giro diurno
conta solo le battaglie NUOVE; tutte le altre (archivio + il seme di
`import/muBattleSeed.js`, dal maggio 2025) le recupera la notte, fra le
02:00 e le 06:59, 75 al minuto: una notte. Fino ad allora il riquadro
dichiara da che giorno parte (`coverageFrom`) e quante battaglie mancano.
⚠️ Il giorno è quello in cui la battaglia FINISCE (UTC): verificato contro
gli scatti, su un mese torna entro l'1%, ma giorno per giorno è rumoroso
(una battaglia dura anche un giorno intero). Per questo settimane e
cumulato, mai barre giornaliere. `/health` → `muBattleDamage`.

Il **Bilancio unità** (`src/mu/muWealth.js` + `server/plusApi/wealth.js`)
dipende dal redeploy di **warera-plus-api**, non del cache-server: finché
non lo fai, `/wealth/unita` risponde 404 e la linguetta semplicemente non
compare (verificato: il client logga un warning e la vista unità resta
identica per tutti). Dopo il deploy c'è però un'attesa che non si può
saltare: **lo storico della ricchezza non esiste da nessuna parte e si
accumula**. Nessuna procedura WarEra dice quanto aveva un giocatore ieri —
`rankings.userWealth` è istantanea — quindi i sette giorni pieni arrivano
dopo una settimana, e un giorno saltato è perso per sempre. Il **primo
giorno** però si scatta ogni 4 ore ("rodaggio"), così un raffronto c'è
già la sera stessa: quelle colonne durano ore e lo dichiarano, e appena
in archivio ci sono due giorni la serie torna giornaliera da sola. È lo stesso vincolo dei bonifici fra
tesori, e come là la vista lo dichiara (fascia "L'archivio si sta ancora
riempiendo") invece di far sembrare un buco di copertura un "non ha speso
niente". `/health` di plusApi riporta `ricchezza` con i giorni in archivio.

⚠️ Il numero è il **saldo netto**, non la spesa militare: entrate meno
uscite fra due scatti. Chiamarlo "quanto costa la guerra" sarebbe la
stessa trappola di `rankings.countryBounty` — la vista lo dice in testa.

**La mia nazione** nell'area riservata (`src/private/nazione.js` +
`server/plusApi/{nazione,confini,nemici,fonti}.js`) dipende anch'essa dal
redeploy di **warera-plus-api**: finché non lo fai `/nazione` risponde 404
e la scheda mostra l'errore con "Riprova", mentre contratti e
amministrazione restano identici. Tre cose da sapere prima di crederla rotta:

- gli **allarmi dai confini** partono vuoti: il primo giro fotografa basi e
  bunker e NON avvisa (tutto sembrerebbe "appena acceso"); si avvisa solo
  su un cambio fra due letture, ogni 10 minuti. La storia si accumula, come
  i bonifici. Discord solo per accensioni e costruzioni, sul canale
  `confini` (separato da quello dei contratti), e solo se il governo l'ha
  configurato;
- ⚠️ basi e bunker si leggono da `upgrade.getUpgradeByTypeAndEntity`, NON
  da `upgradesV2` della regione, che è fermo a metà 2025 (Ticino col bunker
  al 5 spento risultava "livello 1 attivo"). `activeUpgradeLevels` è giusto
  ma dice solo cosa è ACCESO. Vedi la testata di `confini.js`;
- l'area riservata è aperta alle **nazioni dell'alleanza P.A.S.T.A.**,
  rilette ogni 10 minuti da `allianceId` (`server/plusApi/nazioni.js`,
  `alleanzaAmmessa` in `/health`): chi entra nell'alleanza entra, chi esce
  esce. Gli allarmi dai confini hanno DUE canali Discord: uno per nazione
  (lo imposta il suo governo) e uno di alleanza (scope `confini_alleanza`,
  lo imposta il capo dell'alleanza in gioco), che riceve solo le regioni
  di nazioni FUORI dall'alleanza, una riga per regione;
- la pagina la vedono il **governo** per carica (presidente, vice, ministri)
  e i **cittadini che il governo aggiunge** (tabella `nation_access`, sempre
  con Discord + personaggio collegato); agli altri cittadini il server
  risponde 403 con i nomi del governo, a cui chiedere;
- il **potenziale** dei nemici (e nostro) si stima dai PILLATI
  (`modelloPillole` in `server/plusApi/nemici.js`, dal 2026-10-06): su 14
  giorni di /damage-timeline, danno/ora ≈ fondo + k · pillati (R² ~0,5
  orario; k fra 100 e 300 mila per pillato all'ora). Due scenari sulla
  finestra di una pillola — "adesso" e "al loro picco", col danno vero di
  quella finestra accanto — più un grafico a punti per qualunque altro
  numero. Provato a ritroso su 30 nazioni: errore mediano ~1/3 su 8 ore,
  fascia 5°–95° giusta 3 volte su 4. ⚠️ Lo scenario "si pillano tutti" è
  stato provato e TOLTO: cambiava di sette volte col modo di pesare i
  puliti. Il vecchio tetto "vita + fame" era stato scartato prima ancora
  (dieci volte sopra il danno osservato). Il danno settimanale di una
  nazione È la somma dei suoi cittadini (verificato: Germania 1,405 mld
  contro 1,403);
- **alleati** e relazione `alleato` ai confini vengono da `allianceId`
  (stesso blocco), MAI dal campo `allies`, fossile del 10 giugno: l'Italia
  vi ha ancora la Francia, con cui è in guerra.

Il **danno ora per ora** e la **curva a 14 giorni** nella scheda nazione
(`src/nations/damageCurves.js` + `server/damageTimeline.js`) dipendono da
`/damage-timeline`: finché non rideployi la sezione non compare affatto —
degrado voluto, non un guasto. Dopo il deploy le sue due metà si riempiono
a velocità molto diverse, e vale la pena saperlo prima di crederlo rotto:

- i **giocatori pillati** ci sono quasi subito. `user.getUserLite` porta
  `buffs` con `buffEndAt` (o `debuffEndAt`), che sono timestamp FUTURI e
  fissi: sottraendo le durate della pillola (`gameConfig.items.cocain`:
  8 ore di buff, 15,5 di malus) si ricava l'ora ESATTA in cui è stata
  presa, anche per pillole prese prima del deploy. Bastano quindi ~2 ore
  (il giro completo dei cittadini, REFRESH_WINDOW_MS) perché la curva
  delle ultime 23 ore sia piena;
- il **danno orario** no, e non c'è modo di accelerarlo: WarEra pubblica
  solo il cumulato settimanale, e il danno di un'ora è la differenza fra
  due letture. Un'ora in cui nessuno stava guardando è persa per sempre,
  esattamente come i bonifici fra tesori. `coverageFrom` dice da quando in
  qua, la vista lo dichiara in una fascia, e la curva a 14 giorni è piena
  dopo 14 giorni.

- i **pillati a un istante** (adesso / 24h-14g fa, in cima al grafico
  orario) e la **linea dei pillati ogni 15 minuti** vengono da
  `pill.instant` e `pill.fine`, contati sull'ora vera di ogni presa (file
  `pill-takes`, 14 giorni + 12 ore, in memoria): "adesso" è esatto subito
  dopo il deploy, la curva fine si allunga di un giorno al giorno fino a
  due settimane. Dove il registro non arriva il client usa i punti orari
  dell'archivio di prima, dichiarandolo. ⚠️ Quei punti NON sono il
  massimo dell'ora: `_pillSlots` conta chi è pillato al centro del
  secchio, le hh:30 — sono istanti anche loro, e la linea continua.
  Il danno resta orario. Il calcolo lato client è uno solo,
  `src/shared/pillInstants.js`, per la scheda nazione e per i grafici di
  gruppo (scheda alleanza, Faction 1 vs 2, 1 vs 2 nazioni).

⚠️ Non provare a riempire il danno orario dall'archivio battaglie: `ad`/`dd`
di `battleArchive.js` sono il totale di uno schieramento a battaglia
CONCLUSA, e spalmarli sulle ore produrrebbe una curva credibile e inventata
(si vedrebbe il picco delle battaglie aperte, non quello dei colpi).

I **movimenti di cittadini** nel pannello nazione (`src/panel/nationWatch.js`
+ `server/citizenMoves.js`) sono della stessa famiglia: senza rideploy
`/citizen-moves` risponde 404 e la sezione non compare, mentre proxy e
guerra/eco — che leggono dalla memoria — restano. Dopo il deploy il primo
censimento è solo la fotografia di partenza (non produce nessun movimento:
non c'è niente con cui confrontarla) e i sette giorni si riempiono un'ora
alla volta. ⚠️ Non provare a ricostruirli a ritroso da `user.getUserLite`:
quella dice dove uno sta **adesso**, e "adesso" non è mai stato "ieri".

Il **contatore visite** (`/visits`) invece sì: finché non rideployi, la pill
semplicemente non compare — è il degrado voluto, non un guasto. Il seme di
1325 è la misura di Vercel Analytics al 2026-08-31 e vive in `VISITS_SEED`
nel server, non nel client.

Lo **storico prezzi** in Rendite di produzione (`src/market/priceChart.js` +
`server/priceHistory.js`) è dello stesso tipo: senza rideploy `/price-history`
non esiste e la colonna "andamento" non compare nella riga aperta, mentre
tabella, rendite e simulatore restano identici. Dopo il deploy l'archivio si
riempie da sé a una candela al giorno — ma i tre mesi indietro (aprile →
settembre 2026) ci sono subito solo se si lancia anche `import/prezzi.js`,
perché `itemTrading.getPrices` dice quanto costa ADESSO e ieri non esiste da
nessuna parte. Stesso vincolo di bonifici e ricchezza, stessa soluzione: un
archivio di terzi importato una volta sola.

Le schede **Produzione** e **Ricchezza** di Economia (`src/economy/production.js`,
`src/economy/playerWealth.js`) dipendono da DUE deploy diversi, e conviene
saperlo prima di crederle rotte:

- **Produzione** vuole il cache-server con `server/companyCensus.js`. Senza,
  la scheda dice "non disponibile" e basta. Dopo il deploy il primo giro
  parte subito (un'ora scarsa, `available: false` finché non finisce), poi
  uno a notte alle 03:20. Il primo giro riempie 31 giorni di salari a
  ritroso, ma solo delle aziende che hanno dipendenti OGGI: quei giorni la
  vista li dichiara "ricostruiti" (`measuredFrom`). Aziende e dipendenti
  invece sono una fotografia e la loro storia si accumula dal deploy.
- **Ricchezza** vuole il cache-server (`/player-wealth`) E warera-plus-api
  (la rotta pubblica `/pubblico/ricchezza/giocatore/:id`, chiesta sulla
  loopback all'istanza LIVE anche dal deploy dev). Con uno solo dei due la
  scheda mostra la ricchezza di adesso (da getUserLite, che funziona sempre)
  e dichiara che l'archivio manca. Lo storico c'è subito: è la classifica
  mondiale che plusApi fotografa ogni notte dal 2026-09-19, più l'import dal
  19 giugno.

La **time machine** mostrava solo l'ownership per una ragione scritta in
testa a `src/app/timeMachine.js`: gli altri dati «non sono mai stati salvati
nel tempo, mostrarli sarebbe fuorviante». Per patti difensivi, guerre,
nemico giurato e battaglie aperte non vale più — `server/dayHistory.js` li
salva, e l'import ne porta cinque mesi. Tutto il resto (popolazione,
sviluppo, ricchezza di una regione) resta fuori per il motivo originale.
Senza rideploy `/day-history` non esiste e la time machine torna esattamente
com'era: popup con nome, bandiera e "dal —", nessuna sezione battaglie.

Lo **storico politico** (`src/political/{history,world}.js` +
`server/politicalHistory.js`) è della stessa famiglia: senza rideploy le
viste "Storia" e "Mondo" di Political dicono che il dato non è disponibile
(il calendario del Mondo ricade comunque su /elections?open=1), la time
machine non mostra il presidente, e il resto di Political è identico.
Collegamenti, composizione del partito, scheda giocatore e intervallo del
simulatore NON dipendono dal server. Dopo il deploy presidenti, affluenza e
confronto ci sono subito (vengono dalle elezioni già archiviate); iscritti,
cambi di casacca e governi partono vuoti e dichiarano `coverageFrom`. I nomi
dei presidenti di tutto il mondo si riempiono in qualche mezz'ora (il cron
ne risolve 300 a giro). ⚠️ Il presidente "da elezione" è quello ELETTO: un
impeachment fra due elezioni lo vede solo l'archivio dei governi.

⚠️ La scheda giocatore di Political (`openPlayerCard`, parliament.js) NON
aveva nessuna regola CSS: era un div senza stile appeso a <body>, sotto
l'overlay, quindi invisibile. Lo stile è in `src/styles/politicalPlus.css`.

**Lavoro e tasse** (`src/nations/labourSection.js` + `server/labourHistory.js`)
è l'unica sezione del progetto costruita su un archivio **chiuso**: 51 giorni
(29 lug → 17 set 2026) che non cresceranno mai, perché il gioco paga ~550.000
salari al giorno e non esiste modo di sfogliarli. Non aggiungere un poll
"per completezza": darebbe un campione storto spacciato per un totale. Senza
rideploy la sezione non compare.

⚠️ **Gli archivi importati non si potano più a giorni, e non è una
dimenticanza.** Il 2026-09-19 l'autore del database di terzi da cui viene
`server/import/` ha annunciato che lo chiude: da quella data il VPS è
l'**unica copia al mondo** di bonifici (dal 25 apr), ricchezza giornaliera
(dal 19 giu), prezzi (dal 9 apr), diplomazia (dal 13 apr), battaglie aperte
(dal 9 apr) e salari (51 gg chiusi). Le retention allargate che
accompagnavano l'import erano comunque date di scadenza silenziose — il 22
ottobre i bonifici avrebbero iniziato a cancellare aprile, il 16 dicembre la
ricchezza a cancellare giugno — quindi al loro posto c'è un `PAVIMENTO`
(una data prima di qualunque riga) in `moneyTransfers.js`,
`plusApi/wealth.js` e `priceHistory.js`: si tiene tutto, e la potatura resta
solo come rete contro etichette malformate. Costo misurato: ~1,1 GB/anno la
ricchezza, meno di un MB i prezzi, qualche centinaio di KB i bonifici, su 39
GB liberi. **Non rimetterci un numero di giorni "per pulizia".**

Nella stessa direzione, due cose sullo stesso giorno:

- `plusApi/wealth.js` fotografa ora la **classifica mondiale intera**
  (~17.000 giocatori) e non più i soli ~450 membri delle unità italiane.
  Costa **una richiesta al giorno**: `ranking.getRanking
  {rankingType:'userWealth'}` è pubblica, ignora `limit`/`page` e risponde
  con tutta la ladder in un colpo. Entra con `INSERT OR IGNORE` dopo il giro
  sulle unità (non ha lo `username`, che invece quelle righe portano; in
  cambio porta il `mu`, che l'import non aveva).
- `server/backup.sh` — prima non esisteva alcun backup. `VACUUM INTO` per i
  due sqlite (un `cp` con il WAL acceso prende un database a metà), tar
  della `cache/` senza `bootstrap-raw-battles.json` (244 MB che il bootstrap
  notturno rifà da solo), 4 copie a rotazione, cron domenica 04:00, 174 MB a
  giro. ⚠️ è sullo **stesso disco**: il passo che conta è l'`rsync` che se
  le porta via, documentato in `server/README.md`.

L'unico archivio rimasto con una scadenza è `dayHistory.js` (400 giorni,
cioè maggio 2027), e lì il vincolo è la **RAM** e non il disco: tiene
l'archivio intero in memoria e il VPS ha 954 MB totali. La strada, quando
servirà, è tenere caldi solo gli ultimi mesi.

⚠️ **L'input tRPC NON va incapsulato in `{"json": ...}`.** Le procedure
vogliono l'oggetto nudo (`?input={"transactionType":"...","limit":50}`).
Col wrapper superjson la richiesta riesce lo stesso ma **i filtri vengono
ignorati in silenzio**: `transaction.getPaginatedTransactions` risponde 200
con il flusso globale delle ultime transazioni invece che con quelle
filtrate, e il sintomo si legge come "l'endpoint non sa filtrare" — falso,
e porta a progettare intorno a un limite che non esiste.

⚠️ **`rankings.countryBounty` NON è la spesa di una nazione.** Sembra la
risposta pronta (è già in `state.nazioniGlobal`, gratis) ma correla 0,87 col
danno totale e 0,11 con la ricchezza: è quanto i *cittadini* hanno incassato,
non quanto il governo ha pagato. La spesa vera si ricostruisce solo battaglia
per battaglia. Vedi il blocco in testa a `server/battleArchive.js`.

Le viste mappa storiche degradano ognuna a modo suo: "Regioni contese", se
`/region-history/contested` manca, si conta i passaggi di mano da sola nel
browser sugli eventi grezzi (~112 KB gzip, una volta per sessione), quindi
funziona comunque; "Guerra vs Eco" usa `/mu-playstyle-by-country`;
"Storico bellico" è l'unica che senza deploy resta vuota — il totale danno
per regione si calcola solo sulle battaglie del bootstrap, che stanno solo
sul VPS (`/region-history/war-intensity`), e la legenda lo dice in chiaro.
Anche la riga "danno di oggi" nella fascia di Alliance Overview dipende dal
server (`/daily-damage`, scatto alle 02:00 italiane): senza deploy
semplicemente non compare. Le ultime quattro categorie del ticker (guerre,
sworn enemy, popolazione, tesoro) arrivano da `/ticker`: senza server il
ticker resta alle sole battaglie ed elezioni, che sono fetch live.
