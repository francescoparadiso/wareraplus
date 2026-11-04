/* ══════════════════════════════════════════════════════════════
   WarEra+ — Riquadro "Novità" in sovraimpressione
   ------------------------------------------------------------------
   Compare UNA volta, a chi ha già usato il tool e torna dopo un
   aggiornamento: elenca le novità dal suo ultimo passaggio (al massimo
   le tre più recenti). Il contenuto sta in `changelog.js`, l'unico file
   da toccare a ogni release.

   ── COME RICORDA CHI L'HA VISTO ────────────────────────────────────
   `we_whatsnew_seen` in localStorage = l'`id` del registro più recente
   che ha chiuso. Niente server, niente account: è per browser, ed è
   quello che serve — il tool non ha un login per i visitatori. Se
   localStorage non c'è (finestra privata, dati bloccati) il riquadro
   semplicemente non compare: meglio nessun riquadro che uno che torna a
   ogni ricarica.

   ── QUANDO NON COMPARE ─────────────────────────────────────────────
   · prima visita assoluta (nessuna chiave): si segna il registro come
     visto e basta. Chi non ha mai usato il tool non può avere "novità",
     e un elenco di cose che non conosce è rumore. Si cambia con
     SHOW_TO_NEW_VISITORS;
   · link condivisi (?section=…, ?player=…, ?battle=…): chi arriva da
     Discord per vedere una cosa precisa non va coperto. NON si segna
     visto: la prossima visita normale lo vedrà;
   · lo sfondo di Wallpaper Engine (?wallpaper=1): resta acceso per
     giorni su ogni desktop e nessuno lo guarda per leggere;
   · prima che la mappa sia pronta: si aspetta `wareraplus:diplomacy-ready`
     più una breve pausa, perché un riquadro sopra il caricamento
     sembrerebbe un errore.

   `?whatsnew=1` lo riapre a mano (e non segna niente).
   ══════════════════════════════════════════════════════════════ */

import '../styles/whatsNew.css';
import { CHANGELOG } from './changelog.js';
import { IS_WALLPAPER } from '../shared/wallpaper.js';
import { trackEvent } from '../shared/analytics.js';

const SEEN_KEY = 'we_whatsnew_seen';
const MAX_ENTRIES = 3;
const SHOW_DELAY_MS = 900;
// false = chi apre il tool per la prima volta non vede le novità.
const SHOW_TO_NEW_VISITORS = false;
// Parametri che indicano un link condiviso verso qualcosa di preciso.
const DEEP_LINK_PARAMS = ['section', 'player', 'country', 'battle', 'alliance', 'sphere', 'map', 'tm'];

const DICT = {
  en: { title: 'What\'s new', kicker: 'WarEra+ update', ok: 'Got it', close: 'Close', new: 'New', improved: 'Improved', fix: 'Fixed' },
  it: { title: 'Novità', kicker: 'Aggiornamento di WarEra+', ok: 'Ho capito', close: 'Chiudi', new: 'Nuovo', improved: 'Migliorato', fix: 'Corretto' },
  es: { title: 'Novedades', kicker: 'Actualización de WarEra+', ok: 'Entendido', close: 'Cerrar', new: 'Nuevo', improved: 'Mejorado', fix: 'Corregido' },
  de: { title: 'Neuigkeiten', kicker: 'WarEra+ Update', ok: 'Verstanden', close: 'Schließen', new: 'Neu', improved: 'Verbessert', fix: 'Behoben' },
  fr: { title: 'Nouveautés', kicker: 'Mise à jour de WarEra+', ok: 'Compris', close: 'Fermer', new: 'Nouveau', improved: 'Amélioré', fix: 'Corrigé' },
  nl: { title: 'Nieuw', kicker: 'WarEra+ update', ok: 'Begrepen', close: 'Sluiten', new: 'Nieuw', improved: 'Verbeterd', fix: 'Opgelost' },
  sv: { title: 'Nyheter', kicker: 'WarEra+ uppdatering', ok: 'Uppfattat', close: 'Stäng', new: 'Nytt', improved: 'Förbättrat', fix: 'Åtgärdat' },
  pt: { title: 'Novidades', kicker: 'Atualização do WarEra+', ok: 'Entendi', close: 'Fechar', new: 'Novo', improved: 'Melhorado', fix: 'Corrigido' },
  ar: { title: 'الجديد', kicker: 'تحديث WarEra+', ok: 'فهمت', close: 'إغلاق', new: 'جديد', improved: 'مُحسَّن', fix: 'تم إصلاحه' },
};

