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

// ══════════════════════════════════════════════════════════════
// trackThrottled — per eventi che possono arrivare A RAFFICA dallo stesso
// utente in pochi secondi (l'uso pensato: i 429 — quando l'API è satura,
// le chiamate in parallelo falliscono quasi tutte insieme, non una alla
// volta). Senza throttle un singolo utente in un momento di rate-limit
// genererebbe decine di eventi identici, seppellendo il segnale reale
// ("quanti utenti/sessioni incontrano un 429") sotto il rumore di quante
// richieste erano in volo in quel preciso istante — un dettaglio di
// implementazione, non un dato interessante.
// Traccia il primo evento di un "gruppo" subito, poi ignora i successivi
// con lo stesso nome per `minIntervalMs`; il gruppo successivo (dopo la
// pausa) riparte tracciato. Stato per `name`, non globale: throttle
// indipendenti per 429-diplomacy / 429-political / altri usi futuri.
// ══════════════════════════════════════════════════════════════
const _lastTrackedAt = new Map();

export function trackThrottled(name, data, minIntervalMs = 15000) {
  const now = Date.now();
  const last = _lastTrackedAt.get(name) || 0;
  if (now - last < minIntervalMs) return;
  _lastTrackedAt.set(name, now);
  trackEvent(name, data);
}
