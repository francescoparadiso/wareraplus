/* ══════════════════════════════════════════════════════════════
   WarEra+ — Traduzioni di Statistiche alleanze (src/diplomacy/blocStats.js)
   ------------------------------------------------------------------
   La vista era nata tutta in inglese, in un file di 2500 righe con i testi
   dentro i template. Invece di dare un nome a ogni stringa, la CHIAVE è il
   testo inglese stesso: nel codice resta leggibile cosa c'è scritto
   (`bT('Weekly damage')`), e una traduzione mancante ricade sull'inglese
   invece di mostrare una chiave. Le variabili vanno fra graffe: `{n}`.

   Riga = [it, es, de, fr, nl, sv, pt, ar], nell'ordine di LANGS in
   src/shared/i18n.js. È un dizionario LOCALE, come quelli delle altre
   viste: queste etichette le usa solo questa pagina.
   ══════════════════════════════════════════════════════════════ */

import { getLang } from '../shared/i18n.js';

const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];

const T = {
  // ── Schede e intestazione
  'Alliance Overview': ['Panoramica alleanze', 'Resumen de alianzas', 'Allianzübersicht', 'Vue des alliances', 'Overzicht allianties', 'Allianser – översikt', 'Visão geral das alianças', 'نظرة عامة على التحالفات'],
  'Alliance Builder': ['Costruttore di alleanze', 'Constructor de alianzas', 'Allianz-Baukasten', 'Constructeur d’alliances', 'Alliantiebouwer', 'Alliansbyggare', 'Construtor de alianças', 'منشئ التحالفات'],
  'Faction 1 vs 2': ['Fazione 1 vs 2', 'Facción 1 vs 2', 'Fraktion 1 vs 2', 'Faction 1 vs 2', 'Factie 1 vs 2', 'Fraktion 1 mot 2', 'Facção 1 vs 2', 'الفصيل 1 ضد 2'],
  'Wars & Enemies': ['Guerre e nemici', 'Guerras y enemigos', 'Kriege & Feinde', 'Guerres & ennemis', 'Oorlogen & vijanden', 'Krig & fiender', 'Guerras e inimigos', 'الحروب والأعداء'],
  '⟳ Reset all merges & assignments': ['⟳ Annulla fusioni e spostamenti', '⟳ Deshacer fusiones y asignaciones', '⟳ Alle Fusionen & Zuordnungen zurücksetzen', '⟳ Annuler fusions et affectations', '⟳ Alle samenvoegingen & toewijzingen wissen', '⟳ Återställ sammanslagningar & flyttar', '⟳ Desfazer fusões e atribuições', '⟳ إعادة ضبط الدمج والتعيينات'],
  'No data.': ['Nessun dato.', 'Sin datos.', 'Keine Daten.', 'Aucune donnée.', 'Geen gegevens.', 'Inga data.', 'Sem dados.', 'لا توجد بيانات.'],
  'No data': ['Nessun dato', 'Sin datos', 'Keine Daten', 'Aucune donnée', 'Geen gegevens', 'Inga data', 'Sem dados', 'لا توجد بيانات'],
  'Unknown': ['Sconosciuta', 'Desconocida', 'Unbekannt', 'Inconnue', 'Onbekend', 'Okänd', 'Desconhecida', 'غير معروف'],

  // ── Misure (etichette ricorrenti)
  'Name': ['Nome', 'Nombre', 'Name', 'Nom', 'Naam', 'Namn', 'Nome', 'الاسم'],
  'Nations': ['Nazioni', 'Naciones', 'Nationen', 'Nations', 'Landen', 'Nationer', 'Nações', 'الدول'],
  'Nation': ['Nazione', 'Nación', 'Nation', 'Nation', 'Land', 'Nation', 'Nação', 'الدولة'],
  'Countries': ['Nazioni', 'Países', 'Länder', 'Pays', 'Landen', 'Länder', 'Países', 'الدول'],
  'Alliance': ['Alleanza', 'Alianza', 'Allianz', 'Alliance', 'Alliantie', 'Allians', 'Aliança', 'التحالف'],
  'Alliances': ['Alleanze', 'Alianzas', 'Allianzen', 'Alliances', 'Allianties', 'Allianser', 'Alianças', 'التحالفات'],
  '% world core': ['% core mondiale', '% núcleo mundial', '% Welt-Kern', '% cœur mondial', '% wereldkern', '% världskärna', '% núcleo mundial', '% من النواة العالمية'],
  '% core': ['% core', '% núcleo', '% Kern', '% cœur', '% kern', '% kärna', '% núcleo', '% النواة'],
  'Damage bonus': ['Bonus danno', 'Bonus de daño', 'Schadensbonus', 'Bonus de dégâts', 'Schadebonus', 'Skadebonus', 'Bônus de dano', 'مكافأة الضرر'],
  'Damage Bonus': ['Bonus danno', 'Bonus de daño', 'Schadensbonus', 'Bonus de dégâts', 'Schadebonus', 'Skadebonus', 'Bônus de dano', 'مكافأة الضرر'],
  'Bonus': ['Bonus', 'Bonus', 'Bonus', 'Bonus', 'Bonus', 'Bonus', 'Bônus', 'المكافأة'],
  'Weekly damage': ['Danni settimanali', 'Daño semanal', 'Wochenschaden', 'Dégâts hebdo', 'Weekschade', 'Veckoskada', 'Dano semanal', 'الضرر الأسبوعي'],
  'Weekly Damage': ['Danni settimanali', 'Daño semanal', 'Wochenschaden', 'Dégâts hebdo', 'Weekschade', 'Veckoskada', 'Dano semanal', 'الضرر الأسبوعي'],
  'Total damage': ['Danni totali', 'Daño total', 'Gesamtschaden', 'Dégâts totaux', 'Totale schade', 'Total skada', 'Dano total', 'الضرر الإجمالي'],
  'Total Damage': ['Danni totali', 'Daño total', 'Gesamtschaden', 'Dégâts totaux', 'Totale schade', 'Total skada', 'Dano total', 'الضرر الإجمالي'],
  'Total dmg': ['Danni tot.', 'Daño tot.', 'Schaden ges.', 'Dégâts tot.', 'Schade tot.', 'Skada tot.', 'Dano tot.', 'الضرر الكلي'],
  'Damage Today': ['Danni di oggi', 'Daño de hoy', 'Schaden heute', 'Dégâts du jour', 'Schade vandaag', 'Skada idag', 'Dano de hoje', 'ضرر اليوم'],
  'Population': ['Popolazione', 'Población', 'Bevölkerung', 'Population', 'Bevolking', 'Befolkning', 'População', 'السكان'],
  'Total Population': ['Popolazione totale', 'Población total', 'Gesamtbevölkerung', 'Population totale', 'Totale bevolking', 'Total befolkning', 'População total', 'إجمالي السكان'],
  'Pop': ['Pop.', 'Pob.', 'Bev.', 'Pop.', 'Bev.', 'Bef.', 'Pop.', 'السكان'],
  'Wealth': ['Ricchezza', 'Riqueza', 'Reichtum', 'Richesse', 'Rijkdom', 'Rikedom', 'Riqueza', 'الثروة'],
  'Total Wealth': ['Ricchezza totale', 'Riqueza total', 'Gesamtreichtum', 'Richesse totale', 'Totale rijkdom', 'Total rikedom', 'Riqueza total', 'إجمالي الثروة'],
  'Wealth/cit': ['Ricch./citt.', 'Riqueza/ciud.', 'Reichtum/Bürger', 'Richesse/cit.', 'Rijkdom/burger', 'Rikedom/inv.', 'Riqueza/cid.', 'الثروة/مواطن'],
  'Wealth / Citizen': ['Ricchezza per cittadino', 'Riqueza por ciudadano', 'Reichtum pro Bürger', 'Richesse par citoyen', 'Rijkdom per burger', 'Rikedom per invånare', 'Riqueza por cidadão', 'الثروة لكل مواطن'],
  'Wk damage/citizen': ['Danni sett./cittadino', 'Daño sem./ciudadano', 'Wochenschaden/Bürger', 'Dégâts hebdo/citoyen', 'Weekschade/burger', 'Veckoskada/invånare', 'Dano sem./cidadão', 'الضرر الأسبوعي/مواطن'],
  'Weekly Dmg / Citizen': ['Danni sett. per cittadino', 'Daño sem. por ciudadano', 'Wochenschaden pro Bürger', 'Dégâts hebdo par citoyen', 'Weekschade per burger', 'Veckoskada per invånare', 'Dano sem. por cidadão', 'الضرر الأسبوعي لكل مواطن'],
  'Weekly': ['Settimanali', 'Semanal', 'Woche', 'Hebdo', 'Week', 'Vecka', 'Semanal', 'أسبوعي'],
  'Weekly/cit': ['Sett./citt.', 'Sem./ciud.', 'Woche/Bürger', 'Hebdo/cit.', 'Week/burger', 'Vecka/inv.', 'Sem./cid.', 'أسبوعي/مواطن'],
  'Today': ['Oggi', 'Hoy', 'Heute', 'Aujourd’hui', 'Vandaag', 'Idag', 'Hoje', 'اليوم'],
  'Wars': ['Guerre', 'Guerras', 'Kriege', 'Guerres', 'Oorlogen', 'Krig', 'Guerras', 'الحروب'],
  'Active Wars': ['Guerre in corso', 'Guerras activas', 'Aktive Kriege', 'Guerres en cours', 'Actieve oorlogen', 'Pågående krig', 'Guerras ativas', 'الحروب الجارية'],
  'Defensive Pacts': ['Patti difensivi', 'Pactos defensivos', 'Verteidigungspakte', 'Pactes défensifs', 'Verdedigingspacten', 'Försvarspakter', 'Pactos defensivos', 'اتفاقيات الدفاع'],
  'Pacts': ['Patti', 'Pactos', 'Pakte', 'Pactes', 'Pacten', 'Pakter', 'Pactos', 'الاتفاقيات'],
  'Development': ['Sviluppo', 'Desarrollo', 'Entwicklung', 'Développement', 'Ontwikkeling', 'Utveckling', 'Desenvolvimento', 'التنمية'],
  'Avg Development': ['Sviluppo medio', 'Desarrollo medio', 'Ø Entwicklung', 'Développement moyen', 'Gem. ontwikkeling', 'Snittutveckling', 'Desenvolvimento médio', 'متوسط التنمية'],
  'Dev': ['Svil.', 'Des.', 'Entw.', 'Dév.', 'Ontw.', 'Utv.', 'Des.', 'التنمية'],
  'Expansion': ['Espansione', 'Expansión', 'Expansion', 'Expansion', 'Expansie', 'Expansion', 'Expansão', 'التوسع'],
  'Regions': ['Regioni', 'Regiones', 'Regionen', 'Régions', 'Regio’s', 'Regioner', 'Regiões', 'المناطق'],
  'Regions +/-': ['Regioni +/-', 'Regiones +/-', 'Regionen +/-', 'Régions +/-', 'Regio’s +/-', 'Regioner +/-', 'Regiões +/-', 'المناطق +/-'],
  'Regions Gained': ['Regioni guadagnate', 'Regiones ganadas', 'Gewonnene Regionen', 'Régions gagnées', 'Gewonnen regio’s', 'Vunna regioner', 'Regiões ganhas', 'المناطق المكتسبة'],
  'Regions gained or lost since the start': ['Regioni guadagnate o perse dall’inizio', 'Regiones ganadas o perdidas desde el inicio', 'Seit Beginn gewonnene oder verlorene Regionen', 'Régions gagnées ou perdues depuis le début', 'Regio’s gewonnen of verloren sinds het begin', 'Regioner vunna eller förlorade sedan start', 'Regiões ganhas ou perdidas desde o início', 'المناطق المكتسبة أو المفقودة منذ البداية'],
  'Sworn Enemies': ['Nemici giurati', 'Enemigos jurados', 'Erzfeinde', 'Ennemis jurés', 'Gezworen vijanden', 'Svurna fiender', 'Inimigos jurados', 'الأعداء اللدودون'],
  'Bounty Earned': ['Taglie incassate', 'Recompensas cobradas', 'Kassierte Kopfgelder', 'Primes encaissées', 'Geïnde premies', 'Inkasserade prispengar', 'Recompensas recebidas', 'المكافآت المحصّلة'],
  'Total Bounty': ['Taglie totali', 'Recompensas totales', 'Kopfgelder gesamt', 'Primes totales', 'Totale premies', 'Totala prispengar', 'Recompensas totais', 'إجمالي المكافآت'],
  'Avg Dmg/Nation': ['Danni medi/nazione', 'Daño medio/nación', 'Ø Schaden/Nation', 'Dégâts moy./nation', 'Gem. schade/land', 'Snittskada/nation', 'Dano médio/nação', 'متوسط الضرر/دولة'],
  'Avg Pop/Nation': ['Pop. media/nazione', 'Pob. media/nación', 'Ø Bev./Nation', 'Pop. moy./nation', 'Gem. bev./land', 'Snittbef./nation', 'Pop. média/nação', 'متوسط السكان/دولة'],
  'Avg Dmg / Citizen': ['Danni medi per cittadino', 'Daño medio por ciudadano', 'Ø Schaden pro Bürger', 'Dégâts moyens par citoyen', 'Gem. schade per burger', 'Snittskada per invånare', 'Dano médio por cidadão', 'متوسط الضرر لكل مواطن'],
  'Core Dev Share': ['Quota sviluppo core', 'Cuota de desarrollo núcleo', 'Anteil Kernentwicklung', 'Part du développement cœur', 'Aandeel kernontwikkeling', 'Andel kärnutveckling', 'Parcela do desenvolvimento núcleo', 'حصة التنمية الأساسية'],
  'Wk Dmg': ['Danni sett.', 'Daño sem.', 'Wochenschaden', 'Dégâts hebdo', 'Weekschade', 'Veckoskada', 'Dano sem.', 'الضرر الأسبوعي'],
  'Total Dmg': ['Danni tot.', 'Daño tot.', 'Schaden ges.', 'Dégâts tot.', 'Schade tot.', 'Skada tot.', 'Dano tot.', 'الضرر الكلي'],
  'Tot Dmg': ['Danni tot.', 'Daño tot.', 'Schaden ges.', 'Dégâts tot.', 'Schade tot.', 'Skada tot.', 'Dano tot.', 'الضرر الكلي'],
  'Wk': ['Sett.', 'Sem.', 'Woche', 'Hebdo', 'Week', 'Vecka', 'Sem.', 'أسبوعي'],
  'Tot': ['Tot.', 'Tot.', 'Ges.', 'Tot.', 'Tot.', 'Tot.', 'Tot.', 'الكلي'],
  'Unaligned': ['Non allineate', 'No alineadas', 'Blockfrei', 'Non alignées', 'Niet-gebonden', 'Alliansfria', 'Não alinhadas', 'غير المنحازة'],
  'Nations at War': ['Nazioni in guerra', 'Naciones en guerra', 'Nationen im Krieg', 'Nations en guerre', 'Landen in oorlog', 'Nationer i krig', 'Nações em guerra', 'الدول في حالة حرب'],
  '{n} nations': ['{n} nazioni', '{n} naciones', '{n} Nationen', '{n} nations', '{n} landen', '{n} nationer', '{n} nações', '{n} دولة'],
  '{n} wars': ['{n} guerre', '{n} guerras', '{n} Kriege', '{n} guerres', '{n} oorlogen', '{n} krig', '{n} guerras', '{n} حرب'],
  'MERGED': ['FUSA', 'FUSIONADA', 'FUSIONIERT', 'FUSIONNÉE', 'SAMENGEVOEGD', 'SAMMANSLAGEN', 'FUNDIDA', 'مدمج'],
  '{pct}% of {bloc} Weekly Damage · {pctAbs}% Total Damage': ['{pct}% dei danni settimanali di {bloc} · {pctAbs}% dei danni totali', '{pct}% del daño semanal de {bloc} · {pctAbs}% del daño total', '{pct}% des Wochenschadens von {bloc} · {pctAbs}% des Gesamtschadens', '{pct}% des dégâts hebdo de {bloc} · {pctAbs}% des dégâts totaux', '{pct}% van de weekschade van {bloc} · {pctAbs}% van de totale schade', '{pct}% av {bloc}s veckoskada · {pctAbs}% av total skada', '{pct}% do dano semanal de {bloc} · {pctAbs}% do dano total', '{pct}% من الضرر الأسبوعي لـ {bloc} · {pctAbs}% من الضرر الإجمالي'],

  // ── Mobilitazione
  'War %': ['% guerra', '% guerra', '% Krieg', '% guerre', '% oorlog', '% krig', '% guerra', '% حرب'],
  'Share of players with a war build': ['Quota di giocatori con build da guerra', 'Porcentaje de jugadores con build de guerra', 'Anteil der Spieler mit Kriegs-Build', 'Part des joueurs avec un build de guerre', 'Aandeel spelers met een oorlogsbuild', 'Andel spelare med krigsbuild', 'Parcela de jogadores com build de guerra', 'نسبة اللاعبين ذوي بناء حربي'],
  'Mobilization': ['Mobilitazione', 'Movilización', 'Mobilisierung', 'Mobilisation', 'Mobilisatie', 'Mobilisering', 'Mobilização', 'التعبئة'],
  'builds of {n} players': ['build di {n} giocatori', 'builds de {n} jugadores', 'Builds von {n} Spielern', 'builds de {n} joueurs', 'builds van {n} spelers', 'builds för {n} spelare', 'builds de {n} jogadores', 'بناءات {n} لاعب'],
  'war': ['guerra', 'guerra', 'Krieg', 'guerre', 'oorlog', 'krig', 'guerra', 'حرب'],
  'economy': ['economia', 'economía', 'Wirtschaft', 'économie', 'economie', 'ekonomi', 'economia', 'اقتصاد'],
  'hybrid': ['ibridi', 'híbridos', 'Hybrid', 'hybrides', 'hybride', 'hybrid', 'híbridos', 'مختلط'],
  'no points spent': ['senza punti spesi', 'sin puntos gastados', 'keine Punkte vergeben', 'aucun point dépensé', 'geen punten besteed', 'inga poäng spenderade', 'sem pontos gastos', 'بلا نقاط مصروفة'],
  'War': ['Guerra', 'Guerra', 'Krieg', 'Guerre', 'Oorlog', 'Krig', 'Guerra', 'حرب'],
  'Eco': ['Eco', 'Eco', 'Wirt.', 'Éco', 'Eco', 'Eko', 'Eco', 'اقتصاد'],
  'Hyb': ['Ibr.', 'Híb.', 'Hyb.', 'Hyb.', 'Hyb.', 'Hyb.', 'Híb.', 'مختلط'],
  'Build': ['Build', 'Build', 'Build', 'Build', 'Build', 'Build', 'Build', 'البناء'],
  'War / Eco / Hyb: citizens counted by where they spent their skill points.': ['Guerra / Eco / Ibr.: cittadini contati in base a dove hanno speso i punti abilità.', 'Guerra / Eco / Híb.: ciudadanos contados según dónde gastaron sus puntos de habilidad.', 'Krieg / Wirt. / Hyb.: Bürger danach gezählt, wo sie ihre Fertigkeitspunkte ausgegeben haben.', 'Guerre / Éco / Hyb. : citoyens comptés selon l’endroit où ils ont dépensé leurs points de compétence.', 'Oorlog / Eco / Hyb.: burgers geteld naar waar ze hun vaardigheidspunten hebben besteed.', 'Krig / Eko / Hyb.: invånare räknade efter var de lagt sina färdighetspoäng.', 'Guerra / Eco / Híb.: cidadãos contados pelo local onde gastaram os pontos de habilidade.', 'حرب / اقتصاد / مختلط: المواطنون محسوبون حسب مكان صرف نقاط مهاراتهم.'],
  'War / Eco / Hyb: loading from the cache server…': ['Guerra / Eco / Ibr.: caricamento dal server di cache…', 'Guerra / Eco / Híb.: cargando desde el servidor de caché…', 'Krieg / Wirt. / Hyb.: wird vom Cache-Server geladen…', 'Guerre / Éco / Hyb. : chargement depuis le serveur de cache…', 'Oorlog / Eco / Hyb.: laden van de cacheserver…', 'Krig / Eko / Hyb.: laddar från cacheservern…', 'Guerra / Eco / Híb.: carregando do servidor de cache…', 'حرب / اقتصاد / مختلط: جارٍ التحميل من خادم التخزين المؤقت…'],

  // ── Ciambelle
  'Other ({n})': ['Altre ({n})', 'Otras ({n})', 'Andere ({n})', 'Autres ({n})', 'Overige ({n})', 'Övriga ({n})', 'Outras ({n})', 'أخرى ({n})'],
  'Share by alliance': ['Quota per alleanza', 'Cuota por alianza', 'Anteil je Allianz', 'Part par alliance', 'Aandeel per alliantie', 'Andel per allians', 'Parcela por aliança', 'الحصة حسب التحالف'],
  '{pct}% of the week': ['{pct}% della settimana', '{pct}% de la semana', '{pct}% der Woche', '{pct}% de la semaine', '{pct}% van de week', '{pct}% av veckan', '{pct}% da semana', '{pct}% من الأسبوع'],

  // ── Builder
  'Bring this alliance back into the builder': ['Rimetti questa alleanza nel costruttore', 'Devolver esta alianza al constructor', 'Diese Allianz zurück in den Baukasten holen', 'Remettre cette alliance dans le constructeur', 'Deze alliantie terugzetten in de bouwer', 'Ta tillbaka alliansen till byggaren', 'Devolver esta aliança ao construtor', 'إعادة هذا التحالف إلى المنشئ'],
  'Drag & drop to reorganize alliances': ['Trascina per riorganizzare le alleanze', 'Arrastra y suelta para reorganizar las alianzas', 'Per Drag & Drop Allianzen neu ordnen', 'Glisser-déposer pour réorganiser les alliances', 'Sleep om allianties te herschikken', 'Dra och släpp för att ordna om allianser', 'Arraste e solte para reorganizar as alianças', 'اسحب وأفلت لإعادة تنظيم التحالفات'],
  'builderTip': [
    'Trascina una nazione da un’alleanza all’altra, porta una nazione {u} in qualunque alleanza, oppure trascina il nome di un’alleanza su un’altra per fonderle. La ✕ su una nazione la toglie dalla sua alleanza. Schede e tabella accettano gli stessi trascinamenti. Scegli l’ordine nella barra — per nome non si muovono mai — e premi 📌 per tenere un’alleanza in cima qualunque cosa facciano i suoi numeri.',
    'Arrastra una nación de una alianza a otra, suelta una nación {u} en cualquier alianza, o arrastra el nombre de una alianza sobre otra para fusionarlas. La ✕ de una nación la saca de su alianza. Tarjetas y tabla aceptan los mismos arrastres. Elige el orden en la barra — por nombre no se mueven nunca — y pulsa 📌 para mantener una alianza arriba pase lo que pase con sus números.',
    'Ziehe eine Nation von einer Allianz in eine andere, lege eine {u} Nation in eine beliebige Allianz, oder ziehe den Namen einer Allianz auf eine andere, um sie zu fusionieren. Das ✕ an einer Nation nimmt sie aus ihrer Allianz. Karten und Tabelle akzeptieren dieselben Züge. Wähle die Sortierung in der Leiste — nach Name bewegt sich nichts — und drücke 📌, um eine Allianz oben zu halten, egal was ihre Zahlen tun.',
    'Glisse une nation d’une alliance à l’autre, dépose une nation {u} dans n’importe quelle alliance, ou glisse le nom d’une alliance sur une autre pour les fusionner. Le ✕ sur une nation la retire de son alliance. Cartes et tableau acceptent les mêmes glissements. Choisis le tri dans la barre — par nom rien ne bouge — et appuie sur 📌 pour garder une alliance en haut quoi que fassent ses chiffres.',
    'Sleep een land van de ene alliantie naar de andere, zet een {u} land in een willekeurige alliantie, of sleep de naam van een alliantie op een andere om ze samen te voegen. Het ✕ op een land haalt het uit zijn alliantie. Kaarten en tabel accepteren dezelfde sleepacties. Kies de sortering in de balk — op naam beweegt niets — en druk op 📌 om een alliantie bovenaan te houden, wat haar cijfers ook doen.',
    'Dra en nation från en allians till en annan, släpp en {u} nation i valfri allians, eller dra en allians namn till en annan för att slå ihop dem. ✕ på en nation tar bort den ur alliansen. Kort och tabell tar emot samma drag. Välj sortering i verktygsraden — efter namn flyttas inget — och tryck 📌 för att hålla en allians överst oavsett vad siffrorna gör.',
    'Arraste uma nação de uma aliança para outra, solte uma nação {u} em qualquer aliança, ou arraste o nome de uma aliança sobre outra para fundi-las. O ✕ numa nação tira-a da sua aliança. Cartões e tabela aceitam os mesmos arrastos. Escolha a ordem na barra — por nome nada se move — e prima 📌 para manter uma aliança no topo, aconteça o que acontecer aos números.',
    'اسحب دولة من تحالف إلى آخر، أو أفلت دولة {u} في أي تحالف، أو اسحب اسم تحالف فوق آخر لدمجهما. علامة ✕ على الدولة تُخرجها من تحالفها. البطاقات والجدول يقبلان السحب نفسه. اختر الترتيب من الشريط — بالاسم لا يتحرك شيء — واضغط 📌 لإبقاء تحالف في الأعلى مهما تغيّرت أرقامه.',
  ],
  '＋ New alliance': ['＋ Nuova alleanza', '＋ Nueva alianza', '＋ Neue Allianz', '＋ Nouvelle alliance', '＋ Nieuwe alliantie', '＋ Ny allians', '＋ Nova aliança', '＋ تحالف جديد'],
  'Paint these alliances on the map and go look at them': ['Dipingi queste alleanze sulla mappa e vai a vederle', 'Pinta estas alianzas en el mapa y ve a verlas', 'Diese Allianzen auf die Karte malen und ansehen', 'Peindre ces alliances sur la carte et aller les voir', 'Kleur deze allianties op de kaart en bekijk ze', 'Måla dessa allianser på kartan och titta på dem', 'Pintar estas alianças no mapa e ir vê-las', 'ارسم هذه التحالفات على الخريطة واذهب لرؤيتها'],
  '🗺️ Update map': ['🗺️ Aggiorna mappa', '🗺️ Actualizar mapa', '🗺️ Karte aktualisieren', '🗺️ Mettre à jour la carte', '🗺️ Kaart bijwerken', '🗺️ Uppdatera kartan', '🗺️ Atualizar mapa', '🗺️ تحديث الخريطة'],
  '🗺️ Show on map': ['🗺️ Mostra sulla mappa', '🗺️ Mostrar en el mapa', '🗺️ Auf der Karte zeigen', '🗺️ Voir sur la carte', '🗺️ Toon op kaart', '🗺️ Visa på kartan', '🗺️ Mostrar no mapa', '🗺️ عرض على الخريطة'],
  '▦ Cards': ['▦ Schede', '▦ Tarjetas', '▦ Karten', '▦ Cartes', '▦ Kaarten', '▦ Kort', '▦ Cartões', '▦ بطاقات'],
  '☰ Table': ['☰ Tabella', '☰ Tabla', '☰ Tabelle', '☰ Tableau', '☰ Tabel', '☰ Tabell', '☰ Tabela', '☰ جدول'],
  'Sort by': ['Ordina per', 'Ordenar por', 'Sortieren nach', 'Trier par', 'Sorteer op', 'Sortera efter', 'Ordenar por', 'الترتيب حسب'],
  'Same order for cards and table': ['Stesso ordine per schede e tabella', 'Mismo orden para tarjetas y tabla', 'Gleiche Reihenfolge für Karten und Tabelle', 'Même ordre pour cartes et tableau', 'Zelfde volgorde voor kaarten en tabel', 'Samma ordning för kort och tabell', 'Mesma ordem para cartões e tabela', 'الترتيب نفسه للبطاقات والجدول'],
  'Reverse the order': ['Inverti l’ordine', 'Invertir el orden', 'Reihenfolge umkehren', 'Inverser l’ordre', 'Volgorde omkeren', 'Vänd ordningen', 'Inverter a ordem', 'عكس الترتيب'],
  'Create an empty alliance, drag nations into it, and read its damage bonus straight from the card.': ['Crea un’alleanza vuota, trascinaci dentro delle nazioni e leggi il suo bonus danno direttamente sulla scheda.', 'Crea una alianza vacía, arrastra naciones dentro y lee su bonus de daño directamente en la tarjeta.', 'Erstelle eine leere Allianz, ziehe Nationen hinein und lies ihren Schadensbonus direkt auf der Karte ab.', 'Crée une alliance vide, glisses-y des nations et lis son bonus de dégâts directement sur la carte.', 'Maak een lege alliantie, sleep er landen in en lees de schadebonus direct op de kaart.', 'Skapa en tom allians, dra in nationer och läs skadebonusen direkt på kortet.', 'Crie uma aliança vazia, arraste nações para dentro e leia o bônus de dano direto no cartão.', 'أنشئ تحالفًا فارغًا، واسحب إليه دولًا، واقرأ مكافأة الضرر مباشرة من البطاقة.'],
  'Deleted:': ['Cancellate:', 'Eliminadas:', 'Gelöscht:', 'Supprimées :', 'Verwijderd:', 'Borttagna:', 'Excluídas:', 'المحذوفة:'],
  'Nations — drag them between rows': ['Nazioni — trascinale fra le righe', 'Naciones — arrástralas entre filas', 'Nationen — zwischen Zeilen ziehen', 'Nations — glisse-les entre les lignes', 'Landen — sleep ze tussen rijen', 'Nationer — dra dem mellan raderna', 'Nações — arraste-as entre linhas', 'الدول — اسحبها بين الصفوف'],
  'No members — drop a nation here': ['Nessun membro — trascina qui una nazione', 'Sin miembros — suelta aquí una nación', 'Keine Mitglieder — Nation hier ablegen', 'Aucun membre — dépose une nation ici', 'Geen leden — zet hier een land neer', 'Inga medlemmar — släpp en nation här', 'Sem membros — solte uma nação aqui', 'لا أعضاء — أفلت دولة هنا'],
  'No members': ['Nessun membro', 'Sin miembros', 'Keine Mitglieder', 'Aucun membre', 'Geen leden', 'Inga medlemmar', 'Sem membros', 'لا أعضاء'],
  'Click for alliance stats': ['Clic per le statistiche dell’alleanza', 'Clic para ver las estadísticas', 'Klick für Allianz-Statistiken', 'Clique pour les stats de l’alliance', 'Klik voor alliantiestatistieken', 'Klicka för alliansstatistik', 'Clique para as estatísticas', 'انقر لإحصاءات التحالف'],
  'Click for bloc stats': ['Clic per le statistiche dell’alleanza', 'Clic para ver las estadísticas', 'Klick für Allianz-Statistiken', 'Clique pour les stats de l’alliance', 'Klik voor alliantiestatistieken', 'Klicka för alliansstatistik', 'Clique para as estatísticas', 'انقر لإحصاءات التحالف'],
  ', drag onto another alliance to merge': [', trascinala su un’altra per fonderle', ', arrástrala sobre otra para fusionar', ', auf eine andere ziehen zum Fusionieren', ', glisse-la sur une autre pour fusionner', ', sleep op een andere om samen te voegen', ', dra till en annan för att slå ihop', ', arraste sobre outra para fundir', '، اسحبه فوق تحالف آخر للدمج'],
  'Click for stats': ['Clic per le statistiche', 'Clic para estadísticas', 'Klick für Statistiken', 'Clique pour les stats', 'Klik voor statistieken', 'Klicka för statistik', 'Clique para estatísticas', 'انقر للإحصاءات'],
  '{c} / {w} of world core development': ['{c} / {w} dello sviluppo core mondiale', '{c} / {w} del desarrollo núcleo mundial', '{c} / {w} der weltweiten Kernentwicklung', '{c} / {w} du développement cœur mondial', '{c} / {w} van de wereldwijde kernontwikkeling', '{c} / {w} av världens kärnutveckling', '{c} / {w} do desenvolvimento núcleo mundial', '{c} / {w} من التنمية الأساسية العالمية'],
  '{s}% of world core development. ': ['{s}% dello sviluppo core mondiale. ', '{s}% del desarrollo núcleo mundial. ', '{s}% der weltweiten Kernentwicklung. ', '{s}% du développement cœur mondial. ', '{s}% van de wereldwijde kernontwikkeling. ', '{s}% av världens kärnutveckling. ', '{s}% do desenvolvimento núcleo mundial. ', '{s}% من التنمية الأساسية العالمية. '],
  'Split this merge': ['Separa questa fusione', 'Separar esta fusión', 'Diese Fusion aufteilen', 'Séparer cette fusion', 'Deze samenvoeging splitsen', 'Dela sammanslagningen', 'Separar esta fusão', 'فصل هذا الدمج'],
  '✂ Split': ['✂ Separa', '✂ Separar', '✂ Aufteilen', '✂ Séparer', '✂ Splitsen', '✂ Dela', '✂ Separar', '✂ فصل'],
  'Add nations, or merge with another alliance': ['Aggiungi nazioni, o fondi con un’altra alleanza', 'Añadir naciones o fusionar con otra alianza', 'Nationen hinzufügen oder mit einer anderen Allianz fusionieren', 'Ajouter des nations ou fusionner avec une autre alliance', 'Landen toevoegen of samenvoegen met een andere alliantie', 'Lägg till nationer eller slå ihop med en annan allians', 'Adicionar nações ou fundir com outra aliança', 'أضف دولًا أو ادمج مع تحالف آخر'],
  'Add a nation, or merge with another alliance': ['Aggiungi una nazione, o fondi con un’altra alleanza', 'Añadir una nación o fusionar con otra alianza', 'Nation hinzufügen oder mit einer anderen Allianz fusionieren', 'Ajouter une nation ou fusionner avec une autre alliance', 'Een land toevoegen of samenvoegen met een andere alliantie', 'Lägg till en nation eller slå ihop med en annan allians', 'Adicionar uma nação ou fundir com outra aliança', 'أضف دولة أو ادمج مع تحالف آخر'],
  'Delete this alliance from the builder': ['Cancella questa alleanza dal costruttore', 'Eliminar esta alianza del constructor', 'Diese Allianz aus dem Baukasten löschen', 'Supprimer cette alliance du constructeur', 'Deze alliantie uit de bouwer verwijderen', 'Ta bort alliansen från byggaren', 'Excluir esta aliança do construtor', 'احذف هذا التحالف من المنشئ'],
  'Unpin: this alliance goes back to following the sort order': ['Sblocca: l’alleanza torna a seguire l’ordinamento', 'Desfijar: la alianza vuelve a seguir el orden', 'Lösen: die Allianz folgt wieder der Sortierung', 'Détacher : l’alliance suit de nouveau le tri', 'Losmaken: de alliantie volgt weer de sortering', 'Lossa: alliansen följer sorteringen igen', 'Desafixar: a aliança volta a seguir a ordem', 'إلغاء التثبيت: يعود التحالف لاتباع الترتيب'],
  'Pin to the top: it stays there while you drag nations around and the numbers change': ['Fissa in cima: resta lì mentre sposti nazioni e i numeri cambiano', 'Fijar arriba: se queda ahí mientras mueves naciones y cambian los números', 'Oben anheften: bleibt dort, während du Nationen verschiebst und sich Zahlen ändern', 'Épingler en haut : elle y reste pendant que tu déplaces des nations et que les chiffres changent', 'Bovenaan vastzetten: blijft staan terwijl je landen versleept en cijfers veranderen', 'Fäst överst: stannar där medan du flyttar nationer och siffrorna ändras', 'Fixar no topo: fica lá enquanto move nações e os números mudam', 'تثبيت في الأعلى: يبقى هناك أثناء سحب الدول وتغيّر الأرقام'],
  'core dev {c} / {w} of the world': ['sviluppo core {c} / {w} del mondo', 'desarrollo núcleo {c} / {w} del mundo', 'Kernentwicklung {c} / {w} der Welt', 'développement cœur {c} / {w} du monde', 'kernontwikkeling {c} / {w} van de wereld', 'kärnutveckling {c} / {w} av världen', 'desenvolvimento núcleo {c} / {w} do mundo', 'التنمية الأساسية {c} / {w} من العالم'],
  'Remove {name} from this alliance': ['Togli {name} da questa alleanza', 'Quitar {name} de esta alianza', '{name} aus dieser Allianz entfernen', 'Retirer {name} de cette alliance', '{name} uit deze alliantie halen', 'Ta bort {name} från alliansen', 'Tirar {name} desta aliança', 'إزالة {name} من هذا التحالف'],
  'Alliance damage bonus (see the alliance screen in game).': ['Bonus danno d’alleanza (vedi la schermata alleanza nel gioco).', 'Bonus de daño de alianza (ver la pantalla de alianza en el juego).', 'Allianz-Schadensbonus (siehe Allianzbildschirm im Spiel).', 'Bonus de dégâts d’alliance (voir l’écran d’alliance en jeu).', 'Schadebonus van de alliantie (zie het alliantiescherm in het spel).', 'Alliansens skadebonus (se alliansskärmen i spelet).', 'Bônus de dano da aliança (ver a tela de aliança no jogo).', 'مكافأة ضرر التحالف (انظر شاشة التحالف في اللعبة).'],
  'Share of world core development: {c} / {w}': ['Quota dello sviluppo core mondiale: {c} / {w}', 'Cuota del desarrollo núcleo mundial: {c} / {w}', 'Anteil an der weltweiten Kernentwicklung: {c} / {w}', 'Part du développement cœur mondial : {c} / {w}', 'Aandeel in de wereldwijde kernontwikkeling: {c} / {w}', 'Andel av världens kärnutveckling: {c} / {w}', 'Parcela do desenvolvimento núcleo mundial: {c} / {w}', 'حصة التنمية الأساسية العالمية: {c} / {w}'],
  '{s}% core': ['{s}% core', '{s}% núcleo', '{s}% Kern', '{s}% cœur', '{s}% kern', '{s}% kärna', '{s}% núcleo', '{s}% النواة'],
  'Drag nations onto an alliance bloc to assign them': ['Trascina le nazioni su un’alleanza per assegnarle', 'Arrastra naciones a una alianza para asignarlas', 'Ziehe Nationen auf eine Allianz, um sie zuzuordnen', 'Glisse des nations sur une alliance pour les affecter', 'Sleep landen naar een alliantie om ze toe te wijzen', 'Dra nationer till en allians för att tilldela dem', 'Arraste nações para uma aliança para atribuí-las', 'اسحب الدول إلى تحالف لتعيينها'],

  // ── Finestre di dialogo
  'New Alliance {n}': ['Nuova alleanza {n}', 'Nueva alianza {n}', 'Neue Allianz {n}', 'Nouvelle alliance {n}', 'Nieuwe alliantie {n}', 'Ny allians {n}', 'Nova aliança {n}', 'تحالف جديد {n}'],
  'Name of the new alliance:': ['Nome della nuova alleanza:', 'Nombre de la nueva alianza:', 'Name der neuen Allianz:', 'Nom de la nouvelle alliance :', 'Naam van de nieuwe alliantie:', 'Namn på den nya alliansen:', 'Nome da nova aliança:', 'اسم التحالف الجديد:'],
  '"{name}" already exists. Pick another name.': ['"{name}" esiste già. Scegli un altro nome.', '"{name}" ya existe. Elige otro nombre.', '"{name}" existiert bereits. Wähle einen anderen Namen.', '« {name} » existe déjà. Choisis un autre nom.', '"{name}" bestaat al. Kies een andere naam.', '"{name}" finns redan. Välj ett annat namn.', '"{name}" já existe. Escolha outro nome.', '"{name}" موجود بالفعل. اختر اسمًا آخر.'],
  'deleteConfirm': [
    'Cancellare "{name}" dal costruttore?\n\nLe sue {n} nazioni tornano fra le non allineate. Puoi rimetterla dall’elenco "Cancellate" nella barra.',
    '¿Eliminar "{name}" del constructor?\n\nSus {n} naciones vuelven a no alineadas. Puedes recuperarla desde la lista "Eliminadas" de la barra.',
    '"{name}" aus dem Baukasten löschen?\n\nIhre {n} Nationen werden wieder blockfrei. Über die Liste "Gelöscht" in der Leiste holst du sie zurück.',
    'Supprimer « {name} » du constructeur ?\n\nSes {n} nations redeviennent non alignées. Tu peux la rétablir depuis la liste « Supprimées » de la barre.',
    '"{name}" uit de bouwer verwijderen?\n\nDe {n} landen worden weer niet-gebonden. Je kunt haar terugzetten via de lijst "Verwijderd" in de balk.',
    'Ta bort "{name}" från byggaren?\n\nDess {n} nationer blir alliansfria igen. Du kan ta tillbaka den från listan "Borttagna" i verktygsraden.',
    'Excluir "{name}" do construtor?\n\nAs suas {n} nações voltam a não alinhadas. Pode recuperá-la pela lista "Excluídas" na barra.',
    'حذف "{name}" من المنشئ؟\n\nستعود دوله الـ {n} إلى غير المنحازة. يمكنك استعادته من قائمة "المحذوفة" في الشريط.',
  ],

  // ── 1 vs 2
  '⟳ Reset selection': ['⟳ Azzera selezione', '⟳ Borrar selección', '⟳ Auswahl zurücksetzen', '⟳ Réinitialiser la sélection', '⟳ Selectie wissen', '⟳ Återställ urval', '⟳ Limpar seleção', '⟳ إعادة ضبط الاختيار'],
  'Select blocs': ['Scegli le alleanze', 'Elige alianzas', 'Allianzen wählen', 'Choisis des alliances', 'Kies allianties', 'Välj allianser', 'Escolha alianças', 'اختر التحالفات'],
  'Faction {n}': ['Fazione {n}', 'Facción {n}', 'Fraktion {n}', 'Faction {n}', 'Factie {n}', 'Fraktion {n}', 'Facção {n}', 'الفصيل {n}'],
  '+ Random': ['+ A caso', '+ Al azar', '+ Zufällig', '+ Au hasard', '+ Willekeurig', '+ Slumpa', '+ Aleatório', '+ عشوائي'],
  'Builds · mobilization': ['Build · mobilitazione', 'Builds · movilización', 'Builds · Mobilisierung', 'Builds · mobilisation', 'Builds · mobilisatie', 'Builds · mobilisering', 'Builds · mobilização', 'البناءات · التعبئة'],
  'from the skill points of each player': ['dai punti abilità di ogni giocatore', 'según los puntos de habilidad de cada jugador', 'aus den Fertigkeitspunkten jedes Spielers', 'd’après les points de compétence de chaque joueur', 'uit de vaardigheidspunten van elke speler', 'utifrån varje spelares färdighetspoäng', 'pelos pontos de habilidade de cada jogador', 'من نقاط مهارة كل لاعب'],
  'War players %': ['% giocatori di guerra', '% jugadores de guerra', '% Kriegsspieler', '% joueurs de guerre', '% oorlogsspelers', '% krigsspelare', '% jogadores de guerra', '% لاعبي الحرب'],
  'Eco players %': ['% giocatori di economia', '% jugadores de economía', '% Wirtschaftsspieler', '% joueurs d’économie', '% economiespelers', '% ekonomispelare', '% jogadores de economia', '% لاعبي الاقتصاد'],
  'War players': ['Giocatori di guerra', 'Jugadores de guerra', 'Kriegsspieler', 'Joueurs de guerre', 'Oorlogsspelers', 'Krigsspelare', 'Jogadores de guerra', 'لاعبو الحرب'],
  'Eco players': ['Giocatori di economia', 'Jugadores de economía', 'Wirtschaftsspieler', 'Joueurs d’économie', 'Economiespelers', 'Ekonomispelare', 'Jogadores de economia', 'لاعبو الاقتصاد'],
  'Hybrid players': ['Giocatori ibridi', 'Jugadores híbridos', 'Hybridspieler', 'Joueurs hybrides', 'Hybride spelers', 'Hybridspelare', 'Jogadores híbridos', 'لاعبون مختلطون'],
  'Loading builds…': ['Caricamento delle build…', 'Cargando builds…', 'Builds werden geladen…', 'Chargement des builds…', 'Builds laden…', 'Laddar builds…', 'Carregando builds…', 'جارٍ تحميل البناءات…'],
  'Per citizen': ['Per cittadino', 'Por ciudadano', 'Pro Bürger', 'Par citoyen', 'Per burger', 'Per invånare', 'Por cidadão', 'لكل مواطن'],
  'Territory & bounty': ['Territorio e taglie', 'Territorio y recompensas', 'Gebiet & Kopfgelder', 'Territoire & primes', 'Grondgebied & premies', 'Territorium & prispengar', 'Território e recompensas', 'الأراضي والمكافآت'],
  'Size & strength': ['Dimensioni e forza', 'Tamaño y fuerza', 'Größe & Stärke', 'Taille & force', 'Omvang & kracht', 'Storlek & styrka', 'Tamanho e força', 'الحجم والقوة'],
  'ahead': ['in vantaggio', 'por delante', 'vorn', 'en tête', 'voor', 'leder', 'à frente', 'متقدم'],
  'ahead in {n} of {t}': ['in vantaggio in {n} su {t}', 'por delante en {n} de {t}', 'vorn in {n} von {t}', 'en tête sur {n} de {t}', 'voor in {n} van {t}', 'leder i {n} av {t}', 'à frente em {n} de {t}', 'متقدم في {n} من {t}'],
  'even': ['pari', 'empate', 'gleichauf', 'égalité', 'gelijk', 'jämnt', 'empate', 'تعادل'],
  'Pick at least one alliance on each side to compare them.': ['Scegli almeno un’alleanza per parte per confrontarle.', 'Elige al menos una alianza por lado para compararlas.', 'Wähle auf jeder Seite mindestens eine Allianz, um zu vergleichen.', 'Choisis au moins une alliance de chaque côté pour les comparer.', 'Kies aan elke kant minstens één alliantie om te vergelijken.', 'Välj minst en allians på varje sida för att jämföra.', 'Escolha pelo menos uma aliança de cada lado para comparar.', 'اختر تحالفًا واحدًا على الأقل في كل جهة للمقارنة.'],
  'Counted on {t} measures where more is better; wars, sworn enemies and build shares are shown but not scored.': [
    'Contato su {t} misure dove di più è meglio; guerre, nemici giurati e quote di build si vedono ma non contano.',
    'Contado sobre {t} medidas donde más es mejor; guerras, enemigos jurados y porcentajes de build se muestran pero no puntúan.',
    'Gezählt über {t} Werte, bei denen mehr besser ist; Kriege, Erzfeinde und Build-Anteile werden gezeigt, aber nicht gewertet.',
    'Compté sur {t} mesures où plus vaut mieux ; guerres, ennemis jurés et parts de build sont affichés mais pas comptés.',
    'Geteld op {t} waarden waar meer beter is; oorlogen, gezworen vijanden en buildaandelen worden getoond maar niet meegeteld.',
    'Räknat på {t} mått där mer är bättre; krig, svurna fiender och buildandelar visas men räknas inte.',
    'Contado em {t} medidas onde mais é melhor; guerras, inimigos jurados e parcelas de build aparecem mas não contam.',
    'محسوب على {t} مقياسًا حيث الأكثر أفضل؛ الحروب والأعداء اللدودون ونسب البناء معروضة لكنها لا تُحتسب.',
  ],

  // ── Guerre e nemici
  '🏆 Alliance Ranking — {m}': ['🏆 Classifica alleanze — {m}', '🏆 Clasificación de alianzas — {m}', '🏆 Allianz-Rangliste — {m}', '🏆 Classement des alliances — {m}', '🏆 Alliantieranglijst — {m}', '🏆 Alliansranking — {m}', '🏆 Ranking de alianças — {m}', '🏆 ترتيب التحالفات — {m}'],
  'Top 10 {m}': ['Top 10 {m}', 'Top 10 {m}', 'Top 10 {m}', 'Top 10 {m}', 'Top 10 {m}', 'Topp 10 {m}', 'Top 10 {m}', 'أفضل 10 {m}'],
  'Dmg / Citizen': ['Danni per cittadino', 'Daño por ciudadano', 'Schaden pro Bürger', 'Dégâts par citoyen', 'Schade per burger', 'Skada per invånare', 'Dano por cidadão', 'الضرر لكل مواطن'],
  'Bounty': ['Taglie', 'Recompensas', 'Kopfgelder', 'Primes', 'Premies', 'Prispengar', 'Recompensas', 'المكافآت'],

  // ── Menu "aggiungi"
  'Add to "{name}"': ['Aggiungi a "{name}"', 'Añadir a "{name}"', 'Zu "{name}" hinzufügen', 'Ajouter à « {name} »', 'Toevoegen aan "{name}"', 'Lägg till i "{name}"', 'Adicionar a "{name}"', 'أضف إلى "{name}"'],
  'Nations ({n})': ['Nazioni ({n})', 'Naciones ({n})', 'Nationen ({n})', 'Nations ({n})', 'Landen ({n})', 'Nationer ({n})', 'Nações ({n})', 'الدول ({n})'],
  'Merge alliance ({n})': ['Fondi alleanza ({n})', 'Fusionar alianza ({n})', 'Allianz fusionieren ({n})', 'Fusionner une alliance ({n})', 'Alliantie samenvoegen ({n})', 'Slå ihop allians ({n})', 'Fundir aliança ({n})', 'دمج تحالف ({n})'],
  'Filter nations…': ['Filtra nazioni…', 'Filtrar naciones…', 'Nationen filtern…', 'Filtrer les nations…', 'Landen filteren…', 'Filtrera nationer…', 'Filtrar nações…', 'تصفية الدول…'],
  'Every nation is already here.': ['Tutte le nazioni sono già qui.', 'Todas las naciones ya están aquí.', 'Alle Nationen sind schon hier.', 'Toutes les nations sont déjà ici.', 'Alle landen zijn al hier.', 'Alla nationer finns redan här.', 'Todas as nações já estão aqui.', 'كل الدول موجودة هنا بالفعل.'],
  'None selected': ['Nessuna selezionata', 'Ninguna seleccionada', 'Keine ausgewählt', 'Aucune sélection', 'Niets geselecteerd', 'Inga valda', 'Nenhuma selecionada', 'لم يُحدد شيء'],
  '{n} selected': ['{n} selezionate', '{n} seleccionadas', '{n} ausgewählt', '{n} sélectionnées', '{n} geselecteerd', '{n} valda', '{n} selecionadas', 'تم تحديد {n}'],
  'Select shown': ['Seleziona le visibili', 'Seleccionar visibles', 'Angezeigte wählen', 'Sélectionner l’affichage', 'Zichtbare selecteren', 'Välj visade', 'Selecionar visíveis', 'تحديد المعروض'],
  'Clear': ['Svuota', 'Limpiar', 'Leeren', 'Vider', 'Wissen', 'Rensa', 'Limpar', 'مسح'],
  'Add selected': ['Aggiungi selezionate', 'Añadir seleccionadas', 'Ausgewählte hinzufügen', 'Ajouter la sélection', 'Selectie toevoegen', 'Lägg till valda', 'Adicionar selecionadas', 'إضافة المحدد'],
  'Add {n} nations': ['Aggiungi {n} nazioni', 'Añadir {n} naciones', '{n} Nationen hinzufügen', 'Ajouter {n} nations', '{n} landen toevoegen', 'Lägg till {n} nationer', 'Adicionar {n} nações', 'إضافة {n} دولة'],
  'No other alliance to merge with.': ['Nessun’altra alleanza con cui fondersi.', 'No hay otra alianza con la que fusionar.', 'Keine andere Allianz zum Fusionieren.', 'Aucune autre alliance avec laquelle fusionner.', 'Geen andere alliantie om mee samen te voegen.', 'Ingen annan allians att slå ihop med.', 'Nenhuma outra aliança para fundir.', 'لا يوجد تحالف آخر للدمج معه.'],
  'No nations found': ['Nessuna nazione trovata', 'No se encontraron naciones', 'Keine Nationen gefunden', 'Aucune nation trouvée', 'Geen landen gevonden', 'Inga nationer hittades', 'Nenhuma nação encontrada', 'لم يتم العثور على دول'],
};

/**
 * Traduce un testo della vista. `chiave` è il testo inglese (o, per i due
 * testi lunghi, un nome breve: builderTip, deleteConfirm). Variabili fra
 * graffe. Una lingua o una chiave mancante ricade sull'inglese.
 */
export function bT(chiave, vars) {
  const i = ORDINE.indexOf(getLang());
  let s = (i >= 0 && T[chiave]?.[i]) || EN[chiave] || chiave;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

// L'inglese dei due testi che non usano sé stessi come chiave.
const EN = {
  builderTip: 'Drag a nation from one alliance to another, drop an {u} nation into any alliance, or drag an alliance\'s name onto another to merge them. The ✕ on a nation takes it out of its alliance. Cards and table accept the same drags. Choose how to sort them in the toolbar — by name they never move at all — and hit 📌 to keep an alliance on top whatever its numbers do.',
  deleteConfirm: 'Delete "{name}" from the builder?\n\nIts {n} nations go back to Unaligned. You can bring it back from the "Deleted" list in the toolbar.',
};
