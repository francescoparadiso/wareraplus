// ═══════════════════════════════════════════════════════════════════════
// WarEra+ — Tornei: CAPACITÀ di una squadra (danno potenziale in 12 ore)
// -----------------------------------------------------------------------
// Richiesta dell'utente (2026-11-23, Legio Gemini – PRAETORIANS al turno 4,
// dati 64% a Gemini): «per la vittoria devi tenere conto del danno
// potenziale, quindi del danno che i player della MU possono fare
// nell'arco delle 12/18 ore, in base ad HP, Hunger e stats».
//
// Il danno settimanale (la forza di prima) misura male un torneo per una
// ragione precisa: il torneo ha un TETTO all'equipaggiamento (`maxRarity`,
// uncommon nel torneo MU di novembre) e il settimanale è fatto col proprio,
// fino ai jet mitici (attacco fino a 300 contro i 60 di una pistola
// uncommon). Qui la forza di ogni iscritto si ricostruisce dalle sue
// statistiche, col tetto applicato:
//
//   COLPO   attacco × (0,5 + 0,5·precisione + precisione·critico·danno crit.)
//           (formula di server/plusApi/nemici.js, dal codex), con
//           attacco = (abilità + arma) × (1 + grado militare) × (1 + munizioni),
//           e arma, guanti, elmo tagliati al massimo della rarità del torneo
//           (gameConfig.items.*.dynamicStats). Verificato sul profilo:
//           (300+60)·1,565·1,1·0,4 = 248 = `attack.total` con la pillola in malus.
//   COLPI   vita / 10 (`battle.healthCost`): la vita di partenza, più la
//           rigenerazione oraria per H ore, più i pasti (la barra della fame,
//           e la sua rigenerazione, ognuno vale FOOD della vita massima).
//   CAPACITÀ  Σ colpi × colpo sugli iscritti.
//
// Misurato sul torneo MU del 20 novembre (192 partite dei turni 2 e 3,
// statistiche lette il 23): da sola la capacità indovina il 71% contro il
// 66% del settimanale (log-loss 0,546 contro 0,608, convalida a 10 fette);
// insieme alla forma nel torneo 0,414 contro 0,470. Quanto si mangia (pane
// 10%, bistecca 15%, pesce 20%) cambia la scala ma quasi mai l'ordine.
//
// Due capacità per squadra:
//   · `capacity`    barre PIENE, nessuna pillola: la forza "di fondo", quella
//                   tarata sulle partite giocate (le barre e le pillole di
//                   ieri non si possono rileggere: il gioco dice solo come
//                   stanno adesso);
//   · per ogni partita IN CORSO (`matchCap`), quanto le due squadre possono
//                   ancora fare nelle 12 ore DALL'INIZIO DELLA BATTAGLIA
//                   (precisazione dell'utente: non dalla lettura), con le
//                   barre e le pillole lette adesso. Le battaglie di un turno
//                   partono tutte insieme, una volta al giorno (R1 20/11 18:05,
//                   R2 21/11 16:36, R3 22/11 15:55, R4 23/11 15:15): per i
//                   turni dopo l'ora non si sa, e vale `capacity`.
//                   La pillola (`cocain`) dà +60% per 8 ore e poi −60% per
//                   15,5; chi può pillarsi si suppone che lo faccia appena può
//                   (è un potenziale). Questa parte NON è tarata: è la
//                   meccanica del gioco applicata, e la vista lo dice.
//
// ⚠️ Il cibo che uno ha in inventario non si vede (inventory.getInventory
// rifiuta le chiavi): si suppone che chi è iscritto a un torneo mangi. Per
// una nazione intera questa ipotesi era sbagliata di dieci volte (testata
// di nemici.js); per una rosa iscritta a un torneo, la prova sopra dice
// che regge.
//
// Costo: una `user.getUserById` per iscritto, a blocchi di 50, con la
// chiave. Le squadre in gara si rileggono ogni PLAYER_TTL_MS, le eliminate
// una volta sola (servono alla taratura). Al primo avvio ~10.000 iscritti,
// MAX_PER_POLL a giro: una mezz'ora per averli tutti.
// ═══════════════════════════════════════════════════════════════════════

