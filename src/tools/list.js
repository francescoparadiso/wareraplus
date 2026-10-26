/* ══════════════════════════════════════════════════════════════
   WarEra+ — Altri strumenti: l'elenco
   ------------------------------------------------------------------
   I siti della community WarEra che la sezione "Altri strumenti"
   (src/tools/main.js) linka, uno per voce. È l'UNICO posto in cui
   stanno: per aggiungerne uno basta una voce qui, la vista non ha
   niente da sapere.

   Ogni voce: `name` è il nome con cui il sito si presenta, `url` la
   pagina d'ingresso (il dominio mostrato sulla scheda si ricava da qui),
   `desc` una riga per lingua su cosa fa — scritta guardando il sito,
   non copiata dalla sua presentazione. Una lingua mancante ricade
   sull'inglese, quindi una voce nuova funziona anche col solo `en`.

   Niente loghi né grafica presi dai siti: sono di terzi, e una scheda
   col loro marchio sembrerebbe un'affiliazione che non c'è.

   ⚠️ Niente numeri nelle descrizioni ("45 strumenti"): cambiano sul
   sito e qui resterebbero fermi senza che nessuno se ne accorga.
   ══════════════════════════════════════════════════════════════ */

export const TOOLS = [
  {
    name: 'EMPRESS',
    url: 'https://warera-empress.app/',
    desc: {
      en: 'Analysis of your companies (profit, supply chain, employees), a combat and skill optimizer, and intel pages on countries and military units. Some features need an account; there is a demo.',
      it: 'Analisi delle tue aziende (profitto, filiera, dipendenti), un ottimizzatore di equipaggiamento e abilità, e schede su nazioni e unità militari. Alcune funzioni chiedono un account; c\'è una demo.',
      es: 'Análisis de tus empresas (beneficio, cadena de suministro, empleados), un optimizador de equipo y habilidades, y fichas de países y unidades militares. Algunas funciones piden una cuenta; hay una demo.',
      de: 'Analyse deiner Unternehmen (Gewinn, Lieferkette, Angestellte), ein Kampf- und Skill-Optimierer und Infoseiten zu Ländern und Militäreinheiten. Manche Funktionen brauchen ein Konto; es gibt eine Demo.',
      fr: 'Analyse de vos entreprises (profit, chaîne d\'approvisionnement, employés), un optimiseur de combat et de compétences, et des fiches sur les pays et les unités militaires. Certaines fonctions demandent un compte ; une démo existe.',
      nl: 'Analyse van je bedrijven (winst, toeleveringsketen, werknemers), een gevecht- en skill-optimizer en infopagina\'s over landen en militaire eenheden. Sommige functies vragen een account; er is een demo.',
      sv: 'Analys av dina företag (vinst, leveranskedja, anställda), en strids- och färdighetsoptimerare och sidor om länder och militära enheter. Vissa funktioner kräver ett konto; det finns en demo.',
      pt: 'Análise das tuas empresas (lucro, cadeia de abastecimento, funcionários), um otimizador de combate e habilidades, e fichas de países e unidades militares. Algumas funções pedem uma conta; há uma demo.',
      ar: 'تحليل شركاتك (الربح، سلسلة الإمداد، الموظفون)، ومُحسِّن للقتال والمهارات، وصفحات معلومات عن الدول والوحدات العسكرية. بعض الميزات تتطلب حسابًا، وهناك نسخة تجريبية.',
    },
  },
  {
    name: 'SPYWarera',
    url: 'https://spywarera.com/',
    desc: {
      en: 'Statistics and leaderboards: a feed of what happens on the map, damage records, active battles, and day-by-day charts of pills, damage and wealth.',
      it: 'Statistiche e classifiche: un feed di quel che succede sulla mappa, record di danno, battaglie in corso e grafici giorno per giorno di pillole, danno e ricchezza.',
      es: 'Estadísticas y clasificaciones: un feed de lo que pasa en el mapa, récords de daño, batallas activas y gráficos diarios de píldoras, daño y riqueza.',
      de: 'Statistiken und Ranglisten: ein Feed der Ereignisse auf der Karte, Schadensrekorde, laufende Schlachten und Tagesdiagramme zu Pillen, Schaden und Vermögen.',
      fr: 'Statistiques et classements : un fil de ce qui se passe sur la carte, records de dégâts, batailles en cours et graphiques jour par jour des pilules, dégâts et richesse.',
      nl: 'Statistieken en ranglijsten: een feed van wat er op de kaart gebeurt, schaderecords, lopende veldslagen en dagelijkse grafieken van pillen, schade en rijkdom.',
      sv: 'Statistik och topplistor: ett flöde över vad som händer på kartan, skaderekord, pågående strider och dagliga diagram över piller, skada och förmögenhet.',
      pt: 'Estatísticas e classificações: um feed do que acontece no mapa, recordes de dano, batalhas em curso e gráficos diários de pílulas, dano e riqueza.',
      ar: 'إحصاءات وتصنيفات: موجز لما يحدث على الخريطة، وأرقام قياسية للضرر، والمعارك الجارية، ورسوم بيانية يومية للحبوب والضرر والثروة.',
    },
  },
  {
    name: 'Unikhorne WarEra Suite',
    url: 'https://warera.unikhorne.dev/',
    desc: {
      en: 'Dozens of free tools, no login: players, military units, battles, markets, treasuries and mercenary contracts, plus a timeline of recent events.',
      it: 'Decine di strumenti gratuiti, senza login: giocatori, unità militari, battaglie, mercati, tesori e contratti mercenari, più una cronologia degli ultimi eventi.',
      es: 'Decenas de herramientas gratuitas, sin registro: jugadores, unidades militares, batallas, mercados, tesoros y contratos de mercenarios, más una cronología de los últimos eventos.',
      de: 'Dutzende kostenlose Tools ohne Login: Spieler, Militäreinheiten, Schlachten, Märkte, Staatskassen und Söldnerverträge, dazu eine Chronik der letzten Ereignisse.',
      fr: 'Des dizaines d\'outils gratuits, sans connexion : joueurs, unités militaires, batailles, marchés, trésors et contrats de mercenaires, plus une chronologie des derniers événements.',
      nl: 'Tientallen gratis tools, zonder login: spelers, militaire eenheden, veldslagen, markten, schatkisten en huurlingencontracten, plus een tijdlijn van recente gebeurtenissen.',
      sv: 'Dussintals gratisverktyg utan inloggning: spelare, militära enheter, strider, marknader, statskassor och legosoldatkontrakt, plus en tidslinje över de senaste händelserna.',
      pt: 'Dezenas de ferramentas gratuitas, sem login: jogadores, unidades militares, batalhas, mercados, tesouros e contratos de mercenários, mais uma cronologia dos últimos eventos.',
      ar: 'عشرات الأدوات المجانية دون تسجيل دخول: اللاعبون، والوحدات العسكرية، والمعارك، والأسواق، والخزائن، وعقود المرتزقة، مع خط زمني لآخر الأحداث.',
    },
  },
  {
    name: 'Arcana Era',
    url: 'https://arcana.warera.wiki/',
    desc: {
      en: 'A collection of tools: bonus compendium, company analysis, market chronicle, profit and build calculators — plus a card game set in WarEra.',
      it: 'Una raccolta di strumenti: compendio dei bonus, analisi delle aziende, cronaca del mercato, calcolatori di profitto e di build — più un gioco di carte ambientato in WarEra.',
      es: 'Una colección de herramientas: compendio de bonus, análisis de empresas, crónica del mercado, calculadoras de beneficio y de build — y además un juego de cartas ambientado en WarEra.',
      de: 'Eine Sammlung von Tools: Bonus-Kompendium, Unternehmensanalyse, Marktchronik, Gewinn- und Build-Rechner — dazu ein Kartenspiel in der Welt von WarEra.',
      fr: 'Une collection d\'outils : compendium des bonus, analyse des entreprises, chronique du marché, calculateurs de profit et de build — plus un jeu de cartes dans l\'univers de WarEra.',
      nl: 'Een verzameling tools: bonuscompendium, bedrijfsanalyse, marktkroniek, winst- en buildcalculators — plus een kaartspel in de wereld van WarEra.',
      sv: 'En samling verktyg: bonuskompendium, företagsanalys, marknadskrönika, vinst- och byggkalkylatorer — plus ett kortspel i WarEras värld.',
      pt: 'Uma coleção de ferramentas: compêndio de bônus, análise de empresas, crónica do mercado, calculadoras de lucro e de build — e ainda um jogo de cartas no mundo de WarEra.',
      ar: 'مجموعة أدوات: موسوعة المكافآت، وتحليل الشركات، وسجلّ السوق، وحاسبات الربح والبناء — بالإضافة إلى لعبة بطاقات في عالم WarEra.',
    },
  },
];
