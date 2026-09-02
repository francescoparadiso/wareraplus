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

// ---------------------------------------------------------------------------
// Collegamento del personaggio di gioco
// ---------------------------------------------------------------------------
// Le quattro procedure WarEra dietro a questo giro sono tutte PUBBLICHE, ma
// le chiama il SERVER e non il browser: la prova deve valere qualcosa, e una
// verifica fatta dal client è una verifica che il client può raccontare come
// vuole. Qui si parla solo con la nostra API.

/** Errore che porta con sé il codice dell'API, così la vista può tradurlo
 *  invece di mostrare "HTTP 409" a chi ha appena premuto un bottone. */
export class ApiError extends Error {
  constructor(codice, stato) { super(codice); this.codice = codice; this.stato = stato; }
}

async function callOrThrow(path, body) {
  const token = getToken();
  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const dati = await res.json().catch(() => ({}));
  if (res.status === 401) { clearToken(); throw new ApiError('non_autenticato', 401); }
  if (!res.ok) throw new ApiError(dati.error || 'errore_server', res.status);
  return dati;
}

/** Candidati per un nome: i nomi in WarEra non sono univoci, quindi la
 *  scelta la fa l'utente guardando avatar e nazione. */
export function cercaPersonaggio(username) {
  return callOrThrow('/verify/search', { username });
}

export function iniziaVerifica(warUserId) {
  return callOrThrow('/verify/start', { warUserId });
}

export function controllaVerifica() {
  return callOrThrow('/verify/check');
}

export function annullaVerifica() {
  return callOrThrow('/verify/cancel');
}

export function scollegaPersonaggio() {
  return callOrThrow('/verify/unlink');
}

/** Richiesta in corso, per ritrovare il codice riaprendo la vista invece di
 *  doverne chiedere un altro (e ripartire da capo coi trenta minuti). */
export async function statoVerifica() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch(`${WARERA_PLUS_API_BASE}/verify/state`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return (await res.json()).claim || null;
}

// ---------------------------------------------------------------------------
// Ruoli e amministrazione
// ---------------------------------------------------------------------------

async function getJson(path) {
  const token = getToken();
  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const dati = await res.json().catch(() => ({}));
  if (res.status === 401) { clearToken(); throw new ApiError('non_autenticato', 401); }
  if (!res.ok) throw new ApiError(dati.error || 'errore_server', res.status);
  return dati;
}

/** Ruoli propri, oppure — solo per un amministratore — quelli di un altro.
 *  La lente `asAccount` è di SOLA LETTURA lato server: serve a capire
 *  perché qualcuno non vede quello che dovrebbe, non ad agire al suo posto. */
export function leggiRuoli({ asAccount = null, refresh = false } = {}) {
  const q = new URLSearchParams();
  if (asAccount) q.set('asAccount', String(asAccount));
  if (refresh) q.set('refresh', '1');
  const qs = q.toString();
  return getJson(`/roles/me${qs ? `?${qs}` : ''}`);
}

export async function elencoAccount() {
  return (await getJson('/roles/admin/accounts')).accounts || [];
}

export function metteDeroga(dati) {
  return callOrThrow('/roles/admin/override', dati);
}

export function togliDeroga(dati) {
  return callOrThrow('/roles/admin/override/remove', dati);
}

export function nominaAdmin(accountId, admin) {
  return callOrThrow('/roles/admin/set-admin', { accountId, admin });
}

/** Collegamento a mano, per chi un'azienda non ce l'ha. */
export function collegaAMano(accountId, warUserId, reason) {
  return callOrThrow('/verify/admin-link', { accountId, warUserId, reason });
}

// ---------------------------------------------------------------------------
// Il tavolo delle prenotazioni
// ---------------------------------------------------------------------------
// Ogni chiamata porta `asAccount` quando la lente è attiva: è il server a
// risolvere l'identità e a rifiutare le scritture, ma il client deve
// comunque dirgli chi sta guardando.

function conLente(path, asAccount) {
  return asAccount ? `${path}${path.includes('?') ? '&' : '?'}asAccount=${asAccount}` : path;
}

export function leggiTavolo({ asAccount = null } = {}) {
  return getJson(conLente('/requests', asAccount));
}

export function chiediContratto(dati) {
  return callOrThrow('/requests', dati);
}

export function approvaRichiesta(id) { return callOrThrow(`/requests/${id}/approve`); }
export function rifiutaRichiesta(id) { return callOrThrow(`/requests/${id}/reject`); }
export function segnaAperta(id) { return callOrThrow(`/requests/${id}/opened`); }
export function ritiraRichiesta(id) { return callOrThrow(`/requests/${id}/cancel`); }

export function leggiCanale(scopeType, scopeId) {
  return getJson(`/requests/webhooks/${scopeType}/${scopeId}`);
}

export function impostaCanale(scopeType, scopeId, url) {
  return callOrThrow(`/requests/webhooks/${scopeType}/${scopeId}`, { url });
}

/** Battaglie in corso, dal server di cache: pubbliche, nessuna
 *  autenticazione, e sono le stesse che alimentano i marker sulla mappa —
 *  non si apre una seconda sorgente per la stessa cosa. */
export async function battaglieInCorso() {
  const { WARERA_CACHE_BASE } = await import('../diplomacy/config.js');
  const res = await fetch(`${WARERA_CACHE_BASE}/battles`);
  if (!res.ok) return [];
  const body = await res.json();
  return body?.data || [];
}
