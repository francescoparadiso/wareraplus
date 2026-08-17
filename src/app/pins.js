/* ══════════════════════════════════════════════════════════════
   WarEra+ — Store dei "Preferiti" (pin nazioni/alleanze)
   ------------------------------------------------------------------
   Piccolo store condiviso (localStorage) usato dalla barra menù
   (dropdown Preferiti + stelle nei risultati di ricerca) e dal
   pannello nazione (stella nell'intestazione). Emette
   'wareraplus:pins-changed' ad ogni modifica così ogni consumatore
   si ri-renderizza senza accoppiarsi agli altri.

   Struttura salvata: { nation: [id...], alliance: [id...] }. Salviamo
   solo gli id: nome/bandiera/logo si ricavano a runtime da
   state.nazioniGlobal / state.allianceMap (sempre aggiornati).
   ══════════════════════════════════════════════════════════════ */

const KEY = 'we_pinned';

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    return {
      nation: Array.isArray(raw?.nation) ? raw.nation : [],
      alliance: Array.isArray(raw?.alliance) ? raw.alliance : [],
    };
  } catch {
    return { nation: [], alliance: [] };
  }
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
  return { nation: [...store.nation], alliance: [...store.alliance] };
}

/** Aggiunge/rimuove un pin. Ritorna il nuovo stato (true = ora pinnato). */
export function togglePin(type, id) {
  if (!id || (type !== 'nation' && type !== 'alliance')) return false;
  const arr = store[type];
  const i = arr.indexOf(id);
  if (i >= 0) arr.splice(i, 1);
  else arr.push(id);
  persist();
  return isPinned(type, id);
}
