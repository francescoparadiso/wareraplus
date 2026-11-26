/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: quante aziende stanno in una nazione
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-26): per ogni nazione il numero di
   aziende che stanno nelle sue regioni, e la sua curva a 7/30/60/90
   giorni. Due posti:

     · la colonna «Aziende» dell'elenco di tutte le nazioni (una metrica
       in metrics.js, quindi anche scheda e confronto 1 vs 2), da
       /company-count senza nazione: l'ultima notte per tutte;
     · la carta «Aziende nella nazione» della scheda Economia
       (ecoSection.js), da /company-count?countryId=: la serie.

   Il dato viene dal censimento aziende notturno (server/companyCensus.js,
   "QUANTE AZIENDE"), quindi porta il suo perimetro e la carta lo dice:
   aziende di proprietari che hanno giocato negli ultimi 3 giorni, nella
   nazione che possedeva la regione QUELLA notte. Le notti prima del 26
   novembre vengono dai backup del server (le fotografie di allora, non
   ricostruite col dato di oggi), e dove un backup manca c'è un buco: il
   grafico interrompe la linea invece di unire i punti come se sapesse.

   Stesso giorno, seconda richiesta: «conti sulle aziende attive/inattive e
   modo di filtrarle». ATTIVA = almeno un dipendente in rosa quella notte,
   INATTIVA = nessuno, DISABILITATA = spenta dal gioco (`disabledAt`, lente a
   parte). La carta ha un filtro Tutte / Attive / Inattive / Disabilitate
   che cambia tessere e curva; l'elenco ha la colonna «Aziende attive».
   Attive e inattive esistono dal 20 novembre (prima il censimento non
   chiedeva la rosa a tutte), le disabilitate dal censimento del 27: la
   carta lo dichiara quando il filtro le mostra.

   Senza la rotta (server non rideployato) la colonna mostra «—» e la carta
   dice che lo storico manca: nessun ripiego, il browser non può contare
   centomila aziende da sé.

   Dizionario locale a 9 lingue qui sotto (solo questa carta lo usa).
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { getLang } from '../shared/i18n.js';

// Più largo degli 8 s di api.js: all'apertura della scheda Economia partono
// sette richieste insieme, e con il VPS impegnato la prima prova scadeva.
const TIMEOUT_MS = 15000;
const TTL_MS = 10 * 60 * 1000;   // il dato cambia una volta a notte
export const COC_RANGES = [7, 30, 60, 90];

