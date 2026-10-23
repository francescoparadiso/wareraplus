/* ══════════════════════════════════════════════════════════════
   ACCORDI — la vista
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): una sezione in Approfondimenti
   per i patti di non belligeranza, che sia insieme ARCHIVIO e
   DIPLOMAZIA SULLA MAPPA. Il server e il perché delle regole stanno in
   server/plusApi/accordi.js; la mappa in src/diplomacy/accordiNaps.js.

   ── TRE PEZZI ──────────────────────────────────────────────────────
     · l'archivio: aperto a tutti senza login, filtri per stato (in
       vigore / futuri / scaduti) e ricerca per nazione o alleanza;
     · il modulo: tipo di coppia (nazione–nazione, nazione–alleanza,
       alleanza–alleanza), e in base a quello i due menù delle parti;
       testo, inizio e fine, unità fuori dal patto, tetto ai danni;
     · il controllo: le battaglie del periodo con gli attacchi diretti
       e il danno di una parte contro l'altra, confrontato col tetto.

   Il modulo si costruisce UNA volta per apertura e non si ridisegna
   mentre si scrive: un ridisegno a ogni tasto farebbe perdere il fuoco
   e il cursore. L'elenco invece si ridisegna liberamente.

   Chi può scrivere lo decide il server ad ogni salvataggio; qui lo si
   indovina solo per decidere quali bottoni disegnare (un bottone
   nascosto non è un permesso negato, e viceversa).
   ══════════════════════════════════════════════════════════════ */

import '../styles/accordi.css';
import { acT, acErr } from './i18n.js';
import {
  leggiAccordi, leggiControllo, leggiPoteri, creaAccordo, modificaAccordo, eliminaAccordo,
  fetchMe, getToken, entraConDiscord, ApiError,
} from './api.js';
import { cercaUnita } from '../private/api.js';
import { state } from '../diplomacy/state.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { accordoInVigore, nazioniParte, impostaAccordiSullaMappa } from '../diplomacy/accordiNaps.js';
import { trackEvent } from '../shared/analytics.js';

let rootEl = null;
let accordi = [];
let caricato = false;
let errore = false;
let account = null;
let poteri = null;          // { verificato, amministra, governa[], erroreGioco }
let filtro = 'tutti';       // tutti | attivi | futuri | scaduti
let ricerca = '';
let modulo = null;          // null | { id|null }
const testiAperti = new Set();
const controlli = new Map(); // id → { stato: 'carica'|'ok'|'errore', dati }

