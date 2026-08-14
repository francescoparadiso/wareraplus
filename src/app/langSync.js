/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sincronizzazione lingua con Political View
   ------------------------------------------------------------------
   Stesso principio di src/app/themeSync.js (tema), applicato alla
   lingua — mancava, ed era un bug reale segnalato dall'utente: "se
   seleziono una lingua e apro il tool politico non c'è la stessa
   lingua".

   Causa: src/political/i18n.js legge `localStorage.getItem('we_lang')`
   in una IIFE a livello di modulo (`let _i18nLang = (() => {...})()`),
   valutata UNA SOLA VOLTA quando quel chunk viene importato per la
   prima volta (import() dinamico alla prima apertura di Political,
   vedi politicalOverlay.js). Se l'utente cambia lingua nello shell
   DOPO che Political è già stata montata almeno una volta in questa
   sessione, `_i18nLang` resta quello letto al primo mount — niente lo
   aggiorna più, perché `initPoliticalView()` chiama `initI18n()` SOLO
   al primo mount (`isFirstMount`), non alle riaperture successive.
   `we_lang` in localStorage viene sì aggiornato correttamente dallo
   shell, ma nessuno lo ripropaga a Political già montata: stessa
   causa esatta per cui esiste già themeSync.js per il tema.

   Fix: due listener, non uno solo come per il tema — qui sincronizzo
   in ENTRAMBE le direzioni, perché la lingua (a differenza del tema)
   ha un selettore anche dentro Political stessa, quindi l'incoerenza
   può nascere da entrambi i lati:
   - shell -> Political: su 'wareraplus:langchange' (già dispatchato da
     src/shared/i18n.js:setLang), se Political è già montata, applica
     la nuova lingua live via import() dinamico di political/i18n.js.
   - Political -> shell: su 'langchange' (già dispatchato da
     src/political/i18n.js:setLang), se diversa da quella corrente
     dello shell, applica la stessa lingua allo shell.
   Nessun rischio di loop: entrambe le implementazioni di setLang
   ritornano subito se la lingua richiesta è già quella corrente,
   quindi il giro di richiamo reciproco si ferma da solo al secondo
   passaggio.
   ══════════════════════════════════════════════════════════════ */

import { setLang as setShellLang, getLang as getShellLang } from '../shared/i18n.js';

function _politicalMounted() {
  const root = document.getElementById('wp-political-root');
  return !!(root && root.children.length);
}

async function _applyToPoliticalIfMounted(lang) {
  if (!_politicalMounted()) return;
  try {
    const { setLang } = await import('../political/i18n.js');
    setLang(lang);
  } catch (_) {
    // Stesso documento, nessun confine iframe — non dovrebbe accadere,
    // ma non blocchiamo il resto dell'app se capita.
  }
}

export function initLangSync() {
  window.addEventListener('wareraplus:langchange', (e) => {
    _applyToPoliticalIfMounted(e.detail?.lang);
  });

  document.addEventListener('langchange', (e) => {
    const lang = e.detail?.lang;
    if (lang && lang !== getShellLang()) setShellLang(lang);
  });
}
