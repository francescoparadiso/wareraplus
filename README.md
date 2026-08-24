# WarEra+

Un'unica app costruita attorno alla **mappa strategica** di WarEra, con un
pannello nazione che fa da ponte verso tutto il resto: politica, unità
militari, statistiche nazioni, economia, notiziario e time machine.

Nasce dalla fusione di **Diplomacy View** (mappa) e **Political View**
(elezioni, congresso, partiti) — poi cresciuta ben oltre quei due tool.

---

## 🧭 Come funziona (architettura attuale)

```
                    ┌─────────────────────────────────────┐
                    │            index.html                │
                    │  mappa Diplomacy + barre menù +      │
                    │  ticker + pannello + overlay         │
                    └───────┬──────────────────┬───────────┘
        click su una nazione │                  │ "Approfondimenti"
                             ▼                  ▼
        ┌────────────────────────────┐   ┌──────────────────────────────┐
        │  Pannello laterale nazione  │   │  Overlay a richiesta          │
        │  dati già in memoria,       │   │  (import() dinamico, chunk    │
        │  nessuna nuova fetch        │   │   scaricato alla 1ª apertura) │
        └───────────┬────────────────┘   │  · Political View             │
                    │ "Espandi"           │  · Unità Militari            │
                    └────────────────────►│  · Statistiche nazioni       │
                                          │  · Ottimizzatore industriale │
                                          │  · News                      │
                                          │  · Guida "Come si usa"       │
                                          └──────────────────────────────┘
```

Accanto a questo: **Time machine** (seconda mappa MapLibre dedicata,
ownership storica delle regioni su slider), **ticker** delle notizie in cima
alla mappa, **Preferiti**, **PWA installabile** e un **server di cache** su
VPS che polla le API WarEra una volta per tutti.

### I tool di partenza

**Diplomacy View** — già scritta a moduli ES con Vite, portata in
`src/diplomacy/` **quasi 1:1** e diventata la vista principale. Le aggiunte
WarEra+ innestate sopra sono marcate col commento `WarEra+` (vedi sotto).

**Political View** — era ~300 KB di script-tag globali dentro un iframe. Oggi
è un vero modulo ES in `src/political/`, montato in-page dentro
`#wp-political-root` quando l'utente espande il pannello nazione — niente più
iframe. `initPoliticalView(countryId, options)` riceve la nazione come
parametro esplicito (non più `?country=<id>` letto da un iframe separato).

**Nota storica (v1)**: la prima versione copiava Political View **invariata**
in `public/political/` e la caricava in un `<iframe>`, deliberatamente, per
azzerare il rischio di bug nella conversione a moduli ES senza poterla testare
dal vivo. Quella v1 è stata verificata in produzione, poi la Fase 2 ha
eseguito la fusione vera (vedi Roadmap). `public/political/` **esiste ancora
nel repo**, invariata, come riferimento/rollback fisico — non è più raggiunta
da nessun path attivo.

**WarEra Eco Optimizer di ArgusIA** — terzo tool, di terzi: bot Discord
portato a moduli ES in `src/eco/` come "Ottimizzatore industriale", stessa
logica (Competenze / Posizione / Lavoratori) più una sezione Assunzioni nuova
e una veste grafica al posto degli embed Discord. **L'attribuzione ad ArgusIA
in cima alla vista non va rimossa.**

### Modifiche al codice Diplomacy esistente

All'inizio le aggiunte erano solo due. Oggi non più: parecchi moduli portano
innesti WarEra+ (`main.js`, `map.js`, `ui.js`, `config.js`, `utils.js`,
`nationTooltip.js`, `labels.js`, `battleMarkers.js`…) più una decina di file
nuovi nella stessa cartella. Sono tutti marcati con un commento `WarEra+`.

Le due aggiunte storiche restano il modello: **additive, con fallback**.

1. **`src/diplomacy/main.js`** — una riga in fondo a `refreshData()` che spara
   `wareraplus:diplomacy-ready` quando i dati sono pronti.
2. **`src/diplomacy/nationTooltip.js`** — il bottone "View Political
   Situation" prova ad aprire l'overlay in-app; se il modulo non è disponibile
   ricade sul comportamento originale (link `target="_blank"`).

### Nota su un file morto preesistente

`src/diplomacy/blocs.js` importa `EXTERNAL_BLOCS_URL`/`HARDCODED_BLOCS` da
`config.js`, ma quel file non li esporta. **Questo gap esiste già nel progetto
originale**: `blocs.js` non è mai importato attivamente da nessuno (l'unico
`import` in `main.js` è commentato), quindi non causa errori a runtime. Se in
futuro vuoi riattivare quella funzionalità, va prima sistemato `config.js`.

---

