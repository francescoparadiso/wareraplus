/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — pannello permessi (amministratore)
   ------------------------------------------------------------------
   Serve a tre cose, e a nessun'altra:

     1. CORREGGERE i ruoli che il gioco calcola male o non modella (i
        capi alleanza non hanno un campo; un ministro che delega non
        risulta da nessuna parte).
     2. GUARDARE quello che vede un'altra persona, quando segnala di non
        vedere ciò che dovrebbe.
     3. (il collegamento a mano del personaggio sta nella verifica, non qui)

   ── RISCRITTO IL 2026-11-18: SI PARLA DI COSA SI PUÒ FARE ──────────────
   La versione di prima chiedeva "ambito / ruolo / concedi" e un id: il
   linguaggio del database. Chi amministra non pensa "grant minOfDefense su
   country X": pensa "questa persona deve poter approvare i contratti
   dell'Iraq". Qui si sceglie il DIRITTO (governo di una nazione, gestire una
   nazione, chiedere contratti per un'unità, bloccare un ruolo di gioco) e
   dove vale, per NOME. Il ruolo che finisce nel database resta un dettaglio:

       governo di una nazione     → grant country · vicePresident   (approva + gestisce)
       gestire una nazione        → grant country · minOfEconomy    (gestisce, non approva)
       chiedere per un'unità      → grant mu · commander
       bloccare un ruolo di gioco → revoke del ruolo che il gioco gli dà

   Gli effetti veri sono solo tre (approvare, gestire, chiedere): lo dice
   roles.js `calcolaEffettivi`. `congress`, capo alleanza e `global` non
   facevano niente e non si offrono più; le vecchie righe si leggono ancora
   e si possono togliere, marcate "senza effetto".

   Ogni persona mostra COSA PUÒ FARE ADESSO (dal server, con l'origine:
   "aggiunto qui" o dal gioco) e le MODIFICHE fatte qui, ciascuna con un
   bottone per toglierla. Prima le correzioni esistenti non si vedevano
   nemmeno: c'era solo il modulo per aggiungerne.

   ── LA LENTE È DI SOLA LETTURA, E NON PER PRUDENZA ─────────────────
   Un amministratore può vedere con gli occhi di un altro ma non agire
   al suo posto. Se potesse, ogni riga dell'archivio diventerebbe
   ambigua — "l'ha approvato lui o l'admin per lui?" — e l'audit log
   perderebbe l'unica cosa che deve garantire. Il divieto sta sul
   SERVER: qui si disegna soltanto, e un bottone nascosto non è mai un
   permesso negato.

   ── OGNI CORREZIONE HA UN MOTIVO OBBLIGATORIO ──────────────────────
   Non è burocrazia: fra sei mesi una deroga senza spiegazione è
   indistinguibile da un errore, e nessuno oserà toglierla.
   ══════════════════════════════════════════════════════════════ */

import { pvT, pvErr } from './i18n.js';
import { pmT } from './i18nAdmin.js';
import {
  elencoAccount, dettaglioAccount, metteDeroga, togliDeroga, nominaAdmin, leggiRuoli, cercaUnita, nomeUnitaPerId, ApiError,
} from './api.js';
import { state } from '../diplomacy/state.js';

// Cosa fa davvero un ruolo concesso (vedi roles.js: calcolaEffettivi).
const ROLI_APPROVA = new Set(['president', 'vicePresident', 'minOfDefense']);   // approva E gestisce
const RUOLI_UNITA = new Set(['owner', 'commander', 'manager']);                  // chiede per l'unita'
const RUOLO_GOVERNO = 'vicePresident';
const RUOLO_GESTIONE = 'minOfEconomy';
const RUOLO_UNITA = 'commander';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const nomeNazione = (id) => state.nationMap?.get?.(id)?.name || null;
const corto = (id) => (id ? `…${String(id).slice(-4)}` : '?');

/**
 * Una correzione in parole: cosa fa, non come e' scritta. `nomeUnita` puo' non
 * sapere il nome (ripiego: gli ultimi quattro caratteri dell'id).
 */
