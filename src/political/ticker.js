/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: ticker.js come modulo ES (Fase 2, Stage 5)
   ------------------------------------------------------------------
   Conversione diretta di public/political/ticker.js. Unica differenza:
   l'export ridondante su `window` (startTicker/renderTicker) rimosso —
   nell'originale serviva solo perché le function declaration erano già
   globali per hoisting, nessun consumatore osservato le leggeva per
   nome da window; con import/export espliciti non serve più.
   ══════════════════════════════════════════════════════════════ */

import { localFetch } from './api.js';
import { getAllCountries } from '../shared/countries.js';
import { fetchElectionsForCountriesViaCache } from '../diplomacy/cacheClient.js';
import { trpcBatch } from '../diplomacy/utils.js';

let _tickerMessages = [];
let _tickerPos = 0;
let _tickerSpeed = 0.55;
let _tickerRunning = false;
let _tickerUnitWidth = 0;

/* ── WarEra+ (riduzione richieste al Worker Cloudflare) ──────────────
   Il giro dati del ticker era la singola voce piu' costosa di tutto il
   tool: ~120 `election.getElections` (una per nazione) ogni 5 minuti, con
   TTL di cache a 3 minuti — cioe' SEMPRE un miss completo — e il timer
   che continuava a girare anche a overlay Political chiuso. Sul contatore
   Cloudflare erano ~38k richieste/giorno, oltre un terzo del totale.
   Tre correzioni, qui sotto e in _fetchElectionsByCountry:
     · una richiesta sola per tutte le nazioni (endpoint di gruppo);
     · TTL > intervallo, cosi' il giro successivo puo' davvero riusare;
     · timer fermato con l'overlay (vedi pauseTicker/resumeTicker).
   ─────────────────────────────────────────────────────────────────── */
const TICKER_REFRESH_MS = 6 * 60 * 1000;
// Sopra TICKER_REFRESH_MS di proposito: i dettagli elezione di fase 3
// devono poter essere riusati dal giro seguente invece di scadere pochi
// istanti prima. Restano comunque nell'ordine dei minuti: i numeri del
// ticker non inseguono il secondo.
const TICKER_DETAIL_TTL_MS = 7 * 60 * 1000;
let _tickerDataTimer = null;
let _lastTickerFetchAt = 0;

export function toUTCTimestamp(dateStr) {
  if (!dateStr) return null;
  let iso = dateStr;
  if (!iso.endsWith('Z') && !iso.includes('+')) iso += 'Z';
  return new Date(iso).getTime();
}

/* ── ANIMATION LOOP ── */
function _tickerLoop() {
  if (!_tickerRunning) return;
  const track = document.getElementById('tickerTrack');
  if (!track) { requestAnimationFrame(_tickerLoop); return; }

  if (!track.matches(':hover')) {
    _tickerPos += _tickerSpeed;
    if (_tickerUnitWidth > 0 && _tickerPos >= _tickerUnitWidth) {
      _tickerPos -= _tickerUnitWidth;
    }
    track.style.transform = `translateX(${-_tickerPos}px)`;
  }
  requestAnimationFrame(_tickerLoop);
}

/* ── BUILD/UPDATE DOM content without resetting position ── */
function _rebuildTickerContent() {
  const track = document.getElementById('tickerTrack');
  if (!track) return;

  const msgs = _tickerMessages.length ? _tickerMessages : ['📡 Loading global elections...'];
  // triple so we always have content ahead while looping
  const html = [...msgs, ...msgs, ...msgs]
    .map(msg => `<span class="ticker-message">🔹 ${msg}</span><span class="ticker-sep">✦</span>`)
    .join('');
  track.innerHTML = html;

  // measure unit width after paint
  requestAnimationFrame(() => {
    _tickerUnitWidth = track.scrollWidth / 3;
  });
}

/* ── DATA FETCH ── */

