/* ══════════════════════════════════════════════════════════════
   WarEra+ — "Scorri di lato per tutte le colonne"
   ------------------------------------------------------------------
   Segnalazione dei giocatori (2026-10-15): da telefono le tabelle dati
   (Rendite, Prezzi, Produzione, Unità Militari, Spese di guerra; e le due
   di Statistiche nazioni, che scorrevano già ma senza dirlo)
   mostravano tre colonne e NASCONDEVANO le altre — "Rendita/pp base"
   non si vedeva più da nessuna parte. L'audit mobile di settembre le
   aveva tolte perché uno scorrimento laterale che niente annuncia non
   lo trova nessuno. La cura di adesso è annunciarlo: le colonne ci sono
   tutte, la prima resta ferma, e sopra la tabella questa riga dice che
   si scorre.

   Visibile solo sotto la soglia in cui la tabella scorre davvero:
   `bp` sceglie fra le due che il CSS conosce (shell.css, .wp-scrollhint).
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import { escapeHtml } from '../diplomacy/utils.js';

/** @param {560|900|768} bp larghezza sotto la quale la tabella scorre */
export function scrollHintHtml(bp = 560) {
  return `<div class="wp-scrollhint wp-scrollhint-${bp}">${escapeHtml(t('table_scroll_hint'))}</div>`;
}
