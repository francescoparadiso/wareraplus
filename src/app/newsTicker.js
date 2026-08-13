/* ══════════════════════════════════════════════════════════════
   WarEra+ — News ticker diplomatico
   ------------------------------------------------------------------
   Componente NUOVO per la parte mappa/Diplomacy — ispirato al ticker
   già presente in Political (ticker.js, elezioni globali) ma con
   contenuti diversi e diversificati, "stile telegiornale":
     - battaglie in corso (nazioni più popolose)
     - elezioni in corso/imminenti (TUTTE le nazioni — le elezioni non
       sono limitate alle più popolose, su richiesta esplicita)
     - nuove guerre scoppiate dall'ultima visita (nazioni più popolose)
     - cambi di sworn enemy dall'ultima visita (nazioni più popolose)
     - variazione popolazione attiva dall'ultima visita (idem)
     - variazione tesoro/ricchezza dall'ultima visita (idem)

   Ogni categoria viene limitata a un tetto massimo (CAT_CAP) prima di
   mescolare tutto insieme: così una categoria molto numerosa (es. le
   guerre, se il mondo ne ha tante in corso) non monopolizza il ticker
   a scapito delle altre — il problema segnalato nella versione
   precedente, dove le guerre finivano per dominare quasi tutti gli
   slot disponibili.

   "Dall'ultima visita" = confronto con uno snapshot salvato in
   localStorage all'apertura precedente del tool (chiave
   wp_diplo_news_snapshot). Al primissimo avvio non c'è nulla da
   confrontare: si salva solo la base di partenza.

   I testi delle notizie usano i template tradotti in shared/i18n.js
   (chiavi ticker_*) con sostituzione di variabili — solo i NOMI di
   nazioni/alleanze restano invariati (sono nomi propri, non si
   traducono).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { trpcBatch, fmtNumber } from '../diplomacy/utils.js';
import { fetchActiveBattles } from '../diplomacy/battleHeatmap.js';
import { t } from '../shared/i18n.js';

const TOP_N = 15;
const CAT_CAP = 5; // max messaggi per categoria prima del mix finale
const SNAPSHOT_KEY = 'wp_diplo_news_snapshot';
const REFRESH_MS = 5 * 60 * 1000;

/* ── UTILS ── */
function toUTCTimestamp(dateStr) {
  if (!dateStr) return null;
  let iso = dateStr;
  if (!iso.endsWith('Z') && !iso.includes('+')) iso += 'Z';
  return new Date(iso).getTime();
}

function unwrapList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.docs)) return res.docs;
  if (Array.isArray(res.results)) return res.results;
  return [];
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Limita una categoria a `max` messaggi, scegliendoli casualmente invece
// dei primi N (altrimenti sarebbero sempre gli stessi paesi/battaglie a
// comparire, ordinati per come li restituisce l'API).
function capCategory(msgs, max = CAT_CAP) {
  return shuffle(msgs).slice(0, max);
}

function getTopPopulousNations(n = TOP_N) {
  return [...state.nazioniGlobal]
    .filter(nation => nation?.rankings?.countryActivePopulation?.value != null)
    .sort((a, b) => (b.rankings.countryActivePopulation.value || 0) - (a.rankings.countryActivePopulation.value || 0))
    .slice(0, n);
}

/* ── BATTAGLIE IN CORSO (nazioni più popolose) ──
   Separata in fetch (dati grezzi, nessuna traduzione) + format (testo
   tradotto): così un cambio lingua può ri-generare i messaggi dalla
   cache senza rifare le chiamate di rete — vedi _rebuildMessages sotto. */
async function fetchRelevantBattles(topIds) {
  try {
    const battles = await fetchActiveBattles();
    return (battles || []).filter(b => topIds.has(b.attacker?.country) || topIds.has(b.defender?.country));
  } catch (_) {
    return [];
  }
}

function formatBattleMessages(battles) {
  const messages = [];
  battles.forEach(b => {
    const atk = state.nationMap.get(b.attacker?.country);
    const def = state.nationMap.get(b.defender?.country);
    if (!atk || !def) return;
    messages.push(t('ticker_battle', { a: atk.name, b: def.name }));
  });
  return messages;
}

/* ── ELEZIONI IN CORSO / IMMINENTI — TUTTE le nazioni, non solo le
   più popolose (richiesta esplicita: le elezioni vanno mostrate
   sempre, indipendentemente dalla popolazione della nazione).
   Anche qui separata in fetch + format, stesso motivo di cui sopra. ── */
async function fetchElectionsRaw(allNations) {
  try {
    const calls = allNations.map(n => ['election.getElections', { countryId: n._id }]);
    // trpcBatch chunka automaticamente oltre i 50 per POST (vedi utils.js),
    // quindi anche con 100+ nazioni restano poche richieste totali.
    const results = await trpcBatch(calls, { useWorker: true });
    return allNations.map((nation, idx) => ({ nation, items: unwrapList(results[idx]) }));
  } catch (_) {
    return [];
  }
}

