/* ══════════════════════════════════════════════════════════════
   WarEra+ — Traduzioni della vista mappa "Migrazioni" (migrationFlows.js)
   ------------------------------------------------------------------
   Stesso schema di travelI18n.js: la CHIAVE è il testo inglese, così
   nel codice si legge cosa c'è scritto e una traduzione mancante ricade
   sull'inglese invece di mostrare una chiave. Variabili fra graffe.

   Riga = [it, es, de, fr, nl, sv, pt, ar], nell'ordine di LANGS in
   src/shared/i18n.js. Dizionario LOCALE: queste etichette le usa solo
   il riepilogo della vista nel pannello.
   ══════════════════════════════════════════════════════════════ */

import { getLang } from '../shared/i18n.js';

const ORDINE = ['it', 'es', 'de', 'fr', 'nl', 'sv', 'pt', 'ar'];

const T = {
  // ── Intestazione e spiegazione
  'Migration': ['Migrazioni', 'Migraciones', 'Migration', 'Migrations', 'Migratie', 'Migration', 'Migrações', 'الهجرة'],
  'Who changed citizenship. The game does not publish it: it is worked out by comparing every nation\'s citizen list hour by hour. Only players of level {lv}+ (or with prestige) count, and a player who simply went inactive is not a departure.': [
    'Chi ha cambiato cittadinanza. Il gioco non lo pubblica: si ricava confrontando ora per ora l’elenco dei cittadini di ogni nazione. Contano solo i giocatori di livello {lv}+ (o col prestigio), e chi è solo diventato inattivo non è una partenza.',
    'Quién cambió de ciudadanía. El juego no lo publica: se obtiene comparando hora a hora la lista de ciudadanos de cada nación. Solo cuentan los jugadores de nivel {lv}+ (o con prestigio), y quien solo pasó a inactivo no es una salida.',
    'Wer die Staatsbürgerschaft gewechselt hat. Das Spiel veröffentlicht das nicht: Es wird ermittelt, indem die Bürgerliste jeder Nation Stunde für Stunde verglichen wird. Es zählen nur Spieler ab Level {lv} (oder mit Prestige), und wer nur inaktiv wurde, ist kein Wegzug.',
    'Qui a changé de citoyenneté. Le jeu ne le publie pas : on le déduit en comparant heure par heure la liste des citoyens de chaque nation. Seuls comptent les joueurs de niveau {lv}+ (ou avec prestige), et un joueur simplement devenu inactif n’est pas un départ.',
    'Wie van staatsburgerschap is gewisseld. Het spel publiceert dit niet: het wordt afgeleid door de burgerlijst van elke natie uur na uur te vergelijken. Alleen spelers van level {lv}+ (of met prestige) tellen, en wie alleen inactief werd is geen vertrek.',
    'Vem som bytt medborgarskap. Spelet publicerar det inte: det räknas fram genom att jämföra varje nations medborgarlista timme för timme. Bara spelare på nivå {lv}+ (eller med prestige) räknas, och den som bara blivit inaktiv har inte flyttat.',
    'Quem mudou de cidadania. O jogo não o publica: obtém-se comparando hora a hora a lista de cidadãos de cada nação. Só contam jogadores de nível {lv}+ (ou com prestígio), e quem apenas ficou inativo não é uma saída.',
    'من غيّر جنسيته. اللعبة لا تنشر ذلك: يُستنتج بمقارنة قائمة مواطني كل دولة ساعة بساعة. يُحتسب فقط اللاعبون من المستوى {lv} فما فوق (أو أصحاب الهيبة)، ومن أصبح غير نشط فقط لا يُعد مغادرًا.'],
  'Click a nation to see where its players are going.': ['Clicca una nazione per vedere dove vanno i suoi giocatori.', 'Haz clic en una nación para ver adónde van sus jugadores.', 'Klicke auf eine Nation, um zu sehen, wohin ihre Spieler gehen.', 'Clique sur une nation pour voir où vont ses joueurs.', 'Klik op een natie om te zien waar haar spelers heen gaan.', 'Klicka på en nation för att se vart dess spelare tar vägen.', 'Clica numa nação para ver para onde vão os seus jogadores.', 'انقر على دولة لترى إلى أين يذهب لاعبوها.'],
  'Tap a nation to see where its players are going.': ['Tocca una nazione per vedere dove vanno i suoi giocatori.', 'Toca una nación para ver adónde van sus jugadores.', 'Tippe auf eine Nation, um zu sehen, wohin ihre Spieler gehen.', 'Touche une nation pour voir où vont ses joueurs.', 'Tik op een natie om te zien waar haar spelers heen gaan.', 'Tryck på en nation för att se vart dess spelare tar vägen.', 'Toca numa nação para ver para onde vão os seus jogadores.', 'المس دولة لترى إلى أين يذهب لاعبوها.'],

  // ── Comandi
  '24 hours': ['24 ore', '24 horas', '24 Stunden', '24 heures', '24 uur', '24 timmar', '24 horas', '24 ساعة'],
  '{n} days': ['{n} giorni', '{n} días', '{n} Tage', '{n} jours', '{n} dagen', '{n} dagar', '{n} dias', '{n} يومًا'],
  'Net': ['Saldo', 'Saldo', 'Saldo', 'Solde', 'Saldo', 'Netto', 'Saldo', 'الصافي'],
  'Per 100 citizens': ['Ogni 100 cittadini', 'Por cada 100 ciudadanos', 'Pro 100 Bürger', 'Pour 100 citoyens', 'Per 100 burgers', 'Per 100 medborgare', 'Por 100 cidadãos', 'لكل 100 مواطن'],
  'Window': ['Finestra', 'Ventana', 'Zeitraum', 'Fenêtre', 'Periode', 'Period', 'Janela', 'الفترة'],
  'Colour by': ['Colore per', 'Color por', 'Farbe nach', 'Couleur par', 'Kleur op', 'Färg efter', 'Cor por', 'التلوين حسب'],

  // ── Numeri in testa
  'Moves': ['Spostamenti', 'Traslados', 'Umzüge', 'Déménagements', 'Verhuizingen', 'Flyttar', 'Mudanças', 'التنقلات'],
  'Players': ['Giocatori', 'Jugadores', 'Spieler', 'Joueurs', 'Spelers', 'Spelare', 'Jogadores', 'اللاعبون'],
  'Nations gaining': ['Nazioni in attivo', 'Naciones que ganan', 'Nationen im Plus', 'Nations en hausse', 'Naties in de plus', 'Nationer på plus', 'Nações a ganhar', 'دول رابحة'],
  'Nations losing': ['Nazioni in passivo', 'Naciones que pierden', 'Nationen im Minus', 'Nations en baisse', 'Naties in de min', 'Nationer på minus', 'Nações a perder', 'دول خاسرة'],

  // ── Elenchi
  'Gaining players': ['Guadagnano giocatori', 'Ganan jugadores', 'Gewinnen Spieler', 'Gagnent des joueurs', 'Winnen spelers', 'Vinner spelare', 'Ganham jogadores', 'تكسب لاعبين'],
  'Losing players': ['Perdono giocatori', 'Pierden jugadores', 'Verlieren Spieler', 'Perdent des joueurs', 'Verliezen spelers', 'Förlorar spelare', 'Perdem jogadores', 'تخسر لاعبين'],
  'Biggest flows': ['Flussi principali', 'Flujos principales', 'Größte Ströme', 'Principaux flux', 'Grootste stromen', 'Största flöden', 'Maiores fluxos', 'أكبر التدفقات'],
  'in {i} · out {o}': ['entrati {i} · usciti {o}', 'entradas {i} · salidas {o}', 'zu {i} · weg {o}', 'arrivées {i} · départs {o}', 'in {i} · uit {o}', 'in {i} · ut {o}', 'entradas {i} · saídas {o}', 'دخول {i} · خروج {o}'],
  '{v} per 100 citizens': ['{v} ogni 100 cittadini', '{v} por cada 100 ciudadanos', '{v} pro 100 Bürger', '{v} pour 100 citoyens', '{v} per 100 burgers', '{v} per 100 medborgare', '{v} por 100 cidadãos', '{v} لكل 100 مواطن'],

  // ── Stati
  'Loading…': ['Caricamento…', 'Cargando…', 'Wird geladen…', 'Chargement…', 'Laden…', 'Laddar…', 'A carregar…', 'جارٍ التحميل…'],
  'Migration data is not available yet (cache server not updated).': ['I dati sulle migrazioni non sono ancora disponibili (server di cache non aggiornato).', 'Los datos de migración aún no están disponibles (servidor de caché no actualizado).', 'Migrationsdaten sind noch nicht verfügbar (Cache-Server nicht aktualisiert).', 'Les données de migration ne sont pas encore disponibles (serveur de cache non mis à jour).', 'Migratiegegevens zijn nog niet beschikbaar (cacheserver niet bijgewerkt).', 'Migrationsdata finns inte än (cacheservern är inte uppdaterad).', 'Os dados de migração ainda não estão disponíveis (servidor de cache não atualizado).', 'بيانات الهجرة غير متاحة بعد (خادم التخزين المؤقت غير محدّث).'],
  'Cache server unreachable right now — reopen this view to retry.': ['Server di cache irraggiungibile in questo momento: riapri la vista per riprovare.', 'Servidor de caché inaccesible ahora mismo: vuelve a abrir la vista para reintentar.', 'Cache-Server gerade nicht erreichbar – öffne die Ansicht erneut, um es nochmal zu versuchen.', 'Serveur de cache injoignable pour l’instant : rouvre la vue pour réessayer.', 'Cacheserver nu onbereikbaar — open de weergave opnieuw om het nog eens te proberen.', 'Cacheservern går inte att nå just nu – öppna vyn igen för att försöka på nytt.', 'Servidor de cache inacessível neste momento — reabre a vista para tentar de novo.', 'تعذّر الوصول إلى خادم التخزين المؤقت الآن — أعد فتح العرض للمحاولة مجددًا.'],
  'No moves recorded in this window.': ['Nessuno spostamento registrato in questa finestra.', 'Ningún traslado registrado en esta ventana.', 'Keine Umzüge in diesem Zeitraum erfasst.', 'Aucun déménagement enregistré sur cette période.', 'Geen verhuizingen vastgelegd in deze periode.', 'Inga flyttar registrerade under perioden.', 'Nenhuma mudança registada nesta janela.', 'لم تُسجّل أي تنقلات في هذه الفترة.'],
  'The archive has been watching since {date}: moves before then do not show up, so this window is not full yet.': [
    'L’archivio guarda dal {date}: gli spostamenti di prima non risultano, quindi questa finestra non è ancora piena.',
    'El archivo observa desde el {date}: los traslados anteriores no aparecen, así que esta ventana aún no está completa.',
    'Das Archiv beobachtet seit dem {date}: Frühere Umzüge erscheinen nicht, dieser Zeitraum ist also noch nicht voll.',
    'L’archive observe depuis le {date} : les déménagements d’avant n’apparaissent pas, cette période n’est donc pas encore complète.',
    'Het archief kijkt mee sinds {date}: eerdere verhuizingen staan er niet in, dus deze periode is nog niet vol.',
    'Arkivet har bevakat sedan {date}: tidigare flyttar syns inte, så perioden är inte full än.',
    'O arquivo observa desde {date}: as mudanças anteriores não aparecem, por isso esta janela ainda não está completa.',
    'يراقب الأرشيف منذ {date}: التنقلات السابقة لا تظهر، لذا هذه الفترة ليست مكتملة بعد.'],
  'Left out: {low} below level {lv}, {inactive} who only went inactive.': ['Esclusi: {low} sotto il livello {lv}, {inactive} solo diventati inattivi.', 'Excluidos: {low} por debajo del nivel {lv}, {inactive} que solo pasaron a inactivos.', 'Nicht gezählt: {low} unter Level {lv}, {inactive} nur inaktiv geworden.', 'Exclus : {low} sous le niveau {lv}, {inactive} simplement devenus inactifs.', 'Niet meegeteld: {low} onder level {lv}, {inactive} alleen inactief geworden.', 'Utelämnade: {low} under nivå {lv}, {inactive} som bara blivit inaktiva.', 'Excluídos: {low} abaixo do nível {lv}, {inactive} que só ficaram inativos.', 'المستبعدون: {low} دون المستوى {lv}، و{inactive} أصبحوا غير نشطين فقط.'],

  // ── Una nazione
  '← All nations': ['← Tutte le nazioni', '← Todas las naciones', '← Alle Nationen', '← Toutes les nations', '← Alle naties', '← Alla nationer', '← Todas as nações', '← كل الدول'],
  'Arrived': ['Arrivati', 'Llegados', 'Zugezogen', 'Arrivés', 'Aangekomen', 'Inflyttade', 'Chegados', 'وصلوا'],
  'Left': ['Partiti', 'Se fueron', 'Weggezogen', 'Partis', 'Vertrokken', 'Utflyttade', 'Partiram', 'غادروا'],
  'Balance': ['Saldo', 'Saldo', 'Saldo', 'Solde', 'Saldo', 'Netto', 'Saldo', 'الرصيد'],
  'Arrows': ['Frecce', 'Flechas', 'Pfeile', 'Flèches', 'Pijlen', 'Pilar', 'Setas', 'الأسهم'],
  'Departures': ['Partenze', 'Salidas', 'Wegzüge', 'Départs', 'Vertrek', 'Utflyttning', 'Saídas', 'المغادرات'],
  'Arrivals': ['Arrivi', 'Llegadas', 'Zuzüge', 'Arrivées', 'Aankomst', 'Inflyttning', 'Chegadas', 'الوصول'],
  'Both': ['Entrambi', 'Ambos', 'Beides', 'Les deux', 'Beide', 'Båda', 'Ambos', 'كلاهما'],
  'Where they go': ['Dove vanno', 'Adónde van', 'Wohin sie gehen', 'Où ils vont', 'Waar ze heen gaan', 'Vart de flyttar', 'Para onde vão', 'إلى أين يذهبون'],
  'Where they come from': ['Da dove arrivano', 'De dónde vienen', 'Woher sie kommen', 'D’où ils viennent', 'Waar ze vandaan komen', 'Varifrån de kommer', 'De onde vêm', 'من أين يأتون'],
  '{p}% of departures': ['{p}% delle partenze', '{p}% de las salidas', '{p}% der Wegzüge', '{p}% des départs', '{p}% van het vertrek', '{p}% av utflyttningen', '{p}% das saídas', '{p}% من المغادرات'],
  '{p}% of arrivals': ['{p}% degli arrivi', '{p}% de las llegadas', '{p}% der Zuzüge', '{p}% des arrivées', '{p}% van de aankomst', '{p}% av inflyttningen', '{p}% das chegadas', '{p}% من الوصول'],
  'Nobody left or arrived in this window.': ['Nessuno è partito o arrivato in questa finestra.', 'Nadie se fue ni llegó en esta ventana.', 'In diesem Zeitraum ist niemand weg- oder zugezogen.', 'Personne n’est parti ni arrivé sur cette période.', 'Niemand is in deze periode vertrokken of aangekomen.', 'Ingen flyttade in eller ut under perioden.', 'Ninguém partiu nem chegou nesta janela.', 'لم يغادر أو يصل أحد في هذه الفترة.'],
  'Players by name in the nation panel': ['I giocatori per nome nella scheda nazione', 'Los jugadores por nombre en el panel de la nación', 'Die Spieler namentlich im Nationspanel', 'Les joueurs par nom dans le panneau de la nation', 'De spelers bij naam in het natiepaneel', 'Spelarna med namn i nationspanelen', 'Os jogadores por nome no painel da nação', 'اللاعبون بالاسم في لوحة الدولة'],
};

/** Testo tradotto; la chiave È l'inglese, che fa da ripiego. */
export function mT(chiave, vars) {
  const i = ORDINE.indexOf(getLang());
  let s = (i >= 0 && T[chiave]?.[i]) || chiave;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}
