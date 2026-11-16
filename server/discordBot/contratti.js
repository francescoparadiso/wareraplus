/* ══════════════════════════════════════════════════════════════════════
   BOT DISCORD — lo sportello dei contratti mercenari
   ----------------------------------------------------------------------
   Gira sul SECONDO VPS (quello dello script a1-creator), non su quello del
   cache-server, e non ha un database: è la bocca e le dita di
   `warera-plus-api` (server/plusApi/bot.js, sul VPS 1).

     bocca — ogni pochi secondi chiede gli avvisi in coda e li scrive nel
             canale giusto, taggando chi deve decidere
     dita  — quando qualcuno preme un bottone o invia un modulo, lo dice al
             server col solo id Discord; il server controlla chi è e se può,
             con le STESSE regole della pagina web

   ── TUTTO CON I BOTTONI ───────────────────────────────────────────────
   Un solo comando, `/contract-desk post`, che pubblica lo SPORTELLO: un
   messaggio fisso nel canale con l'elenco delle richieste e i bottoni.
   Tutto il resto si fa da lì.

   Per tutti        Request a contract · Edit mine · Withdraw mine · Refresh ·
                    Show all
   Per il governo   Pending (decidere da qui) · Open/Close desk · Who's tagged

   Oltre allo sportello, ogni richiesta nuova arriva come CARTA col suo
   Approva / Rifiuta e i tag: lo sportello è il quadro d'insieme, la carta è
   quello che suona sul telefono. Entrambi si riscrivono da soli quando
   qualcosa cambia, anche se si decide dal sito.

   ── PERCHÉ NON DECIDE NIENTE ──────────────────────────────────────────
   Qui non c'è nessun elenco di ministri, nessuna regola: si manda l'id
   Discord di chi ha cliccato e il server risponde sì o no. Un bug o un
   token rubato qui non permette di approvare per chi non può.

   ── CONVIVERE CON UN ALTRO BOT NELLO STESSO PROCESSO ──────────────────
   `attach(client, opzioni)` aggiunge solo i propri ascoltatori e ignora
   tutto ciò che non è suo (comando `contract-desk`, componenti `wp:`).
   Registra il comando con `commands.create` (upsert per nome), mai con
   `commands.set`, che sostituirebbe l'intero elenco di un altro bot.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder,
  StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  ChannelType, PermissionFlagsBits, Events,
} = require('discord.js');

const POLL_MS = 3000;
const TIMEOUT_MS = 15_000;
const EPHEMERAL = 64;                               // MessageFlags.Ephemeral
const CARTE_TENUTE_MS = 14 * 24 * 3600_000;
const MAX_TENTATIVI = 3;
const DM_VALIDO_MS = 2 * 3600_000;                   // un messaggio privato piu' vecchio non si manda
const DESC_MAX = 3600;                              // l'embed ne ammette 4096
const SENZA_MENZIONI = { parse: [] };

// ---------------------------------------------------------------------------
// Testi (in inglese: un canale ha dentro persone di lingue diverse)
// ---------------------------------------------------------------------------

const ERRORI = {
  non_collegato: 'You have not linked your game character yet. Type `/register` right here — it takes a minute and you do not need the website. Then try again.',
  non_verificato: 'Your game character is not verified yet. Type `/register` to finish the link, then try again.',
  personaggio_gia_collegato: 'That character is already linked to another Discord account. If it is yours, ask an admin to unlink it.',
  personaggio_inesistente: 'I could not find that character in the game.',
  id_non_valido: 'That character is not valid. Try `/register` again.',
  nome_troppo_corto: 'Type at least 2 letters of your in-game name.',
  nessuna_richiesta: 'There is no link in progress. Type `/register` to start.',
  codice_scaduto: 'The code expired (it lasts 30 minutes). Type `/register` to get a new one.',
  troppo_presto: 'Not so fast — wait a few seconds and press **Verify** again.',
  troppi_tentativi: 'Too many attempts with this code. Type `/register` to get a new one.',
  nazione_non_abilitata: 'Your nation is not enabled for the WarEra+ private area.',
  nessuna_unita: 'You do not command a military unit in game, so there is nothing to request a contract for.',
  non_comandi_questa_unita: 'You do not command that unit.',
  fuori_dalla_lista: 'That nation does not accept contract requests from your unit.',
  unita_esclusa: 'That nation has excluded your unit from contract requests.',
  sportello_chiuso: 'The government has closed the contract desk for now.',
  non_approvi_per_questa_nazione: 'You cannot manage mercenary contracts for this nation (it needs the manageMercenaryContracts right in government).',
  non_autorizzato: 'You are not allowed to do that.',
  gia_decisa: 'Somebody already decided this request.',
  gia_segnata_aperta: 'This auction was already marked as opened.',
  non_approvata: 'This request is not approved (any more).',
  gia_chiusa: 'This request is already closed.',
  richiesta_inesistente: 'That request no longer exists.',
  battaglia_non_in_corso: 'That battle is not running any more.',
  nessun_canale: 'This nation has no desk yet: someone from the government must run `/contract-desk post`.',
  burst_non_valido: 'The burst damage must be a number of at least 1,000 (like `500k`), or leave it empty.',
  parametri_non_validi: 'Some values are not valid. Minimum damage must be at least 1,000 and the bounty between 0.001 and 5 per 1,000 damage.',
  gioco_non_raggiungibile: 'The game did not answer. Try again in a moment.',
  bot_non_configurato: 'The WarEra+ server has no bot token configured.',
  non_autenticato: 'The bot could not authenticate with the WarEra+ server (check PLUS_BOT_TOKEN).',
};

const num = (n) => (n == null ? '?' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const corto = (n) => {
  if (n == null) return '?';
  const v = Number(n);
  if (v >= 1e6) return `${+(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${+(v / 1e3).toFixed(1)}k`;
  return String(v);
};

/** "1.5m", "500k", "1,000,000", "0,08" → numero. NaN se non si capisce. */
function leggiNumero(testo) {
  let s = String(testo || '').trim().toLowerCase().replace(/[\s_]/g, '');
  let molt = 1;
  const suf = s.slice(-1);
  if (suf === 'k') { molt = 1e3; s = s.slice(0, -1); }
  else if (suf === 'm') { molt = 1e6; s = s.slice(0, -1); }
  else if (suf === 'b') { molt = 1e9; s = s.slice(0, -1); }
  if (s.includes('.') && s.includes(',')) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v * molt : NaN;
}

/** "10m pro", "5 M pros", "pro 10m", "2mil professionals": qualcuno dice di
 *  avere professionisti scrivendolo a mano. Serve il suffisso (k/m/mil/b):
 *  "10 pro" da solo e' troppo ambiguo, e una falsa risposta costa piu' di una
 *  mancata. */
const SUFFISSO = '(?:k|m|mil|mln|million|b)';
const PRO = '(?:pro|pros|professional|professionals)';
const RE_PRO = new RegExp(
  `\\b\\d+(?:[.,]\\d+)?\\s*${SUFFISSO}\\b\\s*${PRO}\\b|\\b${PRO}\\b\\s*[:=-]?\\s*\\d+(?:[.,]\\d+)?\\s*${SUFFISSO}\\b`, 'i');
const parlaDiPro = (t) => RE_PRO.test(String(t || ''));

/** Il campo burst del modulo: vuoto → `null` (nessun burst); un numero ≥ 1.000 →
 *  il numero; qualunque altra cosa → `false`, cioe' "scrivilo bene" (meglio che
 *  scartare in silenzio quello che l'utente ha digitato). */
function leggiBurst(testo) {
  const t = String(testo || '').trim();
  if (!t) return null;
  const v = leggiNumero(t);
  return v >= 1000 ? Math.round(v) : false;
}

const siNo = (t) => /^(y|yes|s|si|sì|true|1|pro)/i.test(String(t || '').trim());

// ---------------------------------------------------------------------------
// Stato di una richiesta, a parole e a colori
// ---------------------------------------------------------------------------

const COLORI = {
  attesa: 0xf1c40f, approvata: 0x2ecc71, aperta: 0x3498db, rifiutata: 0xe74c3c,
  ritirata: 0x95a5a6, conforme: 0x2ecc71, altra_unita: 0xe74c3c,
  parametri_diversi: 0xe67e22, nessuna_offerta: 0x95a5a6, mai_aperta: 0x95a5a6,
};

const ESITI = {
  conforme: 'Won by the agreed unit',
  altra_unita: 'Taken by ANOTHER unit',
  parametri_diversi: 'Opened with different terms',
  nessuna_offerta: 'No valid bid',
  mai_aperta: 'Marked opened, but no auction ever appeared',
};

const ICONE = {
  attesa: '⏳', approvata: '✅', aperta: '🔨', rifiutata: '❌', ritirata: '↩️',
  conforme: '🏆', altra_unita: '⚔️', parametri_diversi: '⚠️', nessuna_offerta: '💤', mai_aperta: '❔',
};

/** Stato e colore, da quello che dice il server. L'esito (cosa ha detto il
 *  gioco) vince sullo stato (cosa hanno detto le persone). */
function statoCarta(r) {
  if (r.esito && ESITI[r.esito]) {
    return { chiave: r.esito, testo: `${ESITI[r.esito]}${r.esito === 'altra_unita' ? ' — the contract was stolen' : ''}` };
  }
  if (r.status === 'rejected') return { chiave: 'rifiutata', testo: `Rejected by ${r.approvatore || '?'}` };
  if (r.status === 'cancelled') return { chiave: 'ritirata', testo: 'Withdrawn' };
  if (r.status === 'approved' && r.openedAt) {
    return { chiave: 'aperta', testo: `Auction opened by ${r.apritore || '?'} — checking the result` };
  }
  if (r.status === 'approved') {
    return { chiave: 'approvata', testo: `Approved by ${r.approvatore || '?'} — open the auction in game, then press the button` };
  }
  return { chiave: 'attesa', testo: 'Waiting for a decision' };
}

const vivaR = (r) => !r.esito && (r.status === 'pending' || r.status === 'approved');

// ---------------------------------------------------------------------------
// La carta della richiesta (nel canale della nazione, col tag)
// ---------------------------------------------------------------------------