const H = 12;                         // ore: una battaglia 2–0 (warera-durata-round)
const FOOD = 0.15;                    // bistecca: 15% della vita massima a pasto
const HEALTH_COST = 10;               // battle.healthCost
const PILL = { pct: 0.6, buffH: 8, debuffH: 15.5 };
const AMMO = { lightAmmo: 0.1, ammo: 0.2, heavyAmmo: 0.4 };
const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
// Massimi per rarità (gameConfig.items, letto il 2026-11-23): ripiego se la
// configurazione non arriva.
const CAPS_FALLBACK = {
  common: { attack: 40, crit: 5, precision: 5, critDmg: 15 },
  uncommon: { attack: 60, crit: 10, precision: 10, critDmg: 30 },
  rare: { attack: 90, crit: 15, precision: 15, critDmg: 50 },
  epic: { attack: 130, crit: 20, precision: 25, critDmg: 90 },
  legendary: { attack: 170, crit: 35, precision: 40, critDmg: 110 },
  mythic: { attack: 300, crit: 50, precision: 60, critDmg: 150 },
};
const HOUR = 3600 * 1000;

/** Massimi per rarità dalla configurazione del gioco. */
function capsFromConfig(cfg) {
  const items = cfg?.items;
  if (!items) return CAPS_FALLBACK;
  const out = {};
  for (const r of RARITIES) {
    const c = { ...CAPS_FALLBACK[r] };
    for (const it of Object.values(items)) {
      if (it?.rarity !== r || !it.dynamicStats) continue;
      const ds = it.dynamicStats;
      if (it.type === 'weapon' && ds.attack) { c.attack = ds.attack[1]; c.crit = ds.criticalChance?.[1] ?? c.crit; }
      if (/^gloves/.test(it.code || '') && ds.precision) c.precision = ds.precision[1];
      if (/^helmet/.test(it.code || '') && ds.criticalDamages) c.critDmg = ds.criticalDamages[1];
    }
    out[r] = c;
  }
  return out;
}

/** Riduce la risposta di getUserById a quello che serve (≈ 100 byte). */
function compactPlayer(u, now = Date.now()) {
  const s = u?.skills;
  if (!s?.attack || !s.health) return null;
  const b = u.buffs || {};
  const on = (b.buffCodes || []).includes('cocain') ? Date.parse(b.buffEndAt || '') || 0 : 0;
  const down = (b.debuffCodes || []).includes('cocain') ? Date.parse(b.debuffEndAt || '') || 0 : 0;
  return {
    at: now,
    atk: s.attack.value || 0,
    wpn: s.attack.weapon || 0,
    mr: (s.attack.militaryRankPercent || 0) / 100,
    ammo: AMMO[u.equipment?.ammo] || 0,
    prec: (s.precision?.value || 0) + (s.precision?.strategic || 0),
    precEq: s.precision?.equipment || 0,
    crit: s.criticalChance?.value || 0,
    critW: s.criticalChance?.weapon || 0,
    cd: s.criticalDamages?.value || 0,
    cdEq: s.criticalDamages?.equipment || 0,
    hpTot: s.health.total || 0, hpCur: s.health.currentBarValue || 0, hpReg: s.health.hourlyBarRegen || 0,
    huTot: s.hunger?.total || 0, huCur: s.hunger?.currentBarValue || 0, huReg: s.hunger?.hourlyBarRegen || 0,
    on: on > now ? on : 0,
    down: down > now ? down : 0,
  };
}

/** Danno atteso per colpo col tetto della rarità (null = nessun tetto). */
function hitOf(p, cap) {
  const W = cap ? Math.min(p.wpn, cap.attack) : p.wpn;
  const WC = cap ? Math.min(p.critW, cap.crit) : p.critW;
  const PE = cap ? Math.min(p.precEq, cap.precision) : p.precEq;
  const CE = cap ? Math.min(p.cdEq, cap.critDmg) : p.cdEq;
  const atk = (p.atk + W) * (1 + p.mr) * (1 + p.ammo);
  const prec = Math.min(1, (p.prec + PE) / 100);
  const crit = Math.min(1, (p.crit + WC) / 100);
  return atk * (0.5 + 0.5 * prec + prec * crit * (p.cd + CE) / 100);
}

