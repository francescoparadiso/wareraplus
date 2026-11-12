/* ══════════════════════════════════════════════════════════════
   WarEra+ — Registro delle novità (cosa si vede nel riquadro "Novità")
   ------------------------------------------------------------------
   È l'UNICO file da toccare a ogni aggiornamento: `whatsNew.js` mostra
   il riquadro a chi ha visto una versione precedente, una volta sola.

   ── COME SI AGGIUNGE UN AGGIORNAMENTO ──────────────────────────────
   In CIMA all'array (il più recente per primo) un oggetto:

       {
         id: '2026-11-20',            // data ISO; due nello stesso giorno: '2026-11-20b'
         title: { en: '…', it: '…' },
         items: [
           { tag: 'new',      en: '…', it: '…' },
           { tag: 'improved', en: '…', it: '…' },
           { tag: 'fix',      en: '…', it: '…' },
         ],
       }

   · `id` è anche quello che si ricorda nel browser di chi lo ha visto:
     si confronta come testo, quindi DEVE ordinarsi come le date e non
     va mai riusato né ritoccato dopo la pubblicazione (chi l'ha già
     visto non lo rivedrebbe; chi no, sì — e va bene).
   · `en` e `it` sono obbligatori. Le altre lingue (es, de, fr, nl, sv,
     pt, ar) sono facoltative: dove mancano si vede l'inglese, la stessa
     ricaduta degli altri dizionari del tool.
   · `tag`: 'new' (una cosa che prima non c'era), 'improved' (c'era e
     ora è meglio), 'fix' (non funzionava).
   · Scrivi cosa cambia PER CHI USA il tool, non per chi lo sviluppa:
     «il confronto si apre di nuovo», non «import mancante di tipAttr».

   Chi non ha mai aperto il tool non vede niente (vedi
   SHOW_TO_NEW_VISITORS in whatsNew.js), e chi salta più aggiornamenti
   ne vede fino a tre insieme, dal più recente.

   Per rivederlo a mano: aggiungi ?whatsnew=1 all'indirizzo.
   ══════════════════════════════════════════════════════════════ */

