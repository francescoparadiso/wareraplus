/* ══════════════════════════════════════════════════════════════
   WarEra+ — Entrate per tipo di governo
   ------------------------------------------------------------------
   Modulo NUOVO (2026-10-27). Quanto renderebbe al tesoro di una nazione
   ciascun tipo di governo, a dati di adesso, e quante tasse le servono
   perché la Plutocrazia batta la Repubblica. Idea dalla guida di
   Johnny_Sins ("Keep him or fire him?", 26 ottobre), che faceva questi
   conti a mano per una nazione alla volta.

   ZERO RICHIESTE: `income` della nazione e delle regioni arriva già con
   country.getAllCountries e region.getRegionsObject. È ORARIO (vedi
   productionHeatmap.js): qui tutto si porta al giorno.

   `income.govType` è l'EFFETTO del governo attuale sul totale, quindi
   `total − govType` è la nazione senza governo, e da lì si applicano le
   regole degli altri tipi. ⚠️ La config del gioco non le contiene: sono
   quelle delle note del rilascio, verificate il 2026-10-27 sulle nazioni
   che quel tipo lo hanno già (17 su 17, scarto massimo 0,04 oro/giorno):
     · Repubblica      + sviluppo delle regioni PROPRIE (cioè ×2), meno
                       lo sviluppo delle regioni conquistate (che non
                       rendono più niente)
     · Plutocrazia     + 50% delle risorse strategiche, + 40% delle tasse
                       su salari e manager
     · Autocrazia      + 25% dello sviluppo
     · Stato nazion.   − 30% dello sviluppo
     · Federazione, Fronte patriottico, Stato mercenario, Provvisorio:
                       nessun effetto sulle entrate (`govType` = 0 su
                       tutte le 44 nazioni che li hanno)
   Proprie/conquistate: `country` contro `initialCountry` della regione.

   ⚠️ Punto aperto: la Repubblica con regioni conquistate. Al 27 ottobre le
   due Repubbliche non ne hanno, quindi "le conquistate non rendono" è solo
   la regola delle note. Non è chiaro se perdano anche la rendita delle
   risorse strategiche (la guida di Johnny_Sins sembra di sì): qui no, e
   l'interfaccia lo dichiara. Il controllo qui sotto lo risolve da solo
   appena una Repubblica conquista.

   CONTROLLO: per il tipo che la nazione ha davvero, il modello si confronta
   con `income.govType`. Se non torna, quella riga mostra il numero del
   gioco e lo dice (`check: 'mismatch'`): una regola cambiata in una patch
   non deve diventare un numero sbagliato detto con sicurezza.
   ══════════════════════════════════════════════════════════════ */

/** I tipi con un effetto sulle entrate, in ordine di lettura. */
export const GOV_INCOME_TYPES = ['republic', 'plutocracy', 'autocracy', 'nationalistState'];
/** Quelli che sulle entrate non fanno niente. */
export const GOV_NEUTRAL_TYPES = ['federation', 'homelandFront', 'mercenaryState'];

const PLUTO_STRATEGIC = 0.5;
const PLUTO_TAX = 0.4;
const AUTOCRACY_DEV = 0.25;
const NATIONALIST_DEV = -0.3;

// Tolleranza del controllo, oraria: arrotondamenti del gioco a 4 decimali.
const CHECK_ABS = 0.01;
const CHECK_REL = 0.01;

const num = (v) => (Number.isFinite(v) ? v : 0);

/** Effetto orario di un tipo, dalle voci senza governo. */
function effectOf(type, v) {
  switch (type) {
    case 'republic': return v.ownDev - v.conqDev;
    case 'plutocracy': return PLUTO_STRATEGIC * v.strategic + PLUTO_TAX * v.tax;
    case 'autocracy': return AUTOCRACY_DEV * v.dev;
    case 'nationalistState': return NATIONALIST_DEV * v.dev;
    default: return 0;
  }
}

/**
 * Il confronto per una nazione. Null senza `income` (prima della v0.27) o
 * senza regioni in memoria: la Repubblica non si calcola senza sapere quali
 * regioni sono proprie. Tutti i valori sono al giorno.
 *
 * @returns {null | {
 *   base: number, current: string|null, currentEffect: number,
 *   rows: Array<{type, effect, total, vsNow, isCurrent, check, best}>,
 *   pluto: { threshold: number, tax: number, reached: boolean, free: boolean },
 *   conquered: { count: number, dev: number },
 * }}
 */
export function govIncomeModel(nation, regionData) {
  const inc = nation?.income;
  if (!inc || !regionData) return null;
  const id = nation._id;

  let ownDev = 0, conqDev = 0, conqCount = 0;
  for (const r of Object.values(regionData)) {
    if (r?.country !== id) continue;
    const d = num(r.income?.development);
    if (r.initialCountry === id) ownDev += d;
    else { conqDev += d; conqCount++; }
  }

  const v = {
    dev: num(inc.development),
    strategic: num(inc.strategicResourcesBonus),
    tax: num(inc.employeeIncomeTax) + num(inc.managerIncomeTax),
    ownDev, conqDev,
  };
  const actual = num(inc.govType);
  const base = num(inc.total) - actual;
  const current = nation.govType || null;

  const rows = GOV_INCOME_TYPES.map(type => {
    const model = effectOf(type, v);
    const isCurrent = type === current;
    let check = null;
    let effect = model;
    if (isCurrent) {
      check = Math.abs(model - actual) <= Math.max(CHECK_ABS, CHECK_REL * Math.abs(actual)) ? 'ok' : 'mismatch';
      effect = actual;
    }
    return { type, effect: effect * 24, total: (base + effect) * 24, vsNow: (effect - actual) * 24, isCurrent, check };
  });
  const top = rows.reduce((a, b) => (b.effect > a.effect ? b : a));
  for (const r of rows) r.best = r === top && r.effect > 0;

  // Plutocrazia contro Repubblica: 0,5·S + 0,4·T > proprie − conquistate.
  const repEffect = rows.find(r => r.type === 'republic').effect / 24;
  const threshold = Math.max(0, (repEffect - PLUTO_STRATEGIC * v.strategic) / PLUTO_TAX);

  return {
    base: base * 24,
    current,
    currentEffect: actual * 24,
    rows,
    pluto: { threshold: threshold * 24, tax: v.tax * 24, reached: v.tax >= threshold, free: threshold === 0 },
    conquered: { count: conqCount, dev: conqDev * 24 },
  };
}
