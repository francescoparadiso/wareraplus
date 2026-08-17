/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale (src/eco/*)
   ------------------------------------------------------------------
   Vista NUOVA sotto "Approfondimenti". Port a moduli ES del bot Discord
   "WarEra Eco Optimizer" di ArgusIA: stessa logica (Competenze / Posizione
   / Lavoratori — moduli fratelli + BOT_KNOWLEDGE.md), più una sezione
   Assunzioni (src/eco/hiring.js, richiesta nuova) e una veste grafica in
   linea con WarEra+ al posto degli embed Discord.

   Questo file è l'orchestratore + il rendering (equivalente di bot.py +
   embeds.py). La logica pura sta nei moduli fratelli.

   CREDITI: tool ideato da ArgusIA — card in cima col link al profilo. Non
   rimuovere l'attribuzione.

   i18n: dizionario locale a placeholder `{x}`, tradotto con tf(). Copre le
   stesse 9 lingue della barra menu (EN/IT/ES/DE/FR/NL/SV/PT/AR); i nomi
   delle skill (Companies/Energy/Entrepreneurship/Production) restano in
   inglese perché così sono nel gioco. Si ritraduce a 'wareraplus:langchange'.
   ══════════════════════════════════════════════════════════════ */

import '../styles/eco.css';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { WORKER_API_BASE } from '../diplomacy/config.js';

import { loadGameData, EcoProxyUnavailableError, ecoCall } from './api.js';
import { makeGameData } from './gameData.js';
import { resolveUserId, AmbiguousUserError, UserNotFoundError } from './resolve.js';
import { loadOwnedCompanies } from './account.js';
import { deriveNetWage } from './wage.js';
import { computeSkills } from './skills.js';
import { computeCompanies } from './positioning.js';
import { computeWorkers } from './workers.js';
import { computeHiring } from './hiring.js';

const AUTHOR = {
  userId: '69cc14d4efc3f3f4291e93a9',
  username: 'ArgusIA',
  profileUrl: 'https://app.warera.io/user/69cc14d4efc3f3f4291e93a9',
};

const SKILLS = ['Companies', 'Energy', 'Entrepreneurship', 'Production'];

// ══ i18n ═══════════════════════════════════════════════════════════
const DICT = {
  en: {
    title: 'Industrial Optimizer', subtitle: 'Gold-maximizing skills, company placement, worker layout and hiring for any WarEra player.',
    creditBy: 'Tool designed by', viewProfile: 'View profile', level: 'Level',
    inputPh: 'WarEra username or ID…', analyze: 'Analyze', analyzing: 'Analyzing…',
    manualWage: 'Net job wage (optional)', manualWageHint: 'gold/pp — leave empty to auto-detect', remember: 'Remember this player',
    goldDay: 'gold/day', goldPp: 'gold/pp',
    secSkills: 'Skills', secCompanies: 'Companies', secPositioning: 'Positioning', secWorkers: 'Workers', secHiring: 'Hiring',
    available: 'available', curLabel: 'Now', recLabel: 'Recommended', pointsUsed: '{used}/{budget} pts',
    keepSame: 'no change', work: 'Best to personally work', jobWage: 'Job wage', management: 'Management',
    noJob: 'no current job — using 0', manualOverride: 'manual override',
    mgmtReserved: 'L{lvl} reserved for {n} worker(s) · {pts} pts', mgmtFree: 'L0 covers {n} worker(s) — nothing reserved',
    respecNote: 'Recommendation assumes a full respec of your total skill points. D = disabled company (over Companies cap).',
    noCompanies: 'No owned companies found.',
    colBonus: 'bonus', colEngine: 'engine', colWorkers: 'workers',
    disabledBadge: 'DISABLED', disabledHint: 'over Companies cap — earns nothing until reactivated',
    posHeadMove: '{n} to move now', posHeadUpside: '{n} with upside', posHeadOptimal: '{n} already optimal',
    alreadyOptimal: 'Already optimal', moveCost: 'move cost {g}', paybackD: '{d}d payback', noRealGain: 'no real gain',
    depositNote: 'includes a {pct}% deposit bonus expiring {when}',
    posLegend: 'green = worth moving now (≤3d payback) · yellow = real upside, slower payback · grey = already optimal',
    wrkHeadMove: '{n} worth moving', wrkHeadOptimal: '{n} already optimal',
    net: 'net', profit: 'profit', setWage: 'set wage to {g} gross to keep their net pay',
    wrkLegend: 'Profit assumes the gross wage is actually set to the shown value to preserve net pay.',
    noWorkers: 'This player has no hired workers.',
    hiringIntro: 'Companies with open worker slots — hiring here would add income.',
    hiringRef: 'Estimated for a worker like this player (energy {e}, production {p} → {raw} production points/day). A real hire may differ.',
    hiringNoRef: 'No reference skills available — showing the ceiling wage only.',
    freeSlots: '{n} free slot(s)', suggestWage: 'offer ~{g} gross/pp', maxWageNote: 'max {g} before you lose money',
    ownerGain: 'you: +{g}/day', workerTakeHome: 'worker takes home +{g}/day', noHiring: 'No open worker slots — every company is full.',
    errNotFound: 'No player found with that name or ID.', errAmbiguous: 'Multiple players match — be more specific:',
    errGeneric: 'Something went wrong while analyzing. Try again in a moment.',
    setupTitle: 'API key proxy not ready',
    setupBody: 'The worker/transaction/region-recommendation endpoints need the Cloudflare worker to inject the X-API-Key header. It isn\'t working yet — check the worker adds X-API-Key (not Authorization: Bearer) and that the API_TOKEN secret is set.',
    emptyHint: 'Enter a WarEra username or ID above to analyze that player\'s economy.',
    otherMatched: 'also matched: {names}',
  },
  it: {
    title: 'Ottimizzatore industriale', subtitle: 'Competenze, posizione delle aziende, lavoratori e assunzioni per massimizzare l\'oro di qualsiasi giocatore WarEra.',
    creditBy: 'Tool ideato da', viewProfile: 'Vedi profilo', level: 'Livello',
    inputPh: 'Username o ID WarEra…', analyze: 'Analizza', analyzing: 'Analisi…',
    manualWage: 'Paga netta da lavoro (opzionale)', manualWageHint: 'oro/pp — lascia vuoto per rilevarla', remember: 'Ricorda questo giocatore',
    goldDay: 'oro/giorno', goldPp: 'oro/pp',
    secSkills: 'Competenze', secCompanies: 'Aziende', secPositioning: 'Posizione', secWorkers: 'Lavoratori', secHiring: 'Assunzioni',
    available: 'disponibili', curLabel: 'Ora', recLabel: 'Consigliato', pointsUsed: '{used}/{budget} pt',
    keepSame: 'invariato', work: 'Meglio lavorare di persona in', jobWage: 'Paga da lavoro', management: 'Gestione',
    noJob: 'nessun lavoro attuale — uso 0', manualOverride: 'override manuale',
    mgmtReserved: 'L{lvl} riservato per {n} lavoratore/i · {pts} pt', mgmtFree: 'L0 copre {n} lavoratore/i — niente riservato',
    respecNote: 'Il consiglio assume un respec completo dei tuoi punti competenza. D = azienda disabilitata (oltre il cap Aziende).',
    noCompanies: 'Nessuna azienda posseduta trovata.',
    colBonus: 'bonus', colEngine: 'motore', colWorkers: 'lavoratori',
    disabledBadge: 'DISABILITATA', disabledHint: 'oltre il cap Aziende — non rende nulla finché non riattivata',
    posHeadMove: '{n} da spostare ora', posHeadUpside: '{n} con margine', posHeadOptimal: '{n} già ottimali',
    alreadyOptimal: 'Già ottimale', moveCost: 'costo trasloco {g}', paybackD: 'rientro {d}g', noRealGain: 'nessun guadagno reale',
    depositNote: 'include un bonus deposito del {pct}% che scade {when}',
    posLegend: 'verde = conviene spostarla ora (rientro ≤3g) · giallo = margine reale, rientro più lento · grigio = già ottimale',
    wrkHeadMove: '{n} da spostare', wrkHeadOptimal: '{n} già ottimali',
    net: 'netto', profit: 'profitto', setWage: 'imposta paga a {g} lordo per mantenere il suo netto',
    wrkLegend: 'Il profitto assume che la paga lorda venga davvero impostata al valore mostrato per mantenere il netto.',
    noWorkers: 'Questo giocatore non ha lavoratori assunti.',
    hiringIntro: 'Aziende con slot lavoratori liberi — assumere qui aggiungerebbe reddito.',
    hiringRef: 'Stima per un lavoratore come questo giocatore (energia {e}, produzione {p} → {raw} punti produzione/giorno). Un assunto reale può differire.',
    hiringNoRef: 'Nessuna skill di riferimento — mostro solo la paga massima.',
    freeSlots: '{n} slot liberi', suggestWage: 'offri ~{g} lordo/pp', maxWageNote: 'max {g} prima di rimetterci',
    ownerGain: 'tu: +{g}/giorno', workerTakeHome: 'il lavoratore porta a casa +{g}/giorno', noHiring: 'Nessuno slot libero — ogni azienda è piena.',
    errNotFound: 'Nessun giocatore trovato con quel nome o ID.', errAmbiguous: 'Più giocatori corrispondono — sii più preciso:',
    errGeneric: 'Qualcosa è andato storto durante l\'analisi. Riprova tra un momento.',
    setupTitle: 'Proxy API key non pronto',
    setupBody: 'Gli endpoint lavoratori/transazioni/regioni consigliate hanno bisogno che il worker Cloudflare inietti l\'header X-API-Key. Non funziona ancora — controlla che il worker aggiunga X-API-Key (non Authorization: Bearer) e che il secret API_TOKEN sia impostato.',
    emptyHint: 'Inserisci sopra uno username o ID WarEra per analizzare l\'economia di quel giocatore.',
    otherMatched: 'corrispondono anche: {names}',
  },
  es: {
    title: 'Optimizador industrial', subtitle: 'Habilidades, ubicación de empresas, trabajadores y contratación para maximizar el oro de cualquier jugador de WarEra.',
    creditBy: 'Herramienta ideada por', viewProfile: 'Ver perfil', level: 'Nivel',
    inputPh: 'Usuario o ID de WarEra…', analyze: 'Analizar', analyzing: 'Analizando…',
    manualWage: 'Salario neto (opcional)', manualWageHint: 'oro/pp — vacío para detectarlo', remember: 'Recordar este jugador',
    goldDay: 'oro/día', goldPp: 'oro/pp',
    secSkills: 'Habilidades', secCompanies: 'Empresas', secPositioning: 'Ubicación', secWorkers: 'Trabajadores', secHiring: 'Contratación',
    available: 'disponibles', curLabel: 'Ahora', recLabel: 'Recomendado', pointsUsed: '{used}/{budget} pts',
    keepSame: 'sin cambios', work: 'Mejor trabajar en persona en', jobWage: 'Salario', management: 'Gestión',
    noJob: 'sin empleo actual — usando 0', manualOverride: 'valor manual',
    mgmtReserved: 'N{lvl} reservado para {n} trabajador(es) · {pts} pts', mgmtFree: 'N0 cubre {n} trabajador(es) — nada reservado',
    respecNote: 'La recomendación asume un respec completo de tus puntos. D = empresa desactivada (sobre el tope de Empresas).',
    noCompanies: 'No se encontraron empresas propias.',
    colBonus: 'bono', colEngine: 'motor', colWorkers: 'trabajadores',
    disabledBadge: 'DESACTIVADA', disabledHint: 'sobre el tope de Empresas — no rinde hasta reactivarla',
    posHeadMove: '{n} para mover ya', posHeadUpside: '{n} con margen', posHeadOptimal: '{n} ya óptimas',
    alreadyOptimal: 'Ya óptima', moveCost: 'coste mudanza {g}', paybackD: 'retorno {d}d', noRealGain: 'sin ganancia real',
    depositNote: 'incluye un bono de depósito del {pct}% que expira {when}',
    posLegend: 'verde = conviene mover ya (retorno ≤3d) · amarillo = margen real, retorno más lento · gris = ya óptima',
    wrkHeadMove: '{n} para mover', wrkHeadOptimal: '{n} ya óptimos',
    net: 'neto', profit: 'beneficio', setWage: 'fija el salario a {g} bruto para mantener su neto',
    wrkLegend: 'El beneficio asume que el salario bruto se fija al valor mostrado para preservar el neto.',
    noWorkers: 'Este jugador no tiene trabajadores contratados.',
    hiringIntro: 'Empresas con plazas libres — contratar aquí añadiría ingresos.',
    hiringRef: 'Estimado para un trabajador como este jugador (energía {e}, producción {p} → {raw} puntos/día). Un fichaje real puede variar.',
    hiringNoRef: 'Sin habilidades de referencia — solo se muestra el salario máximo.',
    freeSlots: '{n} plaza(s) libre(s)', suggestWage: 'ofrece ~{g} bruto/pp', maxWageNote: 'máx {g} antes de perder dinero',
    ownerGain: 'tú: +{g}/día', workerTakeHome: 'el trabajador se lleva +{g}/día', noHiring: 'Sin plazas libres — toda empresa está llena.',
    errNotFound: 'No se encontró ningún jugador con ese nombre o ID.', errAmbiguous: 'Varios jugadores coinciden — sé más específico:',
    errGeneric: 'Algo salió mal al analizar. Inténtalo de nuevo en un momento.',
    setupTitle: 'Proxy de API key no listo',
    setupBody: 'Los endpoints de trabajadores/transacciones/regiones necesitan que el worker de Cloudflare inyecte la cabecera X-API-Key. Aún no funciona — comprueba que el worker añade X-API-Key (no Authorization: Bearer) y que el secret API_TOKEN está configurado.',
    emptyHint: 'Introduce arriba un usuario o ID de WarEra para analizar su economía.',
    otherMatched: 'también coinciden: {names}',
  },
  de: {
    title: 'Industrie-Optimierer', subtitle: 'Skills, Firmenstandorte, Arbeiter und Einstellungen zur Gold-Maximierung für jeden WarEra-Spieler.',
    creditBy: 'Tool erdacht von', viewProfile: 'Profil ansehen', level: 'Level',
    inputPh: 'WarEra-Name oder ID…', analyze: 'Analysieren', analyzing: 'Analysiere…',
    manualWage: 'Netto-Lohn (optional)', manualWageHint: 'Gold/PP — leer für Auto-Erkennung', remember: 'Diesen Spieler merken',
    goldDay: 'Gold/Tag', goldPp: 'Gold/PP',
    secSkills: 'Skills', secCompanies: 'Firmen', secPositioning: 'Standort', secWorkers: 'Arbeiter', secHiring: 'Einstellung',
    available: 'verfügbar', curLabel: 'Jetzt', recLabel: 'Empfohlen', pointsUsed: '{used}/{budget} Pkt',
    keepSame: 'unverändert', work: 'Am besten selbst arbeiten in', jobWage: 'Lohn', management: 'Management',
    noJob: 'kein aktueller Job — nutze 0', manualOverride: 'manuell',
    mgmtReserved: 'L{lvl} reserviert für {n} Arbeiter · {pts} Pkt', mgmtFree: 'L0 deckt {n} Arbeiter — nichts reserviert',
    respecNote: 'Die Empfehlung setzt einen vollen Respec deiner Skillpunkte voraus. D = deaktivierte Firma (über dem Firmen-Cap).',
    noCompanies: 'Keine eigenen Firmen gefunden.',
    colBonus: 'Bonus', colEngine: 'Motor', colWorkers: 'Arbeiter',
    disabledBadge: 'DEAKTIVIERT', disabledHint: 'über dem Firmen-Cap — bringt nichts bis zur Reaktivierung',
    posHeadMove: '{n} jetzt verlegen', posHeadUpside: '{n} mit Potenzial', posHeadOptimal: '{n} bereits optimal',
    alreadyOptimal: 'Bereits optimal', moveCost: 'Umzugskosten {g}', paybackD: '{d}T Amortisation', noRealGain: 'kein echter Gewinn',
    depositNote: 'enthält {pct}% Vorkommen-Bonus, läuft ab {when}',
    posLegend: 'grün = jetzt verlegen (≤3T) · gelb = echtes Potenzial, langsamer · grau = bereits optimal',
    wrkHeadMove: '{n} verlegen', wrkHeadOptimal: '{n} bereits optimal',
    net: 'netto', profit: 'Gewinn', setWage: 'Lohn auf {g} brutto setzen, um Netto zu halten',
    wrkLegend: 'Der Gewinn setzt voraus, dass der Bruttolohn tatsächlich auf den gezeigten Wert gesetzt wird.',
    noWorkers: 'Dieser Spieler hat keine angestellten Arbeiter.',
    hiringIntro: 'Firmen mit freien Arbeiterplätzen — Einstellen würde Einkommen bringen.',
    hiringRef: 'Geschätzt für einen Arbeiter wie diesen Spieler (Energie {e}, Produktion {p} → {raw} PP/Tag). Ein echter Arbeiter kann abweichen.',
    hiringNoRef: 'Keine Referenz-Skills — nur der Höchstlohn wird gezeigt.',
    freeSlots: '{n} freie Plätze', suggestWage: 'biete ~{g} brutto/PP', maxWageNote: 'max {g} bevor du verlierst',
    ownerGain: 'du: +{g}/Tag', workerTakeHome: 'Arbeiter erhält +{g}/Tag', noHiring: 'Keine freien Plätze — jede Firma ist voll.',
    errNotFound: 'Kein Spieler mit diesem Namen oder ID gefunden.', errAmbiguous: 'Mehrere Spieler passen — sei genauer:',
    errGeneric: 'Bei der Analyse ging etwas schief. Versuch es gleich nochmal.',
    setupTitle: 'API-Key-Proxy nicht bereit',
    setupBody: 'Die Arbeiter-/Transaktions-/Regionsendpunkte brauchen den Cloudflare-Worker, der den X-API-Key-Header einfügt. Es geht noch nicht — prüfe, dass der Worker X-API-Key (nicht Authorization: Bearer) hinzufügt und das API_TOKEN-Secret gesetzt ist.',
    emptyHint: 'Gib oben einen WarEra-Namen oder eine ID ein, um die Wirtschaft dieses Spielers zu analysieren.',
    otherMatched: 'ebenfalls gefunden: {names}',
  },
  fr: {
    title: 'Optimiseur industriel', subtitle: 'Compétences, emplacement des entreprises, ouvriers et embauche pour maximiser l\'or de tout joueur WarEra.',
    creditBy: 'Outil imaginé par', viewProfile: 'Voir le profil', level: 'Niveau',
    inputPh: 'Pseudo ou ID WarEra…', analyze: 'Analyser', analyzing: 'Analyse…',
    manualWage: 'Salaire net (optionnel)', manualWageHint: 'or/pp — vide pour détection auto', remember: 'Se souvenir de ce joueur',
    goldDay: 'or/jour', goldPp: 'or/pp',
    secSkills: 'Compétences', secCompanies: 'Entreprises', secPositioning: 'Emplacement', secWorkers: 'Ouvriers', secHiring: 'Embauche',
    available: 'disponibles', curLabel: 'Actuel', recLabel: 'Recommandé', pointsUsed: '{used}/{budget} pts',
    keepSame: 'inchangé', work: 'Mieux vaut travailler soi-même à', jobWage: 'Salaire', management: 'Gestion',
    noJob: 'aucun emploi actuel — 0 utilisé', manualOverride: 'valeur manuelle',
    mgmtReserved: 'N{lvl} réservé pour {n} ouvrier(s) · {pts} pts', mgmtFree: 'N0 couvre {n} ouvrier(s) — rien de réservé',
    respecNote: 'La recommandation suppose un respec complet de tes points. D = entreprise désactivée (au-delà du plafond Entreprises).',
    noCompanies: 'Aucune entreprise possédée trouvée.',
    colBonus: 'bonus', colEngine: 'moteur', colWorkers: 'ouvriers',
    disabledBadge: 'DÉSACTIVÉE', disabledHint: 'au-delà du plafond Entreprises — ne rapporte rien tant qu\'inactive',
    posHeadMove: '{n} à déplacer', posHeadUpside: '{n} avec marge', posHeadOptimal: '{n} déjà optimales',
    alreadyOptimal: 'Déjà optimale', moveCost: 'coût du déménagement {g}', paybackD: 'retour {d}j', noRealGain: 'aucun gain réel',
    depositNote: 'inclut un bonus de gisement de {pct}% expirant {when}',
    posLegend: 'vert = à déplacer maintenant (≤3j) · jaune = marge réelle, retour plus lent · gris = déjà optimale',
    wrkHeadMove: '{n} à déplacer', wrkHeadOptimal: '{n} déjà optimaux',
    net: 'net', profit: 'profit', setWage: 'fixe le salaire à {g} brut pour préserver son net',
    wrkLegend: 'Le profit suppose que le salaire brut est réellement fixé à la valeur affichée.',
    noWorkers: 'Ce joueur n\'a aucun ouvrier embauché.',
    hiringIntro: 'Entreprises avec des postes libres — embaucher ici ajouterait des revenus.',
    hiringRef: 'Estimé pour un ouvrier comme ce joueur (énergie {e}, production {p} → {raw} pp/jour). Un vrai ouvrier peut différer.',
    hiringNoRef: 'Aucune compétence de référence — seul le salaire plafond est montré.',
    freeSlots: '{n} poste(s) libre(s)', suggestWage: 'propose ~{g} brut/pp', maxWageNote: 'max {g} avant de perdre',
    ownerGain: 'toi : +{g}/jour', workerTakeHome: 'l\'ouvrier touche +{g}/jour', noHiring: 'Aucun poste libre — chaque entreprise est pleine.',
    errNotFound: 'Aucun joueur trouvé avec ce nom ou cet ID.', errAmbiguous: 'Plusieurs joueurs correspondent — sois plus précis :',
    errGeneric: 'Un problème est survenu pendant l\'analyse. Réessaie dans un instant.',
    setupTitle: 'Proxy de clé API non prêt',
    setupBody: 'Les endpoints ouvriers/transactions/régions ont besoin que le worker Cloudflare injecte l\'en-tête X-API-Key. Ça ne marche pas encore — vérifie que le worker ajoute X-API-Key (pas Authorization: Bearer) et que le secret API_TOKEN est défini.',
    emptyHint: 'Saisis ci-dessus un pseudo ou un ID WarEra pour analyser l\'économie de ce joueur.',
    otherMatched: 'correspondent aussi : {names}',
  },
  nl: {
    title: 'Industriële optimizer', subtitle: 'Skills, bedrijfslocaties, werkers en aanwerving om het goud van elke WarEra-speler te maximaliseren.',
    creditBy: 'Tool bedacht door', viewProfile: 'Profiel bekijken', level: 'Level',
    inputPh: 'WarEra-naam of ID…', analyze: 'Analyseren', analyzing: 'Analyseren…',
    manualWage: 'Netto loon (optioneel)', manualWageHint: 'goud/pp — leeg voor auto-detectie', remember: 'Deze speler onthouden',
    goldDay: 'goud/dag', goldPp: 'goud/pp',
    secSkills: 'Skills', secCompanies: 'Bedrijven', secPositioning: 'Locatie', secWorkers: 'Werkers', secHiring: 'Aanwerving',
    available: 'beschikbaar', curLabel: 'Nu', recLabel: 'Aanbevolen', pointsUsed: '{used}/{budget} pnt',
    keepSame: 'ongewijzigd', work: 'Beste om zelf te werken bij', jobWage: 'Loon', management: 'Beheer',
    noJob: 'geen huidige baan — 0 gebruikt', manualOverride: 'handmatig',
    mgmtReserved: 'L{lvl} gereserveerd voor {n} werker(s) · {pts} pnt', mgmtFree: 'L0 dekt {n} werker(s) — niets gereserveerd',
    respecNote: 'De aanbeveling gaat uit van een volledige respec van je skillpunten. D = uitgeschakeld bedrijf (boven de Bedrijven-cap).',
    noCompanies: 'Geen eigen bedrijven gevonden.',
    colBonus: 'bonus', colEngine: 'motor', colWorkers: 'werkers',
    disabledBadge: 'UITGESCHAKELD', disabledHint: 'boven de Bedrijven-cap — levert niets op tot heractivatie',
    posHeadMove: '{n} nu verplaatsen', posHeadUpside: '{n} met winst', posHeadOptimal: '{n} al optimaal',
    alreadyOptimal: 'Al optimaal', moveCost: 'verhuiskosten {g}', paybackD: '{d}d terugverdien', noRealGain: 'geen echte winst',
    depositNote: 'bevat een {pct}% vindplaatsbonus die verloopt {when}',
    posLegend: 'groen = nu verplaatsen (≤3d) · geel = echte winst, trager · grijs = al optimaal',
    wrkHeadMove: '{n} verplaatsen', wrkHeadOptimal: '{n} al optimaal',
    net: 'netto', profit: 'winst', setWage: 'zet loon op {g} bruto om hun netto te behouden',
    wrkLegend: 'De winst gaat ervan uit dat het brutoloon echt op de getoonde waarde wordt gezet.',
    noWorkers: 'Deze speler heeft geen werkers in dienst.',
    hiringIntro: 'Bedrijven met vrije werkplekken — hier aanwerven zou inkomen toevoegen.',
    hiringRef: 'Geschat voor een werker zoals deze speler (energie {e}, productie {p} → {raw} pp/dag). Een echte aanwerving kan verschillen.',
    hiringNoRef: 'Geen referentie-skills — alleen het maximumloon wordt getoond.',
    freeSlots: '{n} vrije plek(ken)', suggestWage: 'bied ~{g} bruto/pp', maxWageNote: 'max {g} voor je verlies maakt',
    ownerGain: 'jij: +{g}/dag', workerTakeHome: 'werker houdt +{g}/dag over', noHiring: 'Geen vrije plekken — elk bedrijf is vol.',
    errNotFound: 'Geen speler gevonden met die naam of ID.', errAmbiguous: 'Meerdere spelers matchen — wees specifieker:',
    errGeneric: 'Er ging iets mis bij het analyseren. Probeer het zo opnieuw.',
    setupTitle: 'API-key-proxy niet klaar',
    setupBody: 'De werker-/transactie-/regio-endpoints hebben de Cloudflare-worker nodig die de X-API-Key-header toevoegt. Werkt nog niet — controleer dat de worker X-API-Key toevoegt (niet Authorization: Bearer) en dat het API_TOKEN-secret is ingesteld.',
    emptyHint: 'Voer hierboven een WarEra-naam of ID in om de economie van die speler te analyseren.',
    otherMatched: 'ook gevonden: {names}',
  },
  sv: {
    title: 'Industrioptimerare', subtitle: 'Färdigheter, företagsplacering, arbetare och anställning för att maximera guldet för valfri WarEra-spelare.',
    creditBy: 'Verktyg skapat av', viewProfile: 'Visa profil', level: 'Nivå',
    inputPh: 'WarEra-namn eller ID…', analyze: 'Analysera', analyzing: 'Analyserar…',
    manualWage: 'Nettolön (valfritt)', manualWageHint: 'guld/pp — tomt för auto', remember: 'Kom ihåg denna spelare',
    goldDay: 'guld/dag', goldPp: 'guld/pp',
    secSkills: 'Färdigheter', secCompanies: 'Företag', secPositioning: 'Placering', secWorkers: 'Arbetare', secHiring: 'Anställning',
    available: 'tillgängligt', curLabel: 'Nu', recLabel: 'Rekommenderat', pointsUsed: '{used}/{budget} p',
    keepSame: 'oförändrat', work: 'Bäst att jobba själv i', jobWage: 'Lön', management: 'Ledning',
    noJob: 'inget jobb nu — använder 0', manualOverride: 'manuellt',
    mgmtReserved: 'L{lvl} reserverat för {n} arbetare · {pts} p', mgmtFree: 'L0 täcker {n} arbetare — inget reserverat',
    respecNote: 'Rekommendationen antar en full respec av dina poäng. D = inaktiverat företag (över Företag-taket).',
    noCompanies: 'Inga egna företag hittades.',
    colBonus: 'bonus', colEngine: 'motor', colWorkers: 'arbetare',
    disabledBadge: 'INAKTIVERAT', disabledHint: 'över Företag-taket — ger inget förrän det återaktiveras',
    posHeadMove: '{n} att flytta nu', posHeadUpside: '{n} med potential', posHeadOptimal: '{n} redan optimala',
    alreadyOptimal: 'Redan optimal', moveCost: 'flyttkostnad {g}', paybackD: '{d}d återbetalning', noRealGain: 'ingen verklig vinst',
    depositNote: 'inkluderar {pct}% fyndbonus som går ut {when}',
    posLegend: 'grön = flytta nu (≤3d) · gul = verklig potential, långsammare · grå = redan optimal',
    wrkHeadMove: '{n} att flytta', wrkHeadOptimal: '{n} redan optimala',
    net: 'netto', profit: 'vinst', setWage: 'sätt lön till {g} brutto för att behålla nettot',
    wrkLegend: 'Vinsten antar att bruttolönen faktiskt sätts till det visade värdet.',
    noWorkers: 'Denna spelare har inga anställda arbetare.',
    hiringIntro: 'Företag med lediga arbetsplatser — att anställa här skulle ge inkomst.',
    hiringRef: 'Uppskattat för en arbetare som denna spelare (energi {e}, produktion {p} → {raw} pp/dag). En riktig anställning kan skilja sig.',
    hiringNoRef: 'Inga referensfärdigheter — endast taklönen visas.',
    freeSlots: '{n} lediga platser', suggestWage: 'erbjud ~{g} brutto/pp', maxWageNote: 'max {g} innan du förlorar',
    ownerGain: 'du: +{g}/dag', workerTakeHome: 'arbetaren får +{g}/dag', noHiring: 'Inga lediga platser — varje företag är fullt.',
    errNotFound: 'Ingen spelare hittades med det namnet eller ID:t.', errAmbiguous: 'Flera spelare matchar — var mer specifik:',
    errGeneric: 'Något gick fel vid analysen. Försök igen strax.',
    setupTitle: 'API-nyckelproxy inte redo',
    setupBody: 'Arbetar-/transaktions-/regionendpoints kräver att Cloudflare-workern lägger till X-API-Key-headern. Fungerar inte än — kontrollera att workern lägger till X-API-Key (inte Authorization: Bearer) och att API_TOKEN-secreten är satt.',
    emptyHint: 'Skriv ett WarEra-namn eller ID ovan för att analysera den spelarens ekonomi.',
    otherMatched: 'matchade även: {names}',
  },
  pt: {
    title: 'Otimizador industrial', subtitle: 'Habilidades, localização de empresas, trabalhadores e contratação para maximizar o ouro de qualquer jogador WarEra.',
    creditBy: 'Ferramenta idealizada por', viewProfile: 'Ver perfil', level: 'Nível',
    inputPh: 'Utilizador ou ID WarEra…', analyze: 'Analisar', analyzing: 'A analisar…',
    manualWage: 'Salário líquido (opcional)', manualWageHint: 'ouro/pp — vazio para detetar', remember: 'Lembrar este jogador',
    goldDay: 'ouro/dia', goldPp: 'ouro/pp',
    secSkills: 'Habilidades', secCompanies: 'Empresas', secPositioning: 'Localização', secWorkers: 'Trabalhadores', secHiring: 'Contratação',
    available: 'disponíveis', curLabel: 'Agora', recLabel: 'Recomendado', pointsUsed: '{used}/{budget} pts',
    keepSame: 'sem mudança', work: 'Melhor trabalhar pessoalmente em', jobWage: 'Salário', management: 'Gestão',
    noJob: 'sem emprego atual — a usar 0', manualOverride: 'valor manual',
    mgmtReserved: 'N{lvl} reservado para {n} trabalhador(es) · {pts} pts', mgmtFree: 'N0 cobre {n} trabalhador(es) — nada reservado',
    respecNote: 'A recomendação assume um respec completo dos teus pontos. D = empresa desativada (acima do limite de Empresas).',
    noCompanies: 'Nenhuma empresa própria encontrada.',
    colBonus: 'bónus', colEngine: 'motor', colWorkers: 'trabalhadores',
    disabledBadge: 'DESATIVADA', disabledHint: 'acima do limite de Empresas — não rende até ser reativada',
    posHeadMove: '{n} para mover já', posHeadUpside: '{n} com margem', posHeadOptimal: '{n} já ótimas',
    alreadyOptimal: 'Já ótima', moveCost: 'custo de mudança {g}', paybackD: 'retorno {d}d', noRealGain: 'sem ganho real',
    depositNote: 'inclui um bónus de depósito de {pct}% que expira {when}',
    posLegend: 'verde = vale mover já (≤3d) · amarelo = margem real, retorno mais lento · cinza = já ótima',
    wrkHeadMove: '{n} para mover', wrkHeadOptimal: '{n} já ótimos',
    net: 'líquido', profit: 'lucro', setWage: 'define o salário para {g} bruto para manter o líquido dele',
    wrkLegend: 'O lucro assume que o salário bruto é mesmo definido no valor mostrado.',
    noWorkers: 'Este jogador não tem trabalhadores contratados.',
    hiringIntro: 'Empresas com vagas livres — contratar aqui acrescentaria receita.',
    hiringRef: 'Estimado para um trabalhador como este jogador (energia {e}, produção {p} → {raw} pp/dia). Uma contratação real pode variar.',
    hiringNoRef: 'Sem habilidades de referência — só o salário máximo é mostrado.',
    freeSlots: '{n} vaga(s) livre(s)', suggestWage: 'oferece ~{g} bruto/pp', maxWageNote: 'máx {g} antes de perderes dinheiro',
    ownerGain: 'tu: +{g}/dia', workerTakeHome: 'o trabalhador leva +{g}/dia', noHiring: 'Sem vagas livres — todas as empresas estão cheias.',
    errNotFound: 'Nenhum jogador encontrado com esse nome ou ID.', errAmbiguous: 'Vários jogadores correspondem — sê mais específico:',
    errGeneric: 'Algo correu mal na análise. Tenta novamente daqui a pouco.',
    setupTitle: 'Proxy da chave API não pronto',
    setupBody: 'Os endpoints de trabalhadores/transações/regiões precisam que o worker Cloudflare injete o cabeçalho X-API-Key. Ainda não funciona — verifica que o worker adiciona X-API-Key (não Authorization: Bearer) e que o secret API_TOKEN está definido.',
    emptyHint: 'Introduz acima um utilizador ou ID WarEra para analisar a economia desse jogador.',
    otherMatched: 'também correspondem: {names}',
  },
  ar: {
    title: 'محسِّن صناعي', subtitle: 'المهارات وموقع الشركات والعمال والتوظيف لتعظيم ذهب أي لاعب WarEra.',
    creditBy: 'أداة من ابتكار', viewProfile: 'عرض الملف', level: 'المستوى',
    inputPh: 'اسم أو معرّف WarEra…', analyze: 'حلّل', analyzing: 'جارٍ التحليل…',
    manualWage: 'الأجر الصافي (اختياري)', manualWageHint: 'ذهب/نقطة — اتركه فارغًا للكشف التلقائي', remember: 'تذكّر هذا اللاعب',
    goldDay: 'ذهب/يوم', goldPp: 'ذهب/نقطة',
    secSkills: 'المهارات', secCompanies: 'الشركات', secPositioning: 'الموقع', secWorkers: 'العمال', secHiring: 'التوظيف',
    available: 'متاح', curLabel: 'الآن', recLabel: 'موصى به', pointsUsed: '{used}/{budget} نقطة',
    keepSame: 'دون تغيير', work: 'الأفضل العمل شخصيًا في', jobWage: 'الأجر', management: 'الإدارة',
    noJob: 'لا وظيفة حالية — استخدام 0', manualOverride: 'قيمة يدوية',
    mgmtReserved: 'L{lvl} محجوز لـ {n} عامل · {pts} نقطة', mgmtFree: 'L0 يغطي {n} عامل — لا شيء محجوز',
    respecNote: 'التوصية تفترض إعادة توزيع كاملة لنقاطك. D = شركة معطّلة (فوق حد الشركات).',
    noCompanies: 'لم يتم العثور على شركات مملوكة.',
    colBonus: 'مكافأة', colEngine: 'محرك', colWorkers: 'عمال',
    disabledBadge: 'معطّلة', disabledHint: 'فوق حد الشركات — لا تدرّ شيئًا حتى إعادة تفعيلها',
    posHeadMove: '{n} للنقل الآن', posHeadUpside: '{n} بهامش', posHeadOptimal: '{n} مثالية بالفعل',
    alreadyOptimal: 'مثالية بالفعل', moveCost: 'تكلفة النقل {g}', paybackD: 'استرداد {d} يوم', noRealGain: 'لا ربح حقيقي',
    depositNote: 'يشمل مكافأة إيداع {pct}% تنتهي {when}',
    posLegend: 'أخضر = يستحق النقل الآن (≤3 أيام) · أصفر = هامش حقيقي أبطأ · رمادي = مثالية بالفعل',
    wrkHeadMove: '{n} للنقل', wrkHeadOptimal: '{n} مثالية بالفعل',
    net: 'صافٍ', profit: 'ربح', setWage: 'اضبط الأجر على {g} إجمالي للحفاظ على صافيه',
    wrkLegend: 'يفترض الربح ضبط الأجر الإجمالي فعليًا على القيمة المعروضة.',
    noWorkers: 'هذا اللاعب ليس لديه عمال معيّنون.',
    hiringIntro: 'شركات بأماكن عمل شاغرة — التوظيف هنا سيضيف دخلاً.',
    hiringRef: 'تقدير لعامل مثل هذا اللاعب (طاقة {e}، إنتاج {p} ← {raw} نقطة/يوم). قد يختلف العامل الحقيقي.',
    hiringNoRef: 'لا مهارات مرجعية — يُعرض الأجر الأقصى فقط.',
    freeSlots: '{n} مكان شاغر', suggestWage: 'اعرض ~{g} إجمالي/نقطة', maxWageNote: 'الحد {g} قبل الخسارة',
    ownerGain: 'أنت: +{g}/يوم', workerTakeHome: 'العامل يأخذ +{g}/يوم', noHiring: 'لا أماكن شاغرة — كل شركة ممتلئة.',
    errNotFound: 'لم يُعثر على لاعب بهذا الاسم أو المعرّف.', errAmbiguous: 'عدة لاعبين مطابقون — كن أكثر تحديدًا:',
    errGeneric: 'حدث خطأ أثناء التحليل. حاول مرة أخرى بعد لحظة.',
    setupTitle: 'وسيط مفتاح API غير جاهز',
    setupBody: 'تحتاج نقاط العمال/المعاملات/المناطق إلى أن يضيف عامل Cloudflare ترويسة X-API-Key. لا يعمل بعد — تحقّق أن العامل يضيف X-API-Key (وليس Authorization: Bearer) وأن سرّ API_TOKEN مضبوط.',
    emptyHint: 'أدخل اسم أو معرّف WarEra بالأعلى لتحليل اقتصاد ذلك اللاعب.',
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
function relTime(iso) {
  try {
    const ms = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(ms), day = 86400000, hr = 3600000, min = 60000, lang = getLang();
    const u = (v, s, p) => `${v} ${v === 1 ? s : p}`;
    let txt;
    if (abs >= day) txt = lang === 'it' ? u(Math.round(abs / day), 'giorno', 'giorni') : u(Math.round(abs / day), 'day', 'days');
    else if (abs >= hr) txt = lang === 'it' ? u(Math.round(abs / hr), 'ora', 'ore') : u(Math.round(abs / hr), 'hour', 'hours');
    else txt = lang === 'it' ? u(Math.round(abs / min), 'minuto', 'minuti') : u(Math.round(abs / min), 'minute', 'minutes');
    if (lang === 'it') return ms >= 0 ? `tra ${txt}` : `${txt} fa`;
    return ms >= 0 ? `in ${txt}` : `${txt} ago`;
  } catch (_) { return iso; }
}

// ══════════════════════════════════════════════════════════════
// Costruzione vista
// ══════════════════════════════════════════════════════════════
let built = false;
let rootEl, inputEl, wageEl, rememberEl, runBtn, resultsEl;

export function initEcoView(container) {
  if (built && rootEl?.isConnected) return;
  container.innerHTML = '';
  rootEl = h('div', 'wp-eco');
  rootEl.appendChild(buildCreditCard());

  const head = h('div', 'wp-eco-head');
  head.appendChild(h('h1', 'wp-eco-title', esc(tf('title'))));
  head.appendChild(h('p', 'wp-eco-subtitle', esc(tf('subtitle'))));
  rootEl.appendChild(head);

  const form = h('form', 'wp-eco-form');
  const row = h('div', 'wp-eco-inputrow');
  inputEl = h('input', 'wp-eco-input');
  inputEl.type = 'text'; inputEl.placeholder = tf('inputPh'); inputEl.autocomplete = 'off';
  inputEl.value = localStorage.getItem(LAST_USER_KEY) || '';
  runBtn = h('button', 'wp-eco-run'); runBtn.type = 'submit'; runBtn.textContent = tf('analyze');
  row.appendChild(inputEl); row.appendChild(runBtn); form.appendChild(row);

  const adv = h('div', 'wp-eco-adv');
  const wageWrap = h('label', 'wp-eco-field');
  wageWrap.appendChild(h('span', 'wp-eco-field-label', esc(tf('manualWage'))));
  wageEl = h('input', 'wp-eco-wage'); wageEl.type = 'number'; wageEl.step = '0.001'; wageEl.min = '0';
  wageEl.placeholder = tf('manualWageHint');
  wageWrap.appendChild(wageEl); adv.appendChild(wageWrap);
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
    const url = `${WORKER_API_BASE}/trpc/user.getUserLite?input=${encodeURIComponent(JSON.stringify({ userId: AUTHOR.userId }))}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = (await res.json())?.result?.data;
    if (!data) return;
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

  running = true;
  runBtn.disabled = true; runBtn.textContent = tf('analyzing');
  resultsEl.innerHTML = '';
  resultsEl.appendChild(h('div', 'wp-eco-loading', `<span class="wp-eco-spinner"></span>${esc(tf('analyzing'))}`));

  if (rememberEl.checked) localStorage.setItem(LAST_USER_KEY, query);
  else localStorage.removeItem(LAST_USER_KEY);

  try {
    const { userId, otherMatches } = await resolveUserId(query);
    const gd = makeGameData(await loadGameData());
    const owned = await loadOwnedCompanies(gd, userId);

    const manualWage = wageEl.value !== '' ? Number(wageEl.value) : null;
    let wageInfo = null, jobRate = 0;
    if (manualWage != null && Number.isFinite(manualWage)) {
      jobRate = manualWage;
    } else {
      wageInfo = await deriveNetWage(userId);
      jobRate = wageInfo ? wageInfo.net : 0;
    }

    const me = await ecoCall('user.getUserLite', { userId });
    if (!me) throw new EcoProxyUnavailableError('user.getUserLite null');

    const [skills, positioning, workers, hiring] = await Promise.all([
      computeSkills(gd, me, owned, jobRate),
      computeCompanies(gd, owned),
      computeWorkers(gd, owned),
      computeHiring(gd, owned, me),
    ]);

    resultsEl.innerHTML = '';
    if (otherMatches.length) {
      resultsEl.appendChild(h('div', 'wp-eco-note',
        `<strong>${esc(me.username || userId)}</strong> · ${esc(tf('otherMatched', { names: otherMatches.join(', ') }))}`));
    }
    resultsEl.appendChild(renderSkills(skills, wageInfo, manualWage));
    resultsEl.appendChild(renderCompanies(skills.companyRows));
    resultsEl.appendChild(renderPositioning(positioning));
    resultsEl.appendChild(renderWorkers(workers));
    resultsEl.appendChild(renderHiring(hiring));

    trackEvent('eco-analyze', { companies: owned.length, hasWorkers: workers.length > 0 });
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
  return h('div', 'wp-eco-setup', `<strong>${esc(tf('setupTitle'))}</strong><p>${esc(tf('setupBody'))}</p>`);
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

function renderSkills(data, wageInfo, manualWage) {
  const best = data.best, bestOwn = data.bestOwnCompany;
  if (!best) return section(tf('secSkills'), esc(tf('noCompanies')), 'neutral');

  const delta = best.total - data.curTotal;
  const headline = delta > 0.01
    ? `<span class="wp-eco-big">+${f(delta)}</span> ${esc(tf('goldDay'))} ${esc(tf('available'))}`
    : `<span class="wp-eco-big">${f(best.total)}</span> ${esc(tf('goldDay'))}`;
  const sec = section(tf('secSkills'), headline, delta > 0.01 ? 'green' : 'neutral');

  // Confronto totali
  const totals = h('div', 'wp-eco-totals');
  totals.innerHTML = `
    <div class="wp-eco-total-col"><span class="wp-eco-total-lbl">${esc(tf('curLabel'))}</span><span class="wp-eco-total-val">${f(data.curTotal)}</span><span class="wp-eco-total-unit">${esc(tf('goldDay'))}</span></div>
    <div class="wp-eco-total-arrow">→</div>
    <div class="wp-eco-total-col best"><span class="wp-eco-total-lbl">${esc(tf('recLabel'))}</span><span class="wp-eco-total-val">${f(best.total)}</span><span class="wp-eco-total-unit">${esc(tf('goldDay'))} · ${esc(tf('pointsUsed', { used: best.cost, budget: data.searchBudget }))}</span></div>`;
  sec.appendChild(totals);

  // Skill bars (attuale → consigliato)
  const curL = { Companies: data.curLc, Energy: data.curLe, Entrepreneurship: data.curLt, Production: data.curLp };
  const bestL = { Companies: best.lc, Energy: best.le, Entrepreneurship: best.lt, Production: best.lp };
  const skillsWrap = h('div', 'wp-eco-skills');
  skillsWrap.innerHTML = SKILLS.map(s => skillBar(s, curL[s], bestL[s])).join('');
  sec.appendChild(skillsWrap);

  // Meta: lavoro/paga/management
  let wageLine;
  if (manualWage != null && Number.isFinite(manualWage)) wageLine = `${f(manualWage, 3)} ${esc(tf('goldPp'))} <span class="wp-eco-dim">(${esc(tf('manualOverride'))})</span>`;
  else if (wageInfo) wageLine = `${f(wageInfo.net, 3)} ${esc(tf('goldPp'))} ${esc(tf('net'))} <span class="wp-eco-dim">— ${esc(wageInfo.companyName)} (${esc(wageInfo.itemCode)}), ${esc(wageInfo.employerName)}</span>`;
  else wageLine = `<span class="wp-eco-dim">${esc(tf('noJob'))}</span>`;
  const mgmtLine = data.managementCost > 0
    ? tf('mgmtReserved', { lvl: data.requiredMgmtLevel, n: data.totalWorkersAll, pts: data.managementCost })
    : tf('mgmtFree', { n: data.totalWorkersAll });

  const meta = h('div', 'wp-eco-meta-rows');
  if (bestOwn) meta.appendChild(h('div', 'wp-eco-kv', `<span>${esc(tf('work'))}</span><strong>${esc(bestOwn.name)}</strong> <span class="wp-eco-dim">(${esc(bestOwn.item)})</span> — ${f(bestOwn.netPerPoint, 3)} ${esc(tf('goldPp'))}`));
  meta.appendChild(h('div', 'wp-eco-kv', `<span>${esc(tf('jobWage'))}</span>${wageLine}`));
  meta.appendChild(h('div', 'wp-eco-kv', `<span>${esc(tf('management'))}</span>${esc(mgmtLine)}`));
  sec.appendChild(meta);

  sec.appendChild(h('div', 'wp-eco-footnote', esc(tf('respecNote'))));
  return sec;
}

function renderCompanies(rows) {
  if (!rows.length) return section(tf('secCompanies'), esc(tf('noCompanies')), 'neutral');
  const sec = section(tf('secCompanies'), `${rows.length}`, 'neutral');
  const maxVal = Math.max(...rows.map(r => r.potentialNetPerDay), 0.0001);
  const list = h('div', 'wp-eco-colist');
  rows.slice(0, 12).forEach(r => {
    const pct = Math.max(2, Math.round(100 * r.potentialNetPerDay / maxVal));
    const dis = r.active ? '' : `<span class="wp-eco-disabled-tag" title="${esc(tf('disabledHint'))}">${esc(tf('disabledBadge'))}</span>`;
    list.appendChild(h('div', `wp-eco-cocard${r.active ? '' : ' wp-eco-co-disabled'}`, `
      <div class="wp-eco-cocard-main">
        <div class="wp-eco-cocard-title"><strong>${esc(r.name)}</strong> <span class="wp-eco-dim">${esc(r.item)}</span> ${dis}</div>
        <div class="wp-eco-cocard-gold">${f(r.potentialNetPerDay)} <span class="wp-eco-dim">${esc(tf('goldDay'))}</span></div>
      </div>
      <div class="wp-eco-cobar"><span style="width:${pct}%"></span></div>
      <div class="wp-eco-cocard-tags">
        <span class="wp-eco-tag">${esc(tf('colBonus'))} <strong>${f(r.bonusPercent, 1)}%</strong></span>
        <span class="wp-eco-tag">${esc(tf('colEngine'))} <strong>L${r.engineLevel}</strong></span>
        <span class="wp-eco-tag">${esc(tf('colWorkers'))} <strong>${r.workers}/${r.maxWorkers}</strong></span>
      </div>`));
  });
  sec.appendChild(list);
  return sec;
}

const SIGNAL_RANK = { green: 0, yellow: 1, null: 2 };
const SIGNAL_EMOJI = { green: '🟢', yellow: '🟡', null: '⚪' };

function renderPositioning(results) {
  if (!results.length) return section(tf('secPositioning'), esc(tf('noCompanies')), 'neutral');
  const g = results.filter(r => r.signal === 'green').length;
  const y = results.filter(r => r.signal === 'yellow').length;
  const w = results.length - g - y;
  const cls = g ? 'green' : (y ? 'yellow' : 'neutral');
  const sec = section(tf('secPositioning'),
    `${esc(tf('posHeadMove', { n: g }))} · ${esc(tf('posHeadUpside', { n: y }))} · ${esc(tf('posHeadOptimal', { n: w }))}`, cls);

  const ordered = [...results].slice(0, 20).sort((a, b) => (SIGNAL_RANK[a.signal] ?? 2) - (SIGNAL_RANK[b.signal] ?? 2));
  const list = h('div', 'wp-eco-list');
  for (const r of ordered) {
    const oc = r.company;
    const disTag = oc.disabled ? ` <span class="wp-eco-disabled-tag">${esc(tf('disabledBadge'))}</span>` : '';
    if (r.alreadyBest || r.signal == null) {
      list.appendChild(h('div', 'wp-eco-item wp-eco-item-white',
        `<div class="wp-eco-item-title">⚪ ${esc(oc.name)} <span class="wp-eco-dim">(${esc(oc.itemCode)})</span>${disTag}</div>
         <div class="wp-eco-item-body">${esc(tf('alreadyOptimal'))} — ${esc(r.currentLabel)}, ${f(r.currentBonus, 1)}% ${esc(tf('colBonus'))}</div>`));
      continue;
    }
    const paybackText = r.paybackDays != null ? tf('paybackD', { d: f(r.paybackDays, 1) }) : tf('noRealGain');
    let depositNote = '';
    if (r.depositPct) depositNote = `<div class="wp-eco-deposit">⚠️ ${esc(tf('depositNote', { pct: f(r.depositPct, 0), when: r.depositEndAt ? relTime(r.depositEndAt) : '?' }))}</div>`;
    list.appendChild(h('div', `wp-eco-item wp-eco-item-${r.signal}`,
      `<div class="wp-eco-item-title">${SIGNAL_EMOJI[r.signal]} ${esc(oc.name)} <span class="wp-eco-dim">(${esc(oc.itemCode)})</span>${disTag}</div>
       <div class="wp-eco-item-body">
         ${esc(r.currentLabel)} (${f(r.currentBonus, 1)}%) <span class="wp-eco-arrow">→</span> <strong>${esc(r.targetLabel)}</strong> (${f(r.targetBonus, 1)}%)<br>
         <span class="wp-eco-gain">+${f(r.gainPerDay)} ${esc(tf('goldDay'))}</span> · ${esc(tf('moveCost', { g: f(r.moveCostGold) }))} · ${esc(paybackText)}
       </div>${depositNote}`));
  }
  sec.appendChild(list);
  sec.appendChild(h('div', 'wp-eco-footnote', esc(tf('posLegend'))));
  return sec;
}

function renderWorkers(results) {
  if (!results.length) return section(tf('secWorkers'), esc(tf('noWorkers')), 'neutral');
  const movingN = results.filter(p => p.moving).length;
  const sec = section(tf('secWorkers'),
    `${esc(tf('wrkHeadMove', { n: movingN }))} · ${esc(tf('wrkHeadOptimal', { n: results.length - movingN }))}`, movingN ? 'green' : 'neutral');

  const ordered = [...results].slice(0, 20).sort((a, b) => (a.moving === b.moving ? 0 : a.moving ? -1 : 1));
  const list = h('div', 'wp-eco-list');
  for (const p of ordered) {
    const cur = p.currentCompany;
    const wageTag = `${f(p.worker.wage, 3)} <span class="wp-eco-dim">(${f(p.netWage, 3)} ${esc(tf('net'))})</span>`;
    if (!p.moving) {
      list.appendChild(h('div', 'wp-eco-item wp-eco-item-white',
        `<div class="wp-eco-item-title">⚪ ${esc(p.username)} — ${wageTag}</div>
         <div class="wp-eco-item-body">${esc(tf('alreadyOptimal'))} · <strong>${esc(cur.name)}</strong> (${esc(cur.itemCode)}) — ${f(p.curProfitPerDay)} ${esc(tf('goldDay'))}</div>`));
      continue;
    }
    const chosen = p.chosen, gain = chosen.profitPerDay - p.curProfitPerDay;
    list.appendChild(h('div', 'wp-eco-item wp-eco-item-green',
      `<div class="wp-eco-item-title">🟢 ${esc(p.username)} — ${wageTag}</div>
       <div class="wp-eco-item-body">
         ${esc(cur.name)} (${esc(cur.itemCode)}) <span class="wp-eco-arrow">→</span> <strong>${esc(chosen.company.name)}</strong> (${esc(chosen.company.itemCode)})<br>
         ${esc(tf('profit'))} ${f(p.curProfitPerDay)} → <strong>${f(chosen.profitPerDay)}</strong> <span class="wp-eco-gain">(+${f(gain)})</span><br>
         <span class="wp-eco-dim">${esc(tf('setWage', { g: f(chosen.requiredGross, 3) }))}</span>
       </div>`));
  }
  sec.appendChild(list);
  sec.appendChild(h('div', 'wp-eco-footnote', esc(tf('wrkLegend'))));
  return sec;
}

function renderHiring(hiring) {
  const rows = hiring.rows || [];
  if (!rows.length) return section(tf('secHiring'), esc(tf('noHiring')), 'neutral');
  const sec = section(tf('secHiring'), `${rows.length}`, 'green');
  sec.appendChild(h('div', 'wp-eco-hire-intro', esc(tf('hiringIntro'))));

  const list = h('div', 'wp-eco-list');
  for (const r of rows.slice(0, 20)) {
    const oc = r.company;
    const gainLine = hiring.rawProd > 0
      ? `<span class="wp-eco-gain">${esc(tf('ownerGain', { g: f(r.ownerGainPerDay) }))}</span> · <span class="wp-eco-dim">${esc(tf('workerTakeHome', { g: f(r.workerTakeHomePerDay) }))}</span>`
      : `<span class="wp-eco-dim">${esc(tf('maxWageNote', { g: f(r.breakEvenGross, 3) }))}</span>`;
    list.appendChild(h('div', 'wp-eco-item wp-eco-item-green',
      `<div class="wp-eco-item-title">💼 ${esc(oc.name)} <span class="wp-eco-dim">(${esc(oc.itemCode)})</span> · ${esc(tf('freeSlots', { n: r.freeSlots }))}</div>
       <div class="wp-eco-item-body">
         <strong>${esc(tf('suggestWage', { g: f(r.suggestedWage, 3) }))}</strong> <span class="wp-eco-dim">· ${esc(tf('maxWageNote', { g: f(r.breakEvenGross, 3) }))}</span><br>
         ${gainLine}
       </div>`));
  }
  sec.appendChild(list);
  const refNote = hiring.rawProd > 0
    ? tf('hiringRef', { e: f(hiring.refEnergy, 0), p: f(hiring.refProd, 0), raw: f(hiring.rawProd, 1) })
    : tf('hiringNoRef');
  sec.appendChild(h('div', 'wp-eco-footnote', esc(refNote)));
  return sec;
}
