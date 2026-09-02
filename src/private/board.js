/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — battaglie, tavolo, lista permessi
   ------------------------------------------------------------------
   Tre schede, e a ciascuno compaiono solo quelle che lo riguardano:

     · BATTAGLIE   a chi comanda un'unità. Dove posso portarla stasera,
                   ordinate per quanto già si sta pagando.
     · TAVOLO      a tutti quelli che hanno un potere: le richieste, con
                   accanto quello che ha detto il gioco.
     · LISTA       al governo di una nazione: con chi lavoriamo.

   ── DUE COLONNE CHE NON SI FONDONO ─────────────────────────────────
   Sul tavolo, a sinistra quello che hanno detto le persone, a destra
   quello che ha detto il gioco. È il motivo per cui esiste: senza la
   seconda resta una chat con più passaggi; senza la prima non si sa a
   chi il contratto era stato promesso.

   ── I BOTTONI SEGUONO I POTERI, NON I DESIDERI ─────────────────────
   Compaiono solo le azioni che il server accetterebbe da questa
   identità. Un bottone che promette e poi risponde 403 è peggio di un
   bottone assente.
   ══════════════════════════════════════════════════════════════ */

import { pvT, pvErr } from './i18n.js';
import {
  leggiTavolo, chiediContratto, approvaRichiesta, rifiutaRichiesta,
  segnaAperta, ritiraRichiesta, battaglieInCorso,
  nazioniAmmesse, leggiListaPermessi, aggiungiAllaLista, togliDallaLista,
  ApiError,
} from './api.js';
import { preparaBattaglie, nomeNazione } from './battles.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const num = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString());

