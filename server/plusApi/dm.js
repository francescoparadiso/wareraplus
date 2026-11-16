/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — messaggi privati ai comandanti dell'unità
   ----------------------------------------------------------------------
   Quando un contratto viene APPROVATO e quando viene POSTATO (il governo ha
   aperto l'asta e spunta "I opened the auction"), il comandante dell'unità
   riceve un messaggio privato su Discord.

   ── PERCHÉ UN MESSAGGIO PRIVATO ───────────────────────────────────────
   L'avviso nel canale dell'unità c'è già, ma esiste solo se qualcuno ha
   configurato quel canale, e un comandante non sta a guardarlo: quello che
   gli serve sapere è "posso mandare l'unità adesso". Il privato arriva anche
   senza canale, e suona sul telefono.

   ── A CHI ─────────────────────────────────────────────────────────────
   Chi ha fatto la richiesta, più il proprietario e i comandanti dell'unità
   (letti dal gioco: `mu.getById`), tutti solo se hanno collegato Discord e
   personaggio al tool — gli altri non hanno un id Discord che il server
   conosca. Senza doppioni, e MAI chi ha appena compiuto l'azione: il ministro
   che approva la richiesta di un'unità che comanda non ha bisogno di un
   messaggio per sapere che l'ha approvata.

   ── COME ──────────────────────────────────────────────────────────────
   Non si parla con Discord da qui: si scrive un evento nella coda del bot
   (`scope_type = 'dm'`, `scope_id` = id Discord) e il bot lo consegna. Se
   BOT_TOKEN non c'è, niente. Il bot scarta gli eventi privati più vecchi di
   due ore: un "approvato" arrivato dopo un'interruzione del bot sarebbe una
   notizia sbagliata, non in ritardo.

   ⚠️ Non c'è ripiego se la persona ha i messaggi privati chiusi: Discord
   rifiuta (50007) e il bot lo lascia cadere in silenzio. Per questo l'avviso
   nel canale dell'unità resta, e non è sostituito da questo.
   ══════════════════════════════════════════════════════════════════════ */

const { findAccountByWarUserId, getAccountById, registraEventoBot } = require('./db');
const { trpcGet } = require('./wareraApi');
const { memo, paesiMappa } = require('./fonti');

/** Proprietario e comandanti dell'unita' (non i "manager": possono chiedere
 *  contratti ma non comandano). Cinque minuti: cambiano di rado. */
const capiUnita = memo(5 * 60_000, async (muId) => {
  const mu = await trpcGet('mu.getById', { muId });
  return [mu?.user, ...(mu?.roles?.commanders || [])].filter(Boolean);
});

const num = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));

function testoDM(tipo, r, chi, paese) {
  const dove = `${r.battle_label || r.battle_id}\n<https://app.warera.io/battle/${r.battle_id}>`;
  const cifre = `Paid by ${paese || '?'} · min damage ${num(r.min_damage)}`
    + `${r.burst_damage ? ` (burst ${num(r.burst_damage)})` : ''} · budget ${num(r.budget)}`
    + `${r.professionals_only ? ' · professionals only' : ''}`;
  if (tipo === 'approvata') {
    return `✅ **Your contract was approved**\n${dove}\n${cifre}\n`
      + `Approved by ${chi}. Wait for the auction to open, then bid.`;
  }
  if (tipo === 'rubata') {
    // `r` e' la richiesta NUOVA, quella rimessa in coda dal watcher.
    return `⚔️ **Your contract was taken by another unit**\n${dove}\n${cifre}\n`
      + 'The auction went to someone else, so your request was **put back in the queue in its original place**. '
      + 'The government has to approve it again.';
  }
  return `🔨 **The contract is posted — the auction is open!**\n${dove}\n${cifre}\n`
    + `Opened by ${chi}. The first bid usually lands within ~10 seconds.`;
}

/**
 * @param {object} r      la riga `request` aggiornata
 * @param {'approvata'|'aperta'|'rubata'} tipo
 * @param {string} chi    nome di chi ha agito
 * @param {number} [escludi]  id account di chi ha agito (non si avvisa)
 * Non lancia mai: un messaggio privato non deve far fallire l'azione che lo genera.
 */
async function notificaComandanti(r, tipo, chi, escludi = null) {
  try {
    if (!process.env.BOT_TOKEN) return;                    // niente bot, niente messaggi
    const account = new Map();                              // account.id → account
    const aggiungi = (a) => { if (a?.discord_id) account.set(a.id, a); };

    aggiungi(r.requested_by ? getAccountById(r.requested_by) : null);
    try {
      for (const warId of await capiUnita(r.mu_id)) aggiungi(findAccountByWarUserId(warId));
    } catch (err) {
      // Il gioco non risponde: resta almeno chi ha fatto la richiesta.
      console.warn('[dm] capi unita non letti:', err.message);
    }
    if (escludi != null) account.delete(escludi);
    if (!account.size) return;

    let paese = null;
    try { paese = (await paesiMappa()).get(r.country_id)?.name || null; } catch { /* resta null */ }
    const testo = testoDM(tipo, r, chi, paese);
    for (const a of account.values()) {
      registraEventoBot({ scopeType: 'dm', scopeId: a.discord_id, tipo: `dm_${tipo}`, requestId: r.id, testo });
    }
  } catch (err) {
    console.warn('[dm] notifica non registrata:', err.message);
  }
}

module.exports = { notificaComandanti, testoDM };
