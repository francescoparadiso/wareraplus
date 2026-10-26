/* ══════════════════════════════════════════════════════════════════════
   ACCORDI — l'archivio dei patti di non belligeranza
   ----------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): una sezione "Accordi" in
   Approfondimenti che faccia da ARCHIVIO dei NAP e li porti sulla MAPPA,
   con il testo del patto, inizio e fine, le unità militari che ne restano
   fuori e — quando il patto lo prevede — un tetto al danno che una parte
   può fare all'altra in una battaglia, controllato in automatico.

   ── LE PARTI ──────────────────────────────────────────────────────────
   Un patto è fra due PARTI, e ogni parte è una nazione o un'alleanza:
   nazione–nazione, nazione–alleanza, alleanza–alleanza. Di un'alleanza si
   salva l'id, non l'elenco dei membri: i membri si rileggono dal gioco
   (`allianceId` delle nazioni, la stessa fonte di nazioni.js) ogni volta.
   Chi entra nell'alleanza entra nel patto, chi esce esce — che è quello
   che un patto fra alleanze vuol dire.

   Dal 2026-10-26 ogni parte può avere anche NAZIONI AGGIUNTE (`a_extra`,
   `b_extra`): proxy e alleati che stanno fuori dall'alleanza ma dentro il
   patto. Contano come la parte in tutto — mappa, permessi, controllo. Una
   nazione non può stare da tutti e due i lati (`parti_sovrapposte`), ma lo
   si controlla al salvataggio: un'alleanza che dopo accoglie una nazione
   aggiunta dell'altro lato non invalida il patto, e la nazione si trova
   semplicemente su tutti e due.

   ── CHI LEGGE, CHI SCRIVE ─────────────────────────────────────────────
   LEGGERE è di tutti, senza login: è un archivio pubblico e la mappa lo
   disegna per chiunque. Per questo GET / e GET /:id/controllo stanno
   PRIMA di requireAuth.

   SCRIVERE (creare, cambiare, cancellare) è del governo — presidente,
   vice, ministri: `gestisceNazione`, le stesse cariche della lista
   permessi — di UNA DELLE NAZIONI COINVOLTE: le due nazioni, o i membri
   delle alleanze. Serve Discord con il personaggio collegato, come per il
   resto dell'area riservata, ma NON il filtro nazione (P.A.S.T.A.): un
   patto ha due parti, e la controparte deve poterlo scrivere quanto noi.
   Cambiare le parti di un patto esistente chiede di governare una nazione
   coinvolta sia PRIMA sia DOPO la modifica: altrimenti si potrebbe
   prendere il patto di altri e riscriverlo come proprio.

   ── IL CONTROLLO ──────────────────────────────────────────────────────
   GET /:id/controllo rilegge le battaglie del periodo del patto (archivio
   del cache-server, 90 giorni, più quelle in corso) e per ciascuna somma
   il danno dei cittadini di una parte sullo schieramento OPPOSTO a quello
   dell'altra (`battleRanking.getRanking` per nazione, pubblica). Due cose:
     · ATTACCO DIRETTO: una nazione di una parte ha aperto la battaglia
       contro una nazione dell'altra — è la violazione classica di un NAP;
     · TETTO: con un limite, il danno di quella parte supera il massimo.
   Le unità escluse dal patto si tolgono dal conto con la classifica per
   UNITÀ dello stesso schieramento. È una STIMA e la vista lo dice: la
   classifica per unità non dice di che nazionalità sono i membri, quindi
   si toglie tutto il danno dell'unità esclusa anche se dentro ci fosse
   qualche straniero.

   Senza tetto si guardano solo le battaglie DIRETTE fra le parti (chi ha
   colpito chi); con un tetto tutte quelle in cui l'altra parte è uno dei
   due schieramenti principali, perché il danno contro di lei si può fare
   anche da alleato di una terza nazione. Tetto alle battaglie lette per
   ogni controllo (MAX_BATTAGLIE), dichiarato nella risposta.

   ⚠️ Il giorno di una battaglia conclusa è quello della FINE (`e`
   dell'archivio): una battaglia cominciata prima del patto e finita dopo
   rientra. L'archivio non porta l'inizio.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { calcolaEffettivi } = require('./roles');
const { paesiMappa, battaglieVive, archivioBattaglie, dalCache, memo } = require('./fonti');
const { trpcBatch } = require('./wareraApi');
const {
  listaAccordi, contaAccordi, getAccordo, creaAccordo, aggiornaAccordo, eliminaAccordo,
  getAccountById, audit,
} = require('./db');

const ID_GIOCO = /^[a-f0-9]{24}$/i;
const TIPI_PARTE = new Set(['nazione', 'alleanza']);
const LATI_TETTO = new Set(['a', 'b', 'entrambi']);

// Tetti larghi per l'uso, stretti per l'abuso.
const MAX_ACCORDI = 2000;
const MAX_MU_ESCLUSE = 40;
const MAX_AGGIUNTE = 40;
const MAX_TESTO = 4000;
// Le date: un NAP non comincia prima che il gioco esistesse, e un "fine"
// fra dieci anni è quasi sempre un anno sbagliato nel campo.
const INIZIO_MINIMO = Date.UTC(2025, 0, 1);
const FUTURO_MASSIMO_MS = 5 * 365 * 24 * 3600_000;
// Battaglie lette per un controllo. Ogni battaglia conclusa si legge una
// volta sola per sempre (_classifiche): il costo vero è al primo controllo.
const MAX_BATTAGLIE = 120;
const PEZZO_BATCH = 12;

class Rifiuto extends Error {
  constructor(codice, stato = 400) { super(codice); this.codice = codice; this.stato = stato; }
}

// ---------------------------------------------------------------------------
// Le parti e le loro nazioni
// ---------------------------------------------------------------------------

/** id → nome delle alleanze, dal cache-server. Serve solo a sapere che
 *  un'alleanza esiste quando (caso raro) nessuna nazione la porta più. */
