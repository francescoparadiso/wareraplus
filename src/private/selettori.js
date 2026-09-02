/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — scegliere nazioni, unità, alleanze
   ------------------------------------------------------------------
   Un posto solo. Serviva in due moduli — le correzioni ai ruoli e la
   lista di chi può chiederci un contratto — e la prima volta l'ho
   scritto in uno solo: l'altro chiedeva ancora di incollare a mano un
   identificativo di ventiquattro caratteri esadecimali, preso da chissà
   dove. Due copie della stessa cosa divergono sempre, e la seconda
   resta indietro.

   ── COME SI SCEGLIE, PER OGNI TIPO ─────────────────────────────────
   Nazioni: sono 180 e sono già tutte in memoria dal boot della mappa —
   un menù, in ordine alfabetico. Alleanze: sedici, arrivano dal server
   di cache coi nomi. Unità militari: 1379, troppe per un menù, quindi
   si cercano per nome con una chiamata pubblica ogni mezzo secondo di
   digitazione.

   Nessuna delle tre chiede un id all'utente. Un campo che dice solo
   "id" non dice nemmeno di cosa, e chi lo compila lo fa copiando da un
   posto che noi non gli abbiamo dato.

   ── UNA ALLA VOLTA, O PARECCHIE ────────────────────────────────────
   Con `multiplo: true` il selettore smette di essere un campo e diventa
   un carrello: si scelgono nazioni, unità e alleanze — anche mescolate —
   e si conferma una volta sola. Serve perché la lista permessi si
   compila a blocchi ("questi sei alleati sì, quest'unità no"), e farlo
   una voce per volta significava sei giri di richiesta, ricarica e
   pagina che salta sotto le mani.

   Il carrello accetta i tre tipi INSIEME di proposito: chi apre quella
   scheda ha in testa un elenco di nomi, non tre elenchi divisi per
   natura dell'oggetto.

   ── ⚠️ `hidden` NON BASTA ───────────────────────────────────────────
   `[hidden]` nel foglio del browser è solo `display:none`, e qualunque
   classe con un `display` esplicito lo batte: `.wp-pv-campo` è `flex`,
   quindi i blocchi "nascosti" restavano a schermo. Il sintomo era la
   lista permessi con il menù delle nazioni e la ricerca delle unità
   visibili insieme, due campi identici uno sotto l'altro. La regola in
   private.css lo forza; qui si continua a usare `hidden` perché è la
   proprietà giusta — è il CSS che doveva rispettarla.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { pvT } from './i18n.js';
import { cercaUnita, elencoAlleanze } from './api.js';

const ATTESA_RICERCA_MS = 500;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * @param {object} opzioni
 * @param {string[]} opzioni.tipi      quali ambiti offrire, in ordine
 * @param {boolean}  opzioni.multiplo  carrello invece di campo singolo
 * @returns {{
 *   wrap: HTMLElement, tipoSel: HTMLSelectElement,
 *   tipo: () => string, id: () => string,
 *   scelte: () => Array<{entryType: string, entryId: string, nome: string}>,
 *   svuota: () => void, onCambio: (fn: Function) => void
 * }}
 */