## 📁 Struttura del progetto

L'albero commentato file per file sta in **`CLAUDE.md`** — qui solo la mappa
a colpo d'occhio.

```
wareraPlus/
├── index.html                  ← shell (markup Diplomacy + pannello + overlay)
├── vite.config.js              ← build + PWA (manifest, service worker, caching)
├── vercel.json · package.json
├── server/
│   └── warera-cache-server.js  ← cache server su VPS (Node + pm2), deploy MANUALE
├── public/
│   ├── icons/                  ← icone PWA
│   └── political/              ← Political View ORIGINALE, invariata (legacy/rollback)
└── src/
    ├── main.js                 ← entry point, deep-link ?country= e ?tm=
    ├── diplomacy/              ← mappa + viste mappa + temi + cacheClient
    ├── political/              ← Political View a moduli ES (ATTIVA)
    ├── mu/                     ← Esplora Unità Militari
    ├── nations/                ← Statistiche nazioni
    ├── eco/                    ← Ottimizzatore industriale (port del bot di ArgusIA)
    ├── guide/                  ← Guida "Come si usa" (solo testo, zero fetch)
    ├── panel/                  ← pannello laterale nazione + riepiloghi vista
    ├── app/                    ← overlay, barre menù, ticker+News, time machine,
    │                              preferiti, sync tema/lingua
    ├── shared/                 ← trpcClient, i18n, particelle, loading, analytics…
    └── styles/                 ← diplomacy · shell · political (scopata) · per-vista
```

---

## 🚀 Setup locale

```bash
cd wareraPlus
npm install
npm run dev
```

Apri `http://localhost:5173`. Il service worker è attivo anche in dev
(`devOptions.enabled: true` in `vite.config.js`) così puoi testare subito il
comportamento offline/PWA senza fare una build.

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
   endpoint pubblici WarEra (`api2/api4/api6.warera.io`), dal Worker
   Cloudflare (che nasconde la sua API key lato server) e dal server di cache
   su VPS.

⚠️ Il push su main **deploya solo il client**. Il server di cache
(`server/warera-cache-server.js`) va rideployato a mano — vedi
`server/README.md`.

## 📲 Installabilità (PWA)

L'app è installabile su desktop e mobile (`display: 'standalone'` nel
manifest). Il service worker (via `vite-plugin-pwa`, Workbox sotto il cofano)
applica queste strategie di cache:

| Risorsa | Strategia | Perché |
|---|---|---|
| Chiamate tRPC WarEra (`api2/4/6.warera.io`) | Network-first, 10 min TTL | Dati di gioco freschi quando c'è rete, utilizzabili offline con l'ultima risposta nota altrimenti |
| Bandiere/immagini (`app.warera.io`) | Cache-first, 30 giorni | Cambiano raramente |
| CSV esterni (NAP, Sphere of Influence) | Stale-while-revalidate | Bilancia freschezza e velocità |
| Google Fonts, MapLibre CDN | Cache-first | Asset statici versionati |
| Bundle app (JS/CSS/HTML) | Precache completo | App utilizzabile offline dopo il primo caricamento |

---

## 🗺️ Roadmap

### Fase 2 — Fusione vera a modulo unico ✅ completata
Political View convertita da script globali (iframe) a moduli ES in-page in 10
stage incrementali (Stage 0-9), ognuno verificato dal vivo contro le API reali
prima di procedere:

- ✅ `public/political/*.js` convertiti a moduli ES in `src/political/`
  (`function` → `export function`, `window.X` → `import`/setter espliciti dove
  serviva per lo stato riassegnato cross-file).
- ✅ Iframe sostituito con switch di vista in-page (`#wp-political-root`, via
  `import()` dinamico da `initPoliticalView()` — bundle code-split, scaricato
  solo alla prima apertura reale). Chart.js/TomSelect/Sortable/D3 ora import
  npm invece di CDN duplicati.
