import { state } from './state.js';
import { COLORS } from './config.js';

function getDamageColor(value, min, max) {
  if (max === min) return COLORS.DEFAULT_LAND;
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const r = Math.round(69 + (215 - 69) * t);
  const g = Math.round(117 + (48 - 117) * t);
  const b = Math.round(180 + (39 - 180) * t);
  return `rgb(${r},${g},${b})`;
}

/**
 * Costruisce l'espressione per il colore delle regioni in base ai danni settimanali.
 * @param {boolean} isOriginal - se true, usa 'initialCountryId' invece di 'countryId'
 */
export function buildWeeklyDamageColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  let min = Infinity, max = -Infinity;
  const entries = [];

  for (const [id, nation] of state.nationMap) {
    const dmg = nation?.rankings?.weeklyCountryDamages?.value;
    if (typeof dmg === 'number' && dmg >= 0) {
      entries.push([id, dmg]);
      if (dmg < min) min = dmg;
      if (dmg > max) max = dmg;
    }
  }

  if (!entries.length) return COLORS.DEFAULT_LAND;

  const expr = ['match', ['get', prop]];
  for (const [id, dmg] of entries) {
    expr.push(id, getDamageColor(dmg, min, max));
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

/**
 * Costruisce l'espressione per il testo delle etichette (non più usata, ma mantenuta per coerenza).
 * @param {boolean} isOriginal - se true, usa 'initialCountryId' invece di 'countryId'
 */
export function buildWeeklyDamageTextExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const entries = [];
  for (const [id, nation] of state.nationMap) {
    const dmg = nation?.rankings?.weeklyCountryDamages?.value;
    if (typeof dmg === 'number' && dmg >= 0) {
      const text = dmg >= 1e6 ? (dmg / 1e6).toFixed(1) + 'M' :
                   dmg >= 1e3 ? (dmg / 1e3).toFixed(1) + 'K' :
                   String(dmg);
      entries.push([id, text]);
    }
  }

  if (!entries.length) return '';

  const expr = ['match', ['get', prop]];
  for (const [id, text] of entries) expr.push(id, text);
  expr.push('');
  return expr;
}