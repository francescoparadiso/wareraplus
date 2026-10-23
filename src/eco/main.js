/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale (src/eco/*)
   ------------------------------------------------------------------
   Port a moduli ES del bot Discord "WarEra Eco Optimizer" di ArgusIA,
   terza scheda di Economia (src/economy/main.js).

   RISCRITTO PER LA v0.27 (2026-10-23). Il bot ragionava su lavoratori
   che erano giocatori: Competenze / Posizione / Lavoratori, più le
   Assunzioni aggiunte qui. La v0.27 toglie il mercato del lavoro e mette
   i dipendenti NPC, che da fuori non si vedono (vedi account.js); il
   bonus regionale sparisce con giacimenti e specializzazione. Restano
   quindi due schede costruite sul dato MISURATO di work.getStatsByCompany:

     · Aziende (companies.js) — margine dei dipendenti, motore, segnali;
     · Competenze (skills.js) — l'idea di ArgusIA sulle abilità nuove.

   Posizione (tasse e fronte, non più bonus) e Manager arriveranno dopo:
   vedi AGGIORNAMENTO-v0.27.md, §5. Il vecchio codice di Posizione,
   Lavoratori, Assunzioni e della paga da lavoro è nella storia di git.

   Questo file è l'orchestratore + il rendering (equivalente di bot.py +
   embeds.py). La logica pura sta nei moduli fratelli.

   CREDITI: tool ideato da ArgusIA — card in cima col link al profilo. Non
   rimuovere l'attribuzione.

   i18n: dizionario locale a placeholder `{x}`, tradotto con tf(). Copre le
   stesse 9 lingue della barra menu (EN/IT/ES/DE/FR/NL/SV/PT/AR); i nomi
   delle skill (Companies/Energy/Production/Management) restano in
   inglese perché così sono nel gioco. Si ritraduce a 'wareraplus:langchange'.
   ══════════════════════════════════════════════════════════════ */

import '../styles/eco.css';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { fetchCreditProfileViaCache } from '../diplomacy/cacheClient.js';

import { loadGameData, EcoProxyUnavailableError, ecoCall, isDevApi, setDevApiKey, hasDevApiKey } from './api.js';
import { makeGameData } from './gameData.js';
import { resolveUserId, AmbiguousUserError, UserNotFoundError } from './resolve.js';
import { loadOwnedCompanies } from './account.js';
import { computeCompanies } from './companies.js';
import { computeSkills, ECO_SKILLS } from './skills.js';

const AUTHOR = {
  userId: '69cc14d4efc3f3f4291e93a9',
  username: 'ArgusIA',
  profileUrl: 'https://app.warera.io/user/69cc14d4efc3f3f4291e93a9',
};

const SKILL_LABEL = { companies: 'Companies', energy: 'Energy', production: 'Production', management: 'Management' };

// ══ i18n ═══════════════════════════════════════════════════════════
const DICT = {
  en: {
    title: 'Industrial Optimizer', subtitle: 'What your employees really earn you, company by company, and the economy skills that make the most of it.',
    creditBy: 'Tool designed by', viewProfile: 'View profile', level: 'Level',
    inputPh: 'WarEra username or ID…', analyze: 'Analyze', analyzing: 'Analyzing…', remember: 'Remember this player',
    goldDay: 'gold/day', perPt: '/pt',
    secCompanies: 'Companies', secSkills: 'Skills',
    coHead: 'gold/day from employees', coLosing: '{n} losing money',
    lblEmployees: 'Employees', lblPtsDay: '{p} pts/day', lblCost: 'cost {c}/pt', lblValue: 'worth {v}/pt',
    lblBreakRoom: 'break room L{l} · up to {n}', lblEngine: 'engine L{l}', lblSelf: 'your work', lblTax: 'income tax {t}%',
    sigLoss: 'Losing money: employees cost more than their output is worth',
    sigIdle: '{n} day(s) with nobody working — the hourly pay wasn\'t covered?',
    sigDown: 'Output per coin of wages down {p}% in the last 3 days (happiness? taxes, full storage, battles)',
    sigUp: 'Output per coin of wages up {p}% in the last 3 days — training is paying off',
    sigNoEmp: 'No employee output in the last {n} days',
    sigFull: 'Storage full: happiness drops until you empty it',
    sigNegValue: 'Inputs cost more than the product sells for: every point loses money',
    sigNoStats: 'Work stats unavailable for this company',
    sigDisabled: 'Disabled (over the Companies cap): earns nothing',
    sparkHint: 'Employee output, last 31 days',
    coNote: 'Last {n} full days (UTC). Worth per point = (price − inputs) ÷ production points. Cost per point = wages actually paid ÷ points your employees made. The game doesn\'t show individual employees to other tools — only these company totals — so headcount, happiness and tools aren\'t visible here.',
    curLabel: 'Now', recLabel: 'Recommended', pointsUsed: '{used}/{budget} pts', available: 'available',
    brkPassive: 'companies {g}', brkSelf: 'self-work {g}',
    skBudget: '{b} points in these four skills ({f} unspent). Combat skills and Leadership are left alone.',
    skSelf: 'Self-work in', skSelfDetail: '{v}/pt · {a} actions/day',
    skSelfNone: 'At current prices self-work earns nothing in any of your companies.',
    skMgmt: 'Management L{l}: +{p}% employee output',
    skCap: 'Companies L{l} keeps {k} of your {n} companies active: the others stop producing.',
    skLeader: 'Leadership L{l} stays as is: it improves training and events, which have no gold value.',
    skNote: 'Assumes all the energy regenerated in 24 h goes into self-work (10 per action). Energy for hiring and training, and any manager you hire, aren\'t counted. v0.27 gives everyone one free skill reset.',
    noCompanies: 'No owned companies found.',
    errNotFound: 'No player found with that name or ID.', errAmbiguous: 'Multiple players match — be more specific:',
    errGeneric: 'Something went wrong while analyzing. Try again in a moment.',
    setupTitle: 'Work stats not reachable',
    setupBody: 'Company output and wages (work.getStatsByCompany) need the server-side API key. The proxy isn\'t adding it right now — check that the cache server has WARERA_API_TOKEN loaded (/health → trpcProxy.apiKey).',
    emptyHint: 'Enter a WarEra username or ID above to analyze that player\'s companies.',
    otherMatched: 'also matched: {names}',
    devBanner: 'Test mode: talking to apidev.warera.io (v0.27 test world). Not available on the live site.',
    devKeyPh: 'apidev API key (kept in memory only)',
    devKeyMissing: 'In test mode work stats come straight from apidev: paste a valid apidev API key in the field above and analyze again.',
  },
  it: {
    title: 'Ottimizzatore industriale', subtitle: 'Quanto ti rendono davvero i dipendenti, azienda per azienda, e le abilità economiche che ne tirano fuori di più.',
    creditBy: 'Tool ideato da', viewProfile: 'Vedi profilo', level: 'Livello',
    inputPh: 'Username o ID WarEra…', analyze: 'Analizza', analyzing: 'Analisi…', remember: 'Ricorda questo giocatore',
    goldDay: 'oro/giorno', perPt: '/pt',
    secCompanies: 'Aziende', secSkills: 'Competenze',
    coHead: 'oro/giorno dai dipendenti', coLosing: '{n} in perdita',
    lblEmployees: 'Dipendenti', lblPtsDay: '{p} pt/giorno', lblCost: 'costano {c}/pt', lblValue: 'valgono {v}/pt',
    lblBreakRoom: 'area relax L{l} · fino a {n}', lblEngine: 'motore L{l}', lblSelf: 'lavoro tuo', lblTax: 'tassa sul reddito {t}%',
    sigLoss: 'In perdita: i dipendenti costano più di quanto vale quello che producono',
    sigIdle: '{n} giorno/i in cui non ha lavorato nessuno — paga oraria non coperta?',
    sigDown: 'Produzione per moneta di salario giù del {p}% negli ultimi 3 giorni (felicità? tasse, magazzino pieno, battaglie)',
    sigUp: 'Produzione per moneta di salario su del {p}% negli ultimi 3 giorni — l\'addestramento rende',
    sigNoEmp: 'Nessuna produzione dei dipendenti negli ultimi {n} giorni',
    sigFull: 'Magazzino pieno: la felicità scende finché non lo svuoti',
    sigNegValue: 'Le materie prime costano più del prodotto: ogni punto è in perdita',
    sigNoStats: 'Statistiche di lavoro non disponibili per questa azienda',
    sigDisabled: 'Disattivata (oltre il tetto Aziende): non rende nulla',
    sparkHint: 'Produzione dei dipendenti, ultimi 31 giorni',
    coNote: 'Ultimi {n} giorni interi (UTC). Valore del punto = (prezzo − materie prime) ÷ punti produzione. Costo del punto = salari pagati davvero ÷ punti prodotti dai dipendenti. Il gioco non mostra i singoli dipendenti agli altri tool — solo questi totali per azienda — quindi quanti sono, la loro felicità e gli attrezzi qui non si vedono.',
    curLabel: 'Ora', recLabel: 'Consigliato', pointsUsed: '{used}/{budget} pt', available: 'disponibili',
    brkPassive: 'aziende {g}', brkSelf: 'lavoro tuo {g}',
    skBudget: '{b} punti in queste quattro abilità ({f} non spesi). Abilità da combattimento e Leadership restano come sono.',
    skSelf: 'Lavoro in proprio in', skSelfDetail: '{v}/pt · {a} azioni/giorno',
    skSelfNone: 'Ai prezzi di adesso il lavoro in proprio non rende in nessuna delle tue aziende.',
    skMgmt: 'Gestione L{l}: +{p}% di produzione dei dipendenti',
    skCap: 'Con Aziende L{l} restano attive {k} delle tue {n} aziende: le altre smettono di produrre.',
    skLeader: 'Leadership L{l} resta com\'è: migliora addestramento ed eventi, che non hanno un valore in oro.',
    skNote: 'Assume che tutta l\'energia rigenerata in 24 ore vada nel lavoro in proprio (10 per azione). Energia per assumere e addestrare e un eventuale manager non sono contati. Con la v0.27 tutti hanno un reset delle abilità gratuito.',
    noCompanies: 'Nessuna azienda posseduta trovata.',
    errNotFound: 'Nessun giocatore trovato con quel nome o ID.', errAmbiguous: 'Più giocatori corrispondono — sii più preciso:',
    errGeneric: 'Qualcosa è andato storto durante l\'analisi. Riprova tra un momento.',
    setupTitle: 'Statistiche di lavoro non raggiungibili',
    setupBody: 'Produzione e salari delle aziende (work.getStatsByCompany) vogliono la chiave API lato server. Il proxy adesso non la sta aggiungendo: controlla che il cache-server abbia WARERA_API_TOKEN caricata (/health → trpcProxy.apiKey).',
    emptyHint: 'Inserisci sopra uno username o ID WarEra per analizzare le aziende di quel giocatore.',
    otherMatched: 'corrispondono anche: {names}',
    devBanner: 'Modalità di prova: parla con apidev.warera.io (il mondo di prova della v0.27). Sul sito live non esiste.',
    devKeyPh: 'Chiave API di apidev (resta solo in memoria)',
    devKeyMissing: 'In modalità di prova le statistiche arrivano dritte da apidev: incolla una chiave API valida di apidev nel campo qui sopra e rianalizza.',
  },
  es: {
    title: 'Optimizador industrial', subtitle: 'Lo que tus empleados te rinden de verdad, empresa por empresa, y las habilidades económicas que más le sacan.',
    creditBy: 'Herramienta ideada por', viewProfile: 'Ver perfil', level: 'Nivel',
    inputPh: 'Usuario o ID de WarEra…', analyze: 'Analizar', analyzing: 'Analizando…', remember: 'Recordar este jugador',
    goldDay: 'oro/día', perPt: '/pt',
    secCompanies: 'Empresas', secSkills: 'Habilidades',
    coHead: 'oro/día de los empleados', coLosing: '{n} con pérdidas',
    lblEmployees: 'Empleados', lblPtsDay: '{p} pts/día', lblCost: 'cuestan {c}/pt', lblValue: 'valen {v}/pt',
    lblBreakRoom: 'sala de descanso N{l} · hasta {n}', lblEngine: 'motor N{l}', lblSelf: 'tu trabajo', lblTax: 'impuesto sobre la renta {t}%',
    sigLoss: 'Con pérdidas: los empleados cuestan más de lo que vale lo que producen',
    sigIdle: '{n} día(s) sin que nadie trabaje — ¿no se cubrió la paga por hora?',
    sigDown: 'Producción por moneda de salario −{p}% en los últimos 3 días (¿felicidad? impuestos, almacén lleno, batallas)',
    sigUp: 'Producción por moneda de salario +{p}% en los últimos 3 días — el entrenamiento rinde',
    sigNoEmp: 'Sin producción de empleados en los últimos {n} días',
    sigFull: 'Almacén lleno: la felicidad baja hasta que lo vacíes',
    sigNegValue: 'Los insumos cuestan más que el producto: cada punto pierde dinero',
    sigNoStats: 'Estadísticas de trabajo no disponibles para esta empresa',
    sigDisabled: 'Desactivada (sobre el tope de Empresas): no rinde nada',
    sparkHint: 'Producción de los empleados, últimos 31 días',
    coNote: 'Últimos {n} días completos (UTC). Valor del punto = (precio − insumos) ÷ puntos de producción. Coste del punto = salarios pagados ÷ puntos de tus empleados. El juego no muestra los empleados uno a uno a otras herramientas — solo estos totales por empresa — así que cuántos son, su felicidad y herramientas no se ven aquí.',
    curLabel: 'Ahora', recLabel: 'Recomendado', pointsUsed: '{used}/{budget} pts', available: 'disponibles',
    brkPassive: 'empresas {g}', brkSelf: 'tu trabajo {g}',
    skBudget: '{b} puntos en estas cuatro habilidades ({f} sin gastar). Las de combate y Leadership no se tocan.',
    skSelf: 'Trabajo propio en', skSelfDetail: '{v}/pt · {a} acciones/día',
    skSelfNone: 'A los precios actuales el trabajo propio no rinde en ninguna de tus empresas.',
    skMgmt: 'Management N{l}: +{p}% de producción de los empleados',
    skCap: 'Con Companies N{l} quedan activas {k} de tus {n} empresas: las demás dejan de producir.',
    skLeader: 'Leadership N{l} se queda igual: mejora entrenamiento y eventos, que no tienen valor en oro.',
    skNote: 'Supone que toda la energía regenerada en 24 h va al trabajo propio (10 por acción). No cuenta la energía para contratar y entrenar ni un posible mánager. Con la v0.27 todos tienen un reinicio de habilidades gratis.',
    noCompanies: 'No se encontraron empresas propias.',
    errNotFound: 'No se encontró ningún jugador con ese nombre o ID.', errAmbiguous: 'Varios jugadores coinciden — sé más específico:',
    errGeneric: 'Algo salió mal al analizar. Inténtalo de nuevo en un momento.',
    setupTitle: 'Estadísticas de trabajo no disponibles',
    setupBody: 'La producción y los salarios de las empresas (work.getStatsByCompany) necesitan la clave API del servidor. El proxy no la está añadiendo: comprueba que el servidor de caché tenga WARERA_API_TOKEN (/health → trpcProxy.apiKey).',
    emptyHint: 'Introduce arriba un usuario o ID de WarEra para analizar sus empresas.',
    otherMatched: 'también coinciden: {names}',
  },
  de: {
    title: 'Industrie-Optimierer', subtitle: 'Was deine Angestellten dir wirklich bringen, Firma für Firma, und die Wirtschafts-Skills, die am meisten daraus machen.',
    creditBy: 'Tool erdacht von', viewProfile: 'Profil ansehen', level: 'Level',
    inputPh: 'WarEra-Name oder ID…', analyze: 'Analysieren', analyzing: 'Analysiere…', remember: 'Diesen Spieler merken',
    goldDay: 'Gold/Tag', perPt: '/Pkt',
    secCompanies: 'Firmen', secSkills: 'Skills',
    coHead: 'Gold/Tag von Angestellten', coLosing: '{n} mit Verlust',
    lblEmployees: 'Angestellte', lblPtsDay: '{p} Pkt/Tag', lblCost: 'kosten {c}/Pkt', lblValue: 'wert {v}/Pkt',
    lblBreakRoom: 'Pausenraum L{l} · bis {n}', lblEngine: 'Motor L{l}', lblSelf: 'eigene Arbeit', lblTax: 'Einkommensteuer {t}%',
    sigLoss: 'Verlust: die Angestellten kosten mehr, als ihre Produktion wert ist',
    sigIdle: '{n} Tag(e), an denen niemand gearbeitet hat — Stundenlohn nicht gedeckt?',
    sigDown: 'Produktion pro Lohnmünze −{p}% in den letzten 3 Tagen (Zufriedenheit? Steuern, volles Lager, Schlachten)',
    sigUp: 'Produktion pro Lohnmünze +{p}% in den letzten 3 Tagen — das Training zahlt sich aus',
    sigNoEmp: 'Keine Produktion von Angestellten in den letzten {n} Tagen',
    sigFull: 'Lager voll: die Zufriedenheit sinkt, bis du es leerst',
    sigNegValue: 'Rohstoffe kosten mehr als das Produkt: jeder Punkt macht Verlust',
    sigNoStats: 'Arbeitsstatistik für diese Firma nicht verfügbar',
    sigDisabled: 'Deaktiviert (über dem Firmen-Cap): bringt nichts',
    sparkHint: 'Produktion der Angestellten, letzte 31 Tage',
    coNote: 'Letzte {n} volle Tage (UTC). Wert pro Punkt = (Preis − Rohstoffe) ÷ Produktionspunkte. Kosten pro Punkt = tatsächlich gezahlte Löhne ÷ Punkte deiner Angestellten. Das Spiel zeigt anderen Tools keine einzelnen Angestellten — nur diese Firmensummen — Anzahl, Zufriedenheit und Werkzeuge sind hier also nicht sichtbar.',
    curLabel: 'Jetzt', recLabel: 'Empfohlen', pointsUsed: '{used}/{budget} Pkt', available: 'verfügbar',
    brkPassive: 'Firmen {g}', brkSelf: 'eigene Arbeit {g}',
    skBudget: '{b} Punkte in diesen vier Skills ({f} unverteilt). Kampf-Skills und Leadership bleiben unberührt.',
    skSelf: 'Selbst arbeiten in', skSelfDetail: '{v}/Pkt · {a} Aktionen/Tag',
    skSelfNone: 'Zu aktuellen Preisen bringt eigene Arbeit in keiner deiner Firmen etwas.',
    skMgmt: 'Management L{l}: +{p}% Produktion der Angestellten',
    skCap: 'Mit Companies L{l} bleiben {k} deiner {n} Firmen aktiv: die anderen produzieren nicht mehr.',
    skLeader: 'Leadership L{l} bleibt, wie es ist: verbessert Training und Ereignisse, die keinen Goldwert haben.',
    skNote: 'Nimmt an, dass die gesamte in 24 h regenerierte Energie in eigene Arbeit geht (10 pro Aktion). Energie für Einstellen und Training sowie ein Manager sind nicht eingerechnet. Mit v0.27 gibt es für alle einen kostenlosen Skill-Reset.',
    noCompanies: 'Keine eigenen Firmen gefunden.',
    errNotFound: 'Kein Spieler mit diesem Namen oder ID gefunden.', errAmbiguous: 'Mehrere Spieler passen — sei genauer:',
    errGeneric: 'Bei der Analyse ging etwas schief. Versuch es gleich nochmal.',
    setupTitle: 'Arbeitsstatistik nicht erreichbar',
    setupBody: 'Produktion und Löhne der Firmen (work.getStatsByCompany) brauchen den serverseitigen API-Key. Der Proxy fügt ihn gerade nicht hinzu — prüfe, ob der Cache-Server WARERA_API_TOKEN geladen hat (/health → trpcProxy.apiKey).',
    emptyHint: 'Gib oben einen WarEra-Namen oder eine ID ein, um die Firmen dieses Spielers zu analysieren.',
    otherMatched: 'ebenfalls gefunden: {names}',
  },
  fr: {
    title: 'Optimiseur industriel', subtitle: 'Ce que tes employés te rapportent vraiment, entreprise par entreprise, et les compétences économiques qui en tirent le plus.',
    creditBy: 'Outil imaginé par', viewProfile: 'Voir le profil', level: 'Niveau',
    inputPh: 'Pseudo ou ID WarEra…', analyze: 'Analyser', analyzing: 'Analyse…', remember: 'Se souvenir de ce joueur',
    goldDay: 'or/jour', perPt: '/pt',
    secCompanies: 'Entreprises', secSkills: 'Compétences',
    coHead: 'or/jour grâce aux employés', coLosing: '{n} à perte',
    lblEmployees: 'Employés', lblPtsDay: '{p} pts/jour', lblCost: 'coûtent {c}/pt', lblValue: 'valent {v}/pt',
    lblBreakRoom: 'salle de pause N{l} · jusqu\'à {n}', lblEngine: 'moteur N{l}', lblSelf: 'ton travail', lblTax: 'impôt sur le revenu {t}%',
    sigLoss: 'À perte : les employés coûtent plus que ce que vaut leur production',
    sigIdle: '{n} jour(s) où personne n\'a travaillé — salaire horaire non couvert ?',
    sigDown: 'Production par pièce de salaire −{p}% sur les 3 derniers jours (bonheur ? impôts, stock plein, batailles)',
    sigUp: 'Production par pièce de salaire +{p}% sur les 3 derniers jours — l\'entraînement paie',
    sigNoEmp: 'Aucune production d\'employés sur les {n} derniers jours',
    sigFull: 'Stock plein : le bonheur baisse tant que tu ne le vides pas',
    sigNegValue: 'Les matières premières coûtent plus que le produit : chaque point perd de l\'argent',
    sigNoStats: 'Statistiques de travail indisponibles pour cette entreprise',
    sigDisabled: 'Désactivée (au-delà du plafond Entreprises) : ne rapporte rien',
    sparkHint: 'Production des employés, 31 derniers jours',
    coNote: '{n} derniers jours complets (UTC). Valeur du point = (prix − matières premières) ÷ points de production. Coût du point = salaires réellement payés ÷ points de tes employés. Le jeu ne montre pas les employés un par un aux autres outils — seulement ces totaux par entreprise — donc leur nombre, leur bonheur et leurs outils ne sont pas visibles ici.',
    curLabel: 'Actuel', recLabel: 'Recommandé', pointsUsed: '{used}/{budget} pts', available: 'disponibles',
    brkPassive: 'entreprises {g}', brkSelf: 'ton travail {g}',
    skBudget: '{b} points dans ces quatre compétences ({f} non dépensés). Combat et Leadership ne sont pas touchés.',
    skSelf: 'Travail personnel à', skSelfDetail: '{v}/pt · {a} actions/jour',
    skSelfNone: 'Aux prix actuels, le travail personnel ne rapporte rien dans aucune de tes entreprises.',
    skMgmt: 'Management N{l} : +{p}% de production des employés',
    skCap: 'Avec Companies N{l}, {k} de tes {n} entreprises restent actives : les autres arrêtent de produire.',
    skLeader: 'Leadership N{l} reste tel quel : il améliore entraînement et événements, qui n\'ont pas de valeur en or.',
    skNote: 'Suppose que toute l\'énergie régénérée en 24 h va dans le travail personnel (10 par action). L\'énergie pour embaucher et entraîner, et un éventuel manager, ne sont pas comptés. Avec la v0.27 tout le monde a une réinitialisation gratuite des compétences.',
    noCompanies: 'Aucune entreprise possédée trouvée.',
    errNotFound: 'Aucun joueur trouvé avec ce nom ou cet ID.', errAmbiguous: 'Plusieurs joueurs correspondent — sois plus précis :',
    errGeneric: 'Un problème est survenu pendant l\'analyse. Réessaie dans un instant.',
    setupTitle: 'Statistiques de travail injoignables',
    setupBody: 'La production et les salaires des entreprises (work.getStatsByCompany) demandent la clé API côté serveur. Le proxy ne l\'ajoute pas en ce moment — vérifie que le serveur de cache a WARERA_API_TOKEN (/health → trpcProxy.apiKey).',
    emptyHint: 'Saisis ci-dessus un pseudo ou un ID WarEra pour analyser les entreprises de ce joueur.',
    otherMatched: 'correspondent aussi : {names}',
  },
  nl: {
    title: 'Industriële optimizer', subtitle: 'Wat je werknemers je echt opleveren, bedrijf per bedrijf, en de economische skills die er het meeste uit halen.',
    creditBy: 'Tool bedacht door', viewProfile: 'Profiel bekijken', level: 'Level',
    inputPh: 'WarEra-naam of ID…', analyze: 'Analyseren', analyzing: 'Analyseren…', remember: 'Deze speler onthouden',
    goldDay: 'goud/dag', perPt: '/pt',
    secCompanies: 'Bedrijven', secSkills: 'Skills',
    coHead: 'goud/dag van werknemers', coLosing: '{n} met verlies',
    lblEmployees: 'Werknemers', lblPtsDay: '{p} pt/dag', lblCost: 'kosten {c}/pt', lblValue: 'waard {v}/pt',
    lblBreakRoom: 'pauzeruimte L{l} · tot {n}', lblEngine: 'motor L{l}', lblSelf: 'eigen werk', lblTax: 'inkomstenbelasting {t}%',
    sigLoss: 'Verlies: de werknemers kosten meer dan hun productie waard is',
    sigIdle: '{n} dag(en) waarop niemand werkte — uurloon niet gedekt?',
    sigDown: 'Productie per loonmunt −{p}% in de laatste 3 dagen (geluk? belastingen, volle opslag, gevechten)',
    sigUp: 'Productie per loonmunt +{p}% in de laatste 3 dagen — de training loont',
    sigNoEmp: 'Geen productie van werknemers in de laatste {n} dagen',
    sigFull: 'Opslag vol: het geluk daalt tot je hem leegmaakt',
    sigNegValue: 'Grondstoffen kosten meer dan het product: elk punt maakt verlies',
    sigNoStats: 'Werkstatistieken niet beschikbaar voor dit bedrijf',
    sigDisabled: 'Uitgeschakeld (boven de Bedrijven-cap): levert niets op',
    sparkHint: 'Productie van werknemers, laatste 31 dagen',
    coNote: 'Laatste {n} volle dagen (UTC). Waarde per punt = (prijs − grondstoffen) ÷ productiepunten. Kosten per punt = echt betaalde lonen ÷ punten van je werknemers. Het spel toont andere tools geen individuele werknemers — alleen deze bedrijfstotalen — dus aantal, geluk en gereedschap zijn hier niet zichtbaar.',
    curLabel: 'Nu', recLabel: 'Aanbevolen', pointsUsed: '{used}/{budget} pnt', available: 'beschikbaar',
    brkPassive: 'bedrijven {g}', brkSelf: 'eigen werk {g}',
    skBudget: '{b} punten in deze vier skills ({f} niet besteed). Gevechtsskills en Leadership blijven ongemoeid.',
    skSelf: 'Zelf werken bij', skSelfDetail: '{v}/pt · {a} acties/dag',
    skSelfNone: 'Tegen de huidige prijzen levert zelf werken in geen van je bedrijven iets op.',
    skMgmt: 'Management L{l}: +{p}% productie van werknemers',
    skCap: 'Met Companies L{l} blijven {k} van je {n} bedrijven actief: de andere stoppen met produceren.',
    skLeader: 'Leadership L{l} blijft zoals het is: het verbetert training en gebeurtenissen, die geen goudwaarde hebben.',
    skNote: 'Gaat ervan uit dat alle in 24 uur geregenereerde energie naar eigen werk gaat (10 per actie). Energie voor aannemen en trainen en een eventuele manager zijn niet meegeteld. Met v0.27 krijgt iedereen één gratis skill-reset.',
    noCompanies: 'Geen eigen bedrijven gevonden.',
    errNotFound: 'Geen speler gevonden met die naam of ID.', errAmbiguous: 'Meerdere spelers matchen — wees specifieker:',
    errGeneric: 'Er ging iets mis bij het analyseren. Probeer het zo opnieuw.',
    setupTitle: 'Werkstatistieken niet bereikbaar',
    setupBody: 'Productie en lonen van bedrijven (work.getStatsByCompany) hebben de API-key aan serverkant nodig. De proxy voegt hem nu niet toe — controleer of de cacheserver WARERA_API_TOKEN geladen heeft (/health → trpcProxy.apiKey).',
    emptyHint: 'Voer hierboven een WarEra-naam of ID in om de bedrijven van die speler te analyseren.',
    otherMatched: 'ook gevonden: {names}',
  },
  sv: {
    title: 'Industrioptimerare', subtitle: 'Vad dina anställda verkligen ger dig, företag för företag, och de ekonomiska färdigheter som får ut mest av det.',
    creditBy: 'Verktyg skapat av', viewProfile: 'Visa profil', level: 'Nivå',
    inputPh: 'WarEra-namn eller ID…', analyze: 'Analysera', analyzing: 'Analyserar…', remember: 'Kom ihåg denna spelare',
    goldDay: 'guld/dag', perPt: '/p',
    secCompanies: 'Företag', secSkills: 'Färdigheter',
    coHead: 'guld/dag från anställda', coLosing: '{n} går med förlust',
    lblEmployees: 'Anställda', lblPtsDay: '{p} p/dag', lblCost: 'kostar {c}/p', lblValue: 'värda {v}/p',
    lblBreakRoom: 'personalrum N{l} · upp till {n}', lblEngine: 'motor N{l}', lblSelf: 'ditt arbete', lblTax: 'inkomstskatt {t}%',
    sigLoss: 'Förlust: de anställda kostar mer än deras produktion är värd',
    sigIdle: '{n} dag(ar) då ingen arbetade — timlönen inte täckt?',
    sigDown: 'Produktion per lönemynt −{p}% senaste 3 dagarna (trivsel? skatter, fullt lager, strider)',
    sigUp: 'Produktion per lönemynt +{p}% senaste 3 dagarna — träningen lönar sig',
    sigNoEmp: 'Ingen produktion från anställda de senaste {n} dagarna',
    sigFull: 'Lagret är fullt: trivseln sjunker tills du tömmer det',
    sigNegValue: 'Råvarorna kostar mer än produkten: varje poäng går med förlust',
    sigNoStats: 'Arbetsstatistik saknas för detta företag',
    sigDisabled: 'Inaktiverat (över Företag-taket): ger inget',
    sparkHint: 'Anställdas produktion, senaste 31 dagarna',
    coNote: 'Senaste {n} hela dagarna (UTC). Värde per poäng = (pris − råvaror) ÷ produktionspoäng. Kostnad per poäng = faktiskt betalda löner ÷ poäng från dina anställda. Spelet visar inte enskilda anställda för andra verktyg — bara dessa företagssummor — så antal, trivsel och verktyg syns inte här.',
    curLabel: 'Nu', recLabel: 'Rekommenderat', pointsUsed: '{used}/{budget} p', available: 'tillgängligt',
    brkPassive: 'företag {g}', brkSelf: 'eget arbete {g}',
    skBudget: '{b} poäng i dessa fyra färdigheter ({f} ospenderade). Stridsfärdigheter och Leadership lämnas orörda.',
    skSelf: 'Eget arbete i', skSelfDetail: '{v}/p · {a} handlingar/dag',
    skSelfNone: 'Med dagens priser ger eget arbete inget i något av dina företag.',
    skMgmt: 'Management N{l}: +{p}% produktion från anställda',
    skCap: 'Med Companies N{l} är {k} av dina {n} företag aktiva: de andra slutar producera.',
    skLeader: 'Leadership N{l} lämnas som den är: den förbättrar träning och händelser, som inte har något guldvärde.',
    skNote: 'Antar att all energi som återhämtas på 24 h går till eget arbete (10 per handling). Energi för anställning och träning och en eventuell manager räknas inte. Med v0.27 får alla en gratis återställning av färdigheter.',
    noCompanies: 'Inga egna företag hittades.',
    errNotFound: 'Ingen spelare hittades med det namnet eller ID:t.', errAmbiguous: 'Flera spelare matchar — var mer specifik:',
    errGeneric: 'Något gick fel vid analysen. Försök igen strax.',
    setupTitle: 'Arbetsstatistik inte nåbar',
    setupBody: 'Företagens produktion och löner (work.getStatsByCompany) kräver API-nyckeln på serversidan. Proxyn lägger inte till den just nu — kontrollera att cacheservern har WARERA_API_TOKEN (/health → trpcProxy.apiKey).',
    emptyHint: 'Skriv ett WarEra-namn eller ID ovan för att analysera den spelarens företag.',
    otherMatched: 'matchade även: {names}',
  },
  pt: {
    title: 'Otimizador industrial', subtitle: 'O que os teus empregados te rendem de verdade, empresa a empresa, e as habilidades económicas que mais tiram partido disso.',
    creditBy: 'Ferramenta idealizada por', viewProfile: 'Ver perfil', level: 'Nível',
    inputPh: 'Utilizador ou ID WarEra…', analyze: 'Analisar', analyzing: 'A analisar…', remember: 'Lembrar este jogador',
    goldDay: 'ouro/dia', perPt: '/pt',
    secCompanies: 'Empresas', secSkills: 'Habilidades',
    coHead: 'ouro/dia dos empregados', coLosing: '{n} com prejuízo',
    lblEmployees: 'Empregados', lblPtsDay: '{p} pts/dia', lblCost: 'custam {c}/pt', lblValue: 'valem {v}/pt',
    lblBreakRoom: 'sala de descanso N{l} · até {n}', lblEngine: 'motor N{l}', lblSelf: 'o teu trabalho', lblTax: 'imposto sobre o rendimento {t}%',
    sigLoss: 'Com prejuízo: os empregados custam mais do que vale o que produzem',
    sigIdle: '{n} dia(s) sem ninguém a trabalhar — o salário por hora não foi coberto?',
    sigDown: 'Produção por moeda de salário −{p}% nos últimos 3 dias (felicidade? impostos, armazém cheio, batalhas)',
    sigUp: 'Produção por moeda de salário +{p}% nos últimos 3 dias — o treino está a compensar',
    sigNoEmp: 'Sem produção de empregados nos últimos {n} dias',
    sigFull: 'Armazém cheio: a felicidade desce até o esvaziares',
    sigNegValue: 'As matérias-primas custam mais do que o produto: cada ponto dá prejuízo',
    sigNoStats: 'Estatísticas de trabalho indisponíveis para esta empresa',
    sigDisabled: 'Desativada (acima do limite de Empresas): não rende nada',
    sparkHint: 'Produção dos empregados, últimos 31 dias',
    coNote: 'Últimos {n} dias completos (UTC). Valor do ponto = (preço − matérias-primas) ÷ pontos de produção. Custo do ponto = salários pagos de facto ÷ pontos dos teus empregados. O jogo não mostra os empregados um a um a outras ferramentas — só estes totais por empresa — por isso quantos são, a felicidade e as ferramentas não se veem aqui.',
    curLabel: 'Agora', recLabel: 'Recomendado', pointsUsed: '{used}/{budget} pts', available: 'disponíveis',
    brkPassive: 'empresas {g}', brkSelf: 'o teu trabalho {g}',
    skBudget: '{b} pontos nestas quatro habilidades ({f} por gastar). Combate e Leadership não são tocados.',
    skSelf: 'Trabalho próprio em', skSelfDetail: '{v}/pt · {a} ações/dia',
    skSelfNone: 'Aos preços atuais o trabalho próprio não rende em nenhuma das tuas empresas.',
    skMgmt: 'Management N{l}: +{p}% de produção dos empregados',
    skCap: 'Com Companies N{l} ficam ativas {k} das tuas {n} empresas: as outras deixam de produzir.',
    skLeader: 'Leadership N{l} fica como está: melhora treino e eventos, que não têm valor em ouro.',
    skNote: 'Assume que toda a energia regenerada em 24 h vai para trabalho próprio (10 por ação). A energia para contratar e treinar e um eventual gestor não são contados. Com a v0.27 todos têm um reset de habilidades grátis.',
    noCompanies: 'Nenhuma empresa própria encontrada.',
    errNotFound: 'Nenhum jogador encontrado com esse nome ou ID.', errAmbiguous: 'Vários jogadores correspondem — sê mais específico:',
    errGeneric: 'Algo correu mal na análise. Tenta novamente daqui a pouco.',
    setupTitle: 'Estatísticas de trabalho inacessíveis',
    setupBody: 'A produção e os salários das empresas (work.getStatsByCompany) precisam da chave API do servidor. O proxy não a está a adicionar — verifica que o servidor de cache tem WARERA_API_TOKEN (/health → trpcProxy.apiKey).',
    emptyHint: 'Introduz acima um utilizador ou ID WarEra para analisar as empresas desse jogador.',
    otherMatched: 'também correspondem: {names}',
  },
  ar: {
    title: 'محسِّن صناعي', subtitle: 'ما يدرّه عليك موظفوك فعلًا، شركة بشركة، والمهارات الاقتصادية التي تستفيد منه أكثر.',
    creditBy: 'أداة من ابتكار', viewProfile: 'عرض الملف', level: 'المستوى',
    inputPh: 'اسم أو معرّف WarEra…', analyze: 'حلّل', analyzing: 'جارٍ التحليل…', remember: 'تذكّر هذا اللاعب',
    goldDay: 'ذهب/يوم', perPt: '/نقطة',
    secCompanies: 'الشركات', secSkills: 'المهارات',
    coHead: 'ذهب/يوم من الموظفين', coLosing: '{n} خاسرة',
    lblEmployees: 'الموظفون', lblPtsDay: '{p} نقطة/يوم', lblCost: 'تكلفة {c}/نقطة', lblValue: 'قيمة {v}/نقطة',
    lblBreakRoom: 'غرفة الاستراحة م{l} · حتى {n}', lblEngine: 'المحرك م{l}', lblSelf: 'عملك', lblTax: 'ضريبة الدخل {t}%',
    sigLoss: 'خسارة: الموظفون يكلّفون أكثر من قيمة ما ينتجونه',
    sigIdle: '{n} يوم لم يعمل فيه أحد — هل لم يُغطَّ الأجر بالساعة؟',
    sigDown: 'الإنتاج لكل عملة أجر −{p}% في آخر 3 أيام (السعادة؟ الضرائب، مخزن ممتلئ، معارك)',
    sigUp: 'الإنتاج لكل عملة أجر +{p}% في آخر 3 أيام — التدريب يؤتي ثماره',
    sigNoEmp: 'لا إنتاج من الموظفين في آخر {n} أيام',
    sigFull: 'المخزن ممتلئ: تنخفض السعادة حتى تفرغه',
    sigNegValue: 'المواد الخام أغلى من المنتج: كل نقطة خاسرة',
    sigNoStats: 'إحصاءات العمل غير متاحة لهذه الشركة',
    sigDisabled: 'معطّلة (فوق حد الشركات): لا تدرّ شيئًا',
    sparkHint: 'إنتاج الموظفين، آخر 31 يومًا',
    coNote: 'آخر {n} أيام كاملة (UTC). قيمة النقطة = (السعر − المواد الخام) ÷ نقاط الإنتاج. تكلفة النقطة = الأجور المدفوعة فعلًا ÷ نقاط موظفيك. لا تعرض اللعبة الموظفين فرادى للأدوات الأخرى — فقط هذه المجاميع لكل شركة — لذا لا يظهر هنا عددهم ولا سعادتهم ولا أدواتهم.',
    curLabel: 'الآن', recLabel: 'موصى به', pointsUsed: '{used}/{budget} نقطة', available: 'متاح',
    brkPassive: 'الشركات {g}', brkSelf: 'عملك {g}',
    skBudget: '{b} نقطة في هذه المهارات الأربع ({f} غير مصروفة). مهارات القتال وLeadership لا تُمس.',
    skSelf: 'العمل الذاتي في', skSelfDetail: '{v}/نقطة · {a} إجراء/يوم',
    skSelfNone: 'بالأسعار الحالية لا يدرّ العمل الذاتي شيئًا في أي من شركاتك.',
    skMgmt: 'Management م{l}: +{p}% من إنتاج الموظفين',
    skCap: 'مع Companies م{l} تبقى {k} من شركاتك الـ{n} نشطة: البقية تتوقف عن الإنتاج.',
    skLeader: 'تبقى Leadership م{l} كما هي: تحسّن التدريب والأحداث، وليس لها قيمة بالذهب.',
    skNote: 'يفترض أن كل الطاقة المستعادة خلال 24 ساعة تذهب إلى العمل الذاتي (10 لكل إجراء). لا تُحتسب طاقة التوظيف والتدريب ولا أي مدير توظفه. مع v0.27 يحصل الجميع على إعادة تعيين مجانية للمهارات.',
    noCompanies: 'لم يُعثر على شركات مملوكة.',
    errNotFound: 'لم يُعثر على لاعب بهذا الاسم أو المعرّف.', errAmbiguous: 'عدة لاعبين مطابقون — كن أكثر تحديدًا:',
    errGeneric: 'حدث خطأ أثناء التحليل. حاول مرة أخرى بعد لحظة.',
    setupTitle: 'إحصاءات العمل غير قابلة للوصول',
    setupBody: 'إنتاج الشركات وأجورها (work.getStatsByCompany) تحتاج مفتاح API من جهة الخادم. الوسيط لا يضيفه الآن — تحقّق أن خادم التخزين المؤقت حمّل WARERA_API_TOKEN (/health ← trpcProxy.apiKey).',
    emptyHint: 'أدخل اسم أو معرّف WarEra بالأعلى لتحليل شركات ذلك اللاعب.',
    otherMatched: 'طابق أيضًا: {names}',
  },
};
function tf(key, params) {
  let s = (DICT[getLang()] || DICT.en)[key] ?? DICT.en[key] ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

// ── Helper DOM/format ─────────────────────────────────────────────
const LAST_USER_KEY = 'we_eco_lastuser';
function h(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function f(n, d = 2) { return Number(n).toFixed(d); }
/** Numero con segno, per i margini: "+12.30" / "−4.10". */
function signed(n, d = 2) { return n >= 0 ? `+${f(n, d)}` : `−${f(-n, d)}`; }

// ══════════════════════════════════════════════════════════════
// Costruzione vista
// ══════════════════════════════════════════════════════════════
let built = false;
let builtLang = null;      // lingua con cui è stato costruito l'ultima volta
let containerEl = null;    // per ricostruire al cambio lingua
let rootEl, inputEl, rememberEl, runBtn, resultsEl, devKeyEl;

// BUG FIX (segnalato dall'utente: "tool ottimizzazione ancora non tradotto").
// initEcoView costruiva UNA sola volta (guardia `built`) e non si ritraduceva
// mai: aperto una volta in una lingua, restava in quella per sempre anche
// cambiando lingua all'app. Ora si ricostruisce se la lingua è cambiata —
// alla riapertura (guardia qui sotto) e dal vivo (listener langchange).
let _ecoLangBound = false;
function _bindEcoLangListener() {
  if (_ecoLangBound) return;
  _ecoLangBound = true;
  window.addEventListener('wareraplus:langchange', () => {
    if (!containerEl || !rootEl?.isConnected) return;
    built = false; // forza la ricostruzione nella nuova lingua
    initEcoView(containerEl);
  });
}

export function initEcoView(container) {
  containerEl = container;
  _bindEcoLangListener();
  if (built && rootEl?.isConnected && builtLang === getLang()) return;
  container.innerHTML = '';
  rootEl = h('div', 'wp-eco');
  rootEl.appendChild(buildCreditCard());

  const head = h('div', 'wp-eco-head');
  head.appendChild(h('h1', 'wp-eco-title', esc(tf('title'))));
  head.appendChild(h('p', 'wp-eco-subtitle', esc(tf('subtitle'))));
  rootEl.appendChild(head);

  const form = h('form', 'wp-eco-form');
  if (isDevApi()) {
    form.appendChild(h('div', 'wp-eco-devbanner', esc(tf('devBanner'))));
    devKeyEl = h('input', 'wp-eco-input wp-eco-devkey');
    devKeyEl.type = 'password'; devKeyEl.autocomplete = 'off'; devKeyEl.placeholder = tf('devKeyPh');
    devKeyEl.addEventListener('change', () => setDevApiKey(devKeyEl.value));
    if (hasDevApiKey()) devKeyEl.placeholder = '••••••••';
    form.appendChild(devKeyEl);
  }
  const row = h('div', 'wp-eco-inputrow');
  inputEl = h('input', 'wp-eco-input');
  inputEl.type = 'text'; inputEl.placeholder = tf('inputPh'); inputEl.autocomplete = 'off';
  inputEl.value = localStorage.getItem(LAST_USER_KEY) || '';
  runBtn = h('button', 'wp-eco-run'); runBtn.type = 'submit'; runBtn.textContent = tf('analyze');
  row.appendChild(inputEl); row.appendChild(runBtn); form.appendChild(row);

  const adv = h('div', 'wp-eco-adv');
  const remWrap = h('label', 'wp-eco-remember');
  rememberEl = h('input'); rememberEl.type = 'checkbox'; rememberEl.checked = !!localStorage.getItem(LAST_USER_KEY);
  remWrap.appendChild(rememberEl); remWrap.appendChild(h('span', null, esc(tf('remember'))));
  adv.appendChild(remWrap); form.appendChild(adv);
  rootEl.appendChild(form);

  resultsEl = h('div', 'wp-eco-results');
  resultsEl.appendChild(h('div', 'wp-eco-empty', esc(tf('emptyHint'))));
  rootEl.appendChild(resultsEl);

  form.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  container.appendChild(rootEl);
  built = true;
  builtLang = getLang();
}

function buildCreditCard() {
  const card = h('a', 'wp-eco-credit');
  card.href = AUTHOR.profileUrl; card.target = '_blank'; card.rel = 'noopener noreferrer';
  card.innerHTML = `
    <div class="wp-eco-credit-avatar" aria-hidden="true">${esc(AUTHOR.username.slice(0, 1).toUpperCase())}</div>
    <div class="wp-eco-credit-body">
      <div class="wp-eco-credit-by">${esc(tf('creditBy'))}</div>
      <div class="wp-eco-credit-name">${esc(AUTHOR.username)}</div>
      <div class="wp-eco-credit-meta" data-eco-credit-meta></div>
    </div>
    <div class="wp-eco-credit-cta">${esc(tf('viewProfile'))} ↗</div>`;
  enrichCreditCard(card.querySelector('[data-eco-credit-meta]'));
  return card;
}
async function enrichCreditCard(metaEl) {
  if (!metaEl) return;
  try {
    // WarEra+: passa dal server di cache Oracle (fetchCreditProfileViaCache
    // 'argus', vedi cacheClient.js e server/warera-cache-server.js:
    // pollCreditProfiles) invece di chiamare il Worker direttamente da
    // OGNI browser che apre l'Ottimizzatore — stesso identico dato
    // statico, prima richiesto uno per utente. Ricade comunque sulla
    // chiamata diretta se la cache non risponde, nessuna regressione.
    const data = await fetchCreditProfileViaCache('argus');
    if (!data) return;
    // Foto profilo reale di ArgusIA (prima c'era solo l'iniziale "A").
    if (data.avatarUrl) {
      const avatarEl = metaEl.closest('.wp-eco-credit')?.querySelector('.wp-eco-credit-avatar');
      if (avatarEl) {
        const img = document.createElement('img');
        img.src = data.avatarUrl;
        img.alt = '';
        img.onerror = () => { avatarEl.classList.remove('has-img'); img.remove(); };
        avatarEl.textContent = '';
        avatarEl.classList.add('has-img');
        avatarEl.appendChild(img);
      }
    }
    const parts = [];
    if (data.leveling?.level != null) parts.push(`${tf('level')} ${data.leveling.level}`);
    try {
      const { state } = await import('../diplomacy/state.js');
      const nation = state.nationMap?.get(data.country);
      if (nation?.name) parts.push(esc(nation.name));
    } catch (_) {}
    metaEl.textContent = parts.join(' · ');
  } catch (_) {}
}

// ══════════════════════════════════════════════════════════════
// Analisi
// ══════════════════════════════════════════════════════════════
let running = false;
async function run() {
  if (running) return;
  const query = inputEl.value.trim();
  if (!query) { inputEl.focus(); return; }
  if (devKeyEl && devKeyEl.value) setDevApiKey(devKeyEl.value);

  running = true;
  runBtn.disabled = true; runBtn.textContent = tf('analyzing');
  resultsEl.innerHTML = '';
  resultsEl.appendChild(h('div', 'wp-eco-loading', `<span class="wp-eco-spinner"></span>${esc(tf('analyzing'))}`));

  if (rememberEl.checked) localStorage.setItem(LAST_USER_KEY, query);
  else localStorage.removeItem(LAST_USER_KEY);

  try {
    const { userId, otherMatches } = await resolveUserId(query);
    const gd = makeGameData(await loadGameData());
    const [owned, me] = await Promise.all([
      loadOwnedCompanies(gd, userId),
      ecoCall('user.getUserLite', { userId }),
    ]);
    if (!me) throw new EcoProxyUnavailableError('user.getUserLite null');

    const companies = computeCompanies(gd, owned);
    const skills = computeSkills(gd, me, companies);

    resultsEl.innerHTML = '';
    if (otherMatches.length) {
      resultsEl.appendChild(h('div', 'wp-eco-note',
        `<strong>${esc(me.username || userId)}</strong> · ${esc(tf('otherMatched', { names: otherMatches.join(', ') }))}`));
    }
    resultsEl.appendChild(renderCompanies(companies));
    resultsEl.appendChild(renderSkills(skills, companies));

    trackEvent('eco-analyze', { companies: owned.length, losing: companies.losing });
  } catch (err) {
    resultsEl.innerHTML = '';
    if (err instanceof EcoProxyUnavailableError) resultsEl.appendChild(renderSetup());
    else if (err instanceof UserNotFoundError) resultsEl.appendChild(h('div', 'wp-eco-error', esc(tf('errNotFound'))));
    else if (err instanceof AmbiguousUserError) resultsEl.appendChild(h('div', 'wp-eco-error', `${esc(tf('errAmbiguous'))}<br>${esc(err.candidates.join(', '))}`));
    else { console.error('eco-analyze error:', err); resultsEl.appendChild(h('div', 'wp-eco-error', esc(tf('errGeneric')))); }
  } finally {
    running = false; runBtn.disabled = false; runBtn.textContent = tf('analyze');
  }
}

function renderSetup() {
  // In prova il proxy non c'entra: le chiamate vanno dritte ad apidev con
  // la chiave incollata sopra, quindi l'unica causa sensata è quella.
  const body = isDevApi() ? tf('devKeyMissing') : tf('setupBody');
  return h('div', 'wp-eco-setup', `<strong>${esc(tf('setupTitle'))}</strong><p>${esc(body)}</p>`);
}

// ══════════════════════════════════════════════════════════════
// Rendering
// ══════════════════════════════════════════════════════════════
function section(titleText, headlineHtml, headlineClass) {
  const sec = h('section', 'wp-eco-section');
  const head = h('div', 'wp-eco-sec-head');
  head.appendChild(h('h2', 'wp-eco-sec-title', esc(titleText)));
  if (headlineHtml) head.appendChild(h('div', `wp-eco-sec-headline ${headlineClass || ''}`, headlineHtml));
  sec.appendChild(head);
  return sec;
}

// ── Aziende ───────────────────────────────────────────────────────
const SIGNAL_VIEW = {
  loss:        { emoji: '🔴', cls: 'bad',  text: () => tf('sigLoss') },
  negValue:    { emoji: '🔴', cls: 'bad',  text: () => tf('sigNegValue') },
  full:        { emoji: '🟠', cls: 'warn', text: () => tf('sigFull') },
  down:        { emoji: '🟡', cls: 'warn', text: s => tf('sigDown', { p: f(s.pct, 0) }) },
  idle:        { emoji: '⚫', cls: 'warn', text: s => tf('sigIdle', { n: s.days }) },
  noEmployees: { emoji: '⚪', cls: 'dim',  text: s => tf('sigNoEmp', { n: s.days }) },
  disabled:    { emoji: '⚪', cls: 'dim',  text: () => tf('sigDisabled') },
  noStats:     { emoji: '⚪', cls: 'dim',  text: () => tf('sigNoStats') },
  up:          { emoji: '🟢', cls: 'good', text: s => tf('sigUp', { p: f(s.pct, 0) }) },
};
const SIGNAL_ORDER = Object.keys(SIGNAL_VIEW);

/** Barre della produzione dei dipendenti, un giorno per barra. I giorni a
 *  zero dopo il primo con produzione sono segnati: sono quelli "fermi". */
function sparkline(series) {
  if (!series.length) return '';
  // Sempre 31 posti allineati a destra: un'azienda nata da dieci giorni
  // ha la barretta corta, non più larga a parità di giorni.
  const W = 4, GAP = 1, H = 26, SLOTS = 31;
  series = series.slice(-SLOTS);
  const offset = SLOTS - series.length;
  const max = Math.max(...series.map(d => d.employeeProd), 0.0001);
  const firstActive = series.findIndex(d => d.employeeProd > 0);
  const bars = series.map((d, i) => {
    const x = (offset + i) * (W + GAP);
    const title = `${d.date} · ${f(d.employeeProd, 1)} pt · ${f(d.wage, 2)}`;
    if (d.employeeProd <= 0) {
      const stop = firstActive >= 0 && i > firstActive;
      return `<rect class="wp-eco-spark-${stop ? 'stop' : 'none'}" x="${x}" y="${H - 2}" width="${W}" height="2"><title>${esc(title)}</title></rect>`;
    }
    const bh = Math.max(2, Math.round((d.employeeProd / max) * H));
    return `<rect class="wp-eco-spark-bar" x="${x}" y="${H - bh}" width="${W}" height="${bh}"><title>${esc(title)}</title></rect>`;
  }).join('');
  const width = SLOTS * (W + GAP) - GAP;
  return `<svg class="wp-eco-spark" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" preserveAspectRatio="none" role="img" aria-label="${esc(tf('sparkHint'))}">${bars}</svg>`;
}

function renderCompanies(result) {
  const rows = result.rows;
  if (!rows.length) return section(tf('secCompanies'), esc(tf('noCompanies')), 'neutral');
  const head = `<span class="wp-eco-big">${signed(result.employeesMarginDay)}</span> ${esc(tf('coHead'))}`
    + (result.losing ? ` · ${esc(tf('coLosing', { n: result.losing }))}` : '');
  const sec = section(tf('secCompanies'), head, result.losing ? 'yellow' : (result.employeesMarginDay > 0 ? 'green' : 'neutral'));

  const list = h('div', 'wp-eco-colist wp-eco-colist-v27');
  for (const r of rows) {
    const oc = r.company, e = r.employees;
    const sigs = [...r.signals].sort((a, b) => SIGNAL_ORDER.indexOf(a.kind) - SIGNAL_ORDER.indexOf(b.kind));
    const dis = oc.disabled ? ' wp-eco-co-disabled' : '';
    const marginCls = e.marginDay > 0.005 ? 'pos' : (e.marginDay < -0.005 ? 'neg' : '');
    const empLine = e.pointsDay > 0
      ? `${esc(tf('lblPtsDay', { p: f(e.pointsDay, 1) }))} · ${esc(tf('lblCost', { c: f(e.costPerPoint, 3) }))} · ${esc(tf('lblValue', { v: f(r.value, 3) }))}`
      : `<span class="wp-eco-dim">${esc(tf('lblValue', { v: f(r.value, 3) }))}</span>`;
    const where = [oc.regionName, oc.countryName].filter(Boolean).join(', ');
    const tags = [
      `<span class="wp-eco-tag">${esc(tf('lblBreakRoom', { l: oc.breakRoomLevel, n: oc.maxEmployees }))}</span>`,
      `<span class="wp-eco-tag">${esc(tf('lblEngine', { l: oc.engineLevel }))} <strong>${signed(r.engineDay)}</strong></span>`,
      r.selfDay > 0.005 ? `<span class="wp-eco-tag">${esc(tf('lblSelf'))} <strong>${signed(r.selfDay)}</strong></span>` : '',
      oc.countryName ? `<span class="wp-eco-tag">${esc(tf('lblTax', { t: f(oc.incomeTax, 0) }))}</span>` : '',
    ].join('');
    const sigHtml = sigs.length
      ? `<ul class="wp-eco-sigs">${sigs.map(s => { const v = SIGNAL_VIEW[s.kind]; return `<li class="wp-eco-sig ${v.cls}">${v.emoji} ${esc(v.text(s))}</li>`; }).join('')}</ul>`
      : '';
    list.appendChild(h('div', `wp-eco-cocard${dis}`, `
      <div class="wp-eco-cocard-main">
        <div class="wp-eco-cocard-title"><strong>${esc(oc.name)}</strong> <span class="wp-eco-dim">${esc(oc.itemCode)}</span>
          ${where ? `<div class="wp-eco-dim wp-eco-cocard-where">${esc(where)}</div>` : ''}</div>
        <div class="wp-eco-cocard-gold ${marginCls}">${signed(e.marginDay)} <span class="wp-eco-dim">${esc(tf('goldDay'))}</span></div>
      </div>
      <div class="wp-eco-cocard-emp"><span class="wp-eco-dim">${esc(tf('lblEmployees'))}</span> ${empLine}</div>
      ${sparkline(r.series)}
      <div class="wp-eco-cocard-tags">${tags}</div>
      ${sigHtml}`));
  }
  sec.appendChild(list);
  sec.appendChild(h('div', 'wp-eco-footnote', esc(tf('coNote', { n: result.windowDays }))));
  return sec;
}

// ── Competenze ────────────────────────────────────────────────────
// Barra 0-10 che mostra livello attuale (pieno) e delta verso il consigliato.
function skillBar(name, cur, best) {
  const lo = Math.min(cur, best), hi = Math.max(cur, best);
  const up = best > cur, down = best < cur;
  let segs = '';
  for (let i = 1; i <= 10; i++) {
    let cls = 'wp-eco-seg';
    if (i <= lo) cls += ' on';
    else if (i <= hi) cls += up ? ' add' : (down ? ' rem' : '');
    segs += `<span class="${cls}"></span>`;
  }
  const delta = up ? `<span class="wp-eco-delta up">▲${hi - lo}</span>`
    : (down ? `<span class="wp-eco-delta down">▼${hi - lo}</span>`
      : `<span class="wp-eco-delta same">=</span>`);
  return `<div class="wp-eco-skill">
    <div class="wp-eco-skill-top"><span class="wp-eco-skill-name">${esc(name)}</span>
      <span class="wp-eco-skill-lvls">L${cur} <span class="wp-eco-arrow">→</span> <strong>L${best}</strong> ${delta}</span></div>
    <div class="wp-eco-segbar">${segs}</div>
  </div>`;
}

function renderSkills(data, companies) {
  const best = data.best;
  if (!best || !companies.rows.length) return section(tf('secSkills'), esc(tf('noCompanies')), 'neutral');

  const delta = best.total - data.current.total;
  const headline = delta > 0.01
    ? `<span class="wp-eco-big">+${f(delta)}</span> ${esc(tf('goldDay'))} ${esc(tf('available'))}`
    : `<span class="wp-eco-big">${f(best.total)}</span> ${esc(tf('goldDay'))}`;
  const sec = section(tf('secSkills'), headline, delta > 0.01 ? 'green' : 'neutral');

  const brk = x => `${esc(tf('brkPassive', { g: f(x.passive) }))} · ${esc(tf('brkSelf', { g: f(x.self) }))}`;
  const totals = h('div', 'wp-eco-totals');
  totals.innerHTML = `
    <div class="wp-eco-total-col"><span class="wp-eco-total-lbl">${esc(tf('curLabel'))}</span><span class="wp-eco-total-val">${f(data.current.total)}</span><span class="wp-eco-total-unit">${esc(tf('goldDay'))} · ${brk(data.current)}</span></div>
    <div class="wp-eco-total-arrow">→</div>
    <div class="wp-eco-total-col best"><span class="wp-eco-total-lbl">${esc(tf('recLabel'))}</span><span class="wp-eco-total-val">${f(best.total)}</span><span class="wp-eco-total-unit">${esc(tf('goldDay'))} · ${esc(tf('pointsUsed', { used: best.cost, budget: data.budget }))}<br>${brk(best)}</span></div>`;
  sec.appendChild(totals);

  const skillsWrap = h('div', 'wp-eco-skills');
  skillsWrap.innerHTML = ECO_SKILLS.map(s => skillBar(SKILL_LABEL[s], data.current.levels[s], best.levels[s])).join('');
  sec.appendChild(skillsWrap);

  const meta = h('div', 'wp-eco-meta-rows');
  if (data.bestSelf) {
    const bs = data.bestSelf;
    meta.appendChild(h('div', 'wp-eco-kv', `<span>${esc(tf('skSelf'))}</span><strong>${esc(bs.company.name)}</strong> <span class="wp-eco-dim">(${esc(bs.company.itemCode)})</span> — ${esc(tf('skSelfDetail', { v: f(bs.value, 3), a: f(data.selfActionsDay(best.levels.energy), 1) }))}`));
  } else {
    meta.appendChild(h('div', 'wp-eco-kv', `<span class="wp-eco-dim">${esc(tf('skSelfNone'))}</span>`));
  }
  meta.appendChild(h('div', 'wp-eco-kv', esc(tf('skMgmt', { l: best.levels.management, p: f(data.mgmtPct(best.levels.management), 0) }))));
  const active = companies.rows.filter(r => !r.company.disabled).length;
  const cap = Math.floor(data.capAt(best.levels.companies));
  if (cap < active) {
    meta.appendChild(h('div', 'wp-eco-kv wp-eco-warnline', `⚠️ ${esc(tf('skCap', { l: best.levels.companies, k: cap, n: active }))}`));
  }
  meta.appendChild(h('div', 'wp-eco-kv', `<span class="wp-eco-dim">${esc(tf('skLeader', { l: data.leadershipLevel }))}</span>`));
  sec.appendChild(meta);

  sec.appendChild(h('div', 'wp-eco-footnote', `${esc(tf('skBudget', { b: data.budget, f: data.free }))} ${esc(tf('skNote'))}`));
  return sec;
}
