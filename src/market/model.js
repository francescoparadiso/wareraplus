/* ══════════════════════════════════════════════════════════════
   WarEra+ — Rendite di produzione: le formule, in un posto solo
   ------------------------------------------------------------------
   Funzioni pure: prendono i dati già scaricati (src/market/api.js) e
   sputano le righe della tabella. Nessuna fetch, nessun DOM — così la
   stessa riga si può ricalcolare ad ogni battuta sulla paga senza
   toccare la rete.

   LA FORMULA è quella dell'Ottimizzatore (src/eco/gameData.js:
   getNetPerPoint), qui riscritta perché deve accettare prezzi diversi da
   quelli di riferimento (la modalità "prezzo eseguibile" vende alla
   migliore domanda e compra alla migliore offerta):

     rendita/pp = (prezzo − Σ qty_MP × prezzo_MP) / punti_produzione
                  × (1 + bonus% / 100)

   IL BONUS non si ricalcola mai qui: arriva già sommato dal gioco
   (company.getRecommendedRegionIdsByItemCode), che lo scompone in
   giacimento, etica del giacimento, risorse strategiche e
   specializzazione nazionale. Vale la stessa regola scritta in
   gameData.js — mai stimarlo lato client.

   LA FEDELTA' e' l'unico pezzo di bonus che questa vista somma da se',
   e lo fa perche' non e' un fatto della REGIONE ma del RAPPORTO di lavoro:
   ogni giorno passato con lo stesso datore vale un punto percentuale di
   bonus produzione, fino al tetto dichiarato dal gioco
   (`gameConfig.worker`: oggi +1%/giorno fino a 10). E' lo stesso conto che
   fanno eco/workers.js e eco/skills.js — `bonus.total + w.fidelity` —, non
   una stima nostra.

   ⚠️ La fedelta' NON tocca la paga: il lavoratore produce gli stessi punti
   e li vende allo stesso prezzo per punto, e' il valore del punto per il
   PROPRIETARIO che sale (lo dice il gioco stesso: «questo bonus si applica
   dopo il lavoro, quindi non è conteggiato nel salario»). Quindi la
   colonna del lavoratore non si muove con lo slider, quelle tue si'.

   LE TRE TASSE di WarEra fanno tre cose diverse e non vanno mescolate:
   · `market`   — trattenuta sulla vendita: riduce il TUO ricavo, quindi
                  entra nella rendita quando l'interruttore è acceso;
   · `income`   — trattenuta sulla paga: NON tocca il tuo margine, decide
                  quanto arriva davvero in tasca al lavoratore;
   · `selfWork` — quando lavori nella tua azienda; fuori dallo scopo di
                  questa vista, che parla di aziende con dipendenti.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

/** Fedelta': quanto vale un giorno e dove si ferma. Letta dal gioco, mai
 *  scritta a mano — se WarEra ribilancia, la vista si adegua da sola. */
export function fidelityConfig(gameConfig) {
  const w = gameConfig?.worker || {};
  return {
    perDay: Number.isFinite(w.fidelityProductionBonusPercent) ? w.fidelityProductionBonusPercent : 1,
    maxDays: Number.isFinite(w.maxFidelity) ? w.maxFidelity : 10,
  };
}

/** Bonus fedelta' (in punti percentuali) dopo `days` giorni con lo stesso
 *  datore di lavoro. Oltre il tetto resta fermo. */
export function fidelityPercent(days, cfg) {
  return Math.min(Math.max(days, 0), cfg.maxDays) * cfg.perDay;
}

/** Punti produzione al giorno di un lavoratore. Stessa costante del bot
 *  originale, usata da eco/workers.js e eco/hiring.js: non duplicarla
 *  con un altro numero, sono lo stesso fatto di gioco. */
export function workerPointsPerDay(energyTotal, productionTotal) {
  return 0.24 * (Number(energyTotal) || 0) * (Number(productionTotal) || 0);
}

/** Punti/giorno che l'azienda produce da sola, per livello del motore. */
export function enginePointsPerDay(gameConfig, level = 1) {
  const lv = gameConfig?.upgradesConfig?.automatedEngine?.levels?.[String(level)];
  return lv?.stats?.dailyProd ?? 24;
}

function countryOf(regionId, regionById) {
  const region = regionById?.[regionId];
  if (!region) return null;
  return (state.nazioniGlobal || []).find(n => n._id === region.country) || null;
}

/**
 * Una riga per risorsa.
 *
 * @param {object} data      quello che ritorna loadMarketData()
 * @param {object} opts
 *   - execPrices: true = vendo alla migliore domanda e compro alla
 *     migliore offerta (prezzo eseguibile); false = prezzo di
 *     riferimento di mercato per tutti e due i lati.
 *   - netMarketTax: sottrae la tassa di mercato del paese della regione.
 *   - wage: paga LORDA offerta, in oro per punto produzione.
 *   - workerPpDay: punti/giorno del lavoratore di riferimento.
 *   - days: giorni che quel lavoratore ha passato con te (bonus fedelta').
 */
