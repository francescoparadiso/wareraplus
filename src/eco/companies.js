/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: scheda Aziende (v0.27)
   ------------------------------------------------------------------
   Prende il posto di Lavoratori e Assunzioni, che con la v0.27 non hanno
   più un oggetto: niente mercato del lavoro, e i dipendenti non si vedono
   da fuori (vedi account.js). Qui si risponde a UNA domanda per azienda:
   i dipendenti rendono più di quanto costano?

   ── IL CONTO ─────────────────────────────────────────────────────────
     valore del punto  v = (prezzo − materie prime) / punti per unità
                           × (1 + bonus/100)        (gameData.getNetPerPoint)
     costo del punto   c = salari pagati / punti dei dipendenti
     margine/giorno      = (punti dipendenti × v − salari) / giorni

   su una FINESTRA di giorni interi (UTC, oggi escluso: è a metà e
   sembrerebbe un crollo). Motore automatico e lavoro del proprietario si
   contano a parte: non costano salario, e il secondo è tempo del
   giocatore, non dell'azienda.

   ── PERCHÉ IL COSTO PER PUNTO E NON IL SALARIO ──────────────────────
   Misurato su apidev (2026-10-23): il salario è fisso a ORA di lavoro, non
   a punto. Un'azienda d'acciaio pagava ~5 al giorno sia producendo 25 punti
   sia 120: il costo per punto è sceso da 0,099 a 0,040 mentre il
   dipendente migliorava. E quando un giorno si lavora meno ore (21 ottobre:
   −40% su tutte le aziende dello stesso giocatore) calano INSIEME punti e
   salari, e il rapporto resta fermo. Quindi:
     · c (o il suo inverso, punti per moneta) misura la QUALITÀ dei
       dipendenti, al netto delle ore lavorate → è il segnale di tendenza;
     · un giorno con punti E salari a zero è un giorno in cui non ha
       lavorato nessuno ("se non paghi l'ora intera, quell'ora non lavora
       nessuno", note v0.27).

   ── LA ROSA (dal 2026-10-28) ────────────────────────────────────────
   Fino al 2026-10-27 qui c'era scritto cosa NON si poteva dire: quanti
   dipendenti ci sono, chi rende e chi no, la loro felicità. Con
   `employee.getCompanyRoster` (vedi account.js) si può, dipendente per
   dipendente:
     margine/ora = punti/ora stimati × v − salario/ora
   e lo stesso a livello d'azienda con `hourly` (che è la loro somma, più
   il costo del manager). Sono numeri "a pieno regime", tutte le ore
   pagate: il misurato qui sopra resta il conto vero, e di solito è più
   basso (ore non pagate, rosa cambiata nella settimana, felicità che è
   scesa). Per questo i due stanno accanto e non si sostituiscono.

   Gli avvisi della rosa sono fatti, non stime: probabilità di dimissioni
   (`quitChance` del gioco), data in cui chiede la pensione (`retireAskAt`),
   attrezzo rotto o quasi consumato, felicità che toglie produzione,
   addestramento ancora disponibile oggi.
   ══════════════════════════════════════════════════════════════ */

import { shareBelow } from '../shared/employeeBench.js';

/** Giorni interi su cui si fa il conto (la "settimana"). */
export const WINDOW_DAYS = 7;
/** Giorni recenti confrontati col resto della finestra per la tendenza. */
const RECENT_DAYS = 3;
/** Variazione di punti-per-moneta oltre la quale si segnala una tendenza. */
const TREND_THRESHOLD = 0.10;
/** Pensione "vicina": entro quanti giorni la si segnala. */
const RETIRE_SOON_DAYS = 3;
/** Attrezzo "quasi consumato": sotto questa frazione dello stato massimo. */
const TOOL_WORN_FRACTION = 0.15;
/** Felicità che pesa: un malus di produzione da questa soglia in giù (%). */
const UNHAPPY_PCT = -5;

/* Attrezzi: gameConfig dice quanto dà ogni livello (`dynamicStats.production`,
   uguale per le sei famiglie: livello 1 +3–6%, … livello 6 +46–65%), ma NON
   quale famiglia serve a quale prodotto, e attrezzi e cassette non sono in
   vendita (isTradable false, niente prezzo). Quindi al dipendente senza
   attrezzo si dice solo quanti punti in più darebbe uno di livello 1, e la
   famiglia la si nomina soltanto se un collega con lo stesso prodotto ne
   ha già uno: visto, non indovinato. */
function toolTier1Range(gameConfig) {
  const items = gameConfig?.items || {};
  const t1 = Object.values(items).find(x => x?.type === 'tool' && /1$/.test(x.code) && x.dynamicStats?.production);
  return t1 ? t1.dynamicStats.production : null;
}

