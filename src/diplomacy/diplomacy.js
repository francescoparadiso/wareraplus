// diplomacy.js
import { state } from './state.js';
import { COLORS, THEMES } from './config.js';

// ==================== NUOVA FUNZIONE PER OTTENERE TUTTI GLI ALLEATI ====================
export function getAllianceAllies(countryId) {
  const allies = new Set();
  // Solo i membri della stessa alleanza/blocco
  const allianceIds = state.nationAlliancesMap.get(countryId);
  if (allianceIds) {
    allianceIds.forEach(allianceId => {
      const alliance = state.allianceMap.get(allianceId);
      if (alliance) {
        alliance.memberCountries.forEach(m => {
          if (m.country && m.country !== countryId) allies.add(m.country);
        });
      }
    });
  }
  return [...allies];
}

export function getDefensivePactAllies(countryId) {
  const dipl = state.diplomacyData.get(countryId);
  return dipl?.defensivePacts || [];
}

// Nazioni che sono SIA alleate (stesso blocco) SIA legate da patto difensivo:
// vengono mostrate in verde (priorità all'alleanza) ma evidenziate con pattern a doppio colore.
export function getDualAllyDefensiveIds(countryId) {
  const allies = getAllianceAllies(countryId);
  const defensive = getDefensivePactAllies(countryId);
  return allies.filter(id => defensive.includes(id));
}

// ==================== HELPERS DIPLOMAZIA ====================
export function getEnemyAllies(targetId) {
  const target = state.nationMap.get(targetId);
  if (!target) return [];
  const enemies = new Set(target.warsWith || []);
  const dipl = state.diplomacyData.get(targetId);
  if (dipl?.swornEnemy) enemies.add(dipl.swornEnemy);
  const enemyAllies = new Set();
  enemies.forEach(enemyId => {
    const enemy = state.nationMap.get(enemyId);
    if (enemy) {
      getAllianceAllies(enemyId).forEach(id => {
        if (id !== targetId) enemyAllies.add(id);
      });
    }
  });
  return [...enemyAllies];
}

export function getColorForCountry(cId, directWars, directAllies, enemyAllies, styleMap) {
  const isManualNap = state.customNaps.includes(cId);
  const excludeExtNaps = document.getElementById('checkExcludeExternalNaps')?.checked || false;
  const isExternalNap = !excludeExtNaps && state.selectedCountryId && (
    state.externalNapsSet.has(`${state.selectedCountryId}-${cId}`) ||
    state.externalNapsSet.has(`${cId}-${state.selectedCountryId}`)
  );
  const isNap = isManualNap || isExternalNap;

  if (!state.selectedCountryId)        return styleMap[cId] || THEMES[state.theme].NEUTRAL_UNSELECTED;
  if (cId === state.selectedCountryId) return COLORS.SELECTED;
  if (isNap)                           return COLORS.NAP;

  const dipl = state.diplomacyData.get(state.selectedCountryId);
  const isDefensive = dipl?.defensivePacts?.includes(cId) || false;
  const isSworn = dipl?.swornEnemy === cId;

  // L'appartenenza allo stesso blocco/alleanza ha priorità sul patto difensivo:
  // una nazione alleata resta verde anche se ha anche un patto difensivo
  // (il doppio colore viene gestito separatamente via pattern overlay).
  if (isSworn)                         return COLORS.SWORN_ENEMY;
  if (directAllies.includes(cId))      return COLORS.ALLY_DIRECT;
  if (isDefensive)                     return COLORS.DEFENSIVE_PACT;

  if (directWars.includes(cId))        return COLORS.WAR_DIRECT;
  if (enemyAllies.includes(cId))       return COLORS.WAR_INDIRECT;
  return THEMES[state.theme].DEFAULT_LAND;
}

// ==================== FOCUS SU UN BLOCCO (WarEra+) ====================
// Selezionando un blocco/alleanza in modalità 'blocs', si vuole vedere la
// sua "situazione diplomatica" aggregata: tutte le nazioni con cui è in
// guerra ALMENO un membro del blocco, e tutti i patti difensivi che
// puntano FUORI dal blocco (quelli interni non sono interessanti, sono
// già alleati). Gli sworn enemy sono volutamente esclusi: sono univoci
// per singola nazione, mostrarli aggregati per blocco non avrebbe senso
// (ne uscirebbero troppi, uno diverso per membro).

