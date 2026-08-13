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
  Copiata **invariata** dentro `public/political/` e caricata in un
  `<iframe>` quando l'utente espande il pannello nazione (deep-link
  `?country=<id>`, stesso meccanismo che esisteva già tra i due tool
  originali). **Non è ancora stata convertita a moduli ES** — è ancora script
  globali (`window.X`), di proposito (vedi "Perché l'iframe" sotto).

La mappa (Diplomacy) è la vista principale. Un pannello laterale nazione
(NUOVO, `src/panel/countryPanel.js`) fa da ponte: si apre cliccando una
nazione, mostra dati già in memoria (zero fetch aggiuntive), e un bottone
"Espandi" apre Political View nell'overlay iframe.

## Stack & comandi

```bash
npm install
npm run dev       # vite dev, con service worker attivo anche in sviluppo
npm run build     # genera dist/
npm run preview   # testa la build in locale
```

- **Build tool**: Vite 5, `type: module`, deploy target Vercel (root path `/`,
  vedi `vercel.json`).
- **Dipendenze runtime**: `maplibre-gl`, `topojson-client`. Political View usa
  CDN esterni (Chart.js, TomSelect, Sortable — non in `package.json`, caricati
  via `<script>` in `public/political/index.html`).
- **PWA**: `vite-plugin-pwa` (Workbox). Precache completo incluso
  `/political/*`. Runtime caching differenziato per API tRPC (network-first,
  10 min TTL), immagini/bandiere (cache-first, 30gg), CSV esterni
  (stale-while-revalidate). Config in `vite.config.js`.
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
│   └── political/              ← Political View ORIGINALE, invariato (script globali)
│       ├── index.html, style.css
│       ├── config.js, api.js, main.js, ui.js, i18n.js, loading.js
│       ├── congress.js, senate.js, presidential.js, party.js, panels.js,
│       │   organizer.js, ticker.js, parliament.js
│       ├── embed.js / embed.css   ← modalità ?embed=senate (solo emiciclo, per countryPanel)
│       └── parties_<countryId>.csv
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
    ├── panel/                   ← NUOVO
    │   ├── countryPanel.js      ← pannello laterale nazione
    │   ├── parliamentChart.js   ← grafico emiciclo nel pannello
    │   └── panelResize.js       ← drag per ridimensionare il pannello
    ├── app/                     ← NUOVO — orchestrazione integrazione
    │   ├── politicalOverlay.js ← gestisce l'iframe Political View + comunicazione via CustomEvent
    │   ├── themeSync.js        ← sincronizza tema (localStorage 'we_theme') tra shell e iframe
    │   ├── battleToggle.js     ← bottone dedicato show/hide battaglie
    │   └── blocLabelsToggle.js ← toggle nomi alleanze
    ├── shared/
    │   └── i18n.js             ← traduzioni condivise dello shell (namespace diverso da public/political/i18n.js)
    └── styles/
        ├── diplomacy.css       ← CSS Diplomacy estratto (era inline nell'HTML originale)
        └── shell.css           ← NUOVO, namespace `wp-*`
```

⚠️ **Attenzione ai nomi duplicati tra le due viste**: `config.js`, `main.js`,
`ui.js`, `i18n.js`, `index.html`, `style.css` esistono **sia** in
`src/diplomacy/` **sia** in `public/political/`, con contenuti completamente
diversi e non collegati. Specifica sempre il path completo quando chiedi
modifiche — "modifica config.js" da solo è ambiguo.

## Come comunicano Diplomacy, lo shell e Political (iframe)

Tre meccanismi diversi, usati per scopi diversi — non mescolarli:

1. **Eventi custom su `window`** (cross-script, stesso documento) — es.
   `wareraplus:diplomacy-ready` (emesso da `diplomacy/main.js` a fine
   `refreshData()`), `wareraplus:langchange`, `wareraplus:panel-resized`.
2. **Eventi custom su `frameEl.contentWindow`** (shell ↔ iframe Political) —
   usati invece di leggere variabili dell'iframe per nome, perché in uno
   script classico `let`/`const` top-level **non** diventano proprietà di
   `window` (solo `var` e le function declaration lo fanno). Es.:
   `wareraplus:open-senate` (richiesta), `wareraplus:elections-ready`
   (prontezza). Vedi il commento lungo in `politicalOverlay.js` se serve
   toccare questa parte — spiega il bug che questo pattern risolve.
3. **`localStorage` condiviso** (stessa origin) — es. `we_theme`, letto da
   Political al boot (`public/political/config.js: initTheme()`). Per
   l'aggiornamento *live* con iframe già aperto si chiama direttamente
   `contentWindow.applyTheme(...)`, che funziona perché è una *function
   declaration* (quindi attaccata a `window`), a differenza di `let`/`const`.

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

## Perché Political View è ancora in iframe (non moduli ES)

Political View è ~300KB di script interdipendenti scritti per girare come
script-tag globali. Convertirli "alla cieca" senza poterli testare dal vivo
contro le API reali rischiava bug sottili. L'iframe garantisce zero rischio
di rottura. **La fusione a bundle unico è pianificata come Fase 2** (vedi
Roadmap in README.md) — non partire a farla senza che l'utente la richieda
esplicitamente, è un lavoro grosso e rischioso.

## Pattern da conoscere prima di toccare le chiamate API

- **Batching tRPC**: sia Diplomacy (`diplomacy/utils.js: trpcBatch`) sia
  Political (`public/political/api.js`) accorpano più procedure tRPC in un
  solo POST (`?batch=1`), con retry a backoff esponenziale su 429/5xx e
  fallback a chiamate singole se l'intero batch fallisce. **Non aggiungere
  fetch dirette a repetizione in loop** — usa questi helper, altrimenti si
  riaffacciano i 429 che questo pattern è nato per risolvere.
- **`useWorker: true`** in `trpcBatch` instrada attraverso il Worker
  Cloudflare (`WORKER_API_BASE`, limite 500/min invece di 100) — usato SOLO
  per battaglie ed elezioni/parlamenti, non per tutte le chiamate.
- **Cache**: `localStorage`-based con TTL, chiave prefissata `we_`
  (`cacheKey`/`cacheGet`/`cacheSet` in entrambe le viste — implementazioni
  parallele, non condivise). `cacheClear()` ripulisce solo le chiavi `we_*`.

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

Fase 2 (fusione moduli ES per Political), Fase 3 (dati military units), Fase
4 (dashboard unificata mappa+pannello permanenti), Fase 5 (proxy/cache server
dedicato). Dettagli completi in `README.md`. Se l'utente chiede una di queste
aree, leggi prima la sezione Roadmap del README per il piano già pensato.
