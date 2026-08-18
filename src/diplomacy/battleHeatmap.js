import { state } from './state.js';
import { API_BASE_URL, WORKER_API_BASE, COLORS } from './config.js';
import { showRateLimitTooltip, trpcBatch } from './utils.js';
import { renderMap, captureHeatmapFadeFrom, startHeatmapFadeIn, clearHeatmapFade } from './map.js';
import { updateDynamicLegend } from './ui.js';
import { fetchActiveBattlesViaCache } from './cacheClient.js';
import { trackEvent } from '../shared/analytics.js';

const BATTLE_NEUTRAL = '#2a2d33';
let liveInterval = null;
let currentBattleId = null;
let savedColoringMode = 'diplomacy';

// ============ API ============

let lastSuccessfulBattlesCache = [];
let isRateLimited = false;

export async function fetchActiveBattles() {
  // WarEra+: il server di cache tiene già lui l'elenco completo (poll
  // periodico via Worker), quindi qui basta una fetch sola invece della
  // paginazione a cursore sotto — che resta come fallback se il server di
  // cache non risponde/è troppo vecchio (mai un punto di fallimento unico).
  try {
    const battles = await fetchActiveBattlesViaCache();
    isRateLimited = false;
    if (battles.length > 0) lastSuccessfulBattlesCache = battles;
    console.log(`Fetched ${battles.length} battles (cache)`);
    return battles;
  } catch (err) {
    console.warn('[cache] battaglie non disponibili, fallback diretto:', err.message);
  }
  try {
    const all = [];
    let cursor = undefined;
    let guard = 0;
    let hasError = false;
    
    do {
      const input = { isActive: true, limit: 100, ...(cursor ? { cursor } : {}) };
      // WarEra+: instradato tramite il Worker (rate limit 500/min invece
      // di 100) — battaglie, insieme alle elezioni, erano la fonte
      // principale dei 429 segnalati.
      const url = `${WORKER_API_BASE}/trpc/battle.getBattles?input=${encodeURIComponent(JSON.stringify(input))}`;
      const res = await fetch(url);
      
      if (res.status === 429) {
        isRateLimited = true;
        showRateLimitTooltip('battle-list-fetch');
        if (all.length > 0) {
          return all;
        }
        if (lastSuccessfulBattlesCache.length > 0) {
          return lastSuccessfulBattlesCache;
        }
        return [];
      }
      
      isRateLimited = false;
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = data?.result?.data?.items || data?.items || [];
      all.push(...items);
      cursor = data?.result?.data?.nextCursor || data?.nextCursor || null;
      guard++;
    } while (cursor && guard < 20);
    
    if (all.length > 0) {
      lastSuccessfulBattlesCache = all;
    }
    
    console.log(`Fetched ${all.length} battles from ${guard} pages`);
    return all;
  } catch (err) {
    console.error('fetchActiveBattles error:', err);
    if (lastSuccessfulBattlesCache.length > 0) {
      return lastSuccessfulBattlesCache;
    }
    return [];
  }
}

export function resetBattlesCache() {
  lastSuccessfulBattlesCache = [];
  isRateLimited = false;
}

