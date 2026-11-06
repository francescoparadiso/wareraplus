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
