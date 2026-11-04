/* ══════════════════════════════════════════════════════════════
   WarEra+ — Proxy tRPC: VPS prima, Worker Cloudflare come rete
   ------------------------------------------------------------------
   PERCHE' ESISTE
   Le chiamate marcate `{ useWorker: true }` passavano dal Worker
   Cloudflare, che ha un tetto di 100.000 richieste al giorno sul piano
   gratuito — superato per la prima volta il 2026-08-24. Il tetto conta le
   richieste, quindi cresce col numero di utenti: non e' un picco da
   smussare, e' un limite strutturale che si ripresenta appena il tool
   cresce ancora.

   Il server di cache espone ora la STESSA route (`/trpc/*`, vedi
   server/warera-cache-server.js) con lo stesso upstream e la stessa
   API key server-side, e non ha quel tetto.

   COSA FA QUESTO MODULO
   Un solo punto che decide DOVE mandare una chiamata "da Worker":

     1. prova `TRPC_PROXY_BASE` (il VPS);
     2. se non risponde — errore di rete, timeout, o 502/503/504 che e'
        come il proxy dice "non ce l'ho fatta" — rifa' la STESSA richiesta
        sul Worker e apre un interruttore per qualche minuto, cosi' le
        chiamate successive vanno dritte al Worker invece di pagare ogni
        volta il costo del tentativo fallito.

   E' lo stesso principio di src/diplomacy/cacheClient.js: il VPS e'
   un'ottimizzazione, mai un nuovo punto di fallimento. Col VPS spento il
   tool torna a comportarsi esattamente come prima di questo modulo.

   COSA NON FA
   Non tocca le chiamate diverse da quelle "da Worker": chi passa un
   `workerBaseUrl` che non e' il Worker viene lasciato in pace (vedi
   `chainFor`), e le chiamate dirette ad api6 non passano di qui.

   NB: un 429 NON e' un fallimento del proxy — e' WarEra che dice di
   rallentare, e la stessa risposta sarebbe arrivata anche dal Worker.
   Va restituito al chiamante com'e', che ha gia' la sua politica di
   retry/backoff; ritentarlo sul Worker raddoppierebbe le richieste
   proprio nel momento in cui bisogna farne meno.
   ══════════════════════════════════════════════════════════════ */

import { WORKER_API_BASE, TRPC_PROXY_BASE } from '../diplomacy/config.js';

// Quanto resta chiuso il rubinetto verso il VPS dopo un fallimento. Stesso
// ordine di grandezza del circuit breaker di cacheClient.js (2 min): abbastanza
// da non insistere su un server che sta ripartendo (un `pm2 restart` dura
// pochi secondi), abbastanza poco da riprendere da solo senza un reload.
const PROXY_COOLDOWN_MS = 2 * 60 * 1000;

// Status che significano "il proxy non ce l'ha fatta", non "WarEra ha
// risposto cosi'". 502 e' quello che ritorna la nostra route quando la
// fetch verso api2 fallisce; 503/504 li puo' mettere nginx.
const PROXY_DOWN_STATUS = new Set([502, 503, 504]);

/* Quanto si aspetta il VPS prima di considerarlo perso e passare al Worker.
   Serve perche' il modo piu' comune in cui un VPS sta male non e' rifiutare
   la connessione (che darebbe subito un errore, gia' gestito) ne' rispondere
   502: e' ACCETTARE la connessione e non rispondere piu' — pm2 appeso, disco
   pieno, carico. Senza questo tetto la fetch resta in volo finche' non scade
   il timeout del browser (un minuto e mezzo o piu'), il breaker non si arma
   mai e la rete di sicurezza verso il Worker non entra mai in funzione: cioe'
   esattamente il punto singolo di fallimento che questo modulo esiste per
   evitare. Stesso ordine di grandezza dei 3s di cacheClient.js, un filo piu'
   largo perche' qui dietro c'e' una chiamata a WarEra, non un file su disco. */
const PROXY_ATTEMPT_TIMEOUT_MS = 5000;

/** Marcatore dell'attesa scaduta: si distingue da un errore vero del
 *  chiamante, che va invece propagato com'e' se arriva dall'ultima base. */
const _TIMED_OUT = Symbol('trpcProxy:timeout');

/* Corsa fra la fetch e il cronometro. Non si annulla la richiesta perduta:
   `doFetch` e' del chiamante (ognuno con il suo metodo, i suoi header e il
   suo eventuale AbortController) e imporgli un signal da qui vorrebbe dire
   sovrascrivere il suo. La richiesta abbandonata resta in volo finche' il
   browser non la chiude, ma sono al massimo una manciata: al primo scadere
   _markProxyDown() dirotta tutto sul Worker per due minuti. */
function _withDeadline(promise, ms) {
  let timer;
  const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(_TIMED_OUT), ms); });
  // La perdente della corsa non deve diventare una unhandled rejection.
  promise.catch(() => {});
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

let _proxyDownUntil = 0;

function _proxyDisabled() {
  return !TRPC_PROXY_BASE || Date.now() < _proxyDownUntil;
}

