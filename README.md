# WarEra+

Un'unica app che unisce **Diplomacy View** (mappa strategica) e **Political View**
(elezioni, congresso, partiti) di WarEra, con la mappa come visualizzazione
principale e un pannello nazione che fa da ponte tra le due.

---

## 🧭 Come funziona (architettura v2, dopo la Fase 2)

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
                    │  Overlay Political View         │
                    │  (in-page, #wp-political-root,  │
                    │   src/political/, import()      │
                    │   dinamico — code-split)         │
                    └─────────────────────────────┘
```

**Political View** (congress.js, senate.js, presidential.js, party.js,
i18n.js…) è un vero modulo ES in `src/political/`, montato in-page dentro
`#wp-political-root` quando l'utente espande il pannello nazione — niente
più iframe. `initPoliticalView(countryId, options)` riceve la nazione come
parametro esplicito (non più `?country=<id>` letto da un iframe separato).

**Nota storica (v1)**: la prima versione copiava Political View **invariata**
dentro `public/political/` e la caricava in un `<iframe>`, deliberatamente,
per azzerare il rischio di bug nella conversione a moduli ES senza poterla
testare dal vivo. Quella v1 è stata verificata in produzione, poi la Fase 2
ha eseguito la fusione vera pianificata fin dall'inizio (vedi Roadmap sotto
per il resoconto completo di cosa è stato convertito e come). `public/political/`
**esiste ancora nel repo**, invariata, come riferimento/rollback fisico — non
è più raggiunta da nessun path attivo dell'app.

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
│       ├── index.html                          (legacy, non più caricata
│       ├── congress.js, senate.js, ...           a runtime — vedi src/political/)
│       └── style.css
└── src/
    ├── main.js                 ← entry point, orchestrazione
    ├── diplomacy/               ← Diplomacy View, quasi invariato (2 righe aggiunte)
    │   ├── main.js, map.js, ui.js, state.js, config.js, ...
    ├── political/               ← NUOVO (Fase 2) — Political View a moduli ES, ATTIVA
    │   ├── main.js, config.js, api.js, ui.js, congress.js, senate.js, ...
    ├── panel/
    │   └── countryPanel.js     ← NUOVO — pannello laterale nazione
    ├── app/
    │   └── politicalOverlay.js ← NUOVO — apre Political in-page (import() dinamico)
    ├── shared/
    │   └── trpcClient.js       ← NUOVO (Fase 2) — client tRPC unificato
    └── styles/
        ├── diplomacy.css       ← CSS Diplomacy estratto (era inline nell'HTML originale)
        ├── shell.css           ← NUOVO — stile pannello/overlay (namespace `wp-*`)
        └── political.css       ← NUOVO (Fase 2) — da public/political/style.css, scopato
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

### Fase 2 — Fusione vera a modulo unico ✅ completata
Political View è stata convertita da script globali (iframe) a moduli ES
in-page in 10 stage incrementali (Stage 0-9), ognuno verificato dal vivo
contro le API reali prima di procedere. Riepilogo di cosa è stato fatto e
cosa no rispetto al piano originale:

- ✅ `public/political/*.js` convertiti a moduli ES in `src/political/`
  (stesso processo meccanico: `function` → `export function`, `window.X` →
  `import`/setter espliciti dove necessario per lo stato riassegnato
  cross-file).
- ✅ Iframe sostituito con switch di vista in-page (`#wp-political-root`,
  montato via `import()` dinamico da `src/political/main.js:
  initPoliticalView()` — bundle Political code-split, scaricato solo alla
  prima apertura reale, non più al boot dell'app). Chart.js/TomSelect/
  Sortable/D3 ora import npm invece di CDN duplicati.
- ✅ Client tRPC unificato in `src/shared/trpcClient.js` (`trpcBatchManual`
  stile Diplomacy + `trpcCall` stile Political, come modalità distinte
  deliberatamente non forzate a un'unica policy — vedi CLAUDE.md). Cache
  `localStorage` con namespace (`we_pol_*`).
- ✅ Tema unificato (chiamata diretta a `applyTheme()`, niente più
  `contentWindow`).
- ✅ **Fetch `country.getAllCountries` condivisa** (follow-up, fatto su
  richiesta dopo il cutover): `src/shared/countries.js` — Political legge
  `state.nazioniGlobal` di Diplomacy invece di rifare la stessa fetch via
  Worker. Verificato dal vivo: apertura di Political con Diplomacy già
  pronta → zero chiamate `country.getAllCountries` aggiuntive.
- ⚠️ **Non fatto di proposito**: toast non unificato — Political usa ancora
  `alert()`/`setStatus()` inline invece di `showToast` di Diplomacy, deciso
  come cambio di UX visibile da valutare separatamente, a basso rischio, non
  bundlato nel cutover.

`public/political/` (i file originali) **non è stato cancellato** — resta
nel repo come riferimento/rollback fisico, non più raggiunto da alcun path
attivo.

### Fase 3 — Dati aggiuntivi

- ✅ **Esplora Unità Militari** (`src/mu/`, voce "Approfondimenti → Unità
  Militari"). Realizzata come vista a sé in overlay, non come sezione del
  pannello nazione: le unità sono ~1400 e la cosa più utile su di loro è
  cercarle e confrontarle fra nazioni diverse, non leggerle una nazione
  alla volta.

  Cosa ha detto la verifica dal vivo contro le API reali, prima di
  scrivere la UI (e cosa ne è cambiato rispetto al piano iniziale):

  | Assunzione del piano | Verifica |
  |---|---|
  | paginazione da confermare | cursore, come `battle.getBattles` (`{items, nextCursor}`) — 1379 unità, 14 pagine da 100 |
  | `mu.getById` per il dettaglio | restituisce **esattamente** l'item della lista: l'unico campo in più rispetto alla directory proiettata sono i membri |
  | `ranking.getRanking` per le classifiche | **non serve**: ogni unità porta già le proprie `rankings` (i sei tipi mu*, con `value`/`rank`/`tier`) — le classifiche si ordinano dalla directory, zero chiamate |
  | membri con nome/avatar | `members` è un array di soli userId → un batch `user.getUserLite` (max 25 membri visti) |
  | livello/danni mensili dell'unità | `leveling.level` è 1 e `leveling.monthlyDamages` è 0 su **tutte** e 1379: campi che il gioco oggi non alimenta, tenuti in cache ma non mostrati |

  Divisione server/client, come per Alleanze vs Partiti: la **directory**
  è server-side (`pollMuDirectory`, ogni 30 min, endpoint `/mu-directory`,
  proiezione a 557 KB → ~140 KB gzip contro i 2,0 MB grezzi), il
  **dettaglio dei membri** è client-side on-demand (cambia di continuo, e
  si apre solo l'unità che l'utente guarda davvero). Se il server di cache
  non risponde, il client rifà lui la paginazione (~4,5 s misurati).

  L'elenco è una **tabella**, non una griglia di card (richiesta esplicita:
  con tre colonne di card si perdevano i dettagli). Ogni riga porta nome,
  nazione, nazionalità prevalente dei membri, numero membri e tutte e sei
  le classifiche con la propria posizione; le intestazioni sono cliccabili
  per ordinare. Lo **sfondo della riga è tinto secondo il tier** (bronze →
  master) della colonna su cui si sta ordinando, con una barretta piena a
  sinistra.

  **Composizione e nazionalità "de facto"**: la colonna "Composizione"
  elenca in numeri quanti membri vengono da ogni nazione (`12 🇱🇹 · 8 🇩🇪 ·
  +5`, tre nazionalità su desktop e due su mobile, il resto nel `+N`; il
  tooltip ha l'elenco per esteso). Quando la nazionalità prevalente è
  diversa da quella di registrazione la cella prende il marchio "de facto"
  — tratteggiato se è maggioranza solo relativa. Ordinando per quella
  colonna vengono prima le unità de facto straniere, dalle più numerose.
  Il conteggio per nazione dei membri lo fa il server (`user.getUserLite` è l'unica fonte: una chiamata per
  utente, ~4,3 KB — risolvere tutti i 16k membri ad ogni giro sarebbe
  ~65 MB ogni 30 min, quindi c'è una mappa persistente `userId → nazione`
  riempita al ritmo di 2000 per giro e rinfrescata ogni 14 giorni). Nella
  scheda della singola unità la composizione è invece calcolata dal vivo
  dai membri appena scaricati, ed è completa. Misurato sulle prime 25 per
  danni settimanali: **6 su 25 sono de facto di un'altra nazione** (es.
  "Only Mercs", registrata Guyana, 25 membri su 25 del Mali).

  **Stile di gioco (guerra / economia / ibridi)**: quanti membri di
  un'unità giocano di combattimento e quanti di impresa, letto da dove
  hanno messo i punti abilità. Visibile in tre posti: colonna
  "Guerra / Eco" nell'elenco, sezione dedicata nella scheda dell'unità
  (calcolata dal vivo sui membri appena scaricati, quindi completa), e
  pannello nazione — lì sui *cittadini tesserati in una unità militare*,
  ed etichettato come tale: WarEra non espone l'elenco dei cittadini di un
  paese, quindi è un campione, per giunta sbilanciato verso la guerra.

  Il metodo è documentato in `src/mu/playstyle.js`; le tre cose che lo
  rendono affidabile: contano solo i `level` delle skill (non `value` /
  `total`, che includono armi, equipaggiamento e basi che hanno tutti —
  `criticalDamages` vale 100 anche a livello 0), un livello *n* costa
  `n(n+1)/2` punti (verificato contro `spentSkillPoints` su 900 utenti,
  900 su 900), e le soglie 0,3 / 0,7 vengono dalla distribuzione reale,
  che è bimodale: 682 su 900 stanno sopra 0,8 o sotto 0,2. Controprova su
  misure indipendenti: sopra 0,7 i danni mediani sono 47,3M contro 20,1M,
  sotto 0,3 la ricchezza mediana è 40.070 contro 25.560.

  Integrata anche nei Preferiti (terzo tipo di pin) e nella ricerca
  globale della barra menù (gruppo "Unità militari").
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