export function getBlocMemberIds(allianceId) {
  const alliance = state.allianceMap.get(allianceId);
  if (!alliance) return [];
  return alliance.memberCountries.map(m => m.country).filter(Boolean);
}

export function getBlocWarTargets(allianceId) {
  const members = new Set(getBlocMemberIds(allianceId));
  const targets = new Set();
  members.forEach(memberId => {
    const nation = state.nationMap.get(memberId);
    (nation?.warsWith || []).forEach(enemyId => {
      if (!members.has(enemyId)) targets.add(enemyId);
    });
  });
  return [...targets];
}

export function getBlocExternalDefensivePacts(allianceId) {
  const members = new Set(getBlocMemberIds(allianceId));
  const targets = new Set();
  members.forEach(memberId => {
    const dipl = state.diplomacyData.get(memberId);
    (dipl?.defensivePacts || []).forEach(partnerId => {
      if (!members.has(partnerId)) targets.add(partnerId);
    });
  });
  return [...targets];
}

/**
 * Metriche guerra/alleanza tra la coppia di blocchi A/B, calcolate in
 * ENTRAMBE le direzioni (quante nazioni di B sono coinvolte guardando da
 * A, e quante di A guardando da B) — la somma delle due direzioni è per
 * costruzione la stessa indipendentemente da quale blocco la calcola,
 * garantendo che la relazione sia sempre bilaterale: se A risulta
 * alleato/in guerra con B, vale automaticamente anche il contrario.
 */
function _blocPairMetrics(allianceIdA, allianceIdB) {
  const membersA = new Set(getBlocMemberIds(allianceIdA));
  const membersB = new Set(getBlocMemberIds(allianceIdB));

  const warBFromA = new Set(); // nazioni di B in guerra con un membro di A
  membersA.forEach(a => {
    (state.nationMap.get(a)?.warsWith || []).forEach(id => { if (membersB.has(id)) warBFromA.add(id); });
  });
  const warAFromB = new Set(); // nazioni di A in guerra con un membro di B
  membersB.forEach(b => {
    (state.nationMap.get(b)?.warsWith || []).forEach(id => { if (membersA.has(id)) warAFromB.add(id); });
  });

  const allyBFromA = new Set(); // nazioni di B con patto difensivo verso un membro di A
  membersA.forEach(a => {
    (state.diplomacyData.get(a)?.defensivePacts || []).forEach(id => { if (membersB.has(id)) allyBFromA.add(id); });
  });
  const allyAFromB = new Set(); // nazioni di A con patto difensivo verso un membro di B
  membersB.forEach(b => {
    (state.diplomacyData.get(b)?.defensivePacts || []).forEach(id => { if (membersA.has(id)) allyAFromB.add(id); });
  });

  return {
    warCount: warBFromA.size,     // per la UI vista da A: quante nazioni di B sono in guerra
    allyCount: allyBFromA.size,   // per la UI vista da A: quante nazioni di B hanno un patto
    totalWar: warBFromA.size + warAFromB.size,     // bilaterale: stesso valore visto da B
    totalAlly: allyBFromA.size + allyAFromB.size,  // idem
  };
}

/**
 * Classifica ogni altro blocco rispetto al blocco dato in ESATTAMENTE
 * una delle due categorie — guerra o alleato de facto — mai entrambe:
 * si contano le nazioni coinvolte in guerra e quelle legate da patto
 * difensivo (in entrambe le direzioni, per bilateralità — vedi
 * _blocPairMetrics), e vince la categoria con il conteggio maggiore
 * ("se un blocco ha più alleanze che guerre, è de facto alleato").
 * In caso di parità (entrambi >0) la coppia non viene mostrata in
 * nessuna delle due liste: è genuinamente ambigua.
 * Sostituisce le precedenti getWarBlocs/getDefactoAlliedBlocs, che
 * potevano classificare la stessa coppia di blocchi come "in guerra" E
 * "alleata" contemporaneamente, senza alcun criterio di esclusione.
 */
