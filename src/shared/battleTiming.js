/* ══════════════════════════════════════════════════════════════
   WarEra+ — Quando finisce un round, e quando la battaglia
   ------------------------------------------------------------------
   Nato nella lavagna delle Operazioni (src/private/operazioni.js) e
   spostato qui quando è servito anche alla sezione Battaglie e ai marker
   della mappa: un calcolo solo, perché tre stime diverse della stessa
   battaglia sarebbero peggio di nessuna.

   ── COME FINISCE UN ROUND ─────────────────────────────────────────
   Non a tempo: lo vince chi arriva a 300 punti
   (gameConfig.battle.pointsToWinRound). Ogni 120 secondi c'è un TICK e
   i suoi punti vanno a chi sta facendo più danno in quel momento. Un tick
   vale di più più il round è avanti: 1 punto finché il TOTALE assegnato
   (i due lati sommati) è sotto 100, 2 da 100, 3 da 200… fino a 6
   (battle.tickPoints). ⚠️ La soglia è sul totale, non sul numero del
   tick: lo dice il gioco stesso ("100+ totale = 2 terreno per tick").

   Il dato c'è già senza chiamate: battle.getBattles (e quindi /battles
   del server di cache) porta `currentRound` con i punti dei due lati e
   `live` con i tick contati e il prossimo tick.

   ── COSA SI STIMA ─────────────────────────────────────────────────
   Per ciascun lato, quando vincerebbe il round se prendesse TUTTI i tick
   da qui — esattamente i due "~2h36m / ~2h44m" che il gioco mostra ai
   lati del timer (verificato il 22/10/2026: stesso numero al minuto).
   La battaglia la vince chi arriva a `roundsToWin` round: la forchetta va
   da "chi è avanti vince tutti i round che mancano" a "si va fino
   all'ultimo round", ogni round nuovo alla sua durata minima (~6 h 40).
   Sono stime "al più presto": un round conteso dura di più, e nessuno
   può sapere quanto.
   ══════════════════════════════════════════════════════════════ */

import { getLang } from './i18n.js';

const ORA = 3600_000;
const PUNTI_ROUND = 300;
const PUNTI_TICK = [[500, 6], [400, 5], [300, 4], [200, 3], [100, 2], [1, 1]];
const TICK_DI_RIPIEGO_MS = 2 * 60_000;
// Senza i dati del round (una risposta vecchia, un ripiego) si torna alla
// regola grossolana delle 6 ore dall'inizio del round.
const ROUND_DI_RIPIEGO_MS = 6 * ORA;

const puntiDelTick = (totale) => PUNTI_TICK.find(([da]) => totale >= da)?.[1] || 1;

/** Quanti tick servono a un lato con `mio` punti, se li prende tutti,
 *  quando l'altro ne ha `altro`. */
function tickMancanti(mio, altro) {
  let p = mio, k = 0;
  while (p < PUNTI_ROUND && k < 5000) { p += puntiDelTick(p + altro); k++; }
  return k;
}

/**
 * @param {object} b  battaglia grezza, come da battle.getBattles / /battles
 * @returns {{ round, a, d, pa, pd, fineRound, finePerLato, prima, ultima }}
 *   a/d round vinti, pa/pd punti nel round, finePerLato.{attacker,defender}
 *   null se manca il dato dei tick. Tutti gli istanti in ms.
 */
export function stimaBattaglia(b) {
  const R = b?.roundsToWin || 2;
  const a = b?.attacker?.wonRoundsCount || 0, d = b?.defender?.wonRoundsCount || 0;
  const cr = (b && typeof b.currentRound === 'object' && b.currentRound) || {};
  const inizio = Date.parse(cr.createdAt || b?.createdAt);
  const tick = cr.live?.ticksCount;
  const prossimo = Date.parse(cr.live?.nextTickAt || '');
  const pa = cr.attacker?.points || 0, pd = cr.defender?.points || 0;
  let fineRound, roundMinimo, finePerLato = null;
  if (Number.isFinite(tick) && Number.isFinite(prossimo) && Number.isFinite(inizio)) {
    const passo = (prossimo - inizio) / (tick + 1);
    const intervallo = passo >= 30_000 && passo <= 10 * 60_000 ? passo : TICK_DI_RIPIEGO_MS;
    finePerLato = {
      attacker: prossimo + (tickMancanti(pa, pd) - 1) * intervallo,
      defender: prossimo + (tickMancanti(pd, pa) - 1) * intervallo,
    };
    fineRound = Math.min(finePerLato.attacker, finePerLato.defender);
    roundMinimo = tickMancanti(0, 0) * intervallo;
  } else {
    fineRound = (Number.isFinite(inizio) ? inizio : Date.now()) + ROUND_DI_RIPIEGO_MS;
    roundMinimo = ROUND_DI_RIPIEGO_MS;
  }
  const minimi = Math.max(1, R - Math.max(a, d));
  const massimi = Math.max(1, (R - a) + (R - d) - 1);
  return {
    round: cr.number || a + d + 1, a, d, pa, pd, fineRound, finePerLato,
    prima: fineRound + (minimi - 1) * roundMinimo,
    ultima: fineRound + (massimi - 1) * roundMinimo,
  };
}