const alleanzeNote = memo(30 * 60_000, async () => {
  const body = await dalCache('/alliances', 20_000);
  return new Map((body?.data || []).map((a) => [a.allianceId, a.data?.name || a.allianceId]));
});

const tipoDb = (t) => (t === 'alleanza' ? 'alliance' : 'country');
const tipoApi = (t) => (t === 'alliance' ? 'alleanza' : 'nazione');

/** Le nazioni di una parte, adesso. */
async function nazioniDi(tipo, id) {
  if (tipo === 'country' || tipo === 'nazione') return [id];
  const paesi = await paesiMappa();
  return [...paesi.values()].filter((n) => n.allianceId === id).map((n) => n._id);
}

/** Le nazioni aggiunte a un lato, dal JSON salvato. */
function extraDi(json) {
  try { const v = json ? JSON.parse(json) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}

/** Tutte le nazioni di un lato del patto, adesso: la parte più le aggiunte.
 *  `lato` è 'a' o 'b' (le colonne a_type/a_id/a_extra…). */
async function nazioniLato(acc, lato) {
  const base = await nazioniDi(acc[`${lato}_type`], acc[`${lato}_id`]);
  return [...new Set([...base, ...extraDi(acc[`${lato}_extra`])])];
}

async function parteValida(v, codice) {
  if (!v || typeof v !== 'object') throw new Rifiuto(codice);
  const tipo = String(v.tipo || '');
  const id = String(v.id || '').trim();
  if (!TIPI_PARTE.has(tipo) || !ID_GIOCO.test(id)) throw new Rifiuto(codice);
  if (tipo === 'nazione') {
    if (!(await paesiMappa()).has(id)) throw new Rifiuto(codice);
  } else if (!(await nazioniDi('alliance', id)).length) {
    const note = await alleanzeNote().catch(() => new Map());
    if (!note.has(id)) throw new Rifiuto(codice);
  }
  // Le nazioni aggiunte: esistenti, senza doppioni, mai la parte stessa.
  const paesi = await paesiMappa();
  if (v.aggiunte != null && (!Array.isArray(v.aggiunte) || v.aggiunte.length > MAX_AGGIUNTE)) throw new Rifiuto(codice);
  const extra = [];
  for (const x of v.aggiunte || []) {
    const n = String(x || '').trim();
    if (!ID_GIOCO.test(n) || !paesi.has(n)) throw new Rifiuto(codice);
    if (n === id || extra.includes(n)) continue;
    extra.push(n);
  }
  return { tipo: tipoDb(tipo), id, extra };
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

/** Testo su più righe: si tengono gli a capo (è un patto, si legge per
 *  articoli), si tolgono i doppi vuoti e gli spazi in coda. */
function testoLungo(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim().slice(0, max);
  return s || null;
}

function testoBreve(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

function data(v, codice, { obbligatoria = false } = {}) {
  if (v == null || v === '') {
    if (obbligatoria) throw new Rifiuto(codice);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < INIZIO_MINIMO || n > Date.now() + FUTURO_MASSIMO_MS) throw new Rifiuto(codice);
  return Math.round(n);
}

function muEscluse(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.length > MAX_MU_ESCLUSE) throw new Rifiuto('unita_non_valide');
  const viste = new Set();
  const out = [];
  for (const m of v) {
    const id = String(m?.id || '').trim();
    if (!ID_GIOCO.test(id)) throw new Rifiuto('unita_non_valide');
    if (viste.has(id)) continue;
    viste.add(id);
    out.push({ id, nome: testoBreve(m?.nome, 60) });
  }
  return out.length ? JSON.stringify(out) : null;
}

function tetto(v) {
  if (v == null || v === '' || v.danni == null || v.danni === '') return { limit_damage: null, limit_side: null };
  const danni = Math.round(Number(v.danni));
  if (!Number.isFinite(danni) || danni < 1 || danni > 1e13) throw new Rifiuto('tetto_non_valido');
  const lato = String(v.lato || '');
  if (!LATI_TETTO.has(lato)) throw new Rifiuto('tetto_non_valido');
  return { limit_damage: danni, limit_side: lato };
}

/** I campi dal corpo. Sempre il patto INTERO: il modulo lo rimanda tutto,
 *  e un patto è un testo che si rilegge insieme, non campo per campo. */
async function campiAccordo(body) {
  const b = body || {};
  const a = await parteValida(b.parteA, 'parte_a_non_valida');
  const bb = await parteValida(b.parteB, 'parte_b_non_valida');
  if (a.tipo === bb.tipo && a.id === bb.id) throw new Rifiuto('parti_uguali');
  // Nessuna nazione da tutti e due i lati, contando le aggiunte e i membri
  // di adesso delle alleanze.
  const latoA = new Set([...(await nazioniDi(a.tipo, a.id)), ...a.extra]);
  for (const n of [...(await nazioniDi(bb.tipo, bb.id)), ...bb.extra]) {
    if (latoA.has(n)) throw new Rifiuto('parti_sovrapposte');
  }
  const inizio = data(b.inizio, 'inizio_non_valido', { obbligatoria: true });
  const fine = data(b.fine, 'fine_non_valida');
  if (fine != null && fine <= inizio) throw new Rifiuto('fine_prima_di_inizio');
  return {
    kind: 'nap',
    a_type: a.tipo, a_id: a.id,
    b_type: bb.tipo, b_id: bb.id,
    a_extra: a.extra.length ? JSON.stringify(a.extra) : null,
    b_extra: bb.extra.length ? JSON.stringify(bb.extra) : null,
    title: testoBreve(b.titolo, 80),
    body: testoLungo(b.testo, MAX_TESTO),
    starts_at: inizio,
    ends_at: fine,
    excluded_mus: muEscluse(b.muEscluse),
    ...tetto(b.tetto),
  };
}

// ---------------------------------------------------------------------------
// Permessi
// ---------------------------------------------------------------------------

/** Le nazioni che questa persona governa, più se è amministratore. */
async function poteri(req) {
  const chi = req.identita || req.account;
  const amministra = Boolean(req.account?.is_admin) && !req.lente;
  if (!chi?.war_user_id) return { verificato: false, amministra, governa: [], erroreGioco: null };
  const eff = await calcolaEffettivi(chi, {});
  return {
    verificato: true,
    amministra,
    governa: eff.capacita?.gestisceNazione || [],
    // Il gioco può non rispondere: si dice, invece di far sembrare che la
    // persona non abbia cariche.
    erroreGioco: eff.erroreGioco || null,
  };
}

async function governaUnaParte(p, accordo) {
  if (p.amministra) return true;
  const gov = new Set(p.governa);
  if (!gov.size) return false;
  // Le nazioni aggiunte sono parte del patto: il loro governo lo scrive
  // come quello della parte principale.
  const coinvolte = [...(await nazioniLato(accordo, 'a')), ...(await nazioniLato(accordo, 'b'))];
  return coinvolte.some((id) => gov.has(id));
}

async function soloChiGoverna(req, ...accordi) {
  const p = await poteri(req);
  if (!p.amministra && !p.verificato) throw new Rifiuto('non_verificato', 403);
  for (const acc of accordi) {
    if (!(await governaUnaParte(p, acc))) throw new Rifiuto('non_governi_una_parte', 403);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Forma esposta al client
// ---------------------------------------------------------------------------

const nomeAccount = (id) => {
  if (!id) return null;
  const a = getAccountById(id);
  return a ? (a.war_username || a.discord_username) : null;
};

function forma(r) {
  let mu = [];
  try { mu = r.excluded_mus ? JSON.parse(r.excluded_mus) : []; } catch { mu = []; }
  return {
    id: r.id,
    tipo: r.kind,
    parteA: { tipo: tipoApi(r.a_type), id: r.a_id, aggiunte: extraDi(r.a_extra) },
    parteB: { tipo: tipoApi(r.b_type), id: r.b_id, aggiunte: extraDi(r.b_extra) },
    titolo: r.title,
    testo: r.body,
    inizio: r.starts_at,
    fine: r.ends_at,
    muEscluse: mu,
    tetto: r.limit_damage ? { danni: r.limit_damage, lato: r.limit_side } : null,
    // Il nome di gioco di chi l'ha scritto: è un archivio pubblico, e "chi
    // l'ha messo qui" è la prima cosa da sapere di un patto che si legge.
    inseritoDa: nomeAccount(r.created_by),
    inseritoIl: r.created_at,
    aggiornatoDa: nomeAccount(r.updated_by),
    aggiornatoIl: r.updated_at,
  };
}

const elenco = () => listaAccordi().map(forma);

/** L'id dal percorso: solo cifre. Express 5 non accetta più le regex nei
 *  parametri, quindi il controllo sta qui. */
function idAccordo(v) {
  const s = String(v || '');
  if (!/^\d{1,9}$/.test(s)) throw new Rifiuto('accordo_sconosciuto', 404);
  return Number(s);
}

// ---------------------------------------------------------------------------
// Il controllo
// ---------------------------------------------------------------------------

// Classifiche delle battaglie CONCLUSE: non cambiano più, si leggono una
// volta. Quelle in corso durano due minuti. Tetto alla memoria: ~200 byte a
// voce, 6000 voci sono poco più di un MB.
const _classifiche = new Map(); // "battaglia|tipo|lato" → { at, chiusa, valori: Map, tagliata }
const MAX_VOCI_CLASSIFICHE = 6000;
const VIVA_MS = 2 * 60_000;

function fresca(v) {
  return v && (v.chiusa || Date.now() - v.at < VIVA_MS);
}

/** Legge in batch le classifiche mancanti. `richieste`: [{ battaglia,
 *  tipo: 'country'|'mu', lato, chiusa }]. Una richiesta fallita resta
 *  senza voce: la riga dirà "non letta" invece di "zero danni". */
async function leggiClassifiche(richieste) {
  const chiave = (r) => `${r.battaglia}|${r.tipo}|${r.lato}`;
  const mancanti = richieste.filter((r) => !fresca(_classifiche.get(chiave(r))));
  for (let i = 0; i < mancanti.length; i += PEZZO_BATCH) {
    const pezzo = mancanti.slice(i, i + PEZZO_BATCH);
    let risposte;
    try {
      risposte = await trpcBatch(pezzo.map((r) => ['battleRanking.getRanking',
        { battleId: r.battaglia, type: r.tipo, side: r.lato, dataType: 'damage', limit: 100 }]));
    } catch (err) {
      console.warn('[accordi] classifiche non lette:', err.message);
      continue;
    }
    pezzo.forEach((r, k) => {
      const res = risposte[k];
      if (!Array.isArray(res?.items)) return;
      const valori = new Map();
      for (const it of res.items) {
        const id = it[r.tipo];
        if (id) valori.set(id, (valori.get(id) || 0) + (Number(it.value) || 0));
      }
      _classifiche.set(chiave(r), { at: Date.now(), chiusa: r.chiusa, valori, tagliata: Boolean(res.nextCursor) });
    });
  }
  // Le più vecchie fuori per prime: una Map ricorda l'ordine di inserimento.
  while (_classifiche.size > MAX_VOCI_CLASSIFICHE) _classifiche.delete(_classifiche.keys().next().value);
  return (r) => _classifiche.get(chiave(r)) || null;
}

async function calcolaControllo(acc) {
  const A = new Set(await nazioniLato(acc, 'a'));
  const B = new Set(await nazioniLato(acc, 'b'));
  const ora = Date.now();
  const dal = acc.starts_at;
  const al = acc.ends_at || ora;
  const inVigore = acc.starts_at <= ora && (!acc.ends_at || acc.ends_at > ora);
  let escluse = [];
  try { escluse = acc.excluded_mus ? JSON.parse(acc.excluded_mus).map((m) => m.id) : []; } catch { escluse = []; }
  const setEscluse = new Set(escluse);

  // Battaglie del periodo: concluse dall'archivio, più quelle in corso se
  // il patto vale adesso. Un archivio che non risponde lascia le vive.
  let archivio = [];
  let archivioOk = true;
  try { archivio = await archivioBattaglie(); } catch { archivioOk = false; }
  const coperturaDal = archivio.reduce((m, r) => (r.e && r.e < m ? r.e : m), Infinity);
  const battaglie = archivio
    .filter((r) => r.e && r.e >= dal && r.e <= al)
    .map((r) => ({ id: r.i, tipo: r.t, fine: r.e, regione: r.r, ac: r.ac, dc: r.dc, inCorso: false }));
  if (inVigore) {
    const vive = await battaglieVive().catch(() => []);
    for (const b of vive || []) {
      if (!b?._id || battaglie.some((x) => x.id === b._id)) continue;
      battaglie.push({
        id: b._id, tipo: b.type, fine: null, inizio: Date.parse(b.createdAt) || null,
        regione: b.defender?.region || b.attacker?.region || null,
        ac: b.attacker?.country || null, dc: b.defender?.country || null, inCorso: true,
      });
    }
  }

  // Le direzioni da guardare: chi colpisce chi. Con un tetto, quella (o
  // quelle) che il patto limita; senza, entrambe, ma solo dirette.
  const conTetto = Boolean(acc.limit_damage);
  const direzioni = [];
  if (!conTetto || acc.limit_side === 'a' || acc.limit_side === 'entrambi') direzioni.push(['a', A, B]);
  if (!conTetto || acc.limit_side === 'b' || acc.limit_side === 'entrambi') direzioni.push(['b', B, A]);

  const candidati = [];
  for (const bt of battaglie) {
    for (const [chi, X, Y] of direzioni) {
      const yAttacca = Y.has(bt.ac) && !Y.has(bt.dc);
      const yDifende = Y.has(bt.dc) && !Y.has(bt.ac);
      if (!yAttacca && !yDifende) continue;
      const altro = yAttacca ? bt.dc : bt.ac;
      // Senza tetto conta solo lo scontro diretto fra le due parti.
      if (!conTetto && !X.has(altro)) continue;
      candidati.push({
        ...bt, chi, X,
        lato: yAttacca ? 'defender' : 'attacker',
        attaccoDiretto: X.has(bt.ac) && Y.has(bt.dc),
      });
    }
  }
  // In corso prima, poi dalla più recente.
  candidati.sort((x, y) => (y.inCorso - x.inCorso) || ((y.fine || 0) - (x.fine || 0)));
  const letti = candidati.slice(0, MAX_BATTAGLIE);

  const richieste = [];
  for (const c of letti) {
    richieste.push({ battaglia: c.id, tipo: 'country', lato: c.lato, chiusa: !c.inCorso });
    if (setEscluse.size) richieste.push({ battaglia: c.id, tipo: 'mu', lato: c.lato, chiusa: !c.inCorso });
  }
  const leggi = await leggiClassifiche(richieste);

  const righe = [];
  for (const c of letti) {
    const naz = leggi({ battaglia: c.id, tipo: 'country', lato: c.lato });
    const mu = setEscluse.size ? leggi({ battaglia: c.id, tipo: 'mu', lato: c.lato }) : null;
    let danno = null;
    let dannoEscluse = 0;
    if (naz) {
      danno = 0;
      for (const [id, v] of naz.valori) if (c.X.has(id)) danno += v;
    }
    if (mu) for (const [id, v] of mu.valori) if (setEscluse.has(id)) dannoEscluse += v;
    const netto = danno == null ? null : Math.max(0, danno - dannoEscluse);
    // Una battaglia in cui la parte non ha fatto niente e che nessuno ha
    // aperto contro l'altra è rumore: si conta, non si elenca.
    if (!c.attaccoDiretto && netto === 0) continue;
    const limiteQui = conTetto && (acc.limit_side === 'entrambi' || acc.limit_side === c.chi);
    righe.push({
      battaglia: c.id,
      tipo: c.tipo,
      inCorso: c.inCorso,
      fine: c.fine,
      inizio: c.inizio || null,
      regione: c.regione,
      attaccante: c.ac,
      difensore: c.dc,
      chi: c.chi,
      lato: c.lato,
      danno,
      dannoEscluse: setEscluse.size ? (mu ? dannoEscluse : null) : 0,
      netto,
      attaccoDiretto: c.attaccoDiretto,
      sforato: Boolean(limiteQui && netto != null && netto > acc.limit_damage),
      tagliata: Boolean(naz?.tagliata),
    });
  }

  return {
    accordo: acc.id,
    calcolatoIl: ora,
    periodo: { dal, al },
    tetto: conTetto ? { danni: acc.limit_damage, lato: acc.limit_side } : null,
    // Da quando in qua l'archivio delle battaglie concluse arriva: un patto
    // più vecchio ha un buco che va detto, non spacciato per "niente".
    coperturaDal: archivioOk && Number.isFinite(coperturaDal) ? coperturaDal : null,
    archivioOk,
    battaglieControllate: letti.length,
    battaglieCandidate: candidati.length,
    violazioni: righe.filter((r) => r.attaccoDiretto || r.sforato).length,
    righe,
  };
}

// Tre minuti per patto (e per versione: una modifica rifà il conto).
const controlloMemo = memo(3 * 60_000, async (chiave) => {
  const acc = getAccordo(Number(chiave.split('|')[0]));
  if (!acc) throw new Rifiuto('accordo_sconosciuto', 404);
  return calcolaControllo(acc);
});

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function buildAccordiRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente }) {
  const router = express.Router();

  const gestisci = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof Rifiuto) return res.status(err.stato).json({ error: err.codice });
      console.error('[accordi] errore:', err.message);
      res.status(500).json({ error: 'errore_server' });
    }
  };

  // ── Pubbliche ───────────────────────────────────────────────────────
  router.get('/', gestisci(async (req, res) => {
    res.json({ accordi: elenco(), ora: Date.now() });
  }));

  router.get('/:id/controllo', gestisci(async (req, res) => {
    const acc = getAccordo(idAccordo(req.params.id));
    if (!acc) throw new Rifiuto('accordo_sconosciuto', 404);
    res.json(await controlloMemo(`${acc.id}|${acc.updated_at}`));
  }));

  // ── Con login ───────────────────────────────────────────────────────
  // Sotto la lente dell'amministratore si guarda e non si scrive, come
  // ovunque nell'area riservata. Nessun filtro nazione: vedi la testata.
  const autenticato = [requireAuth, risolviIdentita, bloccaScrittureSottoLente];

  /** Cosa può fare chi guarda: il client lo usa per decidere cosa
   *  disegnare. Il permesso vero si controlla su ogni scrittura. */
  router.get('/me', ...autenticato, gestisci(async (req, res) => {
    res.json(await poteri(req));
  }));

  router.post('/', ...autenticato, gestisci(async (req, res) => {
    const campi = await campiAccordo(req.body);
    await soloChiGoverna(req, campi);
    if (contaAccordi() >= MAX_ACCORDI) throw new Rifiuto('troppi_accordi');
    const acc = creaAccordo(campi, req.account.id);
    audit(req.account.id, 'accordo.crea', `accordo:${acc.id}`, req.body);
    res.json({ accordi: elenco(), creato: acc.id, ora: Date.now() });
  }));

  router.post('/:id', ...autenticato, gestisci(async (req, res) => {
    const prima = getAccordo(idAccordo(req.params.id));
    if (!prima) throw new Rifiuto('accordo_sconosciuto', 404);
    const campi = await campiAccordo(req.body);
    await soloChiGoverna(req, prima, campi);
    aggiornaAccordo(prima.id, campi, req.account.id);
    audit(req.account.id, 'accordo.modifica', `accordo:${prima.id}`, req.body);
    res.json({ accordi: elenco(), ora: Date.now() });
  }));

  router.post('/:id/remove', ...autenticato, gestisci(async (req, res) => {
    const acc = getAccordo(idAccordo(req.params.id));
    if (!acc) throw new Rifiuto('accordo_sconosciuto', 404);
    await soloChiGoverna(req, acc);
    eliminaAccordo(acc.id);
    // Il testo intero nell'audit: è l'unica copia che resta di un patto
    // cancellato, e "chi l'ha tolto e cosa diceva" è una domanda che verrà.
    audit(req.account.id, 'accordo.elimina', `accordo:${acc.id}`, forma(acc));
    res.json({ accordi: elenco(), ora: Date.now() });
  }));

  return router;
}

module.exports = { buildAccordiRouter };
