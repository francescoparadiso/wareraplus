/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — la mia nazione
   ------------------------------------------------------------------
   Quello che un CITTADINO può vedere della sua nazione, senza bisogno
   di cariche: prima l'area riservata mostrava solo a chi aveva un
   potere quello che poteva fare, e a un cittadino semplice il suo
   profilo e basta. Il server (server/plusApi/nazione.js) decide quale
   nazione; qui si disegna e basta.

   Cinque schede, in quest'ordine, che è l'ordine delle domande:

     1. LA NAZIONE   tesoro, classifiche, relazioni, governo
     2. ALLARMI      cosa si è acceso ai nostri confini — sale in
                     CIMA a tutto quando c'è qualcosa di nuovo
     3. NEMICI       pillole, danno fatto, danno che potrebbero fare
     4. ATTIVITÀ     le nostre battaglie, le ultime 48 ore, i bonifici
     5. REGIONI      le nostre, e quelle straniere che le toccano, con
                     basi e bunker
     6. ACCESSI      solo al governo: chi altro vede questa pagina, e
                     la ricerca per aggiungere un cittadino

   ── CHI LA VEDE ────────────────────────────────────────────────────
   Il governo per carica, i cittadini che il governo sceglie, gli
   amministratori (vedi server/plusApi/nazione.js). Agli altri il server
   risponde 403 `accesso_nazione_negato` con dentro i nomi del governo,
   e la scheda diventa "chiedi a loro" invece di un errore.

   ── "NUOVO" SI RICORDA NEL BROWSER ─────────────────────────────────
   Quali allarmi uno ha già visto è una comodità di chi guarda, non uno
   stato condiviso: sta in localStorage, per nazione. Un browser nuovo
   rivede come nuovi gli ultimi 14 giorni, che è il verso giusto in cui
   sbagliare.
   ══════════════════════════════════════════════════════════════ */

import { nzT } from './i18nNazione.js';
import { pvT, pvErr } from './i18n.js';
import {
  leggiNazione, leggiNemici, impostaCanaleConfini, ApiError,
  leggiAccessi, cercaCittadini, aggiungiAccesso, togliAccesso,
} from './api.js';
import { nomeNazione, urlBandiera, coloreNazione } from './battles.js';
import { getLang } from '../shared/i18n.js';

const CHIAVE_VISTI = 'wp_pv_confini_visti';
const EVENTI_ACCENSIONE = new Set(['attivazione', 'attivo', 'costruzione', 'livello_su']);
const OSTILI = new Set(['guerra', 'nemico_giurato']);
const ORDINE_RELAZIONI = ['nemico_giurato', 'guerra', 'neutrale', 'nap', 'patto', 'alleato'];
const MAX_EVENTI = 20;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bottone(cls, testo, onClick) {
  const b = el('button', `wp-pv-btn ${cls}`, testo);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

// ── Numeri e tempi ──────────────────────────────────────────────────
const num = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString());
const compatto = (n) => (n == null ? '—'
  : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n)));
const ora = (ms) => (ms ? new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '—');
const quando = (ms) => (ms ? new Date(ms).toLocaleString(undefined,
  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const giornoBreve = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) : '—');

/** "fra 3 ore" / "20 min fa", nella lingua scelta: RelativeTimeFormat sa
 *  dove va la parola in ciascuna delle nove, cosa che un "fa" appeso in
 *  coda sbaglierebbe in metà di esse. */
