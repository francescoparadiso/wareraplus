# STRUTTURA.md — WarEra+

L'albero del progetto commentato file per file. Sta qui e non in
`CLAUDE.md` perché quello viene caricato per intero all'inizio di ogni
sessione di Claude Code: 850 righe di albero erano più di metà del file.
Per la mappa a colpo d'occhio vedi `README.md`; per regole, flussi e
trappole `CLAUDE.md`.

Quando aggiungi o sposti un modulo, aggiorna la sua riga **qui**.

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
│   ├── moneyTransfers.js    ← NUOVO — archivio dei finanziamenti fra nazioni
│   │                              (bonifici da tesoro a tesoro), retention 90 gg.
│   │                              ⚠️ NIENTE bootstrap e non è una dimenticanza:
│   │                              l'API tiene una finestra scorrevole di ~3
│   │                              giorni (misurato: 104 righe / ~70 ore, poi il
│   │                              cursore finisce), quindi i 90 giorni si
│   │                              ACCUMULANO dal primo avvio e NON si recuperano
│   │                              a ritroso. Endpoint: /money-transfers, che
│   │                              espone `coverageFrom` — da quando in qua
│   │                              l'archivio guardava.
│   ├── damageTimeline.js       ← NUOVO — danno ORA PER ORA per nazione + quanti
│   │                              giocatori erano sotto pillola in quell'ora.
│   │                              Zero fetch proprie: campiona la cache `countries`
│   │                              una volta all'ora alle :12 (il gioco ricalcola le
│   │                              classifiche verso le hh:01: prima si campionava alle
│   │                              :02 e il danno finiva sull'ora DOPO, e la mezz'ora
│   │                              dava denti di sega — lo storico si riallinea in
│   │                              lettura, vedi `lag` delle epoche) e legge `buffs` dentro le
│   │                              risposte getUserLite che il giro cittadini scarica
│   │                              già. ⚠️ le due metà si comportano in modo OPPOSTO —
│   │                              il danno ACCUMULA dal primo avvio (è la differenza
│   │                              fra due letture del cumulato settimanale, a ritroso
│   │                              non esiste), le pillole si RICOSTRUISCONO indietro
│   │                              di 23,5 ore da `buffEndAt`/`debuffEndAt`, quindi
│   │                              quella curva c'è già al primo giro.
│   │                              Endpoint: /damage-timeline.
│   ├── citizenMoves.js         ← NUOVO — chi e' arrivato e chi se n'e' andato
│   │                              da una nazione. ZERO fetch: confronta il censimento
│   │                              cittadini (pollCitizens, gia' orario alle :36) con
│   │                              quello dell'ora prima — WarEra dice solo dove uno sta
│   │                              ADESSO, quindi un trasferimento E' per forza una
│   │                              differenza fra due fotografie. ⚠️ accumula e non
│   │                              recupera (come i bonifici): 7 giorni pieni una
│   │                              settimana dopo il deploy, `coverageFrom` lo dichiara.
│   │                              ⚠️ se il censimento nuovo e' molto piu' piccolo del
│   │                              precedente il giro si SCARTA intero: una pagina persa
│   │                              diventerebbe duecento partenze inventate.
│   │                              ⚠️ user.getUsersByCountry elenca solo gli ATTIVI (3
│   │                              giorni offline = fuori elenco, ma ancora cittadino):
│   │                              una sparizione NON è una partenza. /citizen-moves
│   │                              rilegge dal vivo chi compare (getUserLite, cache 1h):
│   │                              stessa nazione = inattivo, contato a parte; e mostra
│   │                              solo livello 10+ (o prestigio).
│   │                              Endpoint: /citizen-moves, e /migration-flows (lo
│   │                              stesso archivio per coppie da → a, tutto il mondo:
│   │                              livello e nazione di adesso da mu-user-countries,
│   │                              zero chiamate; conta SPOSTAMENTI, non persone, se
│   │                              no il saldo di chi fa andata e ritorno sbaglia).
│   ├── priceHistory.js         ← NUOVO — storico dei prezzi: un campione all'ora di
│   │                              itemTrading.getPrices (PUBBLICA, tutte le risorse
│   │                              in una richiesta) ridotto a una candela al giorno
│   │                              per risorsa. Rendite di produzione sa dire cosa
│   │                              conviene ADESSO perché il gioco non pubblica altro;
│   │                              da qui in poi sa anche da dove viene quel prezzo.
│   │                              Endpoint: /price-history?days=N.
│   ├── dayHistory.js           ← NUOVO — la giornata storica: diplomazia (patti,
│   │                              guerre, nemico giurato, tesoro) e battaglie aperte,
│   │                              giorno per giorno. Toglie alla time machine il suo
│   │                              limite dichiarato — mostrava solo l'ownership perché
│   │                              nient'altro era salvato nel tempo, e adesso questi
│   │                              campi lo sono. Zero fetch: lo scatto delle 02:05
│   │                              legge le cache countries/diplomacy/battles.
│   │                              Endpoint: /day-history?day=YYYY-MM-DD.
│   ├── allianceHistory.js      ← NUOVO — le alleanze nel tempo, per la time machine,
│   │                              dal registro eventi del gioco (PUBBLICO, completo dal
│   │                              lancio): BILATERALI dal 1 mag 2025 al 10 giu 2026, poi
│   │                              a BLOCCO. ⚠️ il campo `allies` delle nazioni e' un
│   │                              fossile del 10 giugno. ⚠️ i blocchi si rigiocano
│   │                              ALL'INDIETRO da oggi (chi fonda non riceve "joined"),
│   │                              e i cambi di nome non sono nel registro: si mostra il
│   │                              nome di oggi + "allora si chiamava". Endpoint:
│   │                              /alliance-history.
│   ├── politicalHistory.js     ← NUOVO — storico politico. Elezioni RIASSUNTE e
│   │                              presidenti nel tempo (completi dal lancio: sono già
│   │                              in `elections-by-country`), più tre archivi che
│   │                              ACCUMULANO dal deploy: iscritti ai partiti (un punto
│   │                              quando il numero cambia, da pollParties), cambi di
│   │                              casacca (diff orario utente→partito, stessa guardia
│   │                              anti-giro-monco di citizenMoves) e governi (li passa
│   │                              il radar dei proxy, che government.getByCountryId lo
│   │                              chiede già ogni 6 ore). Zero fetch nuove.
│   │                              Endpoint: /political-history, /political-overview,
│   │                              /presidents.
│   ├── labourHistory.js        ← NUOVO — lavoro e tasse: ogni pagamento di salario
│   │                              del gioco, aggregato per nazione. Archivio CHIUSO
│   │                              (29 lug → 17 set 2026) e senza poll: sono ~550.000
│   │                              pagamenti al giorno, undicimila pagine da sfogliare.
│   │                              ⚠️ DUE serie che non si sommano mai: per nazione del
│   │                              LAVORATORE (salari incassati, tasse trattenute) e per
│   │                              nazione dove OPERA l'azienda (il gettito vero, che è
│   │                              chi incassa davvero). Endpoint: /labour-history.
│   ├── battleTimeline.js       ← NUOVO — l'andamento di ogni battaglia: un campione
│   │                              AL MINUTO (danno e punti del round per lato, una
│   │                              pagina di getBattles per tutte) e il danno PER
│   │                              NAZIONE a ogni tick (classifiche lette solo per le
│   │                              battaglie col tick avanzato, un batch). Serve a
│   │                              vedere QUANDO entra una nazione e se la battaglia si
│   │                              gira lì. ⚠️ ACCUMULA dal deploy (2026-10-07): il gioco
│   │                              non lo tiene da nessuna parte (getLastHits = ultimi 5
│   │                              colpi, roundsHistory = solo i finali). Battaglie vive
│   │                              in memoria, chiuse in cache/battle-timeline/<id>.json.gz,
│   │                              nessuna potatura (~250 MB/anno stimati).
│   │                              Endpoint: /battle-timeline?battleId=.
│   ├── companyCensus.js        ← NUOVO — per risorsa: aziende di proprietari
│   │                              ATTIVI, quante con dipendenti, dipendenti,
│   │                              salari e TASSE SUI SALARI (salari × taxes.income
│   │                              della nazione dove opera l'azienda). Un giro al
│   │                              giorno alle 03:20 italiane: cittadini del censimento
│   │                              → company.getCompanies {userId} → getById → e solo
│   │                              per chi ha dipendenti work.getStatsByCompany
│   │                              (TOKEN-GATED, 31 giorni di salari a ritroso).
│   │                              ⚠️ NON si sfoglia l'elenco di tutte le aziende:
│   │                              sono 160.000+ e l'ordine (`movedUpAt`) NON è
│   │                              l'ultima produzione (~1.000 "mosse" al giorno).
│   │                              ⚠️ Non conta la tassa sul lavoro in proprio né
│   │                              quella di mercato, e la vista lo scrive.
│   │                              Endpoint: /company-census.
│   ├── import/                 ← NUOVO — import UNA TANTUM da un archivio esterno
│   │   ├── bonifici.js            (il dump PostgreSQL di un altro tool della
│   │   ├── ricchezza.js            comunità, passato dal suo autore). Servono solo
│   │   ├── prezzi.js               per i dati che WarEra NON espone a ritroso:
│   │   ├── diplomazia.js           bonifici fra tesori, ricchezza giornaliera dei
│   │   ├── battaglie.js            giocatori, prezzi, diplomazia, battaglie aperte,
│   │   ├── lavoro.js               salari e tasse.
│   │   └── README.md               Vedi il suo README per la procedura e per le due
│   │                               retention allargate (senza, il primo giro di
│   │                               manutenzione pota quello che l'import ha appena
│   │                               scritto).
│   └── README.md               ← deploy a mano (scp + pm2 restart), vedi ⚠️ in fondo
├── wallpaper/                  ← NUOVO — lo sfondo di Wallpaper Engine (Steam Workshop).
│                                  NON contiene il tool: index.html porta la pagina sul
│                                  sito con ?wallpaper=1 (src/app/wallpaperMode.js), le
│                                  proprietà di project.json nell'URL e la chiave nel
│                                  frammento #k=. ⚠️ Il browser di Wallpaper Engine va in
│                                  CRASH su qualunque iframe di altro sito e su ogni
│                                  <select> con antenato fixed/absolute: niente iframe, e
│                                  con ?wallpaper=1 i <select> sono spenti (in linea in
│                                  testa a index.html). Fuori da build e deploy Vercel.
│                                  Prova, debug remoto e pubblicazione nel suo README.
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
    │   │                        (battleMarkers: WarEra+ il marcatore LAMPEGGIA nel
    │   │                        colore del lato che passa avanti nel round in corso —
    │   │                        stesso round, mai al cambio round; CSS in shell.css)
    │   ├── battleFlows.js     ← NUOVO — al clic su una battaglia: frecce dalla
    │   │                        CAPITALE delle prime 5 nazioni per lato (sopra il
    │   │                        5% del lato: con tutte le ≥1% era illeggibile) alla
    │   │                        regione. Spessore ∝ √danno, nessun numero (la quota
    │   │                        la scrive già la heatmap sulla nazione).
    │   │                        Animazione: trattini che scorrono (line-dasharray
    │   │                        ciclata) + onde d'impatto sulla regione. Zero fetch,
    │   │                        legge state.battleHeatmapData.
    │   ├── electionsLive.js   ← NUOVO — vista Elezioni in diretta: a ogni giro (3 min)
    │   │                        dove i voti sono saliti la tinta dell'affluenza passa
    │   │                        al colore nuovo in transizione e la capitale batte
    │   │                        con "+N voti". Il ridisegno finale lo fa lei.
    │   │                        Quando un'elezione si CHIUDE fra due giri: un'onda
    │   │                        sulla nazione nel colore del partito vincitore (lo
    │   │                        stesso stringToColor di Political) col suo nome.
    │   │                        Nomi da /parties?countryId= (/parties-detail pesa
    │   │                        1,1 MB). Si vede solo con la vista Elezioni aperta.
    │   │                        Per rivederla: il riepilogo elenca le "Appena chiuse"
    │   │                        (48 ore, /elections?closed=48) e un clic su una riga
    │   │                        vola sulla nazione e rifà l'onda.
    │   ├── battleReplay.js    ← NUOVO — replay della battaglia aperta: barra con
    │   │                        play/pausa/cursore/velocità sopra la scheda della
    │   │                        battaglia; da /battle-timeline ricostruisce la
    │   │                        classifica per nazione a ogni tick e la mette AL
    │   │                        POSTO di state.battleHeatmapData.nations finché
    │   │                        dura (heatmap, etichette, legenda e frecce la
    │   │                        seguono da sole). Il giro live dei 10 s si ferma
    │   │                        intanto. Solo battaglie registrate dal 2026-10-07.
    │   │                        Sul cursore i SEGNI di sorpassi e ingressi delle
    │   │                        nazioni grosse (analyzeTimeline della scheda), clic =
    │   │                        salto lì.
    │   ├── flowGeometry.js    ← NUOVO — condivisa da tutte le frecce (battaglie,
    │   │                        migrazioni, sfere, time machine): punto di aggancio
    │   │                        di una nazione (capitale se sua, se no etichetta),
    │   │                        archi in Mercatore, brightenColor per le linee.
    │   ├── damagePulse.js     ← NUOVO — in vista Danni: un cuore sulla capitale di
    │   │                        ogni nazione, grande e veloce quanto il danno
    │   │                        dell'ULTIMA ORA completa, alone ambra → rosa con la
    │   │                        quota di attivi pillati. Da /damage-pulse (tutte le
    │   │                        nazioni, un'ora), nessun ripiego.
    │   ├── mapPulses.js       ← NUOVO — tre animazioni di vista, dati GIÀ in pagina:
    │   │                        Produzione = i giacimenti pulsano più in fretta
    │   │                        quanto più sono vicini alla scadenza; Popolazione =
    │   │                        le nazioni respirano in verde/rosso con gli attivi
    │   │                        guadagnati/persi in 24h; Finanziamenti senza nazione
    │   │                        a fuoco = monete che salgono/scendono sulle capitali
    │   │                        col tesoro ±2% in 24h. Popolazione e tesoro sono gli
    │   │                        aggregati del ticker, annunciati con l'evento
    │   │                        `wareraplus:ticker-data`: prima del primo giro del
    │   │                        ticker non c'è niente da disegnare.
    │   ├── sphereLinks.js     ← NUOVO — in vista Sfera: fili potenza → proxy nel
    │   │                        colore della sfera, pieni dal CSV e tratteggiati
    │   │                        dal radar (gli stessi gruppi che tingono la mappa),
    │   │                        con un impulso di luce che corre verso il proxy.
    │   │                        Di partenza SOLO la sfera aperta nel pannello
    │   │                        (state.selectedSphereId): tutte insieme erano ~60
    │   │                        fili. Comandi nel pannello: sfera aperta / tutte /
    │   │                        nessuno, CSV / radar / entrambe (`we_sphere_links`).
    │   ├── bonusView.js       ← NUOVO — vista mappa "Bonus battaglia": si clicca
    │   │                        una battaglia e ogni nazione prende il colore del
    │   │                        bonus PIÙ ALTO dei suoi cittadini lì — blu se le
    │   │                        conviene difendere, rosso attaccare, più pieno
    │   │                        fino al massimo. Passa per la heatmap di sempre
    │   │                        (setBattleHeatmap → onBattleSelected, colori in
    │   │                        battleHeatmap.js: state.battleBonusMap); dettagli
    │   │                        e "il tuo bonus" nel riepilogo del pannello
    │   │                        (viewOverview.js: battleBonusHtml). Sulla mappa
    │   │                        solo le voci della NAZIONE: ordine e QG dell'unità
    │   │                        sono del singolo giocatore. Testi in 9 lingue qui.
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
    │   ├── blocDamageCurves.js ← NUOVO — danno ora per ora + pillati di un
    │   │                        GRUPPO di nazioni: nella scheda di un'alleanza e,
    │   │                        sovrapposti, nel Fazione 1 vs 2 e nel 1 vs 2 di
    │   │                        Statistiche nazioni (nationCompare.js). Il server somma
    │   │                        con /damage-timeline?countryIds=a,b,c e ripete
    │   │                        `countryIds` nella risposta: ⚠️ un server vecchio
    │   │                        ignora il parametro e manda il MONDO, quindi senza
    │   │                        quell'eco si ricade sulle nazioni una per una
    │   │                        (una volta per sessione ciascuna, 6 alla volta).
    │   │                        ⚠️ Visibili SOLO ai GOVERNI P.A.S.T.A. verificati
    │   │                        (Discord + personaggio, /roles/me →
    │   │                        nazione.abilitata E capacita.gestisceNazione non
    │   │                        vuota: presidente, vice, ministri — il cittadino
    │   │                        comune no) + admin: senza token nessuna richiesta
    │   │                        e la sezione non compare. Cancello di interfaccia,
    │   │                        la serie per nazione resta pubblica.
    │   ├── blocStatsI18n.js ← NUOVO — traduzioni (9 lingue) di Statistiche
    │   │                        alleanze: la CHIAVE è il testo inglese, bT('Weekly
    │   │                        damage'), e ciò che manca ricade sull'inglese.
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
    │   ├── travelDistance.js    ← NUOVO — vista mappa "Distanze" (idea dal tool di
    │   │                          nioKi, ni0ki.github.io/warera-distance-map): clic su
    │   │                          una regione → tutte le altre colorate per numero di
    │   │                          confini da attraversare (BFS su `neighbors` delle
    │   │                          geometrie di state.mapDataGlobal, zero fetch), percorso
    │   │                          col mouse, istogramma e giro ottimale fino a 5 casse di
    │   │                          legno (Held-Karp, con un ritorno gratis a casa).
    │   │                          ⚠️ i costi (10 stamina a regione, poi 2 barili) NON
    │   │                          sono in gameConfig: sono della patch 0.26.1, costanti
    │   │                          in testa al file. Testi in travelI18n.js (9 lingue).
    │   │                          "Percorri il giro": un segnalino cammina il percorso
    │   │                          regione per regione, la barra stamina si svuota e le
    │   │                          casse si contano. È a comando, quindi l'interruttore
    │   │                          Animazioni non lo blocca.
    │   ├── migrationFlows.js    ← NUOVO — vista mappa "Migrazioni": saldo dei cambi di
    │   │                          cittadinanza per nazione (rosso perde, verde guadagna,
    │   │                          assoluto o ogni 100 cittadini 10+) e, cliccando una
    │   │                          nazione, frecce curve DALLA CAPITALE verso dove vanno i suoi giocatori
    │   │                          (arancio) e da dove arrivano (azzurro). Una richiesta a
    │   │                          /migration-flows per tutto il mondo, NESSUN ripiego (non
    │   │                          esiste una chiamata WarEra equivalente). Riepilogo in
    │   │                          viewOverview.js, testi in migrationI18n.js (9 lingue).
    │   │                          Cursore GIORNO PER GIORNO (30 gg, /migration-flows?
    │   │                          daily=1): un giorno scelto sostituisce la finestra
    │   │                          per mappa, classifiche e frecce; con una nazione a
    │   │                          fuoco le barre sono il SUO saldo (quando parte un
    │   │                          esodo). Giorni prima di coverageFrom = buco.
    │   │                          Effetto "volo" 3D finto: ombra a terra sotto l'arco +
    │   │                          comete animate (~30 fps, sorgente propria). Ferme con
    │   │                          scheda nascosta, time machine, overlay (mapIdle.js).
    │   │                          ⚠️ NON guarda prefers-reduced-motion: Windows con le
    │   │                          animazioni spente lo dichiara e l'utente non vedeva
    │   │                          nessun movimento.
    │   │                          ⚠️ text-font delle etichette MapLibre: solo font che
    │   │                          fonts.openmaptiles.org ha davvero ('Open Sans Bold').
    │   │                          'Noto Sans Regular' risponde con una pagina HTML e fa
    │   │                          cadere l'INTERA sorgente («Unimplemented type: 4»).
    │   ├── fundingFlows.js      ← NUOVO — vista mappa "Finanziamenti": saldo dei
    │   │                          bonifici fra tesori (oro riceve, viola dà; 7/30/90 gg
    │   │                          o tutto l'archivio, dal 25 apr 2026) e, cliccando una
    │   │                          nazione, archi da chi la finanzia e verso chi finanzia
    │   │                          lei con MONETE che scorrono nel verso del denaro. Con
    │   │                          una nazione a fuoco si colorano solo lei e i partner.
    │   │                          Dati: la stessa fetchMoneyTransfers della scheda
    │   │                          battaglia (src/battles/moneyTransfers.js), conti in
    │   │                          memoria. Testi in fundingI18n.js.
    │   ├── politicsHeatmap.js   ← NUOVO — vista mappa "Elezioni": dove si vota (rosso,
    │   │                          sfumato per AFFLUENZA di adesso = voti / popolazione
    │   │                          attiva, scala fissa 0–100% ponderata a radice)
    │   │                          e dove sono aperte le candidature (oro), da
    │   │                          /elections?open=1 (la rotta dei ticker)
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
    │   ├── (nessun equivalente di embed.js — era dead code nell'originale, non portato)
    │   ├── links.js             ← NUOVO — ponti verso Unità Militari e Statistiche
    │   │                          nazioni: unità + guerra/eco nella scheda giocatore e
    │   │                          nella "Composizione" del partito, da getUserLite che
    │   │                          Political scarica GIÀ (porta `mu` e `skills`)
    │   ├── history.js, world.js ← NUOVO — viste "Storia" (presidenti, affluenza,
    │   │                          iscritti, cambi di casacca, governi) e "Mondo"
    │   │                          (calendario elettorale + confronto fra nazioni)
    │   ├── simUncertainty.js    ← NUOVO — intervallo 80% dei seggi nel simulatore,
    │   │                          dalla volatilità storica della nazione (mediana delle
    │   │                          ultime 5 coppie di congressi). Retrotest su 25
    │   │                          nazioni: copertura 88,8%, larghezza media 4 seggi
    │   └── plusApi.js, plusCharts.js, plusViews.js, plusI18n.js (9 lingue)
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
    │   ├── ranking.js           ← classifiche, ordinate dalla directory (zero fetch)
    │   ├── muCompare.js         ← NUOVO — linguetta "⚔ 1 vs 1": un'unità contro un'altra,
    │   │                          stessa grafica e regole del 1 vs 2 nazioni (versusBarHtml
    │   │                          e classi wp-nat-* di nations.css, importato dal modulo):
    │   │                          sei classifiche, membri, danni e ricchezza per membro, e
    │   │                          come giocano i membri (se il server di cache c'è). Zero
    │   │                          fetch. Bottone "Confronta" nella scheda di un'unità.
    │   │                          Link: ?section=mu&tab=compare&mua=&mub=.
    │   ├── muWealth.js          ← NUOVO — linguetta "Bilancio", l'unica parte CHIUSA
    │   │                          della vista. DUE schermate: ELENCO delle unità con i
    │   │                          loro numeri (zero fetch a WarEra: il server lo calcola
    │   │                          in SQL, quindi "chi sta perdendo" si legge invece di
    │   │                          aprire trenta schede — con ricerca, filtri e colonne
    │   │                          ordinabili) e SCHEDA di una unità, che legge la
    │   │                          ricchezza dal vivo perché le serve il giorno IN CORSO.
    │   │                          Chi comanda UNA sola unità salta l'elenco. Verdetto
    │   │                          guadagna/perde/in pari, barre sulla linea dello zero.
    │   │                          Compare solo a chi COMANDA in gioco un'unità italiana
    │   │                          o de facto italiana ed è entrato con Discord. Chunk a
    │   │                          parte: import() alla prima apertura.
    │   └── wealthApi.js         ← NUOVO — client di /wealth sull'area riservata. Se non
    │                              c'è un token NON parte nessuna richiesta: la vista
    │                              unità è pubblica e si apre migliaia di volte.
    ├── nations/                  ← NUOVO — Statistiche nazioni
    │   ├── main.js              ← initNationsView(container) + openNationDetail(countryId);
    │   │                          tab panoramica / 1 vs 2 / grafici + scheda nazione
    │   ├── api.js               ← nazioni da state.nazioniGlobal (zero fetch) e elenco
    │   │                          cittadini dal cache-server (/country-citizens), con
    │   │                          fallback diretto LIMITATO a 150 utenti se il server manca
    │   ├── metrics.js           ← le metriche in un posto solo (panoramica, 1vs2 e scheda
    │   │                          leggono le stesse definizioni)
    │   ├── charts.js            ← ciambelle/barre in SVG scritto a mano, niente Chart.js
    │   ├── labourSection.js     ← NUOVO — "Lavoro e tasse" nella scheda nazione:
    │   │                          salari incassati dai cittadini, quota guadagnata
    │   │                          fuori casa, tasse trattenute, gettito dello Stato,
    │   │                          chi li paga e per cosa lavorano. ⚠️ trattenute e
    │   │                          gettito NON si sommano: le prime le incassa la
    │   │                          nazione dove opera l'azienda. Archivio chiuso, e la
    │   │                          fascia in cima lo dichiara.
    │   ├── damageCurves.js      ← NUOVO — nella scheda nazione: il danno ORA PER ORA
    │   │                          con sopra, sullo stesso riquadro e su un secondo
    │   │                          asse, la linea dei giocatori PILLATI (item `cocain`,
    │   │                          +60% attacco per 8 ore). Le due serie stanno insieme
    │   │                          apposta: la domanda è se il picco di danno cade dove
    │   │                          cade il picco di pillole. Sotto, la curva del danno
    │   │                          a 14 giorni. Dati da /damage-timeline; se il server
    │   │                          non ce l'ha la sezione non compare.
    │   │                          ⚠️ un'ora senza misura è `d: null` e si disegna come
    │   │                          BUCO (barra assente, linea spezzata), mai come zero.
    │   ├── nationList.js, nationCompare.js, nationDetail.js, i18n.js (9 lingue)
    ├── players/                  ← NUOVO (2026-10-14) — Giocatori: voce di Approfondimenti
    │   │                            e destinazione del clic su un cittadino (Statistiche
    │   │                            nazioni → Cittadini; Ctrl/clic centrale aprono ancora il
    │   │                            profilo sul gioco). Partenza: ricerca, "Sono io" (stessa
    │   │                            chiave `we_my_player` della scheda Ricchezza), visti di
    │   │                            recente, classifiche mondiali (ranking.getRanking, la
    │   │                            ladder intera ~470 KB gz, solo all'apertura, in memoria).
    │   │                            Scheda: numeri con posizione mondiale (getUserLite) e
    │   │                            NELLA SUA NAZIONE (/country-citizens), e cinque schede —
    │   │                            Battaglie (col bottino, poolLoot), Ricchezza
    │   │                            (/player-wealth), Aziende e lavoro, Politica, Abilità ed
    │   │                            equipaggiamento. Confronto 1 vs 1 dalla scheda.
    │   │                            ?section=players&player=ID(&vs=ID).
    │   │                            ⚠️ work.getStatsByUserId (con chiave, via proxy) è la
    │   │                            somma ESATTA di getStatsByCompany sulle SUE aziende:
    │   │                            `wage` = salari che PAGA, non quello che incassa
    │   │                            lavorando per altri (verificato 2026-10-14).
    │   │                            ⚠️ La politica legge /political-history della nazione
    │   │                            di OGGI: la carriera prima di un cambio di cittadinanza
    │   │                            non c'è, e la vista lo scrive.
    │   ├── api.js               ← ⚠️ "le battaglie di un giocatore" NON esistono come
    │   │                          procedura e nessuna transazione porta l'id della
    │   │                          battaglia: si chiede battleLootSummary.getByBattleAndUser
    │   │                          (pubblica, 404 = non c'era) per le in corso + le concluse
    │   │                          degli ultimi N giorni dall'archivio, 25 per batch. 3 giorni
    │   │                          ≈ 7 richieste, "cerca più indietro" fino a 31. Il
    │   │                          riepilogo NON dice lo schieramento: la vista non indovina.
    │   │                          I 404 in console sono i batch dove non ha combattuto.
    │   └── main.js, i18n.js (9 lingue); stile in styles/players.css (wp-ply-*)
    ├── economy/                  ← NUOVO — Economia: UNA voce di Approfondimenti,
    │   │                            TRE schede. Prima erano due voci separate
    │   │                            ("Ottimizzatore industriale" e "Rendite di
    │   │                            produzione") e i prezzi non avevano casa: erano
    │   │                            separate per come sono NATE, non per come si
    │   │                            usano. Le tre domande sono un discorso solo, e
    │   │                            nell'ordine in cui si fanno — quanto vale la
    │   │                            roba, cosa conviene produrre, come sistemo la
    │   │                            MIA azienda.
    │   │                            ⚠️ Per AFFIANCAMENTO, non per fusione:
    │   │                            src/market/* e src/eco/* non sono toccati
    │   │                            dentro. Ogni scheda ha il suo contenitore, ci si
    │   │                            monta la vista di prima con la sua
    │   │                            init*(container), e cambiare scheda NASCONDE
    │   │                            invece di smontare — tornare sulle Rendite
    │   │                            ritrova paga, giorni e riga aperta com'erano.
    │   │                            Restano quindi TRE dizionari (economy/i18n.js,
    │   │                            market/i18n.js, testi interni di eco/main.js) e
    │   │                            TRE fogli di stile: è voluto.
    │   ├── main.js               ← initEconomyView(container, {tab}) +
    │   │                          stopEconomyView(). import() per scheda alla prima
    │   │                          apertura: chi entra per i prezzi non si scarica
    │   │                          anche l'Ottimizzatore. Cambiando scheda ferma il
    │   │                          timer di quella che si lascia e lo riattacca
    │   │                          rientrando (le tre init* sono riapribili).
    │   ├── prices.js             ← NUOVO — la scheda PREZZI, l'unica parte davvero
    │   │                          nuova: elenco di tutte le risorse con prezzo,
    │   │                          denaro/lettera del libro ordini e variazioni
    │   │                          24h/7g/30g, e per ognuna la sua scheda col
    │   │                          grafico. ZERO fetch proprie — prezzi e libro
    │   │                          ordini li chiede a market/api.js (stessa cache,
    │   │                          stesso TTL: aprire questa scheda dopo le Rendite
    │   │                          non ricompra niente), lo storico a /price-history.
    │   ├── candleChart.js        ← NUOVO — le candele (SVG a mano). ⚠️ NON sostituisce
    │   │                          market/priceChart.js: quello disegna le sole
    │   │                          chiusure perché sta in una riga alta 88px, questo
    │   │                          massimo/minimo/corpo perché ha una pagina. Un
    │   │                          giorno senza candela è un BUCO in entrambi.
    │   │                          Disegna anche le serie a un valore al giorno
    │   │                          (mode 'line'): l'esploratore accetta `righe` per
    │   │                          non mostrare apertura/massimo/minimo di una tassa.
    │   ├── production.js         ← NUOVO (2026-10-08) — scheda PRODUZIONE: per
    │   │                          risorsa aziende, dipendenti, salari e tasse sui
    │   │                          salari al giorno, filtro per nazione, e per ogni
    │   │                          risorsa in quali nazioni si produce. Tutto da
    │   │                          /company-census, NESSUN ripiego (servirebbero
    │   │                          ~50.000 chiamate e la chiave): senza server lo dice.
    │   ├── playerWealth.js       ← NUOVO (2026-10-08) — scheda RICCHEZZA: cerchi
    │   │                          un giocatore (search.searchUsers + getUserLite,
    │   │                          pubbliche) e vedi la sua curva giorno per giorno
    │   │                          da /player-wealth, giorni migliori e peggiori,
    │   │                          posizione. "Sono io" salva solo l'id in
    │   │                          localStorage (`we_my_player`). ⚠️ La differenza
    │   │                          fra due giorni è il saldo NETTO, non "spese".
    │   └── i18nPlus.js           ← dizionario (9 lingue) delle due schede nuove
    ├── eco/                      ← NUOVO — Ottimizzatore industriale (port del bot Discord
    │   │                            "WarEra Eco Optimizer" di ArgusIA — attribuzione
    │   │                            obbligatoria in cima alla vista). Dal 2026-09-19
    │   │                            è la TERZA SCHEDA di src/economy/, non più una
    │   │                            voce di menù sua: il codice qui dentro non è
    │   │                            cambiato, cambia solo chi chiama initEcoView().
    │   ├── main.js              ← orchestratore + rendering (era bot.py + embeds.py)
    │   ├── api.js               ← ecoCall via ECO_PROXY_BASE (Worker), dati di gioco
    │   ├── gameData.js, resolve.js, account.js, wage.js
    │   └── skills.js, positioning.js, workers.js, hiring.js  ← logica pura (hiring = nuova)
    ├── market/                   ← NUOVO — Rendite di produzione: la classifica di
    │   │                            mercato... e dal 2026-09-19 la SECONDA SCHEDA di
    │   │                            src/economy/, non più una voce di menù sua (il
    │   │                            codice non è cambiato, cambia chi chiama
    │   │                            initMarketView()). Sotto, la descrizione di
    │   │                            sempre:
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
    │   │                          richieste HTTP. Regioni e tasse: zero fetch. Più una
    │   │                          terza cosa, sola per sessione: lo STORICO dal server
    │   │                          di cache (/price-history), senza fallback — il gioco
    │   │                          non sa dire quanto costava ieri, quindi se il server
    │   │                          non ce l'ha la sezione non compare e basta.
    │   ├── priceChart.js         ← NUOVO — la linea delle chiusure (SVG a mano, come
    │   │                          nations/charts.js) + variazione 7/30 giorni. Un
    │   │                          giorno senza candela è un BUCO: la linea si spezza,
    │   │                          mai uno zero.
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
    │   ├── battleDetail.js       ← scheda di UNA battaglia (a linguette; per le
    │   │                          battaglie in corso anche "Bonus": le nazioni con
    │   │                          un bonus loro, difesa | attacco, più il tuo — da
    │   │                          shared/battleBonus.js): scomposizione per
    │   │                          nazione e per unità militare (danno, quota del
    │   │                          lato, taglia INCASSATA) + elenco dei contratti
    │   │                          mercenari, e in CIMA i FINANZIATORI: le nazioni che
    │   │                          hanno versato nel tesoro dei due belligeranti mentre
    │   │                          la battaglia era aperta (due tabelle, una per
    │   │                          schieramento).
    │   │                          ⚠️ la colonna taglia qui è "incassato",
    │   │                          non "speso": coincidono solo sommando il lato.
    │   ├── moneyTransfers.js ← NUOVO — i bonifici da tesoro a tesoro
    │   │                  (`transaction.getPaginatedTransactions`, tipo
    │   │                  countryMoneyTransfer). Sono POCHI: ~36 al giorno in tutto
    │   │                  il mondo e il cursore si esaurisce in tre pagine, quindi
    │   │                  si scarica UNA lista per sessione e la si filtra in
    │   │                  memoria sulla finestra della singola battaglia — aprire
    │   │                  venti battaglie costa quanto aprirne una. ⚠️ procedura
    │   │                  TOKEN-GATED (401 su api6): passa dal proxy, unica della
    │   │                  sezione a farlo. Lo storico copre ~3 giorni: per una
    │   │                  battaglia più vecchia la vista dice "fuori portata", non
    │   │                  "nessun finanziamento".
    │   ├── battleTimeline.js ← NUOVO — "Andamento della battaglia" nella scheda,
    │   │                  sotto i finanziatori: danno al minuto per lato + punti
    │   │                  del round, i SORPASSI (cambio di segno del danno del
    │   │                  round, con chi ha spinto nei 10 minuti prima e chi era
    │   │                  "appena entrata") e l'ora d'ingresso di ogni nazione
    │   │                  (±2 min: il danno per nazione esce solo al tick). Da
    │   │                  /battle-timeline, nessun fallback: senza server, o per
    │   │                  una battaglia chiusa prima del deploy, non compare.
    │   │                  ⚠️ una battaglia già aperta al primo sguardo ha la prima
    │   │                  lettura come FONDO (`baseAt`): chi c'era non è un
    │   │                  ingresso. Testi in timelineI18n.js (9 lingue).
    │   ├── main.js, battleList.js, warExpenses.js, i18n.js (9 lingue)
    ├── guide/                    ← NUOVO — Guida "Come si usa": SOLO testo statico
    │   ├── main.js                  (zero fetch, zero stato) + i18n.js a 9 lingue.
    │   └── i18n.js                  È la vista più leggera dell'app, deve restarlo.
    ├── private/                  ← NUOVO — Area riservata (login Discord + personaggio
    │   │                            verificato). Parla SOLO con warera-plus-api
    │   │                            (server/plusApi/, processo separato, vedi il suo README).
    │   ├── main.js              ← la vista: profilo a sinistra; a destra PRIMA quello che
    │   │                          ogni cittadino VEDE (la sua nazione), POI quello che si
    │   │                          FA, in due sezioni apribili chiuse di partenza:
    │   │                          "Contratti mercenari" (il tavolo, board.js) e
    │   │                          "Amministrazione" (admin.js). Una sezione chiusa non
    │   │                          carica niente; Contratti mostra comunque quante richieste
    │   │                          aspettano la firma di chi guarda.
    │   ├── nazione.js           ← NUOVO — "La mia nazione", cruscotto a TUTTA LARGHEZZA
    │   │                          (griglia a 12 colonne, span per scheda, una colonna sotto
    │   │                          i 1100px): tesoro/classifiche/relazioni/governo, ultimi 14
    │   │                          giorni (tesoro orario dal ticker, giocatori attivi, danno
    │   │                          al giorno), allarmi dai confini, elezioni, la nostra
    │   │                          forza contro ogni nemico (pillole + un colpo a testa, tutti
    │   │                          letti dal vivo), cittadini (attività, stile, livelli),
    │   │                          nemici, battaglie + 48 ore + bonifici 14 gg, guerra 30 gg
    │   │                          (vinte/perse, avversari, spese), migliori giocatori, unità
    │   │                          (anche "di fatto"), classifiche, regioni e confini.
    │   │                          Grafici in SVG a mano. Dati da /nazione e /nazione/nemici:
    │   │                          tutto da cache del cache-server, nessuna chiamata nuova.
    │   ├── i18nNazione.js       ← dizionario (9 lingue) di nazione.js e delle sezioni
    │   ├── board.js, battles.js ← contratti mercenari (tavolo, battaglie, lista permessi)
    │   └── admin.js, selettori.js, api.js, i18n.js
    ├── panel/                   ← NUOVO
    │   ├── countryPanel.js      ← pannello laterale nazione (+ riepilogo sfere e viste)
    │   ├── nationWatch.js       ← NUOVO — il blocco "sotto osservazione" in CIMA al
    │   │                          pannello: proxy (CSV + rilevati dal radar), guerra/eco
    │   │                          col travaso a 24h, e chi e' arrivato/partito in 7
    │   │                          giorni. Richiesta dell'utente: e' un problema di
    │   │                          ORDINE — il pannello apriva col grafico del
    │   │                          parlamento, che cambia alle elezioni, mentre la roba
    │   │                          che cambia ogni giorno stava sotto o non c'era.
    │   │                          ⚠️ la sezione movimenti NON ha ripiego (/citizen-moves,
    │   │                          nessuna chiamata diretta equivalente esiste): senza
    │   │                          server non compare, come /damage-timeline.
    │   │                          ⚠️ la sezione sfera ha un contenitore suo
    │   │                          (#wp-panel-sphere-watch) perche' il radar arriva dopo:
    │   │                          rigenerare tutto il blocco staccherebbe dal documento
    │   │                          il nodo che renderPlaystyle si e' gia' preso.
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
    │   ├── economyOverlay.js   ← apre Economia (prezzi + rendite + ottimizzatore) e
    │   │                         alla chiusura ferma i timer di TUTTE le schede
    │   │                         aperte, non solo di quella in vista. Prende il
    │   │                         posto di ecoOverlay.js e marketOverlay.js, che
    │   │                         non esistono più.
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
    │   │                         Pill unica in tre parti: visite | ● online (sito +
    │   │                         sfondi Wallpaper Engine accesi, li somma il server) |
    │   │                         🖥 iscritti su Wallpaper Engine (letti da Steam ogni
    │   │                         ora, link al Workshop). Gli sfondi battono con
    │   │                         `source=wallpaper`: entrano negli online, MAI nelle
    │   │                         visite. Dentro lo sfondo la pill è in sola lettura.
    │   ├── wallpaperMode.js    ← NUOVO — modalità sfondo (?wallpaper=1, flag in
    │   │                         shared/wallpaper.js): niente contatori né analytics,
    │   │                         niente barra menù e crediti (wallpaper.css), riepiloghi
    │   │                         delle viste dietro la linguetta anche su desktop, fascia
    │   │                         "i" (la tastiera non arriva a uno sfondo). Proprietà
    │   │                         dall'involucro (wallpaper/) via URL all'avvio, poi la
    │   │                         pagina stessa definisce wallpaperPropertyListener (WE
    │   │                         la richiama dal vivo, verificato); chiave API dal
    │   │                         frammento #k=, tolta subito, in memoria.
    │   │                         setPaused → mapIdle. Niente <select> visibili: crash.
    │   ├── newsOverlay.js      ← apre la vista News
    │   ├── guideOverlay.js     ← apre la Guida "Come si usa"
    │   ├── newsTicker.js       ← ticker in cima alla mappa: battaglie, elezioni, nuove
    │   │                         guerre, sworn enemy, popolazione, tesoro. Le ultime
    │   │                         quattro arrivano già pronte dal server (/ticker), non
    │   │                         più da snapshot in localStorage. Tetto per categoria
    │   │                         (CAT_CAP) così una sola non monopolizza il ticker.
    │   ├── livePings.js        ← NUOVO — la mappa "viva": un ping per evento.
    │   │                         Battaglia nuova = onde arancioni sulla regione; cambio
    │   │                         di proprietario = onde nel colore del nuovo padrone
    │   │                         (da /region-history/events ogni 3 min); guerra,
    │   │                         nemico giurato, pace, patto = impulso fra le capitali.
    │   │                         Le altre fonti le passa il ticker a ogni giro (zero
    │   │                         fetch). Etichetta col testo del ticker. All'apertura
    │   │                         gli ultimi 30 minuti, poi solo il nuovo, uno alla volta.
    │   │                         Clic su una notizia (ticker o vista News) = la mappa
    │   │                         vola sul posto e rifà il ping: newsTicker.js tiene
    │   │                         il bersaglio di ogni messaggio (newsTargetFor) e
    │   │                         pingNewsTarget lo suona.
    │   ├── newsView.js         ← vista "News": lo STESSO materiale del ticker, completo,
    │   │                         fermo e raggruppato per categoria. Zero fetch nuove —
    │   │                         riusa getNewsGroups() del ticker.
    │   ├── timeMachine.js      ← ownership storica delle regioni a uno slider temporale
    │   │                         (dati dal server: keyframe + replay lato VPS). Scope
    │   │                         volutamente ridotto: solo ownership + nome + bandiera.
    │   │                         Deep-link ?tm=<epoch ms>.
    │   │                         Il PLAYBACK in avanti si ricostruisce IN LOCALE
    │   │                         (fotogramma precedente + eventi in mezzo, già in
    │   │                         memoria): zero richieste, fluido, conquiste in
    │   │                         sincrono. Verificato identico a /region-history/at.
    │   │                         Velocità ¼x ½x 1x 2x 3x giorni/secondo, si parte a ½x.
    │   ├── timeMachineDay.js   ← NUOVO — la giornata storica per la time machine
    │   │                         (/day-history): patti, guerre, nemico giurato nel
    │   │                         popup del click e battaglie aperte sotto la
    │   │                         classifica del territorio. Una fetch per giorno
    │   │                         FERMATO, mai una per fotogramma di playback, e
    │   │                         nessun fallback: se il server non ce l'ha, le
    │   │                         sezioni non compaiono.
    │   ├── timeMachineConquest.js ← NUOVO — conquiste animate nella riproduzione:
    │   │                         freccia lampo dalla capitale ORIGINARIA del
    │   │                         conquistatore + onda sulla regione, per gli eventi
    │   │                         fra un fotogramma e l'altro. Tetti: niente oltre 4
    │   │                         giorni di salto, 6 per fotogramma, 14 a schermo.
    │   │                         In più il FRONTE (il contorno delle regioni passate
    │   │                         di mano brilla nel colore del conquistatore, fino a
    │   │                         40 per fotogramma) e i lampi delle ALLEANZE (entra /
    │   │                         esce / espulsa, solo blocchi: le bilaterali sono
    │   │                         ~250 al giorno). ⚠️ filtro "niente" = ['boolean',
    │   │                         false]: ['==', 1, 0] MapLibre lo legge come filtro
    │   │                         legacy e SCARTA il layer senza errori.
    │   ├── timeMachineLinks.js ← NUOVO — guerre (rosso, trattini che scorrono),
    │   │                         nemico giurato (più spesso) e patti (viola che
    │   │                         respira) della nazione SELEZIONATA come archi dalla
    │   │                         sua capitale di quel giorno. Solo per la selezione:
    │   │                         il mondo intero sono ~1.200 coppie al giorno.
    │   ├── timeMachineBattles.js ← NUOVO — le battaglie del giorno come frecce
    │   │                         dall'attaccante (capitale di quel giorno) alla regione,
    │   │                         spesse quanto il danno (o la potenza, nei giorni
    │   │                         importati). La regione la aggiunge /day-history in
    │   │                         lettura dall'archivio battaglie: c'è da luglio 2026.
    │   ├── timeMachineMap.js   ← SECONDA mappa MapLibre dedicata e alleggerita (3 layer)
    │   │                         usata dalla time machine; la principale viene nascosta,
    │   │                         non toccata. timeMachine.js tiene tutta la logica.
    │   ├── desktopMenuBar.js   ← barra menù desktop (Viste mappa / Approfondimenti /
    │   │                         Impostazioni, ricerca ⌘K, Preferiti)
    │   ├── mobileMenuBar.js    ← equivalente mobile (drawer)
    │   ├── pins.js             ← store dei Preferiti (nazioni/alleanze/unità), localStorage
    │   ├── backNav.js          ← NUOVO — tasto Indietro (browser, gesto Android, PWA):
    │   │                         chiude la cosa aperta invece di USCIRE dal tool.
    │   │                         Chi apre chiama pushBack(id, onBack, isOpen), chi chiude
    │   │                         dropBack(id); id gerarchici ('mu/detail' figlio di 'mu',
    │   │                         che si registra solo col genitore aperto). In cronologia
    │   │                         c'è AL MASSIMO una voce in più (la sentinella), qualunque
    │   │                         sia la profondità. Collegati:
    │   │                         overlay, schede di dettaglio (unità, nazioni, battaglie,
    │   │                         prezzi, bilancio), finestre di Political, Statistiche
    │   │                         alleanze e popup, pannello nazione (SOLO con una
    │   │                         selezione: il riepilogo di una vista appartiene alla
    │   │                         vista), viste mappa ≠ Diplomazia, battaglia selezionata,
    │   │                         time machine, drawer e ricerca mobile. Spento con
    │   │                         ?wallpaper=1. ⚠️ Una cosa nuova che "si apre" va
    │   │                         registrata qui, o Indietro torna a far uscire.
    │   │                         ⚠️ replaceState: passare history.state, MAI null —
    │   │                         azzererebbe il marchio della sentinella.
    │   │                         LINK CONDIVISIBILI: ogni livello porta i suoi parametri
    │   │                         (4° argomento di pushBack, o updateBackParams) e l'URL
    │   │                         si riscrive da sé: ?map= (con ?days= e ?focus= in
    │   │                         Migrazioni/Finanziamenti — il fuoco è il livello figlio
    │   │                         'mapview/focus' — e ?region= in Distanze) ?country=
    │   │                         ?alliance= ?sphere=
    │   │                         ?battle= ?section= (political, economy, news, mu,
    │   │                         nations, battles, guide, private, alliances) ?tab=
    │   │                         ?item= ?mu= ?nation= ?senate=. Si toccano SOLO le
    │   │                         chiavi di URL_KEYS (?tm= resta della time machine).
    │   │                         ⚠️ `view` NO: è dello sfondo (?wallpaper=1&view=).
    │   │                         In ingresso li rilegge main.js:handleIncomingDeepLink,
    │   │                         che gira PRIMA di startUrlSync(): fino ad allora l'URL
    │   │                         non si scrive (la closePanel() del boot cancellerebbe
    │   │                         ?country= prima che venga letto). Dentro lo sfondo
    │   │                         valgono solo ?country= e ?tm=, come prima.
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
    │   ├── battleBonus.js      ← NUOVO — bonus danno di battaglia per chi combatte:
    │   │                          patriottico, alleanza, patto, nemico giurato,
    │   │                          ordini (rosso 15 / giallo 10 / verde 5, da
    │   │                          battleOrder.getByBattle `priority`), QG
    │   │                          dell'unità, bunker/base, rivolta, malus regione
    │   │                          isolata. Percentuali da gameConfig. ⚠️ stimati:
    │   │                          chi riceve metà di bunker/base (qui alleanza o
    │   │                          patto) e il totale come somma.
    │   ├── allianceBonus.js    ← ricalcola il bonus danno d'alleanza (l'API non lo espone)
    │   ├── dailyDamage.js      ← "danno di oggi" per nazioni/alleanze/unità, dalla
    │   │                          differenza fra due snapshot del cumulato settimanale
    │   ├── analytics.js        ← wrapper su Umami (trackEvent)
    │   ├── reveal.js           ← NUOVO — numeri che contano e grafici che si disegnano,
    │   │                          con UN MutationObserver su <body>: nessuna vista è
    │   │                          toccata, si riconoscono dai selettori (NUM_SELECTOR,
    │   │                          CHART_SELECTOR in testa al file: per aggiungerne altri
    │   │                          si tocca solo lì). Numeri: chiave = vista + titolo di
    │   │                          ciò che si guarda + etichetta; mai visto → sale da 0,
    │   │                          uguale → fermo, diverso → dal vecchio + badge "+12K".
    │   │                          Riscrive col formato della vista (separatori, decimali,
    │   │                          K/M/%); un testo con più numeri, date o "#12" no.
    │   │                          Grafici: sipario da sinistra (clip-path), ciambelle che
    │   │                          ruotano; NIENTE sipario se nello stesso giro sparisce un
    │   │                          grafico della stessa classe già a schermo (refresh sul
    │   │                          posto). Il parlamento di Political si anima da sé
    │   │                          (parliament.js: _prevSeats, i seggi scivolano fra due
    │   │                          elezioni). Tutto sotto motion.js.
    │   ├── motion.js           ← NUOVO — interruttore unico "Animazioni" (Impostazioni,
    │   │                          `we_animations`): ferma comete, trattini, monete,
    │   │                          impulsi, battiti, ping, navi e particelle; restano
    │   │                          frecce e colori. Tutti i moduli animati chiedono
    │   │                          animationsOn(). Il replay battaglia NO (è a mano).
    │   ├── scrollHint.js       ← NUOVO — "Scorri di lato per tutte le colonne": l'avviso
    │   │                          sopra le tabelle dati che su telefono SCORRONO invece
    │   │                          di nascondere colonne (Rendite, Prezzi, Produzione,
    │   │                          Unità, Spese di guerra, Statistiche nazioni). Prima
    │   │                          colonna ferma, il resto scorre (2026-10-15: da
    │   │                          telefono non si vedeva più "Rendita/pp base").
    │   ├── wallpaper.js        ← NUOVO — solo il flag IS_WALLPAPER (?wallpaper=1),
    │   │                          letto da main.js, analytics.js, countryPanel.js
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
        ├── economy.css         ← NUOVO — scheletro della sezione Economia + scheda
        │                          Prezzi. ⚠️ namespace `wp-ecn-*` e NON `wp-eco-*`:
        │                          quello se lo tiene eco.css (l'Ottimizzatore, che
        │                          ora è una scheda della stessa sezione) e i suoi
        │                          .wp-eco-item/.wp-eco-delta/.wp-eco-note
        │                          atterravano sulla tabella dei prezzi.
        └── menubar.css, mobile-menubar.css, mu.css, nations.css, news.css,
            eco.css, guide.css, market.css, battles.css
```