function lang() {
  let l = 'en';
  try { l = (localStorage.getItem('we_lang') || navigator.language || 'en').slice(0, 2).toLowerCase(); } catch (_) { /* resta en */ }
  return DICT[l] ? l : 'en';
}
const T = (k) => (DICT[lang()] || DICT.en)[k] ?? DICT.en[k] ?? k;
/** Un testo del registro nella lingua dell'utente, con ricaduta sull'inglese. */
const pick = (obj) => (obj?.[lang()] ?? obj?.en ?? '');

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function getSeen() {
  try { return localStorage.getItem(SEEN_KEY); } catch (_) { return undefined; }   // undefined = non si può leggere
}
function setSeen(id) {
  try { localStorage.setItem(SEEN_KEY, id); return true; } catch (_) { return false; }
}

function dateLabel(id) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(id);
  if (!m) return '';
  try {
    return new Intl.DateTimeFormat(lang(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(`${m[1]}T12:00:00Z`));
  } catch (_) { return m[1]; }
}

let _el = null;
let _onKey = null;
let _opener = null;

function entryHtml(e) {
  return `
    <section class="wp-wn-entry">
      <h3>${esc(pick(e.title))}<time>${esc(dateLabel(e.id))}</time></h3>
      <ul>${e.items.map(it => `
        <li><span class="wp-wn-tag wp-wn-tag-${esc(it.tag)}">${esc(T(it.tag))}</span><span>${esc(pick(it))}</span></li>`).join('')}
      </ul>
    </section>`;
}

/** Chiude il riquadro. `remember`: segna come visto il registro più recente. */
function close(remember) {
  if (!_el) return;
  if (remember && CHANGELOG[0]) setSeen(CHANGELOG[0].id);
  document.removeEventListener('keydown', _onKey, true);
  _el.classList.add('wp-wn-out');
  const el = _el;
  _el = null;
  setTimeout(() => el.remove(), 180);
  try { _opener?.focus?.(); } catch (_) { /* il bottone potrebbe non esserci più */ }
  trackEvent('whatsnew-close', { remember });
}

function show(entries, { remember }) {
  if (_el || !entries.length) return;
  _opener = document.activeElement;
  _el = document.createElement('div');
  _el.className = 'wp-wn';
  _el.setAttribute('role', 'dialog');
  _el.setAttribute('aria-modal', 'true');
  _el.setAttribute('aria-labelledby', 'wp-wn-title');
  _el.dir = lang() === 'ar' ? 'rtl' : 'ltr';
  _el.innerHTML = `
    <div class="wp-wn-backdrop" data-wn-close></div>
    <div class="wp-wn-card">
      <header class="wp-wn-head">
        <div>
          <span class="wp-wn-kicker">${esc(T('kicker'))}</span>
          <h2 id="wp-wn-title">${esc(T('title'))}</h2>
        </div>
        <button type="button" class="wp-wn-x" data-wn-close aria-label="${esc(T('close'))}">×</button>
      </header>
      <div class="wp-wn-body">${entries.map(entryHtml).join('')}</div>
      <footer class="wp-wn-foot"><button type="button" class="wp-wn-ok" data-wn-close>${esc(T('ok'))}</button></footer>
    </div>`;
  _el.addEventListener('click', (e) => { if (e.target.closest('[data-wn-close]')) close(remember); });
  document.body.appendChild(_el);

  _onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(remember); return; }
    if (e.key !== 'Tab') return;
    // Il fuoco resta dentro il riquadro: due soli controlli, X e il bottone.
    const f = [..._el.querySelectorAll('button')];
    const i = f.indexOf(document.activeElement);
    e.preventDefault();
    f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
  };
  document.addEventListener('keydown', _onKey, true);
  _el.querySelector('.wp-wn-ok')?.focus();
  trackEvent('whatsnew-show', { id: entries[0].id, n: entries.length });
}

/** Riapre il riquadro a mano (senza segnare niente). */
export function openWhatsNew() {
  show(CHANGELOG.slice(0, MAX_ENTRIES), { remember: false });
}

export function initWhatsNew() {
  if (IS_WALLPAPER || !CHANGELOG.length) return;
  const params = new URLSearchParams(window.location.search);
  const latest = CHANGELOG[0].id;

  if (params.get('whatsnew') === '1') {
    window.addEventListener('wareraplus:diplomacy-ready', () => setTimeout(openWhatsNew, SHOW_DELAY_MS), { once: true });
    return;
  }

  const seen = getSeen();
  if (seen === undefined) return;                       // localStorage non utilizzabile
  if (seen === null) {                                  // prima visita assoluta
    if (!SHOW_TO_NEW_VISITORS) { setSeen(latest); return; }
  }
  const nuove = CHANGELOG.filter(e => seen === null || e.id > seen).slice(0, MAX_ENTRIES);
  if (!nuove.length) return;
  if (DEEP_LINK_PARAMS.some(p => params.has(p))) return;   // vedi la testata: non si copre un link condiviso

  window.addEventListener('wareraplus:diplomacy-ready', () => setTimeout(() => show(nuove, { remember: true }), SHOW_DELAY_MS), { once: true });
}
