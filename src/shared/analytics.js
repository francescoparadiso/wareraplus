/* ══════════════════════════════════════════════════════════════
   WarEra+ — Analytics (Umami)
   ------------------------------------------------------------------
   Lo script Umami è caricato una sola volta in index.html (tag
   <script defer data-website-id="...">, stesso ID già usato dal
   vecchio tool in public/political/index.html — MAI caricato lì
   nell'app attiva, quindi window.umami era sempre undefined e le
   chiamate window.umami.track(...) già presenti in map.js/
   politicalOverlay.js/political/main.js (ereditate dal porting) erano
   no-op silenziosi da sempre).

   Questo modulo è solo un wrapper sottile: evita di ripetere ovunque
   `if (window.umami) window.umami.track(...)`, e soprattutto tiene in
   UN posto solo l'elenco dei nomi evento usati in tutto il tool — così
   un refuso o un nome duplicato si nota qui invece di sporcare la
   dashboard con eventi mai più raggruppabili.

   Mai lasciare che un problema di analytics interrompa un'azione reale
   dell'utente (script bloccato da adblock, dominio non raggiungibile,
   quota superata sul piano Umami): try/catch silenzioso.
   ══════════════════════════════════════════════════════════════ */

export function trackEvent(name, data) {
  try {
    if (window.umami?.track) window.umami.track(name, data);
  } catch (err) {
    // silenzioso di proposito — vedi nota sopra
  }
}
