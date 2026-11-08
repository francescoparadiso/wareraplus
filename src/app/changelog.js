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
