/* ══════════════════════════════════════════════════════════════
   WarEra+ — Guida "Come si usa": tutti i testi
   ------------------------------------------------------------------
   Dizionario LOCALE come per le barre menù (desktopMenuBar.js: MB_DICT),
   src/mu/i18n.js e src/app/newsView.js: le stringhe sono solo di questa
   vista e tenerle qui la lascia autonoma. Da fuori serve solo getLang().

   STRUTTURA. Una voce per sezione dell'app, nello stesso ordine in cui
   le sezioni compaiono nei menù. `t` è il titolo della scheda, `b` sono
   i punti (sempre TRE, la griglia è costruita su questo numero).

   SE AGGIUNGI UNA SEZIONE ALL'APP: aggiungi la chiave in SECTIONS
   (src/guide/main.js, con la sua icona) e la voce corrispondente in
   TUTTE e nove le lingue qui sotto. Una lingua che non ha la chiave
   ricade sull'inglese scheda per scheda, quindi una dimenticanza non
   rompe la vista — ma si vede.
   ══════════════════════════════════════════════════════════════ */

export const GUIDE_DICT = {
  en: {
    title: "How to use WarEra+",
    intro: "WarEra+ puts the strategic map, the political side and the statistics of the game in one place. Here is what each section does.",
    tip: "Almost everything opens from the top bar: Map views changes the colouring, Insights holds the sections, Settings has theme and language. On mobile the same items live in the ☰ drawer.",
    sections: {
      map: {
        t: "The map",
        b: [
          "Click a nation to open its side panel. The Map views menu changes the colouring: Diplomacy, Alliances, Sphere of influence, Weekly damage, Population, Contested regions, War history, War vs Eco.",
          "Entering a view the panel opens on its summary: the ranking of what you are looking at, and for the less obvious views what the colour is actually counting. On mobile it waits behind the “See details” tab.",
          "The Battles button shows and hides the active fronts, with markers and a heat map. Sea routes are ornamental — hover a moving ship to see what it is carrying.",
        ],
      },
      panel: {
        t: "Nation panel",
        b: [
          "Opens on click and only uses data already downloaded for the map: no extra waiting.",
          "Regions, alliances and NAPs, parliament hemicycle and the war/economy playstyle of the citizens.",
          "From a summary row you go down to a nation or an alliance, and back up with “← Overview”. Expand opens Politics; drag the panel edge to make it wider.",
        ],
      },
      politics: {
        t: "Politics",
        b: [
          "Presidential and congress elections, parties and senate for the chosen nation.",
          "Opens from the nation panel or from Insights → Politics; the selector at the top switches nation.",
          "Data goes through a dedicated proxy, so heavy moments in the game do not turn into failed requests.",
        ],
      },
      nations: {
        t: "Nation stats",
        b: [
          "Overview of every nation, with sortable columns.",
          "1 vs 2 puts two nations side by side on the same metrics.",
          "A nation card adds charts and the list of its citizens.",
        ],
      },
      alliances: {
        t: "Alliance stats",
        b: [
          "Leaderboards for the blocs: territory, damage, population, wealth.",
          "The band on top reports today's damage, taken once a day.",
          "From here you reach a single alliance and its members.",
        ],
      },
      mu: {
        t: "Military Units",
        b: [
          "Directory of every unit, sortable columns, rows tinted by tier.",
          "The Composition column says how many members come from each nation and marks the de facto unit of a country.",
          "A unit card shows six leaderboards, the composition by nationality and the member list.",
        ],
      },
      eco: {
        t: "Industrial Optimizer",
        b: [
          "Works out where it pays off to work and produce, from your skills, your position and market prices.",
          "Sections for Skills, Position, Workers and Hiring.",
          "Tool designed by ArgusIA and brought inside WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Every story the ticker above the map only shows a sample of.",
          "Grouped by category: ongoing battles, elections, new wars, sworn enemies, world events.",
          "Internal search, and a count of what arrived since your last visit.",
        ],
      },
      timeMachine: {
        t: "Time machine",
        b: [
          "The slider at the bottom rewinds the map and shows who owned each region at that moment.",
          "Region ownership only: historical population or wealth were never recorded, so showing them would be misleading.",
          "It draws on a separate lightweight map, so the main map is left exactly as it was.",
        ],
      },
      settings: {
        t: "Settings and shortcuts",
        b: [
          "Light theme (antique map) or dark theme, and nine languages.",
          "The search box finds nations, alliances and units; the star pins them to your favourites.",
          "Installs as an app and keeps working offline on the data already downloaded.",
        ],
      },
    },
  },

  it: {
    title: "Come si usa WarEra+",
    intro: "WarEra+ mette in un unico posto la mappa strategica, la politica e le statistiche del gioco. Ecco cosa fa ogni sezione.",
    tip: "Quasi tutto si apre dalla barra in alto: Viste mappa cambia la colorazione, Approfondimenti contiene le sezioni, Impostazioni tema e lingua. Su mobile le stesse voci stanno nel drawer ☰.",
    sections: {
      map: {
        t: "La mappa",
        b: [
          "Clicca una nazione per aprire il suo pannello laterale. Il menù Viste mappa cambia la colorazione: Diplomazia, Alleanze, Sfera d'influenza, Danni settimanali, Popolazione, Regioni contese, Storico bellico, Guerra vs Eco.",
          "Entrando in una vista il pannello si apre sul riepilogo: la classifica di quello che stai guardando e, per le viste meno ovvie, cosa sta contando davvero il colore. Su mobile aspetta dietro la linguetta “Vedi dettagli”.",
          "Il bottone Battaglie mostra e nasconde i fronti attivi, con marker e mappa di calore. Le rotte navali sono ornamentali — passa il mouse su una nave per sapere cosa trasporta.",
        ],
      },
      panel: {
        t: "Pannello nazione",
        b: [
          "Si apre al click e usa solo dati già scaricati per la mappa: nessuna attesa in più.",
          "Regioni, alleanze e NAP, emiciclo del parlamento e stile di gioco (guerra/economia) dei cittadini.",
          "Da una riga del riepilogo scendi su una nazione o un'alleanza, e risali con “← Riepilogo”. Espandi apre Politica; trascina il bordo del pannello per allargarlo.",
        ],
      },
      politics: {
        t: "Politica",
        b: [
          "Elezioni presidenziali e del congresso, partiti e senato della nazione scelta.",
          "Si apre dal pannello nazione o da Approfondimenti → Politica; il selettore in alto cambia nazione.",
          "I dati passano da un proxy dedicato, così i momenti di carico del gioco non diventano richieste fallite.",
        ],
      },
      nations: {
        t: "Statistiche nazioni",
        b: [
          "Panoramica di tutte le nazioni, con colonne ordinabili.",
          "1 vs 2 mette due nazioni a confronto sulle stesse metriche.",
          "La scheda di una nazione aggiunge grafici e l'elenco dei suoi cittadini.",
        ],
      },
      alliances: {
        t: "Statistiche alleanze",
        b: [
          "Classifiche dei blocchi: territorio, danno, popolazione, ricchezza.",
          "La fascia in cima riporta il danno di oggi, rilevato una volta al giorno.",
          "Da qui si arriva alla singola alleanza e ai suoi membri.",
        ],
      },
      mu: {
        t: "Unità Militari",
        b: [
          "Elenco di tutte le unità, colonne ordinabili, righe tinte per tier.",
          "La colonna Composizione dice quanti membri arrivano da ogni nazione e segnala l'unità de facto di un paese.",
          "La scheda di un'unità mostra sei classifiche, la composizione per nazionalità e i membri.",
        ],
      },
      eco: {
        t: "Ottimizzatore industriale",
        b: [
          "Calcola dove conviene lavorare e produrre, a partire da competenze, posizione e prezzi di mercato.",
          "Sezioni Competenze, Posizione, Lavoratori e Assunzioni.",
          "Tool ideato da ArgusIA e portato dentro WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Tutte le notizie che il ticker sopra la mappa mostra solo a campione.",
          "Raggruppate per categoria: battaglie in corso, elezioni, nuove guerre, nemici giurati, eventi del mondo.",
          "Ricerca interna e conteggio di quello che è arrivato dall'ultima visita.",
        ],
      },
      timeMachine: {
        t: "Time machine",
        b: [
          "Lo slider in basso riavvolge la mappa e mostra chi possedeva ogni regione in quel momento.",
          "Solo il possesso delle regioni: popolazione e ricchezza storiche non sono mai state registrate, mostrarle sarebbe fuorviante.",
          "Disegna su una mappa separata e leggera, così la mappa principale resta com'era.",
        ],
      },
      settings: {
        t: "Impostazioni e scorciatoie",
        b: [
          "Tema chiaro (mappa antica) o scuro, e nove lingue.",
          "La ricerca in alto trova nazioni, alleanze e unità; la stella le fissa fra i preferiti.",
          "Si installa come app e continua a funzionare offline sui dati già scaricati.",
        ],
      },
    },
  },

  es: {
    title: "Cómo se usa WarEra+",
    intro: "WarEra+ reúne en un solo sitio el mapa estratégico, la política y las estadísticas del juego. Esto es lo que hace cada sección.",
    tip: "Casi todo se abre desde la barra superior: Vistas cambia el coloreado, Análisis contiene las secciones, Ajustes el tema y el idioma. En móvil las mismas opciones están en el menú ☰.",
    sections: {
      map: {
        t: "El mapa",
        b: [
          "Haz clic en una nación para abrir su panel lateral. El menú Vistas cambia el coloreado: Diplomacia, Alianzas, Esfera de influencia, Daño semanal, Población, Regiones disputadas, Histórico bélico, Guerra vs Eco.",
          "Al entrar en una vista el panel se abre en su resumen: la clasificación de lo que estás mirando y, en las vistas menos obvias, qué está contando el color. En móvil espera detrás de la pestaña “Ver detalles”.",
          "El botón Batallas muestra y oculta los frentes activos, con marcadores y mapa de calor. Las rutas marítimas son ornamentales — pasa el ratón sobre un barco para ver qué lleva.",
        ],
      },
      panel: {
        t: "Panel de nación",
        b: [
          "Se abre al hacer clic y solo usa datos ya descargados para el mapa: sin esperas extra.",
          "Regiones, alianzas y NAP, hemiciclo del parlamento y estilo de juego (guerra/economía) de los ciudadanos.",
          "Desde una fila del resumen bajas a una nación o una alianza, y vuelves con “← Resumen”. Expandir abre Política; arrastra el borde del panel para ensancharlo.",
        ],
      },
      politics: {
        t: "Política",
        b: [
          "Elecciones presidenciales y del congreso, partidos y senado de la nación elegida.",
          "Se abre desde el panel o desde Análisis → Política; el selector de arriba cambia de nación.",
          "Los datos pasan por un proxy propio, así los momentos de carga del juego no se convierten en peticiones fallidas.",
        ],
      },
      nations: {
        t: "Estadísticas de naciones",
        b: [
          "Panorámica de todas las naciones, con columnas ordenables.",
          "1 vs 2 compara dos naciones con las mismas métricas.",
          "La ficha de una nación añade gráficos y la lista de sus ciudadanos.",
        ],
      },
      alliances: {
        t: "Estadísticas de alianzas",
        b: [
          "Clasificaciones de los bloques: territorio, daño, población, riqueza.",
          "La franja superior indica el daño de hoy, tomado una vez al día.",
          "Desde aquí se llega a una alianza concreta y a sus miembros.",
        ],
      },
      mu: {
        t: "Unidades militares",
        b: [
          "Directorio de todas las unidades, columnas ordenables, filas coloreadas por nivel.",
          "La columna Composición dice cuántos miembros vienen de cada nación y marca la unidad de facto de un país.",
          "La ficha de una unidad muestra seis clasificaciones, la composición por nacionalidad y los miembros.",
        ],
      },
      eco: {
        t: "Optimizador industrial",
        b: [
          "Calcula dónde conviene trabajar y producir, según tus habilidades, tu posición y los precios de mercado.",
          "Secciones de Habilidades, Posición, Trabajadores y Contratación.",
          "Herramienta ideada por ArgusIA y traída dentro de WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Todas las noticias de las que el ticker sobre el mapa solo muestra una parte.",
          "Agrupadas por categoría: batallas en curso, elecciones, nuevas guerras, enemigos jurados, eventos del mundo.",
          "Búsqueda interna y recuento de lo llegado desde tu última visita.",
        ],
      },
      timeMachine: {
        t: "Time machine",
        b: [
          "El deslizador inferior rebobina el mapa y muestra quién poseía cada región en ese momento.",
          "Solo la posesión de regiones: la población o la riqueza históricas nunca se registraron, mostrarlas sería engañoso.",
          "Dibuja en un mapa aparte y ligero, así el mapa principal queda intacto.",
        ],
      },
      settings: {
        t: "Ajustes y atajos",
        b: [
          "Tema claro (mapa antiguo) u oscuro, y nueve idiomas.",
          "La búsqueda de arriba encuentra naciones, alianzas y unidades; la estrella las fija como favoritas.",
          "Se instala como aplicación y sigue funcionando sin conexión con los datos ya descargados.",
        ],
      },
    },
  },

  de: {
    title: "So benutzt du WarEra+",
    intro: "WarEra+ bringt die strategische Karte, die Politik und die Statistiken des Spiels an einen Ort. Das macht jeder Bereich.",
    tip: "Fast alles öffnet sich über die obere Leiste: Ansichten ändert die Einfärbung, Einblicke enthält die Bereiche, Einstellungen Thema und Sprache. Auf dem Handy stehen dieselben Punkte im ☰-Menü.",
    sections: {
      map: {
        t: "Die Karte",
        b: [
          "Klicke eine Nation an, um ihr Seitenpanel zu öffnen. Das Menü Ansichten ändert die Einfärbung: Diplomatie, Bündnisse, Sphäre, Wöchentlicher Schaden, Bevölkerung, Umkämpfte Regionen, Kriegsgeschichte, Krieg vs Eco.",
          "Beim Betreten einer Ansicht öffnet das Panel ihre Übersicht: die Rangliste dessen, was du siehst, und bei den weniger offensichtlichen Ansichten, was die Farbe wirklich zählt. Auf dem Handy wartet sie hinter dem Reiter „Details ansehen“.",
          "Die Schaltfläche Schlachten blendet die aktiven Fronten ein und aus, mit Markern und Heatmap. Seerouten sind Zierde — fahre über ein Schiff, um seine Ladung zu sehen.",
        ],
      },
      panel: {
        t: "Nationspanel",
        b: [
          "Öffnet sich per Klick und nutzt nur Daten, die für die Karte schon geladen sind: kein zusätzliches Warten.",
          "Regionen, Bündnisse und NAPs, Parlamentshalbkreis und Spielstil (Krieg/Wirtschaft) der Bürger.",
          "Aus einer Übersichtszeile geht es hinunter zu einer Nation oder einem Bündnis und mit „← Übersicht“ wieder hinauf. Erweitern öffnet Politik; zieh den Panelrand, um es zu verbreitern.",
        ],
      },
      politics: {
        t: "Politik",
        b: [
          "Präsidenten- und Kongresswahlen, Parteien und Senat der gewählten Nation.",
          "Öffnet sich aus dem Panel oder über Einblicke → Politik; die Auswahl oben wechselt die Nation.",
          "Die Daten laufen über einen eigenen Proxy, damit Lastspitzen im Spiel nicht zu fehlgeschlagenen Anfragen werden.",
        ],
      },
      nations: {
        t: "Nationsstatistiken",
        b: [
          "Überblick über alle Nationen, mit sortierbaren Spalten.",
          "1 vs 2 stellt zwei Nationen mit denselben Kennzahlen gegenüber.",
          "Die Nationskarte ergänzt Diagramme und die Liste ihrer Bürger.",
        ],
      },
      alliances: {
        t: "Bündnisstatistiken",
        b: [
          "Ranglisten der Blöcke: Territorium, Schaden, Bevölkerung, Vermögen.",
          "Das Band oben zeigt den heutigen Schaden, einmal täglich erfasst.",
          "Von hier kommst du zu einem einzelnen Bündnis und seinen Mitgliedern.",
        ],
      },
      mu: {
        t: "Militäreinheiten",
        b: [
          "Verzeichnis aller Einheiten, sortierbare Spalten, nach Tier eingefärbte Zeilen.",
          "Die Spalte Zusammensetzung nennt die Mitglieder je Nation und markiert die De-facto-Einheit eines Landes.",
          "Die Einheitenkarte zeigt sechs Ranglisten, die Zusammensetzung nach Nationalität und die Mitglieder.",
        ],
      },
      eco: {
        t: "Industrie-Optimierer",
        b: [
          "Berechnet, wo sich Arbeiten und Produzieren lohnt — aus Fähigkeiten, Standort und Marktpreisen.",
          "Bereiche Fähigkeiten, Standort, Arbeiter und Einstellungen.",
          "Werkzeug von ArgusIA, hierher nach WarEra+ geholt.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Alle Meldungen, von denen der Ticker über der Karte nur eine Auswahl zeigt.",
          "Nach Kategorie gruppiert: laufende Schlachten, Wahlen, neue Kriege, Erzfeinde, Weltgeschehen.",
          "Interne Suche und Zählung dessen, was seit deinem letzten Besuch dazugekommen ist.",
        ],
      },
      timeMachine: {
        t: "Zeitmaschine",
        b: [
          "Der Regler unten spult die Karte zurück und zeigt, wem jede Region damals gehörte.",
          "Nur der Regionsbesitz: historische Bevölkerung oder Vermögen wurden nie gespeichert, sie zu zeigen wäre irreführend.",
          "Zeichnet auf einer eigenen, leichten Karte, die Hauptkarte bleibt unangetastet.",
        ],
      },
      settings: {
        t: "Einstellungen und Kniffe",
        b: [
          "Helles Thema (antike Karte) oder dunkles, und neun Sprachen.",
          "Die Suche oben findet Nationen, Bündnisse und Einheiten; der Stern heftet sie an die Favoriten.",
          "Lässt sich als App installieren und funktioniert offline mit den bereits geladenen Daten weiter.",
        ],
      },
    },
  },

  fr: {
    title: "Comment utiliser WarEra+",
    intro: "WarEra+ réunit au même endroit la carte stratégique, la politique et les statistiques du jeu. Voici ce que fait chaque section.",
    tip: "Presque tout s'ouvre depuis la barre du haut : Vues change la coloration, Analyses contient les sections, Paramètres le thème et la langue. Sur mobile, les mêmes entrées sont dans le menu ☰.",
    sections: {
      map: {
        t: "La carte",
        b: [
          "Clique sur une nation pour ouvrir son panneau latéral. Le menu Vues change la coloration : Diplomatie, Alliances, Sphère d'influence, Dégâts hebdomadaires, Population, Régions disputées, Historique de guerre, Guerre vs Éco.",
          "En entrant dans une vue, le panneau s'ouvre sur son résumé : le classement de ce que tu regardes et, pour les vues les moins évidentes, ce que la couleur compte vraiment. Sur mobile il attend derrière l'onglet « Voir les détails ».",
          "Le bouton Batailles affiche et masque les fronts actifs, avec marqueurs et carte de chaleur. Les routes maritimes sont ornementales — survole un navire pour voir sa cargaison.",
        ],
      },
      panel: {
        t: "Panneau nation",
        b: [
          "S'ouvre au clic et n'utilise que des données déjà téléchargées pour la carte : aucune attente en plus.",
          "Régions, alliances et NAP, hémicycle du parlement et style de jeu (guerre/économie) des citoyens.",
          "Depuis une ligne du résumé tu descends sur une nation ou une alliance, et tu remontes avec « ← Vue d'ensemble ». Étendre ouvre Politique ; tire le bord du panneau pour l'élargir.",
        ],
      },
      politics: {
        t: "Politique",
        b: [
          "Élections présidentielles et du congrès, partis et sénat de la nation choisie.",
          "S'ouvre depuis le panneau ou via Analyses → Politique ; le sélecteur en haut change de nation.",
          "Les données passent par un proxy dédié, pour que les pics de charge du jeu ne deviennent pas des requêtes en échec.",
        ],
      },
      nations: {
        t: "Stats des nations",
        b: [
          "Vue d'ensemble de toutes les nations, colonnes triables.",
          "1 vs 2 compare deux nations sur les mêmes métriques.",
          "La fiche d'une nation ajoute des graphiques et la liste de ses citoyens.",
        ],
      },
      alliances: {
        t: "Stats des alliances",
        b: [
          "Classements des blocs : territoire, dégâts, population, richesse.",
          "Le bandeau du haut donne les dégâts du jour, relevés une fois par jour.",
          "De là, on atteint une alliance précise et ses membres.",
        ],
      },
      mu: {
        t: "Unités militaires",
        b: [
          "Annuaire de toutes les unités, colonnes triables, lignes teintées par palier.",
          "La colonne Composition indique les membres par nation et signale l'unité de facto d'un pays.",
          "La fiche d'une unité montre six classements, la composition par nationalité et les membres.",
        ],
      },
      eco: {
        t: "Optimiseur industriel",
        b: [
          "Calcule où il vaut mieux travailler et produire, selon vos compétences, votre position et les prix du marché.",
          "Sections Compétences, Position, Travailleurs et Recrutement.",
          "Outil imaginé par ArgusIA et intégré à WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Toutes les nouvelles dont le bandeau au-dessus de la carte ne montre qu'un échantillon.",
          "Groupées par catégorie : batailles en cours, élections, nouvelles guerres, ennemis jurés, événements du monde.",
          "Recherche interne et décompte de ce qui est arrivé depuis votre dernière visite.",
        ],
      },
      timeMachine: {
        t: "Time machine",
        b: [
          "Le curseur du bas rembobine la carte et montre qui possédait chaque région à ce moment-là.",
          "Uniquement la possession des régions : la population ou la richesse historiques n'ont jamais été enregistrées, les afficher serait trompeur.",
          "Le rendu se fait sur une carte séparée et légère : la carte principale reste telle quelle.",
        ],
      },
      settings: {
        t: "Paramètres et raccourcis",
        b: [
          "Thème clair (carte ancienne) ou sombre, et neuf langues.",
          "La recherche en haut trouve nations, alliances et unités ; l'étoile les épingle en favoris.",
          "S'installe comme une application et continue de fonctionner hors ligne sur les données déjà téléchargées.",
        ],
      },
    },
  },

  nl: {
    title: "Zo gebruik je WarEra+",
    intro: "WarEra+ brengt de strategische kaart, de politiek en de statistieken van het spel samen op één plek. Dit doet elke sectie.",
    tip: "Bijna alles opent vanuit de bovenbalk: Weergaven wijzigt de kleuring, Inzichten bevat de secties, Instellingen thema en taal. Op mobiel staan dezelfde items in het ☰-menu.",
    sections: {
      map: {
        t: "De kaart",
        b: [
          "Klik op een natie om haar zijpaneel te openen. Het menu Weergaven verandert de kleuring: Diplomatie, Bondgenootschappen, Invloedssfeer, Wekelijkse schade, Bevolking, Betwiste regio’s, Oorlogsgeschiedenis, Oorlog vs Eco.",
          "Bij het openen van een weergave toont het paneel meteen het overzicht: de ranglijst van wat je bekijkt en, bij de minder voor de hand liggende weergaven, wat de kleur echt telt. Op mobiel wacht het achter het tabje “Bekijk details”.",
          "De knop Veldslagen toont en verbergt de actieve fronten, met markers en een heatmap. Zeeroutes zijn versiering — beweeg over een schip om de lading te zien.",
        ],
      },
      panel: {
        t: "Natiepaneel",
        b: [
          "Opent bij een klik en gebruikt alleen gegevens die al voor de kaart zijn opgehaald: geen extra wachttijd.",
          "Regio’s, allianties en NAP’s, halfrond van het parlement en speelstijl (oorlog/economie) van de burgers.",
          "Vanuit een rij in het overzicht ga je naar een natie of alliantie, en met “← Overzicht” weer terug. Uitklappen opent Politiek; sleep de rand van het paneel om het breder te maken.",
        ],
      },
      politics: {
        t: "Politiek",
        b: [
          "Presidents- en congresverkiezingen, partijen en senaat van de gekozen natie.",
          "Opent vanuit het paneel of via Inzichten → Politiek; de keuzelijst bovenaan wisselt van natie.",
          "De data loopt via een eigen proxy, zodat drukke momenten in het spel geen mislukte verzoeken worden.",
        ],
      },
      nations: {
        t: "Natiestatistieken",
        b: [
          "Overzicht van alle naties, met sorteerbare kolommen.",
          "1 vs 2 zet twee naties naast elkaar op dezelfde maatstaven.",
          "De natiekaart voegt grafieken en de lijst met burgers toe.",
        ],
      },
      alliances: {
        t: "Alliantiestatistieken",
        b: [
          "Ranglijsten van de blokken: gebied, schade, bevolking, rijkdom.",
          "De band bovenaan toont de schade van vandaag, één keer per dag opgenomen.",
          "Van hieruit bereik je een afzonderlijk bondgenootschap en zijn leden.",
        ],
      },
      mu: {
        t: "Militaire eenheden",
        b: [
          "Overzicht van alle eenheden, sorteerbare kolommen, rijen gekleurd per tier.",
          "De kolom Samenstelling toont de leden per natie en markeert de de facto eenheid van een land.",
          "De eenheidskaart toont zes ranglijsten, de samenstelling per nationaliteit en de leden.",
        ],
      },
      eco: {
        t: "Industriële optimizer",
        b: [
          "Berekent waar werken en produceren loont, op basis van vaardigheden, positie en marktprijzen.",
          "Secties Vaardigheden, Positie, Werkers en Aannemen.",
          "Tool bedacht door ArgusIA en naar WarEra+ gehaald.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Al het nieuws waarvan de ticker boven de kaart slechts een greep laat zien.",
          "Gegroepeerd per categorie: lopende veldslagen, verkiezingen, nieuwe oorlogen, aartsvijanden, wereldgebeurtenissen.",
          "Interne zoekfunctie en een telling van wat er sinds je laatste bezoek bij kwam.",
        ],
      },
      timeMachine: {
        t: "Tijdmachine",
        b: [
          "De schuif onderaan spoelt de kaart terug en toont wie elke regio toen bezat.",
          "Alleen regiobezit: historische bevolking of rijkdom zijn nooit vastgelegd, ze tonen zou misleiden.",
          "Tekent op een aparte, lichte kaart, zodat de hoofdkaart onaangeroerd blijft.",
        ],
      },
      settings: {
        t: "Instellingen en handigheidjes",
        b: [
          "Licht thema (antieke kaart) of donker, en negen talen.",
          "De zoekbalk vindt naties, bondgenootschappen en eenheden; de ster zet ze bij favorieten.",
          "Installeert als app en blijft offline werken op de al opgehaalde data.",
        ],
      },
    },
  },

  sv: {
    title: "Så använder du WarEra+",
    intro: "WarEra+ samlar den strategiska kartan, politiken och spelets statistik på ett ställe. Så här fungerar varje del.",
    tip: "Nästan allt öppnas från övre raden: Vyer byter färgläggning, Insikter innehåller sektionerna, Inställningar tema och språk. På mobil ligger samma poster i ☰-menyn.",
    sections: {
      map: {
        t: "Kartan",
        b: [
          "Klicka på en nation för att öppna dess sidopanel. Menyn Vyer byter färgläggning: Diplomati, Allianser, Sfär, Veckoskada, Befolkning, Omstridda regioner, Krigshistorik, Krig vs Eco.",
          "När du går in i en vy öppnas panelen på dess översikt: rankningen för det du tittar på och, för de mindre självklara vyerna, vad färgen faktiskt räknar. På mobil väntar den bakom fliken ”Visa detaljer”.",
          "Knappen Strider visar och döljer de aktiva fronterna, med markörer och värmekarta. Sjörutter är dekoration — håll musen över ett fartyg för att se lasten.",
        ],
      },
      panel: {
        t: "Nationspanel",
        b: [
          "Öppnas vid klick och använder bara data som redan hämtats för kartan: ingen extra väntan.",
          "Regioner, allianser och NAP, parlamentets halvcirkel och medborgarnas spelstil (krig/ekonomi).",
          "Från en rad i översikten går du ner till en nation eller allians, och tillbaka med ”← Översikt”. Expandera öppnar Politik; dra i panelkanten för att göra den bredare.",
        ],
      },
      politics: {
        t: "Politik",
        b: [
          "President- och kongressval, partier och senat för vald nation.",
          "Öppnas från panelen eller via Insikter → Politik; väljaren högst upp byter nation.",
          "Data går via en egen proxy, så tunga stunder i spelet inte blir misslyckade anrop.",
        ],
      },
      nations: {
        t: "Nationsstatistik",
        b: [
          "Överblick över alla nationer, med sorterbara kolumner.",
          "1 vs 2 ställer två nationer mot varandra på samma mått.",
          "Nationskortet lägger till diagram och listan över dess medborgare.",
        ],
      },
      alliances: {
        t: "Allianstatistik",
        b: [
          "Topplistor för blocken: territorium, skada, befolkning, förmögenhet.",
          "Bandet högst upp visar dagens skada, avläst en gång per dygn.",
          "Härifrån når du en enskild allians och dess medlemmar.",
        ],
      },
      mu: {
        t: "Militära enheter",
        b: [
          "Katalog över alla enheter, sorterbara kolumner, rader färgade per tier.",
          "Kolumnen Sammansättning visar medlemmar per nation och märker ut ett lands de facto-enhet.",
          "Enhetskortet visar sex topplistor, sammansättning per nationalitet och medlemmarna.",
        ],
      },
      eco: {
        t: "Industrioptimerare",
        b: [
          "Räknar ut var det lönar sig att arbeta och producera, utifrån färdigheter, position och marknadspriser.",
          "Avsnitten Färdigheter, Position, Arbetare och Rekrytering.",
          "Verktyg skapat av ArgusIA och inflyttat i WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Alla nyheter som tickern ovanför kartan bara visar ett urval av.",
          "Grupperade per kategori: pågående strider, val, nya krig, svurna fiender, världshändelser.",
          "Intern sökning och räkning av vad som kommit sedan ditt förra besök.",
        ],
      },
      timeMachine: {
        t: "Tidsmaskin",
        b: [
          "Reglaget längst ned spolar tillbaka kartan och visar vem som ägde varje region då.",
          "Endast regionägande: historisk befolkning eller förmögenhet har aldrig sparats, att visa dem vore vilseledande.",
          "Ritas på en separat, lätt karta, så huvudkartan lämnas orörd.",
        ],
      },
      settings: {
        t: "Inställningar och genvägar",
        b: [
          "Ljust tema (antik karta) eller mörkt, och nio språk.",
          "Sökrutan hittar nationer, allianser och enheter; stjärnan fäster dem som favoriter.",
          "Installeras som app och fortsätter fungera offline på redan hämtad data.",
        ],
      },
    },
  },

  pt: {
    title: "Como usar o WarEra+",
    intro: "O WarEra+ junta num só sítio o mapa estratégico, a política e as estatísticas do jogo. Eis o que faz cada secção.",
    tip: "Quase tudo abre a partir da barra de cima: Vistas muda a coloração, Análises contém as secções, Definições o tema e o idioma. No telemóvel as mesmas entradas estão no menu ☰.",
    sections: {
      map: {
        t: "O mapa",
        b: [
          "Clica numa nação para abrir o seu painel lateral. O menu Vistas muda a coloração: Diplomacia, Alianças, Esfera de influência, Dano semanal, População, Regiões disputadas, Histórico bélico, Guerra vs Eco.",
          "Ao entrar numa vista o painel abre no resumo: a classificação do que estás a ver e, nas vistas menos óbvias, o que a cor está mesmo a contar. No telemóvel espera atrás do separador “Ver detalhes”.",
          "O botão Batalhas mostra e esconde as frentes ativas, com marcadores e mapa de calor. As rotas marítimas são ornamentais — passa o rato sobre um navio para ver o que transporta.",
        ],
      },
      panel: {
        t: "Painel da nação",
        b: [
          "Abre ao clique e usa apenas dados já descarregados para o mapa: sem espera extra.",
          "Regiões, alianças e NAP, hemiciclo do parlamento e estilo de jogo (guerra/economia) dos cidadãos.",
          "A partir de uma linha do resumo desces a uma nação ou aliança, e voltas com “← Resumo”. Expandir abre Política; arrasta a borda do painel para o alargar.",
        ],
      },
      politics: {
        t: "Política",
        b: [
          "Eleições presidenciais e do congresso, partidos e senado da nação escolhida.",
          "Abre a partir do painel ou em Análises → Política; o seletor no topo troca de nação.",
          "Os dados passam por um proxy dedicado, para que os picos de carga do jogo não virem pedidos falhados.",
        ],
      },
      nations: {
        t: "Estatísticas de nações",
        b: [
          "Panorâmica de todas as nações, com colunas ordenáveis.",
          "1 vs 2 compara duas nações nas mesmas métricas.",
          "A ficha de uma nação acrescenta gráficos e a lista dos seus cidadãos.",
        ],
      },
      alliances: {
        t: "Estatísticas de alianças",
        b: [
          "Classificações dos blocos: território, dano, população, riqueza.",
          "A faixa no topo indica o dano de hoje, recolhido uma vez por dia.",
          "Daqui chega-se a uma aliança concreta e aos seus membros.",
        ],
      },
      mu: {
        t: "Unidades militares",
        b: [
          "Diretório de todas as unidades, colunas ordenáveis, linhas coloridas por nível.",
          "A coluna Composição diz quantos membros vêm de cada nação e assinala a unidade de facto de um país.",
          "A ficha de uma unidade mostra seis classificações, a composição por nacionalidade e os membros.",
        ],
      },
      eco: {
        t: "Otimizador industrial",
        b: [
          "Calcula onde compensa trabalhar e produzir, a partir das competências, da posição e dos preços de mercado.",
          "Secções Competências, Posição, Trabalhadores e Contratação.",
          "Ferramenta idealizada pela ArgusIA e trazida para dentro do WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "Todas as notícias de que o ticker acima do mapa só mostra uma amostra.",
          "Agrupadas por categoria: batalhas em curso, eleições, novas guerras, inimigos jurados, eventos do mundo.",
          "Pesquisa interna e contagem do que chegou desde a sua última visita.",
        ],
      },
      timeMachine: {
        t: "Máquina do tempo",
        b: [
          "O cursor em baixo rebobina o mapa e mostra quem possuía cada região nesse momento.",
          "Apenas a posse das regiões: a população ou a riqueza históricas nunca foram registadas, mostrá-las seria enganador.",
          "Desenha num mapa separado e leve, deixando o mapa principal intacto.",
        ],
      },
      settings: {
        t: "Definições e atalhos",
        b: [
          "Tema claro (mapa antigo) ou escuro, e nove idiomas.",
          "A pesquisa no topo encontra nações, alianças e unidades; a estrela fixa-as nos favoritos.",
          "Instala-se como aplicação e continua a funcionar offline com os dados já descarregados.",
        ],
      },
    },
  },

  ar: {
    title: "كيفية استخدام WarEra+",
    intro: "يجمع WarEra+ الخريطة الاستراتيجية والسياسة وإحصاءات اللعبة في مكان واحد. إليك ما يفعله كل قسم.",
    tip: "يفتح كل شيء تقريباً من الشريط العلوي: العروض تغيّر التلوين، ورؤى تضم الأقسام، والإعدادات فيها السمة واللغة. على الهاتف تجد العناصر نفسها في قائمة ☰.",
    sections: {
      map: {
        t: "الخريطة",
        b: [
          "اضغط على دولة لفتح لوحتها الجانبية. قائمة العروض تغيّر التلوين: الدبلوماسية، التحالفات، النطاق، الضرر الأسبوعي، السكان، المناطق المتنازع عليها، تاريخ الحرب، حرب مقابل اقتصاد.",
          "عند دخول أي عرض تفتح اللوحة على ملخّصه: ترتيب ما تنظر إليه، وفي العروض الأقل وضوحاً ما يقيسه اللون فعلاً. على الهاتف تنتظر خلف لسان “عرض التفاصيل”.",
          "زرّ المعارك يُظهر ويُخفي الجبهات النشطة، مع علامات وخريطة حرارية. الطرق البحرية زخرفية — مرّر المؤشر فوق سفينة لترى حمولتها.",
        ],
      },
      panel: {
        t: "لوحة الدولة",
        b: [
          "تُفتح بالضغط وتستخدم فقط بيانات مُحمّلة مسبقاً للخريطة: دون انتظار إضافي.",
          "المناطق والتحالفات واتفاقات عدم الاعتداء، وقوس البرلمان، وأسلوب لعب المواطنين (حرب/اقتصاد).",
          "من صف في الملخّص تنزل إلى دولة أو تحالف، وتعود بـ “← نظرة عامة”. زرّ التوسيع يفتح السياسة؛ اسحب حافة اللوحة لتوسيعها.",
        ],
      },
      politics: {
        t: "السياسة",
        b: [
          "الانتخابات الرئاسية وانتخابات الكونغرس والأحزاب ومجلس الشيوخ للدولة المختارة.",
          "تُفتح من لوحة الدولة أو من رؤى ← السياسة؛ والمُحدِّد في الأعلى يغيّر الدولة.",
          "تمر البيانات عبر وسيط مخصص، حتى لا تتحول أوقات الضغط في اللعبة إلى طلبات فاشلة.",
        ],
      },
      nations: {
        t: "إحصاءات الدول",
        b: [
          "نظرة عامة على كل الدول، بأعمدة قابلة للترتيب.",
          "«1 مقابل 2» يقارن دولتين بالمقاييس نفسها.",
          "بطاقة الدولة تضيف رسوماً بيانية وقائمة مواطنيها.",
        ],
      },
      alliances: {
        t: "إحصاءات التحالفات",
        b: [
          "تصنيفات الكتل: الأرض، الضرر، السكان، الثروة.",
          "الشريط العلوي يعرض ضرر اليوم، يُلتقط مرة واحدة يومياً.",
          "من هنا تصل إلى تحالف بعينه وإلى أعضائه.",
        ],
      },
      mu: {
        t: "الوحدات العسكرية",
        b: [
          "دليل بكل الوحدات، بأعمدة قابلة للترتيب وصفوف ملوّنة حسب المستوى.",
          "عمود التركيب يبيّن عدد الأعضاء من كل دولة ويشير إلى الوحدة الفعلية للبلد.",
          "بطاقة الوحدة تعرض ستة تصنيفات، والتركيب حسب الجنسية، والأعضاء.",
        ],
      },
      eco: {
        t: "محسّن الصناعة",
        b: [
          "يحسب أين يُجدي العمل والإنتاج، انطلاقاً من المهارات والموقع وأسعار السوق.",
          "أقسام المهارات والموقع والعمال والتوظيف.",
          "أداة من ابتكار ArgusIA أُدمجت داخل WarEra+.",
        ],
      },
      news: {
        t: "News",
        b: [
          "كل الأخبار التي لا يعرض الشريط أعلى الخريطة سوى عيّنة منها.",
          "مجمّعة حسب الفئة: معارك جارية، انتخابات، حروب جديدة، أعداء محلفون، أحداث العالم.",
          "بحث داخلي وعدّ لما وصل منذ زيارتك الأخيرة.",
        ],
      },
      timeMachine: {
        t: "آلة الزمن",
        b: [
          "المؤشر في الأسفل يعيد الخريطة إلى الوراء ويبيّن من كان يملك كل إقليم حينها.",
          "ملكية الأقاليم فقط: السكان والثروة تاريخياً لم تُسجَّل قط، وعرضها سيكون مضللاً.",
          "يرسم على خريطة منفصلة وخفيفة، فتبقى الخريطة الرئيسية كما هي.",
        ],
      },
      settings: {
        t: "الإعدادات والاختصارات",
        b: [
          "سمة فاتحة (خريطة عتيقة) أو داكنة، وتسع لغات.",
          "البحث في الأعلى يجد الدول والتحالفات والوحدات؛ والنجمة تثبّتها في المفضلة.",
          "يمكن تثبيته كتطبيق ويستمر بالعمل دون اتصال بالبيانات المنزّلة سابقاً.",
        ],
      },
    },
  },
};
