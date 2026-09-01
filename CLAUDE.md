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
  nuova e una veste grafica al posto degli embed Discord.
  ⚠️ **L'attribuzione ad ArgusIA (card in cima alla vista) non va rimossa.**

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
- **dev** — branch `dev` → preview Vercel
  `https://wareraplus-git-dev-<scope>.vercel.app/`. Stesso codice, URL
  diverso, **origin diverso**: quindi localStorage, service worker e cache
  sono suoi e non toccano quelli del live.

Il flusso è: si lavora e si spinge su `dev`, si guarda il preview, e solo
quando va bene si porta su `main` (merge o fast-forward). Vercel costruisce
un preview per ogni push su qualsiasi branch che non sia quello di
produzione — non serve configurare nulla lato Vercel.

**Cosa cambia fra i due**, tutto deciso a build time da `VERCEL_ENV` e
raccolto in `src/shared/deployEnv.js` (`IS_LIVE`, `DEPLOY_ENV`):

| | live | dev / locale |
|---|---|---|
| Vercel Web Analytics (`inject()`) | sì | no |
| Umami (`initAnalytics()` in `shared/analytics.js`) | sì | no |
| Pill visite (`initVisitorCounter`, POST su `/visits`) | sì | no |
| Service worker PWA | precache normale | `selfDestroying` |
| Cartellino in alto a sinistra | — | `DEV` / `LOCAL` |

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
- **PWA**: `vite-plugin-pwa` (Workbox). Precache completo. Runtime caching
  differenziato per API tRPC (network-first, 10 min TTL), immagini/bandiere
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

## Struttura del progetto

