/* ══════════════════════════════════════════════════════════════
   WarEra+ — Pill autore (desktop, accanto al bottone Ko-fi)
   ------------------------------------------------------------------
   Richiesta esplicita dell'utente: nome + foto profilo + link diretto
   al proprio profilo WarEra, stessa dimensione del bottone Ko-fi
   adiacente (#kofi-btn, vedi diplomacy.css) — i due condividono il
   wrapper #wp-bottom-credits (shell.css) che li centra insieme in
   basso, così restano appaiati indipendentemente dalla larghezza del
   testo di ciascuno.

   Markup statico (index.html) mostra già nome+iniziale come fallback
   istantaneo (nessun flash "vuoto" mentre la fetch è in corso); questo
   modulo arricchisce SOLO la foto profilo reale, con la stessa
   tecnica/endpoint già usata per la card credit di ArgusIA
   nell'ottimizzatore industriale (vedi src/eco/main.js:enrichCreditCard,
   user.getUserLite via WORKER_API_BASE — stesso pattern, non duplicato
   in un helper condiviso perché è una singola chiamata one-shot, non
   vale la pena un modulo shared per due usi). Se la fetch fallisce
   (server giù, rate limit) resta silenziosamente l'iniziale "F":
   degrado grazioso, il link funziona comunque.
   ══════════════════════════════════════════════════════════════ */

import { WORKER_API_BASE } from '../diplomacy/config.js';

const AUTHOR_USER_ID = '69d2ed249f38d300d59a2af1';

export async function initAuthorPill() {
  const pill = document.getElementById('wp-author-pill');
  const avatarEl = pill?.querySelector('.wp-author-pill-avatar');
  if (!avatarEl) return;
  try {
    const url = `${WORKER_API_BASE}/trpc/user.getUserLite?input=${encodeURIComponent(JSON.stringify({ userId: AUTHOR_USER_ID }))}`;
    const res = await fetch(url);
    if (!res.ok) return;
    const data = (await res.json())?.result?.data;
    if (!data?.avatarUrl) return;
    const img = document.createElement('img');
    img.src = data.avatarUrl;
    img.alt = '';
    img.onerror = () => { avatarEl.classList.remove('has-img'); img.remove(); };
    avatarEl.textContent = '';
    avatarEl.classList.add('has-img');
    avatarEl.appendChild(img);
  } catch (_) {
    // Silenzioso: il fallback statico (iniziale + nome + link) resta valido.
  }
}