const DICT = {
  en: {
    fAll: "All",
    fActive: "Active",
    fInactive: "Inactive",
    fDisabled: "Disabled",
    fLbl: "Show",
    activeShare: "Active share",
    split: "Active (with employees) {a} · inactive (no employees) {i} · disabled {d}",
    what: "Active = at least one employee on the roster that night; inactive = none (the owner can still work it). Disabled = switched off by the game (disabledAt), a separate lens that cuts across the other two.",
    wFrom: "Active and inactive are counted from {d}: before that the census did not ask every company for its roster.",
    dNone: "Disabled companies are counted from the next nightly census.",
    dFrom: "Disabled companies are counted from {d}.",
    title: 'Companies in the nation',
    sub: 'Companies located in the regions of {nation}, counted every night by the company census.',
    now: 'Companies now', ch7: 'vs 7 days ago', ch30: 'vs 30 days ago', share: 'Share of the world', rank: 'World rank',
    rankOf: '#{r} of {n}', chart: 'Companies in {nation} over time', lbl: 'Companies', fromBackup: 'from the server backups',
    r7: '7 days', r30: '30 days', r60: '60 days', r90: '90 days',
    scope: 'Only companies whose owner played in the last 3 days (the census threshold), in the nation that held the region that night: the number also moves when more or fewer people play. Read on {d}.',
    cover: 'History since {d}. Nights before {r} come from the server backups (the snapshots taken those nights, not rebuilt from today’s data); where a night is missing the line is broken.',
    coverShort: 'History since {d}: this window shows fewer days.',
    none: 'The server does not have the company count history yet.',
    noHist: 'Not enough nights in this window to draw a curve.',
    zero: 'No company counted in {nation} that night.',
  },
  it: {
    fAll: "Tutte",
    fActive: "Attive",
    fInactive: "Inattive",
    fDisabled: "Disabilitate",
    fLbl: "Mostra",
    activeShare: "Quota attive",
    split: "Attive (con dipendenti) {a} · inattive (senza dipendenti) {i} · disabilitate {d}",
    what: "Attiva = almeno un dipendente in rosa quella notte; inattiva = nessuno (il proprietario può ancora lavorarci). Disabilitata = spenta dal gioco (disabledAt), una lente a parte che taglia le altre due.",
    wFrom: "Attive e inattive si contano dal {d}: prima il censimento non chiedeva la rosa a tutte le aziende.",
    dNone: "Le disabilitate si contano dal prossimo censimento notturno.",
    dFrom: "Le disabilitate si contano dal {d}.",
    title: 'Aziende nella nazione',
    sub: 'Aziende che stanno nelle regioni di {nation}, contate ogni notte dal censimento aziende.',
    now: 'Aziende adesso', ch7: 'rispetto a 7 giorni fa', ch30: 'rispetto a 30 giorni fa', share: 'Quota del mondo', rank: 'Posizione mondiale',
    rankOf: '#{r} su {n}', chart: 'Aziende in {nation} nel tempo', lbl: 'Aziende', fromBackup: 'dai backup del server',
    r7: '7 giorni', r30: '30 giorni', r60: '60 giorni', r90: '90 giorni',
    scope: 'Solo le aziende il cui proprietario ha giocato negli ultimi 3 giorni (la soglia del censimento), nella nazione che possedeva la regione quella notte: il numero si muove anche quando gioca più o meno gente. Letto il {d}.',
    cover: 'Storico dal {d}. Le notti prima del {r} vengono dai backup del server (le fotografie scattate quelle notti, non ricostruite col dato di oggi); dove manca una notte la linea si interrompe.',
    coverShort: 'Storico dal {d}: questa finestra mostra meno giorni.',
    none: 'Il server non ha ancora lo storico del numero di aziende.',
    noHist: 'In questa finestra non ci sono abbastanza notti per una curva.',
    zero: 'Nessuna azienda contata in {nation} quella notte.',
  },
  es: {
    fAll: "Todas",
    fActive: "Activas",
    fInactive: "Inactivas",
    fDisabled: "Desactivadas",
    fLbl: "Mostrar",
    activeShare: "Cuota de activas",
    split: "Activas (con empleados) {a} · inactivas (sin empleados) {i} · desactivadas {d}",
    what: "Activa = al menos un empleado en plantilla esa noche; inactiva = ninguno (el dueño aún puede trabajarla). Desactivada = apagada por el juego (disabledAt), una lente aparte que corta las otras dos.",
    wFrom: "Activas e inactivas se cuentan desde el {d}: antes el censo no pedía la plantilla a todas las empresas.",
    dNone: "Las desactivadas se cuentan desde el próximo censo nocturno.",
    dFrom: "Las desactivadas se cuentan desde el {d}.",
    title: 'Empresas en la nación',
    sub: 'Empresas situadas en las regiones de {nation}, contadas cada noche por el censo de empresas.',
    now: 'Empresas ahora', ch7: 'frente a hace 7 días', ch30: 'frente a hace 30 días', share: 'Cuota del mundo', rank: 'Posición mundial',
    rankOf: '#{r} de {n}', chart: 'Empresas en {nation} en el tiempo', lbl: 'Empresas', fromBackup: 'de las copias de seguridad del servidor',
    r7: '7 días', r30: '30 días', r60: '60 días', r90: '90 días',
    scope: 'Solo empresas cuyo dueño jugó en los últimos 3 días (el umbral del censo), en la nación que tenía la región esa noche: el número también se mueve cuando juega más o menos gente. Leído el {d}.',
    cover: 'Historial desde el {d}. Las noches antes del {r} vienen de las copias de seguridad del servidor (las fotos de esas noches, no reconstruidas con los datos de hoy); donde falta una noche la línea se corta.',
    coverShort: 'Historial desde el {d}: esta ventana muestra menos días.',
    none: 'El servidor aún no tiene el historial del número de empresas.',
    noHist: 'No hay suficientes noches en esta ventana para una curva.',
    zero: 'Ninguna empresa contada en {nation} esa noche.',
  },
  de: {
    fAll: "Alle",
    fActive: "Aktiv",
    fInactive: "Inaktiv",
    fDisabled: "Deaktiviert",
    fLbl: "Zeigen",
    activeShare: "Anteil aktiv",
    split: "Aktiv (mit Angestellten) {a} · inaktiv (ohne Angestellte) {i} · deaktiviert {d}",
    what: "Aktiv = mindestens ein Angestellter im Kader in jener Nacht; inaktiv = keiner (der Besitzer kann noch selbst arbeiten). Deaktiviert = vom Spiel abgeschaltet (disabledAt), eine eigene Sicht quer zu den anderen beiden.",
    wFrom: "Aktiv und inaktiv werden seit {d} gezählt: vorher hat der Zensus nicht jedes Unternehmen nach seinem Kader gefragt.",
    dNone: "Deaktivierte Unternehmen werden ab dem nächsten nächtlichen Zensus gezählt.",
    dFrom: "Deaktivierte Unternehmen werden seit {d} gezählt.",
    title: 'Unternehmen in der Nation',
    sub: 'Unternehmen in den Regionen von {nation}, jede Nacht vom Unternehmenszensus gezählt.',
    now: 'Unternehmen jetzt', ch7: 'ggü. vor 7 Tagen', ch30: 'ggü. vor 30 Tagen', share: 'Anteil an der Welt', rank: 'Weltrang',
    rankOf: '#{r} von {n}', chart: 'Unternehmen in {nation} im Zeitverlauf', lbl: 'Unternehmen', fromBackup: 'aus den Server-Backups',
    r7: '7 Tage', r30: '30 Tage', r60: '60 Tage', r90: '90 Tage',
    scope: 'Nur Unternehmen, deren Besitzer in den letzten 3 Tagen gespielt hat (die Schwelle des Zensus), in der Nation, der die Region in jener Nacht gehörte: die Zahl bewegt sich auch, wenn mehr oder weniger Leute spielen. Gelesen am {d}.',
    cover: 'Verlauf seit {d}. Nächte vor {r} stammen aus den Server-Backups (die Aufnahmen jener Nächte, nicht mit heutigen Daten nachgebaut); wo eine Nacht fehlt, ist die Linie unterbrochen.',
    coverShort: 'Verlauf seit {d}: dieses Fenster zeigt weniger Tage.',
    none: 'Der Server hat noch keinen Verlauf der Unternehmenszahl.',
    noHist: 'In diesem Fenster gibt es nicht genug Nächte für eine Kurve.',
    zero: 'In jener Nacht wurde in {nation} kein Unternehmen gezählt.',
  },
  fr: {
    fAll: "Toutes",
    fActive: "Actives",
    fInactive: "Inactives",
    fDisabled: "Désactivées",
    fLbl: "Afficher",
    activeShare: "Part d’actives",
    split: "Actives (avec employés) {a} · inactives (sans employés) {i} · désactivées {d}",
    what: "Active = au moins un employé dans l’effectif cette nuit-là ; inactive = aucun (le propriétaire peut encore y travailler). Désactivée = éteinte par le jeu (disabledAt), une lentille à part qui recoupe les deux autres.",
    wFrom: "Actives et inactives sont comptées depuis le {d} : avant, le recensement ne demandait pas l’effectif à toutes les entreprises.",
    dNone: "Les entreprises désactivées seront comptées à partir du prochain recensement nocturne.",
    dFrom: "Les entreprises désactivées sont comptées depuis le {d}.",
    title: 'Entreprises dans la nation',
    sub: 'Entreprises situées dans les régions de {nation}, comptées chaque nuit par le recensement des entreprises.',
    now: 'Entreprises maintenant', ch7: 'vs il y a 7 jours', ch30: 'vs il y a 30 jours', share: 'Part du monde', rank: 'Rang mondial',
    rankOf: '#{r} sur {n}', chart: 'Entreprises en {nation} dans le temps', lbl: 'Entreprises', fromBackup: 'des sauvegardes du serveur',
    r7: '7 jours', r30: '30 jours', r60: '60 jours', r90: '90 jours',
    scope: 'Seulement les entreprises dont le propriétaire a joué ces 3 derniers jours (le seuil du recensement), dans la nation qui tenait la région cette nuit-là : le nombre bouge aussi quand plus ou moins de monde joue. Lu le {d}.',
    cover: 'Historique depuis le {d}. Les nuits avant le {r} viennent des sauvegardes du serveur (les photos prises ces nuits-là, pas reconstruites avec les données d’aujourd’hui) ; là où une nuit manque, la ligne s’interrompt.',
    coverShort: 'Historique depuis le {d} : cette fenêtre montre moins de jours.',
    none: 'Le serveur n’a pas encore l’historique du nombre d’entreprises.',
    noHist: 'Pas assez de nuits dans cette fenêtre pour une courbe.',
    zero: 'Aucune entreprise comptée en {nation} cette nuit-là.',
  },
  nl: {
    fAll: "Alle",
    fActive: "Actief",
    fInactive: "Inactief",
    fDisabled: "Uitgeschakeld",
    fLbl: "Toon",
    activeShare: "Aandeel actief",
    split: "Actief (met werknemers) {a} · inactief (zonder werknemers) {i} · uitgeschakeld {d}",
    what: "Actief = minstens één werknemer op de lijst die nacht; inactief = geen (de eigenaar kan er nog zelf werken). Uitgeschakeld = door het spel uitgezet (disabledAt), een aparte blik dwars door de andere twee.",
    wFrom: "Actief en inactief worden geteld sinds {d}: daarvoor vroeg de census niet elk bedrijf om zijn personeelslijst.",
    dNone: "Uitgeschakelde bedrijven worden geteld vanaf de volgende nachtelijke census.",
    dFrom: "Uitgeschakelde bedrijven worden geteld sinds {d}.",
    title: 'Bedrijven in de natie',
    sub: 'Bedrijven in de regio’s van {nation}, elke nacht geteld door de bedrijvencensus.',
    now: 'Bedrijven nu', ch7: 't.o.v. 7 dagen geleden', ch30: 't.o.v. 30 dagen geleden', share: 'Aandeel van de wereld', rank: 'Wereldpositie',
    rankOf: '#{r} van {n}', chart: 'Bedrijven in {nation} door de tijd', lbl: 'Bedrijven', fromBackup: 'uit de back-ups van de server',
    r7: '7 dagen', r30: '30 dagen', r60: '60 dagen', r90: '90 dagen',
    scope: 'Alleen bedrijven waarvan de eigenaar de laatste 3 dagen heeft gespeeld (de drempel van de census), in de natie die de regio die nacht bezat: het getal beweegt ook als er meer of minder mensen spelen. Gelezen op {d}.',
    cover: 'Geschiedenis sinds {d}. Nachten vóór {r} komen uit de back-ups van de server (de momentopnamen van die nachten, niet nagebouwd met de gegevens van vandaag); waar een nacht ontbreekt, is de lijn onderbroken.',
    coverShort: 'Geschiedenis sinds {d}: dit venster toont minder dagen.',
    none: 'De server heeft nog geen geschiedenis van het aantal bedrijven.',
    noHist: 'Te weinig nachten in dit venster voor een curve.',
    zero: 'Die nacht is er in {nation} geen bedrijf geteld.',
  },
  sv: {
    fAll: "Alla",
    fActive: "Aktiva",
    fInactive: "Inaktiva",
    fDisabled: "Avstängda",
    fLbl: "Visa",
    activeShare: "Andel aktiva",
    split: "Aktiva (med anställda) {a} · inaktiva (utan anställda) {i} · avstängda {d}",
    what: "Aktiv = minst en anställd på listan den natten; inaktiv = ingen (ägaren kan fortfarande arbeta där). Avstängd = avstängd av spelet (disabledAt), en egen lins tvärs över de andra två.",
    wFrom: "Aktiva och inaktiva räknas sedan {d}: innan dess bad räkningen inte alla företag om personallistan.",
    dNone: "Avstängda företag räknas från nästa nattliga räkning.",
    dFrom: "Avstängda företag räknas sedan {d}.",
    title: 'Företag i nationen',
    sub: 'Företag i regionerna i {nation}, räknade varje natt av företagsräkningen.',
    now: 'Företag nu', ch7: 'jämfört med för 7 dagar sedan', ch30: 'jämfört med för 30 dagar sedan', share: 'Andel av världen', rank: 'Världsplacering',
    rankOf: '#{r} av {n}', chart: 'Företag i {nation} över tid', lbl: 'Företag', fromBackup: 'från serverns säkerhetskopior',
    r7: '7 dagar', r30: '30 dagar', r60: '60 dagar', r90: '90 dagar',
    scope: 'Bara företag vars ägare har spelat de senaste 3 dagarna (räkningens tröskel), i nationen som ägde regionen den natten: siffran rör sig också när fler eller färre spelar. Läst {d}.',
    cover: 'Historik sedan {d}. Nätter före {r} kommer från serverns säkerhetskopior (ögonblicksbilderna från de nätterna, inte återskapade med dagens data); där en natt saknas bryts linjen.',
    coverShort: 'Historik sedan {d}: det här fönstret visar färre dagar.',
    none: 'Servern har ännu ingen historik över antalet företag.',
    noHist: 'För få nätter i det här fönstret för en kurva.',
    zero: 'Inget företag räknades i {nation} den natten.',
  },
  pt: {
    fAll: "Todas",
    fActive: "Ativas",
    fInactive: "Inativas",
    fDisabled: "Desativadas",
    fLbl: "Mostrar",
    activeShare: "Fatia de ativas",
    split: "Ativas (com funcionários) {a} · inativas (sem funcionários) {i} · desativadas {d}",
    what: "Ativa = pelo menos um funcionário no quadro naquela noite; inativa = nenhum (o dono ainda pode trabalhar nela). Desativada = desligada pelo jogo (disabledAt), uma lente à parte que corta as outras duas.",
    wFrom: "Ativas e inativas são contadas desde {d}: antes o censo não pedia o quadro a todas as empresas.",
    dNone: "As desativadas são contadas a partir do próximo censo noturno.",
    dFrom: "As desativadas são contadas desde {d}.",
    title: 'Empresas na nação',
    sub: 'Empresas situadas nas regiões de {nation}, contadas todas as noites pelo censo de empresas.',
    now: 'Empresas agora', ch7: 'vs há 7 dias', ch30: 'vs há 30 dias', share: 'Fatia do mundo', rank: 'Posição mundial',
    rankOf: '#{r} de {n}', chart: 'Empresas em {nation} ao longo do tempo', lbl: 'Empresas', fromBackup: 'dos backups do servidor',
    r7: '7 dias', r30: '30 dias', r60: '60 dias', r90: '90 dias',
    scope: 'Apenas empresas cujo dono jogou nos últimos 3 dias (o limiar do censo), na nação que tinha a região naquela noite: o número também muda quando joga mais ou menos gente. Lido em {d}.',
    cover: 'Histórico desde {d}. As noites antes de {r} vêm dos backups do servidor (as fotos tiradas naquelas noites, não reconstruídas com os dados de hoje); onde falta uma noite a linha se interrompe.',
    coverShort: 'Histórico desde {d}: esta janela mostra menos dias.',
    none: 'O servidor ainda não tem o histórico do número de empresas.',
    noHist: 'Não há noites suficientes nesta janela para uma curva.',
    zero: 'Nenhuma empresa contada em {nation} naquela noite.',
  },
  ar: {
    fAll: "الكل",
    fActive: "نشطة",
    fInactive: "غير نشطة",
    fDisabled: "معطلة",
    fLbl: "عرض",
    activeShare: "حصة النشطة",
    split: "نشطة (بموظفين) {a} · غير نشطة (بلا موظفين) {i} · معطلة {d}",
    what: "نشطة = موظف واحد على الأقل في القائمة تلك الليلة؛ غير نشطة = لا أحد (يمكن للمالك أن يعمل فيها). معطلة = أوقفها اللعبة (disabledAt)، عدسة منفصلة تتقاطع مع الأخريين.",
    wFrom: "تُحصى النشطة وغير النشطة منذ {d}: قبل ذلك لم يكن التعداد يطلب قائمة الموظفين من كل الشركات.",
    dNone: "تُحصى الشركات المعطلة ابتداءً من التعداد الليلي القادم.",
    dFrom: "تُحصى الشركات المعطلة منذ {d}.",
    title: 'الشركات في الدولة',
    sub: 'الشركات الموجودة في مناطق {nation}، يحصيها تعداد الشركات كل ليلة.',
    now: 'الشركات الآن', ch7: 'مقارنة بقبل 7 أيام', ch30: 'مقارنة بقبل 30 يومًا', share: 'الحصة من العالم', rank: 'الترتيب العالمي',
    rankOf: '#{r} من {n}', chart: 'الشركات في {nation} عبر الزمن', lbl: 'الشركات', fromBackup: 'من النسخ الاحتياطية للخادم',
    r7: '7 أيام', r30: '30 يومًا', r60: '60 يومًا', r90: '90 يومًا',
    scope: 'فقط الشركات التي لعب مالكها خلال آخر 3 أيام (عتبة التعداد)، في الدولة التي كانت تملك المنطقة تلك الليلة: يتغير الرقم أيضًا عندما يلعب عدد أكبر أو أقل من الناس. قُرئ في {d}.',
    cover: 'السجل منذ {d}. الليالي قبل {r} مأخوذة من النسخ الاحتياطية للخادم (لقطات تلك الليالي، لا إعادة بناء ببيانات اليوم)؛ حيث تنقص ليلة ينقطع الخط.',
    coverShort: 'السجل منذ {d}: هذه النافذة تعرض أيامًا أقل.',
    none: 'لا يملك الخادم بعد سجل عدد الشركات.',
    noHist: 'لا توجد ليالٍ كافية في هذه النافذة لرسم منحنى.',
    zero: 'لم تُحصَ أي شركة في {nation} تلك الليلة.',
  },
};