/** "2h33", "45 min": la stessa forma breve del gioco. */
export function fraQuanto(ms) {
  const min = Math.max(0, Math.round((ms - Date.now()) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/** "20:30" oggi, "23/10 20:30" un altro giorno. */
export function oraCorta(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return hm;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${hm}`;
}

// Le due righe che sezione Battaglie e marker scrivono uguali.
const DICT = {
  en: { round: 'Round {n} ({pa}–{pd} pts): attacker ~{att}, defender ~{dif}', battle: 'Battle ends {da}–{a}', battleOne: 'Battle ends {da}', hint: 'Earliest times, if one side takes every 2-minute tick' },
  it: { round: 'Round {n} ({pa}–{pd} punti): attaccante ~{att}, difensore ~{dif}', battle: 'Fine battaglia {da}–{a}', battleOne: 'Fine battaglia {da}', hint: 'Tempi al più presto, se un lato prende tutti i tick da 2 minuti' },
  es: { round: 'Ronda {n} ({pa}–{pd} pts): atacante ~{att}, defensor ~{dif}', battle: 'Fin de la batalla {da}–{a}', battleOne: 'Fin de la batalla {da}', hint: 'Tiempos más tempranos, si un lado gana cada tick de 2 minutos' },
  de: { round: 'Runde {n} ({pa}–{pd} Pkt): Angreifer ~{att}, Verteidiger ~{dif}', battle: 'Schlachtende {da}–{a}', battleOne: 'Schlachtende {da}', hint: 'Früheste Zeiten, wenn eine Seite jeden 2-Minuten-Tick holt' },
  fr: { round: 'Manche {n} ({pa}–{pd} pts) : attaquant ~{att}, défenseur ~{dif}', battle: 'Fin de la bataille {da}–{a}', battleOne: 'Fin de la bataille {da}', hint: 'Délais au plus tôt, si un camp prend chaque tick de 2 minutes' },
  nl: { round: 'Ronde {n} ({pa}–{pd} pt): aanvaller ~{att}, verdediger ~{dif}', battle: 'Einde strijd {da}–{a}', battleOne: 'Einde strijd {da}', hint: 'Vroegste tijden, als één kant elke tick van 2 minuten pakt' },
  sv: { round: 'Rond {n} ({pa}–{pd} p): anfallare ~{att}, försvarare ~{dif}', battle: 'Striden slutar {da}–{a}', battleOne: 'Striden slutar {da}', hint: 'Tidigaste tider, om en sida tar varje tick på 2 minuter' },
  pt: { round: 'Rodada {n} ({pa}–{pd} pts): atacante ~{att}, defensor ~{dif}', battle: 'Fim da batalha {da}–{a}', battleOne: 'Fim da batalha {da}', hint: 'Tempos mais cedo, se um lado levar cada tick de 2 minutos' },
  ar: { round: 'الجولة {n} ({pa}–{pd} نقطة): المهاجم ~{att}، المدافع ~{dif}', battle: 'نهاية المعركة {da}–{a}', battleOne: 'نهاية المعركة {da}', hint: 'أقرب الأوقات، إذا أخذ طرف كل نبضة من دقيقتين' },
};

function tt(key, vars) {
  let s = DICT[getLang()]?.[key] ?? DICT.en[key];
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Le due righe di testo pronte: round (per lato) e battaglia. `round` è
 *  null se mancano i dati dei tick. */
export function righeStima(b) {
  const s = stimaBattaglia(b);
  const round = s.finePerLato
    ? tt('round', { n: s.round, pa: s.pa, pd: s.pd, att: fraQuanto(s.finePerLato.attacker), dif: fraQuanto(s.finePerLato.defender) })
    : null;
  const battaglia = s.prima === s.ultima ? tt('battleOne', { da: oraCorta(s.prima) })
    : tt('battle', { da: oraCorta(s.prima), a: oraCorta(s.ultima) });
  return { round, battaglia, nota: tt('hint', {}), stima: s };
}
