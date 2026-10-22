/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — la lavagna delle operazioni
   ------------------------------------------------------------------
   Richiesta dell'utente: uno scrumboard integrato con WarEra per
   rivolte, attacchi e orari di priorità, "a schede sequenziali, con
   tanto di orari e frecce", e un tasto per vederlo sulla mappa.

   Un'operazione è una catena di PASSI. Qui si disegna come un
   flowchart su un asse orario:
     · in ORIZZONTALE il tempo — ogni scheda sta all'ora prevista, e chi
       non ha ancora un orario sta in una colonna a sé, a sinistra;
     · in VERTICALE tre corsie per natura del passo: rivolte, fronte
       (attacchi e difese), supporto (pillole, contratti, altro);
     · le FRECCE vanno da un passo a quello che deve venire dopo.
       Tratteggiate finché il passo di partenza non è fatto.
   "Vedi sulla mappa" porta la stessa operazione sulla mappa principale
   (mappaOperazione.js): frecce da regione a regione, numeri e orari.

   ── LO STATO "IN ATTESA" SI RICAVA ────────────────────────────────
   Un passo da fare con un precedente non ancora fatto è in attesa:
   non si salva, si calcola (statoVisto). Il server tiene solo quello
   che le persone hanno detto; il resto viene dalle frecce.

   ── COSA VIENE DAL GIOCO ───────────────────────────────────────────
   Nomi e posizioni delle regioni, chi le possiede e chi confina con
   chi sono già in memoria (state della mappa): zero fetch. In più le
   battaglie in corso dal server di cache, le stesse dei marker sulla
   mappa: una scheda la cui regione ha una battaglia aperta lo dice.

   ── I MODULI SOPRAVVIVONO AI RIDISEGNI ─────────────────────────────
   L'area intera si ridisegna per qualunque cosa (un allarme di confine
   che arriva, la lingua che cambia). Un modulo ricostruito a ogni
   giro perderebbe quello che si sta scrivendo: i due moduli sono nodi
   creati una volta e riattaccati, come la ricerca in nazione.js.
   ══════════════════════════════════════════════════════════════ */

import '../styles/privateOperazioni.css';
import { opT } from './i18nOperazioni.js';
import { pvErr } from './i18n.js';
import {
  leggiOperazioni, creaOperazione, modificaOperazione, eliminaOperazione,
  aggiungiPasso, modificaPasso, eliminaPasso, battaglieInCorso, ApiError,
} from './api.js';
import { state } from '../diplomacy/state.js';
import { regionName, regionNeighbors } from '../diplomacy/travelDistance.js';
import { mostraOperazione } from './mappaOperazione.js';
import { statoVisto, numeriPassi, oraBreve, etichettaRegione } from './operazioniComuni.js';
import { trackEvent } from '../shared/analytics.js';

const TIPI = ['attacco', 'difesa', 'rivolta', 'pillole', 'contratto', 'altro'];
const STATI = ['da_fare', 'in_corso', 'fatta', 'fallita', 'annullata'];
const PRIORITA = ['alta', 'media', 'bassa'];
const CORSIE = [
  ['rivolte', ['rivolta']],
  ['fronte', ['attacco', 'difesa']],
  ['supporto', ['pillole', 'contratto', 'altro']],
];

// Misure del flowchart, in pixel.
const CARTA_W = 158;
const CARTA_H = 82;
const GAP_Y = 10;
const CORSIA_PAD = 12;
const ETICHETTA_W = 88;
const ASSE_H = 28;
const SENZA_ORARIO_W = CARTA_W + 30;
const ORA = 3600_000;

const CHIAVE_SCELTA = 'wp_pv_op_scelta';

// ── Piccoli aiuti di DOM ───────────────────────────────────────────

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

const SVG_NS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  return n;
}

function t(key, vars) {
  let s = opT(key);
  for (const [k, v] of Object.entries(vars || {})) s = s.split(`{${k}}`).join(String(v));
  return s;
}

function erroreDi(err) {
  if (!(err instanceof ApiError)) return opT('errServer');
  const proprio = opT(`err_${err.codice}`);
  return proprio !== `err_${err.codice}` ? proprio : pvErr(err.codice);
}

// datetime-local parla l'ora LOCALE senza fuso: si converte a mano, perché
// toISOString darebbe l'ora UTC e il campo mostrerebbe un'ora sbagliata.
function perCampoOrario(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
}

function daCampoOrario(s) {
  if (!s) return null;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : null;
}

// ── Regioni: ricerca per nome ──────────────────────────────────────
// Un <datalist> con tutte le regioni, "Nome (Nazione)". Costruito una
// volta per mappa caricata: refreshData sostituisce l'oggetto intero.

let _regioniDa = null;
let _perEtichetta = new Map();
let _etichette = [];

function indiceRegioni() {
  if (_regioniDa === state.regionData && _etichette.length) return;
  _regioniDa = state.regionData;
  _perEtichetta = new Map();
  for (const id of Object.keys(state.regionData || {})) {
    const e = etichettaRegione(id);
    if (e && e !== '—') _perEtichetta.set(e, id);
  }
  _etichette = [..._perEtichetta.keys()].sort((a, b) => a.localeCompare(b));
}

