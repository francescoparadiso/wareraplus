# WarEra+

Un'unica app che unisce **Diplomacy View** (mappa strategica) e **Political View**
(elezioni, congresso, partiti) di WarEra, con la mappa come visualizzazione
principale e un pannello nazione che fa da ponte tra le due.

---

## 🧭 Come funziona (architettura v1)

```
                    ┌─────────────────────────────┐
                    │        index.html            │
                    │   (mappa Diplomacy, invariata)│
                    └──────────────┬────────────────┘
                                   │ click su una nazione
                                   ▼
                    ┌─────────────────────────────┐
                    │   Pannello laterale (NUOVO)   │
                    │   dati già in memoria,        │
                    │   nessuna nuova fetch          │
                    └──────────────┬────────────────┘
                                   │ bottone "Espandi"
                                   ▼
                    ┌─────────────────────────────┐
                    │  Overlay Political View        │
                    │  (iframe → /political/*,       │
                    │   codice originale invariato)  │
                    └─────────────────────────────┘
```

**Decisione chiave di questa v1:** il codice di **Political View** (congress.js,
senate.js, presidential.js, party.js, i18n.js…) è stato copiato **invariato**
dentro `public/political/` e viene caricato in un `<iframe>` quando l'utente
espande il pannello nazione, passando `?country=<id>` — lo stesso meccanismo
di deep-link che esisteva già tra i due tool originali (`config.js` di
Political lo legge di suo, zero modifiche necessarie lì).

Perché un iframe e non un merge diretto a moduli ES? Political View è
~300KB di script interdipendenti scritti per girare come script-tag
globali (`window.X`). Convertirli alla cieca in moduli ES senza poterli
testare dal vivo contro le API reali avrebbe introdotto rischio di bug
sottili. L'iframe garantisce **zero rischio di rottura**: quel codice
funziona esattamente come funzionava nel tool originale. La fusione vera
(Opzione B "pura", un solo bundle) è pianificata come Fase 2 — vedi
Roadmap sotto.

**Diplomacy View**, che era già scritta a moduli ES (Vite), è stata invece
portata **praticamente 1:1** dentro `src/diplomacy/`, diventando la vista
principale dell'app.

### Le uniche due modifiche al codice esistente

Tutto il resto del codice Diplomacy è copiato senza toccare una riga. Ci sono
solo due piccole aggiunte, entrambe **additive** (non cambiano comportamento
esistente, hanno fallback):

1. **`src/diplomacy/main.js`** — una riga in fondo a `refreshData()` che
   spara un evento `wareraplus:diplomacy-ready` quando i dati sono pronti.
   Serve al pannello nazione per sapere quando può agganciarsi alla mappa.
2. **`src/diplomacy/nationTooltip.js`** — il bottone "View Political
   Situation" del tooltip pinnato ora prova ad aprire l'overlay in-app
   invece di una scheda esterna; se il modulo non è disponibile (es. il
   file venisse eseguito fuori da WarEra+), ricade sul comportamento
   originale (link con `target="_blank"`).

### Nota su un file morto preesistente

`src/diplomacy/blocs.js` importa `EXTERNAL_BLOCS_URL`/`HARDCODED_BLOCS` da
`config.js`, ma quel file non li esporta. **Questo gap esiste già nel
progetto originale**, non l'ho introdotto io: `blocs.js` non è mai importato
attivamente da nessuno (l'unico `import` in `main.js` è commentato), quindi
non causa errori a runtime. L'ho lasciato invariato; se in futuro vuoi
riattivare quella funzionalità (blocchi da CSV esterno, alternativa alle
alleanze via API), va prima sistemato `config.js`.

---

## 📁 Struttura del progetto

```
wareraPlus/
├── index.html                  ← shell principale (markup Diplomacy + pannello + overlay)
├── vite.config.js              ← build + PWA (manifest, service worker, caching)
├── vercel.json                 ← config deploy Vercel
├── package.json
├── public/
│   ├── icons/                  ← icone PWA (generate)
│   └── political/              ← Political View ORIGINALE, invariato
│       ├── index.html
│       ├── congress.js, senate.js, presidential.js, party.js, ...
│       └── style.css
└── src/
    ├── main.js                 ← entry point, orchestrazione
    ├── diplomacy/               ← Diplomacy View, quasi invariato (2 righe aggiunte)
    │   ├── main.js, map.js, ui.js, state.js, config.js, ...
    ├── panel/
    │   └── countryPanel.js     ← NUOVO — pannello laterale nazione
    ├── app/
    │   └── politicalOverlay.js ← NUOVO — gestisce l'iframe Political View
    └── styles/
        ├── diplomacy.css       ← CSS Diplomacy estratto (era inline nell'HTML originale)
        └── shell.css           ← NUOVO — stile pannello/overlay (namespace `wp-*`)
```

---

## 🚀 Setup locale

```bash
cd wareraPlus
npm install
npm run dev
```

Apri `http://localhost:5173`. Il service worker è attivo anche in dev
(`devOptions.enabled: true` in `vite.config.js`) così puoi testare subito
il comportamento offline/PWA senza fare una build.

## 📦 Build & Deploy su Vercel

```bash
npm run build      # genera dist/
npm run preview    # testa la build in locale
```

Su Vercel:
1. Collega la repo, framework rilevato automaticamente come **Vite**
   (già esplicitato in `vercel.json`).
2. Build command: `npm run build` — Output: `dist/`.
3. Nessuna variabile d'ambiente necessaria: le chiamate API passano dagli
   endpoint pubblici WarEra (`api2/api4/api6.warera.io`) e dal Worker
   Cloudflare esistente per Political View (che nasconde la sua API key
   lato server, non in questo progetto).

## 📲 Installabilità (PWA)

L'app è installabile su desktop e mobile (`display: 'standalone'` nel
manifest). Il service worker (via `vite-plugin-pwa`, Workbox sotto il
cofano) applica queste strategie di cache:

