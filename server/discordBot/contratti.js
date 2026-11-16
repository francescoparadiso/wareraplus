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
const DESC_MAX = 3600;                              // l'embed ne ammette 4096
const SENZA_MENZIONI = { parse: [] };

// ---------------------------------------------------------------------------
// Testi (in inglese: un canale ha dentro persone di lingue diverse)
// ---------------------------------------------------------------------------

const ERRORI = {
  non_collegato: 'Your Discord account is not linked to WarEra+ yet. Sign in with Discord at {tool} and link your game character in the private area — then try again.',
  non_verificato: 'Your Discord account is signed in but your game character is not verified yet. Finish the link at {tool} and try again.',
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
    .setTitle(`Contract request #${r.id}`)
    .setDescription(`**${r.battleLabel || r.battleId}**\n${st.testo}`)
    .addFields(
      { name: 'Unit', value: r.muNome || '?', inline: true },
      { name: 'Paid by', value: nomePaese || r.nomePaese || '—', inline: true },
      { name: 'Asked by', value: r.richiedente || '?', inline: true },
      { name: 'Min damage', value: num(r.minDamage), inline: true },
      { name: 'Budget', value: num(r.budget), inline: true },
      { name: 'Per 1,000', value: num(r.perK), inline: true },
    )
    .setFooter({ text: `Request ${r.id}${r.professionalsOnly ? ' · professionals only' : ''}` })
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

/** Una riga per richiesta, per lo sportello e per "Show all". */
function rigaRichiesta(r, conPaese) {
  const st = statoCarta(r);
  const dove = conPaese && r.nomePaese ? ` · ${r.nomePaese}` : '';
  return `${ICONE[st.chiave] || '•'} \`#${r.id}\` **${r.muNome || '?'}** — ${corto(r.minDamage)} dmg · ${num(r.budget)}${dove} · _${st.testo}_`;
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
// Comando (uno solo: pubblica lo sportello)
// ---------------------------------------------------------------------------

function definizioniComandi() {
  const ambito = (o) => o.setName('scope').setDescription('Whose desk this is').setRequired(true)
    .addChoices({ name: 'My nation (government)', value: 'country' }, { name: 'My military unit', value: 'mu' });

  return [new SlashCommandBuilder()
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
  let stato = { cursore: null, carte: {}, pannelli: {} };
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

  async function gestisciEvento(ev) {
    const r = ev.richiesta;
    toccaSportelli(r);                                   // prima del canale: serve anche senza
    if (!ev.canaleId) return;                            // nessun canale per questo ambito

    // Aggiornamento silenzioso della carta (nessun testo da pubblicare).
    if (ev.tipo.startsWith('carta_')) {
      const k = stato.carte[r?.id];
      if (!k || !r) return;
      try {
        const c = await canaleDi(k.canaleId);
        await c.messages.edit(k.messaggioId, cartaPayload(r, ev.nomePaese));
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
      const m = await canale.send({
        content: `${testa}${rigaSenzaDiscord(ev)}`,
        ...cartaPayload(r, ev.nomePaese),
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
          const definitivo = [50001, 50013, 10003].includes(err?.code) || n >= MAX_TENTATIVI;
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
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('POST', '/richiesta', {
      discordId: i.user.id, battleId, side, minDamage, perK,
      professionalsOnly: siNo(i.fields.getTextInputValue('pro')),
      note: i.fields.getTextInputValue('note') || undefined,
    });
    if (!r.ok) return i.editReply(messaggioErrore(r));
    const q = r.json.richiesta;
    return i.editReply(`Request **#${q.id}** sent: ${num(q.minDamage)} damage for ${num(q.budget)} (${num(q.perK)} per 1,000) on ${q.battleLabel}.\nThe government has been tagged; you will hear back in your unit's channel.`);
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
          label: `#${x.id} ${x.battleLabel || x.battleId}`.slice(0, 100),
          description: `${x.muNome || '?'} · ${corto(x.minDamage)} dmg · ${statoCarta(x).testo}`.slice(0, 100),
          value: String(x.id),
        }))))],
    });
  }

  async function onSceltaMia(i, modo) {                  // menu `wp:mine:edit|wd`
    const id = Number(i.values[0]);
    if (modo === 'wd') {
      await i.deferUpdate();
      const r = await api('POST', '/azione', { discordId: i.user.id, azione: 'cancel', requestId: id });
      return i.editReply({ content: r.ok ? `Request **#${id}** withdrawn.` : messaggioErrore(r), components: [] });
    }
    const r = await api('GET', `/mie?discordId=${i.user.id}`);
    const q = (r.json.richieste || []).find((x) => x.id === id);
    if (!q || q.status !== 'pending') {
      return i.update({ content: ERRORI.gia_decisa, components: [] });
    }
    return i.showModal(modulo(`wp:ed:${id}`, `Edit request #${id}`, q));
  }

  async function onInvioModifica(i) {                    // modulo `wp:ed:<id>`
    const id = Number(i.customId.split(':')[2]);
    const minDamage = leggiNumero(i.fields.getTextInputValue('dmg'));
    const perK = leggiNumero(i.fields.getTextInputValue('bounty'));
    if (!(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) return effimero(i, ERRORI.parametri_non_validi);
    await i.deferReply({ flags: EPHEMERAL });
    const r = await api('POST', '/modifica', {
      discordId: i.user.id, requestId: id, minDamage, perK,
      professionalsOnly: siNo(i.fields.getTextInputValue('pro')),
      note: i.fields.getTextInputValue('note') || '',
    });
    if (!r.ok) return i.editReply(messaggioErrore(r));
    return i.editReply(`Request **#${id}** updated: ${num(r.json.richiesta.minDamage)} damage for ${num(r.json.richiesta.budget)}.`);
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
    const lista = d.richieste.filter((r) => r.status === 'pending' && !r.esito).slice(0, 25);
    if (!lista.length) return i.editReply('No request is waiting for a decision.');
    return i.editReply({
      content: 'Pick a request to decide:',
      components: [new ActionRowBuilder().addComponents(
        // Il menu e' in un messaggio effimero: lo sportello d'origine non si
        // puo' dedurre dal messaggio, quindi viaggia nell'id.
        new StringSelectMenuBuilder().setCustomId(`wp:decide:${p.scope}:${p.scopeId}`).setPlaceholder('Pick one…').addOptions(lista.map((r) => ({
          label: `#${r.id} ${r.muNome || '?'} — ${r.battleLabel || r.battleId}`.slice(0, 100),
          description: `${corto(r.minDamage)} dmg · budget ${num(r.budget)}`.slice(0, 100),
          value: String(r.id),
        }))))],
    });
  }

  async function onSceltaDaDecidere(i, p) {              // menu `wp:decide` → carta con i bottoni
    const id = Number(i.values[0]);
    const d = await datiSportello(p.scope, p.scopeId);
    const r = d?.richieste.find((x) => x.id === id);
    if (!r) return i.update({ content: ERRORI.richiesta_inesistente, components: [] });
    return i.update({ content: '', ...cartaPayload(r, r.nomePaese) });
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
    return i.editReply(`Done — the contract desk is in <#${canale.id}>. Alerts for ${scope === 'country' ? 'your nation' : 'your unit'} go there too.`);
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
      if (i.isChatInputCommand()) {
        if (i.commandName === 'contract-desk') await onComandoSportello(i);
        return;
      }
      const id = i.customId || '';
      if (!id.startsWith('wp:')) return;                   // non e' nostro

      if (i.isModalSubmit()) {
        if (id.startsWith('wp:rq:')) await onInvioRichiesta(i);
        else if (id.startsWith('wp:ed:')) await onInvioModifica(i);
        return;
      }
      if (i.isStringSelectMenu()) {
        if (id === 'wp:pick') await onScelta(i);
        else if (id === 'wp:mine:edit') await onSceltaMia(i, 'edit');
        else if (id === 'wp:mine:wd') await onSceltaMia(i, 'wd');
        else if (id.startsWith('wp:decide:')) {
          const [, , scope, scopeId] = id.split(':');
          await onSceltaDaDecidere(i, { scope, scopeId });
        }
        return;
      }
      if (i.isButton()) {
        if (/^wp:(approve|reject|opened|cancel):\d+$/.test(id)) { await onBottoneCarta(i); return; }
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
    giro();
    setInterval(giro, POLL_MS).unref?.();
    console.log(`[contratti] in ascolto su ${apiBase}`);
  }

  if (client.isReady()) avvia().catch((e) => console.error('[contratti] avvio fallito:', e));
  else client.once(Events.ClientReady, () => avvia().catch((e) => console.error('[contratti] avvio fallito:', e)));

  return { giro, definizioniComandi };
}

module.exports = {
  attach, definizioniComandi, embedCarta, bottoniCarta, statoCarta, renderSportello, leggiNumero,
};
