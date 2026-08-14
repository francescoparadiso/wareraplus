/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Political View (Fase 2, Stage 9 — CUTOVER)
   ------------------------------------------------------------------
   Fino a questo stage, Political View girava in un <iframe> che
   caricava public/political/index.html (codice invariato, script
   globali) — comunicando con lo shell solo via CustomEvent perché
   `let`/`const` dichiarate in uno script classico non diventano
   proprietà di `window`, quindi `frameEl.contentWindow.SenateView`
   era sempre `undefined` dall'esterno anche se `SenateView` esisteva
   dentro l'iframe.

   Da questo stage, Political View è un vero modulo ES (src/political/,
   Stage 2-8) montato IN-PAGE dentro #wp-political-root, nello stesso
   documento dello shell. Tutta la complessità precedente sparisce:
   - Niente più iframe, niente più `frameEl.src` per "ricaricare".
   - Niente più attesa di un evento 'load' del documento iframe.
   - Niente più `wareraplus:elections-ready`/`wareraplus:open-senate`
     dispatchati/ascoltati attraverso il confine dell'iframe con
     timeout di sicurezza a 15s: `initPoliticalView()` (Stage 8) è una
     Promise che si risolve solo a dati caricati (o falliti), quindi
     `await`-arla è già la garanzia che serviva — l'apertura del
     senato (`options.openSenate`) è gestita DENTRO initPoliticalView
     stessa, non più qui.
   - `import()` dinamico (non statico in testa al file): il bundle di
     Political (~300KB con Chart.js/D3/TomSelect/Sortable) si scarica
     solo alla PRIMA apertura, non al boot dell'app — questo file
     (politicalOverlay.js) è importato staticamente da src/main.js e
     src/panel/countryPanel.js fin dal boot, quindi un import statico
     di src/political/main.js qui trascinerebbe l'intero bundle
     Political nel chunk principale.

   public/political/ (i file originali, invariati) RESTANO nel repo
   come riferimento/rollback fisico — vedi CLAUDE.md, non sono stati
   cancellati in questo stage, solo non più referenziati da nessun
   path attivo dell'app.
   ══════════════════════════════════════════════════════════════ */

let overlayEl, backBtn, titleEl;

export function initPoliticalOverlay() {
  overlayEl = document.getElementById('wp-political-overlay');
  backBtn = document.getElementById('wp-political-back');
  titleEl = document.getElementById('wp-political-title');

  backBtn.addEventListener('click', closePoliticalView);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) {
      closePoliticalView();
    }
  });
}

/**
 * Apre Political View per una nazione specifica.
 * @param {string} countryId - _id WarEra della nazione
 * @param {string} [countryName] - solo per il titolo mostrato in top bar
 * @param {{ openSenate?: boolean }} [options]
 */
export async function openPoliticalView(countryId, countryName = '', options = {}) {
  titleEl.textContent = countryName ? `— ${countryName}` : '';
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');

  // Import dinamico: scarica il chunk Political solo qui, alla prima
  // apertura reale (poi resta in cache del browser/module graph per le
  // aperture successive). initPoliticalView è idempotente: se già
  // montata, cambia nazione solo se diversa da quella corrente (Stage 8).
  const { initPoliticalView, resumePoliticalRendering } = await import('../political/main.js');
  await initPoliticalView(countryId, options);
  // WarEra+ perf: riavvia canvas/ticker se erano stati fermati da una
  // chiusura precedente (no-op alla primissima apertura — vedi
  // resumePoliticalRendering in political/main.js).
  resumePoliticalRendering();

  if (window.umami) {
    window.umami.track('wareraplus-expand-political', { countryId, openSenate: !!options.openSenate });
  }
}

export function closePoliticalView() {
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
  // WarEra+ perf: Political resta montata (solo nascosta) per riaprirla
  // istantaneamente — ma i suoi loop continui (canvas particellare, ticker)
  // vanno fermati esplicitamente, altrimenti girerebbero per sempre in
  // background anche a overlay chiuso (causa maggiore del consumo CPU
  // elevato segnalato). Import dinamico: se Political non è mai stata
  // aperta il modulo non è nemmeno caricato, questa chiamata non dovrebbe
  // quindi accadere — ma se capitasse comunque, il modulo è già in cache
  // del browser dopo la prima apertura, quindi non è un fetch di rete.
  import('../political/main.js').then(m => m.pausePoliticalRendering());
}

export function isPoliticalViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
