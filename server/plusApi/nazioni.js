/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — a quali nazioni è aperta
   ----------------------------------------------------------------------
   L'area riservata è nata aperta a chiunque avesse un ruolo di gioco che
   la giustificasse: comandi un'unità, quindi puoi chiedere contratti; sei
   nel governo, quindi puoi approvarli. Quel criterio dice COSA puoi fare,
   non PER CHI lo strumento è stato aperto.

   Sono due domande diverse, e questo file risponde solo alla seconda:
   **di quale nazione sei**. Il resto dei permessi resta dov'era e non
   cambia di una riga — questo si somma, non sostituisce. Chi non aveva
   accesso prima non lo acquista qui.

       accesso = (ruolo di gioco che lo giustifica)  E  (nazione ammessa)

   ── SI GUARDA LA PERSONA, NON L'UNITÀ ─────────────────────────────────
   Il criterio è la CITTADINANZA del giocatore (`derivati.countryId`, cioè
   `country` di user.getUserLite), non la nazione dell'unità che comanda.
   Un italiano che comanda un'unità serba entra; un serbo che comanda
   un'unità italiana no. È una scelta esplicita: lo strumento è aperto a
   delle comunità di giocatori, e la comunità è fatta di persone.

   ⚠️ Non confondere con il criterio del Bilancio unità (wealth.js), che
   guarda invece la nazione dell'UNITÀ ("italiana o de facto italiana").
   Quello continua a valere dov'era: sono due filtri in serie, e servono a
   cose diverse.

   ── L'AMMINISTRATORE NON PASSA DA QUI ─────────────────────────────────
   Stesso trattamento che ha già nelle deroghe sui ruoli: il suo potere
   non è un ruolo di gioco. E c'è una ragione pratica in più — se un
   giorno questa lista finisse sbagliata, chi deve correggerla non deve
   essersi chiuso fuori da solo.

   ── COSA RESTA APERTO ─────────────────────────────────────────────────
   Entrare e verificarsi NON passano dal filtro, e non è una dimenticanza:
   la nazione si sa solo DOPO che uno ha collegato il suo account di
   gioco. Un filtro su /auth e /verify renderebbe impossibile arrivare al
   punto in cui si può stabilire se uno è ammesso — si chiuderebbe la
   porta d'ingresso a chi ha tutto il diritto di entrare.

   Aperta resta anche `/roles/me`: serve al client per sapere chi è e per
   dire in chiaro «il tuo account non è di una nazione abilitata» invece
   di mostrare una schermata rotta. Non porta con sé dati di sezione.

   ── CHI È AMMESSO: LE NAZIONI DI UN'ALLEANZA ──────────────────────────
   Dal 2026-09-24 la lista non è più scritta a mano: sono le nazioni
   dell'alleanza P.A.S.T.A. (richiesta dell'utente). Prima erano quattro
   nazioni fisse — Italia, Liechtenstein, Slovenia, Mongolia — tutte dentro
   P.A.S.T.A., che però ne conta tredici: le altre nove restavano fuori
   senza che nessuno l'avesse deciso.

   L'appartenenza si rilegge ogni 10 minuti da `allianceId` delle nazioni
   (paesiMappa, cioè la cache /countries: zero chiamate nuove al gioco).
   Chi entra nell'alleanza entra qui entro dieci minuti, chi esce esce.

   Due reti, perché è un controllo d'accesso:
   - all'avvio, prima della prima lettura, valgono i MEMBRI_NOTI qui sotto
     (verificati il 2026-09-24), non un insieme vuoto che chiuderebbe
     fuori tutti per il primo minuto;
   - una lettura che torna ZERO membri non si applica: è molto più
     probabile una cache monca che un'alleanza sciolta, e svuotare la lista
     chiuderebbe l'area a tutti. Si tiene quella di prima e si avvisa.

   ── DOVE SI CAMBIA ────────────────────────────────────────────────────
   `WP_ALLEANZA_AMMESSA` (id) cambia l'alleanza senza deploy del codice.
   `WP_NAZIONI_AMMESSE` (id separati da virgola) aggiunge nazioni FUORI
   dall'alleanza, in più — prima sostituiva la lista, ora si somma.
   Controllo: `nazioniAmmesse` e `alleanzaAmmessa` in /health.
   ══════════════════════════════════════════════════════════════════════ */