export const CHANGELOG = [
  {
    id: '2026-11-12',
    title: { en: 'Agreements: orders and a fuller check', it: 'Accordi: gli ordini e un controllo più completo' },
    items: [
      {
        tag: 'new',
        en: 'Agreements: the check now looks at national orders too. For each battle it shows whether a nation gave an order against the other party, whether it was later removed, and flags damage that came with no order, which probably wasn\'t intended. Orders are recorded from 12 November: the game throws them away once a battle ends, so older battles show "n/a".',
        it: 'Accordi: il controllo guarda anche gli ordini nazionali. Per ogni battaglia dice se una nazione ha dato un ordine contro l\'altra parte, se è stato tolto dopo, e segnala il danno arrivato senza nessun ordine, che probabilmente non era voluto. Gli ordini si registrano dal 12 novembre: il gioco li butta a battaglia finita, quindi per le battaglie prima c\'è scritto "n/d".',
      },
      {
        tag: 'improved',
        en: 'Agreements: the check reads the full battle rankings, not just the top 100, and uses each player\'s nationality on the day of the battle (from the migration archive, which starts on 12 October). Every battle also says whether its region is a core one or an occupied one.',
        it: 'Accordi: il controllo legge le classifiche delle battaglie per intero, non solo i primi 100, e usa la nazionalità che ogni giocatore aveva il giorno della battaglia (dall\'archivio delle migrazioni, che parte dal 12 ottobre). Ogni battaglia dice anche se la regione è core o occupata.',
      },
      {
        tag: 'improved',
        en: 'Spheres of influence: the hand-made list is gone, it was no longer reliable. The map now shows only what the proxy radar detects from public data, each with its confidence.',
        it: 'Sfere d\'influenza: la lista fatta a mano non c\'è più, non era più affidabile. La mappa mostra solo ciò che il radar dei proxy rileva dai dati pubblici, ognuno con la sua sicurezza.',
      },
    ],
  },
  {
    id: '2026-11-11',
    title: { en: 'Crafting, cases and purchasing power', it: 'Crafting, casse e potere d\'acquisto' },
    items: [
      {
        tag: 'new',
        en: 'Economy has a new "Crafting" tab: for every rarity it shows what a random craft costs, what it is worth on average, the chance of profit and the value of each piece, measured on real market sales. It also tells you whether a case is worth opening or better sold closed. You set your own market tax.',
        it: 'Economia ha una nuova scheda "Crafting": per ogni rarità mostra quanto costa un craft casuale, quanto vale in media, la probabilità di profitto e il valore di ogni pezzo, misurato su vendite vere del mercato. Dice anche se una cassa conviene aprirla o venderla chiusa. La tassa di mercato la imposti tu.',
      },
      {
        tag: 'new',
        en: 'Players → Wealth has a "Purchasing power" view: your wealth without companies, divided by the price of pills, food and ammo, so you can tell whether it is falling because you spend more or because prices and your gear lost value.',
        it: 'Giocatori → Ricchezza ha la vista "Potere d\'acquisto": la ricchezza senza aziende, divisa per il prezzo di pillole, cibo e proiettili, per capire se cala perché spendi di più o perché prezzi ed equipaggiamento hanno perso valore.',
      },
      {
        tag: 'improved',
        en: 'Agreements: each pact now says whether it covers only the nations\' original regions or also the ones they occupy.',
        it: 'Accordi: ogni patto ora dice se copre solo le regioni originali delle nazioni o anche quelle che hanno occupato.',
      },
    ],
  },
  {
    id: '2026-11-08e',
    title: { en: 'Alliance logos', it: 'Loghi delle alleanze' },
    items: [
      {
        tag: 'improved',
        en: 'Alliance statistics show each alliance\'s logo in Faction 1 vs 2 and on its page, and every alliance bonus now says what it does.',
        it: 'Statistiche alleanze mostrano il logo di ogni alleanza in Fazione 1 vs 2 e nella sua pagina, e ogni bonus d\'alleanza ora spiega cosa fa.',
      },
    ],
  },
  {
    id: '2026-11-08d',
    title: { en: 'Alliance bonuses', it: 'Bonus d\'alleanza' },
    items: [
      {
        tag: 'new',
        en: 'Alliance statistics: each alliance page has an "Alliance bonuses" section with the damage bonus and the six strategic resources (level, skill bonus for every citizen, copies missing for the next level, which nations hold them). Faction 1 vs 2 compares these bonuses too.',
        it: 'Statistiche alleanze: la pagina di ogni alleanza ha la sezione "Bonus d\'alleanza" col bonus danno e le sei risorse strategiche (livello, bonus di abilità per ogni cittadino, copie che mancano al livello dopo, quali nazioni le portano). Anche Fazione 1 vs 2 confronta questi bonus.',
      },
    ],
  },
  {
    id: '2026-11-08c',
    title: { en: 'Governments of past terms', it: 'I governi dei mandati passati' },
    items: [
      {
        tag: 'new',
        en: 'Opening an older presidential election in Political now shows the government of that term, with the parties its members belonged to at the time (the archive starts on 29 September 2026).',
        it: 'Aprendo una presidenziale vecchia in Political ora si vede il governo di quel mandato, coi partiti di cui i membri facevano parte allora (l\'archivio parte dal 29 settembre 2026).',
      },
    ],
  },
  {
    id: '2026-11-08b',
    title: { en: 'Presidential results and governments, redesigned', it: 'Risultati presidenziali e governi, rifatti' },
    items: [
      {
        tag: 'improved',
        en: 'Presidential results in Political: the winner with their party, one vote-share bar with the 50% line, the margin in plain words, party colours for every candidate, and a comparison with the previous presidential (turnout, outgoing president, party). The past winners are listed again.',
        it: 'Risultati presidenziali in Political: il vincitore col suo partito, una barra unica delle quote con la linea del 50%, il margine detto in chiaro, i colori dei partiti per ogni candidato e il confronto con le presidenziali precedenti (affluenza, presidente uscente, partito). Torna l\'elenco dei vincitori passati.',
      },
      {
        tag: 'improved',
        en: 'The current government shows president and vice president in front, the government split by party, and every minister with their portfolio, party, days in office and in-game powers.',
        it: 'Il governo in carica mostra in evidenza presidente e vice, il governo diviso per partito, e ogni ministro col suo portafoglio, partito, giorni in carica e poteri di gioco.',
      },
      {
        tag: 'fix',
        en: 'With many ministers the Senate government box no longer covers the seats: extra ministers show as faces, with "All" to open the full list.',
        it: 'Con molti ministri il riquadro del governo nel Senato non copre più i seggi: i ministri in più compaiono come facce, e "Tutti" apre l\'elenco completo.',
      },
    ],
  },
  {
    id: '2026-11-08',
    title: { en: 'Ready for the 7 November game update', it: 'Pronto per l\'aggiornamento del gioco del 7 novembre' },
    items: [
      {
        tag: 'new',
        en: 'Nation panel: a Strategic resources section shows the skill bonuses every citizen gets, shared across the alliance, with the level of each resource and how many copies are missing for the next one.',
        it: 'Pannello nazione: la sezione Risorse strategiche mostra i bonus di abilità che prende ogni cittadino, condivisi nell\'alleanza, col livello di ogni risorsa e quante copie mancano al successivo.',
      },
      {
        tag: 'improved',
        en: 'Governments show every minister (up to 20), with the titles the president gave them, in the nation panel, Political and the player profile.',
        it: 'I governi mostrano tutti i ministri (fino a 20), coi titoli dati dal presidente, nel pannello nazione, in Political e nel profilo del giocatore.',
      },
      {
        tag: 'improved',
        en: 'Income by government type follows the new rules: Plutocracy doubles wage and manager taxes, and Nationalist and Mercenary State are gone. Party pages show the favourite government type.',
        it: 'Le entrate per tipo di governo seguono le regole nuove: la Plutocrazia raddoppia le tasse su salari e manager, e Stato nazionalista e Stato mercenario non ci sono più. Le pagine dei partiti mostrano il tipo di governo preferito.',
      },
      {
        tag: 'fix',
        en: 'War/eco playstyle, attack and critical columns, health and food bars and player skills are back: the game stopped sending them where the tool read them.',
        it: 'Tornano lo stile di gioco guerra/eco, le colonne attacco e critico, le barre di vita e cibo e le abilità dei giocatori: il gioco aveva smesso di mandarli dove il tool li leggeva.',
      },
    ],
  },
  {
    id: '2026-11-06',
    title: { en: 'Map fix', it: 'Correzione della mappa' },
    items: [
      {
        tag: 'fix',
        en: 'Clicking a battle on the map opens it again, even right after moving or zooming the map, instead of selecting the nation underneath.',
        it: 'Cliccare una battaglia sulla mappa la apre di nuovo, anche subito dopo aver spostato o zoomato la mappa, invece di selezionare la nazione sotto.',
      },
    ],
  },
  {
    id: '2026-11-04',
    title: { en: 'November 2026 update', it: 'Aggiornamento di novembre 2026' },
    items: [
      {
        tag: 'new',
        en: 'New "Money" tab in Economy: how many coins sit in player wallets, nation treasuries and buy orders, broken down by nation and military unit.',
        it: 'Nuova scheda "Soldi" in Economia: quante monete ci sono nei portafogli dei giocatori, nei tesori delle nazioni e negli ordini d\'acquisto, divise per nazione e per unità militare.',
      },
      {
        tag: 'new',
        en: 'A player\'s wealth is now split into Companies, Equipment, Weapons, Items and Money. Pick which categories to show and follow them day by day (the history starts today).',
        it: 'La ricchezza di un giocatore ora è divisa in Aziende, Equipaggiamento, Armi, Oggetti e Soldi. Scegli quali categorie mostrare e seguile giorno per giorno (lo storico parte da oggi).',
      },
      {
        tag: 'improved',
        en: 'Player search shows the results while you type, in all three search boxes.',
        it: 'La ricerca dei giocatori mostra i risultati mentre scrivi, in tutte e tre le caselle di ricerca.',
      },
      {
        tag: 'improved',
        en: 'Charts that follow a single value over time (prices, wealth, money) are green where it rises and red where it falls.',
        it: 'I grafici che seguono un solo valore nel tempo (prezzi, ricchezza, soldi) sono verdi dove sale e rossi dove scende.',
      },
      {
        tag: 'fix',
        en: 'The 1 vs 1 player comparison opens again, from the button and from shared links.',
        it: 'Il confronto 1 vs 1 fra giocatori si apre di nuovo, dal bottone e dai link condivisi.',
      },
    ],
  },
  {
    id: '2026-10-30',
    title: { en: 'Late October 2026', it: 'Fine ottobre 2026' },
    items: [
      {
        tag: 'new',
        en: 'Employees everywhere: company rosters in the Optimizer, a comparison with the world, and employees in the player profile.',
        it: 'Dipendenti ovunque: la rosa delle aziende nell\'Ottimizzatore, il confronto col mondo e i dipendenti nel profilo del giocatore.',
      },
      {
        tag: 'new',
        en: 'Military unit detail has a Pills section: who can take one, who is pilled and who is in debuff.',
        it: 'Il dettaglio delle unità ha una sezione Pillole: chi può pillare, chi è pillato e chi è in debuff.',
      },
      {
        tag: 'new',
        en: 'Alliance statistics have a detail page with a war/eco chart, and nations show war/eco players over time.',
        it: 'Le statistiche delle alleanze hanno una pagina di dettaglio con il grafico guerra/eco, e le nazioni mostrano i giocatori guerra/eco nel tempo.',
      },
      {
        tag: 'improved',
        en: 'Prices are their own tab again, and the Wealth tab moved into Players.',
        it: 'I Prezzi tornano scheda a sé, e la scheda Ricchezza è passata in Giocatori.',
      },
      {
        tag: 'improved',
        en: '"My character" can be linked from Favourites and follows you everywhere.',
        it: '"Il mio personaggio" si collega dai Preferiti e ti segue ovunque.',
      },
    ],
  },
];
