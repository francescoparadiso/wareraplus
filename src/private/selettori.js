/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — scegliere una nazione, un'unità, un'alleanza
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
 * @param {string[]} opzioni.tipi  quali ambiti offrire, in ordine
 * @returns {{ wrap: HTMLElement, tipo: () => string, id: () => string }}
 */
export function creaSelettoreEntita({ tipi = ['country', 'mu', 'alliance'] } = {}) {
  const wrap = el('div', 'wp-pv-selettore');

  const etichetta = {
    country: pvT('scopeCountry'),
    mu: pvT('scopeMu'),
    alliance: pvT('pickAlliance'),
  };

  const tipoSel = el('select', 'wp-pv-select');
  for (const t of tipi) {
    const o = el('option', null, etichetta[t] || t);
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
  const vuoto = el('option', null, pvT('muSearchPh')); vuoto.value = '';
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

  const bloccoNazione = campo(pvT('pickCountry'), nazioni);
  const bloccoAlleanza = campo(pvT('pickAlliance'), alleanze);
  const bloccoMu = campo(pvT('pickMu'), cerca, risultati);

  function mostra() {
    const t = tipoSel.value;
    bloccoNazione.hidden = t !== 'country';
    bloccoMu.hidden = t !== 'mu';
    bloccoAlleanza.hidden = t !== 'alliance';
  }
  tipoSel.addEventListener('change', mostra);

  wrap.appendChild(tipoSel);
  if (tipi.includes('country')) wrap.appendChild(bloccoNazione);
  if (tipi.includes('alliance')) wrap.appendChild(bloccoAlleanza);
  if (tipi.includes('mu')) wrap.appendChild(bloccoMu);
  mostra();

  return {
    wrap,
    tipoSel,
    tipo: () => tipoSel.value,
    id: () => {
      const t = tipoSel.value;
      if (t === 'mu') return risultati.value || '';
      if (t === 'alliance') return alleanze.value || '';
      return nazioni.value || '';
    },
  };
}

function campo(testo, ...controlli) {
  const c = el('div', 'wp-pv-campo');
  c.appendChild(el('span', 'wp-pv-label', testo));
  for (const x of controlli) c.appendChild(x);
  return c;
}