function toolFamiliesByItem(companies) {
  const out = {};
  for (const oc of companies) {
    for (const e of oc.roster?.employees || []) {
      if (e.tool?.code && !out[oc.itemCode]) out[oc.itemCode] = e.tool.code.replace(/\d+$/, '');
    }
  }
  return out;
}

/** Conti e avvisi di un dipendente, al valore del punto `value`.
 *  `ref` = i percentili mondiali della sua risorsa (shared/employeeBench.js),
 *  o null: senza, il confronto col mondo semplicemente non c'è. */
function staffMember(e, value, now, tool, ref) {
  const marginHour = e.pointsHour * value - e.wageHour;
  const costPerPoint = e.pointsHour > 0 ? e.wageHour / e.pointsHour : null;
  // Quota dei dipendenti del mondo, stessa risorsa, che costano MENO di lui
  // per punto: 80 = "costa più dell'80%".
  const costRank = ref && costPerPoint != null ? shareBelow(costPerPoint, ref.cost, ref.ps) : null;
  const happinessPct = e.bonusParts.find(p => p.source === 'happiness')?.pct ?? 0;
  const retireMs = e.retireAt ? Date.parse(e.retireAt) - now : null;
  const flags = [];
  if (value > 0 && marginHour < 0) flags.push('loss');
  if (e.quitChance > 0) flags.push('quit');
  if (retireMs != null && retireMs <= RETIRE_SOON_DAYS * 86400000) flags.push('retire');
  if (e.tool && (e.tool.broken || !e.tool.usable)) flags.push('toolBroken');
  else if (e.tool && e.tool.state / e.tool.maxState < TOOL_WORN_FRACTION) flags.push('toolWorn');
  if (happinessPct <= UNHAPPY_PCT) flags.push('unhappy');
  if (e.trainable) flags.push('trainable');
  // Il guadagno è sulla BASE, come la Gestione: le voci si sommano.
  const noTool = !e.tool && tool.range
    ? { family: tool.family, minDay: e.rawHourly * 24 * tool.range[0] / 100, maxDay: e.rawHourly * 24 * tool.range[1] / 100 }
    : null;
  if (noTool) flags.push('noTool');
  return {
    ...e,
    noTool,
    marginHour,
    costPerPoint,
    costRank,
    happinessPct,
    retireInDays: retireMs != null ? retireMs / 86400000 : null,
    flags,
  };
}

/** La rosa dell'azienda con i conti, o null se non è arrivata. */
function staffOf(roster, value, now, tool, ref) {
  if (!roster) return null;
  const members = roster.employees.map(e => staffMember(e, value, now, tool, ref))
    .sort((a, b) => a.marginHour - b.marginHour);
  const count = flag => members.filter(m => m.flags.includes(flag)).length;
  return {
    members,
    count: members.length,
    cap: roster.cap,
    pointsHour: roster.production,
    wageHour: roster.wageCost,
    managerHour: roster.managerCost,
    // A pieno regime: tutte le ore pagate, la rosa di adesso.
    fullMarginDay: (roster.production * value - roster.wageCost - roster.managerCost) * 24,
    // Punti l'ora senza bonus, sommati: è la base su cui la Gestione
    // aggiunge il suo 2% per punto (skills.js). Il gioco dà lo stesso
    // numero, arrotondato a due decimali, con employee.getManagerPointValue.
    rawHourly: members.reduce((s, m) => s + m.rawHourly, 0),
    losing: count('loss'),
    quitting: count('quit'),
    retiring: count('retire'),
    tools: count('toolBroken') + count('toolWorn'),
    unhappy: count('unhappy'),
    trainable: count('trainable'),
  };
}

function todayUtc() { return new Date().toISOString().slice(0, 10); }

function sum(days, field) { return days.reduce((s, d) => s + (Number(d[field]) || 0), 0); }

/** Punti dei dipendenti per moneta di salario, su un gruppo di giorni. */
function pointsPerCoin(days) {
  const w = sum(days, 'wage');
  return w > 0 ? sum(days, 'employeeProd') / w : null;
}

/**
 * @param gd  makeGameData(...)
 * @param companies  loadOwnedCompanies(...)
 * @param {{today?: string, now?: number, bench?: object}} [opts]  `today`
 *   (YYYY-MM-DD, UTC) e `now` (ms) solo per i test; `bench` = i riferimenti
 *   mondiali (shared/employeeBench.js: loadEmployeeBenchmarks), o null
 */
