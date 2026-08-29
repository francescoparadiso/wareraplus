/* ══════════════════════════════════════════════════════════════
   WarEra+ — Etiche del partito al governo e bonus di specializzazione
   ------------------------------------------------------------------
   COSA SI È SCOPERTO (misurato dal vivo il 2026-08-27, l'API non lo
   documenta):

   · ogni partito ha `ethics` = { militarism, isolationism, imperialism,
     industrialism, unethical }, con valori −2 / 0 / +2 sui quattro assi
     (`party.getById`);
   · la nazione ha un `rulingParty` — ma SOLO dentro
     `country.getCountryById`, non dentro `country.getAllCountries` che
     l'app carica al boot: da qui la fetch pigra qui sotto;
   · `company.getProductionBonus` scompone il bonus di un'azienda in
     `strategicBonus` (le risorse strategiche della nazione, quelle della
     vista mappa), `depositBonus` (il giacimento a tempo della regione),
     `ethicSpecializationBonus` e `ethicDepositBonus` — le due voci che
     dipendono dalle etiche.

   LA REGOLA, ricavata dai casi osservati: il +30% sull'item
   specializzato della nazione (`specializedItem`) scatta solo con
   `industrialism = 2`. Verificato: Ucraina, Iraq, Indonesia, Venezuela
   (industrialism 2, azienda sull'item specializzato) → 30; Serbia
   (industrialism 0, ha comunque `specializedItem: steel`, azienda in
   Serbia che produce steel) → 0. Inoltre, su 70 nazioni campionate, TUTTE
   e nove quelle con industrialism −2 non hanno affatto un
   `specializedItem`, mentre tutte e sette quelle a +2 ce l'hanno.

   ⚠️ È una regola INFERITA da un campione, non una tabella ufficiale: se
   il gioco introducesse valori intermedi il numero qui sotto andrebbe
   rimisurato. Per questo il bonus mostrato è etichettato come stima
   quando non arriva da una lettura diretta di company.getProductionBonus.

   COSTO. Due strade, stesso dato:

   · UNA nazione (pannello) → due chiamate singole, all'apertura;
   · TUTTE le nazioni (heatmap) → `ensureAllCountryEthics()`, che passa
     dal batching tRPC di utils.js: 180 `country.getCountryById` in 4
     richieste da 50, poi i soli partiti al governo DISTINTI in altre due
     o tre. Una manciata di richieste in tutto, una volta per sessione e
     solo quando si apre la vista Bonus produzione — non 360, che era la
     stima ingenua (una richiesta per chiamata).

   Se il batch fallisce non succede niente di grave: la mappa torna a
   colorare il solo bonus da risorse strategiche, come faceva prima che le
   etiche esistessero.
   ══════════════════════════════════════════════════════════════ */

import { trpcCall } from '../shared/trpcClient.js';
import { trpcBatch } from './utils.js';
import { state } from './state.js';

/** Assi delle etiche, con i due poli. Le etichette vere le mette chi
 *  disegna (dizionari i18n diversi fra shell e viste). */
export const ETHIC_AXES = ['militarism', 'isolationism', 'imperialism', 'industrialism'];

/** Il valore che, sull'asse industrialism, accende il bonus. */
export const INDUSTRIALIST = 2;
/** Quanto vale, in percentuale, sull'item specializzato della nazione. */
export const SPECIALIZATION_BONUS = 30;

const _cache = new Map();   // countryId → Promise<info>

/* Deposita quello che si è appena scoperto nella mappa CONDIVISA, quella che
   legge productionHeatmap.js (e con lui la mappa, le etichette, il riepilogo
   e il pannello). Prima ci scriveva solo ensureAllCountryEthics: il pannello
   nazione, che passa dalla fetch singola qui sopra, si teneva il dato per sé
   nella _cache locale. Risultato visibile: il pannello scriveva "Bonus
   produzione +5%" e due righe sotto "Specializzazione: steel +30%", con il
   +30 non compreso nel +5 — e lo stesso pannello, riaperto dopo un giro
   nella vista mappa, diceva +35% per la stessa nazione. Una sola mappa,
   riempita da tutte e due le strade. */
function _publish(countryId, info) {
  if (!info) return info;
  if (!state.countryEthics) state.countryEthics = {};
  state.countryEthics[countryId] = info;
  state.countryEthicsVersion++;
  return info;
}

/**
 * @returns {Promise<{party: {id, name, ethics}|null, specializedItem: string|null,
 *                    industrialist: boolean, specBonus: number}|null>}
 */