```
wareraPlus/
├── index.html                  ← shell principale (markup Diplomacy + pannello + overlay)
├── vite.config.js              ← build + PWA
├── vercel.json
├── server/
│   ├── warera-cache-server.js  ← server di cache su VPS (Node, pm2) — poll periodico
│   │                              delle API WarEra al posto dei browser utente
│   ├── battleArchive.js        ← NUOVO — archivio battaglie concluse (90 gg) coi loro
│   │                              costi + serie giornaliera delle spese per nazione.
│   │                              Bootstrap SOLO fra le 02:00 e le 06:59 italiane
│   │                              (gioco vuoto), giro incrementale tutto il giorno.
│   │                              Endpoint: /battle-archive, /war-expenses,
│   │                              /battle-archive/status.
│   └── README.md               ← deploy a mano (scp + pm2 restart), vedi ⚠️ in fondo
├── public/
│   ├── icons/
│   └── political/              ← Political View ORIGINALE (script globali), NON PIÙ USATO
│       ├── index.html, style.css                a runtime — resta solo come riferimento/
│       ├── config.js, api.js, main.js, ...       rollback fisico (Fase 2). Vedi src/political/
│       └── parties_<countryId>.csv               per la versione attiva a moduli ES.
└── src/
    ├── main.js                 ← entry point: importa diplomacy/main.js, inizializza i
    │                              componenti NUOVI, gestisce i deep-link ?country= e ?tm=
    ├── diplomacy/               ← Diplomacy View (moduli ES) + aggiunte WarEra+
    │   ├── main.js              ← init(), refreshData(), event listener della UI
    │   ├── state.js             ← unico oggetto state condiviso (mutato in place)
    │   ├── config.js            ← API_BASE_URL, WORKER_API_BASE, WARERA_CACHE_BASE,
    │   │                          ECO_PROXY_BASE, COLORS, THEMES, LAYER_IDS
    │   ├── map.js                ← MapLibre: layer, sorgenti, rendering
    │   ├── ui.js, diplomacy.js, labels.js, patterns.js
    │   ├── alliances.js, naps.js, sphereOfInfluence.js, blocs.js (dead, vedi sotto)
    │   ├── battleMarkers.js, battleHeatmap.js, battleFront.js, battleFront/
    │   ├── battleSpending.js  ← NUOVO — quanto è costata una battaglia: taglie
    │   │                        pagate (classifica "money" per nazione) + contratti
    │   │                        mercenari aggiudicati, per schieramento. Tre procedure
    │   │                        PUBBLICHE su api6 (nessun consumo del Worker), un
    │   │                        batch per aggiornamento, cache 60s. Il tooltip
    │   │                        battaglia lo carica solo alla prima apertura della
    │   │                        sezione "Battle spending". Gemello lato archivio:
    │   │                        src/battles/api.js (stesse procedure, altra scala).
    │   ├── builderPreview.js ← NUOVO — le alleanze costruite in Alliance
    │   │                        Builder dipinte SULLA MAPPA ("Show on map"):
    │   │                        una fotografia dei blocchi del builder in
    │   │                        state.builderPreview, che vista Alleanze,
    │   │                        etichette, legenda e riepilogo pannello
    │   │                        leggono PRIMA di blocColorMap/externalBlocsInfo
    │   │                        (dato di gioco, mai toccato). Non è un
    │   │                        collegamento vivo: si aggiorna ripremendo il
    │   │                        bottone. Cade da sola uscendo dalla vista.
    │   ├── dualBadges.js, blocStats.js, weeklyDamage.js, population.js,
    │   │   regions.js, nationTooltip.js, utils.js
    │   ├── cacheClient.js       ← NUOVO — client del server di cache: OGNI funzione ha
    │   │                          fallback se il VPS non risponde (mai un nuovo SPOF)
    │   ├── contestedHeatmap.js, warIntensityHeatmap.js, playstyleHeatmap.js,
    │   │   playstyleTrendHeatmap.js  ← NUOVE viste mappa (regioni contese, storico
    │   │                                bellico, guerra vs eco, trend stile di gioco)
    │   ├── borderStyle.js       ← NUOVO — bordi come nella mappa del gioco: interni nella
    │   │                          tinta della nazione, nazionali colorati per relazione
    │   ├── oceanRoutes.js       ← NUOVO — geometria condivisa delle rotte marittime
    │   ├── oceanBackground.js   ← NUOVO — rotte animate, tema scuro
    │   ├── antiqueTheme.js      ← NUOVO — estetica "mappa antica", tema chiaro
    │   ├── darkFleetTheme.js    ← NUOVO — easter egg illustrati, tema scuro
    │   ├── oceanImages.js, shipTooltip.js  ← icone delle illustrazioni + tooltip navi
    │   └── data/antarctica.geo.json
    ├── political/               ← Political View a moduli ES, attiva a runtime (Fase 2)
    │   ├── main.js              ← orchestratore: initPoliticalView(countryId, {openSenate})
    │   ├── config.js            ← stato condiviso (export let + setter), tema, cache TTL
    │   ├── api.js               ← localFetch, adapter su shared/trpcClient.js
    │   ├── loading.js, i18n.js, ui.js, ticker.js, domTemplate.js, backgroundCanvas.js
    │   ├── parliament.js, senate.js, congress.js, presidential.js, party.js,
    │   │   organizer.js, panels.js
    │   └── (nessun equivalente di embed.js — era dead code nell'originale, non portato)
    ├── mu/                       ← NUOVO — Esplora Unità Militari
    │   ├── main.js              ← initMuView(container) + openMuDetail(muId)
    │   ├── api.js               ← directory dal server di cache (/mu-directory) con
    │   │                          fallback a paginazione diretta; dettaglio e membri
    │   │                          on-demand. La directory sta in MEMORIA per la
    │   │                          sessione (~550 KB), mai in localStorage.
    │   ├── i18n.js, ui.js       ← dizionario locale (9 lingue) e pezzi di UI comuni
    │   ├── playstyle.js         ← classificatore guerra/economia dai punti abilità
    │   │                          (gemello di classifyPlaystyle nel cache-server: se
    │   │                          cambi soglie o elenchi di skill, cambiali in tutti e due)
    │   ├── muList.js            ← elenco a TABELLA (colonne ordinabili, righe tinte
    │   │                          per tier, colonna "Composizione" coi membri per
    │   │                          nazione + marchio "de facto"), blocchi da 60 righe
    │   ├── muDetail.js          ← scheda unità: sei classifiche + composizione per
    │   │                          nazionalità (calcolata dal vivo sui membri) + membri
    │   └── ranking.js           ← classifiche, ordinate dalla directory (zero fetch)
    ├── nations/                  ← NUOVO — Statistiche nazioni
    │   ├── main.js              ← initNationsView(container) + openNationDetail(countryId);
    │   │                          tab panoramica / 1 vs 2 / grafici + scheda nazione
    │   ├── api.js               ← nazioni da state.nazioniGlobal (zero fetch) e elenco
    │   │                          cittadini dal cache-server (/country-citizens), con
    │   │                          fallback diretto LIMITATO a 150 utenti se il server manca
    │   ├── metrics.js           ← le metriche in un posto solo (panoramica, 1vs2 e scheda
    │   │                          leggono le stesse definizioni)
    │   ├── charts.js            ← ciambelle/barre in SVG scritto a mano, niente Chart.js
    │   ├── nationList.js, nationCompare.js, nationDetail.js, i18n.js (9 lingue)
    ├── eco/                      ← NUOVO — Ottimizzatore industriale (port del bot Discord
    │   │                            "WarEra Eco Optimizer" di ArgusIA — attribuzione
    │   │                            obbligatoria in cima alla vista)
    │   ├── main.js              ← orchestratore + rendering (era bot.py + embeds.py)
    │   ├── api.js               ← ecoCall via ECO_PROXY_BASE (Worker), dati di gioco
    │   ├── gameData.js, resolve.js, account.js, wage.js
    │   └── skills.js, positioning.js, workers.js, hiring.js  ← logica pura (hiring = nuova)
    ├── market/                   ← NUOVO — Rendite di produzione: la classifica di
    │   │                            mercato di tutte le risorse per rendita al punto
    │   │                            produzione. Gemella dell'Ottimizzatore per chi
    │   │                            un'azienda non ce l'ha ancora (cosa produrre, dove
    │   │                            aprirla): NON chiede uno username, si apre e mostra.
    │   ├── main.js               ← initMarketView(container) + stopMarketAutoRefresh():
    │   │                          tabella, ordinamenti, riga espandibile, simulatore paga
    │   ├── api.js                ← due orologi: prezzi + libro ordini (PUBBLICI, diretti
    │   │                          su api6, TTL 5 min, giro automatico mentre è aperta) e
    │   │                          regioni consigliate (token-gated via ecoBatch → proxy,
    │   │                          TTL 30 min + localStorage). Un refresh completo = 2
    │   │                          richieste HTTP. Regioni e tasse: zero fetch.
    │   ├── model.js              ← formule PURE (la stessa di eco/gameData.js, ma con i
    │   │                          prezzi eseguibili) + paga di pareggio, guadagno
    │   │                          giornaliero per paga offerta e bonus FEDELTÀ allo
    │   │                          slider dei giorni (+1%/giorno fino a 10, letto da
    │   │                          gameConfig.worker, come eco/workers.js). Cambiare
    │   │                          paga o giorni non costa una richiesta.
    │   └── i18n.js               ← dizionario locale (9 lingue)
    ├── battles/                  ← NUOVO — Battaglie: una voce, due schede.
    │   │                            "Archivio battaglie" (in corso + concluse, con danno,
    │   │                            taglia pagata e contratti mercenari) e "Spese di
    │   │                            guerra" (quanto spende ogni nazione al giorno).
    │   ├── api.js                ← server di cache (/battle-archive, /war-expenses) con
    │   │                          fallback nel browser: ~10 giorni di elenco e i costi
    │   │                          caricati SOLO per la riga che l'utente apre. Mai 800
    │   │                          richieste per riempire una tabella. Le battaglie IN
    │   │                          CORSO (getLiveBattles) riusano fetchActiveBattles()
    │   │                          di battleHeatmap.js — stessa sorgente dei marker
    │   │                          sulla mappa, nessuna fetch nuova, TTL 4 min contro i
    │   │                          ~2 della mappa. Su una battaglia viva le cache per
    │   │                          battaglia si saltano ({live:true}): taglia,
    │   │                          classifiche e dettaglio crescono ancora.
    │   ├── battleDetail.js       ← scheda di UNA battaglia: scomposizione per
    │   │                          nazione e per unità militare (danno, quota del
    │   │                          lato, taglia INCASSATA) + elenco dei contratti
    │   │                          mercenari. ⚠️ la colonna taglia qui è "incassato",
    │   │                          non "speso": coincidono solo sommando il lato.
    │   ├── main.js, battleList.js, warExpenses.js, i18n.js (9 lingue)
    ├── guide/                    ← NUOVO — Guida "Come si usa": SOLO testo statico
    │   ├── main.js                  (zero fetch, zero stato) + i18n.js a 9 lingue.
    │   └── i18n.js                  È la vista più leggera dell'app, deve restarlo.
    ├── panel/                   ← NUOVO
    │   ├── countryPanel.js      ← pannello laterale nazione (+ riepilogo sfere e viste)
    │   ├── viewOverview.js      ← contenuto del riepilogo che si apre entrando in una
    │   │                          vista mappa (alleanze, popolazione, danni sett.,
    │   │                          regioni contese, storico bellico, guerra vs eco):
    │   │                          classifica + descrizione per le viste non ovvie.
    │   │                          Solo markup/dati — apertura, linguetta mobile e
    │   │                          click stanno in countryPanel.js
    │   ├── nationFlag.js        ← bandiera/codice ISO di una nazione, condivisi dai
    │   │                          due pannelli (erano privati in countryPanel.js)
    │   ├── parliamentChart.js   ← grafico emiciclo nel pannello (nativo, indipendente da src/political/)
    │   └── panelResize.js       ← drag per ridimensionare il pannello
    ├── app/                     ← NUOVO — orchestrazione integrazione
    │   ├── politicalOverlay.js ← apre Political in-page (import() dinamico di src/political/main.js)
    │   ├── muOverlay.js        ← apre Esplora Unità Militari
    │   ├── nationsOverlay.js   ← apre Statistiche nazioni
    │   ├── ecoOverlay.js       ← apre l'Ottimizzatore industriale
    │   ├── battlesOverlay.js   ← apre Battaglie (archivio + spese di guerra) e alla
    │   │                         chiusura ferma il giro delle battaglie in corso
    │   ├── visitorCounter.js   ← NUOVO — pill "N visite · ● M" in #wp-bottom-credits,
    │   │                         accanto a Ko-fi e all'autore. Due numeri diversi: le
    │   │                         VISITE (cumulative) da /visits sul server di cache,
    │   │                         che parte dal totale misurato da Vercel Analytics fino
    │   │                         al 2026-08-31 (1325, seme lato SERVER: cambiarlo non
    │   │                         richiede un deploy del client), e gli ONLINE ADESSO
    │   │                         (pallino verde), che il server conta in memoria su una
    │   │                         finestra di 5 minuti. Il client ripassa ogni minuto
    │   │                         con `count=0` — "ci sono ancora" senza gonfiare il
    │   │                         totale — e smette a scheda nascosta, così una scheda
    │   │                         dimenticata esce dal conto da sola. Il ritmo lo detta
    │   │                         il server (`heartbeatMs` nella risposta).
    │   │                         Nessun IP registrato: il browser si genera un id
    │   │                         casuale in localStorage, che serve solo a non contare
    │   │                         due volte nello stesso giorno. Server giù = niente
    │   │                         pill; server vecchio che non manda `online` = pill con
    │   │                         le sole visite. Mai un numero inventato.
    │   ├── marketOverlay.js    ← apre Rendite di produzione (e alla chiusura ferma
    │   │                         il suo timer di aggiornamento prezzi)
    │   ├── newsOverlay.js      ← apre la vista News
    │   ├── guideOverlay.js     ← apre la Guida "Come si usa"
    │   ├── newsTicker.js       ← ticker in cima alla mappa: battaglie, elezioni, nuove
    │   │                         guerre, sworn enemy, popolazione, tesoro. Le ultime
    │   │                         quattro arrivano già pronte dal server (/ticker), non
    │   │                         più da snapshot in localStorage. Tetto per categoria
    │   │                         (CAT_CAP) così una sola non monopolizza il ticker.
    │   ├── newsView.js         ← vista "News": lo STESSO materiale del ticker, completo,
    │   │                         fermo e raggruppato per categoria. Zero fetch nuove —
    │   │                         riusa getNewsGroups() del ticker.
    │   ├── timeMachine.js      ← ownership storica delle regioni a uno slider temporale
    │   │                         (dati dal server: keyframe + replay lato VPS). Scope
    │   │                         volutamente ridotto: solo ownership + nome + bandiera.
    │   │                         Deep-link ?tm=<epoch ms>.
    │   ├── timeMachineMap.js   ← SECONDA mappa MapLibre dedicata e alleggerita (3 layer)
    │   │                         usata dalla time machine; la principale viene nascosta,
    │   │                         non toccata. timeMachine.js tiene tutta la logica.
    │   ├── desktopMenuBar.js   ← barra menù desktop (Viste mappa / Approfondimenti /
    │   │                         Impostazioni, ricerca ⌘K, Preferiti)
    │   ├── mobileMenuBar.js    ← equivalente mobile (drawer)
    │   ├── pins.js             ← store dei Preferiti (nazioni/alleanze/unità), localStorage
    │   ├── overlayChrome.js    ← chrome condiviso degli overlay: sfondo a particelle nella
    │   │                         tinta della sezione + pausa mappa
    │   ├── mapIdle.js          ← pausa/riprende il lavoro di sfondo della mappa (pallini
    │   │                         nave, polling marker battaglia) mentre un overlay la copre
    │   ├── themeSync.js        ← sincronizza tema (localStorage 'we_theme') con Political
    │   ├── langSync.js         ← stessa cosa per la LINGUA (era un bug reale: Political
    │   │                         restava in inglese dopo un cambio lingua nello shell)
    │   ├── battleToggle.js     ← bottone dedicato show/hide battaglie
    │   ├── blocLabelsToggle.js ← toggle nomi alleanze
    │   └── authorPill.js       ← pill autore accanto al bottone Ko-fi
    ├── shared/
    │   ├── particlesBackground.js ← motore dello sfondo a particelle, condiviso da tutte
    │   │                            le sezioni (Political oro, Eco verde, MU rosso,
    │   │                            News blu, Alleanze viola)
    │   ├── loadingScreen.js    ← schermata di attesa comune fra il clic e il primo pixel
    │   │                          di contenuto delle sezioni caricate a richiesta
    │   ├── lazyModule.js       ← import() dinamico con rete di sicurezza (in produzione
    │   │                          un chunk può sparire dopo un deploy: retry/reload)
    │   ├── i18n.js             ← traduzioni condivise dello shell, 9 lingue
    │   │                          (namespace diverso da src/political/i18n.js)
    │   ├── countries.js        ← getAllCountries() legge state.nazioniGlobal (sola lettura)
    │   ├── allianceBonus.js    ← ricalcola il bonus danno d'alleanza (l'API non lo espone)
    │   ├── dailyDamage.js      ← "danno di oggi" per nazioni/alleanze/unità, dalla
    │   │                          differenza fra due snapshot del cumulato settimanale
    │   ├── analytics.js        ← wrapper su Umami (trackEvent)
    │   └── trpcClient.js       ← client tRPC unificato: trpcBatchManual (stile Diplomacy)
    │                              + trpcCall (stile Political), cache namespaced
    │                              we_<namespace>_*. src/diplomacy/utils.js:trpcBatch NON
    │                              tocca questo file (resta la sua implementazione locale).
    └── styles/
        ├── diplomacy.css       ← CSS Diplomacy estratto (era inline nell'HTML originale)
        ├── shell.css           ← namespace `wp-*`
        ├── political.css       ← da public/political/style.css, OGNI selettore scopato
        │                          sotto #wp-political-root (c'era una collisione reale
        │                          con .panel, già usata dalla shell)
        └── menubar.css, mobile-menubar.css, mu.css, nations.css, news.css,
            eco.css, guide.css, market.css, battles.css
```

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
`src/market/`).

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
serve a ridurre i 429. Espone fra gli altri: `/mu-directory`,
`/mu-playstyle-by-country`, `/mu-playstyle-history`, `/country-citizens`,
`/daily-damage`, `/ticker` + `/ticker/summary`, `/region-history/{at,range,
events,contested,war-intensity}`, `/alliances`, `/battles`, `/elections`,
`/parties`, `/users-lite`, `/credit-profiles`, `/visits`, `/health`.

