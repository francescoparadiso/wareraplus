import { API_BASE_URL, WORKER_API_BASE } from './config.js';
import { state } from './state.js';
import { trackThrottled } from '../shared/analytics.js';

// ==================== NAZIONI ====================
// Lookup nazione da countryId. Era duplicata identica in battleMarkers.js e
// battleFront.js (entrambe `state.nationMap.get(countryId) || null`) — unica
// versione qui, importata da entrambe.
export function getNation(countryId) {
  if (!countryId) return null;
  return state.nationMap.get(countryId) || null;
}

// ==================== BATCHING tRPC ====================
// Combina più procedure tRPC in un unico POST (?batch=1), riducendo il
// consumo di rate limit (1 richiesta invece di N). Vedi warera-api-batching.md.
// calls: array di [endpoint, params] es. [['battle.getById', { battleId }], ...]
// Ritorna: array di risultati unwrapped nello stesso ordine di `calls`.
//          Gli item falliti (error / 429 / eccezioni) sono `null`.
//
// WarEra+: opzione { useWorker: true } instrada la chiamata attraverso il
// Worker Cloudflare già usato da Political View (config.js:
// WORKER_API_BASE), che aggiunge un API_TOKEN server-side alzando il
// limite da 100 a 500 batch/minuto. Usata SOLO per battaglie ed
// elezioni/parlamenti (le fonti principali di 429 segnalate) — tutte le
// altre chiamate (alleanze/blocchi, country, region, map) restano sul
// default api6 diretto, come richiesto esplicitamente per i blocchi.
export const MAX_BATCH = 50;

// WarEra+: prima un 429 falliva subito senza alcun tentativo aggiuntivo
// (da qui "quelle che falliscono danno nessun parlamento caricato e
// basta" segnalato) — ora ritenta fino a MAX_RETRY_ATTEMPTS volte con
// backoff esponenziale prima di arrendersi e restituire null.
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 1200;

function _sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

export async function trpcBatch(calls, { useWorker = false, _attempt = 1 } = {}) {
  if (!calls || !calls.length) return [];
  if (calls.length > MAX_BATCH) {
    // Chunk automatico se si supera il limite, per sicurezza
    const chunks = [];
    for (let i = 0; i < calls.length; i += MAX_BATCH) chunks.push(calls.slice(i, i + MAX_BATCH));
    const results = [];
    for (const chunk of chunks) results.push(...(await trpcBatch(chunk, { useWorker })));
    return results;
  }

  try {
    const base = useWorker ? WORKER_API_BASE : API_BASE_URL;
    const procedureNames = calls.map(([proc]) => proc).join(',');
    const batchInput = {};
    calls.forEach(([, params], idx) => { batchInput[idx] = params || {}; });
    const url = `${base}/trpc/${procedureNames}?batch=1&input=${encodeURIComponent(JSON.stringify(batchInput))}`;
    const res = await fetch(url);

    if (res.status === 429) {
      if (_attempt <= MAX_RETRY_ATTEMPTS) {
        const retryAfterHeader = parseFloat(res.headers.get('Retry-After'));
        const waitMs = !isNaN(retryAfterHeader) ? retryAfterHeader * 1000 : RETRY_BASE_MS * Math.pow(2, _attempt - 1);
        await _sleep(waitMs);
        return trpcBatch(calls, { useWorker, _attempt: _attempt + 1 });
      }
      showRateLimitTooltip('trpc-batch');
      return calls.map(() => null);
    }
    // WarEra+: 404 qui è quasi sempre una entità sparita lato WarEra (es.
    // party.getById su un partito sciolto/cancellato dopo l'elezione a cui
    // apparteneva un candidato) — non un fallimento di rete/cache. Prima
    // finiva nel ramo generico sotto (`throw` → catch → console.error con
    // stack completo), rumoroso in console per un caso già gestito
    // correttamente a valle (i chiamanti trattano `null` come "non
    // disponibile" e degradano senza rompersi). Log silenzioso, stesso
    // comportamento di ritorno (null per ogni call del batch).
    if (res.status === 404) {
      console.debug(`trpcBatch: 404 (entità non trovata, es. partito/elezione rimossa) su ${procedureNames}`);
      return calls.map(() => null);
    }
    if (!res.ok) throw new Error(`Batch HTTP ${res.status}`);

    const results = await res.json();
    return results.map(item => {
      if (!item || item.error) {
        if (item?.error) console.warn('trpcBatch item error:', item.error);
        return null;
      }
      return item.result?.data?.json ?? item.result?.data ?? null;
    });
  } catch (err) {
    console.error('trpcBatch error:', err);
    return calls.map(() => null);
  }
}
// ==================== CSV ====================
function parseLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') { inQuotes = !inQuotes; }
    else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += char; }
  }
  result.push(current.trim());
  return result;
}
// ==================== TOOLTIP 429 ====================
let rateLimitTooltip = null;
let rateLimitTimeout = null;

