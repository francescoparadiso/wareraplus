/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — pannello amministratore
   ------------------------------------------------------------------
   Serve a tre cose, e a nessun'altra:

     1. CORREGGERE i ruoli che il gioco calcola male o non modella (i
        capi alleanza non hanno un campo; un ministro che delega non
        risulta da nessuna parte).
     2. GUARDARE quello che vede un'altra persona, quando segnala di non
        vedere ciò che dovrebbe.
     3. COLLEGARE a mano il personaggio di chi non ha aziende, unico
        caso in cui la verifica automatica non può funzionare.

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

import { state } from '../diplomacy/state.js';
import { pvT, pvErr } from './i18n.js';
import {
  elencoAccount, metteDeroga, togliDeroga, nominaAdmin, leggiRuoli, cercaUnita, ApiError,
} from './api.js';

const RUOLI_NAZIONE = ['president', 'vicePresident', 'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy', 'congress'];
const RUOLI_MU = ['owner', 'commander', 'manager'];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
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
  let apertoId = null;      // account di cui è aperto il dettaglio

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    try { accounts = await elencoAccount(); }
    catch (err) { errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server'); }
    finally { caricamento = false; ctx.ridisegna(); }
  }

  function render() {
    const card = el('div', 'wp-pv-card wp-pv-card-admin');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('adminTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('adminBody')));

    if (errore) card.appendChild(el('p', 'wp-pv-error', errore));

    if (!accounts && !caricamento) { carica(); }
    if (caricamento) { card.appendChild(el('p', 'wp-pv-note', '…')); return card; }
    if (!accounts) return card;

    const tabella = el('div', 'wp-pv-accounts');
    for (const a of accounts) tabella.appendChild(rigaAccount(a));
    card.appendChild(tabella);
    return card;
  }

  function rigaAccount(a) {
    const box = el('div', 'wp-pv-account');

    const testa = el('div', 'wp-pv-account-testa');
    const nomi = el('div', 'wp-pv-account-nomi');
    nomi.appendChild(el('strong', null, a.discordUsername));
    nomi.appendChild(el('span', 'wp-pv-account-sub',
      a.warUsername ? `${a.warUsername} · ${pvT('linked')}` : pvT('notLinked')));
    testa.appendChild(nomi);

    if (a.admin) testa.appendChild(el('span', 'wp-pv-badge wp-pv-badge-admin', 'admin'));
    if (a.deroghe) testa.appendChild(el('span', 'wp-pv-badge', `${a.deroghe} ${pvT('overridesN')}`));

    const apri = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', apertoId === a.id ? '−' : '+');
    apri.type = 'button';
    apri.addEventListener('click', () => { apertoId = apertoId === a.id ? null : a.id; ctx.ridisegna(); });
    testa.appendChild(apri);

    box.appendChild(testa);
    if (apertoId === a.id) box.appendChild(dettaglio(a));
    return box;
  }

  function dettaglio(a) {
    const d = el('div', 'wp-pv-account-dettaglio');

    const azioni = el('div', 'wp-pv-azioni');

    const vedi = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('viewAs'));
    vedi.type = 'button';
    vedi.addEventListener('click', () => ctx.apriComeAltri(a.id));
    azioni.appendChild(vedi);

    const adm = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small',
      a.admin ? pvT('removeAdmin') : pvT('makeAdmin'));
    adm.type = 'button';
    adm.addEventListener('click', async () => {
      adm.disabled = true;
      try { await nominaAdmin(a.id, !a.admin); await carica(); await ctx.ruoliCambiati?.(); }
      catch (err) { errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server'); ctx.ridisegna(); }
    });
    azioni.appendChild(adm);
    d.appendChild(azioni);

    d.appendChild(moduloDeroga(a));
    return d;
  }

  function moduloDeroga(a) {
    const form = el('form', 'wp-pv-form wp-pv-form-deroga');
    form.appendChild(el('h3', 'wp-pv-h3', pvT('addOverride')));
    // Una correzione qui non tocca il gioco: va detto, perche' "rendi
    // presidente" suona come se lo facesse.
    form.appendChild(el('p', 'wp-pv-note', pvT('grantHint')));

    const ambito = el('select', 'wp-pv-select');
    for (const [v, t] of [['country', pvT('scopeCountry')], ['mu', pvT('scopeMu')], ['alliance', 'Alliance']]) {
      const o = el('option', null, t); o.value = v; ambito.appendChild(o);
    }

    const ruolo = el('select', 'wp-pv-select');
    const riempiRuoli = () => {
      ruolo.textContent = '';
      const elenco = ambito.value === 'mu' ? RUOLI_MU
        : ambito.value === 'alliance' ? ['leader'] : RUOLI_NAZIONE;
      for (const r of elenco) { const o = el('option', null, pvT(r)); o.value = r; ruolo.appendChild(o); }
    };
    riempiRuoli();
    ambito.addEventListener('change', riempiRuoli);

    const tipo = el('select', 'wp-pv-select');
    for (const [v, t] of [['grant', pvT('grant')], ['revoke', pvT('revoke')]]) {
      const o = el('option', null, t); o.value = v; tipo.appendChild(o);
    }

    // ── A COSA si applica la correzione ──────────────────────────────
    // Prima era un campo di testo che diceva soltanto "id": chi lo
    // guardava non poteva sapere se volesse la nazione, l'unita' o
    // l'account, e quei ventiquattro caratteri esadecimali andavano
    // presi da chissa' dove. Le nazioni sono gia' tutte in memoria dal
    // boot della mappa, quindi si scelgono per nome; le unita' si
    // cercano per nome con una chiamata pubblica.
    const idAmbito = el('input', 'wp-pv-input');
    idAmbito.type = 'hidden';

    const sceltaNazione = el('select', 'wp-pv-select');
    for (const [id, n] of (state.nationMap || new Map())) {
      const o = el('option', null, n?.name || id); o.value = id; sceltaNazione.appendChild(o);
    }
    // In ordine alfabetico: un elenco di centottanta nazioni nell'ordine
    // in cui le ha restituite l'API non e' un elenco, e' un mucchio.
    [...sceltaNazione.options]
      .sort((x, y) => x.textContent.localeCompare(y.textContent))
      .forEach((o) => sceltaNazione.appendChild(o));
    sceltaNazione.addEventListener('change', () => { idAmbito.value = sceltaNazione.value; });
    idAmbito.value = sceltaNazione.value || '';

    const cercaMu = el('input', 'wp-pv-input');
    cercaMu.type = 'text';
    cercaMu.placeholder = pvT('muSearchPh');
    cercaMu.autocomplete = 'off';
    const risultatiMu = el('select', 'wp-pv-select');
    risultatiMu.size = 1;
    risultatiMu.addEventListener('change', () => { idAmbito.value = risultatiMu.value; });

    let tickCerca = null;
    cercaMu.addEventListener('input', () => {
      clearTimeout(tickCerca);
      const testo = cercaMu.value.trim();
      if (testo.length < 3) return;
      // Mezzo secondo di attesa: una chiamata per tasto premuto sarebbe
      // otto richieste per scrivere "praetorians".
      tickCerca = setTimeout(async () => {
        const trovate = await cercaUnita(testo).catch(() => []);
        risultatiMu.textContent = '';
        if (!trovate.length) {
          const o = el('option', null, pvT('noMatch')); o.value = ''; risultatiMu.appendChild(o);
        }
        for (const m of trovate) { const o = el('option', null, m.nome); o.value = m.id; risultatiMu.appendChild(o); }
        idAmbito.value = risultatiMu.value || '';
      }, 500);
    });

    const bloccoNazione = el('div', 'wp-pv-campo');
    bloccoNazione.appendChild(el('span', 'wp-pv-label', pvT('pickCountry')));
    bloccoNazione.appendChild(sceltaNazione);

    const bloccoMu = el('div', 'wp-pv-campo');
    bloccoMu.appendChild(el('span', 'wp-pv-label', pvT('pickMu')));
    bloccoMu.appendChild(cercaMu);
    bloccoMu.appendChild(risultatiMu);

    const mostraBlocco = () => {
      const suMu = ambito.value === 'mu';
      bloccoNazione.hidden = suMu;
      bloccoMu.hidden = !suMu;
      idAmbito.value = suMu ? (risultatiMu.value || '') : (sceltaNazione.value || '');
    };
    ambito.addEventListener('change', mostraBlocco);
    mostraBlocco();

    const motivo = el('input', 'wp-pv-input');
    motivo.type = 'text';
    motivo.placeholder = pvT('reasonPh');
    motivo.autocomplete = 'off';
    motivo.maxLength = 300;

    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('save'));
    salva.type = 'submit';

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      salva.disabled = true;
      try {
        await metteDeroga({
          accountId: a.id, scopeType: ambito.value, scopeId: idAmbito.value.trim() || null,
          role: ruolo.value, mode: tipo.value, reason: motivo.value.trim(),
        });
        await carica();
        await ctx.ruoliCambiati?.();
      } catch (err) {
        errore = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
        ctx.ridisegna();
      }
    });

    const r1 = el('div', 'wp-pv-riga');
    r1.appendChild(ambito); r1.appendChild(ruolo); r1.appendChild(tipo);
    const r3 = el('div', 'wp-pv-riga');
    r3.appendChild(motivo); r3.appendChild(salva);
    form.appendChild(r1);
    form.appendChild(bloccoNazione); form.appendChild(bloccoMu);
    form.appendChild(idAmbito);
    form.appendChild(r3);
    return form;
  }

  return { render, ricarica: carica };
}

/** Deroghe di un account, con il bottone per toglierle. Usato nella vista
 *  dei ruoli quando la si guarda con la lente di amministratore. */
export function renderDeroghe(deroghe, { accountId, onCambio } = {}) {
  if (!deroghe?.length) return null;
  const box = el('div', 'wp-pv-deroghe');
  for (const d of deroghe) {
    const riga = el('div', 'wp-pv-deroga');
    const testo = `${d.mode === 'grant' ? '+' : '−'} ${pvT(d.role)} · ${d.scopeType}${d.scopeId ? ` ${d.scopeId}` : ''}`;
    riga.appendChild(el('span', 'wp-pv-deroga-testo', testo));
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