export function fetchCountryEthics(countryId) {
  if (!countryId) return Promise.resolve(null);
  if (_cache.has(countryId)) return _cache.get(countryId);

  const p = (async () => {
    const country = await trpcCall('country.getCountryById', { countryId });
    const specializedItem = country?.specializedItem || null;
    const partyId = country?.rulingParty || null;
    if (!partyId) {
      return _publish(countryId, { party: null, specializedItem, industrialist: false, specBonus: 0 });
    }

    const party = await trpcCall('party.getById', { partyId });
    const ethics = party?.ethics || null;
    const industrialist = (ethics?.industrialism ?? 0) >= INDUSTRIALIST;
    return _publish(countryId, {
      party: { id: partyId, name: party?.name || null, ethics },
      specializedItem,
      industrialist,
      specBonus: industrialist && specializedItem ? SPECIALIZATION_BONUS : 0,
    });
  })();

  // Un errore non deve restare in cache: la prossima apertura riprova.
  p.catch(() => _cache.delete(countryId));
  _cache.set(countryId, p);
  return p;
}

/** Etiche non nulle, come [{ axis, value }] — le altre non si mostrano:
 *  uno zero su un asse vuol dire "il partito non si è schierato". */
export function activeEthics(ethics) {
  if (!ethics) return [];
  return ETHIC_AXES
    .map(axis => ({ axis, value: ethics[axis] ?? 0 }))
    .filter(e => e.value !== 0);
}

/* ══════════════════════════════════════════════════════════════
   TUTTE le nazioni in una manciata di richieste (per la heatmap)
   ══════════════════════════════════════════════════════════════ */

let _allPromise = null;

/**
 * Riempie `state.countryEthics` = { countryId: info } per ogni nazione.
 * Una volta sola per sessione; chi arriva mentre è in volo aspetta la
 * stessa promessa invece di far ripartire i batch.
 */
export function ensureAllCountryEthics() {
  if (_allPromise) return _allPromise;

  _allPromise = (async () => {
    const ids = [...state.nationMap.keys()];
    if (!ids.length) return null;

    const details = await trpcBatch(ids.map(id => ['country.getCountryById', { countryId: id }]));

    // Un partito governa una nazione sola, ma chiedere i DISTINTI costa
    // uguale e protegge dai casi strani (nazioni fantoccio, dati vecchi).
    const partyIds = [...new Set(details.map(d => d?.rulingParty).filter(Boolean))];
    const parties = partyIds.length
      ? await trpcBatch(partyIds.map(pid => ['party.getById', { partyId: pid }]))
      : [];
    const partyById = new Map(partyIds.map((pid, i) => [pid, parties[i]]));

    const out = {};
    ids.forEach((id, i) => {
      const c = details[i];
      if (!c) return;
      const specializedItem = c.specializedItem || null;
      const party = c.rulingParty ? partyById.get(c.rulingParty) : null;
      const ethics = party?.ethics || null;
      const industrialist = (ethics?.industrialism ?? 0) >= INDUSTRIALIST;
      out[id] = {
        party: party ? { id: c.rulingParty, name: party.name || null, ethics } : null,
        specializedItem,
        industrialist,
        specBonus: industrialist && specializedItem ? SPECIALIZATION_BONUS : 0,
      };
      // Il pannello nazione legge la stessa cache: chi ha già aperto la
      // heatmap non rifà due chiamate quando poi clicca una nazione.
      if (!_cache.has(id)) _cache.set(id, Promise.resolve(out[id]));
    });

    // Fusione, non sostituzione: il pannello può aver già risolto qualche
    // nazione per conto suo (vedi _publish), e ributtare via quelle voci
    // per rimetterci le stesse non serve a niente.
    state.countryEthics = { ...(state.countryEthics || {}), ...out };
    state.countryEthicsComplete = true;
    state.countryEthicsVersion++;
    return out;
  })();

  _allPromise.catch(() => { _allPromise = null; });
  return _allPromise;
}

/** Il bonus etico di una nazione, 0 se non lo sappiamo (ancora). */
export function ethicBonusOf(countryId) {
  return state.countryEthics?.[countryId]?.specBonus || 0;
}

/** Quante nazioni hanno il bonus etico acceso — serve alla legenda per
 *  dire se il dato è arrivato e quanto pesa. */
export function ethicStats() {
  const data = state.countryEthics;
  // `loaded` vuol dire "ci sono TUTTE", non "ce n'è almeno una": è da qui che
  // la legenda decide se il tetto della scala vale 30 o 60, e con una sola
  // nazione risolta dal pannello direbbe una cosa falsa sull'intera mappa.
  if (!data || !state.countryEthicsComplete) {
    return { loaded: false, industrialist: 0, countries: data ? Object.keys(data).length : 0 };
  }
  const rows = Object.values(data);
  return {
    loaded: true,
    countries: rows.length,
    industrialist: rows.filter(r => r.specBonus > 0).length,
  };
}