const { paesiMappa, memo } = require('./fonti');
const { trpcGet } = require('./wareraApi');

// L'alleanza, e i suoi membri com'erano il 2026-09-24 (country.getAllCountries,
// campo allianceId). Il nome accanto è solo per chi legge e per /health prima
// della prima lettura: il confronto è sempre e solo sull'id.
const ALLEANZA_DEFAULT = ['6a2965afbc253b28fcf0d1c7', 'P.A.S.T.A.'];
const MEMBRI_NOTI = [
  ['6813b6d446e731854c7ac7a2', 'Italy'],
  ['6813b6d446e731854c7ac7b4', 'Slovenia'],
  ['696a81da63e2489f47e5a28c', 'Liechtenstein'],
  ['683ddd2c24b5a2e114af15d7', 'Mongolia'],
  ['6813b6d446e731854c7ac7be', 'Bulgaria'],
  ['6873d0ea1758b40e712b5f3d', 'Malta'],
  ['6813b6d446e731854c7ac7e8', 'Greece'],
  ['683ddd2c24b5a2e114af15c3', 'Iraq'],
  ['6813b6d546e731854c7ac8d1', 'Azerbaijan'],
  ['683ddd2c24b5a2e114af15b5', 'United Arab Emirates'],
  ['6813b6d446e731854c7ac7b2', 'Hungary'],
  ['6813b6d546e731854c7ac842', 'Cyprus'],
  ['6813b6d446e731854c7ac7eb', 'Turkiye'],
];
// L'Italia resta PRIMA nell'elenco: nazione.js apre l'amministratore su
// nazioniAmmesse()[0], e prima era lei.
const NAZIONE_DI_CASA = '6813b6d446e731854c7ac7a2';
const ALLEANZA = (process.env.WP_ALLEANZA_AMMESSA || '').trim() || ALLEANZA_DEFAULT[0];
const EXTRA = (process.env.WP_NAZIONI_AMMESSE || '').split(',').map((s) => s.trim()).filter(Boolean);
const RILETTURA_MS = 10 * 60_000;

const NOMI = new Map(MEMBRI_NOTI);
let AMMESSE = componi(ALLEANZA === ALLEANZA_DEFAULT[0] ? MEMBRI_NOTI.map(([id]) => id) : []);
let _letta = null;   // quando l'appartenenza è stata letta davvero l'ultima volta

function componi(membri) {
  const tutte = new Set([...membri, ...EXTRA]);
  const ordinate = [...tutte].sort((a, b) =>
    (b === NAZIONE_DI_CASA) - (a === NAZIONE_DI_CASA) || (NOMI.get(a) || a).localeCompare(NOMI.get(b) || b));
  return new Set(ordinate);
}

async function rileggiAlleanza() {
  try {
    const paesi = await paesiMappa();
    const membri = [...paesi.values()].filter((n) => n?.allianceId === ALLEANZA);
    if (!membri.length) {
      console.warn(`[nazioni] l'alleanza ${ALLEANZA} risulta senza membri: lista NON cambiata (${AMMESSE.size} nazioni)`);
      return;
    }
    for (const n of membri) if (n.name) NOMI.set(n._id, n.name);
    for (const id of EXTRA) { const n = paesi.get(id); if (n?.name) NOMI.set(id, n.name); }
    const nuove = componi(membri.map((n) => n._id));
    const entrate = [...nuove].filter((id) => !AMMESSE.has(id));
    const uscite = [...AMMESSE].filter((id) => !nuove.has(id));
    if (entrate.length || uscite.length) {
      const nomi = (ids) => ids.map((id) => NOMI.get(id) || id).join(', ') || '—';
      console.log(`[nazioni] area riservata: entrano ${nomi(entrate)}; escono ${nomi(uscite)}`);
    }
    AMMESSE = nuove;
    _letta = Date.now();
  } catch (err) {
    console.warn('[nazioni] rilettura alleanza fallita, resta la lista di prima:', err.message);
  }
}

function initNazioni() {
  rileggiAlleanza();
  setInterval(rileggiAlleanza, RILETTURA_MS).unref();
}