/** Come `localFetch('/elections', {countryId})` ma per TUTTE le nazioni
 *  insieme. Ritorna un array di liste elezioni nello stesso ordine di
 *  `countryIds` (lista vuota per le nazioni senza dati), cioe' la stessa
 *  forma che il `Promise.all` per-nazione produceva prima.
 *
 *  Due livelli, entrambi gia' esistenti altrove nel progetto:
 *   1. `/elections?countryIds=...` del server di cache — una richiesta per
 *      tutte le nazioni. E' lo stesso endpoint che usa il pannello
 *      alleanza (cacheClient.js: fetchElectionsForCountriesViaCache).
 *   2. se il server non risponde o non conosce `countryIds` (deploy vecchio),
 *      batch tRPC via Worker: con MAX_BATCH=50 sono 3 richieste per ~120
 *      nazioni invece di 120. Il fallback per-nazione di prima non era
 *      batchato, quindi un singolo momento di indisponibilita' del VPS si
 *      traduceva in ~120 richieste al Worker tutte insieme — la ragione
 *      per cui il path "singolo" dominava le statistiche Cloudflare. */
async function _fetchElectionsByCountry(countryIds) {
  try {
    const byCountry = await fetchElectionsForCountriesViaCache(countryIds);
    return countryIds.map(id => byCountry[id] || []);
  } catch (_) {
    // Server di cache non disponibile / senza supporto `countryIds`: sotto.
  }
  try {
    const raw = await trpcBatch(
      countryIds.map(id => ['election.getElections', { countryId: id }]),
      { useWorker: true },
    );
    return raw.map(r => (
      Array.isArray(r) ? r : (r?.items || r?.docs || r?.results || r?.data || [])
    ));
  } catch (_) {
    return countryIds.map(() => []);
  }
}

async function fetchAllElectionsOnce() {
  _lastTickerFetchAt = Date.now();
  try {
    // Fase 2 follow-up: elenco condiviso con Diplomacy (src/shared/countries.js)
    // invece di una fetch dedicata ogni 5 minuti (era { useCache: false }).
    const raw = await getAllCountries();
    if (!raw.length) throw new Error('No countries');

    // Show news for the most populous nations first. `.slice()`: raw è
    // l'array CONDIVISO con Diplomacy, ordinarlo in-place lo cambierebbe
    // anche lì.
    const allCountries = raw.slice().sort((a, b) =>
      (b.rankings?.countryActivePopulation?.value || 0) -
      (a.rankings?.countryActivePopulation?.value || 0)
    );

    const now = Date.now();

    // ── Fase 1: elezioni di TUTTE le nazioni in una richiesta sola ──
    // Era una localFetch per nazione (~120) ad ogni giro, con TTL 3 min
    // sotto l'intervallo di 5 min: mai un riuso, sempre 120 richieste.
    // Vedi _fetchElectionsByCountry e il blocco WarEra+ in testa al file.
    const electionsByIndex = await _fetchElectionsByCountry(allCountries.map(c => c._id));
    const perCountry = allCountries.map((country, i) => ({
      country,
      elections: electionsByIndex[i] || [],
    }));

    // ── Fase 2: individua le elezioni "upcoming" o "live" che richiedono un dettaglio ──
    const relevant = [];
    for (const { country, elections } of perCountry) {
      const countryName = country.name || country._id;
      for (const e of elections) {
        const start = toUTCTimestamp(e.votesStartAt);
        const end   = toUTCTimestamp(e.votesEndAt);
        if (!start || !end) continue;
        if (now < start || (now >= start && now <= end)) {
          relevant.push({ e, countryName, start, end });
        }
      }
    }

    // ── Fase 3: dettagli di tutte le elezioni rilevanti, in parallelo (un unico batch) ──
    const details = await Promise.all(
      relevant.map(r =>
        localFetch('/election', { id: r.e._id }, { useCache: true, ttl: TICKER_DETAIL_TTL_MS })
          .catch(() => null)
      )
    );

    const messages = relevant.map((r, idx) => {
      const { e, countryName, start, end } = r;
      const detail    = details[idx];
      const type      = e.type === 'president' ? 'PRES' : 'CONG';
      // WarEra+ : la data segue la LINGUA SCELTA nell'app, non quella del
      // browser. Con `undefined` un browser italiano scriveva "24 ago"
      // dentro una frase in inglese, dove "ago" si legge come "fa": stessa
      // ambiguità corretta nel ticker dello shell (src/app/newsTicker.js).
      const dateLocale = document.documentElement.lang || undefined;
      const startDate = new Date(start).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });
      const endDate   = new Date(end).toLocaleDateString(dateLocale, { day: 'numeric', month: 'short' });

      if (now < start) {
        const candidateCount = detail?.candidates?.length || 0;
        let msg = `${countryName} ${type} · candidacy open · voting starts ${startDate}`;
        if (candidateCount > 0) msg += ` (${candidateCount} candidates)`;
        return msg;
      } else {
        let voterCount = 0;
        if (detail) {
          if (detail.votesCount) {
            voterCount = detail.votesCount;
          } else {
            voterCount = detail.candidates?.reduce((s, c) => s + (c.voteCount || 0), 0) || 0;
          }
        }
        let msg = `${countryName} ${type} · 🔴 live · ends ${endDate}`;
        if (voterCount > 0) msg += ` · ${voterCount.toLocaleString()} votes`;
        return msg;
      }
    });

    _tickerMessages = messages.length ? messages.slice(0, 30) : ['✅ No ongoing or upcoming elections worldwide'];
    _rebuildTickerContent();
  } catch (err) {
    console.warn('Ticker error:', err);
    _tickerMessages = ['⚠️ Unable to load worldwide election data'];
    _rebuildTickerContent();
  }
}