| Risorsa | Strategia | Perché |
|---|---|---|
| Chiamate tRPC WarEra (`api2/4/6.warera.io`) | Network-first, 10 min TTL | Dati di gioco freschi quando c'è rete, utilizzabili offline con l'ultima risposta nota altrimenti |
| Bandiere/immagini (`app.warera.io`) | Cache-first, 30 giorni | Cambiano raramente |
| CSV esterni (NAP, Sphere of Influence) | Stale-while-revalidate | Bilancia freschezza e velocità |
| Google Fonts, MapLibre CDN | Cache-first | Asset statici versionati |
| Bundle app (JS/CSS/HTML, incluso `/political/*`) | Precache completo | App utilizzabile offline dopo il primo caricamento |

Quando in futuro vorrai un vero server di caching dedicato (come accennato),
il layer `runtimeCaching` in `vite.config.js` è il punto da cui sostituire
gli endpoint diretti WarEra con il tuo proxy, senza toccare il resto
dell'app.

---

## 🗺️ Roadmap

### Fase 2 — Fusione vera a modulo unico (Opzione B "pura")
Oggi Political View è isolato in iframe per minimizzare il rischio. Una
volta che questa v1 è stata testata dal vivo:
- Convertire `public/political/*.js` da script globali a moduli ES dentro
  `src/political/`, con lo stesso processo meccanico descritto nell'analisi
  architetturale (ogni `function` → `export function`, `window.X` → `import`).
- Sostituire l'iframe con un vero switch di vista in-page (stesso DOM,
  stesso bundle), eliminando il doppio caricamento di risorse (Chart.js,
  TomSelect, Sortable, i18n).
- Unificare il client tRPC (`localFetch` di Political + `trpcBatch` di
  Diplomacy) in un unico `shared/trpcClient.js`, con **una sola** fetch di
  `country.getAllCountries` condivisa tra le due viste.
- Unificare tema, toast, cache localStorage.

### Fase 3 — Dati aggiuntivi (come richiesto)
- **Military units**: nuova sezione nel pannello nazione (o nuova tab),
  nuovo modulo `src/military/` che consuma le procedure tRPC pertinenti
  (da individuare/verificare contro l'API WarEra attuale).
- **Più dati sulle nazioni** nel pannello: storico, confronto tra nazioni,
  grafici — riusando `Chart.js` già presente lato Political.

### Fase 4 — Dashboard unificata (Opzione C)
Con Fase 2 completata, aggiungere un layout alternativo che mostra mappa +
pannello politico affiancati in permanenza (non più overlay a tutto
schermo), riusando lo stesso bridge nazione già costruito qui.

### Fase 5 — Caching su server dedicato
Sostituire le chiamate dirette a `api2/api4/api6.warera.io` (sia nel
`runtimeCaching` del service worker sia nei moduli che fanno `fetch`) con
il tuo proxy/cache-service dedicato, mantenendo invariata la firma delle
funzioni (`localFetch`/`trpcBatch`) così da non dover toccare i chiamanti.

---

## ⚠️ Cose da verificare al primo avvio reale

Non avendo potuto testare contro le API live di WarEra in questo ambiente,
verifica in particolare:
- Che `country.getAllCountries` e `map.getMapData` rispondano come atteso
  dagli endpoint hardcoded in `src/diplomacy/config.js`
  (`API_BASE_URL = 'https://api6.warera.io'`).
- Che il Worker Cloudflare usato da Political View
  (`politicalview-proxy...workers.dev`, in `public/political/config.js`)
  sia ancora attivo e accetti richieste dal nuovo dominio Vercel (CORS).
- Il comportamento del pannello nazione su schermi piccoli (è stato
  progettato a larghezza piena sotto i 768px, in `shell.css`).