// Elementi stabili della pagina: si riempiono, non si ricreano.
let elAuth, elModulo, elLista, elBarra, elStats;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function bottone(cls, testo, onClick) {
  const b = el('button', `wp-ac-btn ${cls || ''}`.trim(), testo);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

const fmtNum = (n) => (n == null ? '—' : Math.round(n).toLocaleString());
const fmtData = (ms) => new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDataOra = (ms) => `${fmtData(ms)} ${new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;

// ---------------------------------------------------------------------------
// Parti: nomi, bandiere, membri
// ---------------------------------------------------------------------------

const nomeNazione = (id) => state.nationMap?.get(id)?.name || id;
const alleanza = (id) => (state.alliancesList || []).find(a => a._id === id) || null;
const nomeAlleanza = (id) => alleanza(id)?.name || id;
const nomeParte = (p) => (p?.tipo === 'alleanza' ? nomeAlleanza(p.id) : nomeNazione(p?.id));

function bandiera(id) {
  const url = getFlagUrl(getNationCode(id, state.nationMap?.get(id)));
  if (!url) return el('span', 'wp-ac-flag wp-ac-flag-vuota');
  const img = el('img', 'wp-ac-flag');
  img.src = url; img.alt = ''; img.loading = 'lazy';
  img.addEventListener('error', () => { img.style.visibility = 'hidden'; });
  return img;
}

function chipParte(p) {
  const c = el('span', `wp-ac-parte wp-ac-parte-${p.tipo}`);
  if (p.tipo === 'nazione') {
    c.appendChild(bandiera(p.id));
    c.appendChild(el('span', 'wp-ac-parte-nome', nomeNazione(p.id)));
  } else {
    const sw = el('span', 'wp-ac-swatch');
    sw.style.background = state.allianceColorMap?.get(p.id) || 'var(--ac-accent)';
    c.appendChild(sw);
    c.appendChild(el('span', 'wp-ac-parte-nome', nomeAlleanza(p.id)));
    const n = nazioniParte(p).length;
    if (n) c.appendChild(el('span', 'wp-ac-parte-sub', acT('nations', { n })));
  }
  return c;
}

function statoDi(a, ora = Date.now()) {
  if (accordoInVigore(a, ora)) return 'attivo';
  return a.inizio > ora ? 'futuro' : 'scaduto';
}

/** Lato client si indovina soltanto: il server ricontrolla. */
function puoScrivere(a) {
  if (!poteri) return false;
  if (poteri.amministra) return true;
  const gov = new Set(poteri.governa || []);
  if (!gov.size) return false;
  return [...nazioniParte(a.parteA), ...nazioniParte(a.parteB)].some(id => gov.has(id));
}

const puoCreare = () => Boolean(poteri && (poteri.amministra || (poteri.governa || []).length));

// ---------------------------------------------------------------------------
// Ciclo di vita
// ---------------------------------------------------------------------------

export async function initAccordiView(container) {
  if (rootEl !== container) {
    rootEl = container;
    costruisciScheletro();
    window.addEventListener('wareraplus:langchange', () => { costruisciScheletro(); disegnaTutto(); });
  }
  disegnaTutto();
  await Promise.all([caricaElenco(), caricaChiSei()]);
}

function costruisciScheletro() {
  rootEl.textContent = '';
  const wrap = el('div', 'wp-ac');
  const testata = el('header', 'wp-ac-testata');
  testata.appendChild(el('h1', 'wp-ac-title', acT('title')));
  testata.appendChild(el('p', 'wp-ac-lead', acT('lead')));
  wrap.appendChild(testata);

  elAuth = el('section', 'wp-ac-auth');
  elStats = el('section', 'wp-ac-stats');
  elBarra = el('div', 'wp-ac-barra');
  elModulo = el('section', 'wp-ac-modulo-slot');
  elLista = el('section', 'wp-ac-lista');
  wrap.append(elStats, elAuth, elBarra, elModulo, elLista);
  rootEl.appendChild(wrap);
  // Il modulo aperto si perde col ridisegno della lingua: si riapre vuoto
  // dello stesso accordo invece di lasciare uno slot fantasma.
  if (modulo) apriModulo(modulo.id ? accordi.find(a => a.id === modulo.id) : null);
}

function disegnaTutto() {
  disegnaAuth();
  disegnaBarra();
  disegnaLista();
}

async function caricaElenco() {
  errore = false;
  try {
    const r = await leggiAccordi();
    accordi = r.accordi || [];
    caricato = true;
    // La mappa si allinea a quello che si vede qui.
    impostaAccordiSullaMappa(accordi);
  } catch (err) {
    console.warn('[accordi] elenco non disponibile:', err);
    errore = true;
  }
  disegnaLista();
}

async function caricaChiSei() {
  account = null; poteri = null;
  if (!getToken()) { disegnaAuth(); disegnaBarra(); return; }
  try {
    account = await fetchMe();
    if (account && (account.verificato || account.admin)) poteri = await leggiPoteri();
  } catch (err) {
    console.warn('[accordi] chi sei non disponibile:', err);
  }
  disegnaAuth(); disegnaBarra(); disegnaLista();
}

// ---------------------------------------------------------------------------
// Chi sei
// ---------------------------------------------------------------------------

function disegnaAuth() {
  if (!elAuth) return;
  elAuth.textContent = '';
  const box = el('div', 'wp-ac-card wp-ac-card-auth');
  if (!account) {
    box.appendChild(el('h2', 'wp-ac-h2', acT('loginTitle')));
    box.appendChild(el('p', 'wp-ac-note', acT('loginBody')));
    box.appendChild(bottone('wp-ac-btn-discord', acT('signIn'), () => {
      trackEvent('accordi-login');
      entraConDiscord();
    }));
  } else {
    const riga = el('div', 'wp-ac-chi');
    riga.appendChild(el('strong', null, acT('signedAs', { who: account.warUsername || account.discordUsername })));
    box.appendChild(riga);
    if (!account.verificato && !account.admin) {
      box.appendChild(el('p', 'wp-ac-note', acT('loginBody')));
      box.appendChild(bottone('wp-ac-btn-quiet', acT('linkChar'), async () => {
        const m = await import('../app/accordiOverlay.js');
        m.closeAccordiView();
        (await import('../app/privateOverlay.js')).openPrivateView();
      }));
    } else if (poteri?.amministra) {
      box.appendChild(el('p', 'wp-ac-note', acT('adminNote')));
    } else if (poteri?.erroreGioco) {
      box.appendChild(el('p', 'wp-ac-note', acT('gameDown')));
    } else if (poteri?.governa?.length) {
      box.appendChild(el('p', 'wp-ac-note', acT('govOf', { list: poteri.governa.map(nomeNazione).join(', ') })));
    } else {
      box.appendChild(el('p', 'wp-ac-note', acT('noGov')));
    }
  }
  elAuth.appendChild(box);
}

// ---------------------------------------------------------------------------
// Barra: filtri, ricerca, nuovo
// ---------------------------------------------------------------------------

function disegnaBarra() {
  if (!elBarra) return;
  elBarra.textContent = '';
  const filtri = el('div', 'wp-ac-filtri');
  for (const [k, lbl] of [['tutti', 'filterAll'], ['attivi', 'filterActive'], ['futuri', 'filterFuture'], ['scaduti', 'filterExpired']]) {
    const b = bottone(`wp-ac-filtro${filtro === k ? ' attivo' : ''}`, acT(lbl), () => {
      filtro = k; disegnaBarra(); disegnaLista();
    });
    b.setAttribute('aria-pressed', String(filtro === k));
    filtri.appendChild(b);
  }
  elBarra.appendChild(filtri);

  const cerca = el('input', 'wp-ac-input wp-ac-cerca');
  cerca.type = 'search';
  cerca.placeholder = acT('searchPh');
  cerca.value = ricerca;
  cerca.addEventListener('input', () => { ricerca = cerca.value; disegnaLista(); });
  elBarra.appendChild(cerca);

  if (puoCreare() && !modulo) {
    elBarra.appendChild(bottone('wp-ac-btn-primary', `+ ${acT('newBtn')}`, () => apriModulo(null)));
  }
}

// ---------------------------------------------------------------------------
// Elenco
// ---------------------------------------------------------------------------

function corrisponde(a) {
  if (filtro !== 'tutti') {
    const s = statoDi(a);
    if ((filtro === 'attivi' && s !== 'attivo') || (filtro === 'futuri' && s !== 'futuro')
        || (filtro === 'scaduti' && s !== 'scaduto')) return false;
  }
  const q = ricerca.trim().toLowerCase();
  if (!q) return true;
  const nomi = [nomeParte(a.parteA), nomeParte(a.parteB), a.titolo || ''];
  // Un patto fra alleanze si trova anche cercando una nazione membro.
  for (const p of [a.parteA, a.parteB]) if (p.tipo === 'alleanza') nomi.push(...nazioniParte(p).map(nomeNazione));
  return nomi.some(n => String(n).toLowerCase().includes(q));
}

// ---------------------------------------------------------------------------
// Numeri
// ---------------------------------------------------------------------------

/** Le nazioni distinte di un gruppo di accordi. Un'alleanza conta coi
 *  membri di ADESSO, come sulla mappa: una nazione che ha due patti, o che
 *  sta in un patto da sola e in un altro con la sua alleanza, conta una. */
function nazioniDistinte(lista) {
  const s = new Set();
  for (const a of lista) for (const p of [a.parteA, a.parteB]) for (const id of nazioniParte(p)) s.add(id);
  return s.size;
}

function disegnaStats() {
  if (!elStats) return;
  elStats.textContent = '';
  if (!caricato || errore) return;
  const ora = Date.now();
  const inVigore = accordi.filter(a => statoDi(a, ora) === 'attivo');
  const tessere = [
    [accordi.length, 'statTotal'],
    [inVigore.length, 'statActive'],
    [nazioniDistinte(accordi), 'statNations'],
    [nazioniDistinte(inVigore), 'statNationsActive'],
  ];
  for (const [n, k] of tessere) {
    const t = el('div', 'wp-ac-stat');
    t.appendChild(el('span', 'wp-ac-stat-num', n.toLocaleString()));
    t.appendChild(el('span', 'wp-ac-stat-lbl', acT(k)));
    elStats.appendChild(t);
  }
}

function disegnaLista() {
  disegnaStats();
  if (!elLista) return;
  elLista.textContent = '';
  if (errore) {
    const box = el('div', 'wp-ac-card wp-ac-card-down');
    box.appendChild(el('p', 'wp-ac-body', acT('unavailable')));
    box.appendChild(bottone('wp-ac-btn-quiet', acT('retry'), caricaElenco));
    elLista.appendChild(box);
    return;
  }
  if (!caricato) { elLista.appendChild(el('p', 'wp-ac-note', acT('loading'))); return; }
  if (!accordi.length) { elLista.appendChild(el('p', 'wp-ac-vuoto', acT('empty'))); return; }

  const ora = Date.now();
  // In vigore prima, poi i futuri, poi gli scaduti; dentro, dal più recente.
  const ordine = { attivo: 0, futuro: 1, scaduto: 2 };
  const visibili = accordi.filter(corrisponde)
    .sort((x, y) => (ordine[statoDi(x, ora)] - ordine[statoDi(y, ora)]) || (y.inizio - x.inizio));
  if (!visibili.length) { elLista.appendChild(el('p', 'wp-ac-vuoto', acT('emptyFilter'))); return; }
  for (const a of visibili) elLista.appendChild(schedaAccordo(a, ora));
}

function testoTetto(a) {
  if (!a.tetto) return null;
  const n = fmtNum(a.tetto.danni);
  if (a.tetto.lato === 'entrambi') return acT('capBoth', { n });
  const chi = a.tetto.lato === 'a' ? a.parteA : a.parteB;
  const altro = a.tetto.lato === 'a' ? a.parteB : a.parteA;
  return acT('capOne', { who: nomeParte(chi), other: nomeParte(altro), n });
}

function schedaAccordo(a, ora) {
  const stato = statoDi(a, ora);
  const card = el('article', `wp-ac-card wp-ac-accordo wp-ac-st-${stato}`);

  const testa = el('div', 'wp-ac-testa');
  const parti = el('div', 'wp-ac-parti');
  parti.append(chipParte(a.parteA), el('span', 'wp-ac-vs', '⇄'), chipParte(a.parteB));
  testa.appendChild(parti);
  const badge = el('span', `wp-ac-badge wp-ac-badge-${stato}`,
    acT(stato === 'attivo' ? 'stActive' : stato === 'futuro' ? 'stFuture' : 'stExpired'));
  testa.appendChild(badge);
  card.appendChild(testa);

  card.appendChild(el('div', 'wp-ac-titolo', a.titolo || acT('nap')));
  card.appendChild(el('div', 'wp-ac-periodo', a.fine
    ? acT('period', { from: fmtData(a.inizio), to: fmtData(a.fine) })
    : acT('periodOpen', { from: fmtData(a.inizio) })));

  const tetto = testoTetto(a);
  if (tetto) card.appendChild(el('div', 'wp-ac-tetto', `⚔ ${tetto}`));

  if (a.muEscluse?.length) {
    const r = el('div', 'wp-ac-mu');
    r.appendChild(el('span', 'wp-ac-etichetta', `${acT('excludedMus')}:`));
    for (const m of a.muEscluse) r.appendChild(el('span', 'wp-ac-gettone', m.nome || m.id));
    card.appendChild(r);
  }

  if (testiAperti.has(a.id)) {
    card.appendChild(el('div', 'wp-ac-testo', a.testo || acT('noText')));
  }

  const firma = [acT('insertedBy', { who: a.inseritoDa || '?', date: fmtData(a.inseritoIl) })];
  if (a.aggiornatoIl && a.aggiornatoIl - a.inseritoIl > 60_000) {
    firma.push(acT('updatedBy', { who: a.aggiornatoDa || '?', date: fmtData(a.aggiornatoIl) }));
  }
  card.appendChild(el('div', 'wp-ac-firma', firma.join(' · ')));

  const azioni = el('div', 'wp-ac-azioni');
  if (a.testo) {
    azioni.appendChild(bottone('wp-ac-btn-quiet wp-ac-btn-small', testiAperti.has(a.id) ? acT('hideText') : acT('showText'), () => {
      if (testiAperti.has(a.id)) testiAperti.delete(a.id); else testiAperti.add(a.id);
      disegnaLista();
    }));
  }
  const ctl = controlli.get(a.id);
  azioni.appendChild(bottone('wp-ac-btn-quiet wp-ac-btn-small', ctl ? acT('checkHide') : acT('check'), () => {
    if (controlli.has(a.id)) { controlli.delete(a.id); disegnaLista(); return; }
    apriControllo(a.id);
  }));
  azioni.appendChild(bottone('wp-ac-btn-quiet wp-ac-btn-small', acT('showMap'), () => mostraSullaMappa(a)));
  if (puoScrivere(a)) {
    azioni.appendChild(bottone('wp-ac-btn-quiet wp-ac-btn-small', acT('edit'), () => apriModulo(a)));
    azioni.appendChild(bottone('wp-ac-btn-quiet wp-ac-btn-small wp-ac-btn-danger', acT('del'), () => elimina(a)));
  }
  card.appendChild(azioni);

  if (ctl) card.appendChild(vistaControllo(a, ctl));
  return card;
}

async function elimina(a) {
  if (!confirm(acT('confirmDel'))) return;
  try {
    const r = await eliminaAccordo(a.id);
    accordi = r.accordi || [];
    controlli.delete(a.id);
    impostaAccordiSullaMappa(accordi);
    trackEvent('accordi-delete');
  } catch (err) {
    alert(err instanceof ApiError ? acErr(err.codice) : acT('err_errore_server'));
  }
  disegnaLista();
}

// ---------------------------------------------------------------------------
// Sulla mappa
// ---------------------------------------------------------------------------

/** Chiude la sezione e seleziona sulla mappa diplomatica una nazione della
 *  prima parte: i NAP del patto le si colorano intorno. Per un'alleanza si
 *  prende il membro più popoloso, che è quello che si riconosce. */
async function mostraSullaMappa(a) {
  const candidati = nazioniParte(a.parteA);
  const pop = (id) => state.nationMap?.get(id)?.rankings?.countryActivePopulation?.value || 0;
  const id = candidati.sort((x, y) => pop(y) - pop(x))[0];
  if (!id) return;
  (await import('../app/accordiOverlay.js')).closeAccordiView();
  if (state.coloringMode !== 'diplomacy') document.getElementById('mode-diplomacy')?.click();
  state.selectedCountryId = id;
  const { renderMap } = await import('../diplomacy/map.js');
  renderMap();
  const label = state.labelsData?.find(l => l.properties?.countryId === id);
  if (label && state.map) state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
  import('../panel/countryPanel.js').then(m => m.selectNationInPanel(id)).catch(() => {});
  trackEvent('accordi-show-map');
}

// ---------------------------------------------------------------------------
// Controllo
// ---------------------------------------------------------------------------

async function apriControllo(id) {
  controlli.set(id, { stato: 'carica' });
  disegnaLista();
  try {
    controlli.set(id, { stato: 'ok', dati: await leggiControllo(id) });
    trackEvent('accordi-check');
  } catch (err) {
    console.warn('[accordi] controllo fallito:', err);
    controlli.set(id, { stato: 'errore' });
  }
  if (controlli.has(id)) disegnaLista();
}

function vistaControllo(a, ctl) {
  const box = el('div', 'wp-ac-controllo');
  box.appendChild(el('h3', 'wp-ac-h3', acT('checkTitle')));
  if (ctl.stato === 'carica') { box.appendChild(el('p', 'wp-ac-note', acT('loading'))); return box; }
  if (ctl.stato === 'errore') { box.appendChild(el('p', 'wp-ac-note', acT('checkError'))); return box; }
  const d = ctl.dati;
  box.appendChild(el('p', 'wp-ac-note', acT('checkLead')));
  if (d.tetto) box.appendChild(el('p', 'wp-ac-note', acT('checkLeadCap')));

  const esito = el('p', `wp-ac-esito ${d.violazioni ? 'wp-ac-esito-ko' : 'wp-ac-esito-ok'}`,
    d.violazioni ? acT('violations', { n: d.violazioni }) : acT('noViolations'));
  box.appendChild(esito);

  if (!d.archivioOk) box.appendChild(el('p', 'wp-ac-note', acT('archiveDown')));
  else if (d.coperturaDal && d.periodo.dal < d.coperturaDal) {
    box.appendChild(el('p', 'wp-ac-note', acT('coverage', { date: fmtData(d.coperturaDal) })));
  }

  if (!d.righe.length) {
    box.appendChild(el('p', 'wp-ac-note', acT('noBattles')));
  } else {
    const scroll = el('div', 'wp-ac-tabella-scroll');
    const t = el('table', 'wp-ac-tabella');
    const th = el('tr');
    const conEscluse = (a.muEscluse || []).length > 0;
    const colonne = ['colBattle', 'colWhen', 'colWho', 'colDmg'];
    if (conEscluse) colonne.push('colExcl', 'colNet');
    colonne.push('colEsito');
    for (const c of colonne) th.appendChild(el('th', null, acT(c)));
    const thead = el('thead'); thead.appendChild(th); t.appendChild(thead);
    const tbody = el('tbody');
    for (const r of d.righe) {
      const tr = el('tr', r.sforato || r.attaccoDiretto ? 'wp-ac-riga-ko' : '');
      // Battaglia: chi contro chi, la regione, il tipo.
      const tdB = el('td', 'wp-ac-cella-battaglia');
      const link = el('button', 'wp-ac-link', `${nomeNazione(r.attaccante)} → ${nomeNazione(r.difensore)}`);
      link.type = 'button';
      link.addEventListener('click', () => apriBattaglia(r));
      tdB.appendChild(link);
      const reg = state.regionData?.[r.regione]?.name;
      const sotto = [reg, r.tipo === 'resistance' ? acT('revolt') : null].filter(Boolean).join(' · ');
      if (sotto) tdB.appendChild(el('div', 'wp-ac-sub', sotto));
      tr.appendChild(tdB);
      tr.appendChild(el('td', 'wp-ac-cella-quando', r.inCorso ? acT('live') : fmtDataOra(r.fine)));
      tr.appendChild(el('td', null, nomeParte(r.chi === 'a' ? a.parteA : a.parteB)));
      tr.appendChild(el('td', 'wp-ac-num', r.danno == null ? acT('notRead') : fmtNum(r.danno)));
      if (conEscluse) {
        tr.appendChild(el('td', 'wp-ac-num', r.dannoEscluse == null ? acT('notRead') : fmtNum(r.dannoEscluse)));
        tr.appendChild(el('td', 'wp-ac-num', fmtNum(r.netto)));
      }
      const tdE = el('td', 'wp-ac-cella-esito');
      if (r.attaccoDiretto) tdE.appendChild(el('span', 'wp-ac-pill wp-ac-pill-ko', acT('directAttack')));
      if (r.sforato) tdE.appendChild(el('span', 'wp-ac-pill wp-ac-pill-ko', acT('overCap')));
      const limitata = d.tetto && (d.tetto.lato === 'entrambi' || d.tetto.lato === r.chi);
      if (!r.attaccoDiretto && !r.sforato) tdE.appendChild(el('span', 'wp-ac-pill', limitata ? acT('ok') : acT('info')));
      if (r.tagliata) tdE.title = acT('truncated');
      tr.appendChild(tdE);
      tbody.appendChild(tr);
    }
    t.appendChild(tbody);
    scroll.appendChild(t);
    box.appendChild(scroll);
  }

  const piede = [];
  if (d.battaglieCandidate > d.battaglieControllate) {
    piede.push(acT('checked', { n: d.battaglieControllate, m: d.battaglieCandidate }));
  }
  if ((a.muEscluse || []).length) piede.push(acT('estimate'));
  piede.push(acT('checkedAt', { time: new Date(d.calcolatoIl).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) }));
  box.appendChild(el('p', 'wp-ac-note', piede.join(' ')));
  return box;
}

async function apriBattaglia(r) {
  (await import('../app/accordiOverlay.js')).closeAccordiView();
  if (r.inCorso) {
    import('../diplomacy/battleMarkers.js').then(m => m.openBattleById(r.battaglia)).catch(() => {});
  } else {
    (await import('../app/battlesOverlay.js')).openBattlesView(r.battaglia);
  }
}

// ---------------------------------------------------------------------------
// Modulo
// ---------------------------------------------------------------------------

/** "YYYY-MM-DDTHH:MM" nell'ora locale, per <input type="datetime-local">. */
function perInput(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function daInput(v) {
  if (!v) return null;
  const n = new Date(v).getTime();
  return Number.isFinite(n) ? n : NaN;
}

function campo(etichetta, controllo, nota) {
  const c = el('label', 'wp-ac-campo');
  c.appendChild(el('span', 'wp-ac-etichetta', etichetta));
  c.appendChild(controllo);
  if (nota) c.appendChild(el('span', 'wp-ac-nota-campo', nota));
  return c;
}

function menuParti(tipo, scelto) {
  const s = el('select', 'wp-ac-input');
  const vuoto = el('option', null, acT(tipo === 'alleanza' ? 'pickAlliance' : 'pickNation'));
  vuoto.value = '';
  s.appendChild(vuoto);
  const voci = tipo === 'alleanza'
    ? (state.alliancesList || []).map(a => [a._id, a.name])
    : (state.nazioniGlobal || []).map(n => [n._id, n.name]);
  voci.sort((x, y) => String(x[1]).localeCompare(String(y[1])));
  for (const [id, nome] of voci) {
    const o = el('option', null, nome); o.value = id;
    if (id === scelto) o.selected = true;
    s.appendChild(o);
  }
  return s;
}

function apriModulo(a) {
  // Nazione–alleanza si scrive sempre con la nazione a sinistra: un patto
  // salvato al contrario si gira, e con lui il lato del tetto.
  let pA = a?.parteA || null;
  let pB = a?.parteB || null;
  let latoTetto = a?.tetto?.lato || 'a';
  if (pA?.tipo === 'alleanza' && pB?.tipo === 'nazione') {
    [pA, pB] = [pB, pA];
    latoTetto = latoTetto === 'a' ? 'b' : latoTetto === 'b' ? 'a' : latoTetto;
  }
  const coppia = !pA ? 'nn' : pA.tipo === 'alleanza' ? 'aa' : pB.tipo === 'alleanza' ? 'na' : 'nn';
  // Nuovo accordo: la prima parte è la nazione che si governa.
  if (!pA && poteri?.governa?.length) pA = { tipo: 'nazione', id: poteri.governa[0] };

  modulo = { id: a?.id || null };
  const escluse = new Map((a?.muEscluse || []).map(m => [m.id, m.nome]));

  elModulo.textContent = '';
  const f = el('form', 'wp-ac-card wp-ac-modulo');
  f.noValidate = true;
  f.appendChild(el('h2', 'wp-ac-h2', acT(a ? 'formEdit' : 'formNew')));

  // ── Tipo e parti ────────────────────────────────────────────────────
  const tipoSel = el('select', 'wp-ac-input');
  for (const [k, lbl] of [['nn', 'pairNN'], ['na', 'pairNA'], ['aa', 'pairAA']]) {
    const o = el('option', null, acT(lbl)); o.value = k;
    if (k === coppia) o.selected = true;
    tipoSel.appendChild(o);
  }
  const rigaParti = el('div', 'wp-ac-riga');
  let selA, selB;
  const tipiDi = (c) => (c === 'nn' ? ['nazione', 'nazione'] : c === 'na' ? ['nazione', 'alleanza'] : ['alleanza', 'alleanza']);
  function disegnaParti() {
    const [ta, tb] = tipiDi(tipoSel.value);
    const prevA = selA ? { tipo: selA.dataset.tipo, id: selA.value } : pA;
    const prevB = selB ? { tipo: selB.dataset.tipo, id: selB.value } : pB;
    selA = menuParti(ta, prevA?.tipo === ta ? prevA.id : '');
    selA.dataset.tipo = ta;
    selB = menuParti(tb, prevB?.tipo === tb ? prevB.id : '');
    selB.dataset.tipo = tb;
    rigaParti.textContent = '';
    rigaParti.append(campo(acT('sideA'), selA), campo(acT('sideB'), selB));
  }
  disegnaParti();
  tipoSel.addEventListener('change', disegnaParti);
  f.appendChild(campo(acT('pairType'), tipoSel));
  f.appendChild(rigaParti);

  // ── Testo ───────────────────────────────────────────────────────────
  const titolo = el('input', 'wp-ac-input');
  titolo.maxLength = 80;
  titolo.value = a?.titolo || '';
  f.appendChild(campo(acT('titleField'), titolo));

  const testo = el('textarea', 'wp-ac-input wp-ac-textarea');
  testo.rows = 6; testo.maxLength = 4000;
  testo.placeholder = acT('textPh');
  testo.value = a?.testo || '';
  f.appendChild(campo(acT('textField'), testo));

  // ── Date ────────────────────────────────────────────────────────────
  const rigaDate = el('div', 'wp-ac-riga');
  const inizio = el('input', 'wp-ac-input'); inizio.type = 'datetime-local';
  inizio.value = perInput(a?.inizio ?? Date.now());
  const fine = el('input', 'wp-ac-input'); fine.type = 'datetime-local';
  fine.value = perInput(a?.fine ?? null);
  rigaDate.append(campo(acT('startField'), inizio), campo(acT('endField'), fine, acT('endHint')));
  f.appendChild(rigaDate);

  // ── Unità escluse ───────────────────────────────────────────────────
  const boxMu = el('div', 'wp-ac-campo');
  boxMu.appendChild(el('span', 'wp-ac-etichetta', acT('musField')));
  const gettoni = el('div', 'wp-ac-gettoni');
  const disegnaGettoni = () => {
    gettoni.textContent = '';
    if (!escluse.size) { gettoni.appendChild(el('span', 'wp-ac-nota-campo', acT('musNone'))); return; }
    for (const [id, nome] of escluse) {
      const g = el('span', 'wp-ac-gettone');
      g.appendChild(el('span', null, nome || id));
      const x = bottone('wp-ac-gettone-x', '×', () => { escluse.delete(id); disegnaGettoni(); });
      x.title = acT('remove'); x.setAttribute('aria-label', acT('remove'));
      g.appendChild(x);
      gettoni.appendChild(g);
    }
  };
  disegnaGettoni();
  const cercaMu = el('input', 'wp-ac-input');
  cercaMu.type = 'search';
  cercaMu.placeholder = acT('musPh');
  const risultati = el('div', 'wp-ac-risultati');
  let attesa = null;
  let giro = 0;
  cercaMu.addEventListener('input', () => {
    clearTimeout(attesa);
    const q = cercaMu.value.trim();
    risultati.textContent = '';
    if (q.length < 3) return;
    risultati.appendChild(el('span', 'wp-ac-nota-campo', acT('searching')));
    const mio = ++giro;
    attesa = setTimeout(async () => {
      const trovate = await cercaUnita(q).catch(() => []);
      if (mio !== giro) return;
      risultati.textContent = '';
      if (!trovate.length) { risultati.appendChild(el('span', 'wp-ac-nota-campo', acT('noMatch'))); return; }
      for (const m of trovate) {
        risultati.appendChild(bottone('wp-ac-risultato', m.nome, () => {
          escluse.set(m.id, m.nome);
          cercaMu.value = ''; risultati.textContent = '';
          disegnaGettoni();
        }));
      }
    }, 500);
  });
  boxMu.append(gettoni, cercaMu, risultati);
  f.appendChild(boxMu);

  // ── Tetto ───────────────────────────────────────────────────────────
  const rigaTetto = el('div', 'wp-ac-riga');
  const danni = el('input', 'wp-ac-input');
  danni.type = 'number'; danni.min = '1'; danni.step = '1';
  danni.placeholder = acT('capPh');
  danni.value = a?.tetto?.danni ?? '';
  const lato = el('select', 'wp-ac-input');
  for (const [k, lbl] of [['a', 'capA'], ['b', 'capB'], ['entrambi', 'capBothOpt']]) {
    const o = el('option', null, acT(lbl)); o.value = k;
    if (k === latoTetto) o.selected = true;
    lato.appendChild(o);
  }
  rigaTetto.append(campo(acT('capField'), danni, acT('capHint')), campo(acT('capWho'), lato));
  f.appendChild(rigaTetto);

  // ── Esito e bottoni ─────────────────────────────────────────────────
  const msg = el('p', 'wp-ac-errore');
  msg.hidden = true;
  f.appendChild(msg);
  const azioni = el('div', 'wp-ac-azioni');
  const salva = el('button', 'wp-ac-btn wp-ac-btn-primary', acT('save'));
  salva.type = 'submit';
  azioni.append(salva, bottone('wp-ac-btn-quiet', acT('cancel'), chiudiModulo));
  f.appendChild(azioni);

  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.hidden = true;
    const corpo = {
      parteA: { tipo: selA.dataset.tipo, id: selA.value },
      parteB: { tipo: selB.dataset.tipo, id: selB.value },
      titolo: titolo.value,
      testo: testo.value,
      inizio: daInput(inizio.value),
      fine: daInput(fine.value),
      muEscluse: [...escluse].map(([id, nome]) => ({ id, nome })),
      tetto: danni.value ? { danni: Number(danni.value), lato: lato.value } : null,
    };
    // I controlli che il server farebbe comunque, detti prima e meglio.
    const errLocale = !corpo.parteA.id ? 'parte_a_non_valida'
      : !corpo.parteB.id ? 'parte_b_non_valida'
      : corpo.parteA.tipo === corpo.parteB.tipo && corpo.parteA.id === corpo.parteB.id ? 'parti_uguali'
      : !Number.isFinite(corpo.inizio) ? 'inizio_non_valido'
      : Number.isNaN(corpo.fine) ? 'fine_non_valida'
      : corpo.fine != null && corpo.fine <= corpo.inizio ? 'fine_prima_di_inizio'
      : null;
    if (errLocale) { msg.textContent = acErr(errLocale); msg.hidden = false; return; }
    if (!puoScrivere(corpo)) { msg.textContent = acT('youCantSides'); msg.hidden = false; return; }

    salva.disabled = true; salva.textContent = acT('saving');
    try {
      const r = modulo.id ? await modificaAccordo(modulo.id, corpo) : await creaAccordo(corpo);
      accordi = r.accordi || [];
      if (modulo.id) controlli.delete(modulo.id);
      impostaAccordiSullaMappa(accordi);
      trackEvent(modulo.id ? 'accordi-edit' : 'accordi-create', { tetto: Boolean(corpo.tetto) });
      chiudiModulo();
      disegnaLista();
    } catch (err) {
      msg.textContent = err instanceof ApiError ? acErr(err.codice) : acT('err_errore_server');
      msg.hidden = false;
      salva.disabled = false; salva.textContent = acT('save');
    }
  });

  elModulo.appendChild(f);
  disegnaBarra();
  f.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function chiudiModulo() {
  modulo = null;
  elModulo.textContent = '';
  disegnaBarra();
}