export function descriviDeroga(d, nomeUnita = () => null) {
  const naz = () => nomeNazione(d.scopeId) || corto(d.scopeId);
  const unita = () => nomeUnita(d.scopeId) || corto(d.scopeId);
  if (d.scopeType === 'country' && d.role !== 'congress') {
    if (d.mode === 'grant') return pmT(ROLI_APPROVA.has(d.role) ? 'chGov' : 'chManage', { x: naz() });
    return pmT('chBlockGov', { x: `${naz()} (${pvT(d.role)})` });
  }
  if (d.scopeType === 'mu' && RUOLI_UNITA.has(d.role)) {
    if (d.mode === 'grant') return pmT('chAsk', { x: unita() });
    return pmT('chBlockUnit', { x: `${unita()} (${pvT(d.role)})` });
  }
  // congresso, capo alleanza, "globale": non hanno mai avuto effetto.
  return pmT('chOld', { x: `${pvT(d.role)} · ${d.scopeType}${d.scopeId ? ` ${corto(d.scopeId)}` : ''}` });
}

/**
 * @param {object} ctx
 * @param {Function} ctx.ridisegna  richiama il render della vista
 * @param {Function} ctx.apriComeAltri  (accountId|null) => void
 * @param {Function} ctx.ruoliCambiati  da chiamare dopo ogni modifica che
 *   tocca i poteri: il tavolo tiene in memoria le capacita' con cui era
 *   stato caricato, e senza questo avviso continua a disegnare i bottoni
 *   di prima. Era un bug reale: si concedeva una carica e il bottone
 *   "Approva" non compariva finche' non si ricaricava la pagina.
 */