function formatElectionMessages(electionsRaw) {
  const now = Date.now();
  const messages = [];
  electionsRaw.forEach(({ nation, items }) => {
    items.forEach(e => {
      const start = toUTCTimestamp(e.votesStartAt);
      const end = toUTCTimestamp(e.votesEndAt);
      if (!start || !end) return;
      const type = e.type === 'president' ? t('ticker_type_presidential') : (e.type === 'congress' ? t('ticker_type_congress') : e.type);
      if (now >= start && now <= end) {
        messages.push(t('ticker_election_live', { nation: nation.name, type }));
      } else if (now < start) {
        messages.push(t('ticker_election_candidacy', { nation: nation.name, type }));
      }
    });
  });
  return messages;
}

/* ── SNAPSHOT (guerre, sworn enemy, popolazione, tesoro) — confronto
   con l'ultima visita, limitato alle nazioni più popolose. ── */
function loadSnapshot() {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
function saveSnapshot(snap) {
  try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap)); } catch (_) {}
}
function buildCurrentSnapshot(topNations) {
  const wars = {};
  const sworn = {};
  const population = {};
  const wealth = {};
  topNations.forEach(n => {
    wars[n._id] = [...(n.warsWith || [])].sort();
    sworn[n._id] = state.diplomacyData.get(n._id)?.swornEnemy || null;
    population[n._id] = n?.rankings?.countryActivePopulation?.value ?? null;
    wealth[n._id] = n?.rankings?.countryWealth?.value ?? n?.money ?? null;
  });
  return { wars, sworn, population, wealth, savedAt: Date.now() };
}

function diffWarMessages(prev, curr, topNations) {
  const messages = [];
  if (!prev) return messages;
  const nameOf = id => state.nationMap.get(id)?.name || id;
  topNations.forEach(n => {
    const prevWars = new Set(prev.wars?.[n._id] || []);
    (curr.wars[n._id] || []).forEach(enemyId => {
      if (!prevWars.has(enemyId)) {
        messages.push(t('ticker_new_war', { a: n.name, b: nameOf(enemyId) }));
      }
    });
  });
  return messages;
}

function diffSwornMessages(prev, curr, topNations) {
  const messages = [];
  if (!prev) return messages;
  const nameOf = id => state.nationMap.get(id)?.name || id;
  topNations.forEach(n => {
    const prevSworn = Object.prototype.hasOwnProperty.call(prev.sworn || {}, n._id) ? prev.sworn[n._id] : undefined;
    const currSworn = curr.sworn[n._id];
    if (prevSworn === undefined || prevSworn === currSworn) return;
    if (currSworn) {
      messages.push(t('ticker_sworn_new', { a: n.name, b: nameOf(currSworn) }));
    } else if (prevSworn) {
      messages.push(t('ticker_sworn_removed', { a: n.name, b: nameOf(prevSworn) }));
    }
  });
  return messages;
}

// WarEra+ novità: variazione popolazione attiva / tesoro dall'ultima
// visita, per diversificare ulteriormente il mix di notizie oltre a
// guerre/elezioni/battaglie.
function diffStatsMessages(prev, curr, topNations) {
  const messages = [];
  if (!prev) return messages;
  topNations.forEach(n => {
    const prevPop = prev.population?.[n._id];
    const currPop = curr.population[n._id];
    if (typeof prevPop === 'number' && typeof currPop === 'number' && prevPop !== currPop) {
      const delta = currPop - prevPop;
      const sign = delta > 0 ? '+' : '';
      messages.push(t('ticker_population_change', { nation: n.name, sign, delta: fmtNumber(delta) }));
    }
    const prevWealth = prev.wealth?.[n._id];
    const currWealth = curr.wealth[n._id];
    if (typeof prevWealth === 'number' && typeof currWealth === 'number' && prevWealth !== currWealth && prevWealth !== 0) {
      const pct = (currWealth - prevWealth) / Math.abs(prevWealth) * 100;
      const sign = pct > 0 ? '+' : '';
      messages.push(t('ticker_treasury_change', { nation: n.name, sign, pct: pct.toFixed(1) }));
    }
  });
  return messages;
}

/* ── RENDER (RAF, scroll continuo) — stesso principio del ticker di
   Political (ticker.js), riscritto qui per il nostro DOM/track. ── */
let _tickerMessages = [];
let _tickerPos = 0;
// WarEra+ fix: prima l'incremento era fisso PER CHIAMATA RAF
// (_tickerPos += 0.5 ad ogni frame), non per tempo reale trascorso.
// Quando il thread principale è occupato (es. eventi mousemove sulla
// mappa MapLibre, hover sui tooltip nazione/battaglia), il browser
// chiama requestAnimationFrame meno spesso — il ticker avanzava quindi
// di meno nello stesso tempo reale, apparendo "rallentato" muovendo il
// mouse. Ora la velocità è espressa in pixel/secondo e il movimento è
// calcolato dal tempo REALMENTE trascorso tra una chiamata e l'altra
// (delta-time), indipendentemente da quanti frame vengono saltati.
const _tickerSpeedPxPerSec = 30;
let _tickerLastFrameTime = 0;
let _tickerRunning = false;
let _tickerUnitWidth = 0;

