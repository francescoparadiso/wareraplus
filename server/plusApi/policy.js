/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — chi può chiedere contratti alla mia nazione
   ----------------------------------------------------------------------
   Comandare un'unità non basta a poter chiedere soldi a una nazione
   qualsiasi: è la nazione che paga, ed è la nazione che decide.

   ── IL PREDEFINITO NON È "NESSUNO" ────────────────────────────────────
   Una lista vuota che va riempita a mano prima di poter fare qualunque
   cosa è il modo più affidabile per far abbandonare uno strumento al
   primo utilizzo. Il predefinito è **l'alleanza**: le unità delle nazioni
   alleate possono chiedere, perché è già così che funziona in pratica.
   Chi non ha alleanza parte da sola sé stessa.

   ── LA LISTA È UN DELTA, COME LE DEROGHE SUI RUOLI ────────────────────
       ammesso = (stessa alleanza) + allow − deny
   Così si aggiungono i mercenari esterni con cui si lavora davvero, e si
   esclude quell'unica unità con cui è finita male, senza dover
   riscrivere da zero un elenco che il gioco già conosce.

   ── TRE AMBITI, NON DUE ───────────────────────────────────────────────
   Una voce può essere una NAZIONE, un'UNITÀ o un'ALLEANZA intera. La
   terza mancava, ed era quella che serviva di più: ammettere un blocco
   alleato voleva dire aggiungere a mano le sue dodici nazioni e poi
   ricordarsi di rifarlo ogni volta che il blocco cambia. Un'alleanza in
   lista si rivaluta ad ogni controllo, quindi segue il gioco da sola.

   Le alleanze si espandono in nazioni al momento del controllo, non alla
   scrittura: registrare le nazioni di oggi renderebbe la voce una
   fotografia, che è esattamente il problema che dovrebbe risolvere.

   ── LA LISTA RISOLTA ──────────────────────────────────────────────────
   `/policy/:countryId` non restituisce più solo le correzioni: dice
   anche **chi può chiedere adesso**, nazione per nazione, con accanto da
   dove viene il permesso (alleanza propria, alleanza aggiunta, aggiunta
   singola). Un elenco di correzioni non risponde alla domanda che uno si
   fa davvero aprendo quella scheda — "chi può biddare per me?" — e
   ricostruirla a mente incrociando l'alleanza con le deroghe è lavoro
   che deve fare il server una volta, non l'utente ogni volta.

   Le UNITÀ restano elencate a parte e non si espandono: una nazione
   ammessa vale per tutte le sue unità, mentre le voci `mu` sono
   eccezioni puntuali, e mescolarle nello stesso elenco confonderebbe due
   cose di scala diversa.

   ── CHI PUÒ MODIFICARLA ───────────────────────────────────────────────
   Tutto il governo: presidente, vice e i tre ministri. Non solo chi
   approva i contratti — decidere *con chi si lavora* è una scelta
   politica, e limitarla al ministro della difesa vorrebbe dire bloccare
   tutto quando quello non c'è. Il congresso no: è parlamento, non
   governo.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { getDb, audit } = require('./db');

// Il cache-server gira sulla STESSA macchina: le nazioni si leggono da
// 127.0.0.1 senza uscire in rete e senza toccare il budget di nessuno.
// Se non risponde si degrada, come ogni altra cosa che dipende da lui.
const CACHE_LOCALE = process.env.CACHE_BASE || 'http://127.0.0.1:3001';
const ALLEANZE_TTL_MS = 15 * 60 * 1000;

const AMBITI = ['country', 'mu', 'alliance'];
const ID_VALIDO = /^[a-f0-9]{24}$/;

let _alleanze = null;   // countryId → allianceId
let _alleanzeAt = 0;

async function mappaAlleanze() {
  if (_alleanze && Date.now() - _alleanzeAt < ALLEANZE_TTL_MS) return _alleanze;
  try {
    const res = await fetch(`${CACHE_LOCALE}/countries`);
    const body = await res.json();
    const arr = body?.data?.result?.data || body?.data || [];
    const m = new Map();
    for (const c of arr) if (c?._id) m.set(c._id, c.allianceId || null);
    _alleanze = m; _alleanzeAt = Date.now();
  } catch (err) {
    console.warn('[policy] elenco nazioni non raggiungibile:', err.message);
    // Si tiene la mappa vecchia se c'è: meglio un dato di quindici minuti
    // fa che negare a tutti il permesso di chiedere.
    if (!_alleanze) _alleanze = new Map();
  }
  return _alleanze;
}

