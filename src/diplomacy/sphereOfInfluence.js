import { state } from './state.js';
import { COLORS } from './config.js';
import { mergedSphereGroups } from '../proxy/radar.js';

// WarEra+ (2026-11-12): il CSV compilato a mano (SphereOfInfluence.csv su
// raw.githubusercontent.com) è stato TOLTO, su richiesta dell'utente: non era
// più affidabile, invecchiava senza che si vedesse. Le sfere d'influenza sono
// solo quelle del radar dei proxy (src/proxy/radar.js, calcolate dai dati
// pubblici), niente più caricamento qui: resta solo il colore della mappa.

// ==================== COLORE ====================
function _getPrimaryColor(primaryId) {
  return state.nationBaseColorMap.get(primaryId) || COLORS.DEFAULT_LAND;
}

// ==================== EXPRESSION FILL ====================
// isOriginal: true -> usa 'initialCountryId' (territori originali), false -> 'countryId' (attuali)
export function buildSphereColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const colorMap = new Map();

  // Sulla mappa entrano solo i rilevamenti dati per sicuri almeno al 75% —
  // sotto quella soglia si vedono nell'elenco del pannello con la loro
  // percentuale, e sulla mappa solo se l'utente accende il toggle "anche i
  // rilevamenti incerti". Finché il radar non ha finito (o non è
  // disponibile) non c'è nessuna sfera da disegnare.
  for (const group of mergedSphereGroups({ forMap: true })) {
    const color = _getPrimaryColor(group.primaryId);
    colorMap.set(group.primaryId, color);
    group.proxies.forEach(proxy => colorMap.set(proxy.id, color));
  }

  if (!colorMap.size) return COLORS.DEFAULT_LAND;

  const expr = isOriginal ? ['match', ['to-string', ['get', prop]]] : ['match', ['get', prop]];
  for (const [id, color] of colorMap.entries()) {
    expr.push(isOriginal ? id.toString() : id, color);
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}