Espone inoltre **`/trpc/*`**: un proxy passthrough verso `api2.warera.io`
che aggiunge `X-API-Key` server-side, cioè esattamente quello che fa il
Worker Cloudflare, ma senza il tetto di 100k richieste/giorno. La key si
legge da `WARERA_API_TOKEN` nell'ambiente di pm2, **non** dal codice:
`/health` riporta `trpcProxy.apiKey` = `caricata` / `MANCANTE` (mai il
valore). Senza key la route funziona lo stesso ma WarEra limita a 100/min e
risponde 401 sui tre endpoint token-gated dell'Ottimizzatore — quindi dopo
un redeploy che perde l'env var il sintomo è "Ottimizzatore in stato setup".
Lato client ci arriva `src/shared/trpcProxy.js` (vedi sopra).

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

Le **battaglie in corso** in cima all'archivio sono l'unica parte della
sezione che NON dipende da un rideploy: arrivano da `/battles`, che il server
serve già, e senza server ricadono sul Worker come i marker della mappa.

Il **contatore visite** (`/visits`) invece sì: finché non rideployi, la pill
semplicemente non compare — è il degrado voluto, non un guasto. Il seme di
1325 è la misura di Vercel Analytics al 2026-08-31 e vive in `VISITS_SEED`
nel server, non nel client.

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
