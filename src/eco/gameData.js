/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: formule di gioco
   ------------------------------------------------------------------
   Port di `warera/game_data.py`. `net_per_point` è la formula su cui è
   costruito tutto il resto (BOT_KNOWLEDGE.md §5):

     net_per_point = ((sellPrice − Σ rawQty×rawPrice) / productionPoints)
                     × (1 + bonus%/100)

   `bonus%` è SEMPRE il totale già calcolato server-side
   (company.getProductionBonus / getRecommendedRegionIdsByItemCode) — mai
   ricalcolato qui lato client (niente country/ethics/deposit locali).
   ══════════════════════════════════════════════════════════════ */

export function makeGameData({ gameConfig, prices }) {
  function levelTable(skillName, field) {
    const levels = gameConfig.skills[skillName].levels;
    const out = [];
    for (let i = 0; i <= 10; i++) out.push(levels[String(i)][field]);
    return out;
  }

  function getNetPerPoint(itemCode, bonusPercent) {
    const item = gameConfig.items[itemCode];
    let inputCostPerUnit = 0;
    const needs = item.productionNeeds;
    if (needs) {
      for (const [rawCode, qty] of Object.entries(needs)) {
        inputCostPerUnit += qty * prices[rawCode];
      }
    }
    const netPerUnit = prices[itemCode] - inputCostPerUnit;
    const netPerPoint = netPerUnit / item.productionPoints;
    return netPerPoint * (1 + bonusPercent / 100);
  }

  return { gameConfig, prices, levelTable, getNetPerPoint };
}
