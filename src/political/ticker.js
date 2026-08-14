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

let _tickerMessages = [];
let _tickerPos = 0;
let _tickerSpeed = 0.55;
let _tickerRunning = false;
let _tickerUnitWidth = 0;

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
async function fetchAllElectionsOnce() {
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

    // ── Fase 1: elezioni per ogni paese, tutte in parallelo (stesso microtask → un unico batch) ──
    const perCountry = await Promise.all(
      allCountries.map(country =>
        localFetch('/elections', { countryId: country._id }, { useCache: true, ttl: 3 * 60 * 1000 })
          .then(data => ({ country, elections: data?.items || [] }))
          .catch(() => ({ country, elections: [] }))
      )
    );

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
        localFetch('/election', { id: r.e._id }, { useCache: true, ttl: now >= r.start ? 2 * 60 * 1000 : 5 * 60 * 1000 })
          .catch(() => null)
      )
    );

    const messages = relevant.map((r, idx) => {
      const { e, countryName, start, end } = r;
      const detail    = details[idx];
      const type      = e.type === 'president' ? 'PRES' : 'CONG';
      const startDate = new Date(start).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
      const endDate   = new Date(end).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

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
  fetchAllElectionsOnce();
  setInterval(fetchAllElectionsOnce, 5 * 60 * 1000);
}

// legacy compat
export function renderTicker() { _rebuildTickerContent(); }
