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

   ── DOVE SI CAMBIA ────────────────────────────────────────────────────
   La lista sta qui sotto e si legge anche dall'ambiente
   (`WP_NAZIONI_AMMESSE`, id separati da virgola): aggiungere una nazione
   non deve richiedere un deploy del codice, perché il giorno in cui
   servirà sarà un giorno in cui si ha fretta.
   ══════════════════════════════════════════════════════════════════════ */

// Verificati contro country.getAllCountries il 2026-09-09. Il nome accanto
// è solo per chi legge: il confronto è sempre e solo sull'id, che non
// cambia se la nazione viene rinominata in gioco.
const NAZIONI_AMMESSE_DEFAULT = [
  ['6813b6d446e731854c7ac7a2', 'Italy'],
  ['696a81da63e2489f47e5a28c', 'Liechtenstein'],
  ['6813b6d446e731854c7ac7b4', 'Slovenia'],
  ['683ddd2c24b5a2e114af15d7', 'Mongolia'],
];

function leggiAmmesse() {
  const daEnv = (process.env.WP_NAZIONI_AMMESSE || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (daEnv.length) return new Set(daEnv);
  return new Set(NAZIONI_AMMESSE_DEFAULT.map(([id]) => id));
}

const AMMESSE = leggiAmmesse();

/** Solo per /health e per il messaggio al client: mai usata per decidere. */
function nazioniAmmesse() {
  return [...AMMESSE];
}

function etichette() {
  const noti = new Map(NAZIONI_AMMESSE_DEFAULT);
  return [...AMMESSE].map((id) => ({ id, nome: noti.get(id) || null }));
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
    });
  };
}

module.exports = { costruisciFiltroNazione, nazioneAmmessa, nazioniAmmesse, etichette };
