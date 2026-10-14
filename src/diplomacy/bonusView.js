/* ══════════════════════════════════════════════════════════════
   WarEra+ — vista mappa "Bonus battaglia"
   ------------------------------------------------------------------
   Si entra dalla barra delle viste, si clicca una battaglia, e ogni
   nazione si colora per il bonus danno PIÙ ALTO che avrebbero i suoi
   cittadini lì: BLU se conviene difendere, ROSSO se conviene attaccare,
   più scuro quanto più è alto (fino al massimo di quella battaglia).
   Richiesta esplicita, dopo che la stessa cosa dentro il riquadro della
   battaglia "si vedeva malissimo": i dettagli stanno nel pannello di
   riepilogo, largo, e non nel tooltip.

   ── COME SI AGGANCIA ───────────────────────────────────────────────
   · Il clic su una battaglia passa per la heatmap di sempre
     (battleHeatmap.js:setBattleHeatmap): zoom, regione evidenziata,
     tooltip, Indietro/Esc restano identici. Se la vista da cui si è
     entrati è questa, setBattleHeatmap chiama onBattleSelected e la
     mappa si colora coi valori di qui invece che col danno
     (state.battleBonusMap). Uscire dalla battaglia torna alla vista
     (onBattleCleared).
   · Il calcolo è src/shared/battleBonus.js. Sulla MAPPA contano solo le
     voci della NAZIONE (patria, alleanza, patto, nemico giurato, ordine
     della nazione, bunker/base, rivolta, malus): ordine e quartier
     generale dell'unità dipendono dal singolo giocatore, e sommati a
     tutti colorerebbero il mondo intero dello stesso 35%. Il bonus
     personale, con quelle due voci, sta nel pannello ("Il tuo bonus").
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { getLang } from '../shared/i18n.js';
import {
  loadBonusRules, fetchBattleOrders, loadMe, myPlayerId,
  sideContext, bonusFor, personalBonus, nationTotal, nationParts,
} from '../shared/battleBonus.js';

export { nationParts };

/* ── Stato ─────────────────────────────────────────────────────── */

const _s = {
  battle: null,      // oggetto battaglia (battle.getById)
  loading: false,
  ctxs: null,        // { defender, attacker }
  rows: null,        // [{ id, side, v, parts }] ordinate per v
  max: 0,
  me: null,
  mine: null,
  ordersKnown: true,
  token: 0,
};
export const bonusState = () => _s;

/* ── Ingresso / uscita ─────────────────────────────────────────── */

/** Entrando nella vista: regole e profilo si scaldano subito, così al
 *  primo clic su una battaglia manca solo la lettura degli ordini. */
export function enterBonusView() {
  _s.battle = null;
  _s.rows = null;
  loadBonusRules();
  if (myPlayerId()) loadMe().then(me => { _s.me = me; refreshOverview(); });
}

/** Chiamata da setBattleHeatmap quando si arriva da questa vista. */
export async function onBattleSelected(battle) {
  if (!battle?._id) return;
  const token = ++_s.token;
  _s.battle = battle;
  _s.loading = true;
  _s.rows = null;
  state.battleBonusMap = null;
  state.bonusViewLoading = true;   // la legenda dice "sto calcolando"
  refreshOverview();

  const [rules, orders, me] = await Promise.all([
    loadBonusRules(),
    fetchBattleOrders([battle._id]),
    myPlayerId() ? loadMe() : Promise.resolve(null),
  ]);
  if (token !== _s.token) return; // nel frattempo è stata cliccata un'altra battaglia

  const o = orders.get(battle._id) ?? null;
  const ctxs = {
    defender: sideContext(battle, 'defender', rules, o),
    attacker: sideContext(battle, 'attacker', rules, o),
  };
  const rows = [];
  const values = new Map();
  for (const n of state.nazioniGlobal || []) {
    const d = bonusFor(n._id, ctxs.defender);
    const a = bonusFor(n._id, ctxs.attacker);
    const dv = nationTotal(d.parts);
    const av = nationTotal(a.parts);
    const side = av > dv ? 'attacker' : 'defender';
    const v = Math.max(dv, av);
    if (!(v > 0)) continue;
    const parts = side === 'attacker' ? a.parts : d.parts;
    rows.push({ id: n._id, side, v, parts });
    values.set(n._id, { side, v });
  }
  rows.sort((x, y) => y.v - x.v);
  const max = rows.length ? rows[0].v : 0;

  state.bonusViewLoading = false;
  Object.assign(_s, {
    loading: false, ctxs, rows, max, me,
    mine: me ? personalBonus(battle, rules, o, me) : null,
    ordersKnown: !!o,
  });

  // La heatmap potrebbe essere già stata chiusa mentre si calcolava.
  if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData?.battleId === battle._id) {
    const { setBattleBonusMap } = await import('./battleHeatmap.js');
    setBattleBonusMap({ battleId: battle._id, values, max });
    import('./ui.js').then(m => m.updateDynamicLegend());
  }
  refreshOverview();
}

