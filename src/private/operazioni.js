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
import { nomeNazione, etichettaBattaglia } from './battles.js';
import { stimaBattaglia, stimaPianificata, BUFFER_CONQUISTA } from '../shared/battleTiming.js';

// Attacchi, rivolte e difese senza una battaglia agganciata: si stima la
// fine come se la battaglia partisse all'orario del passo.
const BATTAGLIA_PIANIFICATA = new Set(['attacco', 'rivolta', 'difesa']);
import { state } from '../diplomacy/state.js';
import { regionName, regionNeighbors } from '../diplomacy/travelDistance.js';
import { mostraOperazione } from './mappaOperazione.js';
import { statoVisto, numeriPassi, oraBreve, etichettaRegione } from './operazioniComuni.js';
import { trackEvent } from '../shared/analytics.js';

// I tipi che si scelgono. "Contratto" è uscito dal menu il 2026-10-22 (non
// serviva): il server lo accetta ancora, e un passo vecchio di quel tipo
// si vede e si modifica come prima (vedi creaModuloPasso).
const TIPI = ['attacco', 'difesa', 'rivolta', 'pillole', 'altro'];
const STATI = ['da_fare', 'in_corso', 'fatta', 'fallita', 'annullata'];
const PRIORITA = ['alta', 'media', 'bassa'];
const CORSIE = [
  ['rivolte', ['rivolta']],
  ['fronte', ['attacco', 'difesa']],
  ['supporto', ['contratto', 'altro']],
  // In fondo, sotto a tutto: le pillole sono una barra lunga un giorno
  // (vedi PILLOLA_*) e in mezzo alle altre corsie le coprirebbe.
  ['pillole', ['pillole']],
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

// La pillola: 8 ore di effetto, poi 15 ore e mezza di malus
// (gameConfig.items.cocain, le stesse durate di server/damageTimeline.js).
const PILLOLA_EFFETTO = 8 * 3600_000;
const PILLOLA_MALUS = 15.5 * 3600_000;

const CHIAVE_SCELTA = 'wp_pv_op_scelta';
const CHIAVE_BATTAGLIE = 'wp_pv_op_battaglie';

// ── Battaglie aperte ────────────────────────────────────────────────
// Fine del round e della battaglia: il calcolo è condiviso con la sezione
// Battaglie e i marker della mappa (src/shared/battleTiming.js).
const fineBattaglia = stimaBattaglia;

// (fineDiPasso è dentro creaOperazioni: le battaglie vive stanno lì.)

function testoBattaglia(b) {
  const f = fineBattaglia(b);
  const fine = f.prima === f.ultima ? oraBreve(f.prima) : `${oraBreve(f.prima)}–${oraBreve(f.ultima)}`;
  return t('battleLine2', { n: f.round, a: f.a, d: f.d, pa: f.pa, pd: f.pd, round: oraBreve(f.fineRound), fine });
}

// ── Conti alla rovescia vivi ──────────────────────────────────────
// La priorità di guerra scade a un istante preciso: il numero deve
// scendere da solo, non restare quello del momento del disegno. Ogni conto
// è uno <span data-scade> e un solo intervallo li aggiorna tutti ogni
// secondo, senza ridisegnare la pagina. Quando uno arriva a zero la
// lavagna si ridisegna una volta: la priorità scaduta sparisce da sola.

function conto(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const z = (n) => String(n).padStart(2, '0');
  return h ? `${h}h ${z(m)}m ${z(x)}s` : `${m}m ${z(x)}s`;
}

function contoVivo(fine) {
  const s = el('span', 'wp-pv-op-conto', conto(fine - Date.now()));
  s.dataset.scade = String(fine);
  return s;
}

let _ticker = null;
function avviaConti(allaScadenza) {
  if (_ticker) return;
  _ticker = setInterval(() => {
    let scaduto = false;
    for (const e of document.querySelectorAll('.wp-pv-op-conto[data-scade]')) {
      const resta = Number(e.dataset.scade) - Date.now();
      e.textContent = conto(resta);
      if (resta <= 0 && !e.dataset.finito) { e.dataset.finito = '1'; scaduto = true; }
    }
    if (scaduto) allaScadenza();
  }, 1000);
}

/** "12 h 36 min", "45 min". */
function durata(ms) {
  const min = Math.max(0, Math.round(ms / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

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

// ── Regioni secondo la nazione ────────────────────────────────────
// Prima si sceglie CHI (la nazione che attacca, che si rivolta, che
// difende), poi l'elenco delle regioni è solo quello che ha senso:
//   attacco → le regioni straniere che toccano le sue;
//   rivolta → le sue regioni d'origine oggi in mano ad altri;
//   difesa  → la nazione è chi ATTACCA: le NOSTRE regioni che la toccano,
//             e "da dove" le sue regioni che toccano la nostra.
// Gli altri tipi tengono l'elenco intero (null).

function regioniCandidate(tipo, paese, noi) {
  const tutte = state.regionData || {};
  if (!paese) return null;
  const sue = Object.keys(tutte).filter((id) => tutte[id]?.country === paese);
  const straniera = (v) => tutte[v] && tutte[v].country !== paese;
  if (tipo === 'attacco') {
    const s = new Set();
    for (const id of sue) for (const v of regionNeighbors(id)) if (straniera(v)) s.add(v);
    return [...s];
  }
  if (tipo === 'rivolta') return Object.keys(tutte).filter((id) => tutte[id]?.initialCountry === paese && tutte[id]?.country !== paese);
  if (tipo === 'difesa') {
    return Object.keys(tutte).filter((id) => tutte[id]?.country === noi
      && regionNeighbors(id).some((v) => tutte[v]?.country === paese));
  }
  return null;
}

/** Da quali regioni della nazione si può attaccare `bersaglio`. */
function partenzeVerso(paese, bersaglio) {
  return regionNeighbors(bersaglio).filter((v) => state.regionData?.[v]?.country === paese);
}

const etichetteDi = (ids) => ids.map(etichettaRegione).filter((e) => e && e !== '—').sort((a, b) => a.localeCompare(b));

/** Il menu delle nazioni, la nostra in cima. */
function selettoreNazione(noi, valore) {
  const s = el('select', 'wp-pv-select');
  const nazioni = [...(state.nationMap?.entries() || [])]
    .map(([id, n]) => [id, n?.name || id])
    .sort((a, b) => (Number(b[0] === noi) - Number(a[0] === noi)) || a[1].localeCompare(b[1]));
  for (const [id, nome] of nazioni) s.appendChild(Object.assign(el('option', null, nome), { value: id }));
  s.value = valore || noi || '';
  return s;
}

const CON_NAZIONE = new Set(['attacco', 'rivolta', 'difesa']);
// I tipi che hanno una regione di partenza: chi attacca parte da lì.
const CON_PARTENZA = new Set(['attacco', 'difesa']);

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
  let viveId = new Map();       // battleId → battaglia in corso (passi agganciati)
  let pxOraUtente = null;       // zoom scelto (null = automatico)
  let posizioneX = null;        // scorrimento orizzontale, tenuto fra i ridisegni
  let centraSu = null;          // istante da portare al centro dopo uno zoom
  let larghezzaVista = 0;       // del riquadro del flowchart, misurata (vedi flowchart)
  // I due moduli: nodi che restano fra un ridisegno e l'altro.
  let moduloOp = null;          // { nodo, modifica: bool }
  let moduloPasso = null;       // { nodo, id: number|null }
  let rapido = null;            // aggiunta rapida aperta sul grafico: { nodo, x, y }
  let menuStato = null;         // id del passo col menu dello stato aperto
  let autoBuilder = null;       // { modo: nazione|alleanza|scelte, scelte: Set, tolte: Set }
  let battaglieVisibili = (() => { try { return localStorage.getItem(CHIAVE_BATTAGLIE) !== '0'; } catch { return true; } })();
  let cercaBatt = null;         // campo di ricerca delle battaglie (sopravvive ai ridisegni)
  let riempiBatt = null;        // ridisegna solo l'elenco filtrato

  const opzioni = () => ({ paese: ctx.paese?.() || null, archiviate });
  avviaConti(() => ctx.ridisegna());
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
      viveId = new Map();
      for (const b of battaglie || []) {
        const r = b?.defender?.region;
        if (r && !vive.has(r)) vive.set(r, b);
        if (b?._id) viveId.set(b._id, b);
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

    if (dati.guerre?.length) testa.appendChild(riquadroGuerre());
    testa.appendChild(barraOperazioni());
    if (moduloOp && !moduloOp.modifica) testa.appendChild(moduloOp.nodo);
    if (messaggio) testa.appendChild(el('p', 'wp-pv-error', messaggio));

    const op = operazioneScelta();
    if (op) wrap.appendChild(cardOperazione(op));
    else if (pianifica()) wrap.appendChild(cardOperazione(bozza()));
    else testa.appendChild(el('p', 'wp-pv-body', opT('emptyViewer')));
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
    testa.appendChild(azioni);
    card.appendChild(testa);
    // La bozza non ha ancora niente da mostrare sulla mappa, modificare o
    // archiviare: solo il grafico.
    if (!op.id) {
      // L'auto-builder sì: è il modo più veloce di riempire un piano vuoto.
      if (pianifica()) {
        azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('autoBuild'), () => {
          autoBuilder = { modo: 'nazione', scelte: new Set(), tolte: new Set() };
          ctx.ridisegna();
        }));
      }
      return cardCorpo(card, op, { numero, stati, perId });
    }
    // Sempre attivo: chi pianifica può anche partire dalla mappa, cliccando
    // le regioni (aggiungiDaMappa), senza nessun passo ancora.
    const mappa = bottone('wp-pv-btn-primary wp-pv-btn-small', opT('showOnMap'), () => {
      trackEvent('private-operation-map');
      mostraOperazione(op, {
        numero, stati,
        aggiungiDaMappa: pianifica() && op.stato !== 'archiviata' ? (r, tipo, quando) => aggiungiDaMappa(op, r, tipo, quando) : null,
      });
    });
    if (!op.passi.some((p) => p.regione) && !pianifica()) mappa.title = opT('mapNoRegions');
    azioni.appendChild(mappa);
    if (pianifica() && op.stato !== 'archiviata') {
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('addStep'), () => apriModuloPasso(op, null)));
      azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('autoBuild'), () => {
        autoBuilder = { modo: 'nazione', scelte: new Set(), tolte: new Set() };
        passoAperto = null; moduloPasso = null;
        ctx.ridisegna();
      }));
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
    if (moduloOp?.modifica) card.appendChild(moduloOp.nodo);
    return cardCorpo(card, op, { numero, stati, perId });
  }

  function cardCorpo(card, op, { numero, stati, perId }) {
    // Il grafico a sinistra, il pannello a destra: aprire un passo o un
    // modulo non fa più scorrere la pagina via dalla linea del tempo. Chi
    // pianifica vede il grafico anche vuoto: è lì che si clicca per
    // aggiungere.
    const modificabile = pianifica() && op.stato !== 'archiviata';
    if (!op.passi.length && !modificabile) {
      card.appendChild(el('p', 'wp-pv-body', opT('noSteps')));
      return card;
    }
    if (!op.id) card.appendChild(el('p', 'wp-pv-note', opT('draftHint')));
    else if (!op.passi.length) card.appendChild(el('p', 'wp-pv-note', opT('noStepsPlanner2')));
    if (modificabile && op.id) {
      const fascia = fasciaAggancio(op);
      if (fascia) card.appendChild(fascia);
    }
    const corpo = el('div', 'wp-pv-op-corpo');
    const principale = el('div', 'wp-pv-op-principale');
    principale.appendChild(flowchart(op, { numero, stati }));
    principale.appendChild(legenda());
    corpo.appendChild(principale);

    const lato = el('aside', 'wp-pv-op-lato');
    const aperto = passoAperto != null ? perId.get(passoAperto) : null;
    if (moduloPasso) lato.appendChild(moduloPasso.nodo);
    else if (aperto) lato.appendChild(dettaglioPasso(op, aperto, { numero, stati }));
    if (modificabile && autoBuilder) lato.appendChild(pannelloAuto(op));
    else if (modificabile && battaglieVisibili) lato.appendChild(colonnaBattaglie(op));
    // Pannello vuoto (battaglie chiuse, nessun passo aperto): il grafico
    // prende tutta la larghezza.
    if (lato.childNodes.length) corpo.appendChild(lato);
    else corpo.classList.add('senza-lato');
    card.appendChild(corpo);
    return card;
  }

  /** Un'operazione che ancora non esiste: chi pianifica e non ne ha
   *  nessuna vede subito il grafico, e la prima cosa che aggiunge la crea
   *  (idOperazione) — senza passare da "Nuova operazione". */
  function bozza() {
    const data = new Date().toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' });
    return { id: null, titolo: t('draftTitle', { data }), nota: null, stato: 'attiva', passi: [] };
  }

  /** L'id dell'operazione, creandola se è la bozza. */
  async function idOperazione(op) {
    if (op.id) return op.id;
    const r = await creaOperazione({ titolo: op.titolo }, opzioni());
    dati = { ...dati, ...r };
    sceltaId = r.creata;
    try { localStorage.setItem(CHIAVE_SCELTA, String(r.creata)); } catch { /* resta per questa apertura */ }
    trackEvent('private-operation-create');
    return r.creata;
  }

  /** Aggiunge un passo e lo apre nel pannello. */
  async function aggiungi(op, corpo) {
    const r = await scrivi(async () => aggiungiPasso(await idOperazione(op), corpo, opzioni()));
    if (!r) return false;
    passoAperto = r.creato ?? null;
    rapido = null; moduloPasso = null;
    trackEvent('private-operation-step');
    ctx.ridisegna();
    return true;
  }

  /** Un passo nuovo dalla mappa: la regione cliccata, il tipo e l'ora
   *  scelti nel riquadro. La partenza di un attacco (una nostra confinante)
   *  o di una difesa (una loro confinante) si mette da sé se è una sola.
   *  Risponde con l'operazione aggiornata, numeri e stati, o null. */
  async function aggiungiDaMappa(op, regione, tipo, quando) {
    const noi = dati.countryId;
    let daRegione = null;
    if (CON_PARTENZA.has(tipo)) {
      const vicine = regionNeighbors(regione).filter((v) => {
        const c = state.regionData?.[v]?.country;
        return tipo === 'attacco' ? c === noi : c && c !== noi;
      });
      if (vicine.length === 1) daRegione = vicine[0];
    }
    if (!(await aggiungi(op, { tipo, regione, daRegione, quando }))) return null;
    const nuovo = (dati.operazioni || []).find((o) => o.id === (op.id || sceltaId));
    if (!nuovo) return null;
    const perId = new Map(nuovo.passi.map((p) => [p.id, p]));
    return { op: nuovo, numero: numeriPassi(nuovo.passi), stati: new Map(nuovo.passi.map((p) => [p.id, statoVisto(p, perId)])) };
  }

  // ── Battaglie che si aprono come da piano ────────────────────────
  // Un passo con una regione, non agganciato o agganciato a una battaglia
  // ormai finita, e sulla sua regione si apre una battaglia nuova: è la
  // battaglia del piano. Non si aggancia da sola — la regione potrebbe
  // essere un caso — ma una fascia sopra il grafico lo propone, e un clic
  // conferma. Un passo ancora "da fare" passa anche "in corso".

  function proposteAggancio(op) {
    const usate = new Set(op.passi.map((p) => p.battaglia).filter((id) => id && viveId.has(id)));
    const out = [];
    for (const p of op.passi) {
      if (!p.regione || (p.battaglia && viveId.has(p.battaglia))) continue;
      if (['fatta', 'fallita', 'annullata'].includes(p.stato)) continue;
      const b = vive.get(p.regione);
      if (!b || usate.has(b._id) || b._id === p.battaglia) continue;
      usate.add(b._id);
      out.push({ p, b });
    }
    return out;
  }

  function fasciaAggancio(op) {
    const proposte = proposteAggancio(op);
    if (!proposte.length) return null;
    const numero = numeriPassi(op.passi);
    const box = el('div', 'wp-pv-op-aggancio');
    const testa = el('div', 'wp-pv-op-aggancio-testa');
    testa.appendChild(el('strong', null, t('linkTitle', { n: proposte.length })));
    if (proposte.length > 1) {
      const tutte = bottone('wp-pv-btn-primary wp-pv-btn-small', opT('linkAll'), () => aggancia(op, proposte));
      tutte.disabled = occupato;
      testa.appendChild(tutte);
    }
    box.appendChild(testa);
    for (const pr of proposte) {
      const r = el('div', 'wp-pv-op-aggancio-riga');
      r.appendChild(el('span', null, `#${numero.get(pr.p.id)} ${pr.p.titolo || regionName(pr.p.regione)} → ${etichettaBattaglia(pr.b)} · ${testoBattaglia(pr.b)}`));
      const uno = bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('linkOne'), () => aggancia(op, [pr]));
      uno.disabled = occupato;
      r.appendChild(uno);
      box.appendChild(r);
    }
    box.appendChild(el('p', 'wp-pv-note', opT('linkHint')));
    return box;
  }

  async function aggancia(op, proposte) {
    const r = await scrivi(async () => {
      let ultima = null;
      for (const { p, b } of proposte) {
        const corpo = { battaglia: b._id };
        if (p.stato === 'da_fare') corpo.stato = 'in_corso';
        ultima = await modificaPasso(op.id, p.id, corpo, opzioni());
      }
      return ultima;
    });
    if (r) trackEvent('private-operation-link');
  }

  // ── Auto-builder ─────────────────────────────────────────────────
  // Tutte le battaglie aperte di una scelta in un colpo: la nostra nazione,
  // la nostra alleanza (allianceId di state.nationMap, già in memoria) o
  // nazioni a scelta. Prima un elenco da spuntare, poi "Aggiungi": niente
  // entra nel piano senza che lo si sia visto. Il tetto di 40 passi per
  // operazione (server) lo dice prima, non dopo un errore a metà.

  const MAX_PASSI_OPERAZIONE = 40;

  /** Le nazioni della nostra alleanza, noi compresi (o solo noi). */
  function paesiAlleanza() {
    const noi = dati.countryId;
    const all = state.nationMap?.get(noi)?.allianceId;
    if (!all) return new Set([noi]);
    return new Set([...state.nationMap.values()].filter((n) => n.allianceId === all).map((n) => n._id));
  }

  /** Blu se nella battaglia c'è la nostra nazione, verde se c'è la nostra
   *  alleanza, rossa se no. */
  function classeBattaglia(b) {
    if (!b) return '';
    const noi = dati.countryId;
    if (b.attacker?.country === noi || b.defender?.country === noi) return ' batt-nostra';
    const a = paesiAlleanza();
    return a.has(b.attacker?.country) || a.has(b.defender?.country) ? ' batt-alleata' : ' batt-nemica';
  }

  function paesiAuto() {
    const noi = dati.countryId;
    if (autoBuilder.modo === 'nazione') return new Set([noi]);
    if (autoBuilder.modo === 'alleanza') {
      const all = state.nationMap?.get(noi)?.allianceId;
      if (!all) return null;
      return new Set([...state.nationMap.values()].filter((n) => n.allianceId === all).map((n) => n._id));
    }
    return autoBuilder.scelte;
  }

  function pannelloAuto(op) {
    const box = el('div', 'wp-pv-op-auto');
    const testa = el('div', 'wp-pv-op-batt-testa');
    testa.appendChild(el('span', 'wp-pv-label', opT('autoTitle')));
    const chiudi = bottone('wp-pv-op-x', '×', () => { autoBuilder = null; ctx.ridisegna(); });
    chiudi.setAttribute('aria-label', opT('close'));
    testa.appendChild(chiudi);
    box.appendChild(testa);

    const modi = el('div', 'wp-pv-op-auto-modi');
    for (const [k, etichetta] of [['nazione', 'autoNation'], ['alleanza', 'autoAlliance'], ['scelte', 'autoChosen']]) {
      const b = bottone(`wp-pv-btn-quiet wp-pv-btn-small${autoBuilder.modo === k ? ' attivo' : ''}`, opT(etichetta), () => {
        autoBuilder.modo = k; autoBuilder.tolte = new Set(); ctx.ridisegna();
      });
      b.setAttribute('aria-pressed', String(autoBuilder.modo === k));
      modi.appendChild(b);
    }
    box.appendChild(modi);

    const lista = el('div', 'wp-pv-op-batt-lista');
    const piede = el('div', 'wp-pv-op-auto-piede');
    const gia = new Set(op.passi.map((p) => p.battaglia).filter(Boolean));
    const posto = Math.max(0, MAX_PASSI_OPERAZIONE - op.passi.length);

    // Ridisegna solo l'elenco: il menu delle nazioni a scelta non perde la
    // selezione né lo scorrimento.
    const riempi = () => {
      lista.textContent = ''; piede.textContent = '';
      const paesi = paesiAuto();
      if (!paesi) { lista.appendChild(el('p', 'wp-pv-note', opT('autoNoAlliance'))); return; }
      const elenco = [...viveId.values()]
        .filter((b) => (paesi.has(b.attacker?.country) || paesi.has(b.defender?.country)) && !gia.has(b._id));
      if (!elenco.length) { lista.appendChild(el('p', 'wp-pv-note', opT('autoNone'))); return; }
      for (const b of elenco) {
        const r = el('label', `wp-pv-check wp-pv-op-auto-voce${classeBattaglia(b)}`);
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = !autoBuilder.tolte.has(b._id);
        cb.addEventListener('change', () => { if (cb.checked) autoBuilder.tolte.delete(b._id); else autoBuilder.tolte.add(b._id); conta(); });
        r.appendChild(cb);
        const testo = el('span', 'wp-pv-op-batt-testo');
        testo.appendChild(el('span', 'wp-pv-op-batt-nome', etichettaBattaglia(b)));
        testo.appendChild(el('span', 'wp-pv-op-batt-sub', `${opT(`kind_${corpoDaBattaglia(b, paesi).tipo}`)} · ${testoBattaglia(b)}`));
        r.appendChild(testo);
        lista.appendChild(r);
      }
      const nota = el('p', 'wp-pv-note');
      const ok = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small');
      ok.type = 'button';
      const scelte = () => elenco.filter((b) => !autoBuilder.tolte.has(b._id));
      const conta = () => {
        const n = Math.min(scelte().length, posto);
        ok.textContent = t('autoAdd', { n });
        ok.disabled = n === 0 || occupato;
        nota.textContent = scelte().length > posto ? t('autoLimit', { n: posto }) : '';
      };
      ok.addEventListener('click', () => aggiungiTante(op, scelte().slice(0, posto), paesi));
      piede.append(nota, ok);
      conta();
    };

    if (autoBuilder.modo === 'scelte') {
      const sel = el('select', 'wp-pv-select wp-pv-op-auto-nazioni');
      sel.multiple = true;
      sel.size = 7;
      const nazioni = [...(state.nationMap?.entries() || [])]
        .map(([id, n]) => [id, n?.name || id]).sort((a, b) => a[1].localeCompare(b[1]));
      for (const [id, nome] of nazioni) {
        const o = Object.assign(el('option', null, nome), { value: id });
        o.selected = autoBuilder.scelte.has(id);
        sel.appendChild(o);
      }
      sel.addEventListener('change', () => {
        autoBuilder.scelte = new Set([...sel.selectedOptions].map((o) => o.value));
        riempi();
      });
      const cerca = el('input', 'wp-pv-input wp-pv-op-batt-cerca');
      cerca.type = 'search';
      cerca.autocomplete = 'off';
      cerca.placeholder = opT('autoSearchNation');
      cerca.value = autoBuilder.cerca || '';
      const filtra = () => {
        const q = cerca.value.trim().toLowerCase();
        autoBuilder.cerca = cerca.value;
        for (const o of sel.options) o.hidden = Boolean(q) && !o.selected && !o.textContent.toLowerCase().includes(q);
      };
      cerca.addEventListener('input', filtra);
      filtra();
      box.appendChild(cerca);
      box.appendChild(sel);
      box.appendChild(el('p', 'wp-pv-note', opT('autoChosenHint')));
    }
    box.appendChild(lista);
    box.appendChild(piede);
    riempi();
    return box;
  }

  /** Molti passi in una scrittura sola: crea l'operazione se è la bozza,
   *  poi una battaglia dopo l'altra (il server vuole un passo per volta). */
  async function aggiungiTante(op, battaglie, paesi) {
    if (!battaglie.length) return;
    const r = await scrivi(async () => {
      const id = await idOperazione(op);
      let ultima = null;
      for (const b of battaglie) ultima = await aggiungiPasso(id, corpoDaBattaglia(b, paesi), opzioni());
      return ultima;
    });
    if (!r) return;
    autoBuilder = null;
    trackEvent('private-operation-autobuild');
    ctx.ridisegna();
  }

  // ── Battaglie aperte, da aggiungere con un clic ──────────────────

  /** Il passo che rappresenta una battaglia, visto da `paesi` (la nostra
   *  nazione di solito; l'alleanza o le nazioni scelte nell'auto-builder):
   *  attacco se attacca uno di loro, difesa se difende, rivolta se è una
   *  rivolta, altro se non c'entrano. */
  function corpoDaBattaglia(b, paesi = new Set([dati.countryId])) {
    const att = paesi.has(b.attacker?.country), dif = paesi.has(b.defender?.country);
    const tipo = !att && !dif ? 'altro' : b.type === 'resistance' ? 'rivolta' : att ? 'attacco' : 'difesa';
    return {
      tipo,
      regione: b.defender?.region || null,
      daRegione: CON_PARTENZA.has(tipo) ? (b.attacker?.region || null) : null,
      quando: Date.parse(b.createdAt),
      battaglia: b._id,
    };
  }

  /** Il pannello delle battaglie: si chiude dalla × e si riapre dal
   *  bottone "Battaglie" sopra il grafico (preferenza del browser). La
   *  ricerca filtra per regione e nazioni e ridisegna solo l'elenco, così il
   *  campo non perde il cursore a ogni lettera. */
  function colonnaBattaglie(op) {
    const box = el('div', 'wp-pv-op-battaglie');
    const testa = el('div', 'wp-pv-op-batt-testa');
    testa.appendChild(el('span', 'wp-pv-label', opT('battlesTitle')));
    const chiudi = bottone('wp-pv-op-x', '×', () => impostaBattaglieVisibili(false));
    chiudi.setAttribute('aria-label', opT('battlesHide'));
    chiudi.title = opT('battlesHide');
    testa.appendChild(chiudi);
    box.appendChild(testa);
    if (!viveId.size) { box.appendChild(el('p', 'wp-pv-note', opT('battlesNone'))); return box; }
    if (!cercaBatt) {
      cercaBatt = el('input', 'wp-pv-input wp-pv-op-batt-cerca');
      cercaBatt.type = 'search';
      cercaBatt.autocomplete = 'off';
      cercaBatt.addEventListener('input', () => riempiBatt?.());
    }
    cercaBatt.placeholder = opT('battlesSearch');
    box.appendChild(cercaBatt);
    const lista = el('div', 'wp-pv-op-batt-lista');
    box.appendChild(lista);
    riempiBatt = () => riempiListaBattaglie(op, lista, cercaBatt.value);
    riempiBatt();
    return box;
  }

  function impostaBattaglieVisibili(si) {
    battaglieVisibili = si;
    try { localStorage.setItem(CHIAVE_BATTAGLIE, si ? '1' : '0'); } catch { /* resta per questa apertura */ }
    ctx.ridisegna();
  }

  function riempiListaBattaglie(op, lista, testo) {
    lista.textContent = '';
    const noi = dati.countryId;
    const gia = new Set(op.passi.map((p) => p.battaglia).filter(Boolean));
    const nostra = (b) => b.attacker?.country === noi || b.defender?.country === noi;
    const q = String(testo || '').trim().toLowerCase();
    const tutte = [...viveId.values()]
      .filter((b) => !q || etichettaBattaglia(b).toLowerCase().includes(q))
      .sort((a, b) => Number(nostra(b)) - Number(nostra(a)));
    if (!tutte.length) { lista.appendChild(el('p', 'wp-pv-note', opT('battlesNoMatch'))); return; }
    const box = lista;
    for (const b of tutte) {
      const r = el('div', `wp-pv-op-batt${nostra(b) ? ' nostra' : ''}${classeBattaglia(b)}`);
      const testo = el('div', 'wp-pv-op-batt-testo');
      testo.appendChild(el('span', 'wp-pv-op-batt-nome', etichettaBattaglia(b)));
      testo.appendChild(el('span', 'wp-pv-op-batt-sub', testoBattaglia(b)));
      r.appendChild(testo);
      if (gia.has(b._id)) r.appendChild(el('span', 'wp-pv-op-batt-gia', opT('battlesAdded')));
      else {
        const piu = bottone('wp-pv-btn-quiet wp-pv-btn-small', '+', () => aggiungi(op, corpoDaBattaglia(b)));
        piu.title = opT('battlesAdd'); piu.setAttribute('aria-label', `${opT('battlesAdd')}: ${etichettaBattaglia(b)}`);
        piu.disabled = occupato;
        r.appendChild(piu);
      }
      box.appendChild(r);
    }
  }

  // ── Aggiunta rapida sul grafico ──────────────────────────────────
  // Un clic su un punto vuoto apre un riquadrino lì: cosa e dove, l'ora è
  // quella del punto. Invio salva. Il resto sta dietro "Altri dettagli".

  function apriRapido(op, { x, y, tipo, quando }) {
    indiceRegioni();
    const f = el('form', 'wp-pv-op-rapido');
    const sel = el('select', 'wp-pv-select wp-pv-select-piccola');
    for (const k of TIPI) sel.appendChild(Object.assign(el('option', null, opT(`kind_${k}`)), { value: k }));
    sel.value = tipo;
    // Come nel modulo completo: prima la nazione, poi solo le regioni che
    // per quel tipo hanno senso.
    const naz = selettoreNazione(dati.countryId, null);
    naz.classList.add('wp-pv-select-piccola');
    naz.setAttribute('aria-label', opT('fNation'));
    const dl = el('datalist');
    dl.id = 'wp-pv-op-regioni-rapido';
    const reg = el('input', 'wp-pv-input');
    reg.setAttribute('list', dl.id);
    reg.placeholder = opT('regionPh');
    reg.autocomplete = 'off';
    const aggiorna = () => {
      naz.hidden = !CON_NAZIONE.has(sel.value);
      const cand = CON_NAZIONE.has(sel.value) ? regioniCandidate(sel.value, naz.value, dati.countryId) : null;
      riempiDatalist(dl, cand ? etichetteDi(cand) : _etichette);
    };
    sel.addEventListener('change', () => {
      if (sel.value === 'difesa' && naz.value === dati.countryId && dati.guerre?.[0]?.nemico) naz.value = dati.guerre[0].nemico;
      else if (sel.value === 'attacco') naz.value = dati.countryId;
      aggiorna();
    });
    naz.addEventListener('change', aggiorna);
    aggiorna();
    const testa = el('div', 'wp-pv-op-rapido-testa');
    testa.appendChild(el('strong', null, quando ? oraBreve(quando) : opT('noTime')));
    const chiudi = bottone('wp-pv-op-x', '×', () => { rapido = null; ctx.ridisegna(); });
    chiudi.setAttribute('aria-label', opT('close'));
    testa.appendChild(chiudi);
    const avviso = el('p', 'wp-pv-error');
    avviso.hidden = true;
    const azioni = el('div', 'wp-pv-op-azioni');
    const ok = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', opT('quickAdd'));
    ok.type = 'submit';
    azioni.appendChild(ok);
    azioni.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', opT('moreDetails'), () => {
      const id = idDaEtichetta(reg.value);
      rapido = null;
      apriModuloPasso(op, null, { tipo: sel.value, quando, regione: id || null });
    }));
    f.append(testa, sel, naz, reg, dl, avviso, azioni);
    f.addEventListener('keydown', (e) => { if (e.key === 'Escape') { rapido = null; ctx.ridisegna(); } });
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = idDaEtichetta(reg.value);
      if (id === undefined) { avviso.textContent = opT('regionUnknown'); avviso.hidden = false; return; }
      // Un attacco parte da una regione della nazione scelta che confina:
      // se ce n'è una sola la si mette da sé, altrimenti nei dettagli.
      let da = null;
      if (CON_PARTENZA.has(sel.value) && id) {
        const partenze = partenzeVerso(naz.value, id);
        if (partenze.length === 1) da = partenze[0];
      }
      const fatto = await aggiungi(op, { tipo: sel.value, regione: id, daRegione: da, quando });
      if (!fatto) { avviso.textContent = messaggio || opT('errServer'); avviso.hidden = false; messaggio = null; }
    });
    rapido = { nodo: f, x, y };
    passoAperto = null; moduloPasso = null; menuStato = null;
    ctx.ridisegna();
    requestAnimationFrame(() => reg.focus());
  }

  // ── Guerre e priorità ────────────────────────────────────────────
  // La priorità di 24 ore dopo una conquista (war.getById, letta dal
  // server). `prioritaFino` resta pieno anche a priorità scaduta: vale solo
  // se è nel futuro.

  const guerraCon = (nemico) => (dati?.guerre || []).find((g) => g.nemico === nemico) || null;
  const prioritaAttiva = (g) => Boolean(g?.priorita && g.prioritaFino && g.prioritaFino > Date.now());

  // ⚠️ Regola di gioco: fra due stati si combatte UNA battaglia per volta,
  // e chi attacca mentre ha la priorità la "spende": la prossima dipende da
  // come finisce quella battaglia, non più dal timer (che war.getById
  // lascia pieno). Con una battaglia aperta fra noi e loro la priorità è
  // quindi "in gioco" e il conto alla rovescia non vale.

  /** La battaglia di guerra aperta fra noi e `nemico`, se c'è. */
  function battagliaCon(nemico) {
    const noi = dati?.countryId;
    if (!nemico || !noi) return null;
    for (const b of viveId.values()) {
      if (b.type && b.type !== 'war') continue;
      const a = b.attacker?.country, d = b.defender?.country;
      if ((a === noi && d === nemico) || (a === nemico && d === noi)) return b;
    }
    return null;
  }
  const inGioco = (g) => Boolean(g && battagliaCon(g.nemico));

  /** Un attacco o una difesa pianificati che cadono mentre c'è già una
   *  battaglia verso lo stesso stato (aperta, o un altro passo pianificato
   *  prima che quella possa essere finita): una sola per volta. Si guarda la
   *  fine più VICINA dell'altra, cioè il conflitto sicuro. Risponde con
   *  cosa si sovrappone, o null. */
  function conflittoBattaglia(p, op) {
    if (p.battaglia || !p.quando || !CON_PARTENZA.has(p.tipo)) return null;
    const g = guerraDelPasso(p);
    if (!g) return null;
    const mia = [p.quando, stimaPianificata(p.quando).prima];
    const tocca = (da, a) => da < mia[1] && a > mia[0];
    const bg = battagliaCon(g.nemico);
    if (bg && tocca(Date.parse(bg.createdAt), stimaBattaglia(bg).prima)) return etichettaBattaglia(bg);
    const numero = numeriPassi(op.passi);
    for (const q of op.passi) {
      if (q.id === p.id || q.battaglia || !q.quando || !CON_PARTENZA.has(q.tipo)) continue;
      if (guerraDelPasso(q)?.nemico !== g.nemico) continue;
      if (tocca(q.quando, stimaPianificata(q.quando).prima)) return `#${numero.get(q.id)} ${q.titolo || regionName(q.regione)}`;
    }
    return null;
  }

  /** La nazione contro cui è un passo: l'altro lato della battaglia
   *  agganciata, altrimenti chi possiede la regione (attacco) o quella di
   *  partenza (difesa). */
  function guerraDelPasso(p) {
    const noi = dati?.countryId;
    const b = p.battaglia ? viveId.get(p.battaglia) : null;
    let nemico = null;
    // Una battaglia che non riguarda la nostra nazione non ha una guerra
    // nostra: niente priorità, o si mostrerebbe quella di un'altra.
    if (b) {
      if (b.attacker?.country !== noi && b.defender?.country !== noi) return null;
      nemico = b.attacker?.country === noi ? b.defender?.country : b.attacker?.country;
    }
    else if (p.tipo === 'attacco') nemico = state.regionData?.[p.regione]?.country;
    else if (p.tipo === 'difesa') nemico = state.regionData?.[p.daRegione]?.country;
    return nemico && nemico !== noi ? guerraCon(nemico) : null;
  }

  function testoPriorita(g) {
    const bg = battagliaCon(g.nemico);
    if (bg) {
      const s = stimaBattaglia(bg);
      return t('prioAtStake', { regione: regionName(bg.defender?.region), da: oraBreve(s.prima), a: oraBreve(s.ultima) });
    }
    if (!g.warId) return opT('prioUnknown');
    if (!prioritaAttiva(g)) return opT('prioNone');
    const chi = g.priorita === dati.countryId ? opT('prioOurs') : t('prioTheirs', { nome: nomeNazione(g.priorita) || '?' });
    return `${chi} · ${t('prioEnds', { dura: durata(g.prioritaFino - Date.now()), ora: oraBreve(g.prioritaFino) })}`;
  }

  /** La stessa frase, ma col conto alla rovescia vivo al posto della durata
   *  (vedi contoVivo): è quella che si mostra, testoPriorita resta per i
   *  tooltip. */
  function nodoPriorita(g) {
    if (inGioco(g) || !prioritaAttiva(g)) return document.createTextNode(testoPriorita(g));
    const chi = g.priorita === dati.countryId ? opT('prioOurs') : t('prioTheirs', { nome: nomeNazione(g.priorita) || '?' });
    const [prima, dopo] = t('prioEnds', { ora: oraBreve(g.prioritaFino) }).split('{dura}');
    const s = el('span', null, `${chi} · ${prima}`);
    s.appendChild(contoVivo(g.prioritaFino));
    s.appendChild(document.createTextNode(dopo || ''));
    return s;
  }

  /** Il gettone sulla scheda: solo se c'è una priorità che corre adesso. */
  function chipPriorita(p) {
    const g = guerraDelPasso(p);
    if (inGioco(g)) {
      const c = el('span', 'wp-pv-op-prio-chip gioco', opT('prioChipStake'));
      c.title = testoPriorita(g);
      return c;
    }
    if (!prioritaAttiva(g)) return null;
    const nostra = g.priorita === dati.countryId;
    const c = el('span', `wp-pv-op-prio-chip${nostra ? ' nostra' : ''}`, `${nostra ? opT('prioChipOurs') : opT('prioChipTheirs')} `);
    c.appendChild(contoVivo(g.prioritaFino));
    c.title = testoPriorita(g);
    return c;
  }

  /** In cima alla pagina: tutte le guerre, con chi ha la priorità e per
   *  quanto. Prima quelle con una priorità che corre. */
  function riquadroGuerre() {
    const box = el('div', 'wp-pv-op-guerre');
    box.appendChild(el('span', 'wp-pv-label', opT('warsTitle')));
    const conta = (g) => Number(inGioco(g) || prioritaAttiva(g));
    const righe = [...dati.guerre].sort((a, b) => conta(b) - conta(a));
    for (const g of righe) {
      const attiva = prioritaAttiva(g);
      const r = el('div', `wp-pv-op-guerra${inGioco(g) ? ' gioco' : attiva ? (g.priorita === dati.countryId ? ' nostra' : ' loro') : ''}`);
      r.appendChild(el('strong', null, nomeNazione(g.nemico) || '?'));
      r.appendChild(nodoPriorita(g));
      box.appendChild(r);
    }
    return box;
  }

  /** Fine stimata di un passo: la battaglia agganciata, oppure quella
   *  pianificata per attacchi, rivolte e difese con un orario. */
  function fineDiPasso(p) {
    const b = p.battaglia ? viveId.get(p.battaglia) : null;
    if (b) return stimaBattaglia(b);
    if (p.quando && BATTAGLIA_PIANIFICATA.has(p.tipo)) return stimaPianificata(p.quando);
    return null;
  }

  // ── Il flowchart ─────────────────────────────────────────────────
  // Una linea del tempo che si esplora: si trascina per spostarsi, si
  // ingrandisce con + e −, "Adesso" riporta al presente. Il periodo mostrato
  // è sempre quello dei passi più un margine, con l'ora attuale dentro.
  // Un passo agganciato a una battaglia aperta è una BARRA: piena fino alla
  // fine più vicina (chi è avanti vince tutti i round che mancano), poi una
  // coda a righe fino alla più lontana (si va fino all'ultimo round).
  // Un clic su un punto vuoto, per chi pianifica, apre il modulo di un
  // passo già con quell'ora e la corsia scelta.

  const TIPO_DI_CORSIA = { rivolte: 'rivolta', fronte: 'attacco', supporto: 'altro', pillole: 'pillole' };

  function disposizione(passi) {
    const ora = Date.now();
    const estesi = passi.map((p) => {
      const b = p.battaglia ? viveId.get(p.battaglia) : null;
      if (b) { const f = fineBattaglia(b); return { p, da: Date.parse(b.createdAt), finePrima: f.prima, fineUltima: f.ultima }; }
      // Una pillola dura: effetto e poi malus, a partire da quando la si prende.
      if (p.tipo === 'pillole' && p.quando) {
        return { p, da: p.quando, finePrima: null, fineUltima: null, fineMalus: p.quando + PILLOLA_EFFETTO + PILLOLA_MALUS };
      }
      if (p.quando && !p.battaglia && BATTAGLIA_PIANIFICATA.has(p.tipo)) {
        const s = stimaPianificata(p.quando);
        return { p, da: p.quando, finePrima: s.prima, fineUltima: s.ultima };
      }
      return { p, da: p.quando || null, finePrima: null, fineUltima: null };
    });
    const senzaOra = estesi.filter((e) => !e.da).length;
    const xSenza = ETICHETTA_W + 10;
    const xAsse0 = ETICHETTA_W + (senzaOra ? SENZA_ORARIO_W : 0) + 14;
    const tutti = estesi.flatMap((e) => [e.da, e.fineUltima && e.fineUltima + BUFFER_CONQUISTA, e.fineMalus]).filter(Boolean);
    // Anche le priorità di guerra in corso: la loro scadenza va dentro.
    for (const g of dati?.guerre || []) if (prioritaAttiva(g)) tutti.push(g.prioritaFino);
    const t0 = Math.floor(Math.min(ora, ...tutti) / ORA) * ORA - 2 * ORA;
    const t1 = Math.ceil(Math.max(ora, ...tutti) / ORA) * ORA + 3 * ORA;
    const ore = (t1 - t0) / ORA;
    const adatto = larghezzaVista ? (larghezzaVista - xAsse0 - CARTA_W - 16) / ore : 0;
    const pxOra = pxOraUtente ?? Math.min(120, Math.max(40, adatto));
    const xDi = (ms) => xAsse0 + ((ms - t0) / ORA) * pxOra;
    const tDi = (x) => t0 + ((x - xAsse0) / pxOra) * ORA;

    const pos = new Map();
    const corsie = [];
    let y = ASSE_H + 6;
    for (const [k, tipi] of CORSIE) {
      const qui = estesi.filter((e) => tipi.includes(e.p.tipo))
        .map((e) => {
          const x = e.da ? xDi(e.da) : xSenza;
          const w = e.finePrima ? Math.max(CARTA_W, ((e.finePrima - e.da) / ORA) * pxOra) : CARTA_W;
          const coda = e.fineUltima ? Math.max(0, ((e.fineUltima - e.finePrima) / ORA) * pxOra) : 0;
          const pillola = e.fineMalus ? { effetto: (PILLOLA_EFFETTO / ORA) * pxOra, malus: (PILLOLA_MALUS / ORA) * pxOra } : null;
          // Dopo la fine più lontana, l'ora in cui la regione appena
          // conquistata non si può attaccare.
          const buffer = e.fineUltima ? (BUFFER_CONQUISTA / ORA) * pxOra : 0;
          return { p: e.p, x, w, coda, pillola, buffer };
        })
        .sort((a, b) => (a.x - b.x) || (a.p.id - b.p.id));
      // Due schede che si toccherebbero scendono su righe diverse della
      // stessa corsia: la prima riga libera da quell'ora in poi.
      const righe = [];
      for (const c of qui) {
        let r = righe.findIndex((fine) => fine + 8 <= c.x);
        if (r < 0) { r = righe.length; righe.push(0); }
        // La pillola è uno sfondo a tutta altezza: nella sua corsia occupa
        // solo la scheda, e due pillole vicine stanno sulla stessa riga.
        righe[r] = c.x + c.w + c.coda + c.buffer;
        pos.set(c.p.id, { x: c.x, y: y + CORSIA_PAD + r * (CARTA_H + GAP_Y), w: c.w, coda: c.coda, pillola: c.pillola, buffer: c.buffer });
      }
      // Anche la corsia vuota si disegna: è dove si clicca per aggiungere.
      const h = CORSIA_PAD * 2 + Math.max(1, righe.length) * (CARTA_H + GAP_Y) - GAP_Y;
      corsie.push({ k, y, h });
      y += h;
    }
    let w = xDi(t1) + 12;
    for (const q of pos.values()) w = Math.max(w, q.x + q.w + q.coda + (q.buffer || 0) + 16, q.pillola ? q.x + q.pillola.effetto + q.pillola.malus + 16 : 0);

    // Le tacche dell'asse: ogni ora quando c'è spazio, poi ogni 3, 6, 12.
    const tacche = [];
    const passo = pxOra >= 60 ? 1 : pxOra >= 28 ? 3 : pxOra >= 14 ? 6 : 12;
    for (let ms = t0; ms <= t1; ms += ORA) {
      if (new Date(ms).getHours() % passo === 0 || ms === t0) tacche.push(ms);
    }
    return { pos, corsie, w, h: y + 6, t0, t1, xDi, tDi, xAsse0, pxOra, tacche, xSenza: senzaOra ? xSenza : null };
  }

  /** L'istante di un punto del grafico, al quarto d'ora; nella colonna
   *  "senza orario" nessun istante. */
  const istanteDi = (L, x) => (x >= L.xAsse0 - 10 ? Math.round(L.tDi(x) / 900_000) * 900_000 : null);
  const corsiaDiTipo = (tipo) => CORSIE.find(([, tipi]) => tipi.includes(tipo))?.[0];

  function flowchart(op, { numero, stati }) {
    const L = disposizione(op.passi);
    const modificabile = pianifica() && op.stato !== 'archiviata';
    const guscio = el('div', 'wp-pv-op-guscio');
    const scorre = el('div', 'wp-pv-op-flow');
    const tela = el('div', 'wp-pv-op-tela');
    tela.style.width = `${L.w}px`;
    tela.style.height = `${L.h}px`;

    // Barra degli strumenti: sposta, ingrandisci, torna a adesso.
    const barra = el('div', 'wp-pv-op-strumenti');
    const strumento = (testo, titolo, fn) => {
      const b = bottone('wp-pv-btn-quiet wp-pv-btn-small', testo, fn);
      b.title = titolo; b.setAttribute('aria-label', titolo);
      barra.appendChild(b);
    };
    const sposta = (ore) => { scorre.scrollBy({ left: ore * L.pxOra, behavior: 'smooth' }); };
    // Lo zoom tiene fermo il punto al centro del riquadro.
    const zoom = (k) => {
      centraSu = L.tDi(scorre.scrollLeft + scorre.clientWidth / 2);
      pxOraUtente = Math.min(260, Math.max(6, L.pxOra * k));
      ctx.ridisegna();
    };
    strumento('◀ 6h', opT('panBack'), () => sposta(-6));
    strumento('−', opT('zoomOut'), () => zoom(1 / 1.5));
    strumento('+', opT('zoomIn'), () => zoom(1.5));
    strumento(opT('nowBtn'), opT('nowBtnHint'), () => {
      scorre.scrollTo({ left: L.xDi(Date.now()) - scorre.clientWidth / 4, behavior: 'smooth' });
    });
    strumento('6h ▶', opT('panFwd'), () => sposta(6));
    // Riapre (o chiude) il pannello delle battaglie a destra.
    if (modificabile) {
      const b = bottone(`wp-pv-btn-quiet wp-pv-btn-small wp-pv-op-batt-interruttore${battaglieVisibili ? ' attivo' : ''}`,
        `${opT('battlesToggle')} (${viveId.size}) ${battaglieVisibili ? '▸' : '◂'}`, () => impostaBattaglieVisibili(!battaglieVisibili));
      b.setAttribute('aria-pressed', String(battaglieVisibili));
      barra.appendChild(b);
    }
    barra.appendChild(el('span', 'wp-pv-op-suggerimento', modificabile ? opT('chartHintPlan2') : opT('chartHint')));
    guscio.appendChild(barra);

    for (const [i, c] of L.corsie.entries()) {
      const fascia = el('div', `wp-pv-op-corsia${i % 2 ? ' dispari' : ''}`);
      fascia.style.top = `${c.y}px`;
      fascia.style.height = `${c.h}px`;
      fascia.appendChild(el('span', 'wp-pv-op-corsia-nome', opT(`lane_${c.k}`)));
      tela.appendChild(fascia);
    }

    // La pillola come SFONDO di tutto il grafico: una fascia verde per le 8
    // ore di effetto e una rossa per le 15 h 30 di malus, a tutta altezza,
    // sopra le corsie e sotto schede e frecce. Così si vede cosa cade dentro
    // l'effetto della pillola in ogni corsia, e la scheda resta piccola nella
    // sua.
    for (const p of op.passi) {
      const q = L.pos.get(p.id);
      if (!q?.pillola) continue;
      for (const [cls, x, larg, tit, testo] of [
        ['wp-pv-op-pill-effetto', q.x, q.pillola.effetto, opT('pillBuff'), '8 h'],
        ['wp-pv-op-pill-malus', q.x + q.pillola.effetto, q.pillola.malus, opT('pillMalus'), '15 h 30'],
      ]) {
        const f = el('div', cls);
        f.style.left = `${x}px`;
        f.style.top = `${ASSE_H}px`;
        f.style.width = `${larg}px`;
        f.style.height = `${L.h - ASSE_H}px`;
        f.title = tit;
        f.appendChild(el('span', 'wp-pv-op-pill-durata', testo));
        tela.appendChild(f);
      }
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
    const adessoX = L.xDi(Date.now());
    s.appendChild(svg('line', { x1: adessoX, y1: ASSE_H - 8, x2: adessoX, y2: L.h, class: 'wp-pv-op-adesso' }));
    const adesso = el('span', 'wp-pv-op-adesso-testo', opT('now'));
    adesso.style.left = `${adessoX + 4}px`;
    tela.appendChild(adesso);

    // Le priorità di guerra che corrono adesso: una barra sottile appena
    // sotto l'asse, da adesso alla scadenza, col conto alla rovescia vivo, e
    // una linea verticale dove scade. Verde se è nostra, rossa se loro.
    (dati.guerre || []).filter((g) => prioritaAttiva(g) || inGioco(g)).forEach((g, i) => {
      const bg = battagliaCon(g.nemico);
      if (bg) {
        const x2 = L.xDi(stimaBattaglia(bg).prima);
        const barra = el('div', 'wp-pv-op-prio-barra gioco', `${opT('prioChipStake')} · ${nomeNazione(g.nemico) || '?'}`);
        barra.style.left = `${adessoX}px`;
        barra.style.top = `${ASSE_H + 1 + i * 15}px`;
        barra.style.width = `${Math.max(2, x2 - adessoX)}px`;
        barra.title = testoPriorita(g);
        tela.appendChild(barra);
        return;
      }
      const nostra = g.priorita === dati.countryId;
      const x2 = L.xDi(g.prioritaFino);
      s.appendChild(svg('line', { x1: x2, y1: ASSE_H, x2, y2: L.h, class: `wp-pv-op-prio-linea${nostra ? ' nostra' : ''}` }));
      const barra = el('div', `wp-pv-op-prio-barra${nostra ? ' nostra' : ''}`);
      barra.style.left = `${adessoX}px`;
      barra.style.top = `${ASSE_H + 1 + i * 15}px`;
      barra.style.width = `${Math.max(2, x2 - adessoX)}px`;
      barra.appendChild(document.createTextNode(`${nostra ? opT('prioChipOurs') : opT('prioChipTheirs')} · ${nomeNazione(g.nemico) || '?'} · `));
      barra.appendChild(contoVivo(g.prioritaFino));
      barra.title = testoPriorita(g);
      tela.appendChild(barra);
    });
    if (L.xSenza != null) {
      const e = el('span', 'wp-pv-op-tacca wp-pv-op-tacca-senza', opT('noTime'));
      e.style.left = `${L.xSenza}px`;
      tela.appendChild(e);
    }

    // Le frecce: dal bordo destro del passo prima al bordo sinistro di
    // quello dopo. Se i due si sovrappongono nel tempo la freccia
    // orizzontale tornerebbe indietro: lì va in verticale, da una corsia
    // all'altra. Tratteggiate finché il passo prima non è fatto.
    const perId = new Map(op.passi.map((p) => [p.id, p]));
    for (const p of op.passi) {
      const b = L.pos.get(p.id);
      for (const da of p.dopo) {
        const a = L.pos.get(da);
        if (!a || !b) continue;
        let d;
        if (b.x - 2 >= a.x + a.w + 16) {
          const x1 = a.x + a.w, y1 = a.y + CARTA_H / 2;
          const x2 = b.x - 2, y2 = b.y + CARTA_H / 2;
          const dx = Math.max(36, (x2 - x1) / 2);
          d = `M${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        } else {
          const sotto = b.y > a.y;
          const x1 = a.x + a.w / 2, y1 = sotto ? a.y + CARTA_H : a.y;
          const x2 = b.x + b.w / 2, y2 = sotto ? b.y - 2 : b.y + CARTA_H + 2;
          const dy = Math.max(18, Math.abs(y2 - y1) / 2) * (sotto ? 1 : -1);
          d = `M${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
        }
        const fatto = ['fatta', 'annullata'].includes(perId.get(da)?.stato);
        s.appendChild(svg('path', {
          d,
          class: `wp-pv-op-freccia${fatto ? '' : ' attesa'}`,
          'marker-end': `url(#${fatto ? 'wp-pv-op-punta' : 'wp-pv-op-punta-attesa'})`,
        }));
        // Sopra, un tratto largo e invisibile su cui si clicca per togliere
        // la freccia: la linea da 1,6 px sarebbe impossibile da prendere.
        if (modificabile) {
          const presa = svg('path', { d, class: 'wp-pv-op-freccia-presa' });
          const titolo = svg('title');
          titolo.textContent = opT('arrowHint');
          presa.appendChild(titolo);
          presa.addEventListener('click', () => {
            if (!window.confirm(opT('arrowRemove'))) return;
            scrivi(() => modificaPasso(op.id, p.id, { dopo: p.dopo.filter((x) => x !== da) }, opzioni()));
          });
          s.appendChild(presa);
        }
      }
    }
    tela.appendChild(s);

    // Tirare una freccia: dalla maniglia a destra di una scheda fino a
    // un'altra scheda, che diventa "dopo" la prima.
    const iniziaFreccia = (p, q, e) => {
      e.preventDefault(); e.stopPropagation();
      const r0 = tela.getBoundingClientRect();
      const x1 = q.x + q.w, y1 = q.y + CARTA_H / 2;
      const linea = svg('path', { class: 'wp-pv-op-freccia nuova', 'marker-end': 'url(#wp-pv-op-punta)' });
      s.appendChild(linea);
      const muovi = (ev) => {
        const x2 = ev.clientX - r0.left, y2 = ev.clientY - r0.top;
        linea.setAttribute('d', `M${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`);
      };
      const fine = (ev) => {
        window.removeEventListener('pointermove', muovi);
        window.removeEventListener('pointerup', fine);
        linea.remove();
        const sotto = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.wp-pv-op-carta');
        const verso = sotto ? perId.get(Number(sotto.dataset.id)) : null;
        if (!verso || verso.id === p.id || verso.dopo.includes(p.id)) return;
        scrivi(() => modificaPasso(op.id, verso.id, { dopo: [...verso.dopo, p.id] }, opzioni()));
      };
      window.addEventListener('pointermove', muovi);
      window.addEventListener('pointerup', fine);
    };

    for (const p of op.passi) {
      const q = L.pos.get(p.id);
      if (!q) continue;
      if (q.coda > 0) {
        const coda = el('div', 'wp-pv-op-coda');
        coda.style.left = `${q.x + q.w}px`;
        coda.style.top = `${q.y}px`;
        coda.style.width = `${q.coda}px`;
        coda.style.height = `${CARTA_H}px`;
        coda.title = opT('battleRange');
        tela.appendChild(coda);
      }
      // L'ora dopo la conquista: la regione non è attaccabile. Si disegna
      // dopo la fine più lontana, col testo che dice la finestra intera.
      if (q.buffer > 0) {
        const fp = fineDiPasso(p);
        const buf = el('div', 'wp-pv-op-buffer');
        buf.style.left = `${q.x + q.w + q.coda}px`;
        buf.style.top = `${q.y}px`;
        buf.style.width = `${q.buffer}px`;
        buf.style.height = `${CARTA_H}px`;
        buf.appendChild(el('span', null, '+1 h'));
        if (fp) buf.title = t('bufferHint', { da: oraBreve(fp.prima + BUFFER_CONQUISTA), a: oraBreve(fp.ultima + BUFFER_CONQUISTA) });
        tela.appendChild(buf);
      }
      tela.appendChild(cartaPasso(p, q, { n: numero.get(p.id), stato: stati.get(p.id) }, { op, L, modificabile, iniziaFreccia }));
    }
    // Il menu dello stato, sotto la scheda che l'ha aperto.
    const qm = menuStato != null ? L.pos.get(menuStato) : null;
    const pm = qm ? perId.get(menuStato) : null;
    if (pm) {
      const m = el('div', 'wp-pv-op-menu');
      m.style.left = `${qm.x}px`;
      // Sotto la scheda se c'è spazio, altrimenti sopra: il riquadro del
      // grafico taglia quello che esce dal fondo, e sulle schede dell'ultima
      // riga il menu spariva.
      const ALTEZZA_MENU = 150;
      const sotto = qm.y + CARTA_H + 4;
      m.style.top = `${sotto + ALTEZZA_MENU > L.h ? Math.max(4, qm.y - ALTEZZA_MENU - 4) : sotto}px`;
      m.setAttribute('role', 'menu');
      for (const st of STATI) {
        const b = el('button', `wp-pv-op-menu-voce wp-pv-op-st-${st}${st === pm.stato ? ' attuale' : ''}`);
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.appendChild(el('span', 'wp-pv-op-pill', opT(`st_${st}`)));
        b.addEventListener('click', () => {
          menuStato = null;
          if (st === pm.stato) { ctx.ridisegna(); return; }
          scrivi(() => modificaPasso(op.id, pm.id, { stato: st }, opzioni()));
        });
        m.appendChild(b);
      }
      tela.appendChild(m);
    }
    // L'aggiunta rapida, dove si è cliccato (stesso nodo fra un ridisegno e
    // l'altro: non perde quello che si sta scrivendo).
    if (rapido) {
      rapido.nodo.style.left = `${Math.max(4, Math.min(rapido.x, L.w - 236))}px`;
      rapido.nodo.style.top = `${Math.max(4, Math.min(rapido.y, L.h - 170))}px`;
      tela.appendChild(rapido.nodo);
    }
    scorre.appendChild(tela);
    guscio.appendChild(scorre);

    // Trascinare per spostarsi; un clic senza spostamento, su un punto
    // vuoto, aggiunge un passo lì (solo a chi pianifica).
    let tiro = null;
    scorre.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest('.wp-pv-op-carta, .wp-pv-op-menu, .wp-pv-op-rapido, .wp-pv-op-freccia-presa')) return;
      // Un clic fuori chiude il menu dello stato o l'aggiunta rapida, e
      // basta: non apre subito un'altra aggiunta.
      if (menuStato != null || rapido) {
        menuStato = null; rapido = null;
        ctx.ridisegna();
        return;
      }
      tiro = { x: e.clientX, sl: scorre.scrollLeft, mosso: false };
      scorre.setPointerCapture(e.pointerId);
    });
    // Passando il mouse: una linea verticale con l'orario sotto il cursore.
    const guida = el('div', 'wp-pv-op-guida');
    const guidaOra = el('span', 'wp-pv-op-guida-ora');
    guida.appendChild(guidaOra);
    guida.hidden = true;
    tela.appendChild(guida);
    scorre.addEventListener('pointermove', (e) => {
      const x = e.clientX - tela.getBoundingClientRect().left;
      if (x < L.xAsse0 - 10) { guida.hidden = true; }
      else {
        guida.hidden = false;
        guida.style.left = `${x}px`;
        const ms = L.tDi(x);
        const d = new Date(ms);
        guidaOra.textContent = `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
      }
    });
    scorre.addEventListener('pointerleave', () => { guida.hidden = true; });
    scorre.addEventListener('pointermove', (e) => {
      if (!tiro) return;
      const dx = e.clientX - tiro.x;
      if (Math.abs(dx) > 4) { tiro.mosso = true; scorre.classList.add('trascina'); }
      if (tiro.mosso) scorre.scrollLeft = tiro.sl - dx;
    });
    const fineTiro = (e, clic) => {
      const t = tiro; tiro = null;
      scorre.classList.remove('trascina');
      if (!clic || !t || t.mosso || !modificabile) return;
      const r = tela.getBoundingClientRect();
      const x = e.clientX - r.left, yy = e.clientY - r.top;
      const corsia = L.corsie.find((c) => yy >= c.y && yy < c.y + c.h);
      if (!corsia) return;
      apriRapido(op, { x, y: yy, tipo: TIPO_DI_CORSIA[corsia.k], quando: istanteDi(L, x) });
    };
    scorre.addEventListener('pointerup', (e) => fineTiro(e, true));
    scorre.addEventListener('pointercancel', (e) => fineTiro(e, false));
    scorre.addEventListener('scroll', () => { posizioneX = scorre.scrollLeft; });

    // Dopo il disegno: la larghezza del riquadro si sa solo a riquadro in
    // pagina (si misura e, se è cambiata davvero, si ridisegna), e la
    // posizione si ripristina — a un ridisegno qualunque la linea del tempo
    // non deve tornare all'inizio. La prima volta si parte da "adesso".
    requestAnimationFrame(() => {
      const w = scorre.clientWidth;
      if (w && Math.abs(w - larghezzaVista) > 40) { larghezzaVista = w; ctx.ridisegna(); return; }
      if (centraSu != null) { scorre.scrollLeft = L.xDi(centraSu) - w / 2; centraSu = null; }
      else if (posizioneX != null) scorre.scrollLeft = posizioneX;
      else scorre.scrollLeft = Math.max(0, L.xDi(Date.now()) - w / 4);
      posizioneX = scorre.scrollLeft;
    });
    return guscio;
  }


  function cartaPasso(p, q, { n, stato }, { op, L, modificabile, iniziaFreccia }) {
    const c = el('button', `wp-pv-op-carta wp-pv-op-st-${stato}${passoAperto === p.id ? ' scelta' : ''}${modificabile ? ' muovibile' : ''}${q.pillola ? ' pillola' : ''}${classeBattaglia(p.battaglia ? viveId.get(p.battaglia) : null)}`);
    c.type = 'button';
    c.dataset.id = String(p.id);
    c.style.left = `${q.x}px`;
    c.style.top = `${q.y}px`;
    c.style.width = `${q.w || CARTA_W}px`;
    c.style.height = `${CARTA_H}px`;
    if (p.colore) {
      c.classList.add('colore-mano');
      c.style.setProperty('--mano', p.colore);
    }

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

    // Un passo agganciato a una battaglia aperta dice round e fine prevista
    // al posto dell'orario: l'orario di una battaglia è quello del gioco.
    const b = p.battaglia ? viveId.get(p.battaglia) : null;
    const sotto = b ? testoBattaglia(b)
      : p.battaglia ? opT('battleClosed')
        : p.quando && BATTAGLIA_PIANIFICATA.has(p.tipo)
          ? [oraBreve(p.quando), t('plannedEnd', { da: oraBreve(stimaPianificata(p.quando).prima), a: oraBreve(stimaPianificata(p.quando).ultima) })].join(' · ')
          : [oraBreve(p.quando), p.incaricato].filter(Boolean).join(' · ');
    if (sotto) c.appendChild(el('span', 'wp-pv-op-carta-sub', sotto));

    const piede = el('span', 'wp-pv-op-carta-piede');
    piede.appendChild(el('span', 'wp-pv-op-pill', opT(`st_${stato}`)));
    const conflitto = conflittoBattaglia(p, op);
    if (conflitto) {
      const w = el('span', 'wp-pv-op-prio-chip gioco', `⚠ ${opT('oneBattle')}`);
      w.title = t('oneBattleHint', { con: conflitto });
      piede.appendChild(w);
    }
    const prio = chipPriorita(p);
    if (prio) piede.appendChild(prio);
    else if (!b && p.regione && vive.has(p.regione)) {
      const v = el('span', 'wp-pv-op-viva', opT('liveBattle'));
      v.title = opT('liveBattleHint');
      piede.appendChild(v);
    }
    c.appendChild(piede);

    const descr = [`${n}.`, opT(`kind_${p.tipo}`), titolo, oraBreve(p.quando), opT(`st_${stato}`)].filter(Boolean).join(', ');
    c.setAttribute('aria-label', descr);

    // La maniglia per tirare una freccia verso il passo che viene dopo.
    if (modificabile) {
      const m = el('span', 'wp-pv-op-maniglia');
      m.title = opT('handleHint');
      m.setAttribute('aria-hidden', 'true');
      m.addEventListener('pointerdown', (e) => iniziaFreccia(p, q, e));
      c.appendChild(m);
    }

    // Trascinare la scheda: in orizzontale cambia l'orario (al quarto
    // d'ora), in un'altra corsia cambia il tipo. Una battaglia agganciata ha
    // l'orario del gioco: si sposta solo fra le corsie.
    let volo = null;
    let appenaMossa = false;
    if (modificabile) {
      const fisso = Boolean(p.battaglia);
      c.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.wp-pv-op-pill, .wp-pv-op-maniglia')) return;
        volo = { x: e.clientX, y: e.clientY, mosso: false };
        c.setPointerCapture(e.pointerId);
      });
      c.addEventListener('pointermove', (e) => {
        if (!volo) return;
        const dx = fisso ? 0 : e.clientX - volo.x, dy = e.clientY - volo.y;
        if (!volo.mosso && Math.hypot(dx, dy) < 6) return;
        volo.mosso = true;
        c.classList.add('in-volo');
        c.style.transform = `translate(${dx}px, ${dy}px)`;
      });
      c.addEventListener('pointerup', (e) => {
        const v = volo; volo = null;
        if (!v?.mosso) return;
        appenaMossa = true;
        c.classList.remove('in-volo');
        const dx = fisso ? 0 : e.clientX - v.x, dy = e.clientY - v.y;
        const cy = q.y + CARTA_H / 2 + dy;
        const corsia = L.corsie.find((k) => cy >= k.y && cy < k.y + k.h);
        const cambi = {};
        if (!fisso && Math.abs(dx) >= 6) {
          const nuovo = istanteDi(L, q.x + dx);
          if (nuovo !== (p.quando || null)) cambi.quando = nuovo;
        }
        if (corsia && corsia.k !== corsiaDiTipo(p.tipo)) cambi.tipo = TIPO_DI_CORSIA[corsia.k];
        if (!Object.keys(cambi).length) { c.style.transform = ''; return; }
        scrivi(() => modificaPasso(op.id, p.id, cambi, opzioni()));
      });
    }

    c.addEventListener('click', (e) => {
      if (appenaMossa) { appenaMossa = false; return; }
      // Un clic sulla pillola dello stato apre il menu per cambiarlo: il
      // gesto più frequente, senza passare dal dettaglio.
      if (e.target.closest('.wp-pv-op-pill') && op.id && op.stato !== 'archiviata' && !ctx.lente()) {
        menuStato = menuStato === p.id ? null : p.id;
        rapido = null;
        ctx.ridisegna();
        return;
      }
      passoAperto = passoAperto === p.id ? null : p.id;
      moduloPasso = null; menuStato = null; rapido = null;
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
    l.appendChild(el('span', 'wp-pv-op-legenda-fascia wp-pv-op-pill-effetto', opT('pillBuffShort')));
    l.appendChild(el('span', 'wp-pv-op-legenda-fascia wp-pv-op-pill-malus', opT('pillMalusShort')));
    l.appendChild(el('span', 'wp-pv-op-legenda-nota', opT('legendArrows')));
    return l;
  }

  // ── Il passo aperto ──────────────────────────────────────────────

  function dettaglioPasso(op, p, { numero, stati }) {
    const box = el('div', `wp-pv-op-dettaglio wp-pv-op-st-${stati.get(p.id)}`);
    const testa = el('div', 'wp-pv-op-dettaglio-testa');
    testa.appendChild(el('span', 'wp-pv-op-num', String(numero.get(p.id))));
    testa.appendChild(el('strong', null, p.titolo || (p.regione ? regionName(p.regione) : opT(`kind_${p.tipo}`))));
    testa.appendChild(el('span', `wp-pv-op-pill wp-pv-op-st-${stati.get(p.id)}`, opT(`st_${stati.get(p.id)}`)));
    const chiudi = bottone('wp-pv-op-x', '×', () => { passoAperto = null; ctx.ridisegna(); });
    chiudi.setAttribute('aria-label', opT('close'));
    testa.appendChild(chiudi);
    box.appendChild(testa);

    const righe = el('dl', 'wp-pv-op-fatti');
    const fatto = (k, v) => {
      if (!v) return;
      righe.appendChild(el('dt', null, k));
      if (v instanceof Node) { const dd = el('dd'); dd.appendChild(v); righe.appendChild(dd); return; }
      righe.appendChild(el('dd', null, v));
    };
    fatto(opT('fKind'), opT(`kind_${p.tipo}`));
    fatto(opT('fRegion'), etichettaRegione(p.regione));
    fatto(opT('fFrom'), etichettaRegione(p.daRegione));
    fatto(opT('fWhen'), p.quando ? new Date(p.quando).toLocaleString(undefined,
      { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : null);
    if (!p.battaglia && p.quando && BATTAGLIA_PIANIFICATA.has(p.tipo)) {
      const s = stimaPianificata(p.quando);
      fatto(opT('fEstEnd'), t('plannedEndLong', { da: oraBreve(s.prima), a: oraBreve(s.ultima) }));
      fatto(opT('fReattack'), t('reattackWindow', { da: oraBreve(s.prima + BUFFER_CONQUISTA), a: oraBreve(s.ultima + BUFFER_CONQUISTA) }));
    }
    fatto(opT('fPriority'), opT(`prio_${p.priorita}`));
    fatto(opT('fAssignee'), p.incaricato);
    const prima = p.dopo.map((id) => `${numero.get(id)}`).filter(Boolean);
    fatto(opT('fAfter'), prima.length ? prima.map((x) => `#${x}`).join(', ') : null);
    fatto(opT('fNote'), p.nota);
    if (p.battaglia) {
      const b = viveId.get(p.battaglia);
      fatto(opT('fBattleLink'), b ? `${etichettaBattaglia(b)} — ${testoBattaglia(b)}` : opT('battleClosed'));
      if (b) {
        const fb = fineBattaglia(b);
        fatto(opT('fRound'), t('roundEnds', { n: fb.round, pa: fb.pa, pd: fb.pd, dura: durata(fb.fineRound - Date.now()), ora: oraBreve(fb.fineRound) }));
        fatto(opT('fReattack'), t('reattackWindow', { da: oraBreve(fb.prima + BUFFER_CONQUISTA), a: oraBreve(fb.ultima + BUFFER_CONQUISTA) }));
      }
    }
    const g = guerraDelPasso(p);
    if (g) fatto(opT('fPrio'), nodoPriorita(g));
    const conflitto = conflittoBattaglia(p, op);
    if (conflitto) fatto(opT('fConflict'), t('oneBattleHint', { con: conflitto }));
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
    rapido = null; menuStato = null;
    moduloPasso.nodo.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  /** Il modulo di un passo: nuovo (`p` null) o da modificare. */
  function creaModuloPasso(op, p, preimpostati) {
    indiceRegioni();
    const f = el('form', 'wp-pv-op-modulo wp-pv-op-modulo-passo');
    f.appendChild(el('h4', 'wp-pv-op-modulo-titolo', p ? opT('editStep') : opT('addStep')));

    const tipo = el('select', 'wp-pv-select');
    for (const k of (p && !TIPI.includes(p.tipo) ? [...TIPI, p.tipo] : TIPI)) {
      const o = el('option', null, opT(`kind_${k}`));
      o.value = k;
      tipo.appendChild(o);
    }
    tipo.value = p?.tipo || preimpostati.tipo || 'attacco';

    const titolo = el('input', 'wp-pv-input');
    titolo.maxLength = 80; titolo.placeholder = opT('stepTitlePh'); titolo.value = p?.titolo || '';

    // Prima la nazione, poi le regioni che per quel tipo hanno senso (vedi
    // regioniCandidate); "da dove" sono le sue regioni che toccano il
    // bersaglio, e se ce n'è una sola si mette da sé.
    const noiPaese = dati.countryId;
    const nazionePre = p?.tipo === 'attacco' && p.daRegione ? state.regionData?.[p.daRegione]?.country
      : p?.tipo === 'rivolta' && p.regione ? state.regionData?.[p.regione]?.initialCountry
        : p?.tipo === 'difesa' && p.daRegione ? state.regionData?.[p.daRegione]?.country : null;
    const nazione = selettoreNazione(noiPaese, nazionePre
      || ((p?.tipo || preimpostati.tipo) === 'difesa' ? dati.guerre?.[0]?.nemico : null));
    const dlTutte = el('datalist');
    dlTutte.id = 'wp-pv-op-regioni';
    const dlVicine = el('datalist');
    dlVicine.id = 'wp-pv-op-vicine';

    const regione = el('input', 'wp-pv-input');
    regione.setAttribute('list', dlTutte.id);
    regione.placeholder = opT('regionPh');
    const regionePre = p ? p.regione : preimpostati.regione;
    regione.value = regionePre ? etichettaRegione(regionePre) : '';
    regione.autocomplete = 'off';

    const daRegione = el('input', 'wp-pv-input');
    daRegione.setAttribute('list', dlVicine.id);
    daRegione.placeholder = opT('fromPh');
    daRegione.value = p?.daRegione ? etichettaRegione(p.daRegione) : '';
    daRegione.autocomplete = 'off';

    const aggiornaVicine = () => {
      const id = idDaEtichetta(regione.value);
      if (!id) { riempiDatalist(dlVicine, []); return; }
      const partenze = CON_PARTENZA.has(tipo.value) ? partenzeVerso(nazione.value, id) : [];
      riempiDatalist(dlVicine, etichetteDi(partenze.length ? partenze : regionNeighbors(id)));
      if (partenze.length === 1 && !idDaEtichetta(daRegione.value)) daRegione.value = etichettaRegione(partenze[0]);
    };
    const aggiornaRegioni = () => {
      const cand = CON_NAZIONE.has(tipo.value) ? regioniCandidate(tipo.value, nazione.value, noiPaese) : null;
      riempiDatalist(dlTutte, cand ? etichetteDi(cand) : _etichette);
      aggiornaVicine();
    };
    regione.addEventListener('change', aggiornaVicine);
    nazione.addEventListener('change', () => { daRegione.value = ''; aggiornaRegioni(); });
    tipo.addEventListener('change', () => {
      // In difesa la nazione è chi attacca: se è rimasta la nostra, la si
      // porta sul primo nemico con cui siamo in guerra.
      if (tipo.value === 'difesa' && nazione.value === noiPaese && dati.guerre?.[0]?.nemico) nazione.value = dati.guerre[0].nemico;
      else if (tipo.value !== 'difesa' && nazione.value !== noiPaese && tipo.value === 'attacco') nazione.value = noiPaese;
      aggiornaRegioni();
    });
    aggiornaRegioni();

    const quando = el('input', 'wp-pv-input');
    quando.type = 'datetime-local';
    quando.value = perCampoOrario(p ? p.quando : preimpostati.quando);

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

    // Una battaglia già aperta nel gioco, fra quelle in cui c'è la nostra
    // nazione. Sceglierla compila tipo, regioni e orario da sola: sono
    // fatti del gioco, non vanno riscritti a mano.
    const noi = dati.countryId;
    const battaglia = el('select', 'wp-pv-select');
    battaglia.appendChild(Object.assign(el('option', null, opT('battleNone')), { value: '' }));
    // Tutte le battaglie aperte, non solo le nostre (un alleato, un fronte
    // da seguire): le nostre prima, poi le altre in un gruppo a parte.
    const sono = (b) => b.attacker?.country === noi || b.defender?.country === noi;
    const nostre = [...viveId.values()];
    const voce = (b) => Object.assign(el('option', null, `${etichettaBattaglia(b)} · ${testoBattaglia(b)}`), { value: b._id });
    const gNostre = el('optgroup'); gNostre.label = opT('battleOurs');
    const gAltre = el('optgroup'); gAltre.label = opT('battleOthers');
    if (p?.battaglia && !viveId.has(p.battaglia)) {
      battaglia.appendChild(Object.assign(el('option', null, opT('battleClosed')), { value: p.battaglia }));
    }
    for (const b of nostre) (sono(b) ? gNostre : gAltre).appendChild(voce(b));
    if (gNostre.children.length) battaglia.appendChild(gNostre);
    if (gAltre.children.length) battaglia.appendChild(gAltre);
    battaglia.value = p?.battaglia || '';
    battaglia.addEventListener('change', () => {
      const b = viveId.get(battaglia.value);
      if (!b) return;
      tipo.value = !sono(b) ? 'altro' : b.type === 'resistance' ? 'rivolta' : b.attacker?.country === noi ? 'attacco' : 'difesa';
      const chi = b.attacker?.country;
      if (chi && CON_NAZIONE.has(tipo.value)) nazione.value = chi;
      tipo.dispatchEvent(new Event('change'));
      regione.value = b.defender?.region ? etichettaRegione(b.defender.region) : '';
      daRegione.value = CON_PARTENZA.has(tipo.value) && b.attacker?.region ? etichettaRegione(b.attacker.region) : '';
      aggiornaVicine();
      quando.value = perCampoOrario(Date.parse(b.createdAt));
    });

    // Il colore della scheda: automatico (blu, verde, rosso o lo stato) o
    // scelto a mano. Un <input type=color> non sa dire "nessuno": c'è una
    // casella accanto.
    const colore = el('input', 'wp-pv-op-colore');
    colore.type = 'color';
    colore.value = p?.colore || '#60a5fa';
    const auto = el('input');
    auto.type = 'checkbox';
    auto.checked = !p?.colore;
    colore.disabled = auto.checked;
    auto.addEventListener('change', () => { colore.disabled = auto.checked; });
    colore.addEventListener('input', () => { auto.checked = false; });
    const scatolaColore = el('div', 'wp-pv-op-colore-riga');
    const etAuto = el('label', 'wp-pv-check');
    etAuto.append(auto, el('span', null, opT('colorAuto')));
    scatolaColore.append(colore, etAuto);

    const nota = el('textarea', 'wp-pv-input wp-pv-op-nota');
    nota.maxLength = 500; nota.rows = 2; nota.placeholder = opT('notePh'); nota.value = p?.nota || '';

    const griglia = el('div', 'wp-pv-op-griglia-campi');
    if (nostre.length || p?.battaglia) griglia.appendChild(campo(opT('fBattleLink'), battaglia, 'wp-pv-op-campo-largo'));
    griglia.appendChild(campo(opT('fKind'), tipo));
    const campoNazione = campo(opT('fNation'), nazione);
    griglia.appendChild(campoNazione);
    griglia.appendChild(campo(opT('fRegion'), regione));
    griglia.appendChild(campo(opT('fTitle'), titolo));
    const campoDa = campo(opT('fFrom'), daRegione, 'wp-pv-op-campo-da');
    griglia.appendChild(campoDa);
    griglia.appendChild(campo(opT('fWhen'), quando));
    griglia.appendChild(campo(opT('fPriority'), priorita));
    griglia.appendChild(campo(opT('fAssignee'), incaricato));
    griglia.appendChild(campo(opT('fStatus'), stato));
    griglia.appendChild(campo(opT('fColor'), scatolaColore));
    f.appendChild(griglia);
    f.appendChild(dlTutte);
    f.appendChild(dlVicine);
    const mostraDa = () => { campoDa.hidden = !CON_PARTENZA.has(tipo.value); campoNazione.hidden = !CON_NAZIONE.has(tipo.value); };
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
      const idDa = CON_PARTENZA.has(tipo.value) ? idDaEtichetta(daRegione.value) : null;
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
        battaglia: battaglia.value || null,
        colore: auto.checked ? '' : colore.value,
        dopo: spunte.filter((cb) => cb.checked).map((cb) => Number(cb.value)),
      };
      // Un passo nuovo passa da aggiungi(), che crea anche l'operazione se
      // è ancora la bozza.
      if (!p) {
        if (!(await aggiungi(op, corpo))) { dire(messaggio); messaggio = null; ctx.ridisegna(); }
        return;
      }
      const r = await scrivi(() => modificaPasso(op.id, p.id, corpo, opzioni()));
      if (!r) { dire(messaggio); messaggio = null; ctx.ridisegna(); return; }
      moduloPasso = null;
      passoAperto = p.id;
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
