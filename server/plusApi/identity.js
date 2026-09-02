/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — chi sta guardando, e con quali poteri
   ----------------------------------------------------------------------
   Un punto solo in cui si risolve l'identità, e non è pignoleria.

   Un amministratore può guardare il tool con gli occhi di un'altra
   persona (`?asAccount=`): serve a rispondere alla domanda che arriverà
   davvero — "il presidente tedesco dice che non vede le richieste della
   sua nazione, perché?" — e senza quella lente si può solo indovinare.

   La lente NON dà accesso: lo toglie. Un amministratore vede già tutto;
   quello che la lente aggiunge è vedere di MENO, cioè la vista ristretta
   com'è per quella persona.

   ── PERCHÉ IL DIVIETO DI SCRITTURA STA QUI E NON NELLE ROTTE ──────────
   Se una sola rotta di lettura dimenticasse di passare da qui, la lente
   mostrerebbe in silenzio la vista dell'amministratore al posto di
   quella del bersaglio — e non ci si accorgerebbe di niente finché non
   si prende una decisione sbagliata basandosi su ciò che si credeva di
   aver visto.

   E se una rotta di SCRITTURA dimenticasse il controllo, un
   amministratore potrebbe approvare indossando l'identità altrui: da
   quel momento ogni riga dell'archivio diventerebbe ambigua — "l'ha
   approvato lui o l'admin per lui?" — e l'audit perderebbe l'unica cosa
   che deve garantire.

   Perciò il divieto è strutturale, non una disciplina da ricordare:
   `bloccaScrittureSottoLente` rifiuta QUALUNQUE metodo diverso da GET
   mentre la lente è attiva. Una rotta nuova scritta fra sei mesi da
   qualcuno che non ha letto questo file è protetta lo stesso.
   ══════════════════════════════════════════════════════════════════════ */

const { getAccountById, audit } = require('./db');

/**
 * Middleware. Dopo requireAuth. Popola:
 *   req.account     — chi è entrato davvero (non cambia mai)
 *   req.identita    — di chi si stanno guardando i dati
 *   req.lente       — { attivo, soloLettura, adminId } oppure null
 */
function risolviIdentita(req, res, next) {
  req.identita = req.account;
  req.lente = null;

  const asAccount = Number(req.query.asAccount);
  if (!asAccount) return next();

  if (!req.account.is_admin) return res.status(403).json({ error: 'non_autorizzato' });

  const bersaglio = getAccountById(asAccount);
  if (!bersaglio) return res.status(404).json({ error: 'account_inesistente' });

  req.identita = bersaglio;
  req.lente = { attivo: true, soloLettura: true, adminId: req.account.id };

  // Guardare la schermata di un'altra persona non deve essere invisibile
  // nemmeno se lo fa l'amministratore.
  audit(req.account.id, 'admin.view-as', `account:${asAccount}`, { rotta: req.path });
  next();
}

/** Da montare SUBITO dopo risolviIdentita su ogni router che scrive. */
function bloccaScrittureSottoLente(req, res, next) {
  if (req.lente && req.method !== 'GET') {
    return res.status(403).json({ error: 'lente_sola_lettura' });
  }
  next();
}

module.exports = { risolviIdentita, bloccaScrittureSottoLente };
