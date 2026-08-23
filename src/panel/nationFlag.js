/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bandiera e codice ISO di una nazione
   ------------------------------------------------------------------
   Erano due funzioni private dentro countryPanel.js. Estratte qui
   quando è arrivato il pannello riassuntivo delle viste
   (viewOverview.js), che disegna le stesse righe con la stessa
   bandiera: un modulo terzo evita l'import circolare fra i due
   pannelli, che altrimenti si sarebbero importati a vicenda.

   Il codice NON si legge da nation.code e basta: in vista "Originale"
   la mappa mostra i confini di nascita, quindi il codice giusto è
   quello delle etichette originali. Da qui la lettura da
   state.labelsData / state.originalLabelsData, con nation.code come
   ripiego.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';

export function getFlagUrl(code) {
  return code ? `https://media.warera.io/images/flags/${code}.svg?v=16` : null;
}

export function getNationCode(nationId, nation) {
  const isOriginal = state.mapSource === 'original';
  const srcData = isOriginal ? state.originalLabelsData : state.labelsData;
  const label = srcData?.find(l => l.properties?.countryId === nationId);
  return label?.properties?.countryCode?.toLowerCase() || nation?.code?.toLowerCase() || '';
}

/** `<img>` della bandiera, o stringa vuota se il codice non si conosce. */
export function flagImgHtml(nationId, nation, className = 'wp-sphere-flag') {
  const url = getFlagUrl(getNationCode(nationId, nation));
  return url
    ? `<img class="${className}" src="${url}" alt="" onerror="this.style.display='none'">`
    : '';
}