// Mantenuta per compatibilità (chiamata singola, non batchata) — usata solo
// come fallback. Il percorso principale usa fetchBattleFullData().
export async function fetchBattleDetails(battleId) {
  try {
    const input = { battleId };
    const url = `${WORKER_API_BASE}/trpc/battle.getById?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    
    if (res.status === 429) {
      showRateLimitTooltip('battle-details-fetch');
      return null;
    }
    
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data?.result?.data || data;
  } catch (err) {
    console.error('fetchBattleDetails error:', err);
    return null;
  }
}

// Trasforma i due array di ranking (attacker/defender side) nella struttura
// per-nazione usata dalla heatmap.
function buildNationRanking(attackerRanking, defenderRanking) {
  if (attackerRanking.length === 0 && defenderRanking.length === 0) {
    return [];
  }

  const nationMap = new Map();

  attackerRanking.forEach(item => {
    const countryId = item.country;
    if (!countryId) return;
    if (!nationMap.has(countryId)) {
      nationMap.set(countryId, { damageToAttackers: 0, damageToDefenders: 0 });
    }
    nationMap.get(countryId).damageToDefenders += item.value || 0;
  });

  defenderRanking.forEach(item => {
    const countryId = item.country;
    if (!countryId) return;
    if (!nationMap.has(countryId)) {
      nationMap.set(countryId, { damageToAttackers: 0, damageToDefenders: 0 });
    }
    nationMap.get(countryId).damageToAttackers += item.value || 0;
  });

  const processed = [];
  let maxDamage = 0;

  for (const [countryId, damages] of nationMap) {
    const { damageToAttackers, damageToDefenders } = damages;
    const totalDamage = damageToAttackers + damageToDefenders;
    const side = damageToAttackers > damageToDefenders ? 'defender' : 'attacker';
    if (totalDamage > maxDamage) maxDamage = totalDamage;
    processed.push({
      countryId,
      totalDamage,
      damageToAttackers,
      damageToDefenders,
      side,
    });
  }

  processed.sort((a, b) => b.totalDamage - a.totalDamage);
  return processed;
}

function extractRankingItems(res) {
  const items = res?.items || (Array.isArray(res) ? res : []);
  return Array.isArray(items) ? items : [];
}

// battle.getLiveBattleData: dati "ufficiali" del round corrente (danni,
// punti tick, isActive). Più precisi/aggiornati della somma dei ranking
// per-nazione, usati da battleFront per i totali mostrati nell'HUD.
function extractLiveData(res) {
  if (!res) return null;
  const battle = res.battle || null;
  const round = res.round || null;
  if (!battle && !round) return null;
  return { battle, round };
}

// ==================== BATTLE WALL 3D (dati + live round in batch) ====================
// Usate solo da battleFront.js. Ogni fetch include SEMPRE
// battle.getLiveBattleData nello stesso POST batch (mai una chiamata
// separata), così i danni mostrati nel muro 3D usano i valori ufficiali del
// round invece della sola somma dei ranking per-nazione.

// Chiamata iniziale (apertura overlay): dettagli battaglia (per il titolo) +
// ranking attacker/defender + dati live del round, in UN SOLO POST.
export async function fetchBattleWallData(battleId) {
  try {
    const calls = [
      ['battle.getById', { battleId }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'attacker', dataType: 'damage', limit: 100 }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'defender', dataType: 'damage', limit: 100 }],
      ['battle.getLiveBattleData', { battleId }],
    ];
    const [details, attackerRes, defenderRes, liveRes] = await trpcBatch(calls, { useWorker: true });
    const attackerRanking = extractRankingItems(attackerRes);
    const defenderRanking = extractRankingItems(defenderRes);
    const nations = buildNationRanking(attackerRanking, defenderRanking);
    const live = extractLiveData(liveRes);
    return { details, nations, live };
  } catch (err) {
    console.error('fetchBattleWallData error:', err);
    // Fallback: dati completi normali + tentativo separato per i dati live
    const { details, nations } = await fetchBattleFullData(battleId);
    let live = null;
    try {
      const [liveRes] = await trpcBatch([['battle.getLiveBattleData', { battleId }]]);
      live = extractLiveData(liveRes);
    } catch (_) { /* live data opzionale, non blocca l'apertura */ }
    return { details, nations, live };
  }
}

// Chiamata di poll (ogni secondo mentre l'overlay è aperto): ranking
// attacker/defender + dati live del round, in UN SOLO POST.
export async function fetchBattleWallPoll(battleId) {
  try {
    const calls = [
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'attacker', dataType: 'damage', limit: 100 }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'defender', dataType: 'damage', limit: 100 }],
      ['battle.getLiveBattleData', { battleId }],
    ];
    const [attackerRes, defenderRes, liveRes] = await trpcBatch(calls, { useWorker: true });
    const attackerRanking = extractRankingItems(attackerRes);
    const defenderRanking = extractRankingItems(defenderRes);
    const nations = buildNationRanking(attackerRanking, defenderRanking);
    const live = extractLiveData(liveRes);
    return { nations, live };
  } catch (err) {
    console.error('fetchBattleWallPoll error:', err);
    const nations = await fetchBattleRanking(battleId);
    return { nations, live: null };
  }
}

// Ranking attacker + defender in un'unica richiesta batch (era Promise.all
// di 2 fetch separate -> ora 1 solo POST). Vedi warera-api-batching.md.
export async function fetchBattleRanking(battleId) {
  try {
    const calls = [
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'attacker', dataType: 'damage', limit: 100 }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'defender', dataType: 'damage', limit: 100 }],
    ];
    const [attackerRes, defenderRes] = await trpcBatch(calls, { useWorker: true });
    const attackerRanking = extractRankingItems(attackerRes);
    const defenderRanking = extractRankingItems(defenderRes);

    console.log('Attacker rankings:', attackerRanking);
    console.log('Defender rankings:', defenderRanking);

    return buildNationRanking(attackerRanking, defenderRanking);
  } catch (err) {
    console.error('fetchBattleRanking error:', err);
    return [];
  }
}

// Dati completi per l'apertura della heatmap: dettagli battaglia + ranking
// attacker + ranking defender, in UN SOLO POST batch (era 1+2 = 3 richieste
// separate). Vedi warera-api-batching.md, pattern "endpoint misti".
export async function fetchBattleFullData(battleId) {
  try {
    const calls = [
      ['battle.getById', { battleId }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'attacker', dataType: 'damage', limit: 100 }],
      ['battleRanking.getRanking', { battleId, type: 'country', side: 'defender', dataType: 'damage', limit: 100 }],
    ];
    const [details, attackerRes, defenderRes] = await trpcBatch(calls, { useWorker: true });
    const attackerRanking = extractRankingItems(attackerRes);
    const defenderRanking = extractRankingItems(defenderRes);
    const nations = buildNationRanking(attackerRanking, defenderRanking);
    return { details, nations };
  } catch (err) {
    console.error('fetchBattleFullData error:', err);
    // Fallback a chiamate singole (vedi warera-api-batching.md, pattern 5)
    const [details, nations] = await Promise.all([
      fetchBattleDetails(battleId),
      fetchBattleRanking(battleId),
    ]);
    return { details, nations };
  }
}

// ============ Impostazione / Uscita ============

export async function setBattleHeatmap(battleId) {
  console.log('setBattleHeatmap called for battle:', battleId);
  console.log('currentBattleId:', currentBattleId);
  console.log('coloringMode:', state.coloringMode);
  
  // Se è già selezionata la stessa battaglia, esci
  if (currentBattleId === battleId && state.coloringMode === 'battleHeatmap') {
    console.log('Same battle, exiting');
    exitBattleHeatmap();
    return;
  }

  try {
    // SALVA IL MODO ORIGINALE SOLO SE NON SIAMO GIÀ IN HEATMAP
    if (state.coloringMode !== 'battleHeatmap') {
      savedColoringMode = state.coloringMode;
      console.log('Saved coloring mode:', savedColoringMode);
    }
    
    console.log('Fetching battle data (batched) for battle:', battleId);
    const { details, nations: rankingData } = await fetchBattleFullData(battleId);
    console.log('Ranking data received:', rankingData);
    
    if (!rankingData || !rankingData.length) {
      console.warn('No ranking data for battle', battleId);
      return;
    }

    const nations = rankingData;
    let maxDamage = 0;
    nations.forEach(n => { if (n.totalDamage > maxDamage) maxDamage = n.totalDamage; });

    const attackerId = details?.attacker?.country;
    const defenderId = details?.defender?.country;
    const getNation = (id) => {
      if (!id) return 'Unknown';
      const nation = state.nationMap.get(id);
      return nation ? nation.name : id.slice(0, 6);
    };
    const battleName = `${getNation(attackerId)} vs ${getNation(defenderId)}`;

    // WarEra+ FIX: `details.region` (top-level) non esiste in battle.getById
    // — verificato contro l'API reale, l'oggetto battaglia non ha MAI un
    // campo `region` in cima, solo `defender.region`/`attacker.region` (un
    // id, non un nome). Il vecchio `details?.region || 'Unknown'` mostrava
    // quindi sempre 'Unknown'. Il nome leggibile si trova in
    // state.regionCache (popolato da battleMarkers.js per ogni battaglia
    // attiva — nessuna chiamata di rete aggiuntiva qui, best-effort).
    const regionId = details?.defender?.region || details?.attacker?.region;
    const regionName = (regionId && state.regionCache?.get(regionId)?.name) || 'Unknown';

    // AGGIORNA I DATI
    state.battleHeatmapData = {
      battleId,
      battleName,
      region: regionName,
      nations,
      maxDamage,
      rankingRaw: rankingData,
    };
    
    // BUG FIX (segnalato dall'utente: "effetto flashbang" all'apertura).
    // Ricorda i colori ATTUALI della mappa PRIMA che renderMap() li
    // sostituisca con la heatmap: resteranno sotto mentre la heatmap
    // sfuma in sopra (vedi map.js, blocco "Dissolvenza in ingresso della
    // heatmap battaglia" — spiega anche perché fill-color-transition di
    // MapLibre qui non funziona e perché la dissolvenza è invertita).
    const fading = captureHeatmapFadeFrom();

    state.coloringMode = 'battleHeatmap';
    currentBattleId = battleId;

    // Ferma il vecchio live update e avvia quello nuovo
    stopLiveUpdates();
    startLiveUpdates(battleId);

    // Forza il rendering
    renderMap();
    if (fading) startHeatmapFadeIn();
    updateDynamicLegend();
    console.log('Heatmap updated for battle:', battleName);
    
  } catch (err) {
    console.error('setBattleHeatmap error:', err);
  }
}

export function exitBattleHeatmap() {
  console.log('exitBattleHeatmap called');
  
  if (state.coloringMode === 'battleHeatmap') {
    const previousMode = savedColoringMode || 'diplomacy';
    console.log('Returning to mode:', previousMode);
    trackEvent('battle-heatmap-exit');

    state.coloringMode = previousMode;
    state.battleHeatmapData = null;
    currentBattleId = null;

    stopLiveUpdates();

    // Un'uscita durante la dissolvenza non deve lasciare il velo appeso
    // sopra alla mappa tornata in modalità normale (vedi map.js).
    clearHeatmapFade();

    // WarEra+ fix: prima qui si faceva clearMarkers() + una NUOVA fetch di
    // rete (fetchActiveBattles, non dalla cache) con 100ms di ritardo —
    // anche se hideBattleTooltip() (battleMarkers.js) aveva già reso
    // visibili i marker esistenti un istante prima con showAllMarkers().
    // Il risultato era: marker mostrati, poi immediatamente distrutti e
    // ricostruiti da una fetch di rete — da qui il ritardo di circa un
    // secondo segnalato ("non li abbiamo in cache?", giustamente). I dati
    // dei marker non cambiano per il solo fatto di uscire dalla heatmap
    // (è un cambio di modalità colore della mappa, non dei dati
    // battaglia): basta renderli di nuovo visibili, istantaneo e senza
    // rete. Il refresh periodico esistente (ogni 30s) li terrà comunque
    // aggiornati come sempre.
    import('./battleMarkers.js').then(m => m.showAllMarkers());
    
    renderMap();
    updateDynamicLegend();
  } else {
    state.battleHeatmapData = null;
    currentBattleId = null;
    renderMap();
    updateDynamicLegend();
  }
}

function startLiveUpdates(battleId) {
  stopLiveUpdates();
  liveInterval = setInterval(async () => {
    if (state.coloringMode !== 'battleHeatmap' || state.battleHeatmapData?.battleId !== battleId) {
      stopLiveUpdates();
      return;
    }
    try {
      const rankingData = await fetchBattleRanking(battleId);
      if (rankingData && rankingData.length) {
        const nations = rankingData;
        let maxDamage = 0;
        nations.forEach(n => { if (n.totalDamage > maxDamage) maxDamage = n.totalDamage; });
        state.battleHeatmapData.nations = nations;
        state.battleHeatmapData.maxDamage = maxDamage;
        state.battleHeatmapData.rankingRaw = rankingData;
        renderMap();
      }
    } catch (err) {
      console.warn('Live update error:', err);
    }
  }, 10000);
}

function stopLiveUpdates() {
  if (liveInterval) {
    clearInterval(liveInterval);
    liveInterval = null;
  }
}

// ============ ESPRESSIONE COLORE ============

export function buildBattleHeatmapColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  if (!state.battleHeatmapData) return BATTLE_NEUTRAL;
  const { nations } = state.battleHeatmapData;
  const colorMap = new Map();

  let maxAttackerDmg = 0;
  let maxDefenderDmg = 0;
  // Totali di lato (somma danni di TUTTE le nazioni di quel lato) — servono
  // solo per il cutoff sotto, non per il colore (che resta relativo al
  // massimo contributore, come prima). Stessa definizione di "Share" già
  // mostrata in legenda (ui.js: "Share = nation damage / side total").
  let totalAttackerDmg = 0;
  let totalDefenderDmg = 0;
  nations.forEach(item => {
    if (item.side === 'attacker') {
      totalAttackerDmg += item.totalDamage;
      if (item.totalDamage > maxAttackerDmg) maxAttackerDmg = item.totalDamage;
    } else {
      totalDefenderDmg += item.totalDamage;
      if (item.totalDamage > maxDefenderDmg) maxDefenderDmg = item.totalDamage;
    }
  });

  if (maxAttackerDmg === 0) maxAttackerDmg = 1;
  if (maxDefenderDmg === 0) maxDefenderDmg = 1;

  // CUTOFF (richiesto dall'utente): nazioni sotto l'1% del danno del
  // proprio lato restano fuori dalla mappa colori (colore neutro invece di
  // una tinta quasi invisibile) — decine di paesi con un contributo
  // trascurabile rendevano la heatmap "rumorosa" e difficile da leggere.
  const MIN_SIDE_SHARE = 0.01;

  nations.forEach(item => {
    const sideTotal = item.side === 'attacker' ? totalAttackerDmg : totalDefenderDmg;
    const share = sideTotal > 0 ? item.totalDamage / sideTotal : 0;
    if (share < MIN_SIDE_SHARE) return; // sotto soglia: niente colore, resta BATTLE_NEUTRAL

    let pct;
    if (item.side === 'attacker') {
      pct = item.totalDamage / maxAttackerDmg;
    } else {
      pct = item.totalDamage / maxDefenderDmg;
    }
    pct = Math.min(1, Math.max(0, pct));
    
    let color;
    if (item.side === 'attacker') {
      const r = Math.round(214 - 214 * pct);
      const g = Math.round(232 - 197 * pct);
      const b = 255;
      color = `rgb(${Math.max(0,r)},${Math.max(0,g)},${b})`;
    } else {
      const r = 255;
      const g = Math.round(217 - 217 * pct);
      const b = Math.round(217 - 217 * pct);
      color = `rgb(${r},${Math.max(0,g)},${Math.max(0,b)})`;
    }
    
    // (Il vecchio caso speciale "totalDamage === 0 → colore più chiaro" è
    // stato rimosso: con il cutoff sopra una nazione a 0 danni ha sempre
    // share 0%, quindi esce già dal `return` prima di arrivare qui.)

    colorMap.set(item.countryId, color);
  });

  if (!colorMap.size) return BATTLE_NEUTRAL;

  const expr = isOriginal
    ? ['match', ['to-string', ['get', prop]]]
    : ['match', ['get', prop]];

  for (const [id, color] of colorMap) {
    expr.push(isOriginal ? id.toString() : id, color);
  }
  expr.push(BATTLE_NEUTRAL);
  return expr;
}