function embedCarta(r, nomePaese) {
  const st = statoCarta(r);
  const e = new EmbedBuilder()
    .setColor(COLORI[st.chiave] || COLORI.attesa)
    // Niente numero nel titolo: l'id interno non e' la posizione in coda (resta nel piede).
    .setTitle('Contract request')
    .setDescription(`**${r.battleLabel || r.battleId}**\n${st.testo}`)
    .addFields(
      { name: 'Unit', value: r.muNome || '?', inline: true },
      { name: 'Paid by', value: nomePaese || r.nomePaese || '—', inline: true },
      { name: 'Asked by', value: `${r.richiedente || '?'}${r.createdAt ? `\n${quandoDiscord(r.createdAt)}` : ''}`, inline: true },
      { name: 'Min damage', value: num(r.minDamage), inline: true },
      { name: 'Budget', value: num(r.budget), inline: true },
      { name: 'Per 1,000', value: num(r.perK), inline: true },
      ...(r.burstDamage ? [{ name: 'Burst now', value: num(r.burstDamage), inline: true }] : []),
    )
    .setFooter({ text: r.professionalsOnly ? 'Professionals only' : 'WarEra+ contract desk' })
    .setTimestamp(r.updatedAt || Date.now());
  if (r.note) e.addFields({ name: 'Note', value: String(r.note).slice(0, 300) });
  if (r.esito && (r.apertMinDamage != null || r.apertBudget != null)) {
    e.addFields({
      name: 'Opened in game with',
      value: `min damage ${num(r.apertMinDamage)} · budget ${num(r.apertBudget)}${r.finalPerK != null ? ` · final ${num(r.finalPerK)} per 1,000` : ''}`,
    });
  }
  return e;
}

/** I bottoni dipendono dallo stato: ognuno è la prossima cosa sensata. */
function bottoniCarta(r) {
  if (r.esito) return [];
  if (r.status === 'pending') {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wp:approve:${r.id}`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`wp:reject:${r.id}`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    )];
  }
  if (r.status === 'approved' && !r.openedAt) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`wp:opened:${r.id}`).setLabel('I opened the auction').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`wp:cancel:${r.id}`).setLabel('Withdraw').setStyle(ButtonStyle.Secondary),
    )];
  }
  return [];
}

const cartaPayload = (r, nomePaese) => ({ embeds: [embedCarta(r, nomePaese)], components: bottoniCarta(r) });

// ---------------------------------------------------------------------------
// Lo sportello (il pannello fisso)
// ---------------------------------------------------------------------------

/** Timestamp relativo di Discord ("12 minutes ago"): lo disegna e lo
 *  aggiorna il CLIENT di chi guarda, quindi lo sportello non va riscritto
 *  ogni minuto per tenerlo giusto. */
const quandoDiscord = (ms) => (ms ? `<t:${Math.floor(ms / 1000)}:R>` : '');

/** "12 min", "2 h 05 min": per i menu, dove i timestamp di Discord non si
 *  renderizzano e il testo e' scritto una volta sola. */
function durata(ms) {
  const min = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} d`;
}

/** Una riga per richiesta, per lo sportello e per "Show all". */
function rigaRichiesta(r, conPaese) {
  const st = statoCarta(r);
  const dove = conPaese && r.nomePaese ? ` · ${r.nomePaese}` : '';
  // "Da quanto aspetta": il momento della RICHIESTA, non quello dell'ultimo
  // cambio — un'unita' vuole sapere da quanto e' in coda, non da quanto il
  // bot ha riscritto la riga.
  const quando = r.createdAt ? ` · asked ${quandoDiscord(r.createdAt)}` : '';
  const burst = r.burstDamage ? ` (burst ${corto(r.burstDamage)})` : '';
  return `${ICONE[st.chiave] || '•'} **${r.muNome || '?'}** — ${corto(r.minDamage)} dmg${burst} · ${num(r.budget)}${dove}${quando} · _${st.testo}_`;
}

/** Raggruppa per battaglia, la più recente per prima. */
function perBattaglia(richieste) {
  const m = new Map();
  for (const r of richieste) {
    if (!m.has(r.battleId)) m.set(r.battleId, { battleId: r.battleId, label: r.battleLabel || r.battleId, righe: [], ultimo: 0 });
    const g = m.get(r.battleId);
    g.righe.push(r);
    g.ultimo = Math.max(g.ultimo, r.createdAt || 0);
  }
  // Dentro una battaglia la piu' vecchia per prima: e' quella che aspetta da piu'.
  for (const g of m.values()) g.righe.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  return [...m.values()].sort((a, b) => b.ultimo - a.ultimo);
}

function testoGruppo(g, conPaese) {
  return `**${g.label}** · [battle](https://app.warera.io/battle/${g.battleId})\n${g.righe.map((r) => rigaRichiesta(r, conPaese)).join('\n')}`;
}

/** Quanti gruppi entrano nello sportello, e quanti restano per "Show all". */
function dividiGruppi(gruppi, conPaese, spazio) {
  const dentro = [];
  let usati = 0;
  for (const g of gruppi) {
    const t = testoGruppo(g, conPaese);
    if (usati + t.length + 2 > spazio) break;
    dentro.push(t);
    usati += t.length + 2;
  }
  const restanti = gruppi.slice(dentro.length).reduce((n, g) => n + g.righe.length, 0);
  return { dentro, restanti };
}

function mentionOMome(m) {
  const chi = m.discordId ? `<@${m.discordId}>` : `**${m.nome || '?'}**`;
  return `${chi} _(${m.titolo})_`;
}

function renderSportello(d) {
  const nazione = d.scope === 'country';
  const righe = [];
  if (nazione && d.governo?.length) righe.push(d.governo.map(mentionOMome).join(' · '));
  if (!d.aperto) righe.push('**this desk is closed** — a government member can open it below');
  const intestazione = righe.join('\n');

  const vive = d.richieste.filter(vivaR);
  const gruppi = perBattaglia(d.richieste);
  const { dentro, restanti } = dividiGruppi(gruppi, !nazione, DESC_MAX - intestazione.length - 100);
  const corpo = dentro.length ? dentro.join('\n\n') : '_nobody waiting_';

  const nome = d.nome || (nazione ? 'Your nation' : 'Your unit');
  const embed = new EmbedBuilder()
    .setColor(d.aperto ? 0x5865f2 : 0x95a5a6)
    .setTitle(`${nome} — contract desk`)
    .setDescription(`${intestazione ? `${intestazione}\n\n` : ''}${corpo}`)
    .setFooter({ text: 'WarEra+ contract desk · a request is not a promise until the auction is won' })
    .setTimestamp(Date.now());

  const riga1 = [
    new ButtonBuilder().setCustomId('wp:req').setLabel('Request a contract').setEmoji('📝').setStyle(ButtonStyle.Primary).setDisabled(!d.aperto),
    new ButtonBuilder().setCustomId('wp:edit').setLabel('Edit mine').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wp:wd').setLabel('Withdraw mine').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('wp:ref').setLabel('Refresh').setStyle(ButtonStyle.Secondary),
  ];
  if (restanti > 0) {
    riga1.push(new ButtonBuilder().setCustomId('wp:all').setLabel(`Show all (${restanti} more)`).setEmoji('📋').setStyle(ButtonStyle.Secondary));
  }
  const righeBottoni = [new ActionRowBuilder().addComponents(riga1)];

  if (nazione) {
    const inAttesa = vive.filter((r) => r.status === 'pending').length;
    righeBottoni.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('wp:pend').setLabel(`Pending (${inAttesa})`).setEmoji('🗳️')
        .setStyle(inAttesa ? ButtonStyle.Success : ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('wp:desk').setLabel(d.aperto ? 'Close desk' : 'Open desk')
        .setStyle(d.aperto ? ButtonStyle.Danger : ButtonStyle.Success),
      new ButtonBuilder().setCustomId('wp:tags').setLabel("Who's tagged").setEmoji('📣').setStyle(ButtonStyle.Secondary),
    ));
  }
  return { embeds: [embed], components: righeBottoni, allowedMentions: SENZA_MENZIONI };
}

// ---------------------------------------------------------------------------
// La coda (/contract-queue)
// ---------------------------------------------------------------------------

/** "10M dmg (burst 5M)": il danno chiesto e, se dichiarato, quello fattibile subito. */
const dannoConBurst = (r) => `${corto(r.minDamage)} dmg${r.burstDamage ? ` (burst ${corto(r.burstDamage)})` : ''}`;

/**
 * La descrizione di una voce di menu (Discord: 100 caratteri). Mette i dati
 * nell'ordine dato e, con lo spazio che resta, la NOTA della richiesta fra
 * virgolette: e' cio' che chi decide deve leggere ("5M burst", "serve entro
 * le 21") e prima non c'era. La nota si accorcia con "…" solo se non entra, e
 * con meno di una decina di caratteri liberi si lascia perdere.
 */
function descrizioneVoce(r, parti) {
  // ⚠️ La lunghezza si conta in unita' UTF-16 (`.length`), come la valida
  // discord.js: un'emoji nella nota ne vale DUE, e contare i caratteri "veri"
  // sforava i 100 e il menu andava in errore. Si taglia per caratteri interi,
  // senza spezzare una coppia surrogata.
  const taglia = (s, n) => {
    if (s.length <= n) return s;
    let out = '';
    for (const ch of s) { if (out.length + ch.length > n - 1) break; out += ch; }
    return `${out}…`;
  };
  const base = parti.filter(Boolean).join(' · ');
  const nota = String(r.note || '').replace(/\s+/g, ' ').trim();
  const spazio = 100 - base.length - 5;                      // " · " + due virgolette
  if (!nota || spazio < 10) return taglia(base, 100);
  return `${base} · “${taglia(nota, spazio)}”`;
}

/** "~8 min", "~1 h 20 min": un tempo medio, senza il "fa" di `durata`. */
function tempoTipico(ms) {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `~${min} min`;
  const h = Math.floor(min / 60);
  return h < 48 ? `~${h} h ${String(min % 60).padStart(2, '0')} min` : `~${Math.round(h / 24)} d`;
}

const ATTESA_LUNGA_MS = 30 * 60_000;

/** Una riga della coda. Nella vista unita' conta DOVE sei (posizione presso
 *  quella nazione), in quella nazione conta CHI e da quanto. */
function rigaCoda(r, nazione, nuovoId = null) {
  // ⚠️ MAI l'id della richiesta nelle liste. E' il numero interno di TUTTE le
  // richieste mai fatte (chiuse, ritirate, di prova comprese): "#17" non dice
  // dove sei in coda, dice quanti contratti ci sono stati, ed era scambiato per
  // la posizione. L'unico numero che interessa e' la POSIZIONE.
  const base = `**${r.muNome || '?'}** — ${corto(r.minDamage)} dmg${r.burstDamage ? ` (burst ${corto(r.burstDamage)})` : ''} · ${num(r.budget)}`;
  const dove = !nazione && r.nomePaese ? ` · ${r.nomePaese}` : '';
  const chi = nazione && r.richiedente ? ` · by ${r.richiedente}` : '';
  if (vivaR(r) && r.status === 'pending') {
    const lunga = nazione && r.createdAt && Date.now() - r.createdAt > ATTESA_LUNGA_MS ? '🔥 ' : '⏳ ';
    // Nella coda della nazione la posizione sta DAVANTI ("1."), in quella
    // dell'unita' in fondo ("2 of 7 waiting"): per un comandante conta quanti
    // ne ha davanti il suo contratto.
    const davanti = nazione && r.posizione ? `**${r.posizione}.** ` : '';
    const dietro = !nazione && r.posizione ? ` · **${r.posizione} of ${r.inCoda} waiting**` : '';
    // "questa": e' la richiesta della carta sopra. Vale per il messaggio appena
    // arrivato e per quando lo si riscrive, dove "NEW" sarebbe diventato falso.
    const nuova = nuovoId != null && r.id === nuovoId ? ' ← **this one**' : '';
    return `${lunga}${davanti}${base}${dove}${chi} · asked ${quandoDiscord(r.createdAt)}${dietro}${nuova}`;
  }
  if (vivaR(r) && !r.openedAt) {
    return `✅ ${base}${dove}${chi} · approved ${quandoDiscord(r.approvedAt)} — _auction not opened yet_`;
  }
  if (vivaR(r)) {
    return `🔨 ${base}${dove}${chi} · auction opened ${quandoDiscord(r.openedAt)} — _checking the result_`;
  }
  return rigaRichiesta(r, !nazione);
}