// WarEra+ (richiesta esplicita: "controlla soprattutto l'errore 429").
// Chiamata SOLO dopo che i retry con backoff sono stati esauriti (vedi
// sopra) — quindi ogni chiamata qui è un vero "l'utente ha sentito il
// rate limit", non un 429 riassorbito in automatico. `source` distingue
// da dove arriva (trpcBatch stesso, o le due fetch dirette di
// battleHeatmap.js che non passano da trpcBatch) senza cambiare la
// firma per i chiamanti esistenti (parametro opzionale).
// trackThrottled (non trackEvent): durante un vero rate-limit le chiamate
// in parallelo falliscono quasi insieme — senza throttle un solo utente
// genererebbe decine di eventi identici nello stesso istante.
export function showRateLimitTooltip(source = 'unknown') {
  trackThrottled('rate-limit-429', { source });
  // Rimuovi il tooltip esistente se presente
  hideRateLimitTooltip();
  
  // Crea il tooltip
  rateLimitTooltip = document.createElement('div');
  rateLimitTooltip.id = 'rate-limit-tooltip';
  rateLimitTooltip.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) scale(0.9);
    background: rgba(13, 17, 23, 0.97);
    border: 1px solid rgba(255, 165, 0, 0.5);
    border-radius: 16px;
    padding: 24px 32px;
    z-index: 99999;
    color: #e6edf3;
    font-family: 'Inter', -apple-system, sans-serif;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(12px);
    max-width: 380px;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
  `;
  
  rateLimitTooltip.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 12px;">⏳</div>
    <div style="font-size: 18px; font-weight: 700; color: #ff9100; margin-bottom: 8px;">Too Many Requests</div>
    <div style="font-size: 14px; color: #8b949e; line-height: 1.5;">
      The server is receiving too many requests.<br>
      Please wait a moment before trying again.
    </div>
    <div style="margin-top: 16px; font-size: 12px; color: #484f58;">
      ⚡ Rate limit exceeded
    </div>
  `;
  
  document.body.appendChild(rateLimitTooltip);
  
  // Animazione di entrata
  requestAnimationFrame(() => {
    rateLimitTooltip.style.opacity = '1';
    rateLimitTooltip.style.transform = 'translate(-50%, -50%) scale(1)';
  });
  
  // Auto-remove dopo 4 secondi
  if (rateLimitTimeout) clearTimeout(rateLimitTimeout);
  rateLimitTimeout = setTimeout(() => {
    hideRateLimitTooltip();
  }, 4000);
}

export function hideRateLimitTooltip() {
  if (rateLimitTooltip) {
    rateLimitTooltip.style.opacity = '0';
    rateLimitTooltip.style.transform = 'translate(-50%, -50%) scale(0.9)';
    setTimeout(() => {
      if (rateLimitTooltip && rateLimitTooltip.parentNode) {
        rateLimitTooltip.parentNode.removeChild(rateLimitTooltip);
      }
      rateLimitTooltip = null;
    }, 300);
  }
  if (rateLimitTimeout) {
    clearTimeout(rateLimitTimeout);
    rateLimitTimeout = null;
  }
}

// fetchWithAuth rimossa insieme ad API_KEY: non era usata da nessun modulo e
// l'unico effetto era esporre la chiave nel bundle client.

export function parseCSV(csvText) {
  const rows = [];
  const lines = csvText.trim().split(/\r?\n/);
  if (lines.length < 2) return rows;
  const headers = parseLine(lines[0]);
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.length === headers.length) {
      const row = {};
      headers.forEach((h, idx) => { row[h] = values[idx]; });
      rows.push(row);
    }
  }
  return rows;
}
export function fmtNumber(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ==================== ESCAPE HTML ====================
// I nomi nazione/alleanza arrivano dall'API di gioco e finivano dritti dentro
// innerHTML in decine di punti: se un giocatore puo' scegliere il nome del
// proprio paese, e' una XSS. Usare SEMPRE su testo non fidato interpolato.
export function escapeHtml(v) {
  if (v == null) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ==================== TOAST ====================
// Implementazione unica (con icone e progress bar). Prima ne esistevano due,
// una qui e una in ui.js: i moduli importavano l'una o l'altra e i toast
// avevano due aspetti diversi nella stessa app. Sta in utils.js e non in
// ui.js per evitare il ciclo di import ui <-> utils.
const TOAST_ICONS = {
  info: '💬',
  success: '✅',
  error: '❌',
  warning: '⚠️',
};

export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const parts = message.split(' | ');
  const title = parts[0];
  const detail = parts[1] || '';
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `
    <div class="toast-icon ${type}">${TOAST_ICONS[type] || '💬'}</div>
    <div class="toast-body">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${detail ? `<div class="toast-msg">${escapeHtml(detail)}</div>` : ''}
      <div class="toast-progress"><div class="toast-prog-fill ${type}"></div></div>
    </div>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}


// ==================== LOADING ====================
export function showLoading() {
  document.getElementById('loading-overlay').style.display = 'flex';
}
export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  el.style.opacity = '0';
  setTimeout(() => { el.style.display = 'none'; }, 300);
}

// ==================== COLORI ====================
export function hashColor(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 45%, 32%)`;
}

// ==================== GEOMETRY ====================
export function flattenCoords(geometry) {
  const result = [];
  function extract(c) {
    if (!c) return;
    if (typeof c[0] === 'number') result.push(c);
    else c.forEach(extract);
  }
  extract(geometry.coordinates);
  return result;
}