function quando(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleString(undefined,
    { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function creaTavolo(ctx) {
  let dati = null;              // { richieste, capacita, lente }
  let battaglie = null;         // preparate e ordinate
  let ammesse = null;           // Set di countryId
  let liste = new Map();        // countryId → lista permessi
  let caricamento = false;
  let errore = null;
  let apertaId = null;          // battaglia con il modulo aperto
  let occupato = false;

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    const lente = ctx.lente();
    try {
      dati = await leggiTavolo({ asAccount: lente });

      const cap = dati.capacita || {};
      // Le battaglie servono solo a chi può chiedere: per un ministro
      // sarebbero una lista di cose che non può fare.
      if (cap.chiedePer?.length) {
        const [p, b] = await Promise.all([
          nazioniAmmesse({ asAccount: lente }).catch(() => ({ countryIds: [] })),
          battaglieInCorso().catch(() => []),
        ]);
        ammesse = new Set(p.countryIds || []);
        battaglie = await preparaBattaglie(b, ammesse);
      }

      // Le liste permessi delle nazioni che questa persona governa.
      liste = new Map();
      for (const cid of cap.gestisceNazione || []) {
        try { liste.set(cid, await leggiListaPermessi(cid, { asAccount: lente })); }
        catch { /* una lista che non si legge non deve rompere la vista */ }
      }
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

  /** Tutte le schede, in un frammento: chi le monta decide dove. */
  function render() {
    const frag = document.createDocumentFragment();

    if (!dati && !caricamento) carica();
    if (errore) frag.appendChild(el('p', 'wp-pv-error', errore));
    if (!dati) {
      if (caricamento) frag.appendChild(el('p', 'wp-pv-note', '…'));
      return frag;
    }

    const cap = dati.capacita || {};
    if (cap.chiedePer?.length && !dati.lente) frag.appendChild(cardBattaglie(cap));
    frag.appendChild(cardTavolo(cap));
    for (const [cid, lista] of liste) frag.appendChild(cardLista(cid, lista));
    return frag;
  }

  // ── Battaglie ────────────────────────────────────────────────────────
  function cardBattaglie(cap) {
    const card = el('div', 'wp-pv-card');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('battlesTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('battlesBody')));

    if (!battaglie) { card.appendChild(el('p', 'wp-pv-note', '…')); return card; }
    if (!battaglie.length) { card.appendChild(el('p', 'wp-pv-note', pvT('noBattlesFor'))); return card; }

    const lista = el('div', 'wp-pv-battaglie');
    for (const b of battaglie) lista.appendChild(rigaBattaglia(b, cap));
    card.appendChild(lista);
    return card;
  }

  function rigaBattaglia(b, cap) {
    const box = el('div', 'wp-pv-btl');

    const testa = el('div', 'wp-pv-btl-testa');
    testa.appendChild(el('strong', 'wp-pv-btl-nome', b.etichetta));
    const apri = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small',
      apertaId === b.id ? pvT('cancel') : pvT('askHere'));
    apri.type = 'button'; apri.disabled = occupato;
    apri.addEventListener('click', () => { apertaId = apertaId === b.id ? null : b.id; ctx.ridisegna(); });
    testa.appendChild(apri);
    box.appendChild(testa);

    const numeri = el('div', 'wp-pv-btl-numeri');
    numeri.appendChild(voce(pvT('damageSoFar'), num(b.danno)));
    // La taglia c'è solo sulle prime della classifica: sotto, il numero
    // non cambierebbe una decisione e non vale una richiesta in più.
    if (b.taglia != null) numeri.appendChild(voce(pvT('bountyPaid'), num(b.taglia)));
    box.appendChild(numeri);

    if (apertaId === b.id) box.appendChild(moduloRichiesta(b, cap));
    return box;
  }

  function voce(etichetta, valore) {
    const v = el('div', 'wp-pv-btl-voce');
    v.appendChild(el('span', 'wp-pv-label', etichetta));
    v.appendChild(el('strong', null, valore));
    return v;
  }

  function moduloRichiesta(b, cap) {
    const form = el('form', 'wp-pv-form wp-pv-form-richiesta');

    // Solo gli schieramenti la cui nazione ammette questa unità: gli
    // altri non sono una scelta, sono un rifiuto rimandato.
    const lato = el('select', 'wp-pv-select');
    for (const s of b.lati) {
      const o = el('option', null, s.nome || nomeNazione(s.countryId) || s.countryId);
      o.value = `${s.side}|${s.countryId}`;
      lato.appendChild(o);
    }

    const unita = el('select', 'wp-pv-select');
    for (const id of cap.chiedePer) {
      const o = el('option', null, ctx.nomeUnita?.(id) || id);
      o.value = id; unita.appendChild(o);
    }

    const danno = campo('number', pvT('minDamage'), '1000000');
    const budget = campo('number', pvT('budgetL'), '100');
    const nota = campo('text', pvT('noteL'), pvT('notePh'));

    const pro = el('label', 'wp-pv-check');
    const proBox = el('input'); proBox.type = 'checkbox';
    pro.appendChild(proBox); pro.appendChild(el('span', null, pvT('proOnly')));

    const invia = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('send'));
    invia.type = 'submit'; invia.disabled = occupato;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const [side, countryId] = String(lato.value || '|').split('|');
      azione(async () => {
        await chiediContratto({
          battleId: b.id, battleLabel: b.etichetta, side, countryId,
          muId: unita.value, muNome: ctx.nomeUnita?.(unita.value) || null,
          minDamage: Number(danno.input.value) || null,
          budget: Number(budget.input.value) || null,
          professionalsOnly: proBox.checked,
          note: nota.input.value.trim() || null,
        });
        apertaId = null;
      });
    });

    form.appendChild(etichetta(pvT('side'), lato));
    form.appendChild(etichetta(pvT('unit'), unita));
    const r = el('div', 'wp-pv-riga');
    r.appendChild(danno.wrap); r.appendChild(budget.wrap);
    form.appendChild(r);
    form.appendChild(nota.wrap);
    form.appendChild(pro);
    form.appendChild(invia);
    return form;
  }

  // ── Tavolo ───────────────────────────────────────────────────────────
  function cardTavolo(cap) {
    const card = el('div', 'wp-pv-card wp-pv-card-tavolo');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('boardTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('boardBody')));

    if (!dati.richieste.length) { card.appendChild(el('p', 'wp-pv-note', pvT('empty'))); return card; }

    const lista = el('div', 'wp-pv-righe');
    for (const r of dati.richieste) lista.appendChild(rigaRichiesta(r, cap));
    card.appendChild(lista);
    return card;
  }

  function rigaRichiesta(r, cap) {
    const box = el('div', `wp-pv-riga-req wp-pv-st-${r.status}`);

    const testa = el('div', 'wp-pv-req-testa');
    testa.appendChild(el('strong', 'wp-pv-req-mu', r.muNome || r.muId));
    testa.appendChild(el('span', 'wp-pv-req-stato',
      pvT(`st${r.status.charAt(0).toUpperCase()}${r.status.slice(1)}`)));
    box.appendChild(testa);

    box.appendChild(el('div', 'wp-pv-req-battaglia', r.battleLabel || r.battleId));
    box.appendChild(el('div', 'wp-pv-req-numeri',
      `${pvT('minDamage')} ${num(r.minDamage)} · ${pvT('budgetL')} ${num(r.budget)}`
      + (r.professionalsOnly ? ` · ${pvT('proOnly')}` : '')));
    if (r.note) box.appendChild(el('div', 'wp-pv-req-nota', r.note));

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

  // ── Lista permessi ───────────────────────────────────────────────────
  function cardLista(countryId, lista) {
    const card = el('div', 'wp-pv-card');
    const titolo = nomeNazione(countryId)
      ? `${pvT('listTitle')} — ${nomeNazione(countryId)}` : pvT('listTitle');
    card.appendChild(el('h2', 'wp-pv-h2', titolo));
    card.appendChild(el('p', 'wp-pv-body', pvT('listBody')));

    // Il predefinito si dichiara sempre, anche quando non c'è nessuna
    // voce: una lista vuota non vuol dire "nessuno".
    const base = el('div', 'wp-pv-lista-base');
    base.appendChild(el('span', 'wp-pv-badge', pvT('listDefault')));
    card.appendChild(base);

    const voci = lista.voci || [];
    if (!voci.length) card.appendChild(el('p', 'wp-pv-note', pvT('listNoEntries')));
    else {
      const ul = el('div', 'wp-pv-lista');
      for (const v of voci) ul.appendChild(rigaLista(countryId, v, lista.puoiModificare));
      card.appendChild(ul);
    }

    if (lista.puoiModificare && !dati.lente) card.appendChild(moduloLista(countryId));
    else if (!lista.puoiModificare) card.appendChild(el('p', 'wp-pv-note', pvT('listCantEdit')));
    return card;
  }

  function rigaLista(countryId, v, modificabile) {
    const riga = el('div', `wp-pv-lista-riga wp-pv-lista-${v.mode}`);
    riga.appendChild(el('span', 'wp-pv-lista-modo',
      v.mode === 'allow' ? pvT('listAllowed') : pvT('listDenied')));
    riga.appendChild(el('span', 'wp-pv-lista-chi',
      v.entryType === 'country' ? (nomeNazione(v.entryId) || v.entryId) : v.entryId));
    if (v.nota) riga.appendChild(el('span', 'wp-pv-lista-nota', v.nota));

    if (modificabile && !dati.lente) {
      const x = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('remove'));
      x.type = 'button'; x.disabled = occupato;
      x.addEventListener('click', () => azione(() =>
        togliDallaLista(countryId, { entryType: v.entryType, entryId: v.entryId })));
      riga.appendChild(x);
    }
    return riga;
  }

  function moduloLista(countryId) {
    const form = el('form', 'wp-pv-form wp-pv-form-lista');

    const tipo = el('select', 'wp-pv-select');
    for (const [v, t] of [['country', pvT('addCountry')], ['mu', pvT('addMu')]]) {
      const o = el('option', null, t); o.value = v; tipo.appendChild(o);
    }
    const modo = el('select', 'wp-pv-select');
    for (const [v, t] of [['allow', pvT('allow')], ['deny', pvT('deny')]]) {
      const o = el('option', null, t); o.value = v; modo.appendChild(o);
    }
    const id = el('input', 'wp-pv-input');
    id.type = 'text'; id.placeholder = pvT('idPh'); id.autocomplete = 'off'; id.maxLength = 24;

    const nota = el('input', 'wp-pv-input');
    nota.type = 'text'; nota.placeholder = pvT('reasonPh'); nota.autocomplete = 'off';

    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('add'));
    salva.type = 'submit'; salva.disabled = occupato;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      azione(() => aggiungiAllaLista(countryId, {
        entryType: tipo.value, entryId: id.value.trim(),
        mode: modo.value, nota: nota.value.trim() || null,
      }));
    });

    const r1 = el('div', 'wp-pv-riga');
    r1.appendChild(tipo); r1.appendChild(modo);
    const r2 = el('div', 'wp-pv-riga');
    r2.appendChild(id); r2.appendChild(salva);
    form.appendChild(r1); form.appendChild(r2); form.appendChild(nota);
    return form;
  }

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

  return { render, ricarica: carica };
}
