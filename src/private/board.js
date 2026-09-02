/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — il tavolo dei contratti
   ------------------------------------------------------------------
   Quello che oggi succede in una chat e scorre via. Il comandante
   chiede, il ministro approva, il ministro apre l'asta e lo spunta.

   ── DUE COLONNE CHE NON SI FONDONO ─────────────────────────────────
   A sinistra quello che hanno detto le persone, a destra quello che ha
   detto il gioco. È il motivo per cui il tavolo esiste: senza la
   seconda colonna resta una chat con più passaggi; senza la prima non
   si sa a chi il contratto era stato promesso.

   ── I BOTTONI SEGUONO I POTERI, NON I DESIDERI ─────────────────────
   Ogni riga mostra solo le azioni che il server accetterebbe da questa
   identità. Un bottone che compare e poi dà 403 è peggio di un bottone
   che non c'è: promette qualcosa e poi accusa chi l'ha premuto.
   ══════════════════════════════════════════════════════════════ */

import { pvT, pvErr } from './i18n.js';
import {
  leggiTavolo, chiediContratto, approvaRichiesta, rifiutaRichiesta,
  segnaAperta, ritiraRichiesta, battaglieInCorso, ApiError,
} from './api.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const num = (n) => (n == null ? '—' : Number(n).toLocaleString());

