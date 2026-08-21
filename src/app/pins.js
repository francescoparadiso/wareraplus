/* ══════════════════════════════════════════════════════════════
   WarEra+ — Store dei "Preferiti" (pin nazioni/alleanze)
   ------------------------------------------------------------------
   Piccolo store condiviso (localStorage) usato dalla barra menù
   (dropdown Preferiti + stelle nei risultati di ricerca) e dal
   pannello nazione (stella nell'intestazione). Emette
   'wareraplus:pins-changed' ad ogni modifica così ogni consumatore
   si ri-renderizza senza accoppiarsi agli altri.

   Struttura salvata: { nation: [id...], alliance: [id...], mu: [id...] }.
   Salviamo solo gli id: nome/bandiera/logo si ricavano a runtime da
   state.nazioniGlobal / state.allianceMap (sempre aggiornati).

   ECCEZIONE per le unità militari (`mu`): il loro elenco NON vive in
   `state` — arriva dal server di cache e solo quando l'utente apre la
   vista Unità Militari (src/mu/api.js). Un pin salvato ieri sarebbe
   quindi un id nudo, senza nome né avatar da mostrare nel dropdown
   Preferiti finché quella vista non viene aperta. Per questi, e SOLO per
   questi, si salva accanto un minimo di metadati (nome, avatar, nazione)
   in `we_pinned_mu_meta` — abbastanza per disegnare la riga; il dato
   fresco resta comunque quello della directory quando c'è.
   ══════════════════════════════════════════════════════════════ */

const KEY = 'we_pinned';
const MU_META_KEY = 'we_pinned_mu_meta';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return {
      nation: Array.isArray(raw?.nation) ? raw.nation : [],
      alliance: Array.isArray(raw?.alliance) ? raw.alliance : [],
      mu: Array.isArray(raw?.mu) ? raw.mu : [],
    };
  } catch {
    return { nation: [], alliance: [], mu: [] };
  }
}

function loadMuMeta() {
  try {
    const raw = JSON.parse(localStorage.getItem(MU_META_KEY));
    return (raw && typeof raw === 'object') ? raw : {};
  } catch {
    return {};
  }
}

let muMeta = loadMuMeta();

/** Metadati minimi (nome/avatar/nazione) di una MU pinnata, o null. Il
 *  chiamante deve preferire il dato vivo della directory se ce l'ha. */
export function getMuPinMeta(muId) {
  return muMeta[muId] || null;
}

let store = load();

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* quota/private mode */ }
  window.dispatchEvent(new CustomEvent('wareraplus:pins-changed'));
}

export function isPinned(type, id) {
  return !!store[type]?.includes(id);
}

export function getPinned() {
  return { nation: [...store.nation], alliance: [...store.alliance], mu: [...store.mu] };
}

/** Aggiunge/rimuove un pin. Ritorna il nuovo stato (true = ora pinnato).
 *  `meta` è usato solo per type 'mu' (vedi il commento in testa al file):
 *  si scrive quando si pinna, si cancella quando si spinna. */
export function togglePin(type, id, meta) {
  if (!id || !['nation', 'alliance', 'mu'].includes(type)) return false;
  const arr = store[type];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);

  if (type === 'mu') {
    if (isPinned('mu', id) && meta) muMeta[id] = { name: meta.name, avatarUrl: meta.avatarUrl, country: meta.country };
    else delete muMeta[id];
    try { localStorage.setItem(MU_META_KEY, JSON.stringify(muMeta)); } catch { /* quota/private mode */ }
  }

  persist();
  return isPinned(type, id);
}
