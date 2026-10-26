/* ══════════════════════════════════════════════════════════════
   ACCORDI — client dell'API
   ------------------------------------------------------------------
   Leggere è pubblico (nessun token); scrivere passa dalla stessa
   sessione Discord dell'area riservata: token, ritorno da Discord e
   gestione del 401 sono quelli di src/private/api.js, non una copia.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_PLUS_API_BASE } from '../diplomacy/config.js';
import { getToken, clearToken, ApiError, loginUrl, fetchMe } from '../private/api.js';

export { ApiError, fetchMe, getToken };

async function leggi(path, { conToken = false } = {}) {
  const token = conToken ? getToken() : null;
  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const dati = await res.json().catch(() => ({}));
  if (res.status === 401) { clearToken(); throw new ApiError('non_autenticato', 401); }
  if (!res.ok) throw new ApiError(dati.error || 'errore_server', res.status, dati);
  return dati;
}

async function scrivi(path, body) {
  const token = getToken();
  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  });
  const dati = await res.json().catch(() => ({}));
  if (res.status === 401) { clearToken(); throw new ApiError('non_autenticato', 401); }
  if (!res.ok) throw new ApiError(dati.error || 'errore_server', res.status, dati);
  return dati;
}

/** L'archivio intero: { accordi, ora }. */
export const leggiAccordi = () => leggi('/accordi');

/** Le battaglie del periodo di un patto, con danni e violazioni. */
export const leggiControllo = (id) => leggi(`/accordi/${id}/controllo`);

/** Cosa può fare chi guarda: { verificato, amministra, governa[] }. */
export const leggiPoteri = () => leggi('/accordi/me', { conToken: true });

export const creaAccordo = (dati) => scrivi('/accordi', dati);
export const modificaAccordo = (id, dati) => scrivi(`/accordi/${id}`, dati);
export const eliminaAccordo = (id) => scrivi(`/accordi/${id}/remove`);

/** Il ritorno da Discord atterra sull'area riservata (privateOverlay.js):
 *  questa chiave le dice di riaprire Accordi invece. sessionStorage: vale
 *  per questa scheda e per un giro solo. */
export const RITORNO_KEY = 'wp_after_login';

export function entraConDiscord() {
  try { sessionStorage.setItem(RITORNO_KEY, 'accordi'); } catch { /* si atterra sull'area riservata */ }
  location.href = loginUrl();
}
