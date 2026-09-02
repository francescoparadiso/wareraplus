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
  leggiCanale, impostaCanale, svuotaTavolo, ApiError,
} from './api.js';
import {
  preparaBattaglie, nomeNazione, caricaFinanziatori, finanziatoriDi,
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
  let caricamento = false;
  let errore = null;
  let apertaId = null;          // battaglia con il modulo aperto
  let occupato = false;
  // Tre sezioni invece di un elenco di schede tutte uguali: si arriva
  // qui per fare UNA cosa, e le altre due non devono essere in mezzo.
  let sezione = 'battaglie';    // 'battaglie' | 'tavolo' | 'impostazioni' | 'admin'
  let pannelloAdmin = null;
  // Le righe concluse restano nell'archivio ma non nel tavolo: si apre il
  // tavolo per vedere cosa aspetta una decisione, non cosa e' gia' finito.
  let mostraStorico = false;
  // Con quale cappello si sta guardando il tavolo. Chi ha un solo ruolo
  // non vede nemmeno la scelta: sarebbe una domanda con una risposta sola.
  let cappello = 'governo';     // 'governo' | 'comandante'

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

    const aperte = suoi.filter((r) => ['pending', 'approved'].includes(r.status));
    const chiuse = suoi.filter((r) => !['pending', 'approved'].includes(r.status));
    const daMostrare = mostraStorico ? suoi : aperte;

    // Barra dei comandi: lo storico si mostra a richiesta, e chi
    // amministra puo' svuotarlo.
    if (chiuse.length) {
      const barra = el('div', 'wp-pv-azioni');
      barra.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small',
        mostraStorico ? pvT('hideHistory') : `${pvT('showHistory')} (${chiuse.length})`,
        () => { mostraStorico = !mostraStorico; ctx.ridisegna(); }));

      if (cap.admin && !dati.lente) {
        barra.appendChild(bottone('wp-pv-btn-quiet wp-pv-btn-small', pvT('clearBoard'), () => {
          // Una conferma, perche' cancella davvero e non si torna indietro.
          // L'audit resta: chi ha chiesto e chi ha approvato non si perde
          // con la riga, ed e' quello il registro che conta.
          // eslint-disable-next-line no-alert
          if (!window.confirm(pvT('clearBoardConfirm'))) return;
          azione(async () => { await svuotaTavolo(); mostraStorico = false; });
        }));
      }
      card.appendChild(barra);
    }

    if (!daMostrare.length) { card.appendChild(el('p', 'wp-pv-note', pvT('empty'))); return card; }

    const lista = el('div', 'wp-pv-righe');
    for (const r of daMostrare) lista.appendChild(rigaRichiesta(r, cap));
    card.appendChild(lista);
    return card;
  }

  /** Le due linguette del tavolo, con il conteggio di cosa aspetta. */
  function scegliCappello(cap) {
    const barra = el('nav', 'wp-pv-cappelli');
    const conta = (f) => dati.richieste.filter((r) => f(r) && ['pending', 'approved'].includes(r.status)).length;
    const voci = [
      ['governo', pvT('hatGovernment'), conta((r) => cap.approvaPer?.includes(r.countryId))],
      ['comandante', pvT('hatCommander'), conta((r) => cap.chiedePer?.includes(r.muId))],
    ];
    for (const [chiave, testo, n] of voci) {
      const b = el('button', `wp-pv-cappello${cappello === chiave ? ' attivo' : ''}`);
      b.type = 'button';
      b.appendChild(el('span', null, testo));
      if (n) b.appendChild(el('span', 'wp-pv-cappello-n', String(n)));
      b.addEventListener('click', () => { cappello = chiave; mostraStorico = false; ctx.ridisegna(); });
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
    box.appendChild(testa);

    box.appendChild(el('div', 'wp-pv-req-battaglia', r.battleLabel || r.battleId));
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
      v.entryType === 'country' ? (nomeNazione(v.entryId) || v.entryId)
        : (ctx.nomeUnita?.(v.entryId) || v.entryId)));
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

    // Chi si ammette o si esclude si sceglie per NOME. Prima qui c'era un
    // campo "id (24 caratteri)": non diceva nemmeno di cosa, e chi lo
    // compilava lo copiava da un posto che non gli avevamo dato.
    const chi = creaSelettoreEntita({ tipi: ['country', 'mu'] });

    const modo = el('select', 'wp-pv-select');
    for (const [v, t] of [['allow', pvT('allow')], ['deny', pvT('deny')]]) {
      const o = el('option', null, t); o.value = v; modo.appendChild(o);
    }

    const nota = el('input', 'wp-pv-input');
    nota.type = 'text'; nota.placeholder = pvT('reasonPh'); nota.autocomplete = 'off';

    const salva = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', pvT('add'));
    salva.type = 'submit'; salva.disabled = occupato;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const entryId = chi.id();
      if (!entryId) return;
      azione(() => aggiungiAllaLista(countryId, {
        entryType: chi.tipo(), entryId,
        mode: modo.value, nota: nota.value.trim() || null,
      }));
    });

    form.appendChild(chi.wrap);
    const r = el('div', 'wp-pv-riga');
    r.appendChild(modo); r.appendChild(salva);
    form.appendChild(nota);
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
