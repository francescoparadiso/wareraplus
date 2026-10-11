/* ══════════════════════════════════════════════════════════════
   WarEra+ — Modalità sfondo (Wallpaper Engine): il solo flag
   ------------------------------------------------------------------
   Lo sfondo di Wallpaper Engine (cartella wallpaper/ in radice) è un
   involucro che carica QUESTO sito in un iframe con `?wallpaper=1`. Il
   flag sta in un file a parte, minuscolo, perché lo leggono moduli che
   non devono tirarsi dietro tutto src/app/wallpaperMode.js: main.js
   (contatori e analytics), analytics.js, il pannello nazione.

   Deciso una volta al caricamento, come IS_LIVE: lo sfondo non diventa
   una pagina normale a metà sessione, e una pagina normale non diventa
   uno sfondo.
   ══════════════════════════════════════════════════════════════ */

export const IS_WALLPAPER = (() => {
  try { return new URLSearchParams(window.location.search).get('wallpaper') === '1'; }
  catch { return false; }
})();