- ✅ Client tRPC unificato in `src/shared/trpcClient.js` (`trpcBatchManual`
  stile Diplomacy + `trpcCall` stile Political, come modalità distinte
  deliberatamente non forzate a un'unica policy). Cache `localStorage` con
  namespace (`we_pol_*`).
- ✅ Tema unificato (chiamata diretta a `applyTheme()`, niente più
  `contentWindow`); la **lingua** è arrivata dopo, con `src/app/langSync.js`
  (era un bug reale: Political restava in inglese dopo un cambio lingua).
- ✅ **Fetch `country.getAllCountries` condivisa**: `src/shared/countries.js` —
  Political legge `state.nazioniGlobal` di Diplomacy invece di rifare la stessa
  fetch via Worker. Verificato dal vivo: zero chiamate aggiuntive.
- ⚠️ **Non fatto di proposito**: toast non unificato — Political usa ancora
  `alert()`/`setStatus()` invece di `showToast` di Diplomacy, cambio di UX
  visibile da valutare separatamente.

`public/political/` **non è stato cancellato** — resta come riferimento/
rollback fisico, non più raggiunto da alcun path attivo.

### Fase 3 — Dati aggiuntivi ✅ completata

- ✅ **Esplora Unità Militari** (`src/mu/`, voce "Approfondimenti → Unità
  Militari"). Vista a sé in overlay, non sezione del pannello nazione: le
  unità sono ~1400 e la cosa più utile è cercarle e confrontarle fra nazioni
  diverse, non leggerle una nazione alla volta.

  Cosa ha detto la verifica dal vivo contro le API reali, prima di scrivere la
  UI (e cosa ne è cambiato rispetto al piano iniziale):

  | Assunzione del piano | Verifica |
  |---|---|
  | paginazione da confermare | cursore, come `battle.getBattles` (`{items, nextCursor}`) — 1379 unità, 14 pagine da 100 |
  | `mu.getById` per il dettaglio | restituisce **esattamente** l'item della lista: l'unico campo in più rispetto alla directory proiettata sono i membri |
  | `ranking.getRanking` per le classifiche | **non serve**: ogni unità porta già le proprie `rankings` (i sei tipi mu*, con `value`/`rank`/`tier`) — zero chiamate |
  | membri con nome/avatar | `members` è un array di soli userId → un batch `user.getUserLite` (max 25 membri visti) |
  | livello/danni mensili dell'unità | `leveling.level` è 1 e `leveling.monthlyDamages` è 0 su **tutte** e 1379: campi che il gioco oggi non alimenta |

  Divisione server/client: la **directory** è server-side (`pollMuDirectory`,
  ogni 30 min, endpoint `/mu-directory`, proiezione a 557 KB → ~140 KB gzip
  contro i 2,0 MB grezzi), il **dettaglio dei membri** è client-side on-demand.
  Se il server di cache non risponde, il client rifà lui la paginazione
  (~4,5 s misurati).

  L'elenco è una **tabella**, non una griglia di card (richiesta esplicita: con
  tre colonne di card si perdevano i dettagli). Ogni riga porta nome, nazione,
  nazionalità prevalente dei membri, numero membri e tutte e sei le classifiche
  con la propria posizione; intestazioni cliccabili per ordinare. Lo **sfondo
  della riga è tinto secondo il tier** (bronze → master) della colonna su cui
  si sta ordinando.

  **Composizione e nazionalità "de facto"**: la colonna "Composizione" elenca
  in numeri quanti membri vengono da ogni nazione (`12 🇱🇹 · 8 🇩🇪 · +5`, tre
  nazionalità su desktop e due su mobile; il tooltip ha l'elenco per esteso).
  Quando la nazionalità prevalente è diversa da quella di registrazione la
  cella prende il marchio "de facto" — tratteggiato se è maggioranza solo
  relativa. Il conteggio lo fa il server (`user.getUserLite` è l'unica fonte:
  una chiamata per utente, ~4,3 KB — risolvere tutti i 16k membri ad ogni giro
  sarebbe ~65 MB ogni 30 min, quindi c'è una mappa persistente
  `userId → nazione` riempita al ritmo di 2000 per giro e rinfrescata ogni 14
  giorni). Nella scheda della singola unità la composizione è calcolata dal
  vivo sui membri appena scaricati, ed è completa. Misurato sulle prime 25 per
  danni settimanali: **6 su 25 sono de facto di un'altra nazione** (es. "Only
  Mercs", registrata Guyana, 25 membri su 25 del Mali).

  **Stile di gioco (guerra / economia / ibridi)**: quanti membri giocano di
  combattimento e quanti di impresa, letto da dove hanno messo i punti
  abilità. Visibile in quattro posti: colonna "Guerra / Eco" nell'elenco,
  sezione dedicata nella scheda dell'unità, pannello nazione (lì sui
  *cittadini tesserati in una unità militare*, ed etichettato come tale:
  WarEra non espone l'elenco dei cittadini di un paese, quindi è un campione
  sbilanciato verso la guerra) e la vista mappa "Guerra vs Eco".

  Il metodo è documentato in `src/mu/playstyle.js`; le tre cose che lo rendono
  affidabile: contano solo i `level` delle skill (non `value`/`total`, che
  includono armi, equipaggiamento e basi che hanno tutti — `criticalDamages`
  vale 100 anche a livello 0), un livello *n* costa `n(n+1)/2` punti
  (verificato contro `spentSkillPoints` su 900 utenti, 900 su 900), e le soglie
  0,3 / 0,7 vengono dalla distribuzione reale, che è bimodale: 682 su 900
  stanno sopra 0,8 o sotto 0,2. Controprova su misure indipendenti: sopra 0,7
  i danni mediani sono 47,3M contro 20,1M, sotto 0,3 la ricchezza mediana è
  40.070 contro 25.560.

  Integrata anche nei Preferiti (terzo tipo di pin) e nella ricerca globale
  della barra menù (gruppo "Unità militari").

- ✅ **Più dati sulle nazioni** (`src/nations/`, "Statistiche nazioni"):
  panoramica, confronto 1 vs 2, grafici e scheda nazione. I grafici sono SVG
  scritto a mano (`charts.js`) invece di Chart.js come previsto in origine —
  la vista non carica librerie. Le nazioni arrivano da `state.nazioniGlobal`
  (zero fetch), i cittadini dal cache-server (`/country-citizens`), con
  fallback diretto limitato a 150 utenti per nazione, dichiarato in chiaro
  nell'interfaccia.

### Fase 4 — Dashboard unificata (Opzione C) — aperta
Layout alternativo con mappa + pannello politico affiancati in permanenza
(non più overlay a tutto schermo), riusando lo stesso bridge nazione già
costruito qui. **È l'unica fase ancora da fare.**

### Fase 5 — Caching su server dedicato ✅ di fatto realizzata
`server/warera-cache-server.js` gira su VPS (nginx + pm2) e polla le API
WarEra una volta per tutti, riducendo i 429. Differenza rispetto al piano
originale: **affianca** gli endpoint diretti invece di sostituirli tutti —
`src/diplomacy/cacheClient.js` ha per ogni funzione un fallback diretto, così
il server è un'ottimizzazione e mai un nuovo punto di fallimento.

Endpoint principali: `/mu-directory`, `/mu-playstyle-by-country`,
`/mu-playstyle-history`, `/country-citizens`, `/daily-damage`, `/ticker`,
`/region-history/{at,range,events,contested,war-intensity}`, `/alliances`,
`/battles`, `/elections`, `/parties`, `/users-lite`, `/credit-profiles`,
`/health`.

---

## ✨ Cosa c'è oltre ai tool di partenza

Tutto quanto segue è nuovo di WarEra+ (dettagli e file in `CLAUDE.md`):

- **Pannello nazione** con riepilogo per ogni vista mappa, ridimensionabile,
  grafico emiciclo nativo, linguetta "Vedi dettagli" su mobile.
- **Viste mappa aggiuntive**: regioni contese, storico bellico, guerra vs eco,
  trend dello stile di gioco — più i bordi in stile mappa di gioco
  (`borderStyle.js`) e i temi ambientali (rotte marittime animate, "mappa
  antica" sul tema chiaro, flotta illustrata su quello scuro, tooltip navi).
- **News**: ticker in cima alla mappa (battaglie, elezioni, nuove guerre,
  sworn enemy, popolazione, tesoro, con tetto per categoria) e vista "News"
  che mostra lo stesso materiale completo e fermo, senza fetch aggiuntive.
- **Time machine**: ownership storica delle regioni su slider, con una seconda
  mappa MapLibre alleggerita (3 layer contro la dozzina della principale) e
  deep-link `?tm=<epoch ms>`. Scope volutamente ridotto a ownership + nome +
  bandiera: popolazione/ricchezza storiche non sono mai state salvate, mostrare
  quelle di oggi sarebbe fuorviante.
- **Barre menù** desktop (ricerca ⌘K, Preferiti) e mobile (drawer),
  **Preferiti** su nazioni/alleanze/unità, **Guida "Come si usa"**.
- **i18n a 9 lingue** (EN/IT/ES/DE/FR/NL/SV/PT/AR) in tutte le viste, con
  ritraduzione a overlay già aperto.
- **PWA**, analytics (Vercel + Umami), schermata di attesa comune e
  `lazyModule.js` per gestire i chunk spariti dopo un deploy.

---

## ⚠️ Cose da verificare se qualcosa non torna

- Che `country.getAllCountries` e `map.getMapData` rispondano come atteso
  dagli endpoint in `src/diplomacy/config.js`
  (`API_BASE_URL = 'https://api6.warera.io'`).
- Che il Worker Cloudflare (`politicalview-proxy...workers.dev`) sia attivo e
  accetti richieste dal dominio Vercel attuale (CORS).
- Che il server di cache risponda:
  `curl https://warera-oracle.duckdns.org/warera-cache/health`. Se non
  risponde, tutto deve degradare, non rompersi — l'elenco di cosa degrada e
  come è in fondo a `CLAUDE.md`.
- Il comportamento del pannello nazione su schermi piccoli (progettato a
  larghezza piena sotto i 768px, in `shell.css`).