function relativo(ms) {
  if (!ms) return '';
  let rtf;
  try { rtf = new Intl.RelativeTimeFormat(getLang(), { numeric: 'auto', style: 'short' }); }
  catch { rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' }); }
  const min = Math.round((ms - Date.now()) / 60000);
  if (Math.abs(min) < 90) return rtf.format(min, 'minute');
  return rtf.format(Math.round(min / 60), 'hour');
}

function bandiera(countryId, cls = 'wp-pv-nz-flag') {
  const url = urlBandiera(countryId);
  if (!url) return null;
  const i = el('img', cls);
  i.src = url; i.alt = ''; i.loading = 'lazy';
  i.addEventListener('error', () => { i.style.display = 'none'; });
  return i;
}

/** Bandiera + nome, la forma in cui una nazione compare ovunque qui. */
function gettonePaese(countryId, extra) {
  const g = el('span', 'wp-pv-nz-paese');
  const f = bandiera(countryId); if (f) g.appendChild(f);
  g.appendChild(el('span', null, nomeNazione(countryId) || '?'));
  if (extra) g.appendChild(el('span', 'wp-pv-nz-paese-extra', extra));
  return g;
}

/** Faccia e nome di un giocatore, con un'etichetta accanto. */
function personaEl(avatar, nome, extra) {
  const chi = el('span', 'wp-pv-nz-gov-chi');
  if (avatar) {
    const a = el('img', 'wp-pv-nz-avatar'); a.src = avatar; a.alt = ''; a.loading = 'lazy';
    a.addEventListener('error', () => { a.style.display = 'none'; });
    chi.appendChild(a);
  }
  chi.appendChild(el('strong', null, nome || '?'));
  if (extra) chi.appendChild(el('span', 'wp-pv-suggerimento', extra));
  return chi;
}

function badgeRelazione(rel) {
  return el('span', `wp-pv-nz-rel wp-pv-nz-rel-${rel}`, nzT(`rel_${rel}`));
}

// ── Allarmi già visti (per nazione, in questo browser) ─────────────
function leggiVisti() {
  try { return JSON.parse(localStorage.getItem(CHIAVE_VISTI) || '{}') || {}; } catch { return {}; }
}
function segnaVisti(countryId, idMax) {
  try {
    const v = leggiVisti(); v[countryId] = idMax;
    localStorage.setItem(CHIAVE_VISTI, JSON.stringify(v));
  } catch { /* modalita' privata: si rivedranno come nuovi, pazienza */ }
}

// ═════════════════════════════════════════════════════════════════════

/**
 * @param {object} ctx
 * @param {Function} ctx.ridisegna  richiama il render di tutta la vista
 * @param {Function} ctx.lente      () => id account guardato, o null
 */
export function creaQuadroNazione(ctx) {
  let dati = null;
  let nemici = null;
  let caricamento = false;
  let caricamentoNemici = false;
  let errore = null;
  let erroreNemici = null;
  let paeseScelto = null;         // solo l'amministratore lo cambia
  let occupato = false;
  let esitoCanale = null;
  const topAperti = new Set();
  // Il 403 di chi non ha accesso, con dentro i nomi del governo.
  let negato = null;
  // Chi altro vede la pagina: lo legge solo il governo.
  let accessi = null;
  let erroreAccessi = null;
  // La ricerca è un nodo che sopravvive ai ridisegni: ricrearla ad ogni
  // render le toglierebbe il fuoco a metà parola.
  let cercaWidget = null;

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    try {
      dati = await leggiNazione({ asAccount: ctx.lente(), paese: paeseScelto });
      negato = null;
    } catch (err) {
      if (err instanceof ApiError && err.codice === 'accesso_nazione_negato') {
        // Non è un guasto: è la regola. Si dice a chi chiedere.
        negato = err.dati || {};
        dati = null;
        return;
      }
      // Un server che la rotta non ce l'ha ancora (rideploy di
      // warera-plus-api non fatto) risponde 404 `rotta_sconosciuta`: detto
      // come "errore del server" sembrava un guasto, ed è solo un'attesa.
      errore = !(err instanceof ApiError) ? pvT('errErrore_server')
        : err.codice === 'nazione_sconosciuta' ? nzT('natNoCountry')
          : err.codice === 'rotta_sconosciuta' ? nzT('natServerOld')
            : pvErr(err.codice);
    } finally {
      caricamento = false; ctx.ridisegna();
    }
    // I nemici dopo, e senza aspettarli: sono la parte lenta (giocatori
    // letti dal vivo) e il resto del quadro non deve restare in bianco.
    if (dati) caricaNemici();
    if (dati && (dati.governa || dati.amministra)) caricaAccessi();
  }

  async function caricaAccessi() {
    try {
      accessi = (await leggiAccessi({ asAccount: ctx.lente(), paese: paeseScelto })).accessi || [];
      erroreAccessi = null;
    } catch (err) { erroreAccessi = messaggioErrore(err); }
    ctx.ridisegna();
  }

  /** Aggiunge o toglie, e rilegge l'elenco dalla risposta. Vero se è
   *  andata: la ricerca si svuota solo allora, così un errore non fa
   *  perdere quello che si stava cercando. */
  async function azioneAccessi(fn) {
    if (occupato) return false;
    occupato = true; erroreAccessi = null; ctx.ridisegna();
    try { accessi = (await fn()).accessi || []; return true; }
    catch (err) { erroreAccessi = messaggioErrore(err); return false; }
    finally { occupato = false; ctx.ridisegna(); }
  }

  function messaggioErrore(err) {
    if (!(err instanceof ApiError)) return pvT('errErrore_server');
    const k = `accErr_${err.codice}`;
    const t = nzT(k);
    return t !== k ? t : pvErr(err.codice);
  }

  async function caricaNemici() {
    caricamentoNemici = true; erroreNemici = null; ctx.ridisegna();
    try { nemici = await leggiNemici({ asAccount: ctx.lente(), paese: paeseScelto }); }
    catch { erroreNemici = nzT('enemiesError'); nemici = null; }
    finally { caricamentoNemici = false; ctx.ridisegna(); }
  }

  /** Quanti allarmi di accensione non ancora visti: main.js lo mostra
   *  anche a quadro chiuso. */
  function nuovi() {
    const ev = dati?.confini?.eventi || [];
    const visto = leggiVisti()[dati?.paese?.id] || 0;
    return ev.filter((e) => e.id > visto && EVENTI_ACCENSIONE.has(e.evento));
  }

  function render() {
    try { return disegna(); }
    catch (err) {
      console.error('[mia nazione] disegno fallito:', err);
      const f = document.createDocumentFragment();
      f.appendChild(el('p', 'wp-pv-error', pvT('errErrore_server')));
      f.appendChild(el('p', 'wp-pv-note', String(err?.message || err)));
      return f;
    }
  }

  function disegna() {
    const frag = document.createDocumentFragment();
    if (!dati && !caricamento && !errore && !negato) carica();

    if (negato) { frag.appendChild(cardNegato()); return frag; }

    if (!dati) {
      const card = el('div', 'wp-pv-card');
      card.appendChild(el('h2', 'wp-pv-h2', nzT('natTitle')));
      if (errore) {
        card.appendChild(el('p', 'wp-pv-note', errore));
        card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('retry'), () => carica()));
      } else card.appendChild(el('p', 'wp-pv-note', nzT('natLoading')));
      frag.appendChild(card);
      return frag;
    }

    // Un allarme nuovo passa davanti a tutto: è l'unica cosa di questa
    // pagina che può non aspettare.
    const daVedere = nuovi();
    if (daVedere.length) frag.appendChild(cardAllarmi(true));
    frag.appendChild(cardNazione());
    if (!daVedere.length) frag.appendChild(cardAllarmi(false));
    frag.appendChild(cardNemici());
    frag.appendChild(cardAttivita());
    frag.appendChild(cardRegioni());
    if (dati.governa || dati.amministra) frag.appendChild(cardAccessi());
    return frag;
  }

  // ── 0. Senza accesso ──────────────────────────────────────────────
  function cardNegato() {
    const card = el('div', 'wp-pv-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('natTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('natDenied')));
    const persone = (negato.governo?.cariche || []).filter((c) => c.persona);
    if (persone.length) {
      card.appendChild(el('p', 'wp-pv-note', nzT('natDeniedAsk')));
      const lista = el('div', 'wp-pv-nz-chips');
      for (const { carica, persona } of persone) {
        lista.appendChild(personaEl(persona.avatar, persona.nome, nzT(`gov_${carica}`)));
      }
      card.appendChild(lista);
    }
    card.appendChild(el('p', 'wp-pv-note', nzT('natDeniedHow')));
    return card;
  }

  // ── 6. Chi vede questa pagina ─────────────────────────────────────
  function cardAccessi() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('accTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('accBody')));

    // Il governo non si aggiunge né si toglie: c'è per carica, e lo si
    // mostra accanto perché l'elenco risponda per intero a "chi la vede".
    const carica = el('div', 'wp-pv-nz-sezione');
    carica.appendChild(el('h3', 'wp-pv-h3', nzT('accByOffice')));
    const chips = el('div', 'wp-pv-nz-chips');
    for (const { carica: c, persona } of dati.governo?.cariche || []) {
      if (persona) chips.appendChild(personaEl(persona.avatar, persona.nome, nzT(`gov_${c}`)));
    }
    carica.appendChild(chips);
    card.appendChild(carica);

    const sez = el('div', 'wp-pv-nz-sezione');
    sez.appendChild(el('h3', 'wp-pv-h3', nzT('accDelegates')));
    if (erroreAccessi) sez.appendChild(el('p', 'wp-pv-error', erroreAccessi));
    if (accessi == null) sez.appendChild(el('p', 'wp-pv-note', '…'));
    else if (!accessi.length) sez.appendChild(el('p', 'wp-pv-note', nzT('accNone')));
    else {
      const lista = el('div', 'wp-pv-nz-acc-lista');
      for (const a of accessi) {
        const r = el('div', 'wp-pv-nz-acc-riga');
        r.appendChild(personaEl(a.avatar, a.nome || a.warUserId));
        // "Non ancora entrato" risponde in anticipo a "gliel'ho dato e non
        // vede niente": l'accesso c'è, manca il suo login.
        r.appendChild(el('span', `wp-pv-nz-tag${a.entrato ? '' : ' wp-pv-nz-tag-avviso'}`,
          a.entrato ? nzT('accSignedIn') : nzT('accNotSignedIn')));
        r.appendChild(el('span', 'wp-pv-suggerimento',
          [a.aggiuntoDa ? `${nzT('accAddedBy')} ${a.aggiuntoDa}` : null, a.aggiuntoIl ? quando(a.aggiuntoIl) : null]
            .filter(Boolean).join(' · ')));
        if (!ctx.lente()) {
          const via = bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('remove'),
            () => azioneAccessi(() => togliAccesso(a.warUserId, { paese: paeseScelto })));
          via.disabled = occupato;
          r.appendChild(via);
        }
        lista.appendChild(r);
      }
      sez.appendChild(lista);
    }
    card.appendChild(sez);

    if (!ctx.lente()) card.appendChild(widgetRicerca());
    return card;
  }

  /** La ricerca dei cittadini da aggiungere. Aggiorna i suoi risultati sul
   *  posto, senza ridisegnare la vista: è il modo per non perdere il fuoco
   *  del campo a ogni tasto (vedi il filtro di board.js). */
  function widgetRicerca() {
    if (cercaWidget) return cercaWidget;
    const wrap = el('div', 'wp-pv-nz-acc-cerca');
    const input = el('input', 'wp-pv-input');
    input.type = 'search'; input.placeholder = nzT('accSearchPh'); input.autocomplete = 'off';
    input.maxLength = 40;
    const nota = el('p', 'wp-pv-note');
    const lista = el('div', 'wp-pv-nz-acc-lista');

    let tick = null;
    let ultimo = '';
    const esegui = async () => {
      const q = input.value.trim();
      ultimo = q;
      if (q.length < 2) { lista.textContent = ''; nota.textContent = ''; return; }
      let r;
      try { r = await cercaCittadini(q, { paese: paeseScelto }); }
      catch (err) {
        if (q !== ultimo) return;
        lista.textContent = ''; nota.textContent = messaggioErrore(err);
        return;
      }
      // Una risposta lenta non deve scrivere sopra quella di una ricerca
      // più recente.
      if (q !== ultimo) return;
      disegnaTrovati(r);
    };
    input.addEventListener('input', () => { clearTimeout(tick); tick = setTimeout(esegui, 350); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });

    function disegnaTrovati(r) {
      lista.textContent = '';
      nota.textContent = (r.noti != null && r.censiti != null && r.noti < r.censiti) ? nzT('accPartial') : '';
      if (!r.trovati?.length) { lista.appendChild(el('p', 'wp-pv-note', nzT('accNoResults'))); return; }
      for (const c of r.trovati) {
        const riga = el('div', 'wp-pv-nz-acc-riga');
        riga.appendChild(personaEl(c.avatar, c.nome, c.livello != null ? `${nzT('lv')}${c.livello}` : null));
        if (c.perCarica) riga.appendChild(el('span', 'wp-pv-nz-tag', nzT('accByOfficeTag')));
        else if (c.delegato) riga.appendChild(el('span', 'wp-pv-nz-tag', nzT('accAlready')));
        else {
          const b = bottone('wp-pv-btn-primary wp-pv-btn-small', nzT('accGive'), async () => {
            b.disabled = true;
            const ok = await azioneAccessi(() => aggiungiAccesso(c.id, { paese: paeseScelto }));
            if (ok) { input.value = ''; lista.textContent = ''; nota.textContent = ''; } else b.disabled = false;
          });
          riga.appendChild(b);
        }
        lista.appendChild(riga);
      }
    }

    wrap.appendChild(input);
    wrap.appendChild(nota);
    wrap.appendChild(lista);
    cercaWidget = wrap;
    return wrap;
  }

  // ── 1. La nazione ─────────────────────────────────────────────────
  function cardNazione() {
    const p = dati.paese;
    const card = el('div', 'wp-pv-card wp-pv-nz-card');

    const testa = el('div', 'wp-pv-nz-testa');
    const f = bandiera(p.id, 'wp-pv-nz-flag-grande'); if (f) testa.appendChild(f);
    const nomi = el('div', 'wp-pv-nz-testa-nomi');
    nomi.appendChild(el('span', 'wp-pv-h2', nzT('natTitle')));
    nomi.appendChild(el('strong', 'wp-pv-nz-nome', p.nome || nomeNazione(p.id) || '?'));
    testa.appendChild(nomi);

    const meta = el('div', 'wp-pv-nz-meta');
    // Da dove viene il dato e quanti anni ha: "in diretta" e "dalla cache"
    // non sono la stessa promessa, e un tesoro di dieci minuti fa è già
    // un'altra cifra.
    meta.appendChild(el('span', 'wp-pv-note',
      `${nzT('natAsOf')} ${ora(p.letto || dati.generatoIl)} · ${p.fonte === 'live' ? nzT('natLive') : nzT('natCache')}`));
    if (dati.amministra && dati.ammesse?.length) meta.appendChild(sceltaPaese());
    const agg = bottone('wp-pv-btn-quiet wp-pv-btn-small', nzT('natRefresh'), () => carica());
    agg.disabled = caricamento;
    meta.appendChild(agg);
    testa.appendChild(meta);
    card.appendChild(testa);
    // Un accesso che qualcuno ha dato si può togliere: chi lo usa deve
    // saperlo, e sapere da chi viene.
    if (dati.via === 'delega') card.appendChild(el('p', 'wp-pv-note', nzT('accYouDelegate')));

    card.appendChild(tessereNumeri(p));
    card.appendChild(bloccoRelazioni(p));
    if (dati.governo) card.appendChild(bloccoGoverno(dati.governo));
    return card;
  }

  function sceltaPaese() {
    const s = el('select', 'wp-pv-select wp-pv-select-piccola');
    s.setAttribute('aria-label', nzT('natPick'));
    for (const id of dati.ammesse) {
      const o = el('option', null, nomeNazione(id) || id);
      o.value = id;
      if (id === dati.paese.id) o.selected = true;
      s.appendChild(o);
    }
    s.addEventListener('change', () => {
      paeseScelto = s.value; nemici = null; topAperti.clear();
      accessi = null; cercaWidget = null;
      carica();
    });
    return s;
  }

  function tessereNumeri(p) {
    const box = el('div', 'wp-pv-totali wp-pv-nz-tessere');
    const voce = (etichetta, valore, sotto, titolo) => {
      const v = el('div', 'wp-pv-totale-voce');
      v.appendChild(el('span', 'wp-pv-label', etichetta));
      const s = el('strong', 'wp-pv-totale-val', valore);
      if (titolo) s.title = titolo;
      v.appendChild(s);
      if (sotto) v.appendChild(el('span', 'wp-pv-suggerimento', sotto));
      box.appendChild(v);
    };
    const pos = (r) => (r?.rank ? `#${r.rank}` : null);

    voce(nzT('kTreasury'), num(p.tesoro));
    voce(nzT('kActivePop'), num(p.popolazioneAttiva?.valore),
      [pos(p.popolazioneAttiva), p.popolazione != null ? `${num(p.popolazione)} ${nzT('kPopulation')}` : null].filter(Boolean).join(' · '));
    voce(nzT('kDevelopment'), p.sviluppo?.valore != null ? Number(p.sviluppo.valore).toFixed(1) : '—', pos(p.sviluppo));
    voce(nzT('kDamageToday'), compatto(dati.oggi?.danno), nzT('kDamageTodayHint'), num(dati.oggi?.danno));
    voce(nzT('kDamageWeek'), compatto(p.dannoSettimana?.valore), pos(p.dannoSettimana), num(p.dannoSettimana?.valore));
    voce(nzT('kPerCitizen'), compatto(p.dannoPerCittadino?.valore), pos(p.dannoPerCittadino));
    voce(nzT('kBounty'), compatto(p.taglieIncassate?.valore),
      [pos(p.taglieIncassate), nzT('kBountyHint')].filter(Boolean).join(' · '));
    if (p.tasse) voce(nzT('kTaxes'), `${p.tasse.income ?? '—'}% · ${p.tasse.market ?? '—'}% · ${p.tasse.selfWork ?? '—'}%`, nzT('kTaxesHint'));
    if (p.disordini?.max) voce(nzT('kUnrest'), `${Math.round((p.disordini.barra / p.disordini.max) * 100)}%`);
    if (p.bonusProduzione?.valore != null) voce(nzT('kProduction'), `${p.bonusProduzione.valore}%`, pos(p.bonusProduzione));
    return box;
  }

  function bloccoRelazioni(p) {
    const box = el('div', 'wp-pv-nz-relazioni');
    const riga = (etichetta, ids, extra) => {
      const r = el('div', 'wp-pv-nz-rel-riga');
      r.appendChild(el('span', 'wp-pv-label', etichetta));
      const lista = el('div', 'wp-pv-nz-chips');
      if (!ids.length) lista.appendChild(el('span', 'wp-pv-note', nzT('relNone')));
      for (const id of ids) lista.appendChild(gettonePaese(id, extra?.(id)));
      r.appendChild(lista);
      box.appendChild(r);
    };
    riga(nzT('relWars'), p.guerre || []);
    riga(nzT('relSworn'), p.nemicoGiurato ? [p.nemicoGiurato] : []);
    riga(nzT('relAllies'), p.alleati || []);
    if (p.patti?.length) riga(nzT('relPacts'), p.patti);
    if (p.nap?.length) {
      const fino = new Map(p.nap.map((n) => [n.id, n.fino]));
      riga(nzT('relNaps'), p.nap.map((n) => n.id), (id) => `${nzT('until')} ${quando(fino.get(id))}`);
    }
    return box;
  }

  function bloccoGoverno(g) {
    const box = el('div', 'wp-pv-nz-governo');
    box.appendChild(el('h3', 'wp-pv-h3', nzT('govTitle')));
    const lista = el('div', 'wp-pv-nz-gov-lista');
    for (const { carica, persona } of g.cariche) {
      const r = el('div', 'wp-pv-nz-gov-riga');
      r.appendChild(el('span', 'wp-pv-label', nzT(`gov_${carica}`)));
      const chi = el('span', 'wp-pv-nz-gov-chi');
      if (persona?.avatar) {
        const a = el('img', 'wp-pv-nz-avatar'); a.src = persona.avatar; a.alt = ''; a.loading = 'lazy';
        a.addEventListener('error', () => { a.style.display = 'none'; });
        chi.appendChild(a);
      }
      chi.appendChild(el('strong', null, persona ? (persona.nome || '?') : nzT('vacant')));
      r.appendChild(chi);
      lista.appendChild(r);
    }
    const c = el('div', 'wp-pv-nz-gov-riga');
    c.appendChild(el('span', 'wp-pv-label', nzT('govCongress')));
    c.appendChild(el('strong', null, `${g.congresso} ${nzT('seats')}`));
    lista.appendChild(c);
    box.appendChild(lista);
    return box;
  }

  // ── 2. Allarmi dai confini ────────────────────────────────────────
  function cardAllarmi(inEvidenza) {
    const conf = dati.confini;
    const card = el('div', `wp-pv-card wp-pv-nz-allarmi${inEvidenza ? ' wp-pv-nz-allarmi-caldi' : ''}`);
    const testa = el('div', 'wp-pv-nz-card-testa');
    testa.appendChild(el('h2', 'wp-pv-h2', nzT('alertsTitle')));
    const daVedere = nuovi();
    if (daVedere.length) testa.appendChild(el('span', 'wp-pv-nz-nuovi', `${daVedere.length} · ${nzT('alertsNew')}`));
    card.appendChild(testa);
    card.appendChild(el('p', 'wp-pv-body', nzT('alertsBody')));

    if (!conf) { card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server'))); return card; }

    if (!conf.sorvegliata) card.appendChild(el('p', 'wp-pv-note', nzT('alertsNotWatched')));
    else {
      const meta = [];
      if (conf.ultimoGiro) meta.push(`${nzT('alertsLast')} ${ora(conf.ultimoGiro)}`);
      if (conf.sorvegliateDal) meta.push(`${nzT('alertsSince')} ${quando(conf.sorvegliateDal)}`);
      if (meta.length) card.appendChild(el('p', 'wp-pv-note', meta.join(' · ')));
    }

    const eventi = conf.eventi || [];
    const visto = leggiVisti()[dati.paese.id] || 0;
    if (conf.sorvegliata && !eventi.length) card.appendChild(el('p', 'wp-pv-note', nzT('alertsNone')));
    if (eventi.length) {
      const lista = el('div', 'wp-pv-nz-eventi');
      for (const e of eventi.slice(0, MAX_EVENTI)) lista.appendChild(rigaEvento(e, e.id > visto));
      card.appendChild(lista);
    }

    if (daVedere.length) {
      card.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', nzT('alertsSeen'), () => {
        segnaVisti(dati.paese.id, Math.max(...eventi.map((e) => e.id)));
        ctx.ridisegna();
      }));
    }

    if (dati.canaleConfini && !ctx.lente()) card.appendChild(bloccoCanale());
    return card;
  }

  function rigaEvento(e, nuovo) {
    // Il peso: una base che si accende in casa di chi ci ha dichiarato
    // guerra non è la stessa notizia di un bunker spento da un alleato.
    const accende = EVENTI_ACCENSIONE.has(e.evento);
    const peso = accende && OSTILI.has(e.relazione) ? 'alta' : accende ? 'media' : 'bassa';
    const r = el('div', `wp-pv-nz-evento wp-pv-nz-peso-${peso}`);

    const testa = el('div', 'wp-pv-nz-evento-testa');
    if (nuovo && accende) testa.appendChild(el('span', 'wp-pv-nz-nuovo', nzT('alertsNew')));
    testa.appendChild(el('span', 'wp-pv-nz-evento-quando', quando(e.at)));
    testa.appendChild(el('strong', 'wp-pv-nz-evento-regione', e.regionNome || e.regionId));
    testa.appendChild(gettonePaese(e.ownerId));
    if (e.relazione) testa.appendChild(badgeRelazione(e.relazione));
    r.appendChild(testa);

    const lv = e.livelloA ? ` ${nzT('lv')}${e.livelloA}` : '';
    let testo = `${nzT(`tipo_${e.tipo}`)}${lv} ${nzT(`ev_${e.evento}`)}`;
    if (e.effettoIl) testo += ` — ${nzT('activeFrom')} ${ora(e.effettoIl)} (${relativo(e.effettoIl)})`;
    r.appendChild(el('div', 'wp-pv-nz-evento-cosa', testo));

    const sotto = [];
    if (e.confinaCon?.length) sotto.push(`${nzT('bordersWith')} ${e.confinaCon.join(', ')}`);
    sotto.push(nzT(e.tipo === 'base' ? 'baseEffect' : 'bunkerEffect'));
    r.appendChild(el('div', 'wp-pv-suggerimento', sotto.join(' · ')));
    return r;
  }

  function bloccoCanale() {
    const box = el('div', 'wp-pv-canale wp-pv-nz-canale');
    const testa = el('div', 'wp-pv-canale-testa');
    testa.appendChild(el('strong', null, nzT('channelTitle')));
    testa.appendChild(el('span', `wp-pv-badge${dati.canaleConfini.configurato ? ' wp-pv-badge-ok' : ''}`,
      dati.canaleConfini.configurato ? pvT('channelSet') : pvT('channelNone')));
    box.appendChild(testa);
    box.appendChild(el('p', 'wp-pv-suggerimento', nzT('channelBody')));

    const form = el('form', 'wp-pv-riga');
    const url = el('input', 'wp-pv-input');
    url.type = 'url'; url.placeholder = pvT('channelPh'); url.autocomplete = 'off';
    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('channelSave'));
    salva.type = 'submit'; salva.disabled = occupato;
    const invia = async (valore) => {
      if (occupato) return;
      occupato = true; esitoCanale = null; ctx.ridisegna();
      try {
        const r = await impostaCanaleConfini(valore, { paese: paeseScelto });
        dati.canaleConfini = { ...dati.canaleConfini, configurato: Boolean(r.configurato) };
      } catch (err) {
        esitoCanale = err instanceof ApiError ? pvErr(err.codice) : pvT('errErrore_server');
      } finally { occupato = false; ctx.ridisegna(); }
    };
    form.addEventListener('submit', (ev) => { ev.preventDefault(); invia(url.value.trim()); });
    form.appendChild(url); form.appendChild(salva);
    if (dati.canaleConfini.configurato) {
      const via = bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('channelClear'), () => invia(''));
      via.disabled = occupato;
      form.appendChild(via);
    }
    box.appendChild(form);
    if (esitoCanale) box.appendChild(el('p', 'wp-pv-error', esitoCanale));
    return box;
  }

  // ── 3. Nemici ─────────────────────────────────────────────────────
  function cardNemici() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('enemiesTitle')));
    card.appendChild(el('p', 'wp-pv-body', nzT('enemiesBody')));

    if (erroreNemici) { card.appendChild(el('p', 'wp-pv-note', erroreNemici)); return card; }
    if (!nemici) { card.appendChild(el('p', 'wp-pv-note', caricamentoNemici ? nzT('enemiesLoading') : '…')); return card; }
    if (!nemici.nemici?.length) { card.appendChild(el('p', 'wp-pv-note', nzT('enemiesNone'))); return card; }

    const lista = el('div', 'wp-pv-nz-nemici');
    for (const n of nemici.nemici) lista.appendChild(schedaNemico(n));
    card.appendChild(lista);
    card.appendChild(el('p', 'wp-pv-note', nzT('potNote')));
    return card;
  }

  function schedaNemico(n) {
    const box = el('div', 'wp-pv-nz-nemico');
    const colore = coloreNazione(n.id);
    if (colore) box.style.borderLeftColor = colore;

    const testa = el('div', 'wp-pv-nz-nemico-testa');
    testa.appendChild(gettonePaese(n.id));
    if (n.giurato) testa.appendChild(badgeRelazione('nemico_giurato'));
    if (n.inGuerra) testa.appendChild(badgeRelazione('guerra'));
    if (n.danno?.settimanaRank) testa.appendChild(el('span', 'wp-pv-note', `#${n.danno.settimanaRank} ${nzT('dmgWeek')}`));
    box.appendChild(testa);

    if (n.errore && !n.pillole) { box.appendChild(el('p', 'wp-pv-note', nzT('enemiesError'))); return box; }

    // ── Pillole ──────────────────────────────────────────────────────
    const pl = n.pillole || {};
    const tot = (pl.buff || 0) + (pl.malus || 0) + (pl.pulito || 0);
    if (tot) {
      const barra = el('div', 'wp-pv-nz-pillbar');
      for (const [k, v] of [['buff', pl.buff], ['malus', pl.malus], ['pulito', pl.pulito]]) {
        if (!v) continue;
        const s = el('span', `wp-pv-nz-pill-${k}`);
        s.style.width = `${(v / tot) * 100}%`;
        barra.appendChild(s);
      }
      box.appendChild(barra);
    }
    const pill = el('div', 'wp-pv-nz-pill-righe');
    const vocePill = (cls, n2, etichetta, dettaglio) => {
      const v = el('span', `wp-pv-nz-pill-voce wp-pv-nz-pv-${cls}`);
      v.appendChild(el('strong', null, String(n2 ?? 0)));
      v.appendChild(el('span', null, ` ${etichetta}`));
      if (dettaglio) v.appendChild(el('span', 'wp-pv-suggerimento', ` · ${dettaglio}`));
      pill.appendChild(v);
    };
    const primo = (l) => (l?.length ? `${ora(l[0])} (${relativo(l[0])})` : null);
    vocePill('buff', pl.buff, nzT('pillOn'), primo(pl.fineBuff) && `${nzT('pillFirstEnd')} ${primo(pl.fineBuff)}`);
    vocePill('malus', pl.malus, nzT('pillHangover'), primo(pl.fineMalus) && `${nzT('pillFirstClean')} ${primo(pl.fineMalus)}`);
    vocePill('pulito', pl.pulito, nzT('pillClean'));
    const pn = n.osservato?.pillatiNazione;
    if (pn) {
      vocePill('nazione', pn.n, nzT('pillNation'), pn.assestato ? null : nzT('pillSettling'));
    }
    box.appendChild(pill);

    // ── Danno fatto, danno possibile ─────────────────────────────────
    const griglia = el('div', 'wp-pv-nz-numeri');
    const cella = (etichetta, valore, sotto, titolo) => {
      const c = el('div', 'wp-pv-nz-cella');
      c.appendChild(el('span', 'wp-pv-label', etichetta));
      const s = el('strong', null, valore);
      if (titolo) s.title = titolo;
      c.appendChild(s);
      if (sotto) c.appendChild(el('span', 'wp-pv-suggerimento', sotto));
      griglia.appendChild(c);
    };
    const oss = n.osservato || {};
    cella(nzT('dmgWeek'), compatto(n.danno?.settimana), null, num(n.danno?.settimana));
    cella(nzT('dmg24h'), compatto(oss.ultime24h),
      oss.ultime24h != null && oss.oreMisurate24h < 24 ? `${oss.oreMisurate24h} ${nzT('hours')} / 24` : null, num(oss.ultime24h));
    if (oss.piccoOra) {
      cella(nzT('dmgPeak'), compatto(oss.piccoOra.allOra), `${quando(oss.piccoOra.t)} · ${nzT('dmgPeakHint')}`, num(oss.piccoOra.allOra));
    }
    if (oss.giornoMax) cella(nzT('dmgBestDay'), compatto(oss.giornoMax.d), giornoBreve(oss.giornoMax.giorno), num(oss.giornoMax.d));
    const pot = n.potenziale || {};
    cella(nzT('potNow'), compatto(pot.adesso), nzT('potNowHint'), num(pot.adesso));
    cella(nzT('potMax'), compatto(pot.massimo), nzT('potMaxHint'), num(pot.massimo));
    box.appendChild(griglia);

    const piede = el('div', 'wp-pv-nz-nemico-piede');
    piede.appendChild(el('span', 'wp-pv-note',
      `${n.analizzati ?? 0} ${nzT('analysed')} · ${n.attivi72h ?? '—'} ${nzT('active72')}`));
    if (n.top?.length) {
      const aperto = topAperti.has(n.id);
      piede.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', aperto ? nzT('hideTop') : nzT('showTop'), () => {
        if (aperto) topAperti.delete(n.id); else topAperti.add(n.id);
        ctx.ridisegna();
      }));
    }
    box.appendChild(piede);
    if (topAperti.has(n.id)) box.appendChild(elencoTop(n.top));
    return box;
  }

  function elencoTop(top) {
    const lista = el('div', 'wp-pv-nz-top');
    for (const g of top) {
      const r = el('div', 'wp-pv-nz-top-riga');
      const chi = el('span', 'wp-pv-nz-top-chi');
      if (g.avatar) {
        const a = el('img', 'wp-pv-nz-avatar'); a.src = g.avatar; a.alt = ''; a.loading = 'lazy';
        a.addEventListener('error', () => { a.style.display = 'none'; });
        chi.appendChild(a);
      }
      chi.appendChild(el('strong', null, g.nome || '?'));
      if (g.livello != null) chi.appendChild(el('span', 'wp-pv-suggerimento', ` ${nzT('lv')}${g.livello}`));
      r.appendChild(chi);

      const stato = el('span', `wp-pv-nz-pill-tag wp-pv-nz-pill-tag-${g.pillola}`,
        g.pillola === 'buff' ? nzT('pillOn') : g.pillola === 'malus' ? nzT('pillHangover') : nzT('pillClean'));
      if (g.fine) stato.title = `${ora(g.fine)} (${relativo(g.fine)})`;
      r.appendChild(stato);
      if (g.fine) r.appendChild(el('span', 'wp-pv-suggerimento', `→ ${ora(g.fine)}`));
      else r.appendChild(el('span'));

      r.appendChild(el('span', 'wp-pv-nz-top-num', `${num(g.perColpo)} ${nzT('perHit')}`));
      r.appendChild(el('span', 'wp-pv-nz-top-num', `${g.colpi} ${nzT('hitsLeft')}`));
      lista.appendChild(r);
    }
    return lista;
  }

  // ── 4. Attività: battaglie, ore, bonifici ─────────────────────────
  function cardAttivita() {
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('ourBattles')));

    const bt = dati.battaglie;
    if (bt == null) card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server')));
    else if (!bt.length) card.appendChild(el('p', 'wp-pv-note', nzT('noOurBattles')));
    else {
      const lista = el('div', 'wp-pv-nz-battaglie');
      for (const b of bt) lista.appendChild(rigaBattaglia(b));
      card.appendChild(lista);
    }

    const ore = el('div', 'wp-pv-nz-sezione');
    ore.appendChild(el('h3', 'wp-pv-h3', nzT('hourlyTitle')));
    ore.appendChild(graficoOrario(dati.orario));
    ore.appendChild(el('p', 'wp-pv-suggerimento', nzT('hourlyHint')));
    card.appendChild(ore);

    if (dati.bonifici) card.appendChild(bloccoBonifici(dati.bonifici));
    return card;
  }

  function rigaBattaglia(b) {
    const box = el('div', 'wp-pv-nz-battaglia');
    const testa = el('div', 'wp-pv-nz-battaglia-testa');
    testa.appendChild(el('strong', null, b.regione || '?'));
    testa.appendChild(el('span', `wp-pv-nz-lato wp-pv-nz-lato-${b.lato}`, b.lato === 'attacker' ? nzT('weAttack') : nzT('weDefend')));
    testa.appendChild(gettonePaese(b.avversario));
    testa.appendChild(el('span', 'wp-pv-nz-round',
      `${b.round.noi}–${b.round.loro}${b.round.perVincere ? ` / ${b.round.perVincere}` : ''} ${nzT('rounds')}`));
    box.appendChild(testa);

    const massimo = Math.max(1, b.danno.noi, b.danno.loro);
    for (const [countryId, danno, noi] of [[dati.paese.id, b.danno.noi, true], [b.avversario, b.danno.loro, false]]) {
      const riga = el('div', 'wp-pv-btl-parte');
      const capo = el('div', 'wp-pv-btl-capo');
      const f = bandiera(countryId, 'wp-pv-btl-bandiera'); if (f) capo.appendChild(f);
      capo.appendChild(el('strong', 'wp-pv-btl-nazione', nomeNazione(countryId) || '?'));
      riga.appendChild(capo);
      const barra = el('div', 'wp-pv-btl-barra');
      const dentro = el('div', 'wp-pv-btl-barra-piena');
      dentro.style.width = `${Math.round((danno / massimo) * 100)}%`;
      const col = noi ? null : coloreNazione(countryId);
      if (col) dentro.style.background = col;
      barra.appendChild(dentro);
      riga.appendChild(barra);
      riga.appendChild(el('span', 'wp-pv-btl-danno', num(danno)));
      box.appendChild(riga);
    }
    return box;
  }

  /**
   * Le ultime 48 ore in un SVG scritto a mano, come i grafici di
   * Statistiche nazioni (niente Chart.js per venti barre). Barre = danno
   * dello slot, linea = pillati, su due scale diverse e dichiarate ai due
   * lati. Un secchio senza misura resta un BUCO, mai una barra a zero.
   */
  function graficoOrario(orario) {
    const serie = orario?.serie || [];
    if (!serie.some((p) => p.d != null || p.p != null)) return el('p', 'wp-pv-note', nzT('hourlyEmpty'));

    const NS = 'http://www.w3.org/2000/svg';
    const W = 640; const H = 130; const SU = 14; const GIU = 18;
    const t0 = serie[0].t; const t1 = serie[serie.length - 1].to;
    const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const maxD = Math.max(1, ...serie.map((p) => p.d ?? 0));
    const maxP = Math.max(1, ...serie.map((p) => p.p ?? 0));
    const y = (v, max) => H - GIU - (v / max) * (H - SU - GIU);

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'wp-pv-nz-grafico');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', nzT('hourlyTitle'));
    const nodo = (tag, attrs, testo) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (testo != null) n.textContent = testo;
      svg.appendChild(n);
      return n;
    };

    nodo('line', { x1: 0, x2: W, y1: H - GIU, y2: H - GIU, class: 'wp-pv-nz-asse' });

    for (const p of serie) {
      if (p.d == null) continue;
      const r = nodo('rect', {
        x: x(p.t) + 0.5, y: y(p.d, maxD),
        width: Math.max(1, x(p.to) - x(p.t) - 1), height: Math.max(0, H - GIU - y(p.d, maxD)),
        class: 'wp-pv-nz-barra',
      });
      const t = document.createElementNS(NS, 'title');
      t.textContent = `${ora(p.t)}–${ora(p.to)} · ${num(p.d)}${p.p != null ? ` · ${p.p} ${nzT('pillOn')}` : ''}`;
      r.appendChild(t);
    }

    // La linea si spezza dove manca la misura: congiungere due punti
    // lontani inventerebbe un andamento che nessuno ha visto.
    let tratto = [];
    const chiudi = () => {
      if (tratto.length > 1) nodo('polyline', { points: tratto.join(' '), class: 'wp-pv-nz-linea' });
      tratto = [];
    };
    for (const p of serie) {
      if (p.p == null) { chiudi(); continue; }
      tratto.push(`${((x(p.t) + x(p.to)) / 2).toFixed(1)},${y(p.p, maxP).toFixed(1)}`);
    }
    chiudi();

    // Una tacca ogni sei ore, sull'ora locale di chi guarda.
    const SEI = 6 * 3600_000;
    for (let t = Math.ceil(t0 / SEI) * SEI; t < t1; t += SEI) {
      nodo('line', { x1: x(t), x2: x(t), y1: SU, y2: H - GIU, class: 'wp-pv-nz-tacca' });
      nodo('text', { x: x(t) + 2, y: H - 5, class: 'wp-pv-nz-testo' }, ora(t));
    }
    nodo('text', { x: 2, y: 10, class: 'wp-pv-nz-testo' }, compatto(maxD));
    nodo('text', { x: W - 2, y: 10, class: 'wp-pv-nz-testo wp-pv-nz-testo-pill', 'text-anchor': 'end' }, `${maxP} ${nzT('pillOn')}`);

    const wrap = el('div', 'wp-pv-nz-grafico-wrap');
    wrap.appendChild(svg);
    return wrap;
  }

  function bloccoBonifici(b) {
    const box = el('div', 'wp-pv-nz-sezione');
    box.appendChild(el('h3', 'wp-pv-h3', `${nzT('transfersTitle')} · ${b.finestraOre} ${nzT('hours')}`));
    if (!b.entrati.length && !b.usciti.length) {
      box.appendChild(el('p', 'wp-pv-note', nzT('transfersNone')));
      return box;
    }
    const due = el('div', 'wp-pv-nz-bonifici');
    for (const [titolo, righe, totale] of [
      [nzT('transfersIn'), b.entrati, b.totaleEntrati],
      [nzT('transfersOut'), b.usciti, b.totaleUsciti],
    ]) {
      const col = el('div', 'wp-pv-nz-bonifici-col');
      const t = el('div', 'wp-pv-nz-bonifici-testa');
      t.appendChild(el('span', 'wp-pv-label', titolo));
      t.appendChild(el('strong', null, num(totale)));
      col.appendChild(t);
      for (const r of righe.slice(0, 8)) {
        const riga = el('div', 'wp-pv-nz-bonifico');
        riga.appendChild(gettonePaese(r.paese));
        riga.appendChild(el('strong', null, num(r.soldi)));
        riga.appendChild(el('span', 'wp-pv-suggerimento', quando(r.at)));
        col.appendChild(riga);
      }
      due.appendChild(col);
    }
    box.appendChild(due);
    return box;
  }

  // ── 5. Regioni e confini ──────────────────────────────────────────
  function cardRegioni() {
    const conf = dati.confini;
    const card = el('div', 'wp-pv-card wp-pv-nz-card');
    card.appendChild(el('h2', 'wp-pv-h2', nzT('regionsTitle')));
    if (!conf) { card.appendChild(el('p', 'wp-pv-note', pvT('errErrore_server'))); return card; }

    const proprie = el('div', 'wp-pv-nz-regioni');
    for (const r of conf.proprie) proprie.appendChild(rigaRegione(r, conf.pendingOre));
    card.appendChild(proprie);

    const sez = el('div', 'wp-pv-nz-sezione');
    sez.appendChild(el('h3', 'wp-pv-h3', nzT('bordersTitle')));
    sez.appendChild(el('p', 'wp-pv-suggerimento', nzT('bordersBody')));

    // Per nazione proprietaria, nemici in cima: è l'ordine in cui si
    // guarda una frontiera.
    const gruppi = new Map();
    for (const c of conf.confinanti) {
      if (!gruppi.has(c.ownerId)) gruppi.set(c.ownerId, { ownerId: c.ownerId, relazione: c.relazione, regioni: [] });
      gruppi.get(c.ownerId).regioni.push(c);
    }
    const ordinati = [...gruppi.values()].sort((a, b) =>
      (ORDINE_RELAZIONI.indexOf(a.relazione) - ORDINE_RELAZIONI.indexOf(b.relazione))
      || String(nomeNazione(a.ownerId) || '').localeCompare(String(nomeNazione(b.ownerId) || '')));

    for (const g of ordinati) {
      const gr = el('div', `wp-pv-nz-confine wp-pv-nz-confine-${g.relazione}`);
      const t = el('div', 'wp-pv-nz-confine-testa');
      t.appendChild(gettonePaese(g.ownerId));
      t.appendChild(badgeRelazione(g.relazione));
      gr.appendChild(t);
      for (const r of g.regioni) gr.appendChild(rigaRegione(r, conf.pendingOre, true));
      sez.appendChild(gr);
    }
    card.appendChild(sez);
    return card;
  }

  function rigaRegione(r, pendingOre, straniera = false) {
    const riga = el('div', 'wp-pv-nz-regione');
    const nome = el('div', 'wp-pv-nz-regione-nome');
    nome.appendChild(el('strong', null, r.nome));
    if (r.capitale) nome.appendChild(el('span', 'wp-pv-nz-tag', nzT('capital')));
    if (r.battaglia) nome.appendChild(el('span', 'wp-pv-nz-tag wp-pv-nz-tag-battaglia', nzT('inBattle')));
    if (!straniera && r.collegataCapitale === false) nome.appendChild(el('span', 'wp-pv-nz-tag wp-pv-nz-tag-avviso', nzT('notLinked')));
    riga.appendChild(nome);

    const dett = [];
    if (straniera && r.confinaCon?.length) dett.push(`${nzT('bordersWith')} ${r.confinaCon.join(', ')}`);
    if (!straniera) {
      if (r.sviluppo != null) dett.push(`${nzT('kDevelopment')} ${Number(r.sviluppo).toFixed(1)}`);
      if (r.resistenzaMax) dett.push(`${nzT('resistance')} ${Math.round((r.resistenza / r.resistenzaMax) * 100)}%`);
      if (r.giacimento) dett.push(`${nzT('deposit')} ${r.giacimento.tipo}${r.giacimento.bonus ? ` +${r.giacimento.bonus}%` : ''}`);
    }
    riga.appendChild(el('span', 'wp-pv-suggerimento wp-pv-nz-regione-dett', dett.join(' · ')));

    const difese = el('div', 'wp-pv-nz-difese');
    for (const tipo of ['base', 'bunker']) difese.appendChild(chipDifesa(tipo, r.difese?.[tipo], pendingOre));
    riga.appendChild(difese);
    return riga;
  }

  function chipDifesa(tipo, d, pendingOre) {
    // 'ignoto' arriva per le nazioni fuori sorveglianza, dove si sa solo
    // cosa è acceso: una costruzione spenta lì non si vede, e non la si
    // spaccia per "nessuna costruzione".
    const assente = !d || d.stato === 'assente' || d.stato === 'ignoto';
    const cls = assente ? 'none' : d.inCostruzione && !d.stato ? 'building' : (d.stato || 'none');
    const chip = el('span', `wp-pv-nz-df wp-pv-nz-df-${cls}`);
    chip.appendChild(el('span', 'wp-pv-nz-df-tipo', nzT(`tipo_${tipo}`)));
    if (assente) chip.appendChild(el('span', null, nzT('df_none')));
    else {
      let testo = `${nzT('lv')}${d.livello} ${nzT(`df_${cls === 'building' ? 'building' : (d.stato || 'none')}`)}`;
      if (d.bonus) testo += ` +${d.bonus}%`;
      if (d.inCostruzione && d.stato) testo += ` · ${nzT('df_building')}`;
      // L'ora in cui si accende la scrive il gioco (willBeActiveAt); la
      // stima da "cambio di stato + 12 ore" resta solo come ripiego.
      const acceso = d.attivoDal || (d.dal ? d.dal + pendingOre * 3600_000 : null);
      if (d.stato === 'pending' && acceso) testo += ` → ${ora(acceso)}`;
      chip.appendChild(el('span', null, testo));
    }
    chip.title = nzT(tipo === 'base' ? 'baseEffect' : 'bunkerEffect');
    return chip;
  }

  return { render, ricarica: carica, nuovi: () => (dati ? nuovi().length : 0) };
}
