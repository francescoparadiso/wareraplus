# CLAUDE.md — WarEra+

Guida di contesto per Claude Code su questo repository. Per la storia completa
delle decisioni architetturali e la roadmap dettagliata, vedi `README.md`
(molto più esteso di questo file — leggilo se serve capire il "perché", non
solo il "cosa").

## Cos'è questo progetto

WarEra+ unisce due tool esistenti del gioco WarEra in un'unica app:

- **Diplomacy View** — mappa strategica interattiva (MapLibre GL): alleanze,
  guerre, NAP, sfere d'influenza, battaglie live, statistiche. Portata qui
  **praticamente 1:1**, era già scritta a moduli ES con Vite.
- **Political View** — elezioni presidenziali/congresso, partiti, senato.
  **Convertita a moduli ES in `src/political/` (Fase 2, completata)**: gira
  in-page dentro `#wp-political-root`, montata via `import()` dinamico alla
  prima apertura (code-split, non appesantisce il caricamento iniziale).
  L'originale a script globali resta in `public/political/` come
  riferimento/rollback fisico, **non più raggiunto da alcun path attivo**
  dell'app (niente più iframe).

La mappa (Diplomacy) è la vista principale. Un pannello laterale nazione
(NUOVO, `src/panel/countryPanel.js`) fa da ponte: si apre cliccando una
nazione, mostra dati già in memoria (zero fetch aggiuntive), e un bottone
"Espandi" apre Political View in-page nello stesso overlay.

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
  importate da `src/political/*` come moduli npm (niente più CDN). Il vecchio
  `public/political/` (invariato, non più caricato) usa ancora i propri CDN
  interni ma non è più raggiunto da nessun path attivo.
- **PWA**: `vite-plugin-pwa` (Workbox). Precache completo (incluso il chunk
  Political, ora parte del bundle principale via code-splitting). Runtime
  caching differenziato per API tRPC (network-first, 10 min TTL),
  immagini/bandiere (cache-first, 30gg), CSV esterni (stale-while-revalidate).
  Config in `vite.config.js`.
- Nessuna variabile d'ambiente richiesta: le chiamate vanno agli endpoint
  pubblici WarEra (`api2/4/6.warera.io`) e a un Worker Cloudflare esistente
  che nasconde la propria API key server-side per Political View.

## Struttura del progetto