export function buildRows(data, opts) {
  const { gameConfig, items, prices, book, regionsByItem, regionById } = data;
  const {
    execPrices = false, netMarketTax = false, wage = 0, workerPpDay = 0, days = 0,
  } = opts || {};
  const fidCfg = fidelityConfig(gameConfig);
  const fidelity = fidelityPercent(days, fidCfg);

  const sellPriceOf = code => {
    if (!execPrices) return prices[code] ?? null;
    return book?.[code]?.bid ?? prices[code] ?? null;
  };
  const buyPriceOf = code => {
    if (!execPrices) return prices[code] ?? null;
    return book?.[code]?.ask ?? prices[code] ?? null;
  };

  return items.map(code => {
    const item = gameConfig.items[code];
    const pp = item.productionPoints;
    const needs = item.productionNeeds || null;

    const sell = sellPriceOf(code);
    const materials = needs
      ? Object.entries(needs).map(([raw, qty]) => ({
        code: raw, qty, price: buyPriceOf(raw), cost: qty * (buyPriceOf(raw) ?? 0),
      }))
      : [];
    const rawCost = materials.reduce((s, m) => s + m.cost, 0);

    const regions = (regionsByItem[code] || []).map(r => {
      const country = countryOf(r.regionId, regionById);
      return {
        ...r,
        regionName: regionById?.[r.regionId]?.name || null,
        countryId: country?._id || null,
        countryName: country?.name || null,
        // La tassa che il gioco allega alla raccomandazione è quella sul
        // reddito (verificato: combacia con country.taxes.income).
        incomeTax: r.taxPercent ?? country?.taxes?.income ?? 0,
        marketTax: country?.taxes?.market ?? 0,
      };
    });
    const best = regions[0] || null;

    // Ricavo netto per unità. La tassa di mercato è del paese in cui
    // vendi: qui si assume che vendi dove produci, che è il caso normale.
    const marketTax = netMarketTax ? (best?.marketTax || 0) : 0;
    const netUnit = (sell == null ? 0 : sell * (1 - marketTax / 100)) - rawCost;

    const basePerPoint = netUnit / pp;                    // senza alcun bonus
    const bonus = best ? best.bonus : null;
    // Rendita al giorno `days`: bonus della regione + fedelta' maturata.
    const perPointAt = fidPct => basePerPoint * (1 + ((bonus || 0) + fidPct) / 100);
    const perPoint = bonus == null && !fidelity ? basePerPoint : perPointAt(fidelity);

    // Paga di pareggio: sopra questa, ogni punto prodotto dal dipendente
    // ti costa più di quanto rende (eco/hiring.js dice la stessa cosa).
    const breakEven = perPoint;
    const marginPerPoint = perPoint - wage;
    const ownerPerDay = workerPpDay * marginPerPoint;
    const workerGrossPerDay = workerPpDay * wage;
    const workerNetPerDay = workerGrossPerDay * (1 - (best?.incomeTax || 0) / 100);

    /* Guadagno accumulato in `days` giorni. Non è ownerPerDay × giorni: il
       primo giorno si lavora a fedeltà zero e ogni giorno dopo vale un
       punto in più, fino al tetto. Si somma giorno per giorno — sono al
       massimo qualche decina di iterazioni per riga. */
    let ownerTotal = 0;
    for (let d = 0; d < days; d++) {
      ownerTotal += workerPpDay * (perPointAt(fidelityPercent(d, fidCfg)) - wage);
    }

    const bookRow = book?.[code] || {};
    return {
      code,
      type: item.type,                 // 'raw' | 'product'
      pp,
      sell,
      refPrice: prices[code] ?? null,
      bid: bookRow.bid ?? null, bidQty: bookRow.bidQty ?? 0,
      ask: bookRow.ask ?? null, askQty: bookRow.askQty ?? 0,
      materials,
      rawCost,
      netUnit,
      basePerPoint,
      bonus,
      perPoint,
      breakEven,
      marginPerPoint,
      ownerPerDay,
      ownerTotal,
      fidelity,
      workerNetPerDay,
      marketTax: best?.marketTax ?? null,
      incomeTax: best?.incomeTax ?? null,
      best,
      regions,
    };
  });
}

/** Quantità sotto la quale il prezzo migliore non è un prezzo vero:
 *  vendere mille pezzi a un ordine da dodici non succede. */
export const THIN_BOOK_QTY = 200;

export const COLUMNS = [
  { key: 'code',        label: 'colItem',      text: true },
  { key: 'sell',        label: 'colSell',      num: true },
  { key: 'rawCost',     label: 'colRaw',       num: true },
  { key: 'pp',          label: 'colPp',        num: true },
  { key: 'basePerPoint', label: 'colBase',     num: true },
  { key: 'bonus',       label: 'colBonus',     num: true },
  { key: 'perPoint',    label: 'colYield',     num: true, primary: true },
  { key: 'region',      label: 'colRegion',    text: true },
  { key: 'incomeTax',   label: 'colTax',       num: true },
  { key: 'breakEven',   label: 'colBreakEven', num: true },
  { key: 'ownerPerDay', label: 'colYou',       num: true },
  { key: 'workerNetPerDay', label: 'colWorker', num: true },
  { key: 'ownerTotal',  label: 'colTotal',     num: true },
];

const VALUE_OF = {
  code: r => r.code,
  region: r => r.best?.regionName || '',
};

export function sortRows(rows, key, dir) {
  const col = COLUMNS.find(c => c.key === key) || COLUMNS.find(c => c.primary);
  const get = VALUE_OF[col.key] || (r => r[col.key]);
  return rows.slice().sort((a, b) => {
    if (col.text) return dir * String(get(a)).localeCompare(String(get(b)), undefined, { sensitivity: 'base' });
    const x = get(a), y = get(b);
    const xv = x == null || Number.isNaN(x) ? -Infinity : x;
    const yv = y == null || Number.isNaN(y) ? -Infinity : y;
    return xv === yv ? 0 : dir * (xv - yv);
  });
}
