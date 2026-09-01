/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ambiente di deploy (live / dev / locale)
   ------------------------------------------------------------------
   Serve a UNA cosa sola: poter pubblicare una versione di prova del
   tool senza toccare quella che usano le persone. Su Vercel il
   meccanismo esiste già — ogni branch diverso da `main` diventa un
   "preview deployment" con un suo URL stabile
   (wareraplus-git-dev-<scope>.vercel.app) — ma un preview così com'è
   NON è innocuo: gira sullo stesso codice e quindi chiama gli stessi
   contatori della versione live. Le tre cose che inquinerebbero:

     1. Vercel Web Analytics (inject()) — le prove di sviluppo
        finirebbero mescolate ai visitatori veri.
     2. Umami — stesso problema, e per giunta è il numero che compare
        negli articoli.
     3. La pill "N visite" (/visits sul server di cache) — questa è la
        peggiore: il server NON sa da quale deploy arriva la richiesta,
        quindi ogni ricarica in dev alzerebbe il totale pubblico. Il
        seme di 1325 è una misura reale, gonfiarlo con le prove la
        renderebbe una bugia.

   Da qui in poi quei tre si accendono SOLO in produzione.

   ── PERCHÉ A BUILD TIME E NON DALL'HOSTNAME ────────────────────────
   Vercel espone VERCEL_ENV al processo di build ('production' per il
   branch di produzione, 'preview' per tutti gli altri). Ogni preview è
   una build separata, quindi la distinzione è già decisa quando il
   bundle viene costruito: leggerla lì è esatto per definizione, mentre
   un controllo su location.hostname si romperebbe il giorno in cui il
   tool prende un dominio proprio. Il valore entra nel bundle via
   `define` in vite.config.js (vedi __WP_DEPLOY_ENV__ lì).

   In locale (`npm run dev`, `npm run preview`) VERCEL_ENV non esiste e
   l'ambiente vale 'local': anche lo sviluppo sul portatile smette di
   contare visite vere, che è sempre stato un difetto silenzioso.
   ══════════════════════════════════════════════════════════════ */

/* eslint-disable no-undef */
const RAW = typeof __WP_DEPLOY_ENV__ === 'string' ? __WP_DEPLOY_ENV__ : 'local';

/** 'production' | 'preview' | 'local' */
export const DEPLOY_ENV = RAW;

/** Vero solo sul deploy che usano le persone. Tutto ciò che scrive su
 *  un contatore condiviso deve stare dietro a questo. */
export const IS_LIVE = DEPLOY_ENV === 'production';

/** Vero su preview Vercel e in locale: la versione "di prova". */
export const IS_DEV_BUILD = !IS_LIVE;

/* ══════════════════════════════════════════════════════════════
   Il cartellino DEV
   ------------------------------------------------------------------
   Le due versioni sono identiche a vedersi, e un URL di preview
   somiglia abbastanza a quello vero da poterci cascare — soprattutto
   da telefono, dove la barra degli indirizzi è mezza nascosta. Un
   cartellino in alto a sinistra toglie ogni dubbio su quale delle due
   si ha davanti prima ancora di leggere l'URL.

   Volutamente NON cliccabile e senza logica: se un giorno finisse per
   sbaglio in produzione, IS_LIVE lo spegne comunque.
   ══════════════════════════════════════════════════════════════ */
export function initDeployBadge() {
  if (IS_LIVE) return;

  const badge = document.createElement('div');
  badge.id = 'wp-deploy-badge';
  badge.textContent = DEPLOY_ENV === 'preview' ? 'DEV' : 'LOCAL';
  badge.title = DEPLOY_ENV === 'preview'
    ? 'Versione di prova — non è il tool pubblico'
    : 'Sviluppo in locale';
  document.body.appendChild(badge);
}