export function getBlocRelations(allianceId) {
  const wars = [];
  const allies = [];
  state.allianceMap.forEach((otherAlliance, otherId) => {
    if (otherId === allianceId) return;
    const m = _blocPairMetrics(allianceId, otherId);
    if (m.totalWar === 0 && m.totalAlly === 0) return; // nessuna relazione rilevante
    if (m.totalAlly > m.totalWar) {
      allies.push({ id: otherId, name: otherAlliance.name, pactedCount: m.allyCount, memberCount: otherAlliance.memberCountries.length });
    } else if (m.totalWar > m.totalAlly) {
      wars.push({ id: otherId, name: otherAlliance.name, warCount: m.warCount, memberCount: otherAlliance.memberCountries.length });
    }
    // totalWar === totalAlly (entrambi > 0): parità, non si mostra in nessuna delle due
  });
  wars.sort((a, b) => b.warCount - a.warCount);
  allies.sort((a, b) => b.pactedCount - a.pactedCount);
  return { wars, allies };
}

/**
 * Calcola la mappa colori completa per il focus su un blocco: membri
 * (giallo), nemici in guerra (rosso), blocchi "de facto alleati" (verde,
 * vedi getBlocRelations sopra — bilaterale e mutuamente esclusivo con la
 * guerra), patti difensivi residui verso blocchi/nazioni non de-facto-
 * alleate (viola). Usata sia per colorare la mappa
 * (buildBlocFocusColorExpression) sia per colorare le ETICHETTE dei nomi
 * nazione (labels.js), che prima mostravano sempre il colore piatto del
 * proprio blocco anche quando un blocco era in focus.
 * @param {string} allianceId
 * @returns {Map<string,string>} countryId -> colore CSS
 */
export function computeBlocFocusColors(allianceId) {
  const members = new Set(getBlocMemberIds(allianceId));
  const warTargets = new Set(getBlocWarTargets(allianceId));
  const defTargetsRaw = getBlocExternalDefensivePacts(allianceId);
  const { allies: defactoAllyBlocs } = getBlocRelations(allianceId);

  const colorMap = new Map();
  members.forEach(id => colorMap.set(id, COLORS.SELECTED));
  // WarEra+ fix: i blocchi de-facto alleati vanno colorati PRIMA dei
  // singoli target in guerra. La classificazione a livello di blocco
  // (getBlocRelations confronta il TOTALE guerra vs alleanza tra i due
  // blocchi) ha priorità sullo stato individuale di una singola nazione:
  // prima, processando prima warTargets, una nazione che risultava
  // anche in guerra con un membro del blocco selezionato restava rossa
  // anche se il SUO blocco era complessivamente classificato alleato —
  // contraddicendo la classificazione aggregata mostrata nel pannello
  // ("de facto allied" ma con nazioni rosse in mappa).
  defactoAllyBlocs.forEach(({ id: blocId2 }) => {
    getBlocMemberIds(blocId2).forEach(id => { if (!colorMap.has(id)) colorMap.set(id, COLORS.ALLY_DIRECT); });
  });
  warTargets.forEach(id => { if (!colorMap.has(id)) colorMap.set(id, COLORS.WAR_DIRECT); });
  // Patti difensivi residui (verso blocchi non de-facto-alleati o verso
  // nazioni senza blocco).
  defTargetsRaw.forEach(id => { if (!colorMap.has(id)) colorMap.set(id, COLORS.DEFENSIVE_PACT); });

  return colorMap;
}

/**
 * Espressione colore per la mappa quando un blocco è in focus:
 * - membri del blocco → giallo (COLORS.SELECTED), come una nazione selezionata
 * - nazioni in guerra con almeno un membro → rosso (COLORS.WAR_DIRECT)
 * - blocchi "de facto alleati" (molti patti difensivi condivisi) → verde
 * - patti difensivi residui verso l'esterno → viola (COLORS.DEFENSIVE_PACT)
 * - tutto il resto → colore neutro di sfondo (non il colore del proprio
 *   blocco: si vuole isolare la situazione di QUESTO blocco, non

 *   confonderla con gli altri blocchi sulla mappa)
 * @param {string} allianceId
 * @param {'countryId'|'initialCountryId'} propKey
 */
export function buildBlocFocusColorExpression(allianceId, propKey) {
  const theme = THEMES[state.theme];
  const colorMap = computeBlocFocusColors(allianceId);
  // WarEra+: cache condivisa così labels.js può colorare le etichette dei
  // nomi nazione in modo coerente con la mappa, senza ricalcolare tutto
  // ad ogni frame di disegno delle label (vedi labels.js).
  state.blocFocusColorMap = colorMap;

  const isOriginal = propKey === 'initialCountryId';
  const expr = isOriginal
    ? ['match', ['to-string', ['get', propKey]]]
    : ['match', ['get', propKey]];
  colorMap.forEach((color, id) => expr.push(isOriginal ? id.toString() : id, color));
  expr.push(theme.DEFAULT_LAND);
  return expr;
}

