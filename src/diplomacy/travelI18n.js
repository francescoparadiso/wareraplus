/* ══════════════════════════════════════════════════════════════
   WarEra+ — Traduzioni della vista mappa "Distanze" (travelDistance.js)
   ------------------------------------------------------------------
   Stesso schema di blocStatsI18n.js: la CHIAVE è il testo inglese, così
   nel codice si legge cosa c'è scritto e una traduzione mancante ricade
   sull'inglese invece di mostrare una chiave. Variabili fra graffe.

   Riga = [it, es, de, fr, nl, sv, pt, ar], nell'ordine di LANGS in
   src/shared/i18n.js. Dizionario LOCALE: queste etichette le usano solo
   il riepilogo nel pannello e la barra in basso sulla mappa.
   ══════════════════════════════════════════════════════════════ */

import { getLang } from '../shared/i18n.js';

const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];

const T = {
  // ── Intestazione e spiegazione
  'Travel distance': ['Distanze di viaggio', 'Distancias de viaje', 'Reisedistanzen', 'Distances de voyage', 'Reisafstanden', 'Reseavstånd', 'Distâncias de viagem', 'مسافات السفر'],
  'Click a region on the map to measure every distance from it.': ['Clicca una regione sulla mappa per misurare tutte le distanze da lì.', 'Haz clic en una región del mapa para medir todas las distancias desde ella.', 'Klicke auf eine Region der Karte, um alle Entfernungen von dort zu messen.', 'Clique sur une région de la carte pour mesurer toutes les distances depuis elle.', 'Klik op een regio op de kaart om alle afstanden vanaf daar te meten.', 'Klicka på en region på kartan för att mäta alla avstånd därifrån.', 'Clique numa região do mapa para medir todas as distâncias a partir dela.', 'انقر على منطقة في الخريطة لقياس كل المسافات منها.'],
  'Tap a region on the map to measure every distance from it.': ['Tocca una regione sulla mappa per misurare tutte le distanze da lì.', 'Toca una región del mapa para medir todas las distancias desde ella.', 'Tippe auf eine Region der Karte, um alle Entfernungen von dort zu messen.', 'Touche une région de la carte pour mesurer toutes les distances depuis elle.', 'Tik op een regio op de kaart om alle afstanden vanaf daar te meten.', 'Tryck på en region på kartan för att mäta alla avstånd därifrån.', 'Toque numa região do mapa para medir todas as distâncias a partir dela.', 'المس منطقة في الخريطة لقياس كل المسافات منها.'],
  'From {name}': ['Da {name}', 'Desde {name}', 'Von {name}', 'Depuis {name}', 'Vanaf {name}', 'Från {name}', 'A partir de {name}', 'من {name}'],
  'Distance is the number of borders crossed on the game\'s own neighbour graph, not kilometres. Costs from patch 0.26.1: {s} stamina per region, so a full bar reaches {max} regions; past that, every region costs {oil} barrels of oil. A full bar is assumed.': [
    'La distanza è il numero di confini attraversati sul grafo dei vicini del gioco, non i chilometri. Costi dalla patch 0.26.1: {s} di stamina a regione, quindi una barra piena arriva a {max} regioni; oltre, ogni regione costa {oil} barili di petrolio. Si assume la barra piena.',
    'La distancia es el número de fronteras cruzadas en el grafo de vecinos del juego, no kilómetros. Costes desde el parche 0.26.1: {s} de stamina por región, así que una barra llena llega a {max} regiones; más allá, cada región cuesta {oil} barriles de petróleo. Se asume la barra llena.',
    'Die Entfernung ist die Zahl der überquerten Grenzen im Nachbarschaftsgraphen des Spiels, keine Kilometer. Kosten seit Patch 0.26.1: {s} Ausdauer pro Region, ein voller Balken reicht also {max} Regionen weit; danach kostet jede Region {oil} Fässer Öl. Es wird ein voller Balken angenommen.',
    'La distance est le nombre de frontières franchies sur le graphe des voisins du jeu, pas des kilomètres. Coûts depuis le patch 0.26.1 : {s} d’endurance par région, une barre pleine atteint donc {max} régions ; au-delà, chaque région coûte {oil} barils de pétrole. Barre pleine supposée.',
    'Afstand is het aantal overgestoken grenzen op de burengraaf van het spel, geen kilometers. Kosten sinds patch 0.26.1: {s} stamina per regio, een volle balk reikt dus {max} regio’s; daarna kost elke regio {oil} vaten olie. Uitgegaan wordt van een volle balk.',
    'Avståndet är antalet gränser som korsas i spelets grannskapsgraf, inte kilometer. Kostnader sedan patch 0.26.1: {s} stamina per region, så en full mätare når {max} regioner; därefter kostar varje region {oil} fat olja. En full mätare antas.',
    'A distância é o número de fronteiras atravessadas no grafo de vizinhos do jogo, não quilómetros. Custos desde o patch 0.26.1: {s} de stamina por região, por isso uma barra cheia chega a {max} regiões; depois, cada região custa {oil} barris de petróleo. Assume-se a barra cheia.',
    'المسافة هي عدد الحدود المعبورة في شبكة الجوار الخاصة باللعبة، لا الكيلومترات. التكاليف منذ التحديث 0.26.1: {s} من الطاقة لكل منطقة، فالشريط الممتلئ يصل إلى {max} مناطق؛ بعد ذلك تكلف كل منطقة {oil} براميل نفط. يُفترض أن الشريط ممتلئ.'],

  // ── Numeri in testa
  'Within a full bar': ['Con una barra piena', 'Con una barra llena', 'Mit vollem Balken', 'Avec une barre pleine', 'Met een volle balk', 'Med full mätare', 'Com uma barra cheia', 'بشريط ممتلئ'],
  'Farthest': ['La più lontana', 'La más lejana', 'Am weitesten', 'La plus lointaine', 'Verst weg', 'Längst bort', 'A mais distante', 'الأبعد'],
  'Unreachable': ['Irraggiungibili', 'Inalcanzables', 'Unerreichbar', 'Injoignables', 'Onbereikbaar', 'Onåbara', 'Inalcançáveis', 'غير قابلة للوصول'],
  'Median': ['Mediana', 'Mediana', 'Median', 'Médiane', 'Mediaan', 'Median', 'Mediana', 'الوسيط'],
  '{n} regions': ['{n} regioni', '{n} regiones', '{n} Regionen', '{n} régions', '{n} regio’s', '{n} regioner', '{n} regiões', '{n} منطقة'],
  '1 region': ['1 regione', '1 región', '1 Region', '1 région', '1 regio', '1 region', '1 região', 'منطقة واحدة'],

  // ── Istogramma
  'By distance': ['Per distanza', 'Por distancia', 'Nach Entfernung', 'Par distance', 'Per afstand', 'Efter avstånd', 'Por distância', 'حسب المسافة'],
  'Stamina': ['Stamina', 'Stamina', 'Ausdauer', 'Endurance', 'Stamina', 'Stamina', 'Stamina', 'الطاقة'],
  'Regions': ['Regioni', 'Regiones', 'Regionen', 'Régions', 'Regio’s', 'Regioner', 'Regiões', 'المناطق'],
  'Of the world': ['Del mondo', 'Del mundo', 'Der Welt', 'Du monde', 'Van de wereld', 'Av världen', 'Do mundo', 'من العالم'],
  '+ oil': ['+ petrolio', '+ petróleo', '+ Öl', '+ pétrole', '+ olie', '+ olja', '+ petróleo', '+ نفط'],
  'The number in brackets is the running total. Wooden crates: a crate that spawns in a random region is within reach with the probability in the last column.': [
    'Il numero fra parentesi è il totale progressivo. Casse di legno: una cassa che compare in una regione a caso è alla tua portata con la probabilità dell’ultima colonna.',
    'El número entre paréntesis es el total acumulado. Cajas de madera: una caja que aparece en una región al azar está a tu alcance con la probabilidad de la última columna.',
    'Die Zahl in Klammern ist die laufende Summe. Holzkisten: Eine Kiste, die in einer zufälligen Region erscheint, ist mit der Wahrscheinlichkeit der letzten Spalte in Reichweite.',
    'Le nombre entre parenthèses est le cumul. Caisses en bois : une caisse qui apparaît dans une région au hasard est à ta portée avec la probabilité de la dernière colonne.',
    'Het getal tussen haakjes is het lopende totaal. Houten kisten: een kist die in een willekeurige regio verschijnt, ligt binnen bereik met de kans in de laatste kolom.',
    'Talet inom parentes är den löpande summan. Trälådor: en låda som dyker upp i en slumpmässig region är inom räckhåll med sannolikheten i sista kolumnen.',
    'O número entre parênteses é o total acumulado. Caixas de madeira: uma caixa que aparece numa região ao acaso está ao teu alcance com a probabilidade da última coluna.',
    'الرقم بين القوسين هو المجموع التراكمي. الصناديق الخشبية: الصندوق الذي يظهر في منطقة عشوائية يكون في متناولك بالاحتمال المذكور في العمود الأخير.'],

  // ── Barra in basso sulla mappa
  '{n} regions away': ['a {n} regioni', 'a {n} regiones', '{n} Regionen entfernt', 'à {n} régions', '{n} regio’s verderop', '{n} regioner bort', 'a {n} regiões', 'على بعد {n} منطقة'],
  '1 region away': ['a 1 regione', 'a 1 región', '1 Region entfernt', 'à 1 région', '1 regio verderop', '1 region bort', 'a 1 região', 'على بعد منطقة واحدة'],
  'unreachable': ['irraggiungibile', 'inalcanzable', 'unerreichbar', 'injoignable', 'onbereikbaar', 'onåbar', 'inalcançável', 'غير قابلة للوصول'],
  '{n} barrels': ['{n} barili', '{n} barriles', '{n} Fässer', '{n} barils', '{n} vaten', '{n} fat', '{n} barris', '{n} براميل'],
  'Hover a region to see the trip · click to start from it': ['Passa sopra una regione per vedere il viaggio · clicca per partire da lì', 'Pasa sobre una región para ver el viaje · haz clic para salir de ella', 'Fahre über eine Region, um die Reise zu sehen · klicke, um dort zu starten', 'Survole une région pour voir le trajet · clique pour partir d’elle', 'Beweeg over een regio om de reis te zien · klik om daar te starten', 'Hovra över en region för att se resan · klicka för att starta där', 'Passa sobre uma região para ver a viagem · clica para partir dela', 'مرّر فوق منطقة لرؤية الرحلة · انقر للانطلاق منها'],
  'Tap another region to see the trip': ['Tocca un’altra regione per vedere il viaggio', 'Toca otra región para ver el viaje', 'Tippe auf eine andere Region, um die Reise zu sehen', 'Touche une autre région pour voir le trajet', 'Tik op een andere regio om de reis te zien', 'Tryck på en annan region för att se resan', 'Toque noutra região para ver a viagem', 'المس منطقة أخرى لرؤية الرحلة'],

  // ── Pianificatore casse
  'Wooden case route': ['Giro delle casse', 'Ruta de cajas', 'Kistenroute', 'Tournée des caisses', 'Kistenroute', 'Lådrunda', 'Rota das caixas', 'مسار الصناديق'],
  'You are': ['Sei a', 'Estás en', 'Du bist in', 'Tu es à', 'Je bent in', 'Du är i', 'Estás em', 'أنت في'],
  'Home': ['Casa', 'Casa', 'Zuhause', 'Maison', 'Thuis', 'Hem', 'Casa', 'المنزل'],
  'Cases {n}/{max}': ['Casse {n}/{max}', 'Cajas {n}/{max}', 'Kisten {n}/{max}', 'Caisses {n}/{max}', 'Kisten {n}/{max}', 'Lådor {n}/{max}', 'Caixas {n}/{max}', 'الصناديق {n}/{max}'],
  'not set': ['non impostata', 'sin fijar', 'nicht gesetzt', 'non définie', 'niet ingesteld', 'inte vald', 'não definida', 'غير محدد'],
  'Pick on map': ['Scegli sulla mappa', 'Elegir en el mapa', 'Auf der Karte wählen', 'Choisir sur la carte', 'Kies op de kaart', 'Välj på kartan', 'Escolher no mapa', 'اختر على الخريطة'],
  'Picking…': ['Scegli…', 'Eligiendo…', 'Auswahl…', 'Choix…', 'Kiezen…', 'Väljer…', 'A escolher…', 'جارٍ الاختيار…'],
  'Clear': ['Svuota', 'Vaciar', 'Leeren', 'Vider', 'Wissen', 'Rensa', 'Limpar', 'مسح'],
  'Remove': ['Togli', 'Quitar', 'Entfernen', 'Retirer', 'Verwijderen', 'Ta bort', 'Remover', 'إزالة'],
  'Click your home region on the map.': ['Clicca la tua regione di casa sulla mappa.', 'Haz clic en tu región de casa en el mapa.', 'Klicke auf der Karte auf deine Heimatregion.', 'Clique sur ta région d’origine sur la carte.', 'Klik op de kaart op je thuisregio.', 'Klicka på din hemregion på kartan.', 'Clica na tua região de casa no mapa.', 'انقر على منطقة منزلك في الخريطة.'],
  'Click the regions holding a case; click one again to drop it.': ['Clicca le regioni dove c’è una cassa; ricliccala per toglierla.', 'Haz clic en las regiones con una caja; vuelve a hacer clic para quitarla.', 'Klicke auf die Regionen mit einer Kiste; erneut klicken entfernt sie.', 'Clique sur les régions avec une caisse ; reclique pour la retirer.', 'Klik op de regio’s met een kist; klik nogmaals om hem te verwijderen.', 'Klicka på regionerna med en låda; klicka igen för att ta bort den.', 'Clica nas regiões com uma caixa; clica de novo para a retirar.', 'انقر على المناطق التي فيها صندوق؛ انقر مرة أخرى لإزالته.'],
  'Esc cancels.': ['Esc annulla.', 'Esc cancela.', 'Esc bricht ab.', 'Échap annule.', 'Esc annuleert.', 'Esc avbryter.', 'Esc cancela.', 'Esc للإلغاء.'],
  'Add the regions holding a case: the best order is worked out for you.': ['Aggiungi le regioni dove c’è una cassa: l’ordine migliore lo calcola lui.', 'Añade las regiones con una caja: el mejor orden se calcula solo.', 'Füge die Regionen mit einer Kiste hinzu: Die beste Reihenfolge wird für dich berechnet.', 'Ajoute les régions avec une caisse : le meilleur ordre est calculé pour toi.', 'Voeg de regio’s met een kist toe: de beste volgorde wordt voor je berekend.', 'Lägg till regionerna med en låda: bästa ordningen räknas ut åt dig.', 'Adiciona as regiões com uma caixa: a melhor ordem é calculada por ti.', 'أضف المناطق التي فيها صندوق: يُحسب لك أفضل ترتيب.'],
  'start': ['partenza', 'salida', 'Start', 'départ', 'start', 'start', 'partida', 'البداية'],
  'travel home to {name} · free': ['torna a casa a {name} · gratis', 'vuelve a casa en {name} · gratis', 'nach Hause nach {name} · kostenlos', 'retour à la maison à {name} · gratuit', 'naar huis in {name} · gratis', 'res hem till {name} · gratis', 'volta a casa em {name} · grátis', 'العودة إلى المنزل في {name} · مجانًا'],
  'Total: {n} regions travelled': ['Totale: {n} regioni percorse', 'Total: {n} regiones recorridas', 'Gesamt: {n} Regionen gereist', 'Total : {n} régions parcourues', 'Totaal: {n} regio’s gereisd', 'Totalt: {n} regioner rest', 'Total: {n} regiões percorridas', 'المجموع: {n} منطقة مقطوعة'],
  'This route outruns a full bar by {n} regions, at {oil} barrels each.': ['Questo giro supera la barra piena di {n} regioni, a {oil} barili l’una.', 'Esta ruta supera la barra llena en {n} regiones, a {oil} barriles cada una.', 'Diese Route übersteigt den vollen Balken um {n} Regionen, zu je {oil} Fässern.', 'Cette tournée dépasse la barre pleine de {n} régions, à {oil} barils chacune.', 'Deze route gaat {n} regio’s voorbij een volle balk, à {oil} vaten per stuk.', 'Rundan överskrider en full mätare med {n} regioner, {oil} fat styck.', 'Esta rota ultrapassa a barra cheia em {n} regiões, a {oil} barris cada.', 'يتجاوز هذا المسار الشريط الممتلئ بـ {n} منطقة، بـ {oil} براميل لكل منها.'],
  'Neither you nor home can reach: {names}': ['Né da dove sei né da casa si arriva a: {names}', 'Ni desde donde estás ni desde casa se llega a: {names}', 'Weder von dir noch von zu Hause erreichbar: {names}', 'Ni toi ni la maison ne pouvez atteindre : {names}', 'Niet bereikbaar vanaf jou of thuis: {names}', 'Varken du eller hemmet når: {names}', 'Nem de onde estás nem de casa se chega a: {names}', 'لا يمكن الوصول من موقعك ولا من المنزل إلى: {names}'],
  'Set a home region too: the route can spend one free trip home on it.': ['Imposta anche la regione di casa: il giro può usarci un ritorno gratis.', 'Fija también la región de casa: la ruta puede usar un regreso gratis.', 'Setze auch die Heimatregion: Die Route kann eine kostenlose Heimreise nutzen.', 'Définis aussi la région d’origine : la tournée peut y dépenser un retour gratuit.', 'Stel ook je thuisregio in: de route kan er een gratis thuisreis aan besteden.', 'Välj även hemregion: rundan kan använda en gratis hemresa.', 'Define também a região de casa: a rota pode usar um regresso grátis.', 'حدد أيضًا منطقة المنزل: يمكن للمسار استخدام عودة مجانية إليه.'],
  'Travelling home is free once every {h} hours: the route spends it on the leg where it saves the most, or keeps it.': ['Tornare a casa è gratis una volta ogni {h} ore: il giro lo usa nella tappa dove fa risparmiare di più, oppure lo tiene.', 'Volver a casa es gratis una vez cada {h} horas: la ruta lo usa en el tramo donde más ahorra, o lo guarda.', 'Die Heimreise ist alle {h} Stunden einmal kostenlos: Die Route nutzt sie dort, wo sie am meisten spart, oder behält sie.', 'Rentrer à la maison est gratuit une fois toutes les {h} heures : la tournée l’utilise là où elle économise le plus, ou la garde.', 'Naar huis reizen is eens per {h} uur gratis: de route gebruikt het waar het het meest bespaart, of bewaart het.', 'Att resa hem är gratis en gång var {h}:e timme: rundan använder det där det sparar mest, eller sparar det.', 'Voltar a casa é grátis uma vez a cada {h} horas: a rota usa-o no troço onde poupa mais, ou guarda-o.', 'العودة إلى المنزل مجانية مرة كل {h} ساعة: يستخدمها المسار حيث توفر أكثر، أو يحتفظ بها.'],
};

/** Testo tradotto; la chiave È l'inglese, che fa da ripiego. */
export function tT(chiave, vars) {
  const i = ORDINE.indexOf(getLang());
  let s = (i >= 0 && T[chiave]?.[i]) || chiave;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
