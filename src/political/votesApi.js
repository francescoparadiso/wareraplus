/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: client dell'API delle votazioni
   ------------------------------------------------------------------
   Parla con /votazioni di warera-plus-api (server/plusApi/votazioni.js).
   Leggere non chiede login, ma il token si manda SEMPRE se c'è: con
   quello il server aggiunge testo ed esito riservati e lo stato di chi
   guarda ("hai votato", "puoi creare"). Token, ritorno da Discord e
   gestione del 401 sono quelli dell'area riservata, come in
   src/accordi/api.js — non una copia.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_PLUS_API_BASE } from '../diplomacy/config.js';
import { getToken, clearToken, ApiError, loginUrl, fetchMe } from '../private/api.js';

export { ApiError, fetchMe, getToken };

async function chiama(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${WARERA_PLUS_API_BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const dati = await res.json().catch(() => ({}));
  // Un token scaduto su una LETTURA non deve far sparire l'archivio:
  // si butta il token e si rilegge da anonimi.
  if (res.status === 401) {
    clearToken();
    if (method === 'GET') return chiama(path);
    throw new ApiError('non_autenticato', 401);
  }
  if (!res.ok) throw new ApiError(dati.error || 'errore_server', res.status, dati);
  return dati;
}

/** L'archivio di una nazione: { votazioni, poteri, ora }. */
export const leggiVotazioni = (countryId) => chiama(`/votazioni?nazione=${encodeURIComponent(countryId)}`);

/** Una votazione con il corpo elettorale: { votazione, ora }. */
export const leggiVotazione = (id) => chiama(`/votazioni/${encodeURIComponent(id)}`);

/** La sequenza sigillata dello scrutinio: { scrutinio, ora }. */
export const leggiScrutinio = (id) => chiama(`/votazioni/${encodeURIComponent(id)}/scrutinio`);

export const creaVotazione = (dati) => chiama('/votazioni', { method: 'POST', body: dati });
export const vota = (id, scelta, nota) => chiama(`/votazioni/${encodeURIComponent(id)}/voto`, { method: 'POST', body: { scelta, nota } });
/** Il canale Discord degli avvisi della nazione; url vuoto = toglierlo. */
export const impostaCanale = (nazione, url) => chiama('/votazioni/canale', { method: 'POST', body: { nazione, url } });
/** "Hanno votato tutti": urne chiuse adesso, scrutinio fra pochi secondi. */
export const chiudiVotazione = (id) => chiama(`/votazioni/${encodeURIComponent(id)}/chiudi`, { method: 'POST', body: {} });
/** Cancella per sempre (solo amministratore). */
export const eliminaVotazione = (id) => chiama(`/votazioni/${encodeURIComponent(id)}/elimina`, { method: 'POST', body: {} });
export const ritiraVotazione = (id) => chiama(`/votazioni/${encodeURIComponent(id)}/ritira`, { method: 'POST', body: {} });

/** Il ritorno da Discord atterra sull'area riservata (privateOverlay.js):
 *  con questa chiave riapre Political sulle votazioni della nazione (e
 *  sulla votazione) da cui si era partiti. Stessa chiave di Accordi. */
export function entraConDiscord(countryId, voteId) {
  try { sessionStorage.setItem('wp_after_login', `votazioni:${countryId || ''}:${voteId || ''}`); } catch { /* si atterra sull'area riservata */ }
  location.href = loginUrl();
}
