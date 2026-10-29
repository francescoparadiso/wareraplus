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

     dipendenti(azienda, Gestione G) = P × (1 + R · 0,02 · (G − G_attuale)) × v − salari
       con P = punti misurati e R = quota dei punti che è "senza bonus"
       (vedi sotto)
     motore(azienda)                 = punti del motore × v
     passivo(Aziende A, G)           = somma delle A aziende migliori
     lavoro in proprio(E, P)         = 0,24 × E × P × v_migliore
       (v_migliore = il punto che vale di più fra le aziende attive; se
        nessuna rende, il lavoro in proprio vale 0)

   e si cerca su Aziende × Energia × Produzione × Gestione (0–10 l'una).
   Il salario non cambia con la Gestione: si paga a ora, non a punto
   (vedi la testata di companies.js).

   ── LA GESTIONE È ADDITIVA (misurato il 2026-10-28) ─────────────────
   Prima della rosa si supponeva che la Gestione moltiplicasse gli altri
   bonus: R = 1 / (1 + 0,02·G_attuale). La rosa dice di no. Ogni
   dipendente ha `productionBonus.contributions`, e la Gestione è una voce
   in percentuale ACCANTO alle altre (regione d'origine, attrezzo,
   specializzazione, tratti, felicità): punti/ora = base × (1 + somma/100).
   Un punto di Gestione aggiunge quindi il 2% della BASE, non dei punti
   già maggiorati: con un "sociable" a +50% la vecchia formula sbagliava
   di un terzo. Con la rosa R = Σ base/ora ÷ Σ punti/ora stimati, dalla
   fotografia di adesso; senza, si torna alla vecchia stima. Il gioco lo
   conferma con employee.getManagerPointValue, che vale proprio
   Σ base × 2% (arrotondato a due decimali, per questo non lo si usa).

   ── IL BUDGET ───────────────────────────────────────────────────────
   Il bot originale assumeva un respec completo di TUTTI i punti. Qui no:
   il budget sono i punti già messi in queste quattro abilità più quelli
   non spesi. Le abilità da combattimento non si toccano, e Leadership
   nemmeno — migliora addestramento ed eventi dei dipendenti, che non
   hanno un prezzo, e darle un valore inventato sarebbe peggio che
   lasciarla fuori dal conto. La vista lo dice.

   ⚠️ Fuori dal conto anche: l'energia che va in assunzioni e
   addestramento (10 a volta), un manager assunto (si somma alla Gestione
   del proprietario fino a +44%). Che la Gestione si SOMMI alle altre voci
   invece di moltiplicarle non è più un'ipotesi: vedi qui sopra.
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

  const mgmtPctAt = lvl => MGMT_PCT_PER_POINT * value.management[lvl];
  // Senza rosa: la vecchia ipotesi moltiplicativa (vedi la testata).
  const fallbackShare = 1 / (1 + mgmtPctAt(cur.management) / 100);
  const baseShare = r => (r.staff && r.staff.pointsHour > 0
    ? r.staff.rawHourly / r.staff.pointsHour
    : fallbackShare);

  // Solo le aziende attive con un conto: quelle disabilitate tornano in
  // gioco se il tetto Aziende sale, quindi entrano anche loro nel search.
  const rows = companiesResult.rows;
  const employeeDay = (r, lvl) => {
    const deltaPct = mgmtPctAt(lvl) - mgmtPctAt(cur.management);
    const points = r.employees.pointsDay * (1 + baseShare(r) * deltaPct / 100);
    return points * r.value - r.employees.wageDay;
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
    mgmtPct: mgmtPctAt,
    // true se la Gestione è stata pesata sulla rosa vera di ogni azienda.
    mgmtMeasured: rows.length > 0 && rows.every(r => r.staff && r.staff.pointsHour > 0),
  };
}