function _tickerLoop(now) {
  if (!_tickerRunning) return;
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) { requestAnimationFrame(_tickerLoop); return; }

  if (!_tickerLastFrameTime) _tickerLastFrameTime = now;
  const deltaSeconds = Math.min((now - _tickerLastFrameTime) / 1000, 0.25); // clamp per evitare salti enormi dopo una pausa lunga (es. tab in background)
  _tickerLastFrameTime = now;

  if (!track.matches(':hover')) {
    _tickerPos += _tickerSpeedPxPerSec * deltaSeconds;
    if (_tickerUnitWidth > 0 && _tickerPos >= _tickerUnitWidth) _tickerPos -= _tickerUnitWidth;
    track.style.transform = `translateX(${-_tickerPos}px)`;
  }
  requestAnimationFrame(_tickerLoop);
}

function _rebuildTrack() {
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) return;
  const msgs = _tickerMessages.length ? _tickerMessages : [t('ticker_no_news')];
  // Tripla ripetizione per avere sempre contenuto avanti durante il loop.
  const html = [...msgs, ...msgs, ...msgs]
    .map(msg => `<span class="wp-ticker-message">🔹 ${msg}</span><span class="wp-ticker-sep">✦</span>`)
    .join('');
  track.innerHTML = html;
  requestAnimationFrame(() => { _tickerUnitWidth = track.scrollWidth / 3; });
}

// WarEra+: dati grezzi dell'ultimo aggiornamento riuscito, tenuti in
// cache per poter ri-generare i messaggi TRADOTTI (_rebuildMessages)
// senza rifare le chiamate di rete quando cambia solo la lingua.
let _lastRawData = null;

async function refreshNews() {
  try {
    if (!state.nazioniGlobal?.length) return;
    const topNations = getTopPopulousNations();
    if (!topNations.length) return;
    const topIds = new Set(topNations.map(n => n._id));

    const [battles, electionsRaw] = await Promise.all([
      fetchRelevantBattles(topIds),
      fetchElectionsRaw(state.nazioniGlobal), // TUTTE le nazioni
    ]);

    const currSnap = buildCurrentSnapshot(topNations);
    const prevSnap = loadSnapshot();
    saveSnapshot(currSnap);

    _lastRawData = { topNations, battles, electionsRaw, currSnap, prevSnap };
    _rebuildMessages();
  } catch (err) {
    console.warn('WarEra+ newsTicker: errore aggiornamento', err);
  }
}

// Ricostruisce i messaggi (tradotti) dai dati grezzi già scaricati,
// SENZA alcuna chiamata di rete — usata sia dal refresh periodico (dopo
// il fetch) sia da un cambio lingua (dati invariati, cambia solo il
// testo). Rifare tutto refreshNews() ad ogni cambio lingua avrebbe
// richiesto nuove chiamate per TUTTE le nazioni (elezioni), rischiando
// di ricreare il problema dei 429 già risolto altrove.
function _rebuildMessages() {
  if (!_lastRawData) return;
  const { topNations, battles, electionsRaw, currSnap, prevSnap } = _lastRawData;

  const battleMsgsRaw = formatBattleMessages(battles);
  const electionMsgsRaw = formatElectionMessages(electionsRaw);
  const warMsgsRaw = diffWarMessages(prevSnap, currSnap, topNations);
  const swornMsgsRaw = diffSwornMessages(prevSnap, currSnap, topNations);
  const statsMsgsRaw = diffStatsMessages(prevSnap, currSnap, topNations);

  // Cap per categoria PRIMA di unire e mescolare: garantisce
  // diversificazione anche quando una categoria (tipicamente le
  // guerre) avrebbe molti più elementi delle altre.
  const mixed = [
    ...capCategory(battleMsgsRaw),
    ...capCategory(electionMsgsRaw),
    ...capCategory(warMsgsRaw),
    ...capCategory(swornMsgsRaw),
    ...capCategory(statsMsgsRaw),
  ];
  const all = shuffle(mixed).slice(0, 30);
  _tickerMessages = all.length ? all : [t('ticker_no_news')];
  _rebuildTrack();
}

export function startNewsTicker() {
  const track = document.getElementById('wp-news-ticker-track');
  if (!track) return;
  _tickerPos = 0;
  _tickerRunning = true;
  requestAnimationFrame(_tickerLoop);
  refreshNews();
  setInterval(refreshNews, REFRESH_MS);

  // Senza questo, cambiando lingua i messaggi già mostrati restavano
  // nella lingua precedente fino al prossimo ciclo di aggiornamento (5
  // minuti). _rebuildMessages riformatta dai dati già scaricati, senza
  // rifare le chiamate di rete (che rifare per ogni cambio lingua
  // avrebbe rischiato di ricreare il problema dei 429 già risolto).
  window.addEventListener('wareraplus:langchange', () => { _rebuildMessages(); });
}