export function computeCompanies(gd, companies, { today = todayUtc(), now = Date.now(), bench = null } = {}) {
  const tier1 = toolTier1Range(gd.gameConfig);
  const families = toolFamiliesByItem(companies);
  const refOf = (code) => {
    const it = bench?.items?.[code];
    return it?.cost ? { cost: it.cost, ps: bench.percentiles, n: it.n } : null;
  };
  const rows = companies.map(oc => {
    const value = gd.getNetPerPoint(oc.itemCode, oc.bonus);
    const staff = staffOf(oc.roster, value, now, { range: tier1, family: families[oc.itemCode] || null }, refOf(oc.itemCode));
    const days = (oc.stats || [])
      .filter(d => d?.dailyDate && d.dailyDate < today)
      .sort((a, b) => (a.dailyDate < b.dailyDate ? -1 : 1));
    const win = days.slice(-WINDOW_DAYS);
    const n = win.length;

    const empPoints = sum(win, 'employeeProd');
    const wages = sum(win, 'wage');
    const enginePoints = sum(win, 'automatedEngine');
    const selfPoints = sum(win, 'selfWork');

    const perDay = x => (n ? x / n : 0);
    const recentWin = win.slice(-RECENT_DAYS);
    const employees = {
      pointsDay: perDay(empPoints),
      // Gli ultimi RECENT_DAYS giorni: con la rosa, skills.js pesa la
      // Gestione su questi e non sulla settimana, che può ancora contenere
      // i giorni prima delle assunzioni (vedi la testata di skills.js).
      recentPointsDay: recentWin.length ? sum(recentWin, 'employeeProd') / recentWin.length : 0,
      wageDay: perDay(wages),
      costPerPoint: empPoints > 0 ? wages / empPoints : null,
      marginDay: perDay(empPoints * value - wages),
    };
    // Senza statistiche il motore vale comunque quello che dice la config.
    const engineDay = (n ? perDay(enginePoints) : oc.engineDailyProd) * value;
    const selfPointsDay = perDay(selfPoints);
    const selfDay = selfPointsDay * value;

    // ── Segnali ──
    const signals = [];
    if (!oc.stats) signals.push({ kind: 'noStats' });
    if (oc.disabled) signals.push({ kind: 'disabled' });
    if (oc.isFull) signals.push({ kind: 'full' });
    if (value <= 0) signals.push({ kind: 'negValue' });
    const hadEmployees = empPoints > 0;
    if (n && !hadEmployees) signals.push({ kind: 'noEmployees', days: n });
    if (hadEmployees && value > 0 && wages > empPoints * value) signals.push({ kind: 'loss' });
    if (hadEmployees) {
      const idle = win.filter(d => !(Number(d.employeeProd) > 0) && !(Number(d.wage) > 0)).length;
      if (idle) signals.push({ kind: 'idle', days: idle });
      const recent = win.slice(-RECENT_DAYS);
      const before = win.slice(0, -RECENT_DAYS);
      const pNow = pointsPerCoin(recent), pBefore = pointsPerCoin(before);
      if (pNow != null && pBefore != null && pBefore > 0) {
        const change = pNow / pBefore - 1;
        if (change <= -TREND_THRESHOLD) signals.push({ kind: 'down', pct: -change * 100 });
        else if (change >= TREND_THRESHOLD) signals.push({ kind: 'up', pct: change * 100 });
      }
    }
    // Dalla rosa: uno per tipo, col numero di dipendenti coinvolti. Il
    // dettaglio (chi, quando) sta nella riga del dipendente. "Addestrabile
    // oggi" resta solo lì: varrebbe per quasi ogni azienda ogni giorno, e
    // un segnale sempre acceso smette di essere letto.
    if (staff && !oc.disabled) {
      if (staff.losing) signals.push({ kind: 'empLoss', n: staff.losing });
      if (staff.quitting) signals.push({ kind: 'quit', n: staff.quitting });
      if (staff.retiring) signals.push({ kind: 'retire', n: staff.retiring });
      if (staff.tools) signals.push({ kind: 'tool', n: staff.tools });
      if (staff.unhappy) signals.push({ kind: 'unhappy', n: staff.unhappy });
    }

    return {
      company: oc,
      value,
      days: n,
      staff,
      employees,
      engineDay,
      selfDay,
      // Punti del lavoro in proprio al giorno, MISURATI: skills.js ne
      // ricava quante azioni fa davvero il giocatore.
      selfPointsDay,
      // Quello che l'azienda rende da sola, senza il tempo del proprietario.
      passiveDay: engineDay + employees.marginDay,
      signals,
      series: days.map(d => ({
        date: d.dailyDate,
        employeeProd: Number(d.employeeProd) || 0,
        wage: Number(d.wage) || 0,
      })),
    };
  });

  rows.sort((a, b) => b.passiveDay - a.passiveDay);
  const active = rows.filter(r => !r.company.disabled);
  return {
    rows,
    windowDays: Math.max(0, ...rows.map(r => r.days)),
    employeesMarginDay: active.reduce((s, r) => s + r.employees.marginDay, 0),
    passiveDay: active.reduce((s, r) => s + r.passiveDay, 0),
    losing: rows.filter(r => r.signals.some(s => s.kind === 'loss')).length,
    // true se la rosa è arrivata per tutte: decide quale nota mostrare.
    staffKnown: rows.length > 0 && rows.every(r => r.staff),
  };
}
