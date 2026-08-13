/* ══════════════════════════════════════════════════════════════
   WarEra+ — embed.js
   ------------------------------------------------------------------
   Script ADDITIVO, non richiesto dal Political View originale: si
   attiva solo se l'URL contiene ?embed=senate (altrimenti esce subito
   al primo controllo, zero effetto sul comportamento esistente).

   Serve al pannello nazione di WarEra+ (countryPanel.js, nel progetto
   principale) per mostrare, dentro un iframe piccolo, SOLO l'emiciclo
   del parlamento + il riquadro governo — riusando SenateView (già
   presente in senate.js) invece di reimplementare il rendering da zero.

   Nasconde via CSS (embed.css) tutto il resto: titolo, controlli,
   sidebar con la lista dei gruppi parlamentari, barra statistiche in
   basso, riquadro statistiche paese. Non modifica senate.js: si limita
   ad aggiungere una classe al <body> e ad aprire la view già esistente.
   ══════════════════════════════════════════════════════════════ */
(function () {
  const params = new URLSearchParams(window.location.search);
  const embedMode = params.get('embed');
  if (embedMode !== 'senate') return; // comportamento originale invariato

  document.body.classList.add('wp-embed-mode', 'wp-embed-senate');

  function openEmbedSenate() {
    if (!_currentCongressElectionId) {
      // Nessuna elezione congressuale per questo paese: mostra lo stato
      // vuoto già previsto da SenateView (#senateEmpty) aprendo comunque
      // la view, che gestisce da sé il caso "nessun dato".
      SenateView.open();
      return;
    }
    loadElection(_currentCongressElectionId).then(() => {
      SenateView.open();
    });
  }

  function waitForElectionsReady() {
    // 'wareraplus:elections-ready' viene emesso da congress.js
    // (loadElectionsHistory, hook additivo) sia in caso di successo sia di
    // errore, quindi copre entrambi i casi. Un timeout di sicurezza gestisce
    // lo scenario limite in cui l'evento non arrivasse per qualche motivo
    // imprevisto.
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      openEmbedSenate();
    };
    window.addEventListener('wareraplus:elections-ready', finish, { once: true });
    setTimeout(finish, 15000);
  }

  document.addEventListener('DOMContentLoaded', () => {
    waitForElectionsReady();
  });
})();