/** Le nazioni che stanno in un'alleanza, adesso. */
function nazioniDi(allianceId, mappa) {
  const out = [];
  if (!allianceId) return out;
  for (const [cid, aid] of mappa) if (aid === allianceId) out.push(cid);
  return out;
}

function listaVoci(countryId) {
  return getDb().prepare('SELECT * FROM request_allow WHERE country_id = ? ORDER BY created_at')
    .all(countryId);
}

/**
 * Una voce riguarda questo richiedente? Un posto solo in cui si decide,
 * usato sia dal controllo del permesso sia dall'elenco delle nazioni a
 * cui posso chiedere: erano due copie della stessa regola, e la seconda
 * non ha mai conosciuto le alleanze.
 */
function vocePertinente(v, { muId, muCountryId, muAllianceId }) {
  if (v.entry_type === 'mu') return Boolean(muId) && v.entry_id === muId;
  if (v.entry_type === 'country') return v.entry_id === muCountryId;
  if (v.entry_type === 'alliance') return Boolean(muAllianceId) && v.entry_id === muAllianceId;
  return false;
}

/**
 * Può l'unità `muId` (della nazione `muCountryId`) chiedere un contratto
 * alla nazione `targetCountryId`?
 */
async function puoChiedere({ muId, muCountryId, targetCountryId }) {
  const voci = listaVoci(targetCountryId);
  const all = await mappaAlleanze();
  const chi = { muId, muCountryId, muAllianceId: all.get(muCountryId) || null };

  // Il divieto esplicito vince su tutto, anche sull'alleanza: è l'unico
  // modo di escludere una singola unità senza uscire dall'alleanza.
  const negata = voci.some((v) => v.mode === 'deny' && vocePertinente(v, chi));
  if (negata) return { ammesso: false, motivo: 'esclusa' };

  const ammessa = voci.some((v) => v.mode === 'allow' && vocePertinente(v, chi));
  if (ammessa) return { ammesso: true, motivo: 'in_lista' };

  if (muCountryId === targetCountryId) return { ammesso: true, motivo: 'stessa_nazione' };

  const sua = all.get(targetCountryId);
  if (chi.muAllianceId && sua && chi.muAllianceId === sua) {
    return { ammesso: true, motivo: 'stessa_alleanza' };
  }

  return { ammesso: false, motivo: 'fuori_alleanza' };
}

/**
 * Chi può chiedere a questa nazione, adesso, già risolto.
 *
 * Le nazioni escono con l'ORIGINE del permesso accanto (`via`): "perché
 * costui può chiedermi dei soldi" è la domanda che viene subito dopo aver
 * letto l'elenco, e senza quel campo si torna a incrociare a mano
 * l'alleanza con le correzioni.
 */
