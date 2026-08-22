/* ══════════════════════════════════════════════════════════════
   WarEra+ — Caricamento moduli a richiesta, con rete di sicurezza
   ------------------------------------------------------------------
   Tutte le sezioni pesanti (Political, Eco, News, Unità Militari,
   Statistiche nazioni, Statistiche alleanze) arrivano con un `import()`
   dinamico: il chunk si scarica alla prima apertura. In produzione questo
   ha un modo di fallire che in locale non si vede mai.

   COSA SUCCEDE. Vercel pubblica un deploy nuovo e i nomi dei chunk
   cambiano (hanno l'hash del contenuto). Una scheda rimasta aperta da
   prima del deploy sta ancora eseguendo il vecchio `index.html`, quindi
   chiede un file che a quel punto può non esistere più: l'`import()`
   viene rifiutato, e chi non lo gestiva restava con la sezione vuota —
   sfondo a particelle e nient'altro (segnalato dall'utente su Statistiche
   alleanze, tipicamente dopo essere stato un po' su un'altra vista).

   COSA FA QUESTO MODULO.
     1. Riprova una volta dopo mezzo secondo: se era un buco di rete
        momentaneo, finisce qui e l'utente non si accorge di niente.
     2. Se fallisce ancora, ricarica la pagina UNA volta: la ricarica
        rimette l'`index.html` nuovo, con i nomi di chunk giusti, e
        l'utente si ritrova la sezione che aveva chiesto (`we_reload_intent`
        dice a chi riapre cosa stava cercando di aprire).
     3. Se anche dopo la ricarica fallisce (rete davvero giù), niente
        secondo giro — sarebbe un ciclo infinito di ricariche: si lascia
        decidere al chiamante, che mostra un messaggio con un bottone.

   La guardia contro il ciclo sta in sessionStorage e vale 60 secondi:
   sopravvive alla ricarica (che è il punto) ma non alla sessione.
   ══════════════════════════════════════════════════════════════ */

const RELOAD_GUARD_KEY = 'we_chunk_reload_at';
const RELOAD_GUARD_MS = 60_000;
/** Cosa l'utente stava aprendo quando è scattata la ricarica: chi fa il
 *  boot può leggerlo per riportarlo dov'era. */
export const RELOAD_INTENT_KEY = 'we_reload_intent';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function recentlyReloaded() {
  try {
    const at = Number(sessionStorage.getItem(RELOAD_GUARD_KEY) || 0);
    return at > 0 && (Date.now() - at) < RELOAD_GUARD_MS;
  } catch {
    return false;   // sessionStorage negato: meglio non ricaricare affatto
  }
}

function markReload(intent) {
  try {
    sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now()));
    if (intent) sessionStorage.setItem(RELOAD_INTENT_KEY, intent);
  } catch { /* niente storage: si ricarica lo stesso, senza memoria */ }
}

/**
 * @param {() => Promise<any>} loader  la `() => import('...')` vera e propria
 * @param {string} [intent]  etichetta della sezione, per il ripristino dopo
 *                           la ricarica (es. 'bloc-stats', 'political')
 * @returns {Promise<any>} il modulo, oppure rilancia l'errore
 */
export async function loadModule(loader, intent = '') {
  try {
    return await loader();
  } catch (err) {
    console.warn(`WarEra+ lazy: primo tentativo fallito${intent ? ` (${intent})` : ''}:`, err?.message);
    await sleep(500);
    try {
      return await loader();
    } catch (err2) {
      if (!recentlyReloaded()) {
        console.warn('WarEra+ lazy: chunk non raggiungibile, ricarico la pagina per prendere il deploy nuovo');
        markReload(intent);
        location.reload();
        // La ricarica non è istantanea: questa promise non si risolverà
        // mai, ed è giusto così — il chiamante non deve disegnare nulla
        // mentre la pagina se ne sta andando.
        return new Promise(() => {});
      }
      throw err2;
    }
  }
}

/** Cosa si stava aprendo prima della ricarica automatica (e lo consuma:
 *  vale una volta sola). */
export function takeReloadIntent() {
  try {
    const v = sessionStorage.getItem(RELOAD_INTENT_KEY);
    if (v) sessionStorage.removeItem(RELOAD_INTENT_KEY);
    return v || null;
  } catch {
    return null;
  }
}
