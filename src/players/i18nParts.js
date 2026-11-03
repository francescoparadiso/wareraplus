/* ══════════════════════════════════════════════════════════════
   WarEra+ — Giocatori: dizionario delle PARTI della ricchezza
   ------------------------------------------------------------------
   Le etichette di una sola vista stanno con la vista. La CHIAVE di
   ricaduta è l'inglese. Quelle condivise (periodi, "adesso"…) restano in
   `i18n.js` / `economy/i18nPlus.js`.
   ══════════════════════════════════════════════════════════════ */

const DICT = {
  en: {
    modeTotal: 'Total', modeParts: 'Parts', modeLabel: 'View',
    companies: 'Companies', orders: 'In buy orders', rest: 'Rest',
    hintCompanies: 'Estimated value of their companies, as the game reports it.',
    hintOrders: 'Money already placed in buy orders. A minimum: the game shows 100 orders per resource.',
    hintRest: 'Wealth minus the two parts on the left: money, items, weapons and equipment, which the game does not show separately.',
    select: 'Click a part to show or hide it.',
    noteParts: 'Companies and orders are the only parts the game lets us see. The rest is what is left of the wealth, so it is not "money": it also holds items, weapons and equipment.',
    noteSince: 'The day-by-day split starts on {d}: before that, only the total exists.',
    noteFew: 'Day-by-day split: {n} day saved so far. The lines appear from the second day.',
    noteNone: 'No day-by-day split yet for this player: the server saves it once a day, from the night company census.',
    noteNoServer: 'The split history comes from the data server, which is not answering: only today\'s split is shown.',
    noteNoCompanies: 'The companies could not be read: the split is not available right now.',
    nothing: 'Select at least one part.',
  },
  it: {
    modeTotal: 'Totale', modeParts: 'Parti', modeLabel: 'Vista',
    companies: 'Aziende', orders: 'Negli ordini d\'acquisto', rest: 'Resto',
    hintCompanies: 'Valore stimato delle sue aziende, come lo dà il gioco.',
    hintOrders: 'Soldi già messi in ordini d\'acquisto. Un minimo: il gioco mostra 100 ordini per risorsa.',
    hintRest: 'La ricchezza meno le due parti a sinistra: soldi, oggetti, armi ed equipaggiamento, che il gioco non mostra separati.',
    select: 'Clicca una parte per mostrarla o nasconderla.',
    noteParts: 'Aziende e ordini sono le uniche parti che il gioco lascia vedere. Il resto è quello che avanza dalla ricchezza, quindi non è "soldi": ci sono anche oggetti, armi ed equipaggiamento.',
    noteSince: 'La divisione giorno per giorno parte dal {d}: prima esiste solo il totale.',
    noteFew: 'Divisione giorno per giorno: {n} giorno salvato finora. Le linee compaiono dal secondo giorno.',
    noteNone: 'Ancora nessuna divisione giorno per giorno per questo giocatore: il server la salva una volta al giorno, dal censimento notturno delle aziende.',
    noteNoServer: 'Lo storico della divisione viene dal server dei dati, che non risponde: si vede solo la divisione di oggi.',
    noteNoCompanies: 'Non è stato possibile leggere le aziende: la divisione non è disponibile adesso.',
    nothing: 'Seleziona almeno una parte.',
  },
  es: {
    modeTotal: 'Total', modeParts: 'Partes', modeLabel: 'Vista',
    companies: 'Empresas', orders: 'En órdenes de compra', rest: 'Resto',
    hintCompanies: 'Valor estimado de sus empresas, según el juego.',
    hintOrders: 'Dinero ya puesto en órdenes de compra. Un mínimo: el juego muestra 100 órdenes por recurso.',
    hintRest: 'La riqueza menos las dos partes de la izquierda: dinero, objetos, armas y equipo, que el juego no muestra por separado.',
    select: 'Haz clic en una parte para mostrarla u ocultarla.',
    noteParts: 'Empresas y órdenes son las únicas partes que el juego deja ver. El resto es lo que sobra de la riqueza, así que no es "dinero": también incluye objetos, armas y equipo.',
    noteSince: 'El desglose día a día empieza el {d}: antes solo existe el total.',
    noteFew: 'Desglose día a día: {n} día guardado hasta ahora. Las líneas aparecen desde el segundo día.',
    noteNone: 'Aún no hay desglose día a día de este jugador: el servidor lo guarda una vez al día, desde el censo nocturno de empresas.',
    noteNoServer: 'El historial del desglose viene del servidor de datos, que no responde: solo se ve el desglose de hoy.',
    noteNoCompanies: 'No se pudieron leer las empresas: el desglose no está disponible ahora.',
    nothing: 'Selecciona al menos una parte.',
  },
  de: {
    modeTotal: 'Gesamt', modeParts: 'Teile', modeLabel: 'Ansicht',
    companies: 'Firmen', orders: 'In Kaufaufträgen', rest: 'Rest',
    hintCompanies: 'Geschätzter Wert seiner Firmen, wie das Spiel ihn angibt.',
    hintOrders: 'Geld, das schon in Kaufaufträgen steckt. Ein Minimum: Das Spiel zeigt 100 Aufträge pro Ressource.',
    hintRest: 'Vermögen minus die beiden Teile links: Geld, Gegenstände, Waffen und Ausrüstung, die das Spiel nicht getrennt zeigt.',
    select: 'Klicke einen Teil an, um ihn ein- oder auszublenden.',
    noteParts: 'Firmen und Aufträge sind die einzigen Teile, die das Spiel sichtbar macht. Der Rest ist, was vom Vermögen übrig bleibt, also nicht "Geld": Er enthält auch Gegenstände, Waffen und Ausrüstung.',
    noteSince: 'Die Aufteilung Tag für Tag beginnt am {d}: davor gibt es nur die Gesamtsumme.',
    noteFew: 'Aufteilung Tag für Tag: bisher {n} Tag gespeichert. Die Linien erscheinen ab dem zweiten Tag.',
    noteNone: 'Für diesen Spieler gibt es noch keine Tagesaufteilung: Der Server speichert sie einmal am Tag, aus der nächtlichen Firmenzählung.',
    noteNoServer: 'Der Verlauf der Aufteilung kommt vom Datenserver, der nicht antwortet: Nur die heutige Aufteilung ist zu sehen.',
    noteNoCompanies: 'Die Firmen konnten nicht gelesen werden: Die Aufteilung ist gerade nicht verfügbar.',
    nothing: 'Wähle mindestens einen Teil aus.',
  },
  fr: {
    modeTotal: 'Total', modeParts: 'Parts', modeLabel: 'Vue',
    companies: 'Entreprises', orders: 'En ordres d\'achat', rest: 'Reste',
    hintCompanies: 'Valeur estimée de ses entreprises, telle que le jeu la donne.',
    hintOrders: 'Argent déjà placé en ordres d\'achat. Un minimum : le jeu montre 100 ordres par ressource.',
    hintRest: 'La richesse moins les deux parts de gauche : argent, objets, armes et équipement, que le jeu ne montre pas séparément.',
    select: 'Cliquez sur une part pour l\'afficher ou la masquer.',
    noteParts: 'Entreprises et ordres sont les seules parts que le jeu laisse voir. Le reste est ce qui reste de la richesse : ce n\'est pas de l\'« argent », il contient aussi objets, armes et équipement.',
    noteSince: 'La répartition jour par jour commence le {d} : avant, il n\'existe que le total.',
    noteFew: 'Répartition jour par jour : {n} jour enregistré jusqu\'ici. Les lignes apparaissent dès le deuxième jour.',
    noteNone: 'Pas encore de répartition jour par jour pour ce joueur : le serveur l\'enregistre une fois par jour, depuis le recensement nocturne des entreprises.',
    noteNoServer: 'L\'historique de la répartition vient du serveur de données, qui ne répond pas : seule la répartition du jour est visible.',
    noteNoCompanies: 'Les entreprises n\'ont pas pu être lues : la répartition n\'est pas disponible pour l\'instant.',
    nothing: 'Sélectionnez au moins une part.',
  },
  nl: {
    modeTotal: 'Totaal', modeParts: 'Delen', modeLabel: 'Weergave',
    companies: 'Bedrijven', orders: 'In koopopdrachten', rest: 'Rest',
    hintCompanies: 'Geschatte waarde van zijn bedrijven, zoals het spel die opgeeft.',
    hintOrders: 'Geld dat al in koopopdrachten zit. Een minimum: het spel toont 100 opdrachten per grondstof.',
    hintRest: 'Vermogen min de twee delen links: geld, voorwerpen, wapens en uitrusting, die het spel niet apart toont.',
    select: 'Klik op een deel om het te tonen of te verbergen.',
    noteParts: 'Bedrijven en opdrachten zijn de enige delen die het spel laat zien. De rest is wat van het vermogen overblijft, dus niet "geld": het bevat ook voorwerpen, wapens en uitrusting.',
    noteSince: 'De verdeling dag voor dag begint op {d}: daarvoor bestaat alleen het totaal.',
    noteFew: 'Verdeling dag voor dag: tot nu toe {n} dag opgeslagen. De lijnen verschijnen vanaf de tweede dag.',
    noteNone: 'Nog geen dagverdeling voor deze speler: de server slaat die eenmaal per dag op, uit de nachtelijke bedrijventelling.',
    noteNoServer: 'De geschiedenis van de verdeling komt van de dataserver, die niet antwoordt: alleen de verdeling van vandaag is te zien.',
    noteNoCompanies: 'De bedrijven konden niet worden gelezen: de verdeling is nu niet beschikbaar.',
    nothing: 'Selecteer minstens één deel.',
  },
  sv: {
    modeTotal: 'Totalt', modeParts: 'Delar', modeLabel: 'Vy',
    companies: 'Företag', orders: 'I köporder', rest: 'Resten',
    hintCompanies: 'Uppskattat värde på hans företag, som spelet anger det.',
    hintOrders: 'Pengar som redan ligger i köporder. Ett minimum: spelet visar 100 order per resurs.',
    hintRest: 'Förmögenheten minus de två delarna till vänster: pengar, föremål, vapen och utrustning, som spelet inte visar separat.',
    select: 'Klicka på en del för att visa eller dölja den.',
    noteParts: 'Företag och order är de enda delar spelet låter oss se. Resten är det som blir över av förmögenheten, alltså inte "pengar": den rymmer också föremål, vapen och utrustning.',
    noteSince: 'Uppdelningen dag för dag börjar den {d}: före det finns bara totalen.',
    noteFew: 'Uppdelning dag för dag: {n} dag sparad hittills. Linjerna visas från den andra dagen.',
    noteNone: 'Ingen daglig uppdelning för den här spelaren än: servern sparar den en gång om dagen, från den nattliga företagsräkningen.',
    noteNoServer: 'Historiken för uppdelningen kommer från dataservern, som inte svarar: bara dagens uppdelning visas.',
    noteNoCompanies: 'Företagen kunde inte läsas: uppdelningen är inte tillgänglig just nu.',
    nothing: 'Välj minst en del.',
  },
  pt: {
    modeTotal: 'Total', modeParts: 'Partes', modeLabel: 'Vista',
    companies: 'Empresas', orders: 'Em ordens de compra', rest: 'Resto',
    hintCompanies: 'Valor estimado das suas empresas, como o jogo informa.',
    hintOrders: 'Dinheiro já colocado em ordens de compra. Um mínimo: o jogo mostra 100 ordens por recurso.',
    hintRest: 'A riqueza menos as duas partes à esquerda: dinheiro, itens, armas e equipamento, que o jogo não mostra separados.',
    select: 'Clique numa parte para mostrá-la ou escondê-la.',
    noteParts: 'Empresas e ordens são as únicas partes que o jogo deixa ver. O resto é o que sobra da riqueza, por isso não é "dinheiro": também inclui itens, armas e equipamento.',
    noteSince: 'A divisão dia a dia começa em {d}: antes disso só existe o total.',
    noteFew: 'Divisão dia a dia: {n} dia guardado até agora. As linhas aparecem a partir do segundo dia.',
    noteNone: 'Ainda não há divisão dia a dia para este jogador: o servidor guarda-a uma vez por dia, a partir do recenseamento noturno das empresas.',
    noteNoServer: 'O histórico da divisão vem do servidor de dados, que não responde: só se vê a divisão de hoje.',
    noteNoCompanies: 'Não foi possível ler as empresas: a divisão não está disponível agora.',
    nothing: 'Selecione pelo menos uma parte.',
  },
  ar: {
    modeTotal: 'الإجمالي', modeParts: 'الأجزاء', modeLabel: 'العرض',
    companies: 'الشركات', orders: 'في أوامر الشراء', rest: 'الباقي',
    hintCompanies: 'القيمة التقديرية لشركاته كما تعرضها اللعبة.',
    hintOrders: 'مال موضوع فعلاً في أوامر شراء. حدّ أدنى: تعرض اللعبة 100 أمر لكل مورد.',
    hintRest: 'الثروة مطروحاً منها الجزءان على اليسار: المال والأغراض والأسلحة والعتاد، ولا تعرضها اللعبة منفصلة.',
    select: 'انقر على جزء لإظهاره أو إخفائه.',
    noteParts: 'الشركات والأوامر هما الجزءان الوحيدان اللذان تُظهرهما اللعبة. الباقي هو ما تبقى من الثروة، فهو ليس "مالاً": يشمل أيضاً الأغراض والأسلحة والعتاد.',
    noteSince: 'التقسيم يوماً بيوم يبدأ في {d}: قبل ذلك يوجد الإجمالي فقط.',
    noteFew: 'التقسيم يوماً بيوم: {n} يوم محفوظ حتى الآن. تظهر الخطوط من اليوم الثاني.',
    noteNone: 'لا يوجد تقسيم يومي لهذا اللاعب بعد: يحفظه الخادم مرة في اليوم من الإحصاء الليلي للشركات.',
    noteNoServer: 'سجل التقسيم يأتي من خادم البيانات الذي لا يردّ: يظهر تقسيم اليوم فقط.',
    noteNoCompanies: 'تعذّرت قراءة الشركات: التقسيم غير متاح الآن.',
    nothing: 'اختر جزءاً واحداً على الأقل.',
  },
};

function lang() {
  const l = (localStorage.getItem('we_lang') || navigator.language || 'en').slice(0, 2).toLowerCase();
  return DICT[l] ? l : 'en';
}

/** `prtT('noteSince', { d: '4 nov' })` — stessa firma di `plyT`. */
export function prtT(key, vars) {
  const d = DICT[lang()] || DICT.en;
  let s = d[key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