/** Uscita dalla battaglia (si resta nella vista). */
export function onBattleCleared() {
  _s.token++;
  state.bonusViewLoading = false;
  _s.battle = null;
  _s.rows = null;
  _s.loading = false;
  refreshOverview();
}

function refreshOverview() {
  import('../panel/countryPanel.js').then(m => m.refreshViewOverviewPanel('battleBonus'));
}

/** Righe migliori per un lato, per il pannello. */
export function bonusRanking(side, limit = 15) {
  return (_s.rows || []).filter(r => r.side === side).slice(0, limit);
}


/* ── Testi (9 lingue) ──────────────────────────────────────────── */

const D = {
  en: {
    title: 'Battle bonus',
    about: 'Click a battle on the map: every nation is coloured by the highest damage bonus its citizens would get there — blue if it is better to defend, red if it is better to attack, darker the higher.',
    pick: 'Click a battle on the map.',
    loading: 'Calculating bonuses…',
    you: 'Your bonus', defending: 'Defending', attacking: 'Attacking',
    setMe: 'Tell the tool who you are (Players → your profile → “This is me”) to see your own bonus here, unit orders and HQ included.',
    openPlayers: 'Open Players',
    bestDefend: 'Better to defend', bestAttack: 'Better to attack',
    bunker: 'Bunker lv {n}: +{p}%', base: 'Military base lv {n}: +{p}%', bunkerOff: 'Bunker: not active', baseOff: 'Military base: not active', baseUnknown: 'Military base: unknown',
    notLinked: 'Region not linked to the capital: {p}% to all defenders',
    revolt: 'Revolt bar {p}%',
    ordersUnknown: 'Orders could not be loaded: nation orders are missing from the numbers.',
    none: 'No nation has a specific bonus here.',
    note: '≈ = sum of the bonuses that apply to a nation’s citizens: home, alliance, pact, sworn enemy, nation order (red +15, yellow +10, green +5), bunker or base, revolt. Unit orders and unit HQ depend on the player, so they count only in “Your bonus”. Who gets half of a bunker or base (same alliance or pact) is our reading of the rules.',
    home: 'Home', enemy: 'Sworn enemy', pact: 'Pact', ally: 'Alliance', order: 'Order', muOrder: 'Unit order', muHq: 'Unit HQ', revolt_p: 'Revolt', malus: 'Not linked', bunker_p: 'Bunker', base_p: 'Base',
  },
  it: {
    title: 'Bonus battaglia',
    about: 'Clicca una battaglia sulla mappa: ogni nazione si colora col bonus danno più alto che avrebbero lì i suoi cittadini — blu se conviene difendere, rosso se conviene attaccare, più scuro quanto più è alto.',
    pick: 'Clicca una battaglia sulla mappa.',
    loading: 'Calcolo dei bonus…',
    you: 'Il tuo bonus', defending: 'In difesa', attacking: 'In attacco',
    setMe: 'Di’ al tool chi sei (Giocatori → il tuo profilo → “Sono io”) per vedere qui il tuo bonus, ordini e QG della tua unità compresi.',
    openPlayers: 'Apri Giocatori',
    bestDefend: 'Conviene difendere', bestAttack: 'Conviene attaccare',
    bunker: 'Bunker liv {n}: +{p}%', base: 'Base militare liv {n}: +{p}%', bunkerOff: 'Bunker: non attivo', baseOff: 'Base militare: non attiva', baseUnknown: 'Base militare: sconosciuta',
    notLinked: 'Regione non collegata alla capitale: {p}% a tutti i difensori',
    revolt: 'Barra della rivolta {p}%',
    ordersUnknown: 'Gli ordini non si sono potuti leggere: il bonus degli ordini manca dai numeri.',
    none: 'Nessuna nazione ha un bonus specifico qui.',
    note: '≈ = somma dei bonus che valgono per i cittadini di una nazione: patria, alleanza, patto, nemico giurato, ordine della nazione (rosso +15, giallo +10, verde +5), bunker o base, rivolta. Ordini e QG dell’unità dipendono dal giocatore, quindi contano solo in “Il tuo bonus”. Chi riceve metà di bunker o base (stessa alleanza o patto) è la nostra lettura delle regole.',
    home: 'Patria', enemy: 'Nemico giurato', pact: 'Patto', ally: 'Alleanza', order: 'Ordine', muOrder: 'Ordine unità', muHq: 'QG unità', revolt_p: 'Rivolta', malus: 'Non collegata', bunker_p: 'Bunker', base_p: 'Base',
  },
  es: {
    title: 'Bonus de batalla',
    about: 'Haz clic en una batalla del mapa: cada nación se colorea con el mayor bonus de daño que tendrían allí sus ciudadanos — azul si conviene defender, rojo si conviene atacar, más oscuro cuanto mayor.',
    pick: 'Haz clic en una batalla del mapa.',
    loading: 'Calculando bonus…',
    you: 'Tu bonus', defending: 'Defendiendo', attacking: 'Atacando',
    setMe: 'Dile a la herramienta quién eres (Jugadores → tu perfil → “Soy yo”) para ver aquí tu bonus, con órdenes y CG de tu unidad.',
    openPlayers: 'Abrir Jugadores',
    bestDefend: 'Conviene defender', bestAttack: 'Conviene atacar',
    bunker: 'Búnker nv {n}: +{p}%', base: 'Base militar nv {n}: +{p}%', bunkerOff: 'Búnker: no activo', baseOff: 'Base militar: no activa', baseUnknown: 'Base militar: desconocida',
    notLinked: 'Región no conectada con la capital: {p}% a todos los defensores',
    revolt: 'Barra de revuelta {p}%',
    ordersUnknown: 'No se pudieron leer las órdenes: falta su bonus en los números.',
    none: 'Ninguna nación tiene un bonus específico aquí.',
    note: '≈ = suma de los bonus que valen para los ciudadanos de una nación: patria, alianza, pacto, enemigo jurado, orden de la nación (rojo +15, amarillo +10, verde +5), búnker o base, revuelta. Órdenes y CG de unidad dependen del jugador: solo cuentan en “Tu bonus”. Quién recibe la mitad de un búnker o base (misma alianza o pacto) es nuestra lectura de las reglas.',
    home: 'Patria', enemy: 'Enemigo jurado', pact: 'Pacto', ally: 'Alianza', order: 'Orden', muOrder: 'Orden de unidad', muHq: 'CG unidad', revolt_p: 'Revuelta', malus: 'Sin conexión', bunker_p: 'Búnker', base_p: 'Base',
  },
  de: {
    title: 'Schlachtbonus',
    about: 'Klick auf eine Schlacht der Karte: Jede Nation wird nach dem höchsten Schadensbonus gefärbt, den ihre Bürger dort hätten — blau, wenn Verteidigen sich lohnt, rot, wenn Angreifen, dunkler je höher.',
    pick: 'Klick auf eine Schlacht der Karte.',
    loading: 'Boni werden berechnet…',
    you: 'Dein Bonus', defending: 'Verteidigung', attacking: 'Angriff',
    setMe: 'Sag dem Tool, wer du bist (Spieler → dein Profil → „Das bin ich“), um hier deinen Bonus zu sehen, mit Befehlen und HQ deiner Einheit.',
    openPlayers: 'Spieler öffnen',
    bestDefend: 'Besser verteidigen', bestAttack: 'Besser angreifen',
    bunker: 'Bunker St. {n}: +{p} %', base: 'Militärbasis St. {n}: +{p} %', bunkerOff: 'Bunker: nicht aktiv', baseOff: 'Militärbasis: nicht aktiv', baseUnknown: 'Militärbasis: unbekannt',
    notLinked: 'Region nicht mit der Hauptstadt verbunden: {p} % für alle Verteidiger',
    revolt: 'Aufstandsbalken {p} %',
    ordersUnknown: 'Befehle konnten nicht geladen werden: ihr Bonus fehlt in den Zahlen.',
    none: 'Keine Nation hat hier einen eigenen Bonus.',
    note: '≈ = Summe der Boni für die Bürger einer Nation: Heimat, Allianz, Pakt, Erzfeind, Befehl der Nation (rot +15, gelb +10, grün +5), Bunker oder Basis, Aufstand. Befehle und HQ der Einheit hängen vom Spieler ab und zählen nur in „Dein Bonus“. Wer die Hälfte von Bunker oder Basis erhält (gleiche Allianz oder Pakt), ist unsere Lesart der Regeln.',
    home: 'Heimat', enemy: 'Erzfeind', pact: 'Pakt', ally: 'Allianz', order: 'Befehl', muOrder: 'Einheitsbefehl', muHq: 'Einheit-HQ', revolt_p: 'Aufstand', malus: 'Nicht verbunden', bunker_p: 'Bunker', base_p: 'Basis',
  },
  fr: {
    title: 'Bonus de bataille',
    about: 'Clique sur une bataille de la carte : chaque nation prend la couleur du plus haut bonus de dégâts qu’y auraient ses citoyens — bleu s’il vaut mieux défendre, rouge s’il vaut mieux attaquer, plus foncé quand il est plus élevé.',
    pick: 'Clique sur une bataille de la carte.',
    loading: 'Calcul des bonus…',
    you: 'Ton bonus', defending: 'En défense', attacking: 'En attaque',
    setMe: 'Dis à l’outil qui tu es (Joueurs → ton profil → « C’est moi ») pour voir ici ton bonus, ordres et QG de ton unité compris.',
    openPlayers: 'Ouvrir Joueurs',
    bestDefend: 'Mieux vaut défendre', bestAttack: 'Mieux vaut attaquer',
    bunker: 'Bunker niv {n} : +{p} %', base: 'Base militaire niv {n} : +{p} %', bunkerOff: 'Bunker : inactif', baseOff: 'Base militaire : inactive', baseUnknown: 'Base militaire : inconnue',
    notLinked: 'Région non reliée à la capitale : {p} % pour tous les défenseurs',
    revolt: 'Barre de révolte {p} %',
    ordersUnknown: 'Les ordres n’ont pas pu être lus : leur bonus manque dans les chiffres.',
    none: 'Aucune nation n’a de bonus particulier ici.',
    note: '≈ = somme des bonus qui valent pour les citoyens d’une nation : patrie, alliance, pacte, ennemi juré, ordre de la nation (rouge +15, jaune +10, vert +5), bunker ou base, révolte. Ordres et QG d’unité dépendent du joueur : ils ne comptent que dans « Ton bonus ». Qui reçoit la moitié d’un bunker ou d’une base (même alliance ou pacte) est notre lecture des règles.',
    home: 'Patrie', enemy: 'Ennemi juré', pact: 'Pacte', ally: 'Alliance', order: 'Ordre', muOrder: 'Ordre d’unité', muHq: 'QG d’unité', revolt_p: 'Révolte', malus: 'Non reliée', bunker_p: 'Bunker', base_p: 'Base',
  },
  nl: {
    title: 'Slagbonus',
    about: 'Klik op een veldslag op de kaart: elk land kleurt naar de hoogste schadebonus die zijn burgers daar zouden krijgen — blauw als verdedigen loont, rood als aanvallen loont, donkerder naarmate hoger.',
    pick: 'Klik op een veldslag op de kaart.',
    loading: 'Bonussen worden berekend…',
    you: 'Jouw bonus', defending: 'Verdedigen', attacking: 'Aanvallen',
    setMe: 'Vertel de tool wie je bent (Spelers → je profiel → “Dit ben ik”) om hier je eigen bonus te zien, met orders en HK van je eenheid.',
    openPlayers: 'Spelers openen',
    bestDefend: 'Beter verdedigen', bestAttack: 'Beter aanvallen',
    bunker: 'Bunker nv {n}: +{p}%', base: 'Militaire basis nv {n}: +{p}%', bunkerOff: 'Bunker: niet actief', baseOff: 'Militaire basis: niet actief', baseUnknown: 'Militaire basis: onbekend',
    notLinked: 'Regio niet verbonden met de hoofdstad: {p}% voor alle verdedigers',
    revolt: 'Opstandsbalk {p}%',
    ordersUnknown: 'Orders konden niet worden gelezen: hun bonus ontbreekt in de cijfers.',
    none: 'Geen enkel land heeft hier een eigen bonus.',
    note: '≈ = som van de bonussen voor de burgers van een land: thuis, alliantie, pact, aartsvijand, landorder (rood +15, geel +10, groen +5), bunker of basis, opstand. Orders en HK van de eenheid hangen af van de speler en tellen alleen in “Jouw bonus”. Wie de helft van een bunker of basis krijgt (zelfde alliantie of pact) is onze lezing van de regels.',
    home: 'Thuis', enemy: 'Aartsvijand', pact: 'Pact', ally: 'Alliantie', order: 'Order', muOrder: 'Eenheidsorder', muHq: 'Eenheid-HK', revolt_p: 'Opstand', malus: 'Niet verbonden', bunker_p: 'Bunker', base_p: 'Basis',
  },
  sv: {
    title: 'Stridsbonus',
    about: 'Klicka på en strid på kartan: varje nation färgas efter den högsta skadebonus dess medborgare skulle få där — blått om det lönar sig att försvara, rött om det lönar sig att anfalla, mörkare ju högre.',
    pick: 'Klicka på en strid på kartan.',
    loading: 'Bonusar beräknas…',
    you: 'Din bonus', defending: 'Försvar', attacking: 'Anfall',
    setMe: 'Berätta för verktyget vem du är (Spelare → din profil → ”Det är jag”) för att se din egen bonus här, med order och HK för din enhet.',
    openPlayers: 'Öppna Spelare',
    bestDefend: 'Bättre att försvara', bestAttack: 'Bättre att anfalla',
    bunker: 'Bunker nv {n}: +{p} %', base: 'Militärbas nv {n}: +{p} %', bunkerOff: 'Bunker: inte aktiv', baseOff: 'Militärbas: inte aktiv', baseUnknown: 'Militärbas: okänd',
    notLinked: 'Regionen är inte ansluten till huvudstaden: {p} % för alla försvarare',
    revolt: 'Revoltmätare {p} %',
    ordersUnknown: 'Order kunde inte läsas: deras bonus saknas i siffrorna.',
    none: 'Ingen nation har en egen bonus här.',
    note: '≈ = summan av bonusarna för en nations medborgare: hemma, allians, pakt, svuren fiende, nationsorder (röd +15, gul +10, grön +5), bunker eller bas, revolt. Order och HK för enheten beror på spelaren och räknas bara i ”Din bonus”. Vem som får halva bunkern eller basen (samma allians eller pakt) är vår tolkning av reglerna.',
    home: 'Hemma', enemy: 'Svuren fiende', pact: 'Pakt', ally: 'Allians', order: 'Order', muOrder: 'Enhetsorder', muHq: 'Enhets-HK', revolt_p: 'Revolt', malus: 'Ej ansluten', bunker_p: 'Bunker', base_p: 'Bas',
  },
  pt: {
    title: 'Bônus de batalha',
    about: 'Clique numa batalha do mapa: cada nação fica com a cor do maior bônus de dano que seus cidadãos teriam ali — azul se compensa defender, vermelho se compensa atacar, mais escuro quanto maior.',
    pick: 'Clique numa batalha do mapa.',
    loading: 'Calculando bônus…',
    you: 'Seu bônus', defending: 'Defendendo', attacking: 'Atacando',
    setMe: 'Diga à ferramenta quem você é (Jogadores → seu perfil → “Sou eu”) para ver aqui seu bônus, com ordens e QG da sua unidade.',
    openPlayers: 'Abrir Jogadores',
    bestDefend: 'Melhor defender', bestAttack: 'Melhor atacar',
    bunker: 'Bunker nv {n}: +{p}%', base: 'Base militar nv {n}: +{p}%', bunkerOff: 'Bunker: inativo', baseOff: 'Base militar: inativa', baseUnknown: 'Base militar: desconhecida',
    notLinked: 'Região não ligada à capital: {p}% para todos os defensores',
    revolt: 'Barra de revolta {p}%',
    ordersUnknown: 'Não foi possível ler as ordens: o bônus delas falta nos números.',
    none: 'Nenhuma nação tem bônus específico aqui.',
    note: '≈ = soma dos bônus que valem para os cidadãos de uma nação: pátria, aliança, pacto, inimigo jurado, ordem da nação (vermelho +15, amarelo +10, verde +5), bunker ou base, revolta. Ordens e QG da unidade dependem do jogador: só contam em “Seu bônus”. Quem recebe metade de um bunker ou base (mesma aliança ou pacto) é nossa leitura das regras.',
    home: 'Pátria', enemy: 'Inimigo jurado', pact: 'Pacto', ally: 'Aliança', order: 'Ordem', muOrder: 'Ordem da unidade', muHq: 'QG da unidade', revolt_p: 'Revolta', malus: 'Sem ligação', bunker_p: 'Bunker', base_p: 'Base',
  },
  ar: {
    title: 'مكافأة المعركة',
    about: 'انقر على معركة في الخريطة: تتلون كل دولة بأعلى مكافأة ضرر سيحصل عليها مواطنوها هناك — أزرق إن كان الدفاع أفضل، أحمر إن كان الهجوم أفضل، وأغمق كلما ارتفعت.',
    pick: 'انقر على معركة في الخريطة.',
    loading: 'جارٍ حساب المكافآت…',
    you: 'مكافأتك', defending: 'في الدفاع', attacking: 'في الهجوم',
    setMe: 'أخبر الأداة من أنت (اللاعبون ← ملفك ← «هذا أنا») لترى هنا مكافأتك، مع أوامر ومقر وحدتك.',
    openPlayers: 'افتح اللاعبين',
    bestDefend: 'الدفاع أفضل', bestAttack: 'الهجوم أفضل',
    bunker: 'مخبأ مستوى {n}: +{p}٪', base: 'قاعدة عسكرية مستوى {n}: +{p}٪', bunkerOff: 'المخبأ: غير نشط', baseOff: 'القاعدة العسكرية: غير نشطة', baseUnknown: 'القاعدة العسكرية: غير معروفة',
    notLinked: 'المنطقة غير متصلة بالعاصمة: {p}٪ لكل المدافعين',
    revolt: 'شريط التمرد {p}٪',
    ordersUnknown: 'تعذرت قراءة الأوامر: مكافأتها غير محسوبة.',
    none: 'لا توجد دولة بمكافأة خاصة هنا.',
    note: '≈ = مجموع المكافآت التي تنطبق على مواطني دولة: الوطن، التحالف، الميثاق، العدو اللدود، أمر الدولة (أحمر +15، أصفر +10، أخضر +5)، المخبأ أو القاعدة، التمرد. أوامر الوحدة ومقرها تعتمد على اللاعب فتُحسب فقط في «مكافأتك». من يحصل على نصف المخبأ أو القاعدة (نفس التحالف أو ميثاق) هو قراءتنا للقواعد.',
    home: 'الوطن', enemy: 'العدو اللدود', pact: 'ميثاق', ally: 'تحالف', order: 'أمر', muOrder: 'أمر الوحدة', muHq: 'مقر الوحدة', revolt_p: 'تمرد', malus: 'غير متصلة', bunker_p: 'مخبأ', base_p: 'قاعدة',
  },
};

export function bvT(key, vars) {
  const dict = D[getLang()] || D.en;
  let s = dict[key] ?? D.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, v);
  return s;
}

/** "Patria 20 · Alleanza 19,1 · Ordine 15 · Bunker 13" */
export function partsText(parts, side) {
  const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
  const out = [];
  for (const [k, v] of Object.entries(parts)) {
    if (!v || Array.isArray(v)) continue;
    let label;
    if (k === 'building') label = bvT(side === 'attacker' ? 'base_p' : 'bunker_p');
    else if (k === 'revolt') label = bvT('revolt_p');
    else label = bvT(k);
    out.push(`${label} ${v > 0 ? '+' : ''}${fmt(v)}`);
  }
  return out.join(' · ');
}