function _markProxyDown() {
  _proxyDownUntil = Date.now() + PROXY_COOLDOWN_MS;
}

/** Solo per i test/diagnostica: rimette il proxy in gioco subito. */
export function resetProxyState() {
  _proxyDownUntil = 0;
}

/** true se in questo momento le chiamate stanno andando sul Worker perche'
 *  il VPS ha fallito di recente. Usata dai test, non dalla UI. */
export function isProxyInCooldown() {
  return Date.now() < _proxyDownUntil;
}

/* ── La chiave dell'UTENTE (sfondo Wallpaper Engine) ──────────────────
   Proxy e Worker mettono la NOSTRA key, una sola per tutto il tool, con un
   tetto di 500 richieste al minuto. Quasi tutti i giocatori ne hanno una
   loro (la chiedono dalle impostazioni del gioco e la incollano già negli
   altri tool), e WarEra la accetta anche da una pagina web: il preflight
   CORS di api2 risponde `allow-headers: x-api-key` con origin `*`
   (verificato il 2026-10-11). Con quella chiave le chiamate "da Worker"
   vanno DRITTE ad api2 e consumano il budget di chi guarda, non quello
   condiviso.

   Oggi la imposta solo lo sfondo (src/app/wallpaperMode.js, dalle
   proprietà di Wallpaper Engine via postMessage). Sta in MEMORIA e basta:
   mai localStorage, mai un URL.

   Proxy e Worker restano dietro come rete, nello stesso ordine di sempre:
   - 401/403 = chiave rifiutata → la si accantona per la sessione e lo si
     annuncia (`wareraplus:apikey-status`), lo sfondo lo dice all'utente;
   - rete giù / timeout / 502-504 → pausa di PROXY_COOLDOWN_MS, come il VPS;
   - 429 → si restituisce com'è: è il limite della SUA chiave, e il
     backoff del chiamante è la risposta giusta, non spostare il carico
     sulla chiave di tutti. */
const USER_KEY_BASE = 'https://api2.warera.io';
let _userApiKey = '';
let _userKeyRejected = false;
let _userKeyConfirmed = false;
let _userKeyDownUntil = 0;

function _announceKey(status) {
  window.dispatchEvent(new CustomEvent('wareraplus:apikey-status', { detail: { status } }));
}

/** Imposta (o toglie, con '') la chiave dell'utente. */
export function setUserApiKey(key) {
  const k = String(key || '').trim();
  if (k === _userApiKey) return;
  _userApiKey = k;
  _userKeyRejected = false;
  _userKeyConfirmed = false;
  _userKeyDownUntil = 0;
  _announceKey(k ? 'pending' : 'none');
  if (k) _probeUserKey(k, 1);
}

/* Una chiave SBAGLIATA non la rifiuta nessuno: sulle procedure pubbliche
   WarEra la ignora e risponde 200 come a una richiesta anonima (misurato
   il 2026-10-12 con una chiave inventata). Il 200 di una chiamata normale
   quindi non dice niente, e "chiave attiva" sarebbe una bugia. La prova
   vera è una procedura PROTETTA: `transaction.getPaginatedTransactions`
   risponde 401 "API token required" senza una chiave valida. Una
   richiesta sola, con limit 1, a ogni chiave nuova.
   Finché la prova non ha risposto la chiave si usa lo stesso: se è
   sbagliata quelle chiamate valgono come anonime, sul limite dell'IP di
   chi guarda e non su quello condiviso. */
const PROBE_INPUT = encodeURIComponent(JSON.stringify({ transactionType: 'countryMoneyTransfer', limit: 1 }));