// ==================== BUILD EXPRESSIONS ====================
export function buildDiplomacyColorExpression(directWars, directAllies, enemyAllies, styleMap) {
  const theme = THEMES[state.theme];
  const expr = ['match', ['get', 'countryId']];
  const allIds = new Set([
    ...Object.keys(styleMap), ...directWars, ...directAllies,
    ...enemyAllies, ...state.customNaps,
    ...(state.selectedCountryId ? [state.selectedCountryId] : []),
  ]);
  allIds.forEach(cId => expr.push(cId, getColorForCountry(cId, directWars, directAllies, enemyAllies, styleMap)));
  expr.push(theme.NEUTRAL_UNSELECTED);
  return expr;
}

/* WarEra+ — Anteprima Alliance Builder (builderPreview.js): quando c'e',
   la vista Alleanze dipinge i blocchi COSTRUITI invece di quelli di gioco.
   Additivo con fallback: senza anteprima non cambia una riga. Nel builder
   una nazione sta in un blocco solo, quindi qui non esistono multi-bloc
   (il layer a pattern viene spento in renderMap). */
function blocPaintMap() {
  return state.builderPreview ? state.builderPreview.colorMap : state.blocColorMap;
}

export function buildBlocColorExpression() {
  const expr = ['match', ['get', 'countryId']];
  const preview = !!state.builderPreview;
  for (const [id, color] of blocPaintMap().entries()) {
    if (preview || !state.multiBlocMap.has(id)) expr.push(id, color);
  }
  expr.push(THEMES[state.theme].DEFAULT_LAND);
  return expr;
}

export function buildOriginalBlocColorExpression() {
  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  const preview = !!state.builderPreview;
  for (const [id, color] of blocPaintMap().entries()) {
    if (preview || !state.multiBlocMap.has(id)) expr.push(id, color);
  }
  if (!preview) {
    for (const [id, { colors }] of state.multiBlocMap.entries()) expr.push(id, colors[0]);
  }
  expr.push(THEMES[state.theme].DEFAULT_LAND);
  return expr;
}

export function buildOriginalColorExpression(directWars, directAllies, enemyAllies) {
  const excludeExtNaps = document.getElementById('checkExcludeExternalNaps')?.checked || false;
  const colorMap = new Map();
  state.nazioniGlobal.forEach(n => {
    const id = n._id;
    let color;
    if (!state.selectedCountryId)        color = state.nationBaseColorMap.get(id) || THEMES[state.theme].DEFAULT_LAND;
    else if (id === state.selectedCountryId) color = COLORS.SELECTED;
    else if (state.customNaps.includes(id)) color = COLORS.NAP;
    else if (!excludeExtNaps && (state.externalNapsSet.has(`${state.selectedCountryId}-${id}`) || state.externalNapsSet.has(`${id}-${state.selectedCountryId}`))) color = COLORS.NAP;
    else {
      // Controlla patti difensivi e sworn enemy
      const dipl = state.diplomacyData.get(state.selectedCountryId);
      const isDefensive = dipl?.defensivePacts?.includes(id) || false;
      const isSworn = dipl?.swornEnemy === id;
      // Alleanza (stesso blocco) ha priorità sul patto difensivo
      if (isSworn) color = COLORS.SWORN_ENEMY;
      else if (directAllies.includes(id))  color = COLORS.ALLY_DIRECT;
      else if (isDefensive) color = COLORS.DEFENSIVE_PACT;
      else if (directWars.includes(id))    color = COLORS.WAR_DIRECT;
      else if (enemyAllies.includes(id))   color = COLORS.WAR_INDIRECT;
      else color = THEMES[state.theme].DEFAULT_LAND;
    }
    colorMap.set(id, color);
  });

  const expr = ['match', ['to-string', ['get', 'initialCountryId']]];
  for (const [id, color] of colorMap.entries()) expr.push(id.toString(), color);
  expr.push(THEMES[state.theme].NEUTRAL_UNSELECTED);
  return expr;
}