/**
 * @param {object} d  { vista, nome, richieste, decisione?, paesi? }
 * @param {object} [opz]
 * @param {number} [opz.evidenzia]  id della richiesta da segnare "this one"
 * @param {string} [opz.titolo]     al posto del titolo di default
 * @param {number} [opz.max]        tetto dei caratteri (lo snapshot sotto la carta ne ha meno spazio)
 */
function renderCoda(d, opz = {}) {
  const nazione = d.vista === 'nation';
  const vive = d.richieste.filter(vivaR);
  const ordina = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);        // la piu' vecchia per prima
  // La posizione in coda c'e' se la rotta /coda l'ha calcolata; altrimenti
  // (i dati dello sportello non la portano) e' l'ordine di arrivo qui.
  const inAttesa = vive.filter((r) => r.status === 'pending').sort(ordina)
    .map((r, k) => ({ ...r, posizione: r.posizione ?? k + 1 }));
  const gruppi = [
    ['Waiting for a decision', inAttesa],
    ['Approved — the auction is not open yet', vive.filter((r) => r.status === 'approved' && !r.openedAt).sort(ordina)],
    ['Auction open', vive.filter((r) => r.status === 'approved' && r.openedAt).sort(ordina)],
    // Le richieste CHIUSE (vinte, rubate, senza offerte, ritirate) non si mostrano
    // piu' nella coda: la coda e' quello che c'e' ancora da fare, e un elenco di
    // esiti vecchi di ore la riempiva di righe che non chiedono niente a nessuno.
    // L'esito resta sulla carta della richiesta e nello sportello.
  ].filter(([, righe]) => righe.length);

  const testa = [];
  const attesa = gruppi.find(([n]) => n === 'Waiting for a decision')?.[1] || [];
  if (nazione) {
    testa.push(attesa.length
      ? `**${attesa.length}** waiting · the oldest asked ${quandoDiscord(attesa[0].createdAt)}`
      : '**Nobody is waiting for a decision.**');
    const dec = Object.values(d.decisione || {})[0];
    if (dec) testa.push(`Typical decision time: **${tempoTipico(dec.medianaMs)}** (median of ${dec.n} decisions in the last 7 days)`);
  } else {
    for (const [cid, dec] of Object.entries(d.decisione || {})) {
      if (dec) testa.push(`Typical decision time at **${d.paesi?.[cid] || '?'}**: ${tempoTipico(dec.medianaMs)} (last 7 days, ${dec.n} decisions)`);
    }
  }

  let corpo = gruppi.map(([titolo, righe]) => `**${titolo}**\n${righe.map((r) => rigaCoda(r, nazione, opz.evidenzia)).join('\n')}`).join('\n\n');
  if (!corpo) corpo = nazione ? '_The queue is empty._' : '_Your unit has no open requests._';
  let testo = `${testa.join('\n')}${testa.length ? '\n\n' : ''}${corpo}`;
  const max = opz.max || 4000;
  if (testo.length > max) testo = `${testo.slice(0, max - 60).replace(/\n[^\n]*$/, '')}\n_…and more: press **Show all** on the desk._`;

  return new EmbedBuilder()
    .setColor(nazione ? 0x23a55a : 0x5865f2)
    .setTitle(opz.titolo || (nazione ? `${d.nome || 'Your nation'} — contract queue` : `${d.nome || 'Your unit'} — your requests`))
    .setDescription(testo)
    .setFooter({ text: 'WarEra+ contract queue · oldest first' })
    .setTimestamp(Date.now());
}

/** I bottoni sotto la coda: chiedere un contratto per tutti; per il governo
 *  un menu con le richieste su cui si puo' ancora agire (in attesa, o
 *  approvate e non ancora aperte). Scegliere una richiesta mostra la sua carta
 *  con Approve / Reject (o "I opened the auction"), cioe' gli stessi bottoni
 *  e gli stessi controlli di tutto il resto. */
function componentiCoda(d) {
  const nazione = d.vista === 'nation';
  const bottoni = [new ButtonBuilder().setCustomId('wp:req').setLabel('Request a contract').setEmoji('📝').setStyle(ButtonStyle.Primary)];
  if (!nazione) {
    bottoni.push(
      new ButtonBuilder().setCustomId('wp:edit').setLabel('Edit mine').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('wp:wd').setLabel('Withdraw mine').setStyle(ButtonStyle.Secondary),
    );
  }
  bottoni.push(new ButtonBuilder().setCustomId(`wp:qref:${d.vista}`).setLabel('Refresh').setStyle(ButtonStyle.Secondary));
  const righe = [new ActionRowBuilder().addComponents(bottoni)];

  if (nazione) {
    const decidibili = d.richieste
      .filter((r) => vivaR(r) && !(r.status === 'approved' && r.openedAt))
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, 25);
    if (decidibili.length) {
      let inFila = 0;                       // posizione fra le SOLE in attesa (l'ordine e' per arrivo)
      righe.push(new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`wp:decideq:country:${d.scopeId}`)
          .setPlaceholder('Decide a request… (oldest first)')
          .addOptions(decidibili.map((r) => ({
            label: `${r.muNome || '?'} — ${r.battleLabel || r.battleId}`.slice(0, 100),
            description: descrizioneVoce(r, r.status === 'pending'
              ? [`⏳ #${++inFila} in line`, `waiting ${durata(r.createdAt)}`, dannoConBurst(r), `budget ${num(r.budget)}`]
              : ['✅ approved — open the auction', dannoConBurst(r)]),
            value: String(r.id),
          }))),
      ));
    }
  }
  return righe;
}

// ---------------------------------------------------------------------------
// Comandi
// ---------------------------------------------------------------------------