export function creaSelettoreEntita({ tipi = ['country', 'mu', 'alliance'], multiplo = false } = {}) {
  const wrap = el('div', 'wp-pv-selettore');

  const etichettaTipo = {
    country: pvT('scopeCountry'),
    mu: pvT('scopeMu'),
    alliance: pvT('scopeAlliance'),
  };

  const tipoSel = el('select', 'wp-pv-select');
  for (const t of tipi) {
    const o = el('option', null, etichettaTipo[t] || t);
    o.value = t;
    tipoSel.appendChild(o);
  }

  // ── Nazioni: già in memoria, in ordine alfabetico ──────────────────
  const nazioni = el('select', 'wp-pv-select');
  const righeNazioni = [...(state.nationMap || new Map())]
    .map(([id, n]) => ({ id, nome: n?.name || id }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
  for (const n of righeNazioni) {
    const o = el('option', null, n.nome); o.value = n.id; nazioni.appendChild(o);
  }

  // ── Alleanze: sedici, dal server di cache ──────────────────────────
  const alleanze = el('select', 'wp-pv-select');
  const attesa = el('option', null, '…'); attesa.value = '';
  alleanze.appendChild(attesa);
  if (tipi.includes('alliance')) {
    elencoAlleanze().then((elenco) => {
      alleanze.textContent = '';
      for (const a of elenco) {
        const o = el('option', null, a.nome); o.value = a.id; alleanze.appendChild(o);
      }
    }).catch(() => { attesa.textContent = pvT('noMatch'); });
  }

  // ── Unità: troppe per un menù, si cercano per nome ─────────────────
  const cerca = el('input', 'wp-pv-input');
  cerca.type = 'text';
  cerca.placeholder = pvT('muSearchPh');
  cerca.autocomplete = 'off';

  const risultati = el('select', 'wp-pv-select');
  // ⚠️ Non lo stesso testo del campo di ricerca: erano due controlli con
  // la stessa scritta uno sotto l'altro, e sembravano un errore di
  // disegno. Questo dice cosa fa lui, non cosa fare all'altro.
  const vuoto = el('option', null, pvT('muNoSearchYet')); vuoto.value = '';
  risultati.appendChild(vuoto);

  let tick = null;
  cerca.addEventListener('input', () => {
    clearTimeout(tick);
    const testo = cerca.value.trim();
    if (testo.length < 3) return;
    // Mezzo secondo di attesa: una chiamata per tasto premuto sarebbero
    // undici richieste per scrivere "praetorians".
    tick = setTimeout(async () => {
      const trovate = await cercaUnita(testo).catch(() => []);
      risultati.textContent = '';
      if (!trovate.length) {
        const o = el('option', null, pvT('noMatch')); o.value = ''; risultati.appendChild(o);
      }
      for (const m of trovate) {
        const o = el('option', null, m.nome); o.value = m.id; risultati.appendChild(o);
      }
    }, ATTESA_RICERCA_MS);
  });
  // Invio nel campo di ricerca non deve mandare il modulo: qui dentro
  // "invio" vuol dire "cerca", non "salva la lista".
  cerca.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

  const bloccoNazione = campo(pvT('pickCountry'), nazioni);
  const bloccoAlleanza = campo(pvT('pickAlliance'), alleanze);
  const bloccoMu = campo(pvT('pickMu'), cerca, risultati);

  function attivo() { return tipoSel.value; }

  function idCorrente() {
    const t = attivo();
    if (t === 'mu') return risultati.value || '';
    if (t === 'alliance') return alleanze.value || '';
    return nazioni.value || '';
  }

  function nomeCorrente() {
    const t = attivo();
    const sel = t === 'mu' ? risultati : t === 'alliance' ? alleanze : nazioni;
    return sel.options[sel.selectedIndex]?.textContent || '';
  }

  function mostra() {
    const t = attivo();
    bloccoNazione.hidden = t !== 'country';
    bloccoMu.hidden = t !== 'mu';
    bloccoAlleanza.hidden = t !== 'alliance';
  }
  tipoSel.addEventListener('change', mostra);

  wrap.appendChild(campo(pvT('scope'), tipoSel));
  if (tipi.includes('country')) wrap.appendChild(bloccoNazione);
  if (tipi.includes('alliance')) wrap.appendChild(bloccoAlleanza);
  if (tipi.includes('mu')) wrap.appendChild(bloccoMu);
  mostra();

  // ── Campo singolo: finisce qui ─────────────────────────────────────
  if (!multiplo) {
    return {
      wrap, tipoSel,
      tipo: attivo,
      id: idCorrente,
      scelte: () => {
        const entryId = idCorrente();
        return entryId ? [{ entryType: attivo(), entryId, nome: nomeCorrente() }] : [];
      },
      svuota: () => {},
      onCambio: () => {},
    };
  }

  // ── Carrello ───────────────────────────────────────────────────────
  const scelte = new Map();          // "tipo:id" → { entryType, entryId, nome }
  const ascoltatori = [];
  const avvisa = () => { for (const fn of ascoltatori) fn(scelte.size); };

  const gettoni = el('div', 'wp-pv-gettoni');
  const vuotoTesto = el('span', 'wp-pv-note wp-pv-gettoni-vuoto', pvT('nothingPicked'));

  function disegnaGettoni() {
    gettoni.textContent = '';
    if (!scelte.size) { gettoni.appendChild(vuotoTesto); return; }
    for (const [chiave, v] of scelte) {
      const g = el('span', `wp-pv-gettone wp-pv-gettone-${v.entryType}`);
      g.appendChild(el('span', 'wp-pv-gettone-tipo', etichettaTipo[v.entryType] || v.entryType));
      g.appendChild(el('span', 'wp-pv-gettone-nome', v.nome || v.entryId));
      const via = el('button', 'wp-pv-gettone-via', '×');
      via.type = 'button';
      via.title = pvT('remove');
      via.addEventListener('click', () => { scelte.delete(chiave); disegnaGettoni(); avvisa(); });
      g.appendChild(via);
      gettoni.appendChild(g);
    }
  }

  function aggiungiCorrente() {
    const entryId = idCorrente();
    if (!entryId) return;
    scelte.set(`${attivo()}:${entryId}`, { entryType: attivo(), entryId, nome: nomeCorrente() });
    disegnaGettoni();
    avvisa();
  }

  const piu = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('pickAdd'));
  piu.type = 'button';
  piu.addEventListener('click', aggiungiCorrente);
  // Doppio clic sul menù: la strada breve, per chi ne sta aggiungendo sei
  // di fila e non vuole tornare sul bottone ogni volta.
  for (const sel of [nazioni, alleanze, risultati]) {
    sel.addEventListener('dblclick', aggiungiCorrente);
  }

  const riga = el('div', 'wp-pv-riga wp-pv-selettore-azioni');
  riga.appendChild(piu);
  wrap.appendChild(riga);
  wrap.appendChild(gettoni);
  disegnaGettoni();

  return {
    wrap, tipoSel,
    tipo: attivo,
    id: idCorrente,
    scelte: () => [...scelte.values()],
    svuota: () => { scelte.clear(); disegnaGettoni(); avvisa(); },
    onCambio: (fn) => { ascoltatori.push(fn); },
  };
}

function campo(testo, ...controlli) {
  const c = el('div', 'wp-pv-campo');
  c.appendChild(el('span', 'wp-pv-label', testo));
  for (const x of controlli) c.appendChild(x);
  return c;
}