/** Per i giri (confini, istantanee), /health e il messaggio al client. */
function nazioniAmmesse() {
  return [...AMMESSE];
}

function etichette() {
  return [...AMMESSE].map((id) => ({ id, nome: NOMI.get(id) || null }));
}

/** Il capo dell'alleanza in gioco (user id), letto da alliance.getById
 *  (pubblica). È lui a gestire il canale Discord di alleanza: un canale solo
 *  per tredici nazioni non può essere scrivibile da tredici presidenti, e
 *  il gioco dice già chi l'alleanza la guida. Dieci minuti: cambia di rado. */
const leaderAlleanza = memo(10 * 60_000, async () => {
  const a = await trpcGet('alliance.getById', { allianceId: ALLEANZA });
  return a?.leader || null;
});

/** Per /health e per il client: quale alleanza apre l'area. */
function alleanzaAmmessa() {
  return {
    id: ALLEANZA,
    nome: ALLEANZA === ALLEANZA_DEFAULT[0] ? ALLEANZA_DEFAULT[1] : null,
    lettaIl: _letta ? new Date(_letta).toISOString() : null,
    extra: EXTRA,
  };
}

/**
 * Questa persona è di una nazione ammessa?
 *
 * @param {{is_admin?: number|boolean}} account   chi è entrato
 * @param {{countryId?: string|null}|null} derivati  da roles.js
 * @returns {{ok: boolean, motivo: string|null}}
 *
 * I motivi sono distinti apposta: "non ti sei ancora verificato" e "la tua
 * nazione non è fra quelle abilitate" sono due situazioni diverse, e la
 * prima si risolve in due minuti mentre la seconda no. Dirle con lo stesso
 * messaggio manderebbe a chiedere aiuto chi doveva solo finire la
 * verifica.
 */
function nazioneAmmessa(account, derivati) {
  if (account?.is_admin) return { ok: true, motivo: null };
  if (!account?.war_user_id) return { ok: false, motivo: 'non_verificato' };
  const countryId = derivati?.countryId || null;
  if (!countryId) return { ok: false, motivo: 'nazione_sconosciuta' };
  if (!AMMESSE.has(countryId)) return { ok: false, motivo: 'nazione_non_abilitata' };
  return { ok: true, motivo: null };
}

/**
 * Middleware. Va DOPO requireAuth e, dove c'è, dopo risolviIdentita.
 *
 * ⚠️ Guarda `req.identita` quando esiste, non `req.account`: sotto la
 * lente dell'amministratore (`?asAccount=`) la vista deve essere quella
 * del bersaglio, filtro compreso. Se guardasse `req.account`, un admin che
 * ispeziona il problema di un utente vedrebbe la sezione piena e non
 * capirebbe mai perché quello si lamenta di non vedere niente.
 *
 * Il gioco può non rispondere: in quel caso NON si lascia passare. È il
 * verso giusto in cui sbagliare per un controllo di accesso — un errore di
 * rete non deve diventare una porta aperta — e il client mostra "riprova"
 * invece di una schermata vuota.
 *
 * @param {(account: object) => Promise<object>} derivatiDi
 */
function costruisciFiltroNazione(derivatiDi) {
  return async function filtroNazione(req, res, next) {
    const chi = req.identita || req.account;
    if (chi?.is_admin && !req.lente) return next();

    let derivati = null;
    try {
      derivati = await derivatiDi(chi);
    } catch (err) {
      console.error('[nazioni] gioco non raggiungibile, accesso negato:', err.message);
      return res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }

    const esito = nazioneAmmessa(chi, derivati);
    if (esito.ok) return next();

    return res.status(403).json({
      error: 'nazione_non_abilitata',
      motivo: esito.motivo,
      // Il client le usa per scrivere quali sono, senza doverle avere
      // duplicate nel bundle (dove sarebbero l'ennesima lista da tenere
      // allineata a mano).
      nazioniAmmesse: etichette(),
      alleanza: alleanzaAmmessa().nome,
    });
  };
}

module.exports = {
  costruisciFiltroNazione, nazioneAmmessa, nazioniAmmesse, etichette, alleanzaAmmessa, initNazioni,
  leaderAlleanza,
};
