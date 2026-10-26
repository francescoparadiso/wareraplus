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

   ⚠️ Quello che NON si può dire: quanti dipendenti ci sono (la capienza
   dell'area relax è solo un tetto), chi rende e chi no, la loro felicità.
   La vista lo dichiara invece di stimarlo.
   ══════════════════════════════════════════════════════════════ */

/** Giorni interi su cui si fa il conto (la "settimana"). */
export const WINDOW_DAYS = 7;
/** Giorni recenti confrontati col resto della finestra per la tendenza. */
const RECENT_DAYS = 3;
/** Variazione di punti-per-moneta oltre la quale si segnala una tendenza. */
const TREND_THRESHOLD = 0.10;

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
 * @param {{today?: string}} [opts]  `today` (YYYY-MM-DD, UTC) solo per i test
 */
export function computeCompanies(gd, companies, { today = todayUtc() } = {}) {
  const rows = companies.map(oc => {
    const value = gd.getNetPerPoint(oc.itemCode, oc.bonus);
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
    const employees = {
      pointsDay: perDay(empPoints),
      wageDay: perDay(wages),
      costPerPoint: empPoints > 0 ? wages / empPoints : null,
      marginDay: perDay(empPoints * value - wages),
    };
    // Senza statistiche il motore vale comunque quello che dice la config.
    const engineDay = (n ? perDay(enginePoints) : oc.engineDailyProd) * value;
    const selfDay = perDay(selfPoints) * value;

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

    return {
      company: oc,
      value,
      days: n,
      employees,
      engineDay,
      selfDay,
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
  };
}