/** L'id di quello che è scritto nel campo: l'etichetta esatta, oppure un
 *  nome di regione che non ha omonimi. */
function idDaEtichetta(testo) {
  const s = String(testo || '').trim();
  if (!s) return null;
  indiceRegioni();
  if (_perEtichetta.has(s)) return _perEtichetta.get(s);
  const basso = s.toLowerCase();
  const trovati = [..._perEtichetta.entries()].filter(([e]) => e.toLowerCase().startsWith(`${basso} (`) || e.toLowerCase() === basso);
  return trovati.length === 1 ? trovati[0][1] : undefined;
}

function riempiDatalist(dl, etichette) {
  dl.textContent = '';
  for (const e of etichette) {
    const o = document.createElement('option');
    o.value = e;
    dl.appendChild(o);
  }
}

// ══════════════════════════════════════════════════════════════════
// La sezione
// ══════════════════════════════════════════════════════════════════

/**
 * @param {{ ridisegna: Function, lente: () => number|null, paese: () => string|null }} ctx
 */
export function creaOperazioni(ctx) {
  let dati = null;              // { countryId, puoPianificare, operazioni }
  let caricamento = false;
  let errore = null;
  let negato = null;            // il 403 con dentro i nomi del governo
  let archiviate = false;
  let sceltaId = (() => { try { return Number(localStorage.getItem(CHIAVE_SCELTA)) || null; } catch { return null; } })();
  let passoAperto = null;       // id del passo selezionato sulla lavagna
  let occupato = false;
  let messaggio = null;         // errore dell'ultima azione
  let vive = new Map();         // regionId → battaglia in corso
  let larghezzaVista = 0;       // del riquadro del flowchart, misurata (vedi flowchart)
  // I due moduli: nodi che restano fra un ridisegno e l'altro.
  let moduloOp = null;          // { nodo, modifica: bool }
  let moduloPasso = null;       // { nodo, id: number|null }

  const opzioni = () => ({ paese: ctx.paese?.() || null, archiviate });
  // Sotto la lente il server rifiuta ogni scrittura: i bottoni del governo
  // non si mostrano nemmeno, anche se la persona guardata governa.
  const pianifica = () => Boolean(dati?.puoPianificare) && !ctx.lente();

  async function carica() {
    caricamento = true; errore = null;
    ctx.ridisegna();
    try {
      const [ops, battaglie] = await Promise.all([
        leggiOperazioni({ asAccount: ctx.lente(), ...opzioni() }),
        battaglieInCorso().catch(() => []),
      ]);
      dati = ops;
      negato = null;
      vive = new Map();
      for (const b of battaglie || []) {
        const r = b?.defender?.region;
        if (r && !vive.has(r)) vive.set(r, b);
      }
    } catch (err) {
      if (err instanceof ApiError && err.codice === 'accesso_nazione_negato') {
        negato = err.dati || {};
        dati = null;
      } else if (err instanceof ApiError && err.codice === 'rotta_sconosciuta') {
        // warera-plus-api non ancora rideployato: è un'attesa, non un guasto.
        errore = opT('serverOld');
      } else {
        errore = erroreDi(err);
      }
    } finally {
      caricamento = false;
      ctx.ridisegna();
    }
  }

  /** Una scrittura: risponde con l'elenco aggiornato, che sostituisce il
   *  nostro. Ritorna la risposta, o null se è andata male (il messaggio
   *  resta a schermo). */
  async function scrivi(fn) {
    if (occupato) return null;
    occupato = true; messaggio = null;
    ctx.ridisegna();
    try {
      const r = await fn();
      if (r?.operazioni) dati = { ...dati, ...r };
      return r;
    } catch (err) {
      messaggio = erroreDi(err);
      return null;
    } finally {
      occupato = false;
      ctx.ridisegna();
    }
  }

  function operazioneScelta() {
    const ops = dati?.operazioni || [];
    return ops.find((o) => o.id === sceltaId) || ops[0] || null;
  }

  function scegli(id) {
    sceltaId = id;
    passoAperto = null;
    moduloPasso = null;
    moduloOp = null;
    try { localStorage.setItem(CHIAVE_SCELTA, String(id)); } catch { /* resta per questa apertura */ }
    ctx.ridisegna();
  }

  // ── Disegno ──────────────────────────────────────────────────────

  function render() {
    if (!dati && !caricamento && !errore && !negato) carica();
    const wrap = el('div', 'wp-pv-op');

    const testa = el('div', 'wp-pv-card wp-pv-op-testa');
    testa.appendChild(el('h2', 'wp-pv-h2', opT('title')));
    testa.appendChild(el('p', 'wp-pv-note', opT('lead')));
    wrap.appendChild(testa);

    if (negato) {
      const nomi = (negato.governo?.cariche || []).map((c) => c.persona?.nome).filter(Boolean);
      testa.appendChild(el('p', 'wp-pv-body', nomi.length ? t('deniedAsk', { nomi: nomi.slice(0, 4).join(', ') }) : opT('denied')));
      return wrap;
    }
    if (errore) {
      testa.appendChild(el('p', 'wp-pv-error', errore));
      testa.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('retry'), () => carica()));
      return wrap;
    }
    if (!dati) {
      testa.appendChild(el('p', 'wp-pv-note', opT('loading')));
      return wrap;
    }

    testa.appendChild(barraOperazioni());
    if (moduloOp && !moduloOp.modifica) testa.appendChild(moduloOp.nodo);
    if (messaggio) testa.appendChild(el('p', 'wp-pv-error', messaggio));

    const op = operazioneScelta();
    if (op) wrap.appendChild(cardOperazione(op));
    else if (!moduloOp) {
      testa.appendChild(el('p', 'wp-pv-body', pianifica() ? opT('emptyPlanner') : opT('emptyViewer')));
    }
    return wrap;
  }

  function barraOperazioni() {
    const barra = el('div', 'wp-pv-op-barra');
    const ops = dati.operazioni || [];
    const scelta = operazioneScelta();
    for (const o of ops) {
      const b = el('button', `wp-pv-op-chip${scelta?.id === o.id ? ' attiva' : ''}${o.stato === 'archiviata' ? ' archiviata' : ''}`);
      b.type = 'button';
      b.appendChild(el('span', null, o.titolo));
      const fatte = o.passi.filter((p) => p.stato === 'fatta').length;
      if (o.passi.length) b.appendChild(el('span', 'wp-pv-op-chip-n', `${fatte}/${o.passi.length}`));
      b.addEventListener('click', () => scegli(o.id));
      barra.appendChild(b);
    }
    if (pianifica()) {
      barra.appendChild(bottone('wp-pv-btn-primary wp-pv-btn-small', opT('newOp'), () => {
        moduloOp = { nodo: creaModuloOperazione(null), modifica: false };
        ctx.ridisegna();
        moduloOp.nodo.querySelector('input')?.focus();
      }));
    }
    const arch = el('label', 'wp-pv-check wp-pv-op-arch');
    const cb = el('input');
    cb.type = 'checkbox'; cb.checked = archiviate;
    cb.addEventListener('change', () => { archiviate = cb.checked; carica(); });
    arch.appendChild(cb);
    arch.appendChild(el('span', null, opT('showArchived')));
    barra.appendChild(arch);
    return barra;
  }

  /** Il modulo di un'operazione (nuova, o `op` da modificare). */
  function creaModuloOperazione(op) {
    const f = el('form', 'wp-pv-op-modulo');
    const titolo = el('input', 'wp-pv-input');
    titolo.maxLength = 80; titolo.placeholder = opT('opTitlePh'); titolo.value = op?.titolo || '';
    const nota = el('input', 'wp-pv-input');
    nota.maxLength = 500; nota.placeholder = opT('opNotePh'); nota.value = op?.nota || '';
    f.appendChild(campo(opT('opTitle'), titolo));
    f.appendChild(campo(opT('opNote'), nota));
    const azioni = el('div', 'wp-pv-op-azioni');
    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', op ? opT('save') : opT('create'));
    salva.type = 'submit';
    azioni.appendChild(salva);
    azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('cancel'), () => { moduloOp = null; ctx.ridisegna(); }));
    f.appendChild(azioni);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!titolo.value.trim()) { messaggio = opT('err_titolo_mancante'); ctx.ridisegna(); return; }
      const corpo = { titolo: titolo.value, nota: nota.value };
      const r = await scrivi(() => (op ? modificaOperazione(op.id, corpo, opzioni()) : creaOperazione(corpo, opzioni())));
      if (!r) return;
      moduloOp = null;
      if (r.creata) {
        sceltaId = r.creata;
        try { localStorage.setItem(CHIAVE_SCELTA, String(r.creata)); } catch { /* idem */ }
        trackEvent('private-operation-create');
      }
      ctx.ridisegna();
    });
    return f;
  }

  function campo(etichetta, controllo, cls = '') {
    const c = el('label', `wp-pv-campo ${cls}`.trim());
    c.appendChild(el('span', 'wp-pv-label', etichetta));
    c.appendChild(controllo);
    return c;
  }

  function cardOperazione(op) {
    const card = el('div', 'wp-pv-card wp-pv-op-card');
    const perId = new Map(op.passi.map((p) => [p.id, p]));
    const numero = numeriPassi(op.passi);
    const stati = new Map(op.passi.map((p) => [p.id, statoVisto(p, perId)]));

    const testa = el('div', 'wp-pv-op-card-testa');
    const nomi = el('div', 'wp-pv-op-card-nomi');
    nomi.appendChild(el('h3', 'wp-pv-op-titolo', op.titolo));
    if (op.nota) nomi.appendChild(el('p', 'wp-pv-note', op.nota));
    const meta = op.aggiornataDa ? t('updatedBy', { chi: op.aggiornataDa, quando: oraBreve(op.aggiornataIl) }) : null;
    if (meta) nomi.appendChild(el('p', 'wp-pv-op-meta', meta));
    testa.appendChild(nomi);

    const azioni = el('div', 'wp-pv-op-azioni');
    const conRegione = op.passi.some((p) => p.regione);
    const mappa = bottone('wp-pv-btn-primary wp-pv-btn-small', opT('showOnMap'), () => {
      trackEvent('private-operation-map');
      mostraOperazione(op, { numero, stati });
    });
    if (!conRegione) { mappa.disabled = true; mappa.title = opT('mapNoRegions'); }
    azioni.appendChild(mappa);
    if (pianifica() && op.stato !== 'archiviata') {
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('addStep'), () => apriModuloPasso(op, null)));
    }
    if (pianifica()) {
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('editOp'), () => {
        moduloOp = { nodo: creaModuloOperazione(op), modifica: true };
        ctx.ridisegna();
      }));
      const arch = op.stato === 'archiviata';
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', arch ? opT('restore') : opT('archive'), () =>
        scrivi(() => modificaOperazione(op.id, { stato: arch ? 'attiva' : 'archiviata' }, opzioni()))));
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small wp-pv-op-pericolo', opT('deleteOp'), async () => {
        if (!window.confirm(t('confirmDeleteOp', { titolo: op.titolo }))) return;
        const r = await scrivi(() => eliminaOperazione(op.id, opzioni()));
        if (r) { sceltaId = null; passoAperto = null; moduloPasso = null; ctx.ridisegna(); }
      }));
    }
    testa.appendChild(azioni);
    card.appendChild(testa);
    if (moduloOp?.modifica) card.appendChild(moduloOp.nodo);

    if (!op.passi.length) {
      card.appendChild(el('p', 'wp-pv-body', pianifica() ? opT('noStepsPlanner') : opT('noSteps')));
    } else {
      card.appendChild(flowchart(op, { numero, stati }));
      card.appendChild(legenda());
    }

    const aperto = passoAperto != null ? perId.get(passoAperto) : null;
    if (moduloPasso) card.appendChild(moduloPasso.nodo);
    else if (aperto) card.appendChild(dettaglioPasso(op, aperto, { numero, stati }));
    return card;
  }

  // ── Il flowchart ─────────────────────────────────────────────────

  function disposizione(passi) {
    const conOra = passi.filter((p) => p.quando);
    const senzaOra = passi.length - conOra.length;
    const xSenza = ETICHETTA_W + 10;
    const xAsse0 = ETICHETTA_W + (senzaOra ? SENZA_ORARIO_W : 0) + 14;
    let t0 = null, t1 = null, pxOra = 0;
    if (conOra.length) {
      const min = Math.min(...conOra.map((p) => p.quando));
      const max = Math.max(...conOra.map((p) => p.quando));
      t0 = Math.floor(min / ORA) * ORA;
      t1 = Math.max(Math.ceil(max / ORA) * ORA + ORA, t0 + 2 * ORA);
      const ore = (t1 - t0) / ORA;
      // Le ore riempiono lo spazio che c'è, ma non sotto un minimo: più è
      // lunga l'operazione, più si stringono — un piano di una sera si
      // legge ora per ora, uno di tre giorni scorre.
      const minimo = ore <= 6 ? 90 : ore <= 12 ? 60 : ore <= 24 ? 40 : ore <= 72 ? 20 : 10;
      const adatto = larghezzaVista ? (larghezzaVista - xAsse0 - CARTA_W - 16) / ore : 0;
      pxOra = Math.min(220, Math.max(minimo, adatto));
    }
    const xDi = (ms) => xAsse0 + ((ms - t0) / ORA) * pxOra;

    const pos = new Map();
    const corsie = [];
    let y = ASSE_H + 6;
    for (const [k, tipi] of CORSIE) {
      const qui = passi.filter((p) => tipi.includes(p.tipo))
        .map((p) => ({ p, x: p.quando ? xDi(p.quando) : xSenza }))
        .sort((a, b) => (a.x - b.x) || (a.p.id - b.p.id));
      if (!qui.length) continue;
      // Due schede che si toccherebbero scendono su righe diverse della
      // stessa corsia: la prima riga libera da quell'ora in poi.
      const righe = [];
      for (const c of qui) {
        let r = righe.findIndex((fine) => fine + 8 <= c.x);
        if (r < 0) { r = righe.length; righe.push(0); }
        righe[r] = c.x + CARTA_W;
        pos.set(c.p.id, { x: c.x, y: y + CORSIA_PAD + r * (CARTA_H + GAP_Y) });
      }
      const h = CORSIA_PAD * 2 + righe.length * (CARTA_H + GAP_Y) - GAP_Y;
      corsie.push({ k, y, h });
      y += h;
    }
    let w = ETICHETTA_W + 40;
    for (const { x } of pos.values()) w = Math.max(w, x + CARTA_W + 16);
    if (t1 != null) w = Math.max(w, xDi(t1) + 12);

    // Le tacche dell'asse: ogni ora quando c'è spazio, poi ogni 3, 6, 12.
    const tacche = [];
    if (t0 != null) {
      const passo = pxOra >= 60 ? 1 : pxOra >= 28 ? 3 : pxOra >= 14 ? 6 : 12;
      for (let ms = t0; ms <= t1; ms += ORA) {
        const h = new Date(ms).getHours();
        if (h % passo === 0 || ms === t0) tacche.push(ms);
      }
    }
    return { pos, corsie, w, h: y + 6, t0, t1, xDi, tacche, xSenza: senzaOra ? xSenza : null };
  }

  function flowchart(op, { numero, stati }) {
    const L = disposizione(op.passi);
    const scorre = el('div', 'wp-pv-op-flow');
    const tela = el('div', 'wp-pv-op-tela');
    tela.style.width = `${L.w}px`;
    tela.style.height = `${L.h}px`;

    for (const [i, c] of L.corsie.entries()) {
      const fascia = el('div', `wp-pv-op-corsia${i % 2 ? ' dispari' : ''}`);
      fascia.style.top = `${c.y}px`;
      fascia.style.height = `${c.h}px`;
      fascia.appendChild(el('span', 'wp-pv-op-corsia-nome', opT(`lane_${c.k}`)));
      tela.appendChild(fascia);
    }

    const s = svg('svg', { class: 'wp-pv-op-svg', width: L.w, height: L.h, viewBox: `0 0 ${L.w} ${L.h}`, 'aria-hidden': 'true' });
    const defs = svg('defs');
    for (const [id, cls] of [['wp-pv-op-punta', 'wp-pv-op-punta'], ['wp-pv-op-punta-attesa', 'wp-pv-op-punta wp-pv-op-punta-attesa']]) {
      const m = svg('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' });
      m.appendChild(svg('path', { d: 'M0 0L10 5L0 10z', class: cls }));
      defs.appendChild(m);
    }
    s.appendChild(defs);

    // Griglia oraria e asse.
    if (L.t0 != null) {
      let giornoPrima = null;
      for (const ms of L.tacche) {
        const x = L.xDi(ms);
        s.appendChild(svg('line', { x1: x, y1: ASSE_H - 4, x2: x, y2: L.h, class: 'wp-pv-op-griglia' }));
        const d = new Date(ms);
        const giorno = d.toDateString();
        const testo = giorno !== giornoPrima
          ? `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
          : d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        giornoPrima = giorno;
        const etichetta = el('span', 'wp-pv-op-tacca', testo);
        etichetta.style.left = `${x}px`;
        tela.appendChild(etichetta);
      }
      const ora = Date.now();
      if (ora >= L.t0 && ora <= L.t1) {
        const x = L.xDi(ora);
        s.appendChild(svg('line', { x1: x, y1: ASSE_H - 8, x2: x, y2: L.h, class: 'wp-pv-op-adesso' }));
        const adesso = el('span', 'wp-pv-op-adesso-testo', opT('now'));
        adesso.style.left = `${x + 4}px`;
        tela.appendChild(adesso);
      }
    }
    if (L.xSenza != null) {
      const e = el('span', 'wp-pv-op-tacca wp-pv-op-tacca-senza', opT('noTime'));
      e.style.left = `${L.xSenza}px`;
      tela.appendChild(e);
    }

    // Le frecce: dal bordo destro del passo prima al bordo sinistro di
    // quello dopo. Se i due si sovrappongono nel tempo (pillole alle 21:25,
    // attacco alle 21:30) la freccia orizzontale tornerebbe indietro: lì va
    // in verticale, da una corsia all'altra. Tratteggiate finché il passo
    // prima non è fatto.
    const perId = new Map(op.passi.map((p) => [p.id, p]));
    for (const p of op.passi) {
      const b = L.pos.get(p.id);
      for (const da of p.dopo) {
        const a = L.pos.get(da);
        if (!a || !b) continue;
        let d;
        if (b.x - 2 >= a.x + CARTA_W + 16) {
          const x1 = a.x + CARTA_W, y1 = a.y + CARTA_H / 2;
          const x2 = b.x - 2, y2 = b.y + CARTA_H / 2;
          const dx = Math.max(36, (x2 - x1) / 2);
          d = `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        } else {
          const sotto = b.y > a.y;
          const x1 = a.x + CARTA_W / 2, y1 = sotto ? a.y + CARTA_H : a.y;
          const x2 = b.x + CARTA_W / 2, y2 = sotto ? b.y - 2 : b.y + CARTA_H + 2;
          const dy = Math.max(18, Math.abs(y2 - y1) / 2) * (sotto ? 1 : -1);
          d = `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
        }
        const fatto = ['fatta', 'annullata'].includes(perId.get(da)?.stato);
        s.appendChild(svg('path', {
          d,
          class: `wp-pv-op-freccia${fatto ? '' : ' attesa'}`,
          'marker-end': `url(#${fatto ? 'wp-pv-op-punta' : 'wp-pv-op-punta-attesa'})`,
        }));
      }
    }
    tela.appendChild(s);

    for (const p of op.passi) {
      const q = L.pos.get(p.id);
      if (!q) continue;
      tela.appendChild(cartaPasso(p, q, { n: numero.get(p.id), stato: stati.get(p.id) }));
    }
    scorre.appendChild(tela);
    // La scala oraria dipende dalla larghezza del riquadro, che si sa solo
    // a riquadro in pagina: si misura dopo, e si ridisegna se è cambiata
    // davvero (la soglia assorbe la comparsa di una barra di scorrimento,
    // che altrimenti farebbe rimbalzare il disegno fra due larghezze).
    requestAnimationFrame(() => {
      const w = scorre.clientWidth;
      if (w && Math.abs(w - larghezzaVista) > 40) { larghezzaVista = w; ctx.ridisegna(); }
    });
    return scorre;
  }

  function cartaPasso(p, q, { n, stato }) {
    const c = el('button', `wp-pv-op-carta wp-pv-op-st-${stato}${passoAperto === p.id ? ' scelta' : ''}`);
    c.type = 'button';
    c.style.left = `${q.x}px`;
    c.style.top = `${q.y}px`;
    c.style.width = `${CARTA_W}px`;
    c.style.height = `${CARTA_H}px`;

    const riga1 = el('span', 'wp-pv-op-carta-testa');
    riga1.appendChild(el('span', 'wp-pv-op-num', String(n)));
    riga1.appendChild(el('span', 'wp-pv-op-tipo', opT(`kind_${p.tipo}`)));
    if (p.priorita === 'alta') {
      const pr = el('span', 'wp-pv-op-prio', '!');
      pr.title = opT('prio_alta');
      riga1.appendChild(pr);
    }
    c.appendChild(riga1);

    const titolo = p.titolo || (p.regione ? regionName(p.regione) : opT(`kind_${p.tipo}`));
    c.appendChild(el('span', 'wp-pv-op-carta-tit', titolo));

    const sotto = [oraBreve(p.quando), p.incaricato].filter(Boolean).join(' · ');
    if (sotto) c.appendChild(el('span', 'wp-pv-op-carta-sub', sotto));

    const piede = el('span', 'wp-pv-op-carta-piede');
    piede.appendChild(el('span', 'wp-pv-op-pill', opT(`st_${stato}`)));
    if (p.regione && vive.has(p.regione)) {
      const v = el('span', 'wp-pv-op-viva', opT('liveBattle'));
      v.title = opT('liveBattleHint');
      piede.appendChild(v);
    }
    c.appendChild(piede);

    const descr = [`${n}.`, opT(`kind_${p.tipo}`), titolo, oraBreve(p.quando), opT(`st_${stato}`)].filter(Boolean).join(', ');
    c.setAttribute('aria-label', descr);
    c.addEventListener('click', () => {
      passoAperto = passoAperto === p.id ? null : p.id;
      moduloPasso = null;
      ctx.ridisegna();
    });
    return c;
  }

  function legenda() {
    const l = el('div', 'wp-pv-op-legenda');
    for (const s of ['da_fare', 'attesa', 'in_corso', 'fatta', 'fallita', 'annullata']) {
      const v = el('span', `wp-pv-op-legenda-voce wp-pv-op-st-${s}`);
      v.appendChild(el('span', 'wp-pv-op-pill', opT(`st_${s}`)));
      l.appendChild(v);
    }
    l.appendChild(el('span', 'wp-pv-op-legenda-nota', opT('legendArrows')));
    return l;
  }

  // ── Il passo aperto ──────────────────────────────────────────────

  function dettaglioPasso(op, p, { numero, stati }) {
    const box = el('div', `wp-pv-op-dettaglio wp-pv-op-st-${stati.get(p.id)}`);
    const testa = el('div', 'wp-pv-op-dettaglio-testa');
    testa.appendChild(el('span', 'wp-pv-op-num', String(numero.get(p.id))));
    testa.appendChild(el('strong', null, p.titolo || opT(`kind_${p.tipo}`)));
    testa.appendChild(el('span', `wp-pv-op-pill wp-pv-op-st-${stati.get(p.id)}`, opT(`st_${stati.get(p.id)}`)));
    box.appendChild(testa);

    const righe = el('dl', 'wp-pv-op-fatti');
    const fatto = (k, v) => {
      if (!v) return;
      righe.appendChild(el('dt', null, k));
      righe.appendChild(el('dd', null, v));
    };
    fatto(opT('fKind'), opT(`kind_${p.tipo}`));
    fatto(opT('fRegion'), etichettaRegione(p.regione));
    fatto(opT('fFrom'), etichettaRegione(p.daRegione));
    fatto(opT('fWhen'), p.quando ? new Date(p.quando).toLocaleString(undefined,
      { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);
    fatto(opT('fPriority'), opT(`prio_${p.priorita}`));
    fatto(opT('fAssignee'), p.incaricato);
    const prima = p.dopo.map((id) => `${numero.get(id)}`).filter(Boolean);
    fatto(opT('fAfter'), prima.length ? prima.map((x) => `#${x}`).join(', ') : null);
    fatto(opT('fNote'), p.nota);
    if (p.regione && vive.has(p.regione)) fatto(opT('fBattle'), opT('liveBattleHint'));
    if (p.aggiornatoDa) fatto(opT('fUpdated'), `${p.aggiornatoDa} · ${oraBreve(p.aggiornatoIl)}`);
    box.appendChild(righe);

    // Spostare il passo: lo può fare chiunque veda la lavagna (il gesto
    // dello scrum), quindi i bottoni ci sono anche per chi non pianifica.
    if (op.stato !== 'archiviata' && !ctx.lente()) {
      const sposta = el('div', 'wp-pv-op-sposta');
      sposta.appendChild(el('span', 'wp-pv-label', opT('moveTo')));
      for (const s of STATI) {
        if (s === p.stato) continue;
        const b = bottone(`wp-pv-btn-quiet wp-pv-btn-small wp-pv-op-st-${s}`, opT(`st_${s}`), () =>
          scrivi(() => modificaPasso(op.id, p.id, { stato: s }, opzioni())));
        b.disabled = occupato;
        sposta.appendChild(b);
      }
      box.appendChild(sposta);
    }

    if (pianifica() && op.stato !== 'archiviata') {
      const azioni = el('div', 'wp-pv-op-azioni');
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('editStep'), () => apriModuloPasso(op, p)));
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('addAfter'), () => apriModuloPasso(op, null, { dopo: [p.id] })));
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small wp-pv-op-pericolo', opT('deleteStep'), async () => {
        if (!window.confirm(opT('confirmDeleteStep'))) return;
        const r = await scrivi(() => eliminaPasso(op.id, p.id, opzioni()));
        if (r) { passoAperto = null; ctx.ridisegna(); }
      }));
      box.appendChild(azioni);
    }
    return box;
  }

  function apriModuloPasso(op, p, preimpostati = {}) {
    moduloPasso = { nodo: creaModuloPasso(op, p, preimpostati), id: p?.id ?? null };
    passoAperto = p?.id ?? null;
    ctx.ridisegna();
    moduloPasso.nodo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Il modulo di un passo: nuovo (`p` null) o da modificare. */
  function creaModuloPasso(op, p, preimpostati) {
    indiceRegioni();
    const f = el('form', 'wp-pv-op-modulo wp-pv-op-modulo-passo');
    f.appendChild(el('h4', 'wp-pv-op-modulo-titolo', p ? opT('editStep') : opT('addStep')));

    const tipo = el('select', 'wp-pv-select');
    for (const k of TIPI) {
      const o = el('option', null, opT(`kind_${k}`));
      o.value = k;
      tipo.appendChild(o);
    }
    tipo.value = p?.tipo || preimpostati.tipo || 'attacco';

    const titolo = el('input', 'wp-pv-input');
    titolo.maxLength = 80; titolo.placeholder = opT('stepTitlePh'); titolo.value = p?.titolo || '';

    // Regione: tutte. Da dove: le confinanti della regione scelta, che è
    // da dove si può attaccare davvero.
    const dlTutte = el('datalist');
    dlTutte.id = 'wp-pv-op-regioni';
    riempiDatalist(dlTutte, _etichette);
    const dlVicine = el('datalist');
    dlVicine.id = 'wp-pv-op-vicine';

    const regione = el('input', 'wp-pv-input');
    regione.setAttribute('list', dlTutte.id);
    regione.placeholder = opT('regionPh');
    regione.value = p?.regione ? etichettaRegione(p.regione) : '';
    regione.autocomplete = 'off';

    const daRegione = el('input', 'wp-pv-input');
    daRegione.setAttribute('list', dlVicine.id);
    daRegione.placeholder = opT('fromPh');
    daRegione.value = p?.daRegione ? etichettaRegione(p.daRegione) : '';
    daRegione.autocomplete = 'off';

    const aggiornaVicine = () => {
      const id = idDaEtichetta(regione.value);
      const vicine = id ? regionNeighbors(id).map(etichettaRegione).filter(Boolean).sort((a, b) => a.localeCompare(b)) : _etichette;
      riempiDatalist(dlVicine, vicine);
    };
    regione.addEventListener('change', aggiornaVicine);
    aggiornaVicine();

    const quando = el('input', 'wp-pv-input');
    quando.type = 'datetime-local';
    quando.value = perCampoOrario(p?.quando);

    const priorita = el('select', 'wp-pv-select');
    for (const k of PRIORITA) {
      const o = el('option', null, opT(`prio_${k}`));
      o.value = k;
      priorita.appendChild(o);
    }
    priorita.value = p?.priorita || 'media';

    const incaricato = el('input', 'wp-pv-input');
    incaricato.maxLength = 60; incaricato.placeholder = opT('assigneePh'); incaricato.value = p?.incaricato || '';

    const stato = el('select', 'wp-pv-select');
    for (const k of STATI) {
      const o = el('option', null, opT(`st_${k}`));
      o.value = k;
      stato.appendChild(o);
    }
    stato.value = p?.stato || 'da_fare';

    const nota = el('textarea', 'wp-pv-input wp-pv-op-nota');
    nota.maxLength = 500; nota.rows = 2; nota.placeholder = opT('notePh'); nota.value = p?.nota || '';

    const griglia = el('div', 'wp-pv-op-griglia-campi');
    griglia.appendChild(campo(opT('fKind'), tipo));
    griglia.appendChild(campo(opT('fTitle'), titolo));
    griglia.appendChild(campo(opT('fRegion'), regione));
    const campoDa = campo(opT('fFrom'), daRegione, 'wp-pv-op-campo-da');
    griglia.appendChild(campoDa);
    griglia.appendChild(campo(opT('fWhen'), quando));
    griglia.appendChild(campo(opT('fPriority'), priorita));
    griglia.appendChild(campo(opT('fAssignee'), incaricato));
    griglia.appendChild(campo(opT('fStatus'), stato));
    f.appendChild(griglia);
    f.appendChild(dlTutte);
    f.appendChild(dlVicine);
    const mostraDa = () => { campoDa.hidden = tipo.value !== 'attacco'; };
    tipo.addEventListener('change', mostraDa);
    mostraDa();

    // Dopo quali passi. Si escludono sé stesso e chi viene già dopo di lui
    // (sceglierlo chiuderebbe un cerchio, e il server lo rifiuterebbe).
    const altri = op.passi.filter((q) => q.id !== p?.id);
    const discendenti = new Set();
    if (p) {
      const uscite = new Map();
      for (const q of op.passi) for (const d of q.dopo) {
        if (!uscite.has(d)) uscite.set(d, []);
        uscite.get(d).push(q.id);
      }
      const pila = [p.id];
      while (pila.length) {
        const x = pila.pop();
        for (const y of uscite.get(x) || []) if (!discendenti.has(y)) { discendenti.add(y); pila.push(y); }
      }
    }
    const scelti = new Set(p?.dopo || preimpostati.dopo || []);
    const numero = numeriPassi(op.passi);
    const spunte = [];
    if (altri.length) {
      const box = el('fieldset', 'wp-pv-op-dopo');
      box.appendChild(el('legend', 'wp-pv-label', opT('fAfter')));
      for (const q of altri.sort((a, b) => numero.get(a.id) - numero.get(b.id))) {
        const r = el('label', 'wp-pv-check');
        const cb = el('input');
        cb.type = 'checkbox'; cb.value = String(q.id);
        cb.checked = scelti.has(q.id);
        if (discendenti.has(q.id)) { cb.disabled = true; r.title = opT('afterCycle'); }
        r.appendChild(cb);
        r.appendChild(el('span', null, `#${numero.get(q.id)} ${q.titolo || (q.regione ? regionName(q.regione) : opT(`kind_${q.tipo}`))}`));
        box.appendChild(r);
        spunte.push(cb);
      }
      f.appendChild(box);
    }
    f.appendChild(campo(opT('fNote'), nota));

    const avviso = el('p', 'wp-pv-error');
    avviso.hidden = true;
    f.appendChild(avviso);

    const azioni = el('div', 'wp-pv-op-azioni');
    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', p ? opT('save') : opT('addStep'));
    salva.type = 'submit';
    azioni.appendChild(salva);
    azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('cancel'), () => { moduloPasso = null; ctx.ridisegna(); }));
    f.appendChild(azioni);

    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const dire = (testo) => { avviso.textContent = testo; avviso.hidden = false; };
      avviso.hidden = true;
      const idRegione = idDaEtichetta(regione.value);
      if (idRegione === undefined) return dire(opT('regionUnknown'));
      const idDa = tipo.value === 'attacco' ? idDaEtichetta(daRegione.value) : null;
      if (idDa === undefined) return dire(opT('fromUnknown'));
      if (idDa && idRegione && idDa === idRegione) return dire(opT('err_regioni_uguali'));
      const corpo = {
        tipo: tipo.value,
        titolo: titolo.value,
        regione: idRegione,
        daRegione: idDa,
        quando: daCampoOrario(quando.value),
        priorita: priorita.value,
        incaricato: incaricato.value,
        stato: stato.value,
        nota: nota.value,
        dopo: spunte.filter((cb) => cb.checked).map((cb) => Number(cb.value)),
      };
      const r = await scrivi(() => (p ? modificaPasso(op.id, p.id, corpo, opzioni()) : aggiungiPasso(op.id, corpo, opzioni())));
      if (!r) { dire(messaggio); messaggio = null; ctx.ridisegna(); return; }
      moduloPasso = null;
      passoAperto = p ? p.id : (r.creato ?? null);
      if (!p) trackEvent('private-operation-step');
      ctx.ridisegna();
    });
    return f;
  }

  return {
    render,
    ricarica: carica,
    /** Quanti passi sono in corso nelle operazioni attive: il numero sul
     *  bottone della pagina, come gli allarmi della nazione. */
    inCorso: () => (dati?.operazioni || []).filter((o) => o.stato !== 'archiviata')
      .reduce((n, o) => n + o.passi.filter((p) => p.stato === 'in_corso').length, 0),
  };
}