/** Ora locale corta: sul tavolo serve "quando", non la data completa. */
function quando(ms) {
  if (!ms) return null;
  const d = new Date(ms);
  return d.toLocaleString(undefined, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * @param {object} ctx
 * @param {Function} ctx.ridisegna
 * @param {() => number|null} ctx.lente  account guardato, o null
 */
export function creaTavolo(ctx) {
  let dati = null;          // { richieste, capacita, lente }
  let battaglie = null;
  let caricamento = false;
  let errore = null;
  let moduloAperto = false;
  let occupato = false;

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    try {
      dati = await leggiTavolo({ asAccount: ctx.lente() });
    } catch (err) {
      errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
    } finally {
      caricamento = false; ctx.ridisegna();
    }
  }

  async function azione(fn) {
    if (occupato) return;
    occupato = true; errore = null; ctx.ridisegna();
    try { await fn(); await carica(); }
    catch (err) { errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server'); }
    finally { occupato = false; ctx.ridisegna(); }
  }

  function render() {
    const card = el('div', 'wp-pv-card wp-pv-card-tavolo');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('boardTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('boardBody')));

    if (errore) card.appendChild(el('p', 'wp-pv-error', errore));

    if (!dati && !caricamento) { carica(); }
    if (caricamento && !dati) { card.appendChild(el('p', 'wp-pv-note', '…')); return card; }
    if (!dati) return card;

    const cap = dati.capacita || {};
    // Il modulo di richiesta compare solo a chi comanda un'unità, e mai
    // sotto lente: lì si guarda, non si agisce.
    if (cap.chiedePer?.length && !dati.lente) {
      const apri = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small',
        moduloAperto ? pvT('cancel') : pvT('newRequest'));
      apri.type = 'button';
      apri.addEventListener('click', () => { moduloAperto = !moduloAperto; ctx.ridisegna(); });
      card.appendChild(apri);
      if (moduloAperto) card.appendChild(moduloRichiesta(cap));
    }

    if (!dati.richieste.length) {
      card.appendChild(el('p', 'wp-pv-note', pvT('empty')));
      return card;
    }

    const lista = el('div', 'wp-pv-righe');
    for (const r of dati.richieste) lista.appendChild(riga(r, cap));
    card.appendChild(lista);
    return card;
  }

  function moduloRichiesta(cap) {
    const form = el('form', 'wp-pv-form wp-pv-form-richiesta');

    const battaglia = el('select', 'wp-pv-select');
    const riempi = () => {
      battaglia.textContent = '';
      if (!battaglie) { const o = el('option', null, '…'); battaglia.appendChild(o); return; }
      if (!battaglie.length) { const o = el('option', null, pvT('noBattles')); battaglia.appendChild(o); return; }
      for (const b of battaglie) {
        const o = el('option', null, etichettaBattaglia(b));
        o.value = b._id;
        battaglia.appendChild(o);
      }
    };
    riempi();
    if (!battaglie) {
      battaglieInCorso().then((b) => { battaglie = b || []; ctx.ridisegna(); }).catch(() => { battaglie = []; });
    }

    const unita = el('select', 'wp-pv-select');
    for (const id of cap.chiedePer) {
      const o = el('option', null, id === dataMuNome(id) ? id : dataMuNome(id));
      o.value = id; unita.appendChild(o);
    }

    const danno = campo('number', pvT('minDamage'), '1000000');
    const budget = campo('number', pvT('budgetL'), '100');
    const nota = campo('text', pvT('noteL'), pvT('notePh'));

    const pro = el('label', 'wp-pv-check');
    const proBox = el('input');
    proBox.type = 'checkbox';
    pro.appendChild(proBox);
    pro.appendChild(el('span', null, pvT('proOnly')));

    const invia = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('send'));
    invia.type = 'submit';
    invia.disabled = occupato;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const b = (battaglie || []).find((x) => x._id === battaglia.value);
      azione(async () => {
        await chiediContratto({
          battleId: battaglia.value,
          battleLabel: b ? etichettaBattaglia(b) : null,
          side: null,
          countryId: paeseDellaBattaglia(b),
          muId: unita.value,
          muNome: dataMuNome(unita.value),
          minDamage: Number(danno.input.value) || null,
          budget: Number(budget.input.value) || null,
          professionalsOnly: proBox.checked,
          note: nota.input.value.trim() || null,
        });
        moduloAperto = false;
      });
    });

    form.appendChild(etichetta(pvT('battle'), battaglia));
    form.appendChild(etichetta(pvT('unit'), unita));
    const r = el('div', 'wp-pv-riga');
    r.appendChild(danno.wrap); r.appendChild(budget.wrap);
    form.appendChild(r);
    form.appendChild(nota.wrap);
    form.appendChild(pro);
    form.appendChild(invia);
    return form;
  }

  function riga(r, cap) {
    const box = el('div', `wp-pv-riga-req wp-pv-st-${r.status}`);

    const testa = el('div', 'wp-pv-req-testa');
    testa.appendChild(el('strong', 'wp-pv-req-mu', r.muNome || r.muId));
    testa.appendChild(el('span', 'wp-pv-req-stato', pvT(`st${r.status.charAt(0).toUpperCase()}${r.status.slice(1)}`)));
    box.appendChild(testa);

    box.appendChild(el('div', 'wp-pv-req-battaglia', r.battleLabel || r.battleId));
    box.appendChild(el('div', 'wp-pv-req-numeri',
      `${pvT('minDamage')} ${num(r.minDamage)} · ${pvT('budgetL')} ${num(r.budget)}`
      + (r.professionalsOnly ? ` · ${pvT('proOnly')}` : '')));
    if (r.note) box.appendChild(el('div', 'wp-pv-req-nota', r.note));

    // ── Le due colonne ────────────────────────────────────────────────
    const due = el('div', 'wp-pv-req-due');

    const dette = el('div', 'wp-pv-req-col');
    if (r.richiedente) dette.appendChild(el('span', null, `${pvT('askedBy')} ${r.richiedente} · ${quando(r.createdAt)}`));
    if (r.approvatore) dette.appendChild(el('span', null, `${pvT('approvedBy')} ${r.approvatore} · ${quando(r.approvedAt)}`));
    if (r.apritore) dette.appendChild(el('span', null, `${pvT('openedBy')} ${r.apritore} · ${quando(r.openedAt)}`));
    due.appendChild(dette);

    const fatti = el('div', 'wp-pv-req-col wp-pv-req-fatti');
    fatti.appendChild(el('span', 'wp-pv-label', pvT('outcome')));
    if (r.esito) {
      fatti.appendChild(el('strong', `wp-pv-esito wp-pv-esito-${r.esito}`,
        pvT(`es${r.esito.charAt(0).toUpperCase()}${r.esito.slice(1)}`)));
      if (r.winnerMu && r.esito === 'altra_unita') fatti.appendChild(el('span', null, r.winnerMu));
    } else {
      fatti.appendChild(el('span', 'wp-pv-esito-attesa', pvT('notVerifiedYet')));
    }
    due.appendChild(fatti);
    box.appendChild(due);

    const azioni = azioniRiga(r, cap);
    if (azioni) box.appendChild(azioni);
    return box;
  }

  function azioniRiga(r, cap) {
    // Sotto lente non si agisce: il server rifiuterebbe comunque, ma un
    // bottone che promette e poi accusa è peggio di un bottone assente.
    if (dati.lente) return null;

    const azioni = el('div', 'wp-pv-azioni');
    const puoApprovare = cap.approvaPer?.includes(r.countryId);
    const puoChiedere = cap.chiedePer?.includes(r.muId);

    const b = (testo, cls, fn) => {
      const x = el('button', `wp-pv-btn ${cls} wp-pv-btn-small`, testo);
      x.type = 'button'; x.disabled = occupato;
      x.addEventListener('click', () => azione(fn));
      azioni.appendChild(x);
    };

    if (r.status === 'pending' && puoApprovare) {
      b(pvT('approve'), 'wp-pv-btn-primary', () => approvaRichiesta(r.id));
      b(pvT('reject'), 'wp-pv-btn-quiet', () => rifiutaRichiesta(r.id));
    }
    if (r.status === 'approved' && !r.openedAt && puoApprovare) {
      b(pvT('markOpened'), 'wp-pv-btn-primary', () => segnaAperta(r.id));
    }
    if (['pending', 'approved'].includes(r.status) && (puoChiedere || puoApprovare)) {
      b(pvT('withdraw'), 'wp-pv-btn-quiet', () => ritiraRichiesta(r.id));
    }
    return azioni.children.length ? azioni : null;
  }

  // ── Utilità ─────────────────────────────────────────────────────────
  function etichetta(testo, controllo) {
    const w = el('div', 'wp-pv-campo');
    w.appendChild(el('span', 'wp-pv-label', testo));
    w.appendChild(controllo);
    return w;
  }

  function campo(tipo, testo, placeholder) {
    const wrap = el('div', 'wp-pv-campo');
    wrap.appendChild(el('span', 'wp-pv-label', testo));
    const input = el('input', 'wp-pv-input');
    input.type = tipo; input.placeholder = placeholder || ''; input.autocomplete = 'off';
    wrap.appendChild(input);
    return { wrap, input };
  }

  /** Il nome dell'unità arriva dai ruoli quando c'è; altrimenti l'id, che
   *  è brutto ma vero — meglio di un'etichetta inventata. */
  function dataMuNome(id) {
    return ctx.nomeUnita?.(id) || id;
  }

  return { render, ricarica: carica };
}

function etichettaBattaglia(b) {
  const r = b?.region?.name || b?.regionName || b?.region || '';
  const a = b?.attackerCountry?.name || '';
  const d = b?.defenderCountry?.name || '';
  if (r && a && d) return `${r} — ${a} vs ${d}`;
  return r || b?._id || '?';
}

/** Per chi si combatte: si prende il difensore quando c'è, altrimenti
 *  l'attaccante. Il modulo lo mostra e resta modificabile lato server. */
function paeseDellaBattaglia(b) {
  return b?.defenderCountry?._id || b?.attackerCountry?._id || b?.countryId || '';
}
