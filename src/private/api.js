/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — client dell'API
   ------------------------------------------------------------------
   L'unica parte del tool che parla con un server AUTENTICATO. Tutto il
   resto (mappa, unità, battaglie, rendite) legge dati pubblici e non sa
   nemmeno chi sei.

   ── DOVE STA IL TOKEN, E PERCHÉ LÌ ─────────────────────────────────
   In localStorage, e viaggia nell'header Authorization. Non un cookie:
   il server di cache espone origin:'*' e i cookie obbligherebbero a
   un'allowlist con credenziali, più tutta la superficie CSRF che ne
   segue — un browser i cookie li manda da solo, un header no.
   Il prezzo è che un XSS potrebbe leggerlo; il tool però non inietta
   mai HTML di terzi, e la scelta opposta pagherebbe un rischio
   maggiore per pararne uno minore.

   ── IL RITORNO DA DISCORD ──────────────────────────────────────────
   Il server rimanda il browser su `<origin>/#wp_auth=<token>`. Passa dal
   FRAMMENTO e non dalla query per due motivi: il frammento non viene
   mandato al server nelle richieste successive e non finisce nei log di
   nessuno, e la query è già occupata dai deep-link del tool (?country=,
   ?tm=) che non vanno disturbati.

   A raccoglierlo NON è questo file ma src/app/privateOverlay.js, che è
   caricato staticamente: la cattura deve avvenire al boot, e farla da qui
   vorrebbe dire scaricare l'intera vista anche a chi non la aprirà mai.
   Qui si legge solo il token già depositato in localStorage.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_PLUS_API_BASE } from '../diplomacy/config.js';

const TOKEN_KEY = 'wp_plus_token';

// localStorage può lanciare (modalità privata, cookie di terze parti
// bloccati, storage pieno): l'area riservata non deve poter buttare giù
// il tool per una preferenza del browser.
function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignora */ } }
function safeDel(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } }

export function getToken() { return safeGet(TOKEN_KEY); }
export function setToken(t) { if (t) safeSet(TOKEN_KEY, t); }
export function clearToken() { safeDel(TOKEN_KEY); }

// ---------------------------------------------------------------------------
// Chiamate
// ---------------------------------------------------------------------------

async function call(path, { method = 'GET', body } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });

  // 401 = la sessione non vale più (scaduta, o il database è stato
  // ricreato). Si butta il token invece di lasciare l'utente in un limbo
  // in cui il tool crede di essere loggato e il server no.
  if (res.status === 401) { clearToken(); return null; }
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

/** L'account della sessione corrente, o null se non c'è o non vale più. */
export async function fetchMe() {
  if (!getToken()) return null;
  try {
    const data = await call('/auth/me');
    return data?.account || null;
  } catch (err) {
    // Server irraggiungibile: si distingue dal "non loggato", perché la
    // vista deve dire due cose diverse. Un tool giù non è un logout.
    console.warn('[area riservata] /auth/me non raggiungibile:', err.message);
    throw err;
  }
}

export async function logout() {
  try { await call('/auth/logout', { method: 'POST' }); } catch { /* si esce comunque */ }
  clearToken();
}

/** URL a cui mandare il browser per iniziare il giro OAuth. */
export function loginUrl() {
  return `${WARERA_PLUS_API_BASE}/auth/discord/start?origin=${encodeURIComponent(location.origin)}`;
}

/** Stato del servizio, per distinguere "server giù" da "non configurato". */
export async function fetchHealth() {
  const res = await fetch(`${WARERA_PLUS_API_BASE}/health`);
  if (!res.ok) throw new Error(`health: HTTP ${res.status}`);
  return res.json();
}