/** Pillola fra le ore `a` e `b` (contate dalla lettura `readAt`), con chi
 *  può pillarsi che lo fa appena può: moltiplicatore in `a` e media su [a, b]. */
function pillWindow(p, readAt, a, b) {
  const segs = [];             // [inizio, fine, moltiplicatore] in ore dalla lettura
  let t = 0;
  if (p.on > readAt) {
    const e = (p.on - readAt) / HOUR;
    segs.push([0, e, 1 + PILL.pct], [e, e + PILL.debuffH, 1 - PILL.pct]);
    t = e + PILL.debuffH;
  } else if (p.down > readAt) {
    const e = (p.down - readAt) / HOUR;
    segs.push([0, e, 1 - PILL.pct]);
    t = e;
  }
  while (t < b) {
    segs.push([t, t + PILL.buffH, 1 + PILL.pct], [t + PILL.buffH, t + PILL.buffH + PILL.debuffH, 1 - PILL.pct]);
    t += PILL.buffH + PILL.debuffH;
  }
  let area = 0;
  for (const [x, y, m] of segs) area += Math.max(0, Math.min(y, b) - Math.max(x, a)) * m;
  const at = segs.find(([x, y]) => a >= x && a < y);
  return { start: at ? at[2] : 1, avg: b > a ? area / (b - a) : 1 };
}

/** Capacità di un giocatore a barre piene, senza pillole: danno in H ore. */
function playerCapacity(p, cap) {
  const hit = hitOf(p, cap);
  const meal = FOOD * p.hpTot;
  return ((p.hpTot + p.huTot * meal + (p.hpReg + p.huReg * meal) * H) / HEALTH_COST) * hit;
}

/**
 * Quanto può ancora fare un giocatore in una battaglia iniziata (o che
 * inizia) a `start`: la finestra è [start, start + H], e conta solo la parte
 * da `now` in poi — il danno già fatto è nel punteggio. Una battaglia tirata
 * oltre le H ore ha davanti almeno un altro round (MIN_LEFT_H).
 * Vita e fame sono quelle lette a `p.at`; se la finestra parte dopo, nel
 * frattempo si rigenerano (fino al massimo).
 */
const MIN_LEFT_H = 6;
function playerCapacityIn(p, cap, start, now = Date.now()) {
  const hit = hitOf(p, cap);
  const meal = FOOD * p.hpTot;
  const from = Math.max(now, start);
  const end = Math.max(start + H * HOUR, now + MIN_LEFT_H * HOUR);
  const gap = Math.max(0, (from - p.at) / HOUR);
  const hp = Math.min(p.hpTot, p.hpCur + p.hpReg * gap);
  const hu = Math.min(p.huTot, p.huCur + p.huReg * gap);
  const a = (from - p.at) / HOUR, b = (end - p.at) / HOUR;
  const pill = pillWindow(p, p.at, a, b);
  const burst = (hp + hu * meal) / HEALTH_COST * hit * pill.start;
  const flow = (p.hpReg + p.huReg * meal) * (b - a) / HEALTH_COST * hit * pill.avg;
  return burst + flow;
}

/** Ora d'inizio di una battaglia dal suo id (i primi 4 byte di un ObjectId
 *  sono i secondi della creazione: 6b045898 = 23/11 15:15:36 UTC, come il
 *  `createdAt`). Zero richieste. */
function battleStart(id) {
  return /^[a-f0-9]{24}$/.test(id || '') ? parseInt(id.slice(0, 8), 16) * 1000 : null;
}

module.exports = { H, FOOD, capsFromConfig, compactPlayer, playerCapacity, playerCapacityIn, battleStart, hitOf, CAPS_FALLBACK };
