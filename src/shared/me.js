/* ══════════════════════════════════════════════════════════════
   WarEra+ — "Il mio personaggio": un posto solo
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-30): poter linkare il proprio
   personaggio e trovarsi sempre seguite le cose che contano — l'unità
   per i tornei, il personaggio nella sezione Giocatori, ecc.

   La chiave `we_my_player` esisteva già, dal bottone "Sono io" dentro la
   scheda di un giocatore, e la leggono Giocatori, Tornei, Ricchezza e
   Bonus battaglia (ognuno con la sua copia di `localStorage.getItem`).
   NON si cambia: stessa chiave, quindi chi l'aveva già impostata non
   perde niente e nessun lettore va toccato. Qui si aggiunge quello che
   mancava:
     · UN punto da cui impostarla e leggerla (setMe/clearMe), che avvisa
       tutti con `wareraplus:me-changed`;
     · i metadati minimi (nome, avatar, nazione, unità) per DISEGNARE il
       blocco "Il mio personaggio" nei Preferiti senza una richiesta ad
       ogni apertura del menù.

   È una preferenza di chi guarda, in localStorage come i Preferiti: non
   richiede il login e non dimostra niente. Chi ha anche collegato il
   personaggio nell'area riservata lo trova già impostato (vedi
   private/main.js), ma il legame verificato resta quello del server.
   ══════════════════════════════════════════════════════════════ */

const KEY = 'we_my_player';
const META_KEY = 'we_my_player_meta';
const ID_RE = /^[a-f0-9]{24}$/i;
const META_TTL_MS = 6 * 3600 * 1000;   // nome/unità cambiano di rado

export const ME_EVENT = 'wareraplus:me-changed';

function emit() { window.dispatchEvent(new CustomEvent(ME_EVENT)); }

export function getMeId() {
  try {
    const v = localStorage.getItem(KEY);
    return v && ID_RE.test(v) ? v : null;
  } catch { return null; }
}

/** { id, name, avatar, countryId, muId, muName, at } o null. Dice solo
 *  quello che sa: un campo può mancare finché `loadMeProfile` non ha
 *  risposto, e chi legge deve reggere l'assenza. */
export function getMeMeta() {
  const id = getMeId();
  if (!id) return null;
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    return m && m.id === id ? m : null;
  } catch { return null; }
}

function writeMeta(meta) {
  try { localStorage.setItem(META_KEY, JSON.stringify(meta)); } catch { /* quota / modalità privata */ }
}

function metaFromLite(id, lite, prev) {
  const muId = typeof lite?.mu === 'string' ? lite.mu : (lite?.mu?._id || null);
  return {
    id,
    name: lite?.username || prev?.name || '',
    avatar: lite?.avatarUrl || prev?.avatar || '',
    countryId: typeof lite?.country === 'string' ? lite.country : (lite?.country?._id || null),
    muId,
    // Il nome dell'unità non sta in getUserLite: si tiene quello già noto
    // finché l'unità è la stessa.
    muName: muId && prev?.muId === muId ? (prev.muName || null) : null,
    complete: false,
    at: Date.now(),
  };
}

/** Imposta il personaggio. `lite` (getUserLite) è facoltativo: se c'è, i
 *  metadati sono già completi e non serve una richiesta in più. */
export function setMe(id, lite = null) {
  if (!ID_RE.test(String(id || ''))) return false;
  const prev = getMeMeta();
  try { localStorage.setItem(KEY, id); } catch { return false; }
  if (lite) writeMeta(metaFromLite(id, lite, prev));
  else try { localStorage.removeItem(META_KEY); } catch { /* idem */ }
  emit();
  return true;
}

export function clearMe() {
  try { localStorage.removeItem(KEY); localStorage.removeItem(META_KEY); } catch { /* idem */ }
  emit();
}

let _loading = null;

/**
 * Completa i metadati se mancano o sono vecchi. Import dinamici: il
 * modulo è nel bundle principale e non deve trascinarci dentro le API di
 * Giocatori e Unità.
 * @returns {Promise<object|null>}
 */
export function loadMeProfile({ force = false } = {}) {
  const id = getMeId();
  if (!id) return Promise.resolve(null);
  const have = getMeMeta();
  // `complete`: la lettura di loadMeProfile è arrivata in fondo. Senza,
  // un'unità il cui nome non si trova verrebbe richiesta a ogni evento.
  if (!force && have?.complete && Date.now() - have.at < META_TTL_MS) return Promise.resolve(have);
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const { fetchPlayer } = await import('../players/api.js');
      const lite = await fetchPlayer(id);
      if (!lite || getMeId() !== id) return have;
      const meta = metaFromLite(id, lite, have);
      if (meta.muId && !meta.muName) {
        try {
          const { fetchMuBriefs } = await import('../mu/api.js');
          const got = await fetchMuBriefs([meta.muId]);
          meta.muName = got.get(meta.muId)?.name || null;
        } catch { /* resta senza nome: la riga dice "Unità" */ }
      }
      if (getMeId() !== id) return have;
      meta.complete = true;
      writeMeta(meta);
      emit();
      return meta;
    } catch (err) {
      console.warn('WarEra+ mio personaggio: profilo non letto:', err.message);
      return have;
    } finally { _loading = null; }
  })();
  return _loading;
}
