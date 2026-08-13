/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: loading.js come modulo ES (Fase 2, Stage 4)
   ------------------------------------------------------------------
   Elimina il monkey-patch dell'originale (`window.localFetch = wrapper`).
   Quel pattern funzionava SOLO perché in script classici una function
   declaration è aliasata al binding globale condiviso: riassegnare
   `window.localFetch` cambiava anche a cosa risolveva l'identificatore
   nudo `localFetch` in tutti gli altri file. Con `import { localFetch }
   from './api.js'`, chi importa quel binding lo ha già "congelato" per
   nome — riassegnare `window.localFetch` altrove non lo cambia più
   (e in un modulo ES non esisterebbe nemmeno `window.localFetch` da
   riassegnare).

   Soluzione: showLoading/hideLoading vengono chiamate DIRETTAMENTE
   dentro src/political/api.js: localFetch, invece di essere iniettate
   dall'esterno via monkey-patch — stesso comportamento runtime (ogni
   chiamata mostra/nasconde il loader), zero dipendenza dall'aliasing
   globale. Il ramo "se localFetch non è ancora definita, wrappa dopo
   DOMContentLoaded" era un workaround per l'ordine dei tag <script>
   (api.js prima di loading.js) — non più necessario con import ES
   che garantiscono l'ordine di inizializzazione per costruzione.
   ══════════════════════════════════════════════════════════════ */

let _pendingRequests = 0;
let _loadingTimer = null;
let _stuckTimer = null;

export function showLoading(message = 'Loading...', isManual = false) {
  const toast = document.getElementById('loadingToast');
  const msgSpan = document.getElementById('loadingMessage');
  if (!toast) return;

  if (!isManual) _pendingRequests++;

  // Safety net: se per qualche errore non gestito il contatore resta bloccato,
  // forza il reset dopo 15s così la barra non rimane appesa per sempre.
  if (_stuckTimer) clearTimeout(_stuckTimer);
  _stuckTimer = setTimeout(() => {
    if (_pendingRequests > 0) {
      console.warn('Loading counter stuck, forcing reset');
      _pendingRequests = 0;
      hideLoading(true);
    }
  }, 15000);

  if (_loadingTimer) clearTimeout(_loadingTimer);

  msgSpan.textContent = message;
  toast.style.opacity = '1';

  // Aggiorna barra di progresso (simula indeterminate se non abbiamo percentuale)
  const progressBar = document.getElementById('globalProgressBar');
  if (progressBar) {
    if (_pendingRequests > 0) {
      // Barra animata "indeterminata" (cresce e si restringe lievemente)
      progressBar.style.width = '70%';
      progressBar.style.transition = 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
      setTimeout(() => { if (_pendingRequests > 0) progressBar.style.width = '85%'; }, 400);
    } else {
      progressBar.style.width = '0%';
    }
  }
}

export function hideLoading(isManual = false) {
  if (!isManual) {
    if (_pendingRequests > 0) _pendingRequests--;
    if (_pendingRequests > 0) return; // ancora richieste in corso
  }

  const toast = document.getElementById('loadingToast');
  const progressBar = document.getElementById('globalProgressBar');
  if (toast) {
    toast.style.opacity = '0';
    _loadingTimer = setTimeout(() => {
      if (_pendingRequests === 0) toast.style.opacity = '0';
    }, 300);
  }
  if (progressBar) {
    progressBar.style.width = '100%';
    setTimeout(() => { if (_pendingRequests === 0) progressBar.style.width = '0%'; }, 200);
  }
}

// Funzioni manuali per operazioni pesanti non coperte da fetch (es. parse CSV, processamento lunghi)
export function startHeavyOperation(message) {
  showLoading(message, true);
  _pendingRequests++; // incremento manuale
}

export function endHeavyOperation() {
  hideLoading(true);
}
