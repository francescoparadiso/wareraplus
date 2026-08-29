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

/**
 * Basi da provare, in ordine, per una chiamata destinata a `resolvedBase`.
 * Se non e' il Worker (es. una base custom, o api6 diretta) non c'e' niente
 * da deviare: si usa quella e basta.
 */
export function chainFor(resolvedBase) {
  if (resolvedBase !== WORKER_API_BASE) return [resolvedBase];
  if (_proxyDisabled()) return [WORKER_API_BASE];
  return [TRPC_PROXY_BASE, WORKER_API_BASE];
}

/**
 * Esegue la richiesta provando le basi in ordine.
 *
 * @param {string} resolvedBase  la base che il chiamante avrebbe usato prima
 * @param {(base: string) => string} buildUrl  compone l'URL da una base
 * @param {(url: string) => Promise<Response>} doFetch  la fetch vera del
 *        chiamante (con i suoi timeout/opzioni/metodo: questo modulo non
 *        impone la sua, cosi' GET di Diplomacy e POST di Political
 *        mantengono ognuno il proprio comportamento). Sui tentativi che
 *        NON sono l'ultimo vale in piu' PROXY_ATTEMPT_TIMEOUT_MS: e' il
 *        tempo oltre il quale il VPS si considera perso, indipendentemente
 *        da quanto sia paziente il chiamante.
 */
export async function fetchWithProxyChain(resolvedBase, buildUrl, doFetch) {
  const bases = chainFor(resolvedBase);
  let lastErr = null;

  for (let i = 0; i < bases.length; i++) {
    const isLast = i === bases.length - 1;
    const base = bases[i];
    try {
      // Il cronometro vale solo per i tentativi che hanno una rete sotto:
      // sull'ultima base (il Worker) non c'e' piu' dove ricadere, e vale il
      // timeout del chiamante — che e' quello giusto, perche' li' la risposta
      // lenta e' di WarEra, non di un proxy che non sta rispondendo.
      const res = isLast
        ? await doFetch(buildUrl(base))
        : await _withDeadline(doFetch(buildUrl(base)), PROXY_ATTEMPT_TIMEOUT_MS);
      if (res === _TIMED_OUT) {
        console.warn(`[trpcProxy] ${base} non ha risposto entro ${PROXY_ATTEMPT_TIMEOUT_MS}ms, passo al Worker`);
        _markProxyDown();
        continue;
      }
      if (!isLast && PROXY_DOWN_STATUS.has(res.status)) {
        console.warn(`[trpcProxy] ${base} ha risposto ${res.status}, passo al Worker`);
        _markProxyDown();
        continue;
      }
      return res;
    } catch (err) {
      lastErr = err;
      if (isLast) break;
      console.warn(`[trpcProxy] ${base} non raggiungibile (${err.message}), passo al Worker`);
      _markProxyDown();
    }
  }

  throw lastErr || new Error('trpcProxy: nessuna base disponibile');
}
