/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — avvisi su Discord
   ----------------------------------------------------------------------
   Il canale conta più della vista. Ministri e comandanti stanno già su
   Discord, con le notifiche del telefono attive; una schermata che va
   guardata di proposito non intercetta nessuno. Il tool aggiunge la
   memoria e la verifica, non chiede a tutti di trasferirsi altrove.

   Un webhook è un URL che il proprietario del canale genera da solo
   (Impostazioni canale → Integrazioni). Non serve un bot, non serve
   invitare niente, e chi l'ha creato può revocarlo quando vuole senza
   passare da noi.

   ── SEMPRE SENZA BLOCCARE, SEMPRE CON UN TETTO ────────────────────────
   Nessun avviso può far fallire l'azione che l'ha generato: se Discord è
   lento o il webhook è stato cancellato, la prenotazione resta comunque
   registrata. Un'approvazione che fallisce perché una notifica non parte
   sarebbe il peggiore dei due esiti possibili.

   ── COSA NON SI MANDA ─────────────────────────────────────────────────
   Mai l'URL del webhook nei log, e mai contenuto che non sia già
   pubblico nel gioco. Un avviso finisce in un canale che può avere
   centinaia di persone dentro: si dice cosa è successo, non si allega
   mezza banca dati.
   ══════════════════════════════════════════════════════════════════════ */

const { getWebhook } = require('./db');

const TIMEOUT_MS = 4000;

/** Solo i domini veri di Discord: un campo "incolla un URL" che accetta
 *  qualunque host è un modo comodo per far chiamare al server indirizzi
 *  scelti da qualcun altro. */
const WEBHOOK_VALIDO = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\//;

function urlWebhookValido(url) {
  return WEBHOOK_VALIDO.test(String(url || '').trim());
}

async function inviaA(url, contenuto) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: contenuto.slice(0, 1900), allowed_mentions: { parse: [] } }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[notify] webhook ha risposto ${res.status}`);
    return res.ok;
  } catch (err) {
    // Mai l'URL nel messaggio: contiene il token del webhook.
    console.warn('[notify] invio fallito:', err.name === 'AbortError' ? 'timeout' : err.message);
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Manda l'avviso al canale di un ambito, se ne è configurato uno.
 * Non attende: chi chiama non deve rallentare per una notifica.
 */
function avvisa(scopeType, scopeId, contenuto) {
  if (!scopeId) return;
  const w = getWebhook(scopeType, scopeId);
  if (!w) return;
  // Volutamente senza await: l'esito non cambia niente per il chiamante.
  inviaA(w.url, contenuto).catch(() => {});
}

// ---------------------------------------------------------------------------
// Testi
// ---------------------------------------------------------------------------
// In inglese e non nelle nove lingue del tool: un canale Discord ha dentro
// persone con lingue diverse, e non esiste una preferenza "del canale" da
// cui dedurre quale scegliere. L'inglese e' la lingua franca del gioco
// (59% dei giocatori, vedi la misura in warera-user-endpoint-fields).

const num = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US'));

function testoNuovaRichiesta(r, chi) {
  return `**New contract request** — ${r.mu_nome || r.mu_id}\n`
    + `Battle: ${r.battle_label || r.battle_id}\n`
    + `Min damage ${num(r.min_damage)} · budget ${num(r.budget)}`
    + `${r.professionals_only ? ' · professionals only' : ''}\n`
    + `Asked by ${chi}${r.note ? `\n> ${r.note.slice(0, 200)}` : ''}`;
}

function testoApprovata(r, chi) {
  return `**Approved** — ${r.mu_nome || r.mu_id}\n`
    + `Battle: ${r.battle_label || r.battle_id}\n`
    + `Min damage ${num(r.min_damage)} · budget ${num(r.budget)}\n`
    + `By ${chi}. Wait for the auction to open, then bid.`;
}

function testoRifiutata(r, chi) {
  return `**Rejected** — ${r.mu_nome || r.mu_id}\n`
    + `Battle: ${r.battle_label || r.battle_id}\nBy ${chi}.`;
}

/** L'avviso che conta: parte quando il ministro spunta "aperta", cioè
 *  potenzialmente PRIMA che l'asta esista. Nessun polling potrà mai
 *  battere questo, perché non si può rilevare una cosa che non c'è
 *  ancora — mentre un umano può annunciarla. */
function testoAperta(r, chi) {
  return `**Auction opening now** — ${r.mu_nome || r.mu_id}\n`
    + `Battle: ${r.battle_label || r.battle_id}\n`
    + `Min damage ${num(r.min_damage)} · budget ${num(r.budget)}`
    + `${r.professionals_only ? ' · professionals only' : ''}\n`
    + `Opened by ${chi}. First bid usually lands within ~10 seconds.`;
}

// ── Confini ─────────────────────────────────────────────────────────────
// Un messaggio per giro e per nazione (confini.js raggruppa). L'ora in cui
// il bonus comincia a contare si scrive in UTC e come timestamp Discord
// (<t:…:R>), che ogni lettore vede nel proprio fuso: un canale ha dentro
// persone di fusi diversi, e "alle 21" non vuol dire la stessa cosa a tutti.

const COSTRUZIONE_EN = { base: 'Military base', bunker: 'Bunker' };
const EVENTO_EN = {
  attivazione: 'switching ON',
  attivo: 'now ACTIVE',
  costruzione: 'construction started',
  livello_su: 'upgraded',
};
const RELAZIONE_EN = {
  guerra: 'at war with us', nemico_giurato: 'sworn enemy', alleato: 'ally',
  patto: 'defensive pact', nap: 'non-aggression pact', neutrale: 'neutral',
};

function testoConfini(eventi, nomePaese) {
  const righe = eventi.slice(0, 10).map((e) => {
    const quando = e.effettoIl ? ` — active <t:${Math.floor(e.effettoIl / 1000)}:R>` : '';
    const lv = e.livelloA ? ` lv.${e.livelloA}` : '';
    return `• **${e.regionNome}** (${nomePaese(e.ownerId)}, ${RELAZIONE_EN[e.relazione] || e.relazione}): `
      + `${COSTRUZIONE_EN[e.tipo] || e.tipo}${lv} ${EVENTO_EN[e.evento] || e.evento}${quando}\n`
      + `  borders ${(e.confinaCon || []).join(', ')}`;
  });
  const altri = eventi.length > 10 ? `\n…and ${eventi.length - 10} more` : '';
  return `**Border alert** — ${nomePaese(eventi[0]?.countryId)}\n${righe.join('\n')}${altri}\n`
    + '_A base gives attackers from that region an attack bonus; a bunker gives its defenders a defence bonus._';
}

module.exports = {
  avvisa, urlWebhookValido,
  testoNuovaRichiesta, testoApprovata, testoRifiutata, testoAperta,
  testoConfini,
};
