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
  leggiCanale, impostaCanale, svuotaTavolo, elencoAlleanze, ApiError,
} from './api.js';
import {
  preparaBattaglie, indicizzaBattaglie, nomeNazione, urlBandiera,
  caricaFinanziatori, finanziatoriDi, finanziamentiRicevuti,
} from './battles.js';
import { creaPannelloAdmin } from './admin.js';
import { creaSelettoreEntita } from './selettori.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const num = (n) => (n == null ? '—' : Math.round(Number(n)).toLocaleString());

function bottone(cls, testo, onClick) {
  const b = el('button', `wp-pv-btn ${cls}`, testo);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

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
  let canali = new Map();       // "tipo:id" → { configurato }
  // I nomi delle alleanze: sedici righe, una fetch per sessione. Servono
  // alla lista permessi, che altrimenti direbbe "questa alleanza" e un id
  // di ventiquattro caratteri.
  let nomiAlleanze = new Map();
  let caricamento = false;
  let errore = null;
  let apertaId = null;          // battaglia con il modulo aperto
  let occupato = false;
  // Tre sezioni invece di un elenco di schede tutte uguali: si arriva
  // qui per fare UNA cosa, e le altre due non devono essere in mezzo.
  let sezione = 'battaglie';    // 'battaglie' | 'tavolo' | 'impostazioni' | 'admin'
  let pannelloAdmin = null;
  // Le battaglie vive indicizzate per id: il tavolo raggruppa le richieste
  // per battaglia, e per farlo deve sapere se quella battaglia e' ancora
  // aperta e come sta andando.
  let battaglieIdx = new Map();
  // Cosa mostrare del tavolo. Il predefinito e' "quello che aspetta": si
  // apre il tavolo per vedere cosa va deciso, non cosa e' gia' finito —
  // ma lo storico e' un filtro fra gli altri, non una porta separata.
  let filtroStato = 'attive';   // attive | pending | aperte | chiuse | tutte
  let ordine = 'costo';         // costo | danno | recente | attesa
  // Le battaglie richiuse a mano. Un insieme di chi e' CHIUSO e non di chi
  // e' aperto: cosi' una battaglia nuova arriva gia' aperta, che e' quello
  // che si vuole guardare.
  const gruppiChiusi = new Set();
  // Con quale cappello si sta guardando il tavolo. Chi ha un solo ruolo
  // non vede nemmeno la scelta: sarebbe una domanda con una risposta sola.
  let cappello = 'governo';     // 'governo' | 'comandante'

  async function carica() {
    caricamento = true; errore = null; ctx.ridisegna();
    const lente = ctx.lente();
    try {
      dati = await leggiTavolo({ asAccount: lente });

      const cap = dati.capacita || {};
      // Le battaglie servono a due mestieri diversi. Al comandante come
      // ELENCO di dove portare l'unita' — e li' ha senso solo per chi puo'
      // chiedere. Al ministro come CONTESTO delle righe che deve decidere:
      // un budget senza accanto la battaglia che lo giustifica e' una cifra
      // e basta. Per questo l'indice si costruisce sempre, e l'elenco no.
      if (cap.chiedePer?.length || cap.approvaPer?.length || cap.admin) {
        const [p, b] = await Promise.all([
          cap.chiedePer?.length
            ? nazioniAmmesse({ asAccount: lente }).catch(() => ({ countryIds: [] }))
            : Promise.resolve({ countryIds: [] }),
          battaglieInCorso().catch(() => []),
        ]);
        ammesse = new Set(p.countryIds || []);
        battaglieIdx = indicizzaBattaglie(b, ammesse);
        if (cap.chiedePer?.length) {
          battaglie = await preparaBattaglie(b, ammesse);
          // Le stesse battaglie, ma queste hanno dentro la taglia gia'
          // pagata: costa una batch sola ed e' utile anche al tavolo.
          for (const x of battaglie) battaglieIdx.set(x.id, x);
        }
        // Una fetch per sessione, non una per battaglia: si scarica la
        // lista globale dei bonifici e la si filtra in memoria.
        caricaFinanziatori().then(() => ctx.ridisegna());
      }

      // Le liste permessi delle nazioni che questa persona governa.
      liste = new Map();
      for (const cid of cap.gestisceNazione || []) {
        try { liste.set(cid, await leggiListaPermessi(cid, { asAccount: lente })); }
        catch { /* una lista che non si legge non deve rompere la vista */ }
      }

      // I nomi delle alleanze servono solo a chi ha una lista da leggere:
      // e' una fetch, e non si paga a chi non la usera'.
      if (liste.size && !nomiAlleanze.size) {
        try {
          nomiAlleanze = new Map((await elencoAlleanze()).map((a) => [a.id, a.nome]));
        } catch { /* si mostra l'id: brutto, ma non e' un guasto */ }
      }

      // I canali di avviso: uno per ogni nazione che governa e per ogni
      // unita' che comanda. Si legge solo SE e' configurato, mai l'URL —
      // contiene il token del canale, e chi lo legge puo' scriverci
      // dentro per sempre.
      canali = new Map();
      for (const [tipo, ids] of [['country', cap.gestisceNazione || []], ['mu', cap.chiedePer || []]]) {
        for (const id of ids) {
          try { canali.set(`${tipo}:${id}`, await leggiCanale(tipo, id)); }
          catch { /* idem */ }
        }
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
    try { return disegnaSezioni(); }
    catch (err) {
      // Un guasto in una sezione non deve portarsi via profilo e ruoli:
      // si perde la sezione, non la pagina.
      console.error('[tavolo] disegno fallito:', err);
      const f = document.createDocumentFragment();
      f.appendChild(el('p', 'wp-pv-error', pvT('errErrore_server')));
      f.appendChild(el('p', 'wp-pv-note', String(err?.message || err)));
      return f;
    }
  }

  function disegnaSezioni() {
    const frag = document.createDocumentFragment();

    if (!dati && !caricamento) carica();
    if (errore) frag.appendChild(el('p', 'wp-pv-error', errore));
    if (!dati) {
      if (caricamento) frag.appendChild(el('p', 'wp-pv-note', '…'));
      return frag;
    }

    const cap = dati.capacita || {};
    const puoChiedere = Boolean(cap.chiedePer?.length) && !dati.lente;
    const haImpostazioni = (liste.size || canali.size) && !dati.lente;

    const sezioni = [];
    if (puoChiedere) sezioni.push(['battaglie', pvT('battlesTitle')]);
    sezioni.push(['tavolo', pvT('boardTitle')]);
    if (haImpostazioni) sezioni.push(['impostazioni', pvT('settingsTitle')]);
    // L'amministrazione e' una sezione come le altre, ma compare solo a
    // chi lo e'. Sta QUI dentro e non in una vista a parte: e' lo stesso
    // posto, con una porta in piu' che per quasi tutti non esiste.
    // La voce nascosta non e' il permesso — il server rifiuta comunque —
    // ma non ha senso mostrare a tutti una porta che si apre per due.
    if (cap.admin && !dati.lente) sezioni.push(['admin', pvT('adminTitle')]);

    // Se la sezione scelta non esiste per questa persona si ricade sulla
    // prima disponibile: un ministro non ha le battaglie, un comandante
    // senza governo non ha le impostazioni.
    if (!sezioni.some(([k]) => k === sezione)) sezione = sezioni[0]?.[0] || 'tavolo';

    if (sezioni.length > 1) frag.appendChild(barraSezioni(sezioni));

    if (sezione === 'battaglie') frag.appendChild(cardBattaglie(cap));
    else if (sezione === 'tavolo') frag.appendChild(cardTavolo(cap));
    else if (sezione === 'admin') frag.appendChild(cardAdmin());
    else {
      for (const [cid, lista] of liste) frag.appendChild(cardLista(cid, lista));
      if (canali.size) frag.appendChild(cardCanali());
    }
    return frag;
  }

  function barraSezioni(sezioni) {
    const barra = el('nav', 'wp-pv-sezioni');
    for (const [chiave, testo] of sezioni) {
      const b = el('button', `wp-pv-sezione${sezione === chiave ? ' attiva' : ''}`, testo);
      b.type = 'button';
      b.addEventListener('click', () => { sezione = chiave; apertaId = null; ctx.ridisegna(); });
      barra.appendChild(b);
    }
    return barra;
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

    // ── Testa: la regione e il bottone ─────────────────────────────────
    const testa = el('div', 'wp-pv-btl-testa');
    testa.appendChild(el('span', 'wp-pv-btl-regione', b.regione || b.etichetta));
    if (b.taglia != null) {
      const t = el('span', 'wp-pv-btl-taglia');
      t.appendChild(el('span', 'wp-pv-label', pvT('bountyPaid')));
      t.appendChild(el('strong', null, num(b.taglia)));
      testa.appendChild(t);
    }
    box.appendChild(testa);

    // ── I due schieramenti, con bandiera, colore e danno ───────────────
    // Il colore e' quello con cui la nazione e' dipinta sulla mappa: qui
    // non si inventa una tavolozza nuova, si riusa quella che l'utente
    // ha gia' negli occhi.
    const massimo = Math.max(1, ...b.parti.map((p) => p.danno));
    const parti = el('div', 'wp-pv-btl-parti');
    for (const p of b.parti) {
      const riga = el('div', `wp-pv-btl-parte${p.ammessa ? '' : ' esclusa'}`);

      const capo = el('div', 'wp-pv-btl-capo');
      if (p.bandiera) {
        const f = el('img', 'wp-pv-btl-bandiera');
        f.src = p.bandiera; f.alt = ''; f.loading = 'lazy';
        f.addEventListener('error', () => { f.style.display = 'none'; });
        capo.appendChild(f);
      }
      // La tinta della nazione sta in un trattino, non nel testo: quei
      // colori nascono per riempire i poligoni della mappa e come testo
      // su fondo scuro diventano illeggibili (un rosso cupo su nero non
      // si legge). Qui fanno il loro mestiere senza costare leggibilita'.
      if (p.colore) {
        const tinta = el('span', 'wp-pv-btl-tinta');
        tinta.style.background = p.colore;
        capo.appendChild(tinta);
      }
      capo.appendChild(el('strong', 'wp-pv-btl-nazione', p.nome || p.countryId));
      capo.appendChild(el('span', 'wp-pv-btl-lato',
        p.side === 'attacker' ? pvT('sideAttacker') : pvT('sideDefender')));
      riga.appendChild(capo);

      // Una barra al posto di un secondo numero: "chi sta picchiando di
      // piu'" si legge dalla lunghezza prima che dalla cifra.
      const barra = el('div', 'wp-pv-btl-barra');
      const dentro = el('div', 'wp-pv-btl-barra-piena');
      dentro.style.width = `${Math.round((p.danno / massimo) * 100)}%`;
      if (p.colore) dentro.style.background = p.colore;
      barra.appendChild(dentro);
      riga.appendChild(barra);

      riga.appendChild(el('span', 'wp-pv-btl-danno', num(p.danno)));
      parti.appendChild(riga);
    }
    box.appendChild(parti);

    // ── Finanziatori ───────────────────────────────────────────────────
    const fin = finanziatoriDi(b);
    if (fin) box.appendChild(bloccoFinanziatori(fin));

    const azioni = el('div', 'wp-pv-azioni');
    const apri = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small',
      apertaId === b.id ? pvT('cancel') : pvT('askHere'));
    apri.type = 'button'; apri.disabled = occupato;
    apri.addEventListener('click', () => { apertaId = apertaId === b.id ? null : b.id; ctx.ridisegna(); });
    azioni.appendChild(apri);
    box.appendChild(azioni);

    if (apertaId === b.id) box.appendChild(moduloRichiesta(b, cap));
    return box;
  }

  /** Chi sta versando nel tesoro dei belligeranti mentre la battaglia e'
   *  aperta. Un tesoro che si riempie e' un tesoro che paghera'. */
  function bloccoFinanziatori(fin) {
    const box = el('div', 'wp-pv-btl-fin');
    box.appendChild(el('span', 'wp-pv-label', pvT('financiers')));

    if (fin.fuoriPortata) {
      // "Non lo sappiamo" non e' "nessuno": la copertura dell'API arriva
      // a ~3 giorni, e spacciare un buco per un fatto sarebbe una bugia.
      box.appendChild(el('span', 'wp-pv-btl-fin-nota', pvT('financiersOutOfRange')));
      return box;
    }
    if (!fin.perParte.length) {
      box.appendChild(el('span', 'wp-pv-btl-fin-nota', pvT('financiersNone')));
      return box;
    }

    for (const p of fin.perParte) {
      const riga = el('div', 'wp-pv-btl-fin-riga');
      const chi = el('span', 'wp-pv-btl-fin-verso');
      if (p.colore) {
        const tinta = el('span', 'wp-pv-btl-tinta');
        tinta.style.background = p.colore;
        chi.appendChild(tinta);
      }
      chi.appendChild(el('strong', null, p.nome || p.countryId));
      riga.appendChild(chi);
      const voci = el('span', 'wp-pv-btl-fin-voci',
        p.voci.map((v) => `${nomeNazione(v.from) || '?'} ${num(v.money)}`).join(' · '));
      riga.appendChild(voci);
      box.appendChild(riga);
    }
    return box;
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

    // ── Danno minimo ───────────────────────────────────────────────────
    // A mano ci si perde uno zero, e cinque milioni al posto di cinquecento
    // mila e' una richiesta che il ministro rifiuta senza capire perche'.
    // Scalini per i tagli usuali, campo libero per il resto, e il numero
    // riscritto per esteso sotto: uno zero di troppo si vede.
    const danno = campo('number', pvT('minDamage'), '1000000', { obbligatorio: true });
    // ⚠️ `step` in HTML non e' solo l'incremento delle frecce: VINCOLA la
    // validazione. Con step=100000 e min=1 i valori accettati diventano
    // 1, 100001, 200001... e 2.000.000 veniva rifiutato con "i due valori
    // validi piu' vicini sono 1900001 e 2000001". Gli scalini qui sotto
    // fanno gia' il lavoro delle frecce, senza vincolare niente.
    danno.input.step = 'any';
    danno.input.min = '1000';

    const scalini = el('div', 'wp-pv-scalini');
    scalini.appendChild(el('span', 'wp-pv-label', pvT('damagePreset')));
    const bottoniScalini = el('div', 'wp-pv-scalini-riga');
    for (const v of [500000, 1000000, 2000000, 5000000, 10000000]) {
      const b2 = el('button', 'wp-pv-scalino', v >= 1000000 ? `${v / 1000000}M` : `${v / 1000}k`);
      b2.type = 'button';
      b2.addEventListener('click', () => { danno.input.value = String(v); aggiornaTotale(); });
      bottoniScalini.appendChild(b2);
    }
    scalini.appendChild(bottoniScalini);

    // ── Taglia per 1000 danni ──────────────────────────────────────────
    // E' la grandezza con cui si ragiona nel gioco (initialPerK), non il
    // totale: si muove fra 0,01 e 0,2, quindi serve il decimale.
    const taglia = campo('number', pvT('bountyL'), '0.08', { obbligatorio: true });
    // Stessa ragione: con step=0.01 una taglia di 0,015 verrebbe rifiutata.
    // Il range si dichiara con min e max, che non vincolano i decimali.
    taglia.input.step = 'any';
    taglia.input.min = '0.001';
    taglia.input.max = '5';
    taglia.wrap.appendChild(el('span', 'wp-pv-suggerimento', pvT('bountyHint')));

    // Il totale non si chiede, si calcola: e' il numero che esce davvero
    // dal tesoro, ed e' guardandolo che ci si accorge dello zero di troppo.
    const totale = el('div', 'wp-pv-totale');
    const totaleVal = el('strong', 'wp-pv-totale-val', '—');
    totale.appendChild(el('span', 'wp-pv-label', pvT('totalBudget')));
    totale.appendChild(totaleVal);
    totale.appendChild(el('span', 'wp-pv-suggerimento', pvT('totalBudgetHint')));

    function budgetCalcolato() {
      const d = Number(danno.input.value) || 0;
      const t = Number(taglia.input.value) || 0;
      return (d / 1000) * t;
    }
    function aggiornaTotale() {
      const v = budgetCalcolato();
      totaleVal.textContent = v > 0 ? v.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—';
    }
    danno.input.addEventListener('input', aggiornaTotale);
    taglia.input.addEventListener('input', aggiornaTotale);
    aggiornaTotale();

    const nota = campo('text', pvT('noteL'), pvT('notePh'));

    // ── Solo professioniste ────────────────────────────────────────────
    // Non una spunta muta: e' la sola difesa tecnica contro il furto del
    // contratto, e chi non sa cosa fa non la usa.
    const pro = el('label', 'wp-pv-opzione');
    const proBox = el('input'); proBox.type = 'checkbox';
    pro.appendChild(proBox);
    const proTesti = el('span', 'wp-pv-opzione-testi');
    proTesti.appendChild(el('strong', null, pvT('proOnly')));
    proTesti.appendChild(el('span', 'wp-pv-suggerimento', pvT('proOnlyHint')));
    pro.appendChild(proTesti);

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
          // Si manda il totale calcolato, che e' cio' che l'asta vuole, e
          // anche la tariffa: il tavolo mostra quella, il gioco quello.
          budget: budgetCalcolato() || null,
          perK: Number(taglia.input.value) || null,
          professionalsOnly: proBox.checked,
          note: nota.input.value.trim() || null,
        });
        apertaId = null;
      });
    });

    form.appendChild(etichetta(pvT('side'), lato));
    form.appendChild(etichetta(pvT('unit'), unita));
    form.appendChild(danno.wrap);
    form.appendChild(scalini);
    form.appendChild(taglia.wrap);
    form.appendChild(totale);
    form.appendChild(nota.wrap);
    form.appendChild(pro);
    form.appendChild(invia);
    return form;
  }

  // ── Tavolo ───────────────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  // UNA BATTAGLIA, UNA SCHEDA
  // ------------------------------------------------------------------
  // Il tavolo era un elenco piatto di richieste, ordinato per niente.
  // Funzionava finché ce n'erano tre. Un capo di stato però non decide
  // una richiesta per volta: decide UNA BATTAGLIA — quante unità ci
  // stanno andando, quanto gli costerebbe dire di sì a tutte, quanto ha
  // già messo sul tavolo e quanto gliel'hanno pagato gli alleati. Quelle
  // quattro cifre, sparse su righe scollegate, non le somma nessuno a
  // mente.
  //
  // Quindi: le richieste si raggruppano per battaglia, ogni gruppo porta
  // i suoi totali, e i totali di tutte le battaglie stanno in cima.
  //
  // ⚠️ I QUATTRO NUMERI NON SONO LA STESSA COSA, e restano distinti anche
  // dove sommarli sarebbe comodo:
  //   · in attesa   quanto costerebbe approvare tutto quello che aspetta
  //   · approvato   detto sì, asta non ancora aperta: impegnato, non uscito
  //   · aperto      messo davvero all'asta — il valore VERO se lo sappiamo
  //                 (`apertBudget`), perché un contratto quasi mai combacia
  //                 con la richiesta: si chiedono 4M a 0,10 e se ne aprono
  //                 3,9M a 0,08
  //   · ricevuto    arrivato nel tesoro da altre nazioni mentre la
  //                 battaglia era aperta
  // Il quarto NON è una spesa e non va sottratto dagli altri: è un fatto
  // che sta accanto, e chi guarda decide da sé se si compensano.
  // ══════════════════════════════════════════════════════════════════

  const APERTI = ['pending', 'approved'];

  /** I soldi di un insieme di righe, nei tre stati che non si sommano. */
  function soldiDi(righe) {
    let attesa = 0; let approvato = 0; let aperto = 0;
    for (const r of righe) {
      const b = Number(r.budget) || 0;
      // Aperta all'asta: conta come è stata aperta DAVVERO, quando lo
      // sappiamo. È il secondo numero quello che esce dal tesoro.
      if (r.openedAt) aperto += (r.apertBudget != null ? Number(r.apertBudget) : b);
      else if (r.status === 'approved') approvato += b;
      else if (r.status === 'pending') attesa += b;
    }
    return { attesa, approvato, aperto };
  }

  /** Quanto è arrivato da altre nazioni, senza contare due volte la stessa
   *  coppia battaglia+nazione: due richieste sulla stessa battaglia
   *  guardano lo stesso tesoro e la stessa finestra. */
  function ricevutoDi(righe) {
    const viste = new Set();
    let totale = 0; let noto = false; let fuoriPortata = false;
    for (const r of righe) {
      const chiave = `${r.battleId}:${r.countryId}`;
      if (viste.has(chiave)) continue;
      viste.add(chiave);
      const b = battaglieIdx.get(r.battleId);
      // Battaglia non più fra le vive: non sappiamo quando è cominciata,
      // quindi non sappiamo su che finestra guardare. Zero sarebbe una
      // bugia — si dichiara che manca.
      if (!b?.inizio) { fuoriPortata = true; continue; }
      const f = finanziamentiRicevuti(r.countryId, b.inizio, Date.now());
      if (!f) continue;
      noto = true;
      if (f.fuoriPortata) fuoriPortata = true;
      totale += f.totale;
    }
    return { totale, noto, fuoriPortata };
  }

  const inGioco = (r) => Boolean(r.openedAt) && r.status !== 'closed';
  const chiusa = (r) => !APERTI.includes(r.status);

  const FILTRI = [
    ['attive', 'fltActive', (r) => APERTI.includes(r.status)],
    ['pending', 'fltPending', (r) => r.status === 'pending'],
    ['aperte', 'fltOpened', inGioco],
    ['chiuse', 'fltClosed', chiusa],
    ['tutte', 'fltAll', () => true],
  ];

  function cardTavolo(cap) {
    const card = el('div', 'wp-pv-card wp-pv-card-tavolo');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('boardTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('boardBody')));

    // ── Due mestieri, due elenchi ──────────────────────────────────────
    // Chi comanda un'unita' E siede in un governo vedeva le stesse righe
    // per due ragioni diverse, senza sapere quale: "l'ho chiesta io" e
    // "devo deciderla io" sono domande opposte, e mescolarle rende il
    // tavolo illeggibile proprio a chi ne ha piu' bisogno.
    const comeComandante = (r) => cap.chiedePer?.includes(r.muId);
    const comeGoverno = (r) => cap.approvaPer?.includes(r.countryId);

    const haDueCappelli = Boolean(cap.chiedePer?.length) && Boolean(cap.approvaPer?.length);
    if (!haDueCappelli) cappello = cap.approvaPer?.length ? 'governo' : 'comandante';

    // Un amministratore senza lente vede tutto: non e' un cappello, e'
    // l'assenza di cappelli.
    const suoi = cap.admin && !dati.lente && !haDueCappelli
      ? dati.richieste
      : dati.richieste.filter(cappello === 'governo' ? comeGoverno : comeComandante);

    // `card`, non `frag`: quest'ultimo esiste solo in render(), e qui
    // dentro nominarlo faceva lanciare tutta la vista — schermata vuota
    // appena si apriva il tavolo.
    if (haDueCappelli) card.appendChild(scegliCappello(cap));

    // I totali si calcolano su TUTTE le righe di questo cappello, non su
    // quelle filtrate: "quanto ho speso" non deve cambiare perché sto
    // guardando solo quelle che aspettano.
    card.appendChild(strisciaTotali(suoi));
    card.appendChild(barraFiltri(suoi, cap));

    const filtro = (FILTRI.find(([k]) => k === filtroStato) || FILTRI[0])[2];
    const visibili = suoi.filter(filtro);
    if (!visibili.length) {
      card.appendChild(el('p', 'wp-pv-note', suoi.length ? pvT('noneForFilter') : pvT('empty')));
      return card;
    }

    const gruppi = raggruppa(visibili);
    const lista = el('div', 'wp-pv-gruppi');
    for (const g of gruppi) lista.appendChild(cardGruppo(g, cap));
    card.appendChild(lista);
    return card;
  }

  /** I quattro numeri in cima: cosa aspetta, cosa è impegnato, cosa è
   *  uscito, cosa è arrivato. */
  function strisciaTotali(righe) {
    const { attesa, approvato, aperto } = soldiDi(righe);
    const ric = ricevutoDi(righe);

    const box = el('div', 'wp-pv-totali');
    const voce = (chiave, valore, cls, suggerimento) => {
      const v = el('div', `wp-pv-totale-voce${cls ? ` ${cls}` : ''}`);
      v.appendChild(el('span', 'wp-pv-label', pvT(chiave)));
      v.appendChild(el('strong', 'wp-pv-totale-val', valore));
      if (suggerimento) v.appendChild(el('span', 'wp-pv-suggerimento', suggerimento));
      box.appendChild(v);
    };

    voce('sumWaiting', num(attesa), 'wp-pv-totale-attesa', pvT('sumWaitingHint'));
    voce('sumApproved', num(approvato));
    voce('sumOpened', num(aperto), null, pvT('sumOpenedHint'));
    // "Non lo sappiamo" e "nessuno ha mandato niente" non disegnano lo
    // stesso zero: il primo è un buco di copertura dell'archivio bonifici.
    voce('sumReceived', ric.noto ? num(ric.totale) : '—', 'wp-pv-totale-ric',
      ric.fuoriPortata ? pvT('receivedPartial') : null);
    return box;
  }

  /** Le linguette di stato con quanto c'è dietro ciascuna, l'ordinamento
   *  e — a chi amministra — lo svuota-tavolo. */
  function barraFiltri(righe, cap) {
    const barra = el('div', 'wp-pv-barra-filtri');

    const chip = el('div', 'wp-pv-chip-riga');
    for (const [chiave, etich, fn] of FILTRI) {
      const n = righe.filter(fn).length;
      const b = el('button', `wp-pv-chip${filtroStato === chiave ? ' attivo' : ''}`);
      b.type = 'button';
      b.appendChild(el('span', null, pvT(etich)));
      b.appendChild(el('span', 'wp-pv-chip-n', String(n)));
      // Una linguetta vuota si mostra ma non si preme: toglierla farebbe
      // ballare la barra ad ogni cambio di stato, e cercare "chiuse" dove
      // ieri stava è peggio che trovarla spenta.
      b.disabled = !n && chiave !== 'tutte';
      b.addEventListener('click', () => { filtroStato = chiave; ctx.ridisegna(); });
      chip.appendChild(b);
    }
    barra.appendChild(chip);

    const coda = el('div', 'wp-pv-barra-coda');
    const ord = el('select', 'wp-pv-select wp-pv-select-piccola');
    for (const [v, k] of [['costo', 'sortCost'], ['danno', 'sortDamage'],
      ['attesa', 'sortWaiting'], ['recente', 'sortRecent']]) {
      const o = el('option', null, pvT(k)); o.value = v;
      if (ordine === v) o.selected = true;
      ord.appendChild(o);
    }
    ord.addEventListener('change', () => { ordine = ord.value; ctx.ridisegna(); });
    coda.appendChild(etichetta(pvT('sortLabel'), ord));

    if (cap.admin && !dati.lente && righe.some(chiusa)) {
      coda.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('clearBoard'), () => {
        // Una conferma, perche' cancella davvero e non si torna indietro.
        // L'audit resta: chi ha chiesto e chi ha approvato non si perde
        // con la riga, ed e' quello il registro che conta.
        // eslint-disable-next-line no-alert
        if (!window.confirm(pvT('clearBoardConfirm'))) return;
        azione(async () => { await svuotaTavolo(); filtroStato = 'attive'; });
      }));
    }
    barra.appendChild(coda);
    return barra;
  }

  /** Le righe in gruppi per battaglia, già ordinati. */
  function raggruppa(righe) {
    const m = new Map();
    for (const r of righe) {
      let g = m.get(r.battleId);
      if (!g) {
        g = {
          battleId: r.battleId,
          etichetta: r.battleLabel || r.battleId,
          viva: battaglieIdx.get(r.battleId) || null,
          righe: [],
        };
        m.set(r.battleId, g);
      }
      g.righe.push(r);
    }

    const gruppi = [...m.values()];
    for (const g of gruppi) {
      g.soldi = soldiDi(g.righe);
      g.ricevuto = ricevutoDi(g.righe);
      g.impegnato = g.soldi.attesa + g.soldi.approvato + g.soldi.aperto;
      g.inAttesa = g.righe.filter((r) => r.status === 'pending').length;
      g.ultima = Math.max(...g.righe.map((r) => r.createdAt || 0));
      // L'etichetta salvata nella richiesta è di quando è stata scritta;
      // se la battaglia è ancora viva quella di adesso è più giusta.
      if (g.viva?.etichetta) g.etichetta = g.viva.etichetta;
    }

    const per = {
      costo: (x, y) => y.impegnato - x.impegnato,
      danno: (x, y) => (y.viva?.danno ?? -1) - (x.viva?.danno ?? -1),
      attesa: (x, y) => (y.inAttesa - x.inAttesa) || (y.impegnato - x.impegnato),
      recente: (x, y) => y.ultima - x.ultima,
    };
    return gruppi.sort(per[ordine] || per.costo);
  }

  function cardGruppo(g, cap) {
    const chiuso = gruppiChiusi.has(g.battleId);
    const box = el('div', `wp-pv-gruppo${chiuso ? ' chiuso' : ''}`);

    // ── Testa: cliccabile per aprire e chiudere ────────────────────────
    const testa = el('button', 'wp-pv-gruppo-testa');
    testa.type = 'button';
    testa.setAttribute('aria-expanded', String(!chiuso));
    testa.addEventListener('click', () => {
      if (chiuso) gruppiChiusi.delete(g.battleId); else gruppiChiusi.add(g.battleId);
      ctx.ridisegna();
    });

    testa.appendChild(el('span', 'wp-pv-gruppo-freccia', chiuso ? '▸' : '▾'));
    testa.appendChild(el('span', 'wp-pv-gruppo-nome', g.etichetta));
    // Se la battaglia non è più fra le vive lo si dice: le cifre sotto
    // restano vere, ma "ci sto ancora dentro" non lo è più.
    testa.appendChild(el('span', `wp-pv-badge${g.viva ? ' wp-pv-badge-ok' : ''}`,
      g.viva ? pvT('battleLive') : pvT('battleOver')));
    testa.appendChild(el('span', 'wp-pv-gruppo-n', `${g.righe.length} · ${pvT('reqCount')}`));
    if (chiuso && g.impegnato) {
      // Richiuso, resta almeno la cifra: è quella che fa decidere se
      // riaprirlo.
      testa.appendChild(el('span', 'wp-pv-gruppo-tot', num(g.impegnato)));
    }
    box.appendChild(testa);

    if (chiuso) return box;

    // ── Come sta andando la battaglia ──────────────────────────────────
    // È la parte "seguire": chi sta picchiando, quanto, quanta taglia è
    // già uscita e chi sta finanziando. Solo se la battaglia è viva —
    // altrimenti sarebbero numeri fermi spacciati per attuali.
    if (g.viva) box.appendChild(bloccoAndamento(g.viva));

    // ── I soldi di QUESTA battaglia ────────────────────────────────────
    const soldi = el('div', 'wp-pv-gruppo-soldi');
    const voce = (chiave, valore, cls) => {
      const v = el('span', `wp-pv-gsoldo${cls ? ` ${cls}` : ''}`);
      v.appendChild(el('span', 'wp-pv-label', pvT(chiave)));
      v.appendChild(el('strong', null, valore));
      soldi.appendChild(v);
    };
    if (g.soldi.attesa) voce('sumWaiting', num(g.soldi.attesa), 'wp-pv-gsoldo-attesa');
    if (g.soldi.approvato) voce('sumApproved', num(g.soldi.approvato));
    if (g.soldi.aperto) voce('sumOpened', num(g.soldi.aperto));
    if (g.ricevuto.noto && g.ricevuto.totale) {
      voce('sumReceived', num(g.ricevuto.totale), 'wp-pv-gsoldo-ric');
    }
    if (soldi.children.length) box.appendChild(soldi);

    const righe = el('div', 'wp-pv-righe');
    for (const r of g.righe) righe.appendChild(rigaRichiesta(r, cap));
    box.appendChild(righe);
    return box;
  }

  /** Le due parti con bandiera, tinta della mappa e barra del danno.
   *  Stessa grammatica dell'elenco battaglie: un secondo modo di disegnare
   *  la stessa cosa sarebbe un secondo vocabolario da imparare. */
  function bloccoAndamento(b) {
    const box = el('div', 'wp-pv-gruppo-andamento');
    const massimo = Math.max(1, ...b.parti.map((p) => p.danno));
    for (const p of b.parti) {
      const riga = el('div', 'wp-pv-btl-parte');
      const capo = el('div', 'wp-pv-btl-capo');
      if (p.bandiera) {
        const f = el('img', 'wp-pv-btl-bandiera');
        f.src = p.bandiera; f.alt = ''; f.loading = 'lazy';
        f.addEventListener('error', () => { f.style.display = 'none'; });
        capo.appendChild(f);
      }
      if (p.colore) {
        const tinta = el('span', 'wp-pv-btl-tinta');
        tinta.style.background = p.colore;
        capo.appendChild(tinta);
      }
      capo.appendChild(el('strong', 'wp-pv-btl-nazione', p.nome || p.countryId));
      capo.appendChild(el('span', 'wp-pv-btl-lato',
        p.side === 'attacker' ? pvT('sideAttacker') : pvT('sideDefender')));
      riga.appendChild(capo);

      const barra = el('div', 'wp-pv-btl-barra');
      const dentro = el('div', 'wp-pv-btl-barra-piena');
      dentro.style.width = `${Math.round((p.danno / massimo) * 100)}%`;
      if (p.colore) dentro.style.background = p.colore;
      barra.appendChild(dentro);
      riga.appendChild(barra);
      riga.appendChild(el('span', 'wp-pv-btl-danno', num(p.danno)));
      box.appendChild(riga);
    }

    if (b.taglia != null) {
      const t = el('div', 'wp-pv-gruppo-taglia');
      t.appendChild(el('span', 'wp-pv-label', pvT('bountyPaid')));
      t.appendChild(el('strong', null, num(b.taglia)));
      t.appendChild(el('span', 'wp-pv-suggerimento', pvT('bountyPaidHint')));
      box.appendChild(t);
    }

    // Chi sta versando nel tesoro dei due belligeranti: la stessa cosa che
    // il comandante vede nell'elenco, qui accanto alle proprie spese.
    const fin = finanziatoriDi(b);
    if (fin) box.appendChild(bloccoFinanziatori(fin));
    return box;
  }

  /** Le due linguette del tavolo, con il conteggio di cosa aspetta. */
  function scegliCappello(cap) {
    const barra = el('nav', 'wp-pv-cappelli');
    const conta = (f) => dati.richieste.filter((r) => f(r) && APERTI.includes(r.status)).length;
    const voci = [
      ['governo', pvT('hatGovernment'), conta((r) => cap.approvaPer?.includes(r.countryId))],
      ['comandante', pvT('hatCommander'), conta((r) => cap.chiedePer?.includes(r.muId))],
    ];
    for (const [chiave, testo, n] of voci) {
      const b = el('button', `wp-pv-cappello${cappello === chiave ? ' attivo' : ''}`);
      b.type = 'button';
      b.appendChild(el('span', null, testo));
      if (n) b.appendChild(el('span', 'wp-pv-cappello-n', String(n)));
      b.addEventListener('click', () => { cappello = chiave; filtroStato = 'attive'; ctx.ridisegna(); });
      barra.appendChild(b);
    }
    return barra;
  }

  function rigaRichiesta(r, cap) {
    const box = el('div', `wp-pv-riga-req wp-pv-st-${r.status}`);

    const testa = el('div', 'wp-pv-req-testa');
    testa.appendChild(el('strong', 'wp-pv-req-mu', r.muNome || r.muId));
    testa.appendChild(el('span', 'wp-pv-req-stato',
      pvT(`st${r.status.charAt(0).toUpperCase()}${r.status.slice(1)}`)));
    // Dentro un gruppo per battaglia il NOME della battaglia sarebbe
    // ripetuto ad ogni riga; lo SCHIERAMENTO no — due unità sulla stessa
    // battaglia possono servire lati opposti, ed è l'unica cosa che
    // distingue le due righe.
    if (r.countryId) {
      testa.appendChild(el('span', 'wp-pv-req-lato', nomeNazione(r.countryId) || r.countryId));
    }
    box.appendChild(testa);

    box.appendChild(el('div', 'wp-pv-req-numeri',
      `${pvT('minDamage')} ${num(r.minDamage)}`
      + (r.perK ? ` · ${pvT('bountyL')} ${r.perK}` : '')
      + ` · ${pvT('totalBudget')} ${num(r.budget)}`
      + (r.professionalsOnly ? ` · ${pvT('proOnly')}` : '')));
    if (r.note) box.appendChild(el('div', 'wp-pv-req-nota', r.note));

    const due = el('div', 'wp-pv-req-due');
    const dette = el('div', 'wp-pv-req-col');
    if (r.richiedente) dette.appendChild(el('span', null, `${pvT('askedBy')} ${r.richiedente} · ${quando(r.createdAt)}`));
    if (r.approvatore) {
      // La colonna sul server si chiama `approved_by` ma ci scrive dentro
      // anche il rifiuto: e' `status` a dire in che verso e' andata. Una
      // richiesta rifiutata che compariva come "approvata da" era un bug
      // reale, segnalato guardando il tavolo.
      const verbo = r.status === 'rejected' ? pvT('rejectedBy') : pvT('approvedBy');
      dette.appendChild(el('span', null, `${verbo} ${r.approvatore} · ${quando(r.approvedAt)}`));
    }
    if (r.apritore) dette.appendChild(el('span', null, `${pvT('openedBy')} ${r.apritore} · ${quando(r.openedAt)}`));
    due.appendChild(dette);

    const fatti = el('div', 'wp-pv-req-col wp-pv-req-fatti');
    fatti.appendChild(el('span', 'wp-pv-label', pvT('outcome')));

    // Come e' stata aperta DAVVERO, quando non combacia con la richiesta.
    // Si chiedono 4M a 0,10 e se ne aprono 3,9 a 0,08: e' normale, e non
    // e' un'anomalia da segnalare — ma vederlo scritto dice piu' di
    // qualunque etichetta, e toglie il dubbio a chi rilegge fra un mese.
    const diverso = (r.apertMinDamage != null && r.apertMinDamage !== r.minDamage)
      || (r.apertBudget != null && Math.abs((r.apertBudget || 0) - (r.budget || 0)) > 0.01);
    if (diverso) {
      fatti.appendChild(el('span', 'wp-pv-scostamento',
        `${pvT('opened')} ${num(r.apertMinDamage)} · ${num(r.apertBudget)}`));
    }
    if (r.esito) {
      fatti.appendChild(el('strong', `wp-pv-esito wp-pv-esito-${r.esito}`,
        pvT(`es${r.esito.charAt(0).toUpperCase()}${r.esito.slice(1)}`)));
      if (r.winnerMu && r.esito === 'altra_unita') fatti.appendChild(el('span', null, r.winnerMu));
    } else {
      fatti.appendChild(el('span', 'wp-pv-esito-attesa', pvT('notVerifiedYet')));
    }
    due.appendChild(fatti);
    box.appendChild(due);

    // Approvare una richiesta della propria unita' e' legittimo — un
    // presidente che comanda anche una MU esiste — ma non deve passare
    // inosservato a chi rileggera' l'archivio.
    if (cap.chiedePer?.includes(r.muId) && cap.approvaPer?.includes(r.countryId)) {
      box.appendChild(el('p', 'wp-pv-req-doppio', pvT('bothHats')));
    }

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
    if (APERTI.includes(r.status) && (puoChiedere || puoApprovare)) {
      b(pvT('withdraw'), 'wp-pv-btn-quiet', () => ritiraRichiesta(r.id));
    }
    return azioni.children.length ? azioni : null;
  }

  // ── Lista permessi ───────────────────────────────────────────────────
  // ══════════════════════════════════════════════════════════════════
  // "CHI PUÒ BIDDARE PER ME" È LA DOMANDA, LE CORREZIONI SONO LA RISPOSTA
  // ------------------------------------------------------------------
  // Qui prima c'era solo il delta: due o tre righe di eccezioni e, sotto,
  // "niente aggiunto: vale il predefinito dell'alleanza". Corretto e
  // inutile — nessuno apre quella scheda per sapere quali eccezioni ha
  // scritto, la apre per sapere CHI può chiedergli dei soldi. Ricavarlo
  // voleva dire tenere a mente l'alleanza, incrociarla con gli allow e
  // sottrarre i deny: lavoro che il server fa una volta (`risolta`) e che
  // l'utente rifaceva ogni volta.
  //
  // Quindi due elenchi, in quest'ordine: prima chi può chiedere ADESSO,
  // poi — sotto, più piccole — le correzioni che ce l'hanno portato. E le
  // correzioni si scrivono a più voci per volta, perché una lista si
  // compila a blocchi ("questi sei alleati sì, quest'unità no") e farlo
  // una riga alla volta erano sei ricariche di pagina.
  // ══════════════════════════════════════════════════════════════════

  const VIE = {
    propria: 'viaOwn',
    alleanza: 'viaAlliance',
    aggiunta: 'viaAdded',
    alleanza_aggiunta: 'viaAllianceAdded',
  };

  function nomeAlleanza(id) {
    return (id && nomiAlleanze.get(id)) || null;
  }

  function cardLista(countryId, lista) {
    const card = el('div', 'wp-pv-card');
    const titolo = nomeNazione(countryId)
      ? `${pvT('listTitle')} — ${nomeNazione(countryId)}` : pvT('listTitle');
    card.appendChild(el('h2', 'wp-pv-h2', titolo));
    card.appendChild(el('p', 'wp-pv-body', pvT('listBody')));

    const r = lista.risolta;
    const modificabile = lista.puoiModificare && !dati.lente;

    // Un server non ancora rideployato non manda `risolta`: si degrada
    // alle sole correzioni invece di disegnare una scheda vuota.
    if (!r) card.appendChild(el('p', 'wp-pv-note', pvT('resolvedUnavailable')));
    else card.appendChild(bloccoRisolta(countryId, r, modificabile));

    const voci = lista.voci || [];
    const corr = el('div', 'wp-pv-correzioni');
    corr.appendChild(el('h3', 'wp-pv-h3', pvT('correctionsTitle')));
    if (!voci.length) corr.appendChild(el('p', 'wp-pv-note', pvT('listNoEntries')));
    else {
      const ul = el('div', 'wp-pv-lista');
      for (const v of voci) ul.appendChild(rigaLista(countryId, v, modificabile));
      corr.appendChild(ul);
    }
    card.appendChild(corr);

    if (modificabile) card.appendChild(moduloLista(countryId));
    else if (!lista.puoiModificare) card.appendChild(el('p', 'wp-pv-note', pvT('listCantEdit')));
    return card;
  }

  /** Chi può chiedere adesso: nazioni con accanto da dove viene il
   *  permesso, e le unità ammesse o escluse una per una. */
  function bloccoRisolta(countryId, r, modificabile) {
    const box = el('div', 'wp-pv-risolta');

    const testa = el('div', 'wp-pv-risolta-testa');
    testa.appendChild(el('h3', 'wp-pv-h3', pvT('whoCanBid')));
    testa.appendChild(el('span', 'wp-pv-badge', `${r.nazioni.length} · ${pvT('nationsN')}`));
    if (r.allianceId) {
      testa.appendChild(el('span', 'wp-pv-badge',
        nomeAlleanza(r.allianceId) || pvT('listDefault')));
    }
    box.appendChild(testa);
    box.appendChild(el('p', 'wp-pv-suggerimento', pvT('whoCanBidHint')));

    // Il filtro non ridisegna la vista: nasconde le tessere sul posto.
    // Ridisegnare ad ogni tasto premuto vorrebbe dire perdere il fuoco
    // del campo, che è il modo più veloce di rendere inusabile un filtro.
    const cerca = el('input', 'wp-pv-input wp-pv-input-filtro');
    cerca.type = 'search';
    cerca.placeholder = pvT('filterPh');
    cerca.autocomplete = 'off';
    box.appendChild(cerca);

    const griglia = el('div', 'wp-pv-tessere');
    const ordinate = [...r.nazioni].sort((a, b) => {
      // Sé stessi in cima, poi gli aggiunti singolarmente (sono le
      // decisioni prese a mano, quelle che uno rilegge), poi il resto in
      // ordine di nome.
      const peso = (x) => (x.via === 'propria' ? 0 : x.via === 'aggiunta' ? 1 : 2);
      return peso(a) - peso(b)
        || String(nomeNazione(a.countryId) || a.countryId)
          .localeCompare(String(nomeNazione(b.countryId) || b.countryId));
    });

    for (const n of ordinate) {
      const nome = nomeNazione(n.countryId) || n.nome || n.countryId;
      const t = el('div', `wp-pv-tessera wp-pv-via-${n.via}`);
      t.dataset.cerca = nome.toLowerCase();

      const bandiera = urlBandiera(n.countryId);
      if (bandiera) {
        const f = el('img', 'wp-pv-tessera-bandiera');
        f.src = bandiera; f.alt = ''; f.loading = 'lazy';
        f.addEventListener('error', () => { f.style.display = 'none'; });
        t.appendChild(f);
      }
      const testi = el('div', 'wp-pv-tessera-testi');
      testi.appendChild(el('strong', 'wp-pv-tessera-nome', nome));
      const via = el('span', 'wp-pv-tessera-via', pvT(VIE[n.via] || n.via));
      if (n.via === 'alleanza_aggiunta' && nomeAlleanza(n.allianceId)) {
        via.textContent = `${pvT('viaAllianceAdded')} · ${nomeAlleanza(n.allianceId)}`;
      }
      testi.appendChild(via);
      t.appendChild(testi);

      // L'azione dipende da COME è entrato: chi c'è per via dell'alleanza
      // si toglie escludendolo (un deny), chi è stato aggiunto a mano si
      // toglie cancellando la riga che l'ha messo. Sono due gesti diversi
      // e un bottone solo che li facesse entrambi mentirebbe su uno dei due.
      if (modificabile && n.via !== 'propria') {
        const azione2 = n.via === 'aggiunta'
          ? { testo: pvT('remove'), fn: () => togliDallaLista(countryId, [{ entryType: 'country', entryId: n.countryId }]) }
          : { testo: pvT('excludeThis'), fn: () => aggiungiAllaLista(countryId, [{ entryType: 'country', entryId: n.countryId, mode: 'deny', nome }]) };
        const b = el('button', 'wp-pv-tessera-via-btn', azione2.testo);
        b.type = 'button'; b.disabled = occupato;
        b.addEventListener('click', () => azione(azione2.fn));
        t.appendChild(b);
      }
      griglia.appendChild(t);
    }
    box.appendChild(griglia);

    const nessuno = el('p', 'wp-pv-note', pvT('noMatch'));
    nessuno.hidden = true;
    box.appendChild(nessuno);

    cerca.addEventListener('input', () => {
      const q = cerca.value.trim().toLowerCase();
      let visti = 0;
      for (const t of griglia.children) {
        const ok = !q || (t.dataset.cerca || '').includes(q);
        t.hidden = !ok;
        if (ok) visti += 1;
      }
      nessuno.hidden = visti > 0;
    });

    // ── Le unità, a parte ──────────────────────────────────────────────
    // Una nazione ammessa vale per tutte le sue unità; le voci `mu` sono
    // eccezioni puntuali. Mescolarle nello stesso elenco confonderebbe due
    // cose di scala diversa.
    for (const [titolo, elenco, modo] of [
      [pvT('unitsExtra'), r.unitaAmmesse, 'allow'],
      [pvT('unitsOut'), r.unitaEscluse, 'deny'],
    ]) {
      if (!elenco?.length) continue;
      const sez = el('div', `wp-pv-unita-extra wp-pv-lista-${modo}`);
      sez.appendChild(el('span', 'wp-pv-label', titolo));
      const riga = el('div', 'wp-pv-gettoni');
      for (const u of elenco) {
        const g = el('span', 'wp-pv-gettone wp-pv-gettone-mu');
        g.appendChild(el('span', 'wp-pv-gettone-nome',
          u.nome || ctx.nomeUnita?.(u.muId) || u.muId));
        if (modificabile) {
          const via = el('button', 'wp-pv-gettone-via', '×');
          via.type = 'button'; via.title = pvT('remove'); via.disabled = occupato;
          via.addEventListener('click', () => azione(() =>
            togliDallaLista(countryId, [{ entryType: 'mu', entryId: u.muId }])));
          g.appendChild(via);
        }
        riga.appendChild(g);
      }
      sez.appendChild(riga);
      box.appendChild(sez);
    }

    return box;
  }

  function rigaLista(countryId, v, modificabile) {
    const riga = el('div', `wp-pv-lista-riga wp-pv-lista-${v.mode}`);
    riga.appendChild(el('span', 'wp-pv-lista-modo',
      v.mode === 'allow' ? pvT('listAllowed') : pvT('listDenied')));
    riga.appendChild(el('span', 'wp-pv-lista-tipo',
      v.entryType === 'country' ? pvT('scopeCountry')
        : v.entryType === 'alliance' ? pvT('scopeAlliance') : pvT('scopeMu')));
    // Il nome com'era all'aggiunta è la sola cosa che il server sappia di
    // un'unità militare; per nazioni e alleanze si preferisce quello vivo,
    // che segue i cambi di nome del gioco.
    riga.appendChild(el('span', 'wp-pv-lista-chi',
      v.entryType === 'country' ? (nomeNazione(v.entryId) || v.nome || v.entryId)
        : v.entryType === 'alliance' ? (nomeAlleanza(v.entryId) || v.nome || v.entryId)
          : (v.nome || ctx.nomeUnita?.(v.entryId) || v.entryId)));
    if (v.nota) riga.appendChild(el('span', 'wp-pv-lista-nota', v.nota));

    if (modificabile) {
      const x = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('remove'));
      x.type = 'button'; x.disabled = occupato;
      x.addEventListener('click', () => azione(() =>
        togliDallaLista(countryId, [{ entryType: v.entryType, entryId: v.entryId }])));
      riga.appendChild(x);
    }
    return riga;
  }

  function moduloLista(countryId) {
    const form = el('form', 'wp-pv-form wp-pv-form-lista');
    form.appendChild(el('h3', 'wp-pv-h3', pvT('addTitle')));

    // Chi si ammette o si esclude si sceglie per NOME, e a più voci per
    // volta: nazioni, unità e alleanze anche mescolate, perché chi apre
    // questa scheda ha in testa un elenco di nomi, non tre elenchi divisi
    // per natura dell'oggetto.
    const chi = creaSelettoreEntita({ tipi: ['country', 'alliance', 'mu'], multiplo: true });

    const modo = el('select', 'wp-pv-select');
    for (const [v, t] of [['allow', pvT('allow')], ['deny', pvT('deny')]]) {
      const o = el('option', null, t); o.value = v; modo.appendChild(o);
    }

    const nota = el('input', 'wp-pv-input');
    nota.type = 'text'; nota.placeholder = pvT('reasonPh'); nota.autocomplete = 'off';

    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('addSelected'));
    salva.type = 'submit';
    // Il bottone dice quante ne sta per scrivere e resta spento finché non
    // c'è niente da scrivere: premere e non veder succedere niente è il
    // modo più veloce di far credere che il tool sia rotto.
    const aggiorna = (n) => {
      salva.disabled = occupato || !n;
      salva.textContent = n ? `${pvT('addSelected')} (${n})` : pvT('addSelected');
    };
    chi.onCambio(aggiorna);
    aggiorna(0);

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const scelte = chi.scelte();
      if (!scelte.length) return;
      const testoNota = nota.value.trim() || null;
      azione(async () => {
        await aggiungiAllaLista(countryId,
          scelte.map((v) => ({ ...v, mode: modo.value, nota: testoNota })));
        chi.svuota();
        nota.value = '';
      });
    });

    form.appendChild(chi.wrap);
    form.appendChild(nota);
    const r = el('div', 'wp-pv-riga');
    r.appendChild(etichetta(pvT('mode'), modo));
    r.appendChild(salva);
    form.appendChild(r);
    return form;
  }

  // ── Amministrazione ──────────────────────────────────────────────────
  function cardAdmin() {
    if (!pannelloAdmin) {
      pannelloAdmin = creaPannelloAdmin({
        ridisegna: ctx.ridisegna,
        // "Vedi come" e' della vista, non del pannello: cambia l'identita'
        // di tutta l'area riservata, non solo di questa sezione.
        apriComeAltri: (id) => ctx.apriComeAltri?.(id),
        // Una deroga appena concessa cambia i poteri: ruoli e tavolo vanno
        // riletti, altrimenti restano quelli di un minuto fa. Era un bug
        // reale — si concedeva una carica e il bottone non compariva.
        ruoliCambiati: async () => { await ctx.ruoliCambiati?.(); await carica(); },
      });
    }
    return pannelloAdmin.render();
  }

  // ── Canali Discord ───────────────────────────────────────────────────
  function cardCanali() {
    const card = el('div', 'wp-pv-card');
    card.appendChild(el('h2', 'wp-pv-h2', pvT('channelTitle')));
    card.appendChild(el('p', 'wp-pv-body', pvT('channelBody')));

    for (const [chiave, stato] of canali) {
      const [tipo, id] = chiave.split(':');
      card.appendChild(rigaCanale(tipo, id, stato));
    }
    return card;
  }

  function rigaCanale(tipo, id, stato) {
    const box = el('div', 'wp-pv-canale');

    const testa = el('div', 'wp-pv-canale-testa');
    testa.appendChild(el('strong', null,
      tipo === 'country' ? (nomeNazione(id) || id) : (ctx.nomeUnita?.(id) || id)));
    testa.appendChild(el('span', `wp-pv-badge${stato?.configurato ? ' wp-pv-badge-ok' : ''}`,
      stato?.configurato ? pvT('channelSet') : pvT('channelNone')));
    box.appendChild(testa);

    const form = el('form', 'wp-pv-riga');
    const url = el('input', 'wp-pv-input');
    url.type = 'url';
    url.placeholder = pvT('channelPh');
    url.autocomplete = 'off';

    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('channelSave'));
    salva.type = 'submit'; salva.disabled = occupato;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      azione(() => impostaCanale(tipo, id, url.value.trim()));
    });
    form.appendChild(url); form.appendChild(salva);

    if (stato?.configurato) {
      // Togliere = salvare vuoto: una sola strada lato server, e nessun
      // dubbio su cosa succede premendo.
      const via = el('button', 'wp-pv-btn wp-pv-btn-quiet wp-pv-btn-small', pvT('channelClear'));
      via.type = 'button'; via.disabled = occupato;
      via.addEventListener('click', () => azione(() => impostaCanale(tipo, id, '')));
      form.appendChild(via);
    }

    box.appendChild(form);
    return box;
  }

  function etichetta(testo, controllo) {
    const w = el('div', 'wp-pv-campo');
    w.appendChild(el('span', 'wp-pv-label', testo));
    w.appendChild(controllo);
    return w;
  }

  function campo(tipo, testo, placeholder, { obbligatorio = false } = {}) {
    const wrap = el('div', 'wp-pv-campo');
    const lab = el('span', 'wp-pv-label', testo);
    if (obbligatorio) lab.appendChild(el('span', 'wp-pv-obbligatorio', ` · ${pvT('required')}`));
    wrap.appendChild(lab);
    const input = el('input', 'wp-pv-input');
    input.type = tipo; input.placeholder = placeholder || ''; input.autocomplete = 'off';
    if (obbligatorio) input.required = true;
    wrap.appendChild(input);
    return { wrap, input };
  }

  return { render, ricarica: carica };
}
