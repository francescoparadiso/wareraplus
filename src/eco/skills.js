/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: ottimizzatore Competenze (v0.27)
   ------------------------------------------------------------------
   Nato come port di `warera/skills.py` di ArgusIA: entro un budget di
   punti abilità, la combinazione che rende più moneta al giorno. L'idea è
   la stessa; le abilità e il loro valore li ha cambiati la v0.27:

   · via Imprenditoria (punti rimborsati) e la paga da un lavoro altrui —
     per un altro giocatore si lavora solo da manager, che è un'altra
     scheda;
   · Energia 100 + 10/liv.: il lavoro in proprio costa 10 energia, quindi
       azioni/giorno = rigenerazione oraria (10% del massimo) × 24 / 10
                     = 0,24 × Energia                  (come prima);
   · Produzione 30 + 3/liv. = punti per azione di lavoro in proprio;
   · Gestione non limita più le assunzioni: +2% di produzione dei
     dipendenti per punto (1 → 11 punti, quindi +2% → +22%);
   · Aziende resta il tetto di aziende attive.

   ── COME SI VALUTA OGNI ABILITÀ ─────────────────────────────────────
   Tutto parte dalle aziende MISURATE (companies.js), non da una stima:

     dipendenti(azienda, Gestione G) = punti_base × (1 + 0,02·G) × v − salari
       con punti_base = punti misurati / (1 + 0,02·G_attuale)
     motore(azienda)                 = punti del motore × v
     passivo(Aziende A, G)           = somma delle A aziende migliori
     lavoro in proprio(E, P)         = 0,24 × E × P × v_migliore
       (v_migliore = il punto che vale di più fra le aziende attive; se
        nessuna rende, il lavoro in proprio vale 0)

   e si cerca su Aziende × Energia × Produzione × Gestione (0–10 l'una).
   Il salario non cambia con la Gestione: si paga a ora, non a punto
   (vedi la testata di companies.js).

   ── IL BUDGET ───────────────────────────────────────────────────────
   Il bot originale assumeva un respec completo di TUTTI i punti. Qui no:
   il budget sono i punti già messi in queste quattro abilità più quelli
   non spesi. Le abilità da combattimento non si toccano, e Leadership
   nemmeno — migliora addestramento ed eventi dei dipendenti, che non
   hanno un prezzo, e darle un valore inventato sarebbe peggio che
   lasciarla fuori dal conto. La vista lo dice.

   ⚠️ Fuori dal conto anche: l'energia che va in assunzioni e
   addestramento (10 a volta), un manager assunto (si somma alla Gestione
   del proprietario fino a +44%), e se la maggiorazione della Gestione sia
   davvero moltiplicativa sulle altre (felicità, attrezzo, anzianità sul
   prodotto): le note non lo dicono.
   ══════════════════════════════════════════════════════════════ */

export const ECO_SKILLS = ['companies', 'energy', 'production', 'management'];
const MGMT_PCT_PER_POINT = 2;

export function computeSkills(gd, me, companiesResult) {
  const gc = gd.gameConfig;
  const cost = Object.fromEntries(ECO_SKILLS.map(s => [s, gd.levelTable(s, 'totalCost')]));
  const value = Object.fromEntries(ECO_SKILLS.map(s => [s, gd.levelTable(s, 'value')]));
  const cur = Object.fromEntries(ECO_SKILLS.map(s => [s, me.skills?.[s]?.level ?? 0]));

  const energyPerAction = Number(gc.user?.energyCostPerAction) || 10;
  // Rigenerazione oraria = 10% del massimo (verificato: Energia 100 →
  // hourlyBarRegen 10). Azioni al giorno per punto di Energia.
  const actionsPerEnergy = (0.10 * 24) / energyPerAction;

  const mgmtFactor = lvl => 1 + (MGMT_PCT_PER_POINT / 100) * value.management[lvl];
  const curMgmtFactor = mgmtFactor(cur.management);

  // Solo le aziende attive con un conto: quelle disabilitate tornano in
  // gioco se il tetto Aziende sale, quindi entrano anche loro nel search.
  const rows = companiesResult.rows;
  const employeeDay = (r, lvl) => {
    const base = r.employees.pointsDay / curMgmtFactor;
    return base * mgmtFactor(lvl) * r.value - r.employees.wageDay;
  };
  const passiveAt = (lvl) => rows.map(r => r.engineDay + employeeDay(r, lvl)).sort((a, b) => b - a);
  const passiveByMgmt = Array.from({ length: 11 }, (_, m) => passiveAt(m));

  const topSum = (sorted, k) => {
    let s = 0;
    for (let i = 0; i < Math.min(k, sorted.length); i++) s += sorted[i];
    return s;
  };

  const bestSelf = rows
    .filter(r => !r.company.disabled && r.value > 0)
    .reduce((a, b) => (!a || b.value > a.value ? b : a), null);
  const selfValue = bestSelf ? bestSelf.value : 0;
  const selfDay = (le, lp) => actionsPerEnergy * value.energy[le] * value.production[lp] * selfValue;

  const spent = ECO_SKILLS.reduce((s, k) => s + cost[k][cur[k]], 0);
  const free = Number(me.leveling?.availableSkillPoints) || 0;
  const budget = spent + free;

  let best = null;
  for (let lc = 0; lc <= 10; lc++) {
    const cC = cost.companies[lc];
    if (cC > budget) break;
    const cap = Math.floor(value.companies[lc]);
    for (let lm = 0; lm <= 10; lm++) {
      const cM = cost.management[lm];
      if (cC + cM > budget) break;
      const passive = topSum(passiveByMgmt[lm], cap);
      for (let le = 0; le <= 10; le++) {
        const cE = cost.energy[le];
        if (cC + cM + cE > budget) break;
        for (let lp = 0; lp <= 10; lp++) {
          const total = cC + cM + cE + cost.production[lp];
          if (total > budget) break;
          const self = selfDay(le, lp);
          const sum = passive + self;
          if (!best || sum > best.total + 1e-9 || (Math.abs(sum - best.total) <= 1e-9 && total < best.cost)) {
            best = { levels: { companies: lc, energy: le, production: lp, management: lm }, cost: total, passive, self, total: sum };
          }
        }
      }
    }
  }

  // "Ora": le aziende attive come sono, non le migliori A — il tetto vero
  // è lo stato `disabledAt`, non un riordino che il giocatore non ha fatto.
  const curPassive = rows
    .filter(r => !r.company.disabled)
    .reduce((s, r) => s + r.engineDay + employeeDay(r, cur.management), 0);
  const curSelf = selfDay(cur.energy, cur.production);

  return {
    budget, spent, free,
    current: { levels: cur, passive: curPassive, self: curSelf, total: curPassive + curSelf },
    best,
    bestSelf,
    selfActionsDay: lvl => actionsPerEnergy * value.energy[lvl],
    capAt: lvl => value.companies[lvl],
    leadershipLevel: me.skills?.leadership?.level ?? 0,
    mgmtPct: lvl => (MGMT_PCT_PER_POINT * value.management[lvl]),
  };
}