function definizioniComandi() {
  const ambito = (o) => o.setName('scope').setDescription('Whose desk this is').setRequired(true)
    .addChoices({ name: 'My nation (government)', value: 'country' }, { name: 'My military unit', value: 'mu' });
  const pubblico = (o) => o.setName('public').setDescription('Post it in the channel instead of showing it only to you');

  return [new SlashCommandBuilder()
    .setName('contract')
    .setDescription('Ask for a mercenary contract for your unit')
    .setDMPermission(false)
    // Le opzioni obbligatorie vengono prima (lo vuole Discord).
    .addStringOption((o) => o.setName('battle').setDescription('The battle — start typing to search').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('damage').setDescription('Minimum damage, e.g. 10m or 500k').setRequired(true).setMaxLength(20))
    .addNumberOption((o) => o.setName('rate').setDescription('Bounty per 1,000 damage, e.g. 0.05').setRequired(true).setMinValue(0.001).setMaxValue(5))
    .addStringOption((o) => o.setName('side').setDescription('Which side your unit fights on — leave empty if only one is possible').setAutocomplete(true))
    .addStringOption((o) => o.setName('burst').setDescription('Damage you can do right away, e.g. 5m (optional)').setMaxLength(20))
    .addBooleanOption((o) => o.setName('pro').setDescription('Professionals only'))
    .addStringOption((o) => o.setName('note').setDescription('E.g. when your UM takes the pill or goes in debuff').setMaxLength(300)),
  new SlashCommandBuilder()
    .setName('register')
    .setDescription('Link your WarEra character to your Discord — no website needed')
    .setDMPermission(false),
  new SlashCommandBuilder()
    .setName('contract-queue')
    .setDescription('Check the contract queue')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('unit').setDescription("Commanders: your unit's requests and their place in the queue").addBooleanOption(pubblico))
    .addSubcommand((s) => s.setName('nation').setDescription('Government: your nation\'s whole queue, oldest first').addBooleanOption(pubblico)),
  new SlashCommandBuilder()
    .setName('contract-desk')
    .setDescription('Post or remove the contract desk in a channel')
    .setDMPermission(false)
    // Niente permessi Discord richiesti: chi puo' aprire lo sportello lo
    // decide il SERVER (governo della nazione / comandante dell'unita'), non
    // chi ha "Gestisci canali" in questo server — un ministro puo' non averlo.
    .addSubcommand((s) => s.setName('post').setDescription('Post the desk here (or in another channel)')
      .addStringOption(ambito)
      .addChannelOption((o) => o.setName('channel').setDescription('Defaults to this channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((s) => s.setName('remove').setDescription('Stop posting alerts and remove the desk')
      .addStringOption(ambito))];
}

// ---------------------------------------------------------------------------
// attach()
// ---------------------------------------------------------------------------

/**
 * @param {import('discord.js').Client} client
 * @param {object} opz
 * @param {string} opz.apiBase      es. https://warera-oracle.duckdns.org/warera-plus-api
 * @param {string} opz.botToken     BOT_TOKEN di plusApi (NON il token Discord)
 * @param {string} [opz.toolUrl]    dove si collega l'account (default il live)
 * @param {string} [opz.stateFile]  cursore + messaggi (default ./contratti-state.json)
 * @param {string} [opz.guildId]    registra il comando solo qui (istantaneo); senza: globale
 * @param {boolean} [opz.registraComandi=true]
 */
function attach(client, opz = {}) {
  const apiBase = String(opz.apiBase || '').replace(/\/+$/, '');
  const botToken = opz.botToken;
  if (!apiBase || !botToken) throw new Error('contratti.attach: servono apiBase e botToken');
  const toolUrl = opz.toolUrl || 'https://wareraplus.vercel.app/';
  const stateFile = opz.stateFile || path.join(process.cwd(), 'contratti-state.json');

  // ── Stato su disco: cursore degli eventi, carte e sportelli ───────────
  // `ricordi`: l'ultimo promemoria mandato in ogni canale (la sua coda si riscrive).
  let stato = { cursore: null, carte: {}, pannelli: {}, ricordi: {} };
  try { stato = { ...stato, ...JSON.parse(fs.readFileSync(stateFile, 'utf-8')) }; } catch { /* prima partenza */ }
  const salva = () => {
    try {
      // Scrittura atomica: un riavvio a meta' non deve lasciare un JSON
      // troncato, che farebbe ripartire dal "ultimo" perdendo gli avvisi.
      fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(stato));
      fs.renameSync(`${stateFile}.tmp`, stateFile);
    } catch (err) { console.warn('[contratti] stato non salvato:', err.message); }
  };

  // ── Il server ─────────────────────────────────────────────────────────
  async function api(metodo, percorso, corpo) {
    const res = await fetch(`${apiBase}/bot${percorso}`, {
      method: metodo,
      headers: { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let json = null;
    try { json = await res.json(); } catch { /* corpo non JSON */ }
    return { ok: res.ok, codice: res.status, json: json || {} };
  }

  const messaggioErrore = (r) => (ERRORI[r.json?.error] || `Something went wrong (${r.json?.error || `HTTP ${r.codice}`}).`)
    .replace('{tool}', toolUrl);

  const mention = (ids) => ids.map((id) => `<@${id}>`).join(' ');

  async function canaleDi(id) {
    const c = await client.channels.fetch(id);
    if (!c?.isTextBased?.()) throw new Error(`canale ${id} non testuale`);
    return c;
  }

  // ═════════════════════════════════════════════════════════════════════
  // SPORTELLI
  // ═════════════════════════════════════════════════════════════════════
  const chiave = (scope, scopeId) => `${scope}:${scopeId}`;
  const sportelloDiMessaggio = (messageId) => Object.entries(stato.pannelli)
    .map(([k, v]) => ({ key: k, ...v }))
    .find((p) => p.messaggioId === messageId) || null;

  async function datiSportello(scope, scopeId) {
    const r = await api('GET', `/scrivania?scope=${scope}&scopeId=${encodeURIComponent(scopeId)}`);
    return r.ok ? r.json : null;
  }

  /** Riscrive lo sportello col dato di adesso. Un messaggio sparito
   *  (cancellato a mano) toglie lo sportello dallo stato: non e' un guasto. */
  async function aggiornaSportello(key) {
    const p = stato.pannelli[key];
    if (!p) return;
    const d = await datiSportello(p.scope, p.scopeId);
    if (!d) return;
    try {
      const c = await canaleDi(p.canaleId);
      // Edit per id, senza fetch: riscrivere un proprio messaggio non richiede
      // "Read Message History", la fetch si'.
      await c.messages.edit(p.messaggioId, renderSportello(d));
    } catch (err) {
      if (err?.code === 10008 || err?.code === 10003) { delete stato.pannelli[key]; salva(); }
      else console.warn(`[contratti] sportello ${key} non aggiornato:`, err.message);
    }
  }

  // Un evento che tocca piu' richieste ravvicinate (approva, apri, esito)
  // riscrive lo sportello una volta sola: due secondi di tregua per chiave.
  const inAttesaAgg = new Map();
  function aggiornaSportelloDopo(key) {
    if (!stato.pannelli[key] || inAttesaAgg.has(key)) return;
    inAttesaAgg.set(key, setTimeout(() => {
      inAttesaAgg.delete(key);
      aggiornaSportello(key).catch(() => {});
    }, 2000));
  }

  /** Ogni evento con una richiesta riscrive gli sportelli della sua nazione
   *  e della sua unita'. */
  function toccaSportelli(r) {
    if (!r) return;
    aggiornaSportelloDopo(chiave('country', r.countryId));
    aggiornaSportelloDopo(chiave('mu', r.muId));
    aggiornaCarteDopo(r.countryId);
  }

  // ── La lista sotto OGNI carta in attesa ───────────────────────────────
  // Ogni carta porta il riquadro "Queue right now". Fotografato una volta,
  // diventava vecchio: una carta di venti minuti fa diceva "5 waiting" quando
  // ormai erano 8, e il governo non sapeva quale credere. Ad ogni cambiamento di
  // quella nazione si riscrive la lista su TUTTE le carte ancora in attesa,
  // ciascuna con la propria richiesta segnata ("← this one"). Una sola lettura
  // dei dati per giro, e una pausa per accorpare piu' eventi ravvicinati.
  // Le carte gia' decise non portano piu' la lista: restano la sola carta.
  const inAttesaCarte = new Map();
  function aggiornaCarteDopo(countryId) {
    if (!countryId || inAttesaCarte.has(countryId)) return;
    inAttesaCarte.set(countryId, setTimeout(() => {
      inAttesaCarte.delete(countryId);
      aggiornaListeCarte(countryId).catch((err) => console.warn('[contratti] liste delle carte non aggiornate:', err.message));
    }, 2500));
  }

  /** La coda del momento, per il promemoria (nessuna richiesta segnata). */
  function embedCodaCorrente(d) {
    const attese = d.richieste.filter((x) => vivaR(x) && x.status === 'pending').length;
    return renderCoda(
      { vista: 'nation', nome: d.nome, richieste: d.richieste, decisione: {} },
      { max: 3500, titolo: `Current queue — ${attese} waiting` },
    );
  }

  /** Riscrive la coda sull'ultimo promemoria del canale dello sportello della
   *  nazione: una coda ferma al momento in cui e' stato mandato tornerebbe a
   *  dare numeri vecchi. */
  async function aggiornaCodaDelRicordo(countryId, d) {
    const sp = stato.pannelli[chiave('country', countryId)];
    const ric = sp && stato.ricordi[sp.canaleId];
    if (!ric) return;
    try {
      const c = await canaleDi(sp.canaleId);
      await c.messages.edit(ric.messaggioId, { embeds: [embedCodaCorrente(d)] });
    } catch (err) {
      if (err?.code === 10008 || err?.code === 10003) { delete stato.ricordi[sp.canaleId]; salva(); }
      else console.warn('[contratti] coda del promemoria non aggiornata:', err.message);
    }
  }

  async function aggiornaListeCarte(countryId) {
    const d = await datiSportello('country', countryId);
    if (!d) return;
    aggiornaCodaDelRicordo(countryId, d);
    const dati = { vista: 'nation', nome: d.nome, richieste: d.richieste, decisione: {} };
    const attese = d.richieste.filter((x) => vivaR(x) && x.status === 'pending').length;
    for (const r of d.richieste) {
      if (!(vivaR(r) && r.status === 'pending')) continue;
      const k = stato.carte[r.id];
      if (!k) continue;
      try {
        const c = await canaleDi(k.canaleId);
        const carta = cartaPayload(r, r.nomePaese);
        const lista = renderCoda(dati, { evidenzia: r.id, max: 3300, titolo: `Queue right now — ${attese} waiting` });
        await c.messages.edit(k.messaggioId, { ...carta, embeds: [...carta.embeds, lista] });
      } catch (err) {
        // Messaggio cancellato a mano: la carta non c'e' piu', non e' un guasto.
        if (err?.code === 10008 || err?.code === 10003) delete stato.carte[r.id];
        else console.warn(`[contratti] carta #${r.id} non aggiornata:`, err.message);
      }
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // EVENTI (bocca)
  // ═════════════════════════════════════════════════════════════════════

  /** Riga sotto la richiesta nuova: chi dovrebbe decidere e non e' taggabile. */
  function rigaSenzaDiscord(ev) {
    const nomi = ev.senzaDiscord || [];
    const altri = ev.senzaNome || 0;
    if (!nomi.length && !altri) return '';
    const elenco = [...nomi, altri ? `${altri} more` : null].filter(Boolean).join(', ');
    return `\n_Can approve but not linked to WarEra+ (so not tagged): ${elenco}._`;
  }

  /**
   * La LISTA sotto la carta: tutta la coda della nazione, con la richiesta della
   * carta segnata. Il governo che riceve un avviso deve vedere subito anche
   * cos'altro aspetta e da quanto — non solo questa richiesta, in isolamento — e
   * seguire la lista. Se i dati non arrivano si manda la sola carta: la lista e'
   * un di piu', non puo' bloccare l'avviso.
   */
  async function embedListaSotto(r) {
    try {
      const d = await datiSportello('country', r.countryId);
      if (!d) return null;
      const attese = d.richieste.filter((x) => vivaR(x) && x.status === 'pending').length;
      return renderCoda(
        { vista: 'nation', nome: d.nome, richieste: d.richieste, decisione: {} },
        { evidenzia: r.id, max: 3300, titolo: `Queue right now — ${attese} waiting` },
      );
    } catch { return null; }
  }

  async function gestisciEvento(ev) {
    // ── Messaggio privato al comandante (approvato / postato) ───────────
    // Un "approvato" che arriva dopo un'interruzione del bot e' una notizia
    // sbagliata, non in ritardo: oltre due ore si scarta.
    if (ev.scope?.type === 'dm') {
      if (Date.now() - (ev.at || 0) > DM_VALIDO_MS) return;
      const utente = await client.users.fetch(ev.scope.id);
      await utente.send({ content: String(ev.testo || '').slice(0, 1990), allowedMentions: SENZA_MENZIONI });
      return;
    }

    const r = ev.richiesta;
    toccaSportelli(r);                                   // prima del canale: serve anche senza
    if (!ev.canaleId) return;                            // nessun canale per questo ambito

    // Aggiornamento silenzioso della carta (nessun testo da pubblicare).
    if (ev.tipo.startsWith('carta_')) {
      const k = stato.carte[r?.id];
      if (!k || !r) return;
      try {
        const c = await canaleDi(k.canaleId);
        const carta = cartaPayload(r, ev.nomePaese);
        // Finche' aspetta una decisione la carta tiene la lista; poi e' solo la carta.
        const lista = r.status === 'pending' && !r.esito ? await embedListaSotto(r) : null;
        await c.messages.edit(k.messaggioId, lista ? { ...carta, embeds: [...carta.embeds, lista] } : carta);
      } catch (err) {
        // Messaggio cancellato a mano: la carta non c'e' piu', non e' un guasto.
        if (err?.code === 10008 || err?.code === 10003) delete stato.carte[r.id];
        else throw err;
      }
      return;
    }

    const canale = await canaleDi(ev.canaleId);
    const tag = ev.tag || [];
    const permessi = { parse: [], users: tag };

    // La richiesta nuova e' la CARTA con i bottoni, taggando chi decide.
    if (ev.tipo === 'nuova' && r) {
      const testa = tag.length
        ? `${mention(tag)} — a contract is waiting for a decision.`
        : 'A contract is waiting for a decision. _No approver here is linked to WarEra+, so nobody could be tagged._';
      const carta = cartaPayload(r, ev.nomePaese);
      const lista = await embedListaSotto(r);               // SEMPRE la lista, ad ogni richiesta nuova
      const m = await canale.send({
        content: `${testa}${rigaSenzaDiscord(ev)}`,
        ...carta,
        embeds: lista ? [...carta.embeds, lista] : carta.embeds,
        allowedMentions: permessi,
      });
      stato.carte[r.id] = { canaleId: canale.id, messaggioId: m.id, at: Date.now() };
      return;
    }

    // Tutto il resto e' un avviso a parole: stesso testo del webhook, piu' i tag.
    const testa = tag.length ? `${mention(tag)} ` : '';
    const coda = ev.tipo === 'persa_paese' ? rigaSenzaDiscord(ev) : '';
    await canale.send({ content: `${testa}${ev.testo}${coda}`.slice(0, 1990), allowedMentions: permessi });
  }

  const tentativi = new Map();
  let inGiro = false;

  async function giro() {
    if (inGiro) return;
    inGiro = true;
    try {
      if (stato.cursore == null) {
        const r = await api('GET', '/eventi?dopo=ultimo');
        if (!r.ok) return;
        stato.cursore = r.json.ultimo || 0;
        salva();
        return;
      }
      const r = await api('GET', `/eventi?dopo=${stato.cursore}`);
      if (!r.ok) return;
      for (const ev of r.json.eventi || []) {
        try {
          await gestisciEvento(ev);
        } catch (err) {
          const n = (tentativi.get(ev.id) || 0) + 1;
          tentativi.set(ev.id, n);
          console.warn(`[contratti] evento ${ev.id} (${ev.tipo}) non scritto, tentativo ${n}:`, err.message);
          // Canale senza permessi o sparito: inutile riprovare. Per il resto
          // si riprova qualche giro (Discord ha qualche secondo di cattivo umore).
          // 50007 = messaggi privati chiusi, 10013 = utente sconosciuto: riprovare non cambia niente.
          const definitivo = [50001, 50013, 10003, 50007, 10013].includes(err?.code) || n >= MAX_TENTATIVI;
          if (!definitivo) return;                         // il cursore NON avanza: si riprova
        }
        stato.cursore = ev.id;
        tentativi.delete(ev.id);
        for (const [k, c] of Object.entries(stato.carte)) {
          if (Date.now() - (c.at || 0) > CARTE_TENUTE_MS) delete stato.carte[k];
        }
        salva();
      }
    } catch (err) {
      console.warn('[contratti] giro fallito:', err.message);
    } finally {
      inGiro = false;
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // BOTTONI DELLE CARTE (approva / rifiuta / aperta / ritira)
  // ═════════════════════════════════════════════════════════════════════
  async function onBottoneCarta(i) {
    const [, azione, id] = i.customId.split(':');
    await i.deferUpdate();
    const r = await api('POST', '/azione', { discordId: i.user.id, azione, requestId: Number(id) });
    if (!r.ok) { await i.followUp({ content: messaggioErrore(r), flags: EPHEMERAL }); return; }
    // Il nome del paese non viaggia nella risposta dell'azione: si riprende
    // dal campo dell'embed gia' scritto, cosi' non si perde nel riscrivere.
    const prec = i.message?.embeds?.[0]?.fields?.find((f) => f.name === 'Paid by')?.value;
    await i.editReply(cartaPayload(r.json.richiesta, prec && prec !== '—' ? prec : null));
  }

  // ═════════════════════════════════════════════════════════════════════
  // I BOTTONI DELLO SPORTELLO
  // ═════════════════════════════════════════════════════════════════════
  const effimero = (i, contenuto) => i.reply({ ...(typeof contenuto === 'string' ? { content: contenuto } : contenuto), flags: EPHEMERAL, allowedMentions: SENZA_MENZIONI });

  const campo = (id, label, opz = {}) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label)
      .setStyle(opz.lungo ? TextInputStyle.Paragraph : TextInputStyle.Short)
      .setRequired(Boolean(opz.obbligatorio)).setMaxLength(opz.max || 100);
    // Vuoti non si impostano: l'API non li ama e discord.js nemmeno.
    if (opz.segnaposto) t.setPlaceholder(opz.segnaposto);
    if (opz.valore != null && String(opz.valore) !== '') t.setValue(String(opz.valore));
    return new ActionRowBuilder().addComponents(t);
  };

  /** Il modulo di una richiesta: nuova (con battaglia e lato nell'id) o modifica. */
  function modulo(customId, titolo, v = {}) {
    return new ModalBuilder().setCustomId(customId).setTitle(titolo).addComponents(
      campo('dmg', 'Minimum damage', { obbligatorio: true, segnaposto: 'e.g. 1000000, 1m or 500k', valore: v.minDamage }),
      campo('bounty', 'Bounty per 1,000 damage', { obbligatorio: true, segnaposto: 'e.g. 0.08', valore: v.perK }),
      // Facoltativo. Discord ammette al massimo 5 campi per modulo: questo e' il quarto
      // dei cinque (danno, taglia, burst, professionisti, nota).
      campo('burst', 'Burst damage, done right away (optional)', { segnaposto: 'e.g. 500k — what you can hit as soon as it opens', valore: v.burstDamage }),
      campo('pro', 'Professionals only? (yes / no)', { segnaposto: 'no', valore: v.professionalsOnly ? 'yes' : 'no', max: 5 }),
      campo('note', 'Note for the government (optional)', { lungo: true, max: 300, valore: v.note }),
    );
  }

  // ── Request a contract ────────────────────────────────────────────────
  async function onRichiedi(i) {
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('GET', `/battaglie?discordId=${i.user.id}`);
    if (!r.ok) return i.editReply(messaggioErrore(r));
    const opzioni = [];
    for (const b of r.json.battaglie || []) {
      for (const l of b.lati) {
        if (opzioni.length >= 25) break;
        opzioni.push({
          label: b.etichetta.slice(0, 100),
          description: `Fight for ${l.nome} (${l.side}) — ${corto(b.danno)} dmg so far`.slice(0, 100),
          value: `${b.id}|${l.side}`,
        });
      }
    }
    if (!opzioni.length) return i.editReply('There is no battle running where your unit can ask for a contract right now.');
    return i.editReply({
      content: 'Pick the battle and the side your unit fights on (that nation pays):',
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('wp:pick').setPlaceholder('Battle…').addOptions(opzioni))],
    });
  }

  async function onScelta(i) {                           // menu `wp:pick` → modulo
    const [battleId, side] = i.values[0].split('|');
    await i.showModal(modulo(`wp:rq:${battleId}:${side}`, 'Request a contract'));
  }

  async function onInvioRichiesta(i) {                   // modulo `wp:rq:<battle>:<side>`
    const [, , battleId, side] = i.customId.split(':');
    const minDamage = leggiNumero(i.fields.getTextInputValue('dmg'));
    const perK = leggiNumero(i.fields.getTextInputValue('bounty'));
    if (!(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) return effimero(i, ERRORI.parametri_non_validi);
    const burst = leggiBurst(i.fields.getTextInputValue('burst'));
    if (burst === false) return effimero(i, ERRORI.burst_non_valido);
    await i.deferReply({ flags: EPHEMERAL });
    return inviaRichiesta(i, {
      battleId, side, minDamage, perK, burst,
      pro: siNo(i.fields.getTextInputValue('pro')),
      note: i.fields.getTextInputValue('note') || undefined,
    });
  }

  /** L'invio vero, comune al modulo e al comando `/contract`: l'interazione e'
   *  gia' stata "differita" (deferReply), qui si manda al server e si risponde. */
  async function inviaRichiesta(i, d) {
    const r = await api('POST', '/richiesta', {
      discordId: i.user.id, battleId: d.battleId, side: d.side, minDamage: d.minDamage, perK: d.perK,
      burstDamage: d.burst || undefined,
      professionalsOnly: Boolean(d.pro),
      note: d.note || undefined,
    });
    if (!r.ok) return i.editReply(messaggioErrore(r));
    const q = r.json.richiesta;
    return i.editReply(`Request **sent**: ${num(q.minDamage)} damage${q.burstDamage ? ` (${num(q.burstDamage)} right away)` : ''} for ${num(q.budget)} (${num(q.perK)} per 1,000) on ${q.battleLabel}.\nThe government has been tagged; you will hear back in your unit's channel.`);
  }

  // ── /contract: la stessa richiesta, in una riga ───────────────────────
  // Per chi sa gia' cosa vuole: battaglia (con ricerca mentre si scrive), danno,
  // taglia e il resto facoltativo. Il lato si puo' omettere quando ce n'e' uno
  // solo possibile (di solito: la propria nazione e' alleata di uno solo). Danno e
  // burst sono TESTO, come nel modulo, cosi' "10m" e "500k" funzionano.
  const conLimite = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);

  async function onAutocompleta(i) {
    const f = i.options.getFocused(true);
    try {
      if (f.name === 'battle') {
        const r = await conLimite(api('GET', `/battaglie?discordId=${i.user.id}&q=${encodeURIComponent(f.value || '')}`), 2500);
        const lista = r.ok ? r.json.battaglie || [] : [];
        return await i.respond(lista.slice(0, 25).map((b) => ({ name: b.etichetta.slice(0, 100), value: b.id })));
      }
      if (f.name === 'side') {
        const id = i.options.getString('battle');
        if (!id) return await i.respond([]);
        const r = await conLimite(api('GET', `/battaglie?discordId=${i.user.id}&id=${encodeURIComponent(id)}`), 2500);
        const b = (r.ok ? r.json.battaglie || [] : [])[0];
        return await i.respond((b?.lati || []).map((l) => ({ name: `Fight for ${l.nome} (${l.side})`.slice(0, 100), value: l.side })));
      }
      return await i.respond([]);
    } catch {
      // Un autocompletamento che fallisce non mostra errori: lista vuota.
      try { await i.respond([]); } catch { /* scaduto o gia' risposto */ }
    }
  }

  async function onContratto(i) {
    const battleId = i.options.getString('battle', true);
    const minDamage = leggiNumero(i.options.getString('damage', true));
    const perK = i.options.getNumber('rate', true);
    const burst = leggiBurst(i.options.getString('burst'));
    if (!/^[a-f0-9]{24}$/.test(battleId)) return effimero(i, 'Pick the battle from the list that appears while you type in the **battle** box.');
    if (!(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) return effimero(i, ERRORI.parametri_non_validi);
    if (burst === false) return effimero(i, ERRORI.burst_non_valido);
    await i.deferReply({ flags: EPHEMERAL });

    let side = i.options.getString('side');
    if (!side) {
      // Lato omesso: va bene solo se per la tua unita' ce n'e' uno possibile.
      const r = await api('GET', `/battaglie?discordId=${i.user.id}&id=${encodeURIComponent(battleId)}`);
      if (!r.ok) return i.editReply(messaggioErrore(r));
      const lati = r.json.battaglie?.[0]?.lati || [];
      if (!lati.length) return i.editReply(ERRORI.battaglia_non_in_corso);
      if (lati.length > 1) return i.editReply(`Your unit can fight on either side of this battle, so I need to know which nation pays: ${lati.map((l) => `**${l.nome}** (${l.side})`).join(' or ')}. Run the command again and fill in **side**.`);
      side = lati[0].side;
    }
    return inviaRichiesta(i, {
      battleId, side, minDamage, perK, burst,
      pro: i.options.getBoolean('pro') || false,
      note: i.options.getString('note') || undefined,
    });
  }

  // ── Edit mine / Withdraw mine ─────────────────────────────────────────
  async function onMie(i, modo) {
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('GET', `/mie?discordId=${i.user.id}`);
    if (!r.ok) return i.editReply(messaggioErrore(r));
    // Si corregge solo finche' nessuno ha deciso; si ritira finche' e' viva.
    const lista = (r.json.richieste || []).filter((x) => (modo === 'edit' ? x.status === 'pending' : true));
    if (!lista.length) {
      return i.editReply(modo === 'edit'
        ? 'You have no request waiting for a decision. Once approved, numbers cannot change: withdraw and ask again.'
        : 'You have no open requests.');
    }
    return i.editReply({
      content: modo === 'edit' ? 'Which request do you want to edit?' : 'Which request do you want to withdraw?',
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`wp:mine:${modo}`).setPlaceholder('Pick one…').addOptions(lista.map((x) => ({
          label: `${x.battleLabel || x.battleId}`.slice(0, 100),
          description: descrizioneVoce(x, [`asked ${durata(x.createdAt)} ago`, dannoConBurst(x), statoCarta(x).testo]),
          value: String(x.id),
        }))))],
    });
  }

  async function onSceltaMia(i, modo) {                  // menu `wp:mine:edit|wd`
    const id = Number(i.values[0]);
    if (modo === 'wd') {
      await i.deferUpdate();
      const r = await api('POST', '/azione', { discordId: i.user.id, azione: 'cancel', requestId: id });
      return i.editReply({ content: r.ok ? 'Request **withdrawn**.' : messaggioErrore(r), components: [] });
    }
    const r = await api('GET', `/mie?discordId=${i.user.id}`);
    const q = (r.json.richieste || []).find((x) => x.id === id);
    if (!q || q.status !== 'pending') {
      return i.update({ content: ERRORI.gia_decisa, components: [] });
    }
    return i.showModal(modulo(`wp:ed:${id}`, 'Edit your request', q));
  }

  async function onInvioModifica(i) {                    // modulo `wp:ed:<id>`
    const id = Number(i.customId.split(':')[2]);
    const minDamage = leggiNumero(i.fields.getTextInputValue('dmg'));
    const perK = leggiNumero(i.fields.getTextInputValue('bounty'));
    if (!(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) return effimero(i, ERRORI.parametri_non_validi);
    const burst = leggiBurst(i.fields.getTextInputValue('burst'));
    if (burst === false) return effimero(i, ERRORI.burst_non_valido);
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('POST', '/modifica', {
      discordId: i.user.id, requestId: id, minDamage, perK,
      burstDamage: burst,                                   // null = campo svuotato = toglierlo
      professionalsOnly: siNo(i.fields.getTextInputValue('pro')),
      note: i.fields.getTextInputValue('note') || '',
    });
    if (!r.ok) return i.editReply(messaggioErrore(r));
    return i.editReply(`Request **updated**: ${num(r.json.richiesta.minDamage)} damage for ${num(r.json.richiesta.budget)}.`);
  }

  // ── Refresh / Show all ────────────────────────────────────────────────
  async function onAggiorna(i, p) {
    await i.deferUpdate();
    await aggiornaSportello(p.key);
  }

  async function onTutto(i, p) {
    await i.deferReply({ flags: EPHEMERAL });
    const d = await datiSportello(p.scope, p.scopeId);
    if (!d) return i.editReply(ERRORI.gioco_non_raggiungibile);
    const gruppi = perBattaglia(d.richieste).map((g) => testoGruppo(g, d.scope === 'mu'));
    const testo = gruppi.join('\n\n') || '_nobody waiting_';
    return i.editReply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle('All requests (open and closed in the last 24 h)').setDescription(testo.slice(0, 4000))] });
  }

  // ── Pending (il governo decide da qui) ────────────────────────────────
  async function onInAttesa(i, p) {
    await i.deferReply({ flags: EPHEMERAL });
    const d = await datiSportello(p.scope, p.scopeId);
    if (!d) return i.editReply(ERRORI.gioco_non_raggiungibile);
    // La piu' vecchia per prima: e' quella che aspetta da piu'.
    const lista = d.richieste.filter((r) => r.status === 'pending' && !r.esito)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)).slice(0, 25);
    if (!lista.length) return i.editReply('No request is waiting for a decision.');
    return i.editReply({
      content: 'Pick a request to decide:',
      components: [new ActionRowBuilder().addComponents(
        // Il menu e' in un messaggio effimero: lo sportello d'origine non si
        // puo' dedurre dal messaggio, quindi viaggia nell'id.
        new StringSelectMenuBuilder().setCustomId(`wp:decide:${p.scope}:${p.scopeId}`).setPlaceholder('Pick one…').addOptions(lista.map((r, k) => ({
          label: `${r.muNome || '?'} — ${r.battleLabel || r.battleId}`.slice(0, 100),
          // `lista` e' in ordine di arrivo e contiene solo le in attesa: la posizione e' k + 1.
          description: descrizioneVoce(r, [`⏳ #${k + 1} in line`, `waiting ${durata(r.createdAt)}`, dannoConBurst(r), `budget ${num(r.budget)}`]),
          value: String(r.id),
        }))))],
    });
  }

  // `nuovo`: il menu sta sotto la coda (/contract-queue), che deve restare dov'e':
  // la carta va in un NUOVO messaggio effimero. Dal bottone "Pending" invece il
  // menu e' un messaggio a parte e lo si sostituisce con la carta.
  async function onSceltaDaDecidere(i, p, nuovo = false) {
    const id = Number(i.values[0]);
    const d = await datiSportello(p.scope, p.scopeId);
    const r = d?.richieste.find((x) => x.id === id);
    if (!r) {
      return nuovo
        ? i.reply({ content: ERRORI.richiesta_inesistente, flags: EPHEMERAL })
        : i.update({ content: ERRORI.richiesta_inesistente, components: [] });
    }
    return nuovo
      ? i.reply({ ...cartaPayload(r, r.nomePaese), flags: EPHEMERAL, allowedMentions: SENZA_MENZIONI })
      : i.update({ content: '', ...cartaPayload(r, r.nomePaese) });
  }

  // ── Open / Close desk ─────────────────────────────────────────────────
  async function onSportello(i, p) {
    await i.deferUpdate();
    const d = await datiSportello(p.scope, p.scopeId);
    if (!d) return i.followUp({ content: ERRORI.gioco_non_raggiungibile, flags: EPHEMERAL });
    const r = await api('POST', '/scrivania/stato', { discordId: i.user.id, aperto: !d.aperto });
    if (!r.ok) return i.followUp({ content: messaggioErrore(r), flags: EPHEMERAL });
    await aggiornaSportello(p.key);
    return undefined;
  }

  // ── Who's tagged ──────────────────────────────────────────────────────
  async function onChiTaggo(i, p) {
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('GET', `/approvatori?scopeId=${encodeURIComponent(p.scopeId)}`);
    if (!r.ok) return i.editReply(messaggioErrore(r));
    const tag = r.json.tag || [];
    const senza = [...(r.json.senzaDiscord || []), r.json.senzaNome ? `${r.json.senzaNome} more` : null].filter(Boolean);
    return i.editReply({
      content: `**Tagged** when a contract needs a decision: ${tag.length ? mention(tag) : '_nobody_'}\n`
        + `**Can approve but not tagged** (not linked to WarEra+): ${senza.length ? senza.join(', ') : '_nobody_'}\n`
        + `_Anyone with the manageMercenaryContracts right (and the president and VP) can approve. To be tagged, sign in with Discord at ${toolUrl} and link your game character._`,
      allowedMentions: SENZA_MENZIONI,
    });
  }

  // ═════════════════════════════════════════════════════════════════════
  // /contract-desk
  // ═════════════════════════════════════════════════════════════════════
  async function onComandoSportello(i) {
    const scope = i.options.getString('scope', true);
    await i.deferReply({ flags: EPHEMERAL });

    if (i.options.getSubcommand() === 'remove') {
      const r = await api('POST', '/canale', { discordId: i.user.id, scope, remove: true });
      if (!r.ok) return i.editReply(messaggioErrore(r));
      // Il server dice di CHI era il canale: solo il proprio sportello si
      // toglie, quello di un'altra nazione non si tocca.
      const k = chiave(scope, r.json.scopeId);
      const p = stato.pannelli[k];
      if (p) {
        try { const c = await canaleDi(p.canaleId); await c.messages.delete(p.messaggioId); } catch { /* gia' sparito */ }
        delete stato.pannelli[k];
        salva();
      }
      return i.editReply('Done — the desk is removed and the bot stops posting alerts there.');
    }

    // ⚠️ Con il solo intent `Guilds` il canale dell'interazione puo' NON essere
    // nella cache (`i.channel` null), ne' lo e' il membro-bot da cui
    // `permissionsFor` prenderebbe i permessi: la prima versione rispondeva
    // "<#undefined>". Si usa l'id (sempre presente) e, per il canale in cui si
    // e' scritto il comando, i permessi che Discord stesso manda nell'interazione
    // (`appPermissions`); solo per un canale scelto a mano si calcolano.
    // Servono solo questi tre: scrivere lo sportello e le carte. Riscriverli
    // e cancellarli (propri messaggi, per id) non chiede altro.
    const PERMESSI = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
    const scelto = i.options.getChannel('channel');
    const canaleId = scelto?.id || i.channelId;
    let mancanti = null;                                   // null = non so dirlo
    try {
      if (!scelto) mancanti = i.appPermissions ? i.appPermissions.missing(PERMESSI) : null;
      else {
        const io = i.guild?.members?.me || await i.guild?.members?.fetchMe();
        const perm = scelto.permissionsFor?.(io);
        mancanti = perm ? perm.missing(PERMESSI) : null;
      }
    } catch { mancanti = null; }
    if (mancanti === null || mancanti.length) {
      // Dire QUALE permesso manca: "mi serve tutto" non dice dove guardare.
      const leggibile = (n) => String(n).replace(/([a-z])([A-Z])/g, '$1 $2');
      return i.editReply(mancanti === null
        ? `I cannot tell which permissions I have in <#${canaleId}>. I need **View Channel, Send Messages and Embed Links** there.`
        : `I cannot work in <#${canaleId}>: I am missing **${mancanti.map(leggibile).join(', ')}** there. Check the channel's permissions (and its category's) for the bot's role: a "deny" on the channel or the category wins over what the invite granted.`);
    }
    let canale;
    try { canale = await canaleDi(canaleId); }
    catch { return i.editReply(`I cannot see <#${canaleId}>: give the bot's role access to that channel and try again.`); }
    const r = await api('POST', '/canale', { discordId: i.user.id, scope, channelId: canale.id, guildId: i.guildId });
    if (!r.ok) return i.editReply(messaggioErrore(r));

    const scopeId = r.json.scopeId;
    const key = chiave(scope, scopeId);
    const d = await datiSportello(scope, scopeId);
    if (!d) return i.editReply(ERRORI.gioco_non_raggiungibile);

    // Un solo sportello per nazione/unita': se ce n'era un altro, via.
    const vecchio = stato.pannelli[key];
    if (vecchio) {
      try { const c = await canaleDi(vecchio.canaleId); await c.messages.delete(vecchio.messaggioId); } catch { /* gia' sparito */ }
    }
    const m = await canale.send(renderSportello(d));
    stato.pannelli[key] = { scope, scopeId, canaleId: canale.id, messaggioId: m.id };
    salva();
    provaAPinnare(key);                                   // se il bot ha il permesso, lo sportello resta in cima
    return i.editReply(`Done — the contract desk is in <#${canale.id}>. Alerts for ${scope === 'country' ? 'your nation' : 'your unit'} go there too.`);
  }

  // ═════════════════════════════════════════════════════════════════════
  // /register — collegare il personaggio senza passare dal sito
  // ═════════════════════════════════════════════════════════════════════
  // Il sito prova chi sei su Discord con OAuth e chi sei nel gioco con un
  // codice nel nome di un'azienda. Qui la prima prova e' l'id che Discord firma
  // in ogni interazione; la seconda e' IDENTICA (plusApi/verify.js, stesse
  // funzioni): nome → scelta fra gli omonimi → codice WP-XXXXXX → "Verify".
  //
  // Il modulo si apre SUBITO (Discord da' tre secondi per rispondere a un
  // comando): se la persona e' gia' collegata lo si scopre dopo l'invio.
  const discordNome = (u) => u.globalName || u.username;

  async function onRegistra(i) {
    await i.showModal(new ModalBuilder().setCustomId('wp:reg:nome').setTitle('Link your WarEra character')
      .addComponents(campo('nome', 'Your WarEra username', { obbligatorio: true, segnaposto: 'exactly as it appears in the game', max: 40 })));
  }

  async function onRegistraNome(i) {                      // modulo `wp:reg:nome`
    await i.deferReply({ flags: EPHEMERAL });
    const chi = await api('GET', `/utente?discordId=${i.user.id}`);
    if (chi.ok && chi.json.verificato) {
      return i.editReply(`You are already linked as **${chi.json.warUsername || '?'}**. Nothing to do — you can use the desk.`);
    }
    const r = await api('POST', '/registra/cerca', { discordId: i.user.id, username: i.fields.getTextInputValue('nome') });
    if (!r.ok) return i.editReply(messaggioErrore(r));
    const cand = r.json.candidati || [];
    if (!cand.length) return i.editReply('I found nobody with that name. Check the spelling and type `/register` again.');
    return i.editReply({
      content: `Which one is you?${r.json.troncato ? ' (showing the first matches — type more of your name to narrow it down)' : ''}`,
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId('wp:reg:pick').setPlaceholder('Pick your character…').addOptions(cand.map((c) => ({
          label: c.username.slice(0, 100),
          description: (c.nomePaese ? `Citizen of ${c.nomePaese}` : 'No country').slice(0, 100),
          value: c.warUserId,
        }))))],
    });
  }

  async function onRegistraScelta(i) {                    // menu `wp:reg:pick` → codice
    await i.deferUpdate();
    const r = await api('POST', '/registra/inizia', {
      discordId: i.user.id, discordUsername: discordNome(i.user), discordAvatar: i.user.avatar || null,
      warUserId: i.values[0],
    });
    if (!r.ok) return i.editReply({ content: messaggioErrore(r), components: [] });
    const codice = r.json.code;
    return i.editReply({
      content: `Hi **${r.json.warUsername}**! One more step, to prove the character is yours:\n\n`
        + `**1.** In the game, rename one of your companies so its name contains **\`${codice}\`**\n`
        + `    _e.g. "My Company ${codice}". You can change it back right after._\n`
        + '**2.** Wait a few seconds, then press **Verify**.\n\n'
        + '_The code works for 30 minutes and is tied to your character: nobody else can use it._',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('wp:reg:check').setLabel('Verify').setEmoji('✅').setStyle(ButtonStyle.Success))],
    });
  }

  async function onRegistraControlla(i) {                 // bottone `wp:reg:check`
    await i.deferUpdate();
    const r = await api('POST', '/registra/verifica', { discordId: i.user.id });
    if (r.ok && r.json.ok) {
      return i.editReply({
        content: `✅ **Linked!** You are **${r.json.warUsername}** (found the code in _${r.json.azienda}_). You can rename the company back.\n`
          + 'Now you can use the contract desk, and the bot can tag you and message you.',
        components: [],
      });
    }
    // Un fallimento NON sostituisce il messaggio: il codice deve restare a
    // portata di mano per riprovare. Si risponde a parte, in privato.
    if (r.ok && r.json.motivo === 'nessuna_azienda') {
      return i.followUp({ flags: EPHEMERAL, content: 'You have no companies in the game, so I cannot check a code. Ask an admin to link you by hand (tell them your Discord and your game name).' });
    }
    if (r.ok) {
      const lista = (r.json.aziende || []).slice(0, 6).map((n) => `_${n}_`).join(', ');
      return i.followUp({ flags: EPHEMERAL, content: `I cannot see the code yet. Your companies: ${lista || '—'}.\nMake sure one of them contains the code (exactly as shown), wait a few seconds and press **Verify** again.` });
    }
    return i.followUp({ flags: EPHEMERAL, content: messaggioErrore(r) });
  }

  // ═════════════════════════════════════════════════════════════════════
  // /contract-queue
  // ═════════════════════════════════════════════════════════════════════
  async function onCoda(i) {
    return rispondiCoda(i, i.options.getSubcommand(), Boolean(i.options.getBoolean('public')));
  }

  /** La coda, da `/contract-queue` e dal bottone "My queue" del promemoria. */
  async function rispondiCoda(i, vista, pubblica) {
    await i.deferReply(pubblica ? {} : { flags: EPHEMERAL });
    const r = await api('GET', `/coda?discordId=${i.user.id}&vista=${vista}`);
    if (!r.ok) {
      if (vista === 'nation' && r.json?.error === 'non_autorizzato') {
        return i.editReply('Only government members who can approve contracts can see the nation queue. Commanders can use `/contract-queue unit`.');
      }
      return i.editReply(messaggioErrore(r));
    }
    return i.editReply({ embeds: [renderCoda(r.json)], components: componentiCoda(r.json), allowedMentions: SENZA_MENZIONI });
  }

  /** "Refresh" sotto la coda: la riscrive con i dati di adesso (dopo aver
   *  approvato qualcosa la coda sopra sarebbe vecchia). */
  async function onAggiornaCoda(i) {
    const vista = i.customId.split(':')[2] === 'nation' ? 'nation' : 'unit';
    await i.deferUpdate();
    const r = await api('GET', `/coda?discordId=${i.user.id}&vista=${vista}`);
    if (!r.ok) return i.followUp({ content: messaggioErrore(r), flags: EPHEMERAL });
    return i.editReply({ embeds: [renderCoda(r.json)], components: componentiCoda(r.json), allowedMentions: SENZA_MENZIONI });
  }

  // ═════════════════════════════════════════════════════════════════════
  // Smistamento
  // ═════════════════════════════════════════════════════════════════════
  const SPORTELLO = {
    'wp:ref': onAggiorna, 'wp:all': onTutto, 'wp:pend': onInAttesa,
    'wp:desk': onSportello, 'wp:tags': onChiTaggo,
  };

  client.on('interactionCreate', async (i) => {
    try {
      if (i.isAutocomplete()) {
        if (i.commandName === 'contract') await onAutocompleta(i);
        return;
      }
      if (i.isChatInputCommand()) {
        if (i.commandName === 'contract') await onContratto(i);
        else if (i.commandName === 'contract-desk') await onComandoSportello(i);
        else if (i.commandName === 'contract-queue') await onCoda(i);
        else if (i.commandName === 'register') await onRegistra(i);
        return;
      }
      const id = i.customId || '';
      if (!id.startsWith('wp:')) return;                   // non e' nostro

      if (i.isModalSubmit()) {
        if (id === 'wp:reg:nome') await onRegistraNome(i);
        else if (id.startsWith('wp:rq:')) await onInvioRichiesta(i);
        else if (id.startsWith('wp:ed:')) await onInvioModifica(i);
        return;
      }
      if (i.isStringSelectMenu()) {
        if (id === 'wp:reg:pick') await onRegistraScelta(i);
        else if (id === 'wp:pick') await onScelta(i);
        else if (id === 'wp:mine:edit') await onSceltaMia(i, 'edit');
        else if (id === 'wp:mine:wd') await onSceltaMia(i, 'wd');
        else if (id.startsWith('wp:decide:') || id.startsWith('wp:decideq:')) {
          const [, tipo, scope, scopeId] = id.split(':');
          await onSceltaDaDecidere(i, { scope, scopeId }, tipo === 'decideq');
        }
        return;
      }
      if (i.isButton()) {
        if (/^wp:(approve|reject|opened|cancel):\d+$/.test(id)) { await onBottoneCarta(i); return; }
        if (id === 'wp:reg:check') { await onRegistraControlla(i); return; }
        if (id === 'wp:reg:start') { await onRegistra(i); return; }         // dal promemoria: apre il modulo
        if (id === 'wp:myq') { await rispondiCoda(i, 'unit', false); return; } // dal promemoria: la coda della mia unita'
        if (id.startsWith('wp:qref:')) { await onAggiornaCoda(i); return; }
        if (id === 'wp:req') { await onRichiedi(i); return; }
        if (id === 'wp:edit') { await onMie(i, 'edit'); return; }
        if (id === 'wp:wd') { await onMie(i, 'wd'); return; }
        const fn = SPORTELLO[id];
        if (!fn) return;
        // I bottoni dello sportello sanno quale sportello sono dal messaggio.
        const p = sportelloDiMessaggio(i.message?.id);
        if (!p) {
          await effimero(i, 'This desk is not active any more. Ask the government to run `/contract-desk post` again.');
          return;
        }
        await fn(i, p);
      }
    } catch (err) {
      console.error('[contratti] interazione fallita:', err);
      try {
        const msg = { content: 'Something went wrong on my side. Try again in a moment.', flags: EPHEMERAL };
        if (i.deferred || i.replied) await i.followUp(msg); else await i.reply(msg);
      } catch { /* l'interazione e' scaduta */ }
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // "10m pro" scritto a mano nel canale
  // ═════════════════════════════════════════════════════════════════════
  // Succede: invece di premere "Request a contract" qualcuno scrive "10m pro"
  // per dire che ha 10M di professionisti. Il governo non lo vede nella coda e
  // nessuno lo traccia. Il bot risponde e rimanda allo sportello.
  //
  // ⚠️ Serve l'intent PRIVILEGIATO `MessageContent` (Developer Portal → Bot →
  // Privileged Gateway Intents). Senza, `msg.content` e' vuoto e questa
  // funzione non fa niente: index.js riprova senza l'intent invece di cadere.
  //
  // Risponde SOLO nei canali dove c'e' uno sportello (non in tutto il server),
  // e una volta ogni 10 minuti per persona e canale: una risposta automatica
  // ripetuta a chi sta chiacchierando e' peggio del problema che risolve.
  const ultimaRisposta = new Map();
  const RISPOSTA_OGNI_MS = 10 * 60_000;

  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (msg.author?.bot || !msg.guildId || !msg.content) return;
      if (!parlaDiPro(msg.content)) return;
      const sportello = Object.values(stato.pannelli).find((p) => p.canaleId === msg.channelId);
      if (!sportello) return;
      const k = `${msg.channelId}:${msg.author.id}`;
      if (Date.now() - (ultimaRisposta.get(k) || 0) < RISPOSTA_OGNI_MS) return;
      ultimaRisposta.set(k, Date.now());

      const r = await api('GET', `/utente?discordId=${msg.author.id}`);
      const nonCollegato = r.ok && !r.json.verificato;
      const link = `https://discord.com/channels/${msg.guildId}/${sportello.canaleId}/${sportello.messaggioId}`;
      const uso = `Please use the **[contract desk](${link})**: press **📝 Request a contract**, pick the battle and fill in the form `
        + '(minimum damage like `10m`, the bounty per 1,000, and **professionals only: yes**). '
        + 'The government gets tagged and you can follow your place in the queue with `/contract-queue unit`.';
      const contenuto = nonCollegato
        ? `Hi! I can't recognise you yet, because you haven't linked your game character. Type **\`/register\`** right here — it takes a minute and you don't need the website. That is how I know who you are and can tag the government. Then ${uso.charAt(0).toLowerCase()}${uso.slice(1)}`
        : `Hi! Writing it here won't put it in the queue. ${uso}`;
      await msg.reply({ content: contenuto, allowedMentions: { repliedUser: true, parse: [] } });
    } catch (err) {
      console.warn('[contratti] risposta automatica non inviata:', err.message);
    }
  });

  // ═════════════════════════════════════════════════════════════════════
  // Tenere lo sportello in vista
  // ═════════════════════════════════════════════════════════════════════
  // In un canale dove si chiacchiera lo sportello finisce sotto decine di
  // messaggi e nessuno lo ritrova ("si perde"). Due cose:
  //
  //  1. si PINNA (se il bot ha il permesso: "Pin Messages" / "Manage Messages",
  //     che l'invito originale non dava — senza, si prova e si tace);
  //  2. se NON e' fra gli ultimi 10 messaggi del canale e di recente c'e' stata
  //     attivita' (qualcuno ha scritto negli ultimi 3 minuti), il bot manda un
  //     PROMEMORIA con le istruzioni e il link. Il promemoria conta come "sportello
  //     in vista": un secondo arriva solo dopo che altri 10 messaggi l'hanno
  //     sepolto, e mai piu' spesso di ogni 5 minuti (in un canale molto vivo
  //     ripeterlo di continuo sarebbe peggio del problema).
  //
  // Si controlla DOPO una breve pausa dall'ultimo messaggio, non ad ogni
  // messaggio: una raffica di venti messaggi e' un solo controllo, una sola
  // lettura dei dieci piu' recenti.
  //
  // Serve `Read Message History` per leggere gli ultimi messaggi (l'invito lo da').
  const RICORDO = {
    debounceMs: 20_000, ultimiN: 10, attivitaMs: 3 * 60_000, ognigMs: 5 * 60_000, ...(opz.ricordo || {}),
  };
  const INIZIO_RICORDO = '**Please try using the tool';
  const ultimoRicordo = new Map();                // canale → quando e' stato mandato l'ultimo
  const controlliInAttesa = new Map();            // canale → timer del controllo

  async function emojiDelSito(guild, nome) {
    if (!guild) return '';
    let e = guild.emojis?.cache?.find((x) => x.name === nome);
    if (!e) { try { await guild.emojis.fetch(); e = guild.emojis.cache.find((x) => x.name === nome); } catch { /* niente */ } }
    return e ? e.toString() : '';                 // non c'e': meglio nessuna emoji di ":nome:" scritto in chiaro
  }

  /**
   * I bottoni sotto il promemoria: chi legge il messaggio deve poter agire da
   * li', senza andare a cercare lo sportello pinnato. Sono gli stessi dello
   * sportello (stessi id, stessi gestori) piu' due scorciatoie: collegare il
   * personaggio (il primo passo, per chi non l'ha fatto) e "My queue".
   */
  function bottoniRicordo() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('wp:reg:start').setLabel('Link my character').setEmoji('🔗').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('wp:req').setLabel('Request a contract').setEmoji('📝').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('wp:edit').setLabel('Edit mine').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('wp:wd').setLabel('Withdraw mine').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('wp:myq').setLabel('My queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    );
  }

  async function testoRicordo(canale, sportello) {
    const link = `https://discord.com/channels/${canale.guildId || canale.guild?.id}/${sportello.canaleId}/${sportello.messaggioId}`;
    const emoji = await emojiDelSito(canale.guild, 'Behehehehe');
    return `${INIZIO_RICORDO} for better organization** 📋\n`
      + `The **[contract desk](${link})** is right here.\n\n`
      + '**How it works**\n'
      + '1️⃣ Type `/register` to link your account _(once, one minute, no website needed)_\n'
      + '2️⃣ Press **📝 Request a contract** below, then pick the battle and the side _(or just type_ `/contract`_)_\n'
      + '3️⃣ Put your **damage**, your **rate** (bounty per 1,000) and **how much damage you can burst** right away\n'
      + '4️⃣ In the note you can also write **when your UM will take the pill or go in debuff**\n'
      + '_The government gets tagged, and you can follow your place in line with_ `/contract-queue unit`\n\n'
      + `Please do not lie, we are trying to make the contract request easier for all of us ${emoji}`.trimEnd();
  }

  /** Il controllo vero: lo sportello (o un promemoria) e' fra gli ultimi messaggi? */
  async function controllaVisibilita(canaleId) {
    try {
      // In un canale possono esserci DUE sportelli (nazione e unita'): basta che
      // ne sia in vista uno, e il link del promemoria va a quello della nazione.
      const sportelli = Object.values(stato.pannelli).filter((p) => p.canaleId === canaleId);
      if (!sportelli.length) return;
      const sportello = sportelli.find((p) => p.scope === 'country') || sportelli[0];
      if (Date.now() - (ultimoRicordo.get(canaleId) || 0) < RICORDO.ognigMs) return;

      const canale = await canaleDi(canaleId);
      const ultimi = await canale.messages.fetch({ limit: RICORDO.ultimiN });
      const inVista = ultimi.some((m) => sportelli.some((p) => p.messaggioId === m.id)
        || (m.author?.id === client.user.id && String(m.content || '').startsWith(INIZIO_RICORDO)));
      if (inVista) return;
      // Attivita' recente: un canale fermo non ha bisogno di promemoria, e
      // scriverci a freddo e' solo rumore.
      const attivo = ultimi.some((m) => !m.author?.bot && Date.now() - m.createdTimestamp < RICORDO.attivitaMs);
      if (!attivo) return;

      ultimoRicordo.set(canaleId, Date.now());
      // Insieme alle istruzioni, la CODA di adesso: chi legge vede subito quanto
      // c'e' davanti. Se i dati non arrivano si manda il promemoria senza: la
      // coda e' un di piu', non puo' bloccarlo.
      let embeds = [];
      if (sportello.scope === 'country') {
        try {
          const d = await datiSportello('country', sportello.scopeId);
          if (d) embeds = [embedCodaCorrente(d)];
        } catch { /* senza coda */ }
      }
      const inviato = await canale.send({
        content: await testoRicordo(canale, sportello),
        embeds,
        components: [bottoniRicordo()],
        allowedMentions: { parse: [] },
      });
      if (embeds.length) { stato.ricordi[canaleId] = { messaggioId: inviato.id, at: Date.now() }; salva(); }
    } catch (err) {
      console.warn('[contratti] promemoria non inviato:', err.message);
    }
  }

  client.on(Events.MessageCreate, (msg) => {
    if (msg.author?.bot || !msg.guildId) return;
    if (!Object.values(stato.pannelli).some((p) => p.canaleId === msg.channelId)) return;
    if (controlliInAttesa.has(msg.channelId)) return;            // c'e' gia' un controllo in arrivo
    controlliInAttesa.set(msg.channelId, setTimeout(() => {
      controlliInAttesa.delete(msg.channelId);
      controllaVisibilita(msg.channelId);
    }, RICORDO.debounceMs));
  });

  // Pinnare lo sportello, una volta sola per sportello (con successo): il
  // messaggio di sistema "ha fissato un messaggio" non va ripetuto ad ogni avvio.
  let avvisoPin = false;
  async function provaAPinnare(key) {
    const p = stato.pannelli[key];
    if (!p || p.pinnato) return;
    try {
      const c = await canaleDi(p.canaleId);
      await c.messages.pin(p.messaggioId);
      p.pinnato = true; salva();
    } catch (err) {
      if (!avvisoPin) {
        console.warn('[contratti] non posso pinnare lo sportello (serve il permesso "Pin Messages" o "Manage Messages" al ruolo del bot):', err.message);
        avvisoPin = true;
      }
    }
  }

  // ── Partenza ──────────────────────────────────────────────────────────
  async function registraComandi() {
    // Uno per uno (create = upsert per nome): `set` cancellerebbe i comandi
    // di un eventuale altro bot che usa la stessa applicazione.
    for (const c of definizioniComandi()) {
      await client.application.commands.create(c.toJSON(), opz.guildId || undefined);
    }
    console.log(`[contratti] comandi registrati${opz.guildId ? ` nel server ${opz.guildId}` : ' (globali, fino a 1 ora per comparire)'}`);
  }

  async function avvia() {
    if (opz.registraComandi !== false) await registraComandi();
    // Gli sportelli gia' pubblicati prima di questa funzione: li si prova a pinnare.
    for (const k of Object.keys(stato.pannelli)) provaAPinnare(k);
    giro();
    setInterval(giro, POLL_MS).unref?.();
    console.log(`[contratti] in ascolto su ${apiBase}`);
  }

  if (client.isReady()) avvia().catch((e) => console.error('[contratti] avvio fallito:', e));
  else client.once(Events.ClientReady, () => avvia().catch((e) => console.error('[contratti] avvio fallito:', e)));

  return { giro, definizioniComandi };
}

module.exports = {
  attach, definizioniComandi, embedCarta, bottoniCarta, statoCarta, renderSportello, renderCoda, componentiCoda, leggiNumero, parlaDiPro,
};
