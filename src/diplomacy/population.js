import { state } from './state.js';
import { COLORS } from './config.js';

function getPopulationColor(population, min, max) {
  if (max === min) return COLORS.DEFAULT_LAND;
  const t = Math.max(0, Math.min(1, (population - min) / (max - min)));
  const r = 255;
  const g = Math.round(255 - 102 * t);
  const b = Math.round(204 * (1 - t));
  return `rgb(${r},${g},${b})`;
}

/**
 * Costruisce l'espressione per il colore delle regioni in base alla popolazione.
 * @param {boolean} isOriginal - se true, usa 'initialCountryId' invece di 'countryId'
 */
export function buildPopulationColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  let min = Infinity;
  let max = -Infinity;
  const entries = [];

  for (const [id, nation] of state.nationMap) {
    const pop = nation?.rankings?.countryActivePopulation?.value;
    if (typeof pop === 'number' && pop > 0) {
      entries.push([id, pop]);
      if (pop < min) min = pop;
      if (pop > max) max = pop;
    }
  }

  if (!entries.length) return COLORS.DEFAULT_LAND;

  const expr = ['match', ['get', prop]];
  for (const [id, pop] of entries) {
    expr.push(id, getPopulationColor(pop, min, max));
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

export function buildPopulationTextExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const entries = [];

  for (const [id, nation] of state.nationMap) {
    const pop = nation?.rankings?.countryActivePopulation?.value;
    if (typeof pop === 'number' && pop > 0) {
      entries.push([id, pop]);
    }
  }

  // Ritorna una stringa vuota (valida) se non ci sono dati
  if (!entries.length) return '';

  const expr = ['match', ['get', prop]];
  for (const [id, pop] of entries) {
    const text = pop >= 1_000_000 ? (pop / 1_000_000).toFixed(1) + 'M' : pop.toLocaleString();
    expr.push(id, text);
  }
  expr.push(''); // default
  return expr;
}