/* ── PAUSE/RESUME (WarEra+ perf) ──
   Il loop si autoferma quando _tickerRunning passa a false (vedi
   _tickerLoop sopra: se true diventa false, il prossimo tick esce senza
   richiedere un altro RAF) — chiamate da
   main.js:pausePoliticalRendering/resumePoliticalRendering quando
   l'overlay Political viene chiuso/riaperto, così il loop non gira più
   per sempre in background dopo la prima apertura. */
export function pauseTicker() {
  _tickerRunning = false;
  // WarEra+: prima si fermava SOLO l'animazione. Il timer dati continuava a
  // girare per tutta la sessione dopo la prima apertura di Political — un
  // giro completo di elezioni ogni 5 minuti sotto la mappa, per un ticker
  // che nessuno stava guardando. E' la meta' del problema descritto in
  // testa al file: l'altra meta' e' quante richieste costa un giro.
  if (_tickerDataTimer) {
    clearInterval(_tickerDataTimer);
    _tickerDataTimer = null;
  }
}

export function resumeTicker() {
  if (!_tickerRunning) {
    _tickerRunning = true;
    requestAnimationFrame(_tickerLoop);
  }
  _startTickerData();
}

/** Avvia il giro dati periodico, con un giro immediato solo se quello che
 *  abbiamo in pancia e' piu' vecchio dell'intervallo — riaprire Political
 *  due volte di fila non deve rifare tutto da capo la seconda. */
function _startTickerData() {
  if (_tickerDataTimer) return;
  if (Date.now() - _lastTickerFetchAt >= TICKER_REFRESH_MS) fetchAllElectionsOnce();
  _tickerDataTimer = setInterval(fetchAllElectionsOnce, TICKER_REFRESH_MS);
}

/* ── INIT ── */
export function startTicker() {
  // The existing HTML is: .news-ticker-wrapper > #newsTicker
  // We replace #newsTicker's content and use it as the track directly.
  const container = document.getElementById('newsTicker');
  if (!container) return;

  // Turn #newsTicker into the moving track
  container.id = 'tickerTrack';
  container.style.cssText = [
    'white-space:nowrap',
    'display:inline-block',
    'will-change:transform',
    'animation:none',
    'transform:translateX(0)',
    'padding-left:0',
  ].join(';');
  container.innerHTML = '<span class="ticker-message">📡 Loading global elections...</span>';

  // Start RAF loop
  _tickerPos    = 0;
  _tickerRunning = true;
  requestAnimationFrame(_tickerLoop);

  // Fetch data (updates content without touching position)
  // WarEra+: il timer vive in _startTickerData, cosi' pauseTicker lo puo'
  // fermare davvero quando l'overlay Political si chiude.
  fetchAllElectionsOnce();
  _startTickerData();
}

// legacy compat
export function renderTicker() { _rebuildTickerContent(); }