export function creaPannelloAdmin(ctx) {
  let accounts = null;
  let caricamento = false;
  let errore = null;
  let apertoId = null;                 // account di cui e' aperto il dettaglio
  let testo = '';                      // ricerca
  let filtro = 'all';                  // all | admin | changed | unlinked
  const dettagli = new Map();          // id → { stato: 'carico'|'ok'|'errore', dati, errore }
  const moduli = new Map();            // id → { modo, naz, unita, blocco, motivo, errore, occupato }
  const nomiUnita = new Map();         // muId → nome
  let listaEl = null;                  // il contenitore delle righe, riscritto sul posto

  const nomeUnita = (id) => nomiUnita.get(id) || null;

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    try { accounts = await elencoAccount(); }
    catch (err) { errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server'); }
    finally { caricamento = false; ctx.ridisegna(); }
  }

  /** Rilegge l'elenco SENZA far sparire la lista (i conteggi cambiano, la riga aperta resta). */
  async function ricaricaElenco() {
    try { accounts = await elencoAccount(); } catch { /* resta quello di prima */ }
    aggiornaLista();
  }

  async function caricaDettaglio(id, { refresh = false } = {}) {
    const prec = dettagli.get(id);
    dettagli.set(id, { stato: 'carico', dati: prec?.dati || null });
    aggiornaRiga(id);
    try {
      const dati = await dettaglioAccount(id, { refresh });
      dettagli.set(id, { stato: 'ok', dati });
      // I nomi delle unita' che compaiono (correzioni e poteri) si leggono una volta sola.
      const muIds = new Set([
        ...(dati.capacita?.chiedePer || []),
        ...(dati.deroghe || []).filter((d) => d.scopeType === 'mu').map((d) => d.scopeId),
      ]);
      if (dati.derivati?.muId && dati.derivati.muNome) nomiUnita.set(dati.derivati.muId, dati.derivati.muNome);
      for (const m of muIds) {
        if (m && !nomiUnita.has(m)) nomeUnitaPerId(m).then((n) => { if (n) { nomiUnita.set(m, n); aggiornaRiga(id); } });
      }
    } catch (err) {
      dettagli.set(id, { stato: 'errore', errore: err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server') });
    }
    aggiornaRiga(id);
  }

  // ── Disegno ─────────────────────────────────────────────────────────
  function render() {
    const card = el('div', 'wp-pv-card wp-pv-card-admin');
    card.appendChild(el('h2', 'wp-pv-h2', pmT('title')));
    card.appendChild(el('p', 'wp-pv-body', pmT('lead')));

    if (errore) {
      card.appendChild(el('p', 'wp-pv-error', errore));
      const r = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pmT('retry'));
      r.type = 'button'; r.addEventListener('click', carica);
      card.appendChild(r);
    }
    if (!accounts && !caricamento && !errore) { carica(); }
    if (caricamento || !accounts) {
      if (caricamento) card.appendChild(el('p', 'wp-pv-note', pmT('loading')));
      return card;
    }

    // Ricerca e filtri: cambiano solo la lista, non la card (il campo non perde il fuoco).
    const barra = el('div', 'wp-pv-perm-barra');
    const cerca = el('input', 'wp-pv-input wp-pv-perm-cerca');
    cerca.type = 'search'; cerca.placeholder = pmT('search'); cerca.value = testo; cerca.autocomplete = 'off';
    cerca.setAttribute('aria-label', pmT('search'));
    cerca.addEventListener('input', () => { testo = cerca.value; aggiornaLista(); });
    barra.appendChild(cerca);

    const chips = el('div', 'wp-pv-perm-chips');
    for (const [k, chiave] of [['all', 'fAll'], ['admin', 'fAdmins'], ['changed', 'fChanged'], ['unlinked', 'fUnlinked']]) {
      const c = el('button', `wp-pv-perm-chip${filtro === k ? ' attivo' : ''}`, pmT(chiave));
      c.type = 'button'; c.dataset.filtro = k;
      c.addEventListener('click', () => {
        filtro = k;
        chips.querySelectorAll('.wp-pv-perm-chip').forEach((x) => x.classList.toggle('attivo', x.dataset.filtro === k));
        aggiornaLista();
      });
      chips.appendChild(c);
    }
    barra.appendChild(chips);
    card.appendChild(barra);

    const conta = el('p', 'wp-pv-note wp-pv-perm-conta');
    conta.dataset.conta = '1';
    card.appendChild(conta);

    listaEl = el('div', 'wp-pv-perm-lista');
    card.appendChild(listaEl);
    aggiornaLista(card);
    return card;
  }

  const visibili = () => {
    const q = testo.trim().toLowerCase();
    return (accounts || []).filter((a) => {
      if (filtro === 'admin' && !a.admin) return false;
      if (filtro === 'changed' && !a.deroghe) return false;
      if (filtro === 'unlinked' && a.warUserId) return false;
      if (!q) return true;
      return `${a.discordUsername || ''} ${a.warUsername || ''}`.toLowerCase().includes(q);
    });
  };

  function aggiornaLista(card) {
    if (!listaEl) return;
    const lista = visibili();
    listaEl.textContent = '';
    if (!lista.length) listaEl.appendChild(el('p', 'wp-pv-note', pmT('noMatch')));
    for (const a of lista) listaEl.appendChild(rigaAccount(a));
    const conta = (card || listaEl.parentNode)?.querySelector?.('[data-conta]');
    if (conta) conta.textContent = pmT('people', { n: lista.length });
  }

  function aggiornaRiga(id) {
    const vecchia = listaEl?.querySelector?.(`[data-account="${id}"]`);
    const a = accounts?.find((x) => x.id === id);
    if (vecchia && a) vecchia.replaceWith(rigaAccount(a));
  }

  function rigaAccount(a) {
    const aperto = apertoId === a.id;
    const box = el('div', `wp-pv-account${aperto ? ' aperto' : ''}`);
    box.dataset.account = String(a.id);

    const testa = el('button', 'wp-pv-account-testa');
    testa.type = 'button';
    testa.setAttribute('aria-expanded', String(aperto));
    const nomi = el('div', 'wp-pv-account-nomi');
    nomi.appendChild(el('strong', null, a.discordUsername));
    nomi.appendChild(el('span', 'wp-pv-account-sub', a.warUsername ? pmT('linkedAs', { x: a.warUsername }) : pmT('notLinked')));
    testa.appendChild(nomi);
    if (a.admin) testa.appendChild(el('span', 'wp-pv-badge wp-pv-badge-admin', pmT('badgeAdmin')));
    if (a.deroghe) testa.appendChild(el('span', 'wp-pv-badge', a.deroghe === 1 ? pmT('changeOne') : pmT('changeMany', { n: a.deroghe })));
    testa.appendChild(el('span', 'wp-pv-perm-freccia', aperto ? '▾' : '▸'));
    testa.addEventListener('click', () => {
      const prec = apertoId;
      apertoId = aperto ? null : a.id;
      if (prec && prec !== a.id) aggiornaRiga(prec);
      aggiornaRiga(a.id);
      if (apertoId === a.id && !dettagli.has(a.id)) caricaDettaglio(a.id);
    });
    box.appendChild(testa);

    if (aperto) box.appendChild(dettaglio(a));
    return box;
  }

  // ── Il dettaglio di una persona ─────────────────────────────────────
  function dettaglio(a) {
    const d = el('div', 'wp-pv-account-dettaglio');
    const det = dettagli.get(a.id);
    if (!det || det.stato === 'carico' && !det.dati) { d.appendChild(el('p', 'wp-pv-note', pmT('loading'))); return d; }
    if (det.stato === 'errore') {
      d.appendChild(el('p', 'wp-pv-error', det.errore));
      const r = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pmT('retry'));
      r.type = 'button'; r.addEventListener('click', () => caricaDettaglio(a.id));
      d.appendChild(r);
      return d;
    }
    const dati = det.dati;

    d.appendChild(sezionePoteri(a, dati));
    d.appendChild(sezioneModifiche(a, dati));
    d.appendChild(sezioneAggiungi(a, dati));
    d.appendChild(sezioneAltro(a));
    return d;
  }

  /** "Cosa puo' fare adesso": i poteri effettivi, con l'origine (aggiunto qui o dal gioco). */
  function sezionePoteri(a, dati) {
    const s = el('section', 'wp-pv-perm-sez');
    s.appendChild(el('h3', 'wp-pv-h3', pmT('now')));
    const cap = dati.capacita || {};
    const grants = (dati.deroghe || []).filter((x) => x.mode === 'grant');
    const viaTool = (tipo, id, test) => grants.some((g) => g.scopeType === tipo && g.scopeId === id && test(g.role));

    const righe = [];
    for (const id of cap.approvaPer || []) righe.push([pmT('canApprove', { x: nomeNazione(id) || corto(id) }), viaTool('country', id, (r) => ROLI_APPROVA.has(r))]);
    for (const id of cap.gestisceNazione || []) righe.push([pmT('canManage', { x: nomeNazione(id) || corto(id) }), viaTool('country', id, (r) => r !== 'congress')]);
    for (const id of cap.chiedePer || []) righe.push([pmT('canAsk', { x: nomeUnita(id) || corto(id) }), viaTool('mu', id, (r) => RUOLI_UNITA.has(r))]);

    if (!righe.length) { s.appendChild(el('p', 'wp-pv-note', pmT('nothing'))); }
    else {
      const ul = el('ul', 'wp-pv-perm-poteri');
      for (const [t, qui] of righe) {
        const li = el('li', null, t);
        if (qui) li.appendChild(el('span', 'wp-pv-perm-origine', pmT('addedHere')));
        ul.appendChild(li);
      }
      s.appendChild(ul);
    }
    if (dati.erroreGioco) s.appendChild(el('p', 'wp-pv-note', pmT('gameWarn')));
    return s;
  }

  /** Le correzioni fatte qui, in parole, ognuna con "Togli". */
  function sezioneModifiche(a, dati) {
    const s = el('section', 'wp-pv-perm-sez');
    s.appendChild(el('h3', 'wp-pv-h3', pmT('changes')));
    const deroghe = dati.deroghe || [];
    if (!deroghe.length) { s.appendChild(el('p', 'wp-pv-note', pmT('noChanges'))); return s; }

    const ul = el('ul', 'wp-pv-perm-modifiche');
    for (const x of deroghe) {
      const li = el('li', `wp-pv-perm-mod ${x.mode === 'revoke' ? 'blocco' : 'aggiunta'}`);
      const t = el('div', 'wp-pv-perm-mod-testo');
      t.appendChild(el('span', 'wp-pv-perm-mod-icona', x.mode === 'revoke' ? '⛔' : '＋'));
      const corpo = el('div', 'wp-pv-perm-mod-corpo');
      corpo.appendChild(el('span', null, descriviDeroga(x, nomeUnita)));
      if (x.reason) corpo.appendChild(el('span', 'wp-pv-deroga-motivo', `“${x.reason}”`));
      t.appendChild(corpo);
      li.appendChild(t);

      const togli = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pmT('remove'));
      togli.type = 'button';
      togli.addEventListener('click', async () => {
        togli.disabled = true;
        try {
          await togliDeroga({ accountId: a.id, scopeType: x.scopeType, scopeId: x.scopeId, role: x.role });
          await dopoModifica(a.id);
        } catch (err) {
          const m = moduloDi(a.id); m.errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
          aggiornaRiga(a.id);
        }
      });
      li.appendChild(togli);
      ul.appendChild(li);
    }
    s.appendChild(ul);
    return s;
  }

  async function dopoModifica(id) {
    moduli.delete(id);
    await Promise.all([caricaDettaglio(id, { refresh: true }), ricaricaElenco()]);
    await ctx.ruoliCambiati?.();
  }

  const moduloDi = (id) => {
    if (!moduli.has(id)) moduli.set(id, { modo: null, naz: null, unita: null, blocco: null, motivo: '', errore: null, occupato: false });
    return moduli.get(id);
  };

  /** "Dai o togli un diritto": quattro scelte in chiaro, poi dove, poi perche'. */
  function sezioneAggiungi(a, dati) {
    const s = el('section', 'wp-pv-perm-sez');
    s.appendChild(el('h3', 'wp-pv-h3', pmT('addTitle')));
    const m = moduloDi(a.id);

    // Cosa si puo' bloccare: i ruoli che il GIOCO da' a questa persona (e non gia' bloccati).
    const der = dati.derivati || {};
    const opzBlocco = [];
    const bloccato = (tipo, id, ruolo) => (dati.deroghe || []).some((x) => x.mode === 'revoke' && x.scopeType === tipo && x.scopeId === id && x.role === ruolo);
    if (der.carica && der.countryId && !bloccato('country', der.countryId, der.carica)) {
      opzBlocco.push({ scopeType: 'country', scopeId: der.countryId, role: der.carica,
        testo: pmT('blockGov', { x: `${nomeNazione(der.countryId) || corto(der.countryId)} (${pvT(der.carica)})` }) });
    }
    if (der.ruoloMu && der.muId && RUOLI_UNITA.has(der.ruoloMu) && !bloccato('mu', der.muId, der.ruoloMu)) {
      opzBlocco.push({ scopeType: 'mu', scopeId: der.muId, role: der.ruoloMu,
        testo: pmT('blockUnit', { x: `${der.muNome || corto(der.muId)} (${pvT(der.ruoloMu)})` }) });
    }

    const scelte = el('div', 'wp-pv-perm-scelte');
    for (const [modo, t, h] of [
      ['gov', 'optGov', 'optGovHint'], ['manage', 'optManage', 'optManageHint'],
      ['unit', 'optUnit', 'optUnitHint'], ['block', 'optBlock', 'optBlockHint'],
    ]) {
      const b = el('button', `wp-pv-perm-scelta${m.modo === modo ? ' attiva' : ''}`);
      b.type = 'button';
      b.appendChild(el('strong', null, pmT(t)));
      b.appendChild(el('span', null, pmT(h)));
      b.addEventListener('click', () => { m.modo = m.modo === modo ? null : modo; m.errore = null; aggiornaRiga(a.id); });
      scelte.appendChild(b);
    }
    s.appendChild(scelte);
    if (!m.modo) return s;

    const form = el('form', 'wp-pv-perm-form');

    // ── Dove vale ──
    if (m.modo === 'gov' || m.modo === 'manage') {
      form.appendChild(el('label', 'wp-pv-perm-label', pmT('pickNation')));
      const inp = el('input', 'wp-pv-input');
      inp.type = 'text'; inp.placeholder = pmT('nationPh'); inp.autocomplete = 'off';
      const dl = el('datalist'); dl.id = `wp-pv-nazioni-${a.id}`;
      const nazioni = [...(state.nationMap || new Map())].map(([id, n]) => ({ id, nome: n?.name || id }))
        .sort((x, y) => x.nome.localeCompare(y.nome));
      for (const n of nazioni) { const o = el('option'); o.value = n.nome; dl.appendChild(o); }
      inp.setAttribute('list', dl.id);
      if (m.naz) inp.value = m.naz.nome;
      inp.addEventListener('input', () => {
        const trovata = nazioni.find((n) => n.nome.toLowerCase() === inp.value.trim().toLowerCase());
        m.naz = trovata || null;
      });
      form.appendChild(inp); form.appendChild(dl);
    } else if (m.modo === 'unit') {
      form.appendChild(el('label', 'wp-pv-perm-label', pmT('pickUnit')));
      const inp = el('input', 'wp-pv-input');
      inp.type = 'text'; inp.placeholder = pmT('unitPh'); inp.autocomplete = 'off';
      if (m.unita) inp.value = m.unita.nome;
      const ris = el('div', 'wp-pv-perm-risultati');
      let tick = null;
      inp.addEventListener('input', () => {
        m.unita = null;
        clearTimeout(tick);
        const q = inp.value.trim();
        if (q.length < 2) { ris.textContent = ''; return; }
        tick = setTimeout(async () => {
          let elenco = [];
          try { elenco = await cercaUnita(q); } catch { /* lista vuota */ }
          ris.textContent = '';
          if (!elenco.length) { ris.appendChild(el('span', 'wp-pv-note', pmT('unitNone'))); return; }
          for (const u of elenco) {
            const r = el('button', 'wp-pv-perm-risultato', u.nome);
            r.type = 'button';
            r.addEventListener('click', () => { m.unita = u; nomiUnita.set(u.id, u.nome); inp.value = u.nome; ris.textContent = ''; });
            ris.appendChild(r);
          }
        }, 450);
      });
      form.appendChild(inp); form.appendChild(ris);
    } else if (m.modo === 'block') {
      form.appendChild(el('label', 'wp-pv-perm-label', pmT('pickBlock')));
      if (!opzBlocco.length) form.appendChild(el('p', 'wp-pv-note', pmT('noGameRoles')));
      opzBlocco.forEach((o, i) => {
        const r = el('label', 'wp-pv-perm-radio');
        const inp = el('input'); inp.type = 'radio'; inp.name = `blocco-${a.id}`;
        inp.checked = m.blocco === i || (m.blocco == null && opzBlocco.length === 1);
        if (inp.checked) m.blocco = i;
        inp.addEventListener('change', () => { m.blocco = i; });
        r.appendChild(inp); r.appendChild(el('span', null, o.testo));
        form.appendChild(r);
      });
    }

    // ── Perche' ──
    if (m.modo !== 'block' || opzBlocco.length) {
      form.appendChild(el('label', 'wp-pv-perm-label', pmT('reason')));
      const mot = el('input', 'wp-pv-input');
      mot.type = 'text'; mot.placeholder = pmT('reasonPh'); mot.maxLength = 300; mot.autocomplete = 'off';
      mot.value = m.motivo || '';
      mot.addEventListener('input', () => { m.motivo = mot.value; });
      form.appendChild(mot);

      if (m.errore) form.appendChild(el('p', 'wp-pv-error', m.errore));

      const riga = el('div', 'wp-pv-perm-azioni');
      const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pmT('add'));
      salva.type = 'submit'; salva.disabled = m.occupato;
      const annulla = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pmT('cancel'));
      annulla.type = 'button';
      annulla.addEventListener('click', () => { moduli.delete(a.id); aggiornaRiga(a.id); });
      riga.appendChild(salva); riga.appendChild(annulla);
      form.appendChild(riga);
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      let dati2;
      if (m.modo === 'gov' || m.modo === 'manage') {
        if (!m.naz) { m.errore = pmT('chooseNation'); aggiornaRiga(a.id); return; }
        dati2 = { scopeType: 'country', scopeId: m.naz.id, role: m.modo === 'gov' ? RUOLO_GOVERNO : RUOLO_GESTIONE, mode: 'grant' };
      } else if (m.modo === 'unit') {
        if (!m.unita) { m.errore = pmT('chooseUnit'); aggiornaRiga(a.id); return; }
        dati2 = { scopeType: 'mu', scopeId: m.unita.id, role: RUOLO_UNITA, mode: 'grant' };
      } else {
        const o = opzBlocco[m.blocco ?? 0];
        if (!o) return;
        dati2 = { scopeType: o.scopeType, scopeId: o.scopeId, role: o.role, mode: 'revoke' };
      }
      const motivo = (m.motivo || '').trim();
      if (!motivo) { m.errore = pvErr('motivo_obbligatorio'); aggiornaRiga(a.id); return; }
      m.occupato = true; m.errore = null; aggiornaRiga(a.id);
      try {
        await metteDeroga({ accountId: a.id, ...dati2, reason: motivo });
        await dopoModifica(a.id);
      } catch (err) {
        m.occupato = false;
        m.errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
        aggiornaRiga(a.id);
      }
    });

    s.appendChild(form);
    return s;
  }

  /** Il resto, in fondo e senza rumore: guardare come lei, nominare un amministratore. */
  function sezioneAltro(a) {
    const det = el('details', 'wp-pv-perm-altro');
    det.appendChild(el('summary', null, pmT('more')));

    const vedi = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pmT('viewAs'));
    vedi.type = 'button';
    vedi.addEventListener('click', () => ctx.apriComeAltri(a.id));
    det.appendChild(vedi);
    det.appendChild(el('p', 'wp-pv-note', pmT('viewAsHint')));

    const adm = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', a.admin ? pmT('removeAdmin') : pmT('makeAdmin'));
    adm.type = 'button';
    adm.addEventListener('click', async () => {
      if (!a.admin && !window.confirm(pmT('askAdmin', { x: a.discordUsername }))) return;
      adm.disabled = true;
      try { await nominaAdmin(a.id, !a.admin); await ricaricaElenco(); await ctx.ruoliCambiati?.(); }
      catch (err) { const m = moduloDi(a.id); m.errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server'); aggiornaRiga(a.id); }
    });
    det.appendChild(adm);
    const m = moduli.get(a.id);
    if (m?.errore && !m.modo) det.appendChild(el('p', 'wp-pv-error', m.errore));
    return det;
  }

  return { render, ricarica: carica };
}

/** Correzioni di un account, in parole, con il bottone per toglierle. Usato nella
 *  vista dei ruoli quando la si guarda con la lente di amministratore. */
export function renderDeroghe(deroghe, { accountId, onCambio } = {}) {
  if (!deroghe?.length) return null;
  const box = el('div', 'wp-pv-deroghe');
  for (const d of deroghe) {
    const riga = el('div', 'wp-pv-deroga');
    riga.appendChild(el('span', 'wp-pv-deroga-testo', descriviDeroga(d)));
    if (d.reason) riga.appendChild(el('span', 'wp-pv-deroga-motivo', d.reason));

    if (accountId && onCambio) {
      const togli = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('remove'));
      togli.type = 'button';
      togli.addEventListener('click', async () => {
        togli.disabled = true;
        await togliDeroga({ accountId, scopeType: d.scopeType, scopeId: d.scopeId, role: d.role });
        await onCambio();
      });
      riga.appendChild(togli);
    }
    box.appendChild(riga);
  }
  return box;
}

export { leggiRuoli };
