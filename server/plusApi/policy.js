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

function listaVoci(countryId) {
  return getDb().prepare('SELECT * FROM request_allow WHERE country_id = ? ORDER BY created_at')
    .all(countryId);
}

/**
 * Può l'unità `muId` (della nazione `muCountryId`) chiedere un contratto
 * alla nazione `targetCountryId`?
 */
async function puoChiedere({ muId, muCountryId, targetCountryId }) {
  const voci = listaVoci(targetCountryId);

  // Il divieto esplicito vince su tutto, anche sull'alleanza: è l'unico
  // modo di escludere una singola unità senza uscire dall'alleanza.
  const negata = voci.some((v) => v.mode === 'deny'
    && ((v.entry_type === 'mu' && v.entry_id === muId)
     || (v.entry_type === 'country' && v.entry_id === muCountryId)));
  if (negata) return { ammesso: false, motivo: 'esclusa' };

  const ammessa = voci.some((v) => v.mode === 'allow'
    && ((v.entry_type === 'mu' && v.entry_id === muId)
     || (v.entry_type === 'country' && v.entry_id === muCountryId)));
  if (ammessa) return { ammesso: true, motivo: 'in_lista' };

  if (muCountryId === targetCountryId) return { ammesso: true, motivo: 'stessa_nazione' };

  const all = await mappaAlleanze();
  const a = all.get(muCountryId);
  const b = all.get(targetCountryId);
  if (a && b && a === b) return { ammesso: true, motivo: 'stessa_alleanza' };

  return { ammesso: false, motivo: 'fuori_alleanza' };
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

    const ammesse = new Set();
    if (muCountryId) {
      ammesse.add(muCountryId);
      const mia = all.get(muCountryId);
      if (mia) for (const [cid, aid] of all) if (aid === mia) ammesse.add(cid);
    }

    // Le liste esplicite di TUTTE le nazioni: la tabella e' piccola
    // (una riga per deroga, non per nazione) e leggerla intera costa
    // meno di interrogarla centottanta volte.
    const voci = getDb().prepare('SELECT * FROM request_allow').all();
    for (const v of voci) {
      const riguarda = (v.entry_type === 'mu' && cap.chiedePer?.includes(v.entry_id))
        || (v.entry_type === 'country' && v.entry_id === muCountryId);
      if (!riguarda) continue;
      if (v.mode === 'allow') ammesse.add(v.country_id);
      else ammesse.delete(v.country_id);
    }

    res.json({ countryIds: [...ammesse], muCountryId, allianceId: muCountryId ? all.get(muCountryId) : null });
  });

  /** La lista di una nazione. La leggono anche i comandanti: sapere in
   *  anticipo se si è ammessi evita di chiedere per poi vedersi rifiutare. */
  router.get('/:countryId', async (req, res) => {
    const { countryId } = req.params;
    const cap = await capacitaDi(req.identita);
    const all = await mappaAlleanze();
    res.json({
      countryId,
      allianceId: all.get(countryId) || null,
      voci: listaVoci(countryId).map((v) => ({
        entryType: v.entry_type, entryId: v.entry_id, mode: v.mode,
        nota: v.nota, createdAt: v.created_at,
      })),
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

    const entryType = req.body?.entryType;
    const entryId = String(req.body?.entryId || '').trim();
    const mode = req.body?.mode;
    if (!['country', 'mu'].includes(entryType) || !/^[a-f0-9]{24}$/.test(entryId)
        || !['allow', 'deny'].includes(mode)) {
      return res.status(400).json({ error: 'parametri_non_validi' });
    }

    getDb().prepare(`
      INSERT INTO request_allow (country_id, entry_type, entry_id, mode, nota, added_by, created_at)
      VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(country_id, entry_type, entry_id) DO UPDATE SET
        mode = excluded.mode, nota = excluded.nota,
        added_by = excluded.added_by, created_at = excluded.created_at
    `).run(countryId, entryType, entryId, mode,
           String(req.body?.nota || '').slice(0, 200) || null, req.identita.id, Date.now());

    audit(req.identita.id, 'policy.set', `country:${countryId}`, { entryType, entryId, mode });
    res.json({ ok: true });
  });

  router.post('/:countryId/remove', async (req, res) => {
    const { countryId } = req.params;
    const cap = await capacitaDi(req.identita);
    if (!cap.gestisceNazione?.includes(countryId) && !cap.admin) {
      return res.status(403).json({ error: 'non_governi_questa_nazione' });
    }
    const { entryType, entryId } = req.body || {};
    getDb().prepare('DELETE FROM request_allow WHERE country_id = ? AND entry_type = ? AND entry_id = ?')
      .run(countryId, entryType, String(entryId || ''));
    audit(req.identita.id, 'policy.remove', `country:${countryId}`, { entryType, entryId });
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildPolicyRouter, puoChiedere, mappaAlleanze };
