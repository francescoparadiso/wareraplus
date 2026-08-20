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
   modulo arricchisce SOLO la foto profilo reale.

   WarEra+ round N+1: generalizzato lato server/cacheClient insieme al
   credito ArgusIA nell'Ottimizzatore (src/eco/main.js) — stessa funzione
   fetchCreditProfileViaCache('author'|'argus'|...), un solo poll condiviso
   sul server per tutti i "crediti" statici del tool. Se anche il fallback
   fallisce (server giù, rate limit) resta silenziosamente l'iniziale "F":
   degrado grazioso, il link funziona comunque.
   ══════════════════════════════════════════════════════════════ */

import { fetchCreditProfileViaCache } from '../diplomacy/cacheClient.js';

export async function initAuthorPill() {
  const pill = document.getElementById('wp-author-pill');
  const avatarEl = pill?.querySelector('.wp-author-pill-avatar');
  if (!avatarEl) return;
  try {
    const data = await fetchCreditProfileViaCache('author');
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