async function risolviLista(countryId) {
  const voci = listaVoci(countryId);
  const all = await mappaAlleanze();
  const mia = all.get(countryId) || null;

  // countryId → { via, … }. L'ordine di scrittura conta: gli allow si
  // sovrascrivono fra loro, e i deny passano alla fine su tutti.
  const nazioni = new Map();
  nazioni.set(countryId, { countryId, via: 'propria' });
  for (const cid of nazioniDi(mia, all)) {
    if (!nazioni.has(cid)) nazioni.set(cid, { countryId: cid, via: 'alleanza', allianceId: mia });
  }

  const unitaAmmesse = [];
  const unitaEscluse = [];
  const alleanze = [];

  for (const v of voci) {
    if (v.mode !== 'allow') continue;
    if (v.entry_type === 'country') {
      nazioni.set(v.entry_id, { countryId: v.entry_id, via: 'aggiunta', nome: v.nome, nota: v.nota });
    } else if (v.entry_type === 'alliance') {
      alleanze.push({ allianceId: v.entry_id, mode: 'allow', nome: v.nome, nota: v.nota });
      for (const cid of nazioniDi(v.entry_id, all)) {
        if (nazioni.get(cid)?.via === 'propria') continue;
        nazioni.set(cid, { countryId: cid, via: 'alleanza_aggiunta', allianceId: v.entry_id });
      }
    } else if (v.entry_type === 'mu') {
      unitaAmmesse.push({ muId: v.entry_id, nome: v.nome, nota: v.nota });
    }
  }

  // I divieti per ultimi: `deny` vince su tutto, ed è l'unico modo di
  // togliere una nazione senza uscire dall'alleanza.
  for (const v of voci) {
    if (v.mode !== 'deny') continue;
    if (v.entry_type === 'country') {
      nazioni.delete(v.entry_id);
    } else if (v.entry_type === 'alliance') {
      alleanze.push({ allianceId: v.entry_id, mode: 'deny', nome: v.nome, nota: v.nota });
      for (const cid of nazioniDi(v.entry_id, all)) nazioni.delete(cid);
    } else if (v.entry_type === 'mu') {
      unitaEscluse.push({ muId: v.entry_id, nome: v.nome, nota: v.nota });
    }
  }

  // Sé stessi non ci si esclude: una nazione che nega alle proprie unità
  // di chiederle un contratto non sta facendo una scelta politica, si sta
  // rompendo da sola. Vale anche nel controllo del permesso, dove
  // `stessa_nazione` viene comunque dopo il deny — qui si allinea la
  // vista al comportamento, invece di mostrarne uno diverso.
  if (!nazioni.has(countryId)) nazioni.set(countryId, { countryId, via: 'propria' });

  return { allianceId: mia, nazioni: [...nazioni.values()], alleanze, unitaAmmesse, unitaEscluse };
}

// ---------------------------------------------------------------------------
// Scrittura
// ---------------------------------------------------------------------------
// Una voce alla volta era il modo più veloce di scrivere il server e il
// più lento di usarlo: ammettere sei nazioni voleva dire sei giri di
// richiesta, ricarica e riposizionamento nella pagina. Qui si accetta un
// elenco, e il singolo resta un elenco di uno.

function normalizzaVoce(v) {
  const entryType = v?.entryType;
  const entryId = String(v?.entryId || '').trim();
  const mode = v?.mode;
  if (!AMBITI.includes(entryType) || !ID_VALIDO.test(entryId) || !['allow', 'deny'].includes(mode)) {
    return null;
  }
  return {
    entryType, entryId, mode,
    nota: String(v?.nota || '').slice(0, 200) || null,
    // Il NOME com'era al momento dell'aggiunta. Il server non sa come si
    // chiama un'unità militare e il client lo saprebbe solo rifacendo la
    // ricerca: senza questo campo, riaperta la lista il giorno dopo, una
    // voce è ventiquattro caratteri esadecimali.
    nome: String(v?.nome || '').slice(0, 120) || null,
  };
}

/** Le voci del corpo, sia nella forma singola sia nell'elenco. */
function vociDaCorpo(body) {
  const grezze = Array.isArray(body?.voci) ? body.voci : [body];
  return grezze.map(normalizzaVoce);
}

function buildPolicyRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente, capacitaDi }) {
  const router = express.Router();
  router.use(requireAuth, risolviIdentita, bloccaScrittureSottoLente);

  /**
   * Le nazioni a cui QUESTA identita' puo' chiedere contratti.
   * Serve alla card delle battaglie: senza, il client dovrebbe chiedere
   * il permesso nazione per nazione (centottanta domande per disegnare
   * una lista) oppure mostrare battaglie su cui poi si becca un rifiuto.
   */
  router.get('/mie/nazioni', async (req, res) => {
    const cap = await capacitaDi(req.identita);
    const muCountryId = cap.muCountryId || null;
    const all = await mappaAlleanze();
    const miaAlleanza = muCountryId ? all.get(muCountryId) || null : null;

    const ammesse = new Set();
    if (muCountryId) {
      ammesse.add(muCountryId);
      if (miaAlleanza) for (const cid of nazioniDi(miaAlleanza, all)) ammesse.add(cid);
    }

    // Le liste esplicite di TUTTE le nazioni: la tabella e' piccola
    // (una riga per deroga, non per nazione) e leggerla intera costa
    // meno di interrogarla centottanta volte.
    //
    // ⚠️ I deny si applicano DOPO tutti gli allow, non nell'ordine in cui
    // stanno nella tabella. In puoChiedere() il divieto vince sempre;
    // qui, leggendo di seguito, una riga allow scritta dopo un deny
    // rimetteva dentro chi era stato escluso — due risposte diverse alla
    // stessa domanda, e questa era quella che decideva cosa mostrare.
    const voci = getDb().prepare('SELECT * FROM request_allow').all();
    const chi = { muId: null, muCountryId, muAllianceId: miaAlleanza };
    const pertinente = (v) => (v.entry_type === 'mu'
      ? Boolean(cap.chiedePer?.includes(v.entry_id))
      : vocePertinente(v, chi));

    for (const v of voci) if (v.mode === 'allow' && pertinente(v)) ammesse.add(v.country_id);
    for (const v of voci) if (v.mode === 'deny' && pertinente(v)) ammesse.delete(v.country_id);

    res.json({ countryIds: [...ammesse], muCountryId, allianceId: miaAlleanza });
  });

  /** La lista di una nazione. La leggono anche i comandanti: sapere in
   *  anticipo se si è ammessi evita di chiedere per poi vedersi rifiutare. */
  router.get('/:countryId', async (req, res) => {
    const { countryId } = req.params;
    const cap = await capacitaDi(req.identita);
    const risolta = await risolviLista(countryId);
    res.json({
      countryId,
      allianceId: risolta.allianceId,
      voci: listaVoci(countryId).map((v) => ({
        entryType: v.entry_type, entryId: v.entry_id, mode: v.mode,
        nome: v.nome, nota: v.nota, createdAt: v.created_at,
      })),
      // Chi puo' chiedere ADESSO, gia' risolto: e' la domanda vera.
      risolta,
      // Il client disegna i comandi solo se questo è vero; il permesso
      // vero resta controllato qui ad ogni scrittura.
      puoiModificare: cap.gestisceNazione?.includes(countryId) || Boolean(cap.admin),
    });
  });

  router.post('/:countryId', async (req, res) => {
    const { countryId } = req.params;
    const cap = await capacitaDi(req.identita);
    if (!cap.gestisceNazione?.includes(countryId) && !cap.admin) {
      return res.status(403).json({ error: 'non_governi_questa_nazione' });
    }

    const voci = vociDaCorpo(req.body);
    if (!voci.length || voci.some((v) => !v)) {
      return res.status(400).json({ error: 'parametri_non_validi' });
    }

    const stmt = getDb().prepare(`
      INSERT INTO request_allow (country_id, entry_type, entry_id, mode, nome, nota, added_by, created_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(country_id, entry_type, entry_id) DO UPDATE SET
        mode = excluded.mode, nome = excluded.nome, nota = excluded.nota,
        added_by = excluded.added_by, created_at = excluded.created_at
    `);
    const ora = Date.now();
    // Tutte o nessuna: mezza lista scritta è peggio di nessuna, perché chi
    // ha premuto una volta non sa più a che punto è rimasto.
    getDb().transaction(() => {
      for (const v of voci) {
        stmt.run(countryId, v.entryType, v.entryId, v.mode, v.nome, v.nota, req.identita.id, ora);
      }
    })();

    audit(req.identita.id, 'policy.set', `country:${countryId}`,
      voci.map((v) => ({ entryType: v.entryType, entryId: v.entryId, mode: v.mode })));
    res.json({ ok: true, scritte: voci.length });
  });

  router.post('/:countryId/remove', async (req, res) => {
    const { countryId } = req.params;
    const cap = await capacitaDi(req.identita);
    if (!cap.gestisceNazione?.includes(countryId) && !cap.admin) {
      return res.status(403).json({ error: 'non_governi_questa_nazione' });
    }

    const grezze = Array.isArray(req.body?.voci) ? req.body.voci : [req.body];
    const voci = grezze
      .map((v) => ({ entryType: v?.entryType, entryId: String(v?.entryId || '') }))
      .filter((v) => AMBITI.includes(v.entryType) && v.entryId);
    if (!voci.length) return res.status(400).json({ error: 'parametri_non_validi' });

    const stmt = getDb().prepare(
      'DELETE FROM request_allow WHERE country_id = ? AND entry_type = ? AND entry_id = ?');
    getDb().transaction(() => {
      for (const v of voci) stmt.run(countryId, v.entryType, v.entryId);
    })();

    audit(req.identita.id, 'policy.remove', `country:${countryId}`, voci);
    res.json({ ok: true, tolte: voci.length });
  });

  return router;
}

module.exports = { buildPolicyRouter, puoChiedere, mappaAlleanze, risolviLista };
