/* ── GLOBAL LOADING INDICATOR ── */
let _pendingRequests = 0;
let _loadingTimer = null;
let _stuckTimer = null;

function showLoading(message = 'Loading...', isManual = false) {
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

function hideLoading(isManual = false) {
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

// Wrapper per intercettare automaticamente le chiamate localFetch
const originalLocalFetch = window.localFetch;
if (originalLocalFetch) {
  window.localFetch = async function(path, params, options = {}) {
    showLoading(`Fetching ${path}...`);
    try {
      const result = await originalLocalFetch(path, params, options);
      hideLoading();
      return result;
    } catch (err) {
      hideLoading();
      throw err;
    }
  };
} else {
  console.warn('localFetch non ancora definita, verrà wrappata dopo il caricamento');
  // Se localFetch viene definita più tardi, possiamo eseguire il wrapping dopo il DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    if (window.localFetch && window.localFetch !== originalLocalFetch) {
      const original = window.localFetch;
      window.localFetch = async function(path, params, options) {
        showLoading(`Fetching ${path}...`);
        try {
          const res = await original(path, params, options);
          hideLoading();
          return res;
        } catch (err) {
          hideLoading();
          throw err;
        }
      };
    }
  });
}

// Funzioni manuali per operazioni pesanti non coperte da fetch (es. parse CSV, processamento lunghi)
function startHeavyOperation(message) {
  showLoading(message, true);
  _pendingRequests++; // incremento manuale
}

function endHeavyOperation() {
  hideLoading(true);
}