```
wareraPlus/
├── index.html                  ← shell principale (markup Diplomacy + pannello + overlay)
├── vite.config.js              ← build + PWA
├── vercel.json
├── public/
│   ├── icons/
│   └── political/              ← Political View ORIGINALE (script globali), NON PIÙ USATO
│       ├── index.html, style.css                a runtime — resta solo come riferimento/
│       ├── config.js, api.js, main.js, ...       rollback fisico (Fase 2). Vedi src/political/
│       └── parties_<countryId>.csv               per la versione attiva a moduli ES.
└── src/
    ├── main.js                 ← entry point: importa diplomacy/main.js, poi inizializza
    │                              i componenti NUOVI dopo l'evento 'wareraplus:diplomacy-ready'
    ├── diplomacy/               ← Diplomacy View, quasi invariato (moduli ES)
    │   ├── main.js              ← init(), refreshData(), event listener della UI
    │   ├── state.js             ← unico oggetto state condiviso (mutato in place)
    │   ├── config.js            ← API_BASE_URL, WORKER_API_BASE, COLORS, THEMES, LAYER_IDS
    │   ├── map.js                ← MapLibre: layer, sorgenti, rendering
    │   ├── ui.js, diplomacy.js, labels.js, patterns.js
    │   ├── alliances.js, naps.js, sphereOfInfluence.js, blocs.js (dead, vedi sotto)
    │   ├── battleMarkers.js, battleHeatmap.js, battleFront.js, battleFront/
    │   ├── dualBadges.js, blocStats.js, weeklyDamage.js, population.js,
    │   │   regions.js, nationTooltip.js, utils.js
    ├── political/               ← NUOVO (Fase 2) — Political View a moduli ES, attiva a runtime
    │   ├── main.js              ← orchestratore: initPoliticalView(countryId, {openSenate})
    │   ├── config.js            ← stato condiviso (export let + setter), tema, cache TTL
    │   ├── api.js               ← localFetch, adapter su shared/trpcClient.js
    │   ├── loading.js, i18n.js, ui.js, ticker.js, domTemplate.js, backgroundCanvas.js
    │   ├── parliament.js, senate.js, congress.js, presidential.js, party.js,
    │   │   organizer.js, panels.js
    │   └── (nessun equivalente di embed.js — era dead code nell'originale, non portato)
    ├── mu/                       ← NUOVO (Fase 3) — Esplora Unità Militari
    │   ├── main.js              ← initMuView(container) + openMuDetail(muId)
    │   ├── api.js               ← directory dal server di cache (/mu-directory) con
    │   │                          fallback a paginazione diretta; dettaglio e membri
    │   │                          on-demand. La directory sta in MEMORIA per la
    │   │                          sessione (~550 KB), mai in localStorage.
    │   ├── i18n.js, ui.js       ← dizionario locale (9 lingue) e pezzi di UI comuni
    │   ├── muList.js            ← elenco a TABELLA (colonne ordinabili, righe tinte
    │   │                          per tier, colonna "Composizione" coi membri per
    │   │                          nazione + marchio "de facto"), blocchi da 60 righe
    │   ├── muDetail.js          ← scheda unità: sei classifiche + composizione per
    │   │                          nazionalità (calcolata dal vivo sui membri) + membri
    │   └── ranking.js           ← classifiche, ordinate dalla directory (zero fetch)
    ├── panel/                   ← NUOVO
    │   ├── countryPanel.js      ← pannello laterale nazione
    │   ├── parliamentChart.js   ← grafico emiciclo nel pannello (nativo, indipendente da src/political/)
    │   └── panelResize.js       ← drag per ridimensionare il pannello
    ├── app/                     ← NUOVO — orchestrazione integrazione
    │   ├── muOverlay.js        ← apre Esplora Unità Militari (import() dinamico di src/mu/main.js)
    │   ├── politicalOverlay.js ← apre Political in-page (import() dinamico di src/political/main.js)
    │   ├── themeSync.js        ← sincronizza tema (localStorage 'we_theme') con Political
    │   ├── battleToggle.js     ← bottone dedicato show/hide battaglie
    │   └── blocLabelsToggle.js ← toggle nomi alleanze
    ├── shared/
    │   ├── i18n.js              ← traduzioni condivise dello shell (namespace diverso da src/political/i18n.js)
    │   └── trpcClient.js        ← NUOVO (Fase 2) client tRPC unificato: trpcBatchManual (stile
    │                              Diplomacy) + trpcCall (stile Political), cache namespaced
    │                              we_<namespace>_*. src/diplomacy/utils.js:trpcBatch NON tocca
    │                              questo file (resta la sua implementazione locale, invariata).
    └── styles/
        ├── diplomacy.css       ← CSS Diplomacy estratto (era inline nell'HTML originale)
        ├── shell.css           ← NUOVO, namespace `wp-*`
        └── political.css       ← NUOVO (Fase 2) — da public/political/style.css, OGNI selettore
                                   scopato sotto #wp-political-root (necessario: c'era una
                                   collisione reale con .panel, già usata dalla shell)
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
`public/political/config.js`).

## Come comunicano Diplomacy, lo shell e Political (in-page dalla Fase 2)

Con Political ora in-page (niente più iframe), la comunicazione è più
semplice: chiamate di funzione dirette (import statici o `import()` dinamico)
al posto del confine cross-document. Resta un solo meccanismo cross-cutting:

1. **Eventi custom su `window`** (cross-script, stesso documento) — es.
   `wareraplus:diplomacy-ready` (emesso da `diplomacy/main.js` a fine
   `refreshData()`), `wareraplus:langchange` (shell), `wareraplus:panel-resized`.
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
   `initPoliticalView()`). Per l'aggiornamento *live* (`src/app/themeSync.js`)
   si chiama direttamente `applyTheme(...)` importata da
   `src/political/config.js` via `import()` dinamico — niente più
   `contentWindow`, stesso documento.

## Le uniche due modifiche al codice Diplomacy esistente

Tutto il resto di `src/diplomacy/` è copiato senza toccare una riga. Solo due
aggiunte, entrambe additive con fallback:

1. `src/diplomacy/main.js` — riga finale di `refreshData()` che spara
   `wareraplus:diplomacy-ready`.
2. `src/diplomacy/nationTooltip.js` — il bottone "View Political Situation"
   prova ad aprire l'overlay in-app; se il modulo non è disponibile, ricade
   sul comportamento originale (link `target="_blank"`).

Se devi modificare `src/diplomacy/*`, preserva questo principio: cambiamenti
additivi con fallback, non riscritture del comportamento esistente.

## Fase 2 — completata (Political View a moduli ES, in-page)

Political View era ~300KB di script interdipendenti scritti per girare come
script-tag globali dentro un iframe. La conversione a moduli ES (`src/political/`)
è stata completata in 10 stage incrementali (Stage 0-9, ognuno con verifica
dal vivo contro le API reali prima di procedere al successivo — piano e
storico completo in `README.md`, sezione Roadmap → "Fase 2 (completata)").
Punti da sapere se tocchi `src/political/`:

- **CSS scoping obbligatorio**: `src/styles/political.css` ha OGNI selettore
  prefissato con `#wp-political-root` (script postcss, non a mano — 708
  regole). Verificato dal vivo che uno scoping parziale (solo `:root`/reset/
  `body`) romperebbe silenziosamente lo stile della legenda della mappa
  (`.panel`, classe condivisa con Political). Se aggiungi CSS nuovo a questo
  file, scopalo allo stesso modo — non c'è più l'isolamento naturale
  dell'iframe.
- **Stato condiviso cross-modulo**: `src/political/config.js` espone
  `export let` + funzioni setter (es. `setCurrentCountryId`) per ogni
  variabile che un tempo era una `let`/`const` globale riassegnabile da più
  file — un `import` ES è un binding live ma **read-only**, riassegnarlo
  direttamente lancia `TypeError`.
- **Dipendenze forward** (moduli che si servono a vicenda, es. senate.js →
  congress.js → main.js) risolte con setter di dependency-injection
  (`setCongressDeps`, `setSenateDeps`, ecc.), chiamati una sola volta da
  `initPoliticalView()`.
- `public/political/` **non è stato cancellato** — resta come riferimento/
  rollback fisico, ma non è più raggiunto da alcun path attivo dell'app.
- **Toast non unificato**: Political usa ancora `alert()`/`setStatus()`
  inline (non `showToast` di Diplomacy) — deciso esplicitamente come
  follow-up separato a basso rischio, non fatto durante il cutover.
- **Fetch `country.getAllCountries` condivisa** (follow-up alla Fase 2):
  `src/shared/countries.js: getAllCountries()` legge `state.nazioniGlobal`
  di Diplomacy (sola lettura) invece di rifare la stessa fetch via Worker —
  usata da tutti i punti di `src/political/*` che prima chiamavano
  `localFetch('/countries', ...)`. Fallback a fetch diretta solo se
  Diplomacy non ha ancora i dati (raro). Non mutare mai l'array ritornato
  in-place (`.sort()` ecc.) — è condiviso con Diplomacy, usa `.slice()`
  prima.

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
- **`useWorker: true`** instrada attraverso il Worker Cloudflare
  (`WORKER_API_BASE`, limite 500/min invece di 100) — usato SOLO per
  battaglie ed elezioni/parlamenti/Political, non per tutte le chiamate.
- **Cache**: `localStorage`-based con TTL, chiave prefissata `we_<namespace>_`
  (`we_pol_*` per Political via `trpcClient.js`; Diplomacy non ha mai avuto
  cache). `cacheClear(namespace)` pulisce solo il proprio namespace di
  default.

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

## Cose da verificare al primo avvio reale in questa sessione

(dal README — validale se stai debuggando qualcosa che coinvolge queste aree)

- `country.getAllCountries` e `map.getMapData` rispondono come atteso da
  `API_BASE_URL` (`https://api6.warera.io`) in `src/diplomacy/config.js`.
- Il Worker Cloudflare (`politicalview-proxy...workers.dev`, usato sia da
  `public/political/config.js` sia da `src/diplomacy/config.js` come
  `WORKER_API_BASE`) accetta richieste dal dominio Vercel attuale (CORS).
- Comportamento del pannello nazione sotto i 768px (`shell.css`).

## Roadmap (non iniziare senza richiesta esplicita)

Fase 2 (fusione moduli ES per Political) **completata**. Fase 3 —
**Esplora Unità Militari (`src/mu/`) fatta**; resta l'altra metà della
fase (più dati sulle nazioni nel pannello: storico, confronti, grafici).
Restano poi Fase 4 (dashboard unificata mappa+pannello permanenti) e
Fase 5 (proxy/cache server dedicato). Dettagli completi in `README.md`.
Se l'utente chiede una di queste aree, leggi prima la sezione Roadmap del
README per il piano già pensato.

⚠️ Il pezzo server delle Unità Militari (`pollMuDirectory` + endpoint
`/mu-directory` in `server/warera-cache-server.js`) **va ancora
deployato** sul VPS. Finché non lo è: (1) il client prende 404 e ricade
sulla paginazione diretta — funziona, ma ~4,5 s e 14 richieste per ogni
utente invece di una; (2) la colonna "de facto" dell'elenco resta vuota,
perché la composizione per nazionalità dei membri la calcola solo il
server (nella scheda della singola unità invece si calcola dal vivo, e
funziona già oggi). Dopo il deploy servono ~4 ore perché la mappa
utente→nazione si riempia: vedi `server/README.md`.
