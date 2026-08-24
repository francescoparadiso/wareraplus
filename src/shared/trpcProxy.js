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
 *        mantengono ognuno il proprio comportamento)
 */
export async function fetchWithProxyChain(resolvedBase, buildUrl, doFetch) {
  const bases = chainFor(resolvedBase);
  let lastErr = null;

  for (let i = 0; i < bases.length; i++) {
    const isLast = i === bases.length - 1;
    const base = bases[i];
    try {
      const res = await doFetch(buildUrl(base));
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