export function cocT(key, vars) {
  const d = DICT[getLang()] || DICT.en;
  let s = d[key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

async function cacheJson(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ── tutte le nazioni, ultima notte (colonna dell'elenco) ─────────── */

let _all = null;          // { at, p } — la promessa dell'ultima lettura
let _counts = null;       // Map cid → [aziende, con dipendenti | null, disabilitate | null]

/** [cid, aziende, conDip, dis] → Map. Regge anche la prima forma della rotta
 *  ([cid, aziende]), servita per qualche ora il 2026-11-26. */
const toMap = (rows) => new Map(rows.map(r => [r[0], [Number(r[1]) || 0, r[2] ?? null, r[3] ?? null]]));

/** Carica (una volta ogni TTL) il conteggio di tutte le nazioni. Risolve a
 *  true se c'è un dato nuovo da disegnare. */
export function loadCompanyCounts() {
  if (_all && Date.now() - _all.at < TTL_MS) return _all.p.then(() => false);
  const p = (async () => {
    try {
      const json = await cacheJson('/company-count');
      if (json?.available !== true || !Array.isArray(json.countries)) return false;
      _counts = toMap(json.countries);
      return true;
    } catch (err) {
      console.warn('WarEra+ nations: /company-count non disponibile:', err.message);
      return false;
    }
  })();
  _all = { at: Date.now(), p };
  p.then((ok) => { if (!ok && !_counts) _all = null; });
  return p;
}

/** null finché il dato non c'è (la colonna mostra «—», non 0). */
export function companyCountOf(countryId) {
  if (!_counts) return null;
  return _counts.get(countryId)?.[0] || 0;
}
/** Attive (con dipendenti in rosa): null se il server non le conta. */
export function companyActiveOf(countryId) {
  if (!_counts) return null;
  const r = _counts.get(countryId);
  return r ? r[1] : 0;
}
export const companyActiveKnown = () => !!_counts && [..._counts.values()].some(r => r[1] != null);
export const companyCountsKnown = () => !!_counts;

/* ── una nazione, con la serie (carta della scheda Economia) ──────── */

const _one = new Map();   // cid → { at, p }

export function fetchCompanyCount(countryId) {
  if (!countryId) return Promise.resolve(null);
  const hit = _one.get(countryId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = (async () => {
    try {
      const json = await cacheJson(`/company-count?countryId=${encodeURIComponent(countryId)}&days=${Math.max(...COC_RANGES) + 1}`);
      if (json?.available !== true) return null;
      // La stessa risposta porta l'ultima notte di tutte: la colonna la riusa.
      if (Array.isArray(json.countries)) _counts = toMap(json.countries);
      return json;
    } catch (err) {
      console.warn('WarEra+ nations: /company-count non disponibile:', err.message);
      return null;
    }
  })();
  _one.set(countryId, { at: Date.now(), p });
  p.then((v) => { if (!v && _one.get(countryId)?.p === p) _one.delete(countryId); });
  return p;
}
