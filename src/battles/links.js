/* ══════════════════════════════════════════════════════════════
   WarEra+ — Battaglie: i link
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-26): «devono sempre esserci i link».
   Dentro Battaglie una guerra si raggiungeva solo cambiando scheda e
   cercandola a mano, e l'indirizzo restava ?section=battles qualunque cosa
   si guardasse. Ora:
     · ogni battaglia che ha una guerra porta un link VERO (un <a href>, che
       si copia, si apre in un'altra scheda col tasto centrale, si incolla
       su Discord) alla sua guerra nella scheda Guerre;
     · l'indirizzo segue la vista: scheda, guerra aperta, vista per
       alleanza, nazione o alleanza aperta nelle spese, finestra — vedi
       linkState() in main.js e URL_KEYS in app/backNav.js.
   Un clic normale non ricarica la pagina: main.js lo intercetta sul
   contenitore ([data-war-link]) e salta alla guerra in place.
   ══════════════════════════════════════════════════════════════ */

import { URL_KEYS } from '../app/backNav.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { btlT } from './i18n.js';

/** URL dell'app con i soli parametri dati (le altre chiavi dei livelli si
 *  tolgono; ?lang= e simili restano). */
export function battlesHref(params) {
  const u = new URL(location.href);
  URL_KEYS.forEach(k => u.searchParams.delete(k));
  u.searchParams.set('section', 'battles');
  for (const [k, v] of Object.entries(params || {})) {
    if (v != null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.pathname + u.search;
}

export const warHref = (warId) => battlesHref({ tab: 'wars', war: warId });

/** "🔗 Copia link": un <a> vero (si può anche trascinare o aprire a parte);
 *  il clic normale copia l'indirizzo completo (main.js, [data-copy-link]). */
export function copyLinkHtml(href) {
  return `<a class="wp-btl-copylink" href="${escapeHtml(href)}" data-copy-link>🔗 ${escapeHtml(btlT('copyLink'))}</a>`;
}

/** Il link "⚔ Guerra" accanto a una battaglia. Vuoto se non ha guerra
 *  (torneo, o riga non ancora recuperata dal server). */
export function warLinkHtml(warId, { label = true } = {}) {
  if (!warId) return '';
  return `<a class="wp-btl-warlink" href="${escapeHtml(warHref(warId))}" data-war-link="${escapeHtml(warId)}"
            title="${escapeHtml(btlT('warLinkTip'))}">⚔${label ? ` ${escapeHtml(btlT('warLink'))}` : ''}</a>`;
}