async function _probeUserKey(key, attempt) {
  try {
    const res = await fetch(`${USER_KEY_BASE}/trpc/transaction.getPaginatedTransactions?input=${PROBE_INPUT}`, {
      headers: { 'X-API-Key': key },
    });
    if (key !== _userApiKey) return; // cambiata nel frattempo
    if (res.ok) { _userKeyConfirmed = true; _announceKey('ok'); return; }
    if (res.status === 401 || res.status === 403) {
      _userKeyRejected = true;
      _announceKey('rejected');
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // Rete giù o WarEra di traverso: non è un verdetto sulla chiave.
    if (key !== _userApiKey || attempt >= 3) return;
    setTimeout(() => _probeUserKey(key, attempt + 1), 60 * 1000);
  }
}

/** 'none' | 'pending' | 'ok' | 'rejected' */
export function userApiKeyStatus() {
  if (!_userApiKey) return 'none';
  if (_userKeyRejected) return 'rejected';
  return _userKeyConfirmed ? 'ok' : 'pending';
}

function _userKeyUsable() {
  return Boolean(_userApiKey) && !_userKeyRejected && Date.now() >= _userKeyDownUntil;
}

/* Le procedure "MIE" (employee.getMyWorkforceSummary,
   employeeEvent.getPendingCount…) rispondono coi dati del titolare della
   chiave. Con la chiave di chi guarda sono le SUE, ed è giusto mostrarle;
   con quella del VPS sarebbero quelle del proprietario del tool, e infatti
   il proxy le respinge (TRPC_ALLOWED nel cache-server). Quindi qui solo
   api2 con la chiave dell'utente, CONFERMATA dalla prova: mai proxy né
   Worker, nemmeno come ripiego. `null` per qualunque cosa non vada. */
export async function userKeyCall(procedure, input) {
  if (!_userKeyUsable() || !_userKeyConfirmed) return null;
  const qs = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify(input))}`;
  try {
    const res = await fetch(`${USER_KEY_BASE}/trpc/${procedure}${qs}`, { headers: { 'X-API-Key': _userApiKey } });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.result?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Basi da provare, in ordine, per una chiamata destinata a `resolvedBase`.
 * Se non e' il Worker (es. una base custom, o api6 diretta) non c'e' niente
 * da deviare: si usa quella e basta.
 */
export function chainFor(resolvedBase) {
  if (resolvedBase !== WORKER_API_BASE) return [resolvedBase];
  const bases = [];
  if (_userKeyUsable()) bases.push(USER_KEY_BASE);
  if (!_proxyDisabled()) bases.push(TRPC_PROXY_BASE);
  bases.push(WORKER_API_BASE);
  return bases;
}

/** Una base che non ha risposto si mette in pausa: la chiave dell'utente
 *  per conto suo, il VPS col suo interruttore di sempre. */
function _markDown(base) {
  if (base === USER_KEY_BASE) _userKeyDownUntil = Date.now() + PROXY_COOLDOWN_MS;
  else _markProxyDown();
}

/**
 * Esegue la richiesta provando le basi in ordine.
 *
 * @param {string} resolvedBase  la base che il chiamante avrebbe usato prima
 * @param {(base: string) => string} buildUrl  compone l'URL da una base
 * @param {(url: string, extraHeaders?: object) => Promise<Response>} doFetch
 *        la fetch vera del chiamante (con i suoi timeout/opzioni/metodo:
 *        questo modulo non impone la sua, cosi' GET di Diplomacy e POST di
 *        Political mantengono ognuno il proprio comportamento). Il secondo
 *        argomento c'e' solo sulla base con la chiave dell'utente
 *        (`X-API-Key`) e il chiamante lo fonde nei suoi header. Sui
 *        tentativi che NON sono l'ultimo vale in piu'
 *        PROXY_ATTEMPT_TIMEOUT_MS: e' il tempo oltre il quale una base si
 *        considera persa, indipendentemente da quanto sia paziente il
 *        chiamante.
 */
export async function fetchWithProxyChain(resolvedBase, buildUrl, doFetch) {
  const bases = chainFor(resolvedBase);
  let lastErr = null;

  for (let i = 0; i < bases.length; i++) {
    const isLast = i === bases.length - 1;
    const base = bases[i];
    const isUserKey = base === USER_KEY_BASE;
    try {
      const attempt = isUserKey
        ? doFetch(buildUrl(base), { 'X-API-Key': _userApiKey })
        : doFetch(buildUrl(base));
      // Il cronometro vale solo per i tentativi che hanno una rete sotto:
      // sull'ultima base (il Worker) non c'e' piu' dove ricadere, e vale il
      // timeout del chiamante — che e' quello giusto, perche' li' la risposta
      // lenta e' di WarEra, non di un proxy che non sta rispondendo.
      const res = isLast ? await attempt : await _withDeadline(attempt, PROXY_ATTEMPT_TIMEOUT_MS);
      if (res === _TIMED_OUT) {
        console.warn(`[trpcProxy] ${base} non ha risposto entro ${PROXY_ATTEMPT_TIMEOUT_MS}ms, passo alla base successiva`);
        _markDown(base);
        continue;
      }
      if (isUserKey && (res.status === 401 || res.status === 403)) {
        console.warn(`[trpcProxy] chiave API dell'utente rifiutata (${res.status}), uso il server condiviso`);
        _userKeyRejected = true;
        _announceKey('rejected');
        continue;
      }
      if (!isLast && PROXY_DOWN_STATUS.has(res.status)) {
        console.warn(`[trpcProxy] ${base} ha risposto ${res.status}, passo alla base successiva`);
        _markDown(base);
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (isLast) break;
      console.warn(`[trpcProxy] ${base} non raggiungibile (${err.message}), passo alla base successiva`);
      _markDown(base);
    }
  }

  throw lastErr || new Error('trpcProxy: nessuna base disponibile');
}

/**
 * GET "da Worker" gia' incatenata: VPS prima, Worker come rete.
 * WarEra+: per le poche fetch dirette al Worker rimaste fuori da
 * trpcBatch/trpcClient (lista battaglie di ripiego, dati live singoli,
 * fallback di cacheClient.js). Prima andavano dritte al Worker e quindi,
 * a tetto giornaliero raggiunto, rispondevano 429 anche col VPS sano.
 * @param {string} pathAndQuery  es. `/trpc/battle.getById?input=...`
 */
export function workerGet(pathAndQuery) {
  return fetchWithProxyChain(WORKER_API_BASE, base => `${base}${pathAndQuery}`,
    (url, extra) => fetch(url, extra ? { headers: extra } : undefined));
}
