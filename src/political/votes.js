/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: la vista "Votazioni"
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): il congresso vota su WarEra+.
   Il gioco ha le elezioni ma non le votazioni di un'assemblea; il
   server e il perché delle regole (corpo elettorale fotografato,
   segreto, tempi dello scrutinio) stanno nella testata di
   server/plusApi/votazioni.js. Qui c'è solo come si mostrano.

   ── QUATTRO PEZZI ───────────────────────────────────────────────
     · l'ELENCO della nazione: in corso, programmate, archivio (con
       filtri per tipo ed esito), una scheda per votazione;
     · il MODULO per crearne una: lo vede chi governa o siede in
       congresso (lo dice il server in `poteri.puoCreare`);
     · la SCHEDA di una votazione: testo, regole, la cabina con i
       quattro voti, poi l'esito e il dettaglio dello scrutinio;
     · il CORPO ELETTORALE fotografato all'apertura, per partito.

   ── COSA SI RIDISEGNA ───────────────────────────────────────────
   Il modulo si costruisce UNA volta per apertura e non si tocca
   mentre si scrive. Nella scheda la cabina ha la sua chiave (fase +
   "ho votato"): il giro di aggiornamento ogni 20 s rifà il resto, ma
   la cabina solo se la chiave cambia — altrimenti la nota di una
   scheda nulla sparirebbe a metà frase. I conti alla rovescia li
   aggiorna un timer da un secondo, nel testo e basta; quando uno
   scade (apre, chiude, comincia o finisce lo scrutinio) si rilegge.

   ── L'ORA ───────────────────────────────────────────────────────
   Le fasi si contano sull'ora del SERVER (`ora` di ogni risposta),
   non su quella del computer di chi guarda: lo scrutinio deve
   cominciare per tutti nello stesso istante, e un orologio avanti di
   due minuti mostrerebbe l'esito prima degli altri. Lo scarto si
   misura a ogni risposta.

   Lo scrutinio si guarda nell'emiciclo (palese, votesHemicycle.js) o
   nell'urna (segreto, votesUrn.js): in diretta nella cabina durante lo
   scrutinio, poi fermo con "Rivedi" in cima all'esito.
   ══════════════════════════════════════════════════════════════ */

import '../styles/politicalVotes.css';
import { escapeHtml, getPartyColor, APP_BASE } from './config.js';
import { getLang } from './i18n.js';
import { vT, vErr } from './votesI18n.js';
import { hideOtherViews } from './plusViews.js';
import { mountHemicycle } from './votesHemicycle.js';
import { mountUrn } from './votesUrn.js';

/** Emiciclo per il palese, urna per il segreto: stessa firma. */
const montaScrutinio = (v, el, opz) => (v.scrutinio === 'palese' ? mountHemicycle : mountUrn)(el, { scrutinio: _scrutinio.dati, now, ...opz });
import {
  leggiVotazioni, leggiVotazione, leggiScrutinio, creaVotazione, vota, ritiraVotazione, impostaCanale,
  chiudiVotazione, eliminaVotazione,
  fetchMe, entraConDiscord, ApiError,
} from './votesApi.js';
import { state } from '../diplomacy/state.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { updateBackParams } from '../app/backNav.js';
import { trackEvent } from '../shared/analytics.js';

const VIEW_ID = 'wp-pol-votes-view';
const POLL_MS = 20_000;
const SCELTE = ['si', 'no', 'astenuto', 'nulla'];
const DURATE_MIN = [60, 120, 360, 720, 1440, 2880, 4320, 10080];

let _country = null;
let _list = null;            // { votazioni, poteri } | null
let _errore = null;          // 'non_deployato' | 'irraggiungibile' | null
let _account = null;
let _skew = 0;               // ora del server − ora locale
let _openId = null;          // votazione aperta nella scheda
let _detail = null;          // { votazione } della scheda
let _scrutinio = null;       // { id, dati | errore }
let _formOpen = false;
let _filtroTipo = 'tutti';
let _filtroEsito = 'tutti';
let _hemi = null;            // l'emiciclo montato, da fermare a ogni ridisegno
let _firmaResa = null;
let _ultimaRilettura = 0;
let _sceltaPendente = null;
let _invio = false;
let _seq = 0;
let _tick = null;
let _poll = null;
let _ricarica = false;
let _wired = false;

const now = () => Date.now() + _skew;

// ---------------------------------------------------------------------------
// Ingresso
// ---------------------------------------------------------------------------

export function isVotesViewOpen() {
  const el = document.getElementById(VIEW_ID);
  return !!el && el.style.display !== 'none';
}

/** Political resta montata a overlay chiuso (vedi pausePoliticalRendering):
 *  la vista "aperta" dietro un overlay chiuso non deve continuare a
 *  interrogare il server. */
const _visibile = () => isVotesViewOpen()
  && document.getElementById('wp-political-overlay')?.classList.contains('open') !== false;

/** Apre la vista sulla nazione (e, se data, sulla votazione `voteId`). */
export async function showVotesView(countryId, { voteId = null } = {}) {
  hideOtherViews('votes');
  const view = document.getElementById(VIEW_ID);
  if (!view) return;
  view.style.display = '';
  _wire(view);
  if (countryId !== _country) {
    _country = countryId;
    _list = null; _detail = null; _scrutinio = null; _formOpen = false;
    _openId = null;
  }
  if (voteId != null) _openId = Number(voteId) || null;
  _syncUrl();
  _startTimers();
  view.innerHTML = _skeleton();
  _renderHead();
  _paint(`<div class="panel wp-pol-loading">${escapeHtml(vT('loading'))}</div>`);
  await _load();
}

/** Chiamata da plusViews quando si passa a un'altra vista. */
export function stopVotesView() {
  clearInterval(_tick); _tick = null;
  clearInterval(_poll); _poll = null;
}

function _syncUrl() {
  updateBackParams('political', { tab: 'votes', vote: _openId || undefined });
}

function _startTimers() {
  stopVotesView();
  _tick = setInterval(_onTick, 1000);
  _poll = setInterval(() => { if (_visibile() && !document.hidden) _load({ silenzioso: true }); }, POLL_MS);
}

// ---------------------------------------------------------------------------
// Dati
// ---------------------------------------------------------------------------

async function _load({ silenzioso = false } = {}) {
  const seq = ++_seq;
  const country = _country;
  try {
    const [me, lista] = await Promise.all([
      fetchMe().catch(() => null),
      leggiVotazioni(country),
    ]);
    if (seq !== _seq || country !== _country) return;
    _account = me;
    _list = lista;
    _skew = (lista.ora || Date.now()) - Date.now();
    _errore = null;
    if (_openId) {
      const d = await leggiVotazione(_openId);
      if (seq !== _seq) return;
      _detail = d;
      if (d.votazione.nazione !== _country) { _openId = null; _detail = null; }
    }
    await _maybeLoadScrutinio();
  } catch (err) {
    if (seq !== _seq) return;
    if (err instanceof ApiError && err.stato === 404 && err.codice === 'votazione_sconosciuta') {
      _openId = null; _detail = null; _syncUrl();
    } else if (err instanceof ApiError && err.stato === 404) {
      _errore = 'non_deployato';
    } else if (!(err instanceof ApiError)) {
      _errore = 'irraggiungibile';
    } else if (!silenzioso) {
      _errore = 'irraggiungibile';
    }
  }
  if (seq !== _seq || !isVotesViewOpen()) return;
  _ricarica = false;
  // Niente di nuovo nelle fasi: si aggiorna l'affluenza al suo posto e
  // basta. Ridisegnare la scheda butterebbe via la nota che qualcuno sta
  // scrivendo sotto una scheda nulla (e il fuoco con lei).
  if (silenzioso && !_errore && _firma() === _firmaResa) { _aggiornaAffluenze(); return; }
  _render();
}

/** Cosa, se cambia, chiede di ridisegnare: le fasi, gli esiti, il proprio
 *  stato. L'affluenza no (vedi sopra). */
function _firma() {
  const voci = _openId && _detail ? [_detail.votazione] : (_list?.votazioni || []);
  return [_openId, Boolean(_account), _account?.verificato, _list?.poteri?.puoCreare,
    // Lo scrutinio arrivato (o no) cambia la scheda: emiciclo o attesa.
    _scrutinio?.id === _openId && Boolean(_scrutinio?.dati),
    ...voci.map((v) => `${v.id}:${fase(v)}:${v.stato}:${Boolean(v.esito)}:${v.esitoRiservato}:${v.mio?.haVotato}:${v.mio?.elettore}:${v.fineScrutinio}:${v.mio?.puoChiudere}`)].join('|');
}

function _aggiornaAffluenze() {
  const voci = _openId && _detail ? [_detail.votazione] : (_list?.votazioni || []);
  for (const v of voci) {
    const el = document.querySelector(`#${VIEW_ID} [data-wp-vt-turnout="${v.id}"]`);
    if (el) el.outerHTML = affluenza(v);
  }
}

/** Il dettaglio dello scrutinio (voti palesi, schede nulle, partecipanti):
 *  si chiede una volta sola, a esito visibile — o, nel palese, appena lo
 *  scrutinio comincia, perché l'emiciclo lo disegna in diretta. È
 *  sigillato, non cambia. Un 409 (orologio di chi guarda un soffio avanti
 *  sul server) NON si tiene: si riprova al giro dopo. */
async function _maybeLoadScrutinio() {
  const v = _detail?.votazione;
  if (!v) return;
  const diretta = fase(v) === 'scrutinio' && !v.esitoRiservato;
  if (!v.esito && !diretta) return;
  if (_scrutinio?.id === v.id && !_scrutinio.riprova) return;
  try {
    const r = await leggiScrutinio(v.id);
    _scrutinio = { id: v.id, dati: r.scrutinio };
  } catch (err) {
    _scrutinio = { id: v.id, errore: err?.codice || 'errore_server', riprova: err?.stato === 409 };
  }
}

// ---------------------------------------------------------------------------
// Fasi
// ---------------------------------------------------------------------------

/** La fase come la si mostra: quella del server, più le due dello
 *  scrutinio che si contano sull'orologio (urne chiuse → scrutinio →
 *  esito). */
function fase(v, t = now()) {
  if (v.stato === 'ritirata' || v.stato === 'programmata' || v.stato === 'in_apertura') {
    // Una programmata il cui orario è passato è "in apertura" finché il
    // server non la rilegge: non si mostra come ancora chiusa.
    if (v.stato === 'programmata' && t >= v.apre) return 'in_apertura';
    return v.stato;
  }
  if (v.stato === 'aperta') return t >= v.chiude ? 'urne_chiuse' : 'aperta';
  if (t < v.scrutinioAlle) return 'urne_chiuse';
  if (v.fineScrutinio == null || t < v.fineScrutinio) return 'scrutinio';
  return 'conclusa';
}

const IN_CORSO = new Set(['aperta', 'in_apertura', 'urne_chiuse', 'scrutinio']);

// ---------------------------------------------------------------------------
// Formati
// ---------------------------------------------------------------------------

const locale = () => getLang() || 'en';
const fmtNum = (n) => (n == null ? '—' : Number(n).toLocaleString(locale()));
const fmtDataOra = (ms) => new Date(ms).toLocaleString(locale(), {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});
const fmtOra = (ms) => new Date(ms).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function fmtDurata(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d) return `${d} ${vT('u_d')} ${h} ${vT('u_h')}`;
  if (h) return `${h} ${vT('u_h')} ${m} ${vT('u_m')}`;
  if (m) return `${m} ${vT('u_m')} ${sec} ${vT('u_s')}`;
  return `${sec} ${vT('u_s')}`;
}

/** Un conto alla rovescia che il timer aggiorna da sé. */
const cd = (ms) => `<span class="wp-vt-cd" data-wp-vt-cd="${ms}">${escapeHtml(fmtDurata(ms - now()))}</span>`;

const nomeNazione = (id) => state.nationMap?.get(id)?.name || vT('this_nation');

function flag(id) {
  const url = getFlagUrl(getNationCode(id, state.nationMap?.get(id)));
  return url ? `<img class="wp-vt-flag" src="${escapeHtml(url)}" alt="" loading="lazy">` : '';
}

function userLink(id, nome) {
  const n = nome || `#${String(id || '').slice(-6)}`;
  if (!id) return escapeHtml(n);
  return `<a href="${APP_BASE}/user/${encodeURIComponent(id)}" target="_blank" rel="noopener">${escapeHtml(n)}</a>`;
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);

// ---------------------------------------------------------------------------
// Pezzi comuni
// ---------------------------------------------------------------------------

function tags(v) {
  return `<span class="wp-pol-tag">${escapeHtml(vT(`corpo_${v.corpo}`))}</span>
    <span class="wp-pol-tag wp-vt-tag-${v.scrutinio}">${escapeHtml(vT(`scrutinio_${v.scrutinio}`))}</span>
    ${v.visibilita === 'istituzioni' ? `<span class="wp-pol-tag">🔒 ${escapeHtml(vT('vis_short_istituzioni'))}</span>` : ''}`;
}

function faseBadge(f) {
  return `<span class="wp-vt-fase wp-vt-fase-${f}">${escapeHtml(vT(`fase_${f}`))}</span>`;
}

function esitoBadge(e) {
  if (!e) return '';
  return `<span class="wp-vt-esito wp-vt-esito-${e.esito}">${escapeHtml(vT(`esito_${e.esito}`))}</span>`;
}

/** Quando: la frase che serve in questa fase. */
function quando(v, f) {
  switch (f) {
    case 'programmata': return `${escapeHtml(vT('opens_in'))} ${cd(v.apre)} · ${escapeHtml(fmtDataOra(v.apre))}`;
    case 'in_apertura': return escapeHtml(vT('opening_now'));
    case 'aperta': return `${escapeHtml(vT('closes_in'))} ${cd(v.chiude)} · ${escapeHtml(fmtDataOra(v.chiude))}`;
    case 'urne_chiuse': return `${escapeHtml(vT('count_starts_in'))} ${cd(v.scrutinioAlle)}`;
    case 'scrutinio': return v.fineScrutinio
      ? `${escapeHtml(vT('count_running'))} · ${escapeHtml(vT('result_at', { time: fmtOra(v.fineScrutinio) }))}`
      : escapeHtml(vT('count_running'));
    case 'ritirata': return escapeHtml(vT('withdrawn_on', { date: fmtDataOra(v.ritirataIl) }));
    default: return escapeHtml(vT('closed_on', { date: fmtDataOra(v.chiude) }));
  }
}

function affluenza(v) {
  const aventi = v.aventiDiritto;
  const p = pct(v.partecipanti, aventi);
  const quanti = aventi != null
    ? vT(v.stimati ? 'turnout_of_est' : 'turnout_of', { n: fmtNum(v.partecipanti), tot: fmtNum(aventi) })
    : vT('turnout_n', { n: fmtNum(v.partecipanti) });
  return `<div class="wp-vt-turnout" data-wp-vt-turnout="${v.id}">
    <div class="wp-vt-turnout-bar"><i style="width:${Math.min(100, p || 0)}%"></i></div>
    <span>${escapeHtml(quanti)}${p != null ? ` · ${p}%` : ''}</span>
  </div>`;
}

// ---------------------------------------------------------------------------
// Disegno
// ---------------------------------------------------------------------------

function _skeleton() {
  return `<div class="wp-vt">
    <div class="panel wp-vt-head" data-wp-vt="head"></div>
    <div data-wp-vt="form"></div>
    <div data-wp-vt="body"></div>
  </div>`;
}

const _slot = (k) => document.querySelector(`#${VIEW_ID} [data-wp-vt="${k}"]`);
const _paint = (html) => { const b = _slot('body'); if (b) b.innerHTML = html; };

function _render() {
  _firmaResa = _firma();
  _hemi?.stop(); _hemi = null;
  _renderHead();
  if (_errore) {
    _paint(`<div class="panel wp-pol-empty">${escapeHtml(vT(_errore === 'non_deployato' ? 'server_missing' : 'server_down'))}
      <div><button class="wp-vt-btn" data-act="retry">${escapeHtml(vT('retry'))}</button></div></div>`);
    return;
  }
  if (!_list) return;
  if (_openId && _detail) _renderDetail();
  else _renderList();
}

function _renderHead() {
  const el = _slot('head');
  if (!el) return;
  const p = _list?.poteri;
  let auth = '';
  if (!_errore && _list) {
    if (!_account) {
      auth = `<button class="wp-vt-btn wp-vt-btn-discord" data-act="login">${escapeHtml(vT('sign_in'))}</button>`;
    } else if (!_account.verificato && !_account.admin) {
      auth = `<span class="wp-pol-dim">${escapeHtml(vT('signed_as', { who: _account.discordUsername || '' }))}</span>
        <button class="wp-vt-btn wp-vt-btn-quiet" data-act="link-char">${escapeHtml(vT('link_char'))}</button>`;
    } else {
      auth = `<span class="wp-pol-dim">${escapeHtml(vT('signed_as', { who: _account.warUsername || _account.discordUsername || '' }))}</span>`;
    }
    if (p?.governa && !_formOpen) {
      auth += `<button class="wp-vt-btn wp-vt-btn-quiet" data-act="channel">🔔 ${escapeHtml(vT('ch_btn'))}${p.canale ? ' ✓' : ''}</button>`;
    }
    if (p?.puoCreare && !_formOpen) {
      auth += `<button class="wp-vt-btn wp-vt-btn-main" data-act="new">＋ ${escapeHtml(vT('new_vote'))}</button>`;
    }
  }
  el.innerHTML = `<div class="wp-vt-head-main">
      <div>
        <h2 class="wp-vt-title">${flag(_country)}🗳️ ${escapeHtml(vT('title'))} <span class="wp-pol-dim">— ${escapeHtml(nomeNazione(_country))}</span></h2>
        <div class="wp-vt-sub">${escapeHtml(vT('subtitle'))}</div>
      </div>
      <div class="wp-vt-head-auth">${auth}</div>
    </div>
    ${p?.erroreGioco ? `<div class="wp-pol-cov">${escapeHtml(vT('game_down'))}</div>` : ''}`;
}

// ── Elenco ────────────────────────────────────────────────────────

function _card(v) {
  const f = fase(v);
  const mio = v.mio;
  let mioChip = '';
  if (mio?.haVotato) mioChip = `<span class="wp-vt-chip wp-vt-chip-ok">✓ ${escapeHtml(vT('you_voted'))}</span>`;
  else if (f === 'aperta' && mio?.elettore) mioChip = `<span class="wp-vt-chip wp-vt-chip-call">${escapeHtml(vT('you_can_vote'))}</span>`;
  return `<article class="wp-vt-card wp-vt-card-${f}" data-act="open" data-id="${v.id}" tabindex="0">
    <div class="wp-vt-card-top">${faseBadge(f)}${tags(v)}${esitoBadge(v.esito)}</div>
    <h3>${escapeHtml(v.titolo)}</h3>
    <div class="wp-vt-card-when">${quando(v, f)}</div>
    ${f !== 'programmata' && f !== 'ritirata' ? affluenza(v) : ''}
    ${mioChip ? `<div class="wp-vt-card-mine">${mioChip}</div>` : ''}
  </article>`;
}

function _renderList() {
  const tutte = _list.votazioni || [];
  const inCorso = [], programmate = [], archivio = [];
  for (const v of tutte) {
    const f = fase(v);
    if (IN_CORSO.has(f)) inCorso.push(v);
    else if (f === 'programmata') programmate.push(v);
    else archivio.push(v);
  }
  inCorso.sort((a, b) => a.chiude - b.chiude);
  programmate.sort((a, b) => a.apre - b.apre);
  // L'archivio dalla più recente: chiusura, o ritiro per le ritirate.
  archivio.sort((a, b) => (b.ritirataIl || b.chiude) - (a.ritirataIl || a.chiude));

  const filtrate = archivio.filter((v) => {
    if (_filtroTipo !== 'tutti' && v.corpo !== _filtroTipo) return false;
    if (_filtroEsito === 'tutti') return true;
    if (_filtroEsito === 'ritirata') return v.stato === 'ritirata';
    return v.esito?.esito === _filtroEsito;
  });

  const gruppo = (titolo, righe, vuoto) => `<div class="panel wp-vt-group">
      <div class="panel-title">${escapeHtml(titolo)} <span class="badge-count">${righe.length}</span></div>
      ${righe.length ? `<div class="wp-vt-grid">${righe.map(_card).join('')}</div>` : `<div class="wp-pol-dim wp-vt-none">${escapeHtml(vuoto)}</div>`}
    </div>`;

  const opt = (val, cur, label) => `<option value="${val}"${val === cur ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  const filtri = `<div class="wp-vt-filters">
      <select data-wp-vt-filter="tipo" aria-label="${escapeHtml(vT('filter_type'))}">
        ${opt('tutti', _filtroTipo, vT('filter_all_types'))}
        ${['congresso', 'istituzioni', 'referendum'].map((k) => opt(k, _filtroTipo, vT(`corpo_${k}`))).join('')}
      </select>
      <select data-wp-vt-filter="esito" aria-label="${escapeHtml(vT('filter_outcome'))}">
        ${opt('tutti', _filtroEsito, vT('filter_all_outcomes'))}
        ${['approvata', 'respinta', 'quorum_mancato', 'ritirata'].map((k) => opt(k, _filtroEsito, vT(k === 'ritirata' ? 'fase_ritirata' : `esito_${k}`))).join('')}
      </select>
    </div>`;

  const archivioHtml = `<div class="panel wp-vt-group">
      <div class="panel-title">${escapeHtml(vT('group_archive'))} <span class="badge-count">${archivio.length}</span>${archivio.length ? filtri : ''}</div>
      ${filtrate.length ? `<div class="wp-vt-grid">${filtrate.map(_card).join('')}</div>`
        : `<div class="wp-pol-dim wp-vt-none">${escapeHtml(vT(archivio.length ? 'archive_none_match' : 'archive_empty'))}</div>`}
    </div>`;

  _paint(`${gruppo(vT('group_running'), inCorso, vT('running_empty'))}
    ${programmate.length ? gruppo(vT('group_scheduled'), programmate, '') : ''}
    ${archivioHtml}
    <div class="wp-pol-note">${escapeHtml(vT('list_note'))}</div>`);
}

// ── Scheda ────────────────────────────────────────────────────────

function regola(v) {
  const aventi = v.aventiDiritto;
  let r;
  if (v.maggioranza === 'assoluta') {
    r = vT('rule_assoluta', { n: aventi != null ? fmtNum(Math.floor(aventi / 2) + 1) : '—' });
  } else r = vT(`rule_${v.maggioranza}`);
  const q = v.quorum
    ? vT('rule_quorum', { q: v.quorum, n: aventi != null ? fmtNum(Math.ceil((aventi * v.quorum) / 100)) : '—' })
    : vT('rule_no_quorum');
  return { r, q };
}

function _renderDetail() {
  const v = _detail.votazione;
  const f = fase(v);
  const { r, q } = regola(v);
  const autore = v.creataDa ? userLink(v.creataDa.id, v.creataDa.nome) : '—';
  const testo = v.testoRiservato
    ? `<div class="wp-pol-cov">🔒 ${escapeHtml(vT('text_reserved'))}</div>`
    : v.testo ? `<div class="wp-vt-text">${escapeHtml(v.testo)}</div>`
    : `<div class="wp-pol-dim">${escapeHtml(vT('no_text'))}</div>`;

  _paint(`<button class="wp-vt-back" data-act="back">← ${escapeHtml(vT('back'))}</button>
    <div class="panel wp-vt-detail">
      <div class="wp-vt-card-top">${faseBadge(f)}${tags(v)}${esitoBadge(v.esito)}</div>
      <h2 class="wp-vt-detail-title">${escapeHtml(v.titolo)}</h2>
      <div class="wp-vt-by">${vT('proposed_by_html', { who: autore, date: escapeHtml(fmtDataOra(v.creataIl)) })}</div>
      <div class="wp-vt-when">${quando(v, f)}</div>
      <dl class="wp-vt-meta">
        <div><dt>${escapeHtml(vT('meta_electorate'))}</dt><dd>${escapeHtml(vT(`corpo_long_${v.corpo}`))}</dd></div>
        <div><dt>${escapeHtml(vT('meta_ballot'))}</dt><dd>${escapeHtml(vT(`scrutinio_long_${v.scrutinio}`))}</dd></div>
        <div><dt>${escapeHtml(vT('meta_rule'))}</dt><dd>${escapeHtml(r)}</dd></div>
        <div><dt>${escapeHtml(vT('meta_quorum'))}</dt><dd>${escapeHtml(q)}</dd></div>
        <div><dt>${escapeHtml(vT('meta_visibility'))}</dt><dd>${escapeHtml(vT(`vis_long_${v.visibilita}`))}</dd></div>
        <div><dt>${escapeHtml(vT('meta_window'))}</dt><dd>${escapeHtml(fmtDataOra(v.apre))} → ${escapeHtml(fmtDataOra(v.chiude))}</dd></div>
      </dl>
      ${f !== 'programmata' && f !== 'ritirata' ? affluenza(v) : ''}
      ${testo}
      ${v.scrutinio === 'segreto' ? `<div class="wp-pol-note">🔐 ${escapeHtml(vT('secret_note'))}</div>` : ''}
    </div>
    <div data-wp-vt="ballot"></div>
    <div data-wp-vt="result"></div>
    <div data-wp-vt="electorate"></div>
    ${v.mio?.puoEliminare ? `<div class="wp-vt-admin">
      <span class="wp-pol-dim">${escapeHtml(vT('admin_zone'))}</span>
      <button class="wp-vt-btn wp-vt-btn-danger" data-act="delete">🗑 ${escapeHtml(vT('delete_vote'))}</button>
    </div>` : ''}`);
  _renderBallot(v, f);
  _renderResult(v, f);
  _renderElectorate(v);
}

// ── La cabina ─────────────────────────────────────────────────────

function _renderBallot(v, f) {
  const el = _slot('ballot');
  if (!el) return;
  _sceltaPendente = null;
  const mio = v.mio;
  const box = (inner, cls = '') => `<div class="panel wp-vt-ballot ${cls}">${inner}</div>`;
  const mioVoto = () => {
    if (!mio?.haVotato) return '';
    if (mio.voto) {
      return `<div class="wp-vt-voted">✓ ${escapeHtml(vT('you_voted'))}:
        <span class="wp-vt-choice-chip wp-vt-c-${mio.voto.scelta}">${escapeHtml(vT(`scelta_${mio.voto.scelta}`))}</span>
        ${mio.voto.nota ? `<div class="wp-vt-nota">“${escapeHtml(mio.voto.nota)}”</div>` : ''}</div>`;
    }
    return `<div class="wp-vt-voted">✓ ${escapeHtml(vT('you_voted'))} <span class="wp-pol-dim">— ${escapeHtml(vT('your_vote_secret'))}</span></div>`;
  };

  if (f === 'ritirata') { el.innerHTML = ''; return; }
  if (f === 'programmata') {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">${escapeHtml(vT('ballot_scheduled'))} ${cd(v.apre)}</div>
      ${mio?.puoRitirare ? `<button class="wp-vt-btn wp-vt-btn-danger" data-act="withdraw">${escapeHtml(vT('withdraw'))}</button>` : ''}`);
    return;
  }
  if (f === 'in_apertura') {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">${escapeHtml(vT('ballot_opening'))}</div>`);
    return;
  }
  if (f === 'scrutinio' && _scrutinio?.id === v.id && _scrutinio.dati) {
    // Lo scrutinio in diretta (emiciclo o urna): uguale per tutti, alla stessa ora.
    el.innerHTML = box(`<div data-wp-vt="hemi"></div>${mioVoto()}`, 'wp-vt-ballot-live');
    _hemi = montaScrutinio(v, el.querySelector('[data-wp-vt="hemi"]'), { modo: 'diretta' });
    return;
  }
  if (f === 'urne_chiuse' || f === 'scrutinio') {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">🗳️ ${quando(v, f)}</div>${mioVoto()}`, 'wp-vt-ballot-wait');
    return;
  }
  if (f === 'conclusa') {
    el.innerHTML = mio?.haVotato ? box(mioVoto()) : '';
    return;
  }

  // Aperta. "Hanno votato tutti": lo decide il server (mio.puoChiudere),
  // e il bottone va in fondo a qualunque cabina, anche a chi non vota.
  const chiudi = mio?.puoChiudere ? `<div class="wp-vt-close-now">
      <span>✓ ${escapeHtml(vT('all_voted'))}</span>
      <button class="wp-vt-btn wp-vt-btn-main" data-act="close-now">${escapeHtml(vT('close_now'))}</button>
    </div>` : '';
  if (mio?.haVotato) { el.innerHTML = box(mioVoto() + chiudi); return; }
  if (!_account) {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">${escapeHtml(vT('login_to_vote'))}</div>
      <button class="wp-vt-btn wp-vt-btn-discord" data-act="login">${escapeHtml(vT('sign_in'))}</button>`);
    return;
  }
  if (!_account.verificato) {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">${escapeHtml(vT('link_to_vote'))}</div>
      <button class="wp-vt-btn wp-vt-btn-quiet" data-act="link-char">${escapeHtml(vT('link_char'))}</button>${chiudi}`);
    return;
  }
  if (mio?.elettore === false) {
    el.innerHTML = box(`<div class="wp-vt-ballot-msg">${escapeHtml(vT(`not_elector_${v.corpo}`, { nation: nomeNazione(v.nazione) }))}</div>${chiudi}`);
    return;
  }
  el.innerHTML = box(`<div class="wp-vt-ballot-q">${escapeHtml(vT('ballot_question'))}</div>
    <div class="wp-vt-choices">
      ${SCELTE.map((s) => `<button class="wp-vt-choice wp-vt-c-${s}" data-act="choose" data-scelta="${s}" aria-pressed="false">
        <span class="wp-vt-choice-ico">${({ si: '✓', no: '✗', astenuto: '○', nulla: '⊘' })[s]}</span>${escapeHtml(vT(`scelta_${s}`))}</button>`).join('')}
    </div>
    <div class="wp-vt-nota-wrap" hidden>
      <label for="wp-vt-nota">${escapeHtml(vT('null_note_label'))}</label>
      <textarea id="wp-vt-nota" maxlength="280" rows="2" placeholder="${escapeHtml(vT('null_note_ph'))}"></textarea>
    </div>
    <div class="wp-vt-confirm-row">
      <button class="wp-vt-btn wp-vt-btn-main" data-act="cast" disabled>${escapeHtml(vT('cast'))}</button>
      <span class="wp-pol-dim">${escapeHtml(vT(v.scrutinio === 'segreto' ? 'cast_note_secret' : 'cast_note_open'))}</span>
    </div>
    ${v.corpo === 'referendum' ? `<div class="wp-pol-note">${escapeHtml(vT('referendum_rules'))}</div>` : ''}
    <div class="wp-vt-err" hidden></div>`);
}

function _scegli(btn) {
  const box = btn.closest('.wp-vt-ballot');
  _sceltaPendente = btn.dataset.scelta;
  box.querySelectorAll('.wp-vt-choice').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const wrap = box.querySelector('.wp-vt-nota-wrap');
  wrap.hidden = _sceltaPendente !== 'nulla';
  if (!wrap.hidden) box.querySelector('textarea')?.focus();
  box.querySelector('[data-act="cast"]').disabled = false;
}

async function _vota(btn) {
  if (_invio || !_sceltaPendente || !_detail) return;
  const box = btn.closest('.wp-vt-ballot');
  const err = box.querySelector('.wp-vt-err');
  const nota = _sceltaPendente === 'nulla' ? box.querySelector('textarea')?.value.trim() : null;
  if (_sceltaPendente === 'nulla' && !nota) {
    err.hidden = false; err.textContent = vErr('nota_obbligatoria');
    return;
  }
  const v = _detail.votazione;
  if (!confirm(vT('cast_confirm', { choice: vT(`scelta_${_sceltaPendente}`) }))) return;
  _invio = true; btn.disabled = true; err.hidden = true;
  try {
    const r = await vota(v.id, _sceltaPendente, nota);
    _skew = (r.ora || Date.now()) - Date.now();
    _detail = { ..._detail, votazione: { ...r.votazione, elettori: _detail.votazione.elettori } };
    trackEvent('political-vote-cast', { ballot: v.scrutinio, corpo: v.corpo });
    _renderDetail();
    _load({ silenzioso: true });
  } catch (e) {
    err.hidden = false; err.textContent = vErr(e?.codice);
    btn.disabled = false;
  } finally {
    _invio = false;
  }
}

async function _ritira() {
  const v = _detail?.votazione;
  if (!v || _invio || !confirm(vT('withdraw_confirm'))) return;
  _invio = true;
  try {
    await ritiraVotazione(v.id);
    trackEvent('political-vote-withdraw');
    await _load();
  } catch (e) {
    alert(vErr(e?.codice));
  } finally {
    _invio = false;
  }
}

/** Chiusura anticipata: il server ricontrolla che abbiano votato tutti. */
async function _chiudiOra() {
  const v = _detail?.votazione;
  if (!v || _invio || !confirm(vT('close_now_confirm'))) return;
  _invio = true;
  try {
    await chiudiVotazione(v.id);
    trackEvent('political-vote-close-now');
    await _load();
  } catch (e) {
    alert(vErr(e?.codice));
  } finally {
    _invio = false;
  }
}

/** Cancellazione definitiva (solo amministratore): si torna all'elenco. */
async function _elimina() {
  const v = _detail?.votazione;
  if (!v || _invio || !confirm(vT('delete_confirm', { title: v.titolo }))) return;
  _invio = true;
  try {
    await eliminaVotazione(v.id);
    trackEvent('political-vote-delete');
    _openId = null; _detail = null; _scrutinio = null;
    _syncUrl();
    await _load();
  } catch (e) {
    alert(vErr(e?.codice));
  } finally {
    _invio = false;
  }
}

// ── L'esito ───────────────────────────────────────────────────────

function _renderResult(v, f) {
  const el = _slot('result');
  if (!el) return;
  if (f !== 'conclusa') { el.innerHTML = ''; return; }
  if (v.esitoRiservato) {
    el.innerHTML = `<div class="panel wp-vt-result"><div class="wp-pol-cov">🔒 ${escapeHtml(vT('result_reserved', { nation: nomeNazione(v.nazione) }))}</div></div>`;
    return;
  }
  const e = v.esito;
  if (!e) { el.innerHTML = `<div class="panel wp-pol-loading">${escapeHtml(vT('loading'))}</div>`; return; }
  const c = e.conteggi;
  const nonVotanti = Math.max(0, (e.aventiDiritto || 0) - e.presenti);
  const tot = Math.max(1, e.presenti + nonVotanti);
  const seg = (k, n) => (n > 0 ? `<i class="wp-vt-c-${k}" style="flex:${n}" title="${escapeHtml(vT(`scelta_${k}`))}: ${n}"></i>` : '');
  const cell = (label, val, cls = '') => `<div class="wp-vt-board-cell ${cls}"><div class="wp-vt-board-v">${val}</div><div class="wp-vt-board-l">${escapeHtml(label)}</div></div>`;

  const emiciclo = _scrutinio?.id === v.id && _scrutinio.dati;
  el.innerHTML = `<div class="panel wp-vt-result">
    ${emiciclo ? '<div data-wp-vt="hemi"></div>' : ''}
    <div class="wp-vt-stamp wp-vt-stamp-${e.esito}">${escapeHtml(vT(`stamp_${e.esito}`))}</div>
    <div class="wp-vt-board">
      ${cell(e.stimati ? vT('b_eligible_est') : vT('b_eligible'), fmtNum(e.aventiDiritto))}
      ${cell(vT('b_present'), fmtNum(e.presenti))}
      ${cell(vT('b_voters'), fmtNum(e.votanti))}
      ${cell(vT('b_majority'), fmtNum(e.soglia))}
      ${cell(vT('scelta_si'), fmtNum(c.si), 'wp-vt-c-si')}
      ${cell(vT('scelta_no'), fmtNum(c.no), 'wp-vt-c-no')}
      ${cell(vT('scelta_astenuto'), fmtNum(c.astenuto), 'wp-vt-c-astenuto')}
      ${cell(vT('scelta_nulla'), fmtNum(c.nulla), 'wp-vt-c-nulla')}
    </div>
    <div class="wp-vt-bar">${seg('si', c.si)}${seg('no', c.no)}${seg('astenuto', c.astenuto)}${seg('nulla', c.nulla)}${nonVotanti > 0 ? `<i class="wp-vt-c-assente" style="flex:${nonVotanti}" title="${escapeHtml(vT('absent'))}: ${nonVotanti}"></i>` : ''}</div>
    <div class="wp-vt-bar-legend wp-pol-dim">${escapeHtml(vT('bar_legend', { p: pct(e.presenti, tot) ?? 0 }))}</div>
    ${e.quorumServe != null ? `<div class="wp-vt-quorum ${e.quorumOk ? 'ok' : 'ko'}">${escapeHtml(vT(e.quorumOk ? 'quorum_ok' : 'quorum_ko', { n: fmtNum(e.quorumServe), p: fmtNum(e.presenti) }))}</div>` : ''}
    <div class="wp-pol-note">${escapeHtml(vT('result_rules_note'))}</div>
    <div data-wp-vt="breakdown">${_breakdown(v)}</div>
  </div>`;
  // A votazione conclusa emiciclo (tutto acceso) o urna (mucchi pieni),
  // con "Rivedi": il tabellone e il timbro qui sotto li ha già la scheda.
  if (emiciclo) {
    _hemi = montaScrutinio(v, el.querySelector('[data-wp-vt="hemi"]'), { modo: 'finale', tabellone: false });
  }
}

/** Il dettaglio dello scrutinio: per partito nel palese, schede nulle e
 *  partecipanti nel segreto. */
function _breakdown(v) {
  if (!_scrutinio || _scrutinio.id !== v.id) return `<div class="wp-pol-dim">${escapeHtml(vT('loading'))}</div>`;
  if (_scrutinio.errore) return `<div class="wp-pol-dim">${escapeHtml(vErr(_scrutinio.errore))}</div>`;
  const s = _scrutinio.dati;
  const elettori = s.elettori || [];
  const perId = new Map(elettori.map((e) => [e.id, e]));

  if (s.tipo === 'palese') {
    const voti = new Map((s.voti || []).map((x) => [x.id, x]));
    const righe = elettori.length ? elettori : (s.voti || []).map((x) => ({ id: x.id, nome: x.nome }));
    const gruppi = new Map();
    for (const e of righe) {
      const k = e.partito || '_';
      if (!gruppi.has(k)) gruppi.set(k, { nome: e.partitoNome || (e.partito ? vT('unknown_party') : vT('no_party')), partito: e.partito, righe: [] });
      gruppi.get(k).righe.push(e);
    }
    const ordinati = [...gruppi.values()].sort((a, b) => b.righe.length - a.righe.length);
    const nulle = (s.voti || []).filter((x) => x.s === 'nulla' && x.n);
    return `<h3 class="wp-vt-h3">${escapeHtml(vT('breakdown_open'))}</h3>
      <div class="wp-vt-parties">${ordinati.map((g) => {
        const conta = { si: 0, no: 0, astenuto: 0, nulla: 0, assente: 0 };
        g.righe.forEach((e) => { conta[voti.get(e.id)?.s || 'assente']++; });
        return `<div class="wp-vt-party" style="--pc:${g.partito ? getPartyColor(g.partito) : '#8b949e'}">
          <div class="wp-vt-party-head"><i></i><strong>${escapeHtml(g.nome)}</strong>
            <span class="wp-pol-dim">${SCELTE.concat('assente').filter((k) => conta[k]).map((k) => `${escapeHtml(vT(k === 'assente' ? 'absent' : `scelta_${k}`))} ${conta[k]}`).join(' · ')}</span></div>
          <ul>${g.righe.map((e) => {
            const x = voti.get(e.id);
            const k = x?.s || 'assente';
            return `<li><span class="wp-vt-choice-chip wp-vt-c-${k}">${escapeHtml(vT(k === 'assente' ? 'absent' : `scelta_${k}`))}</span>
              ${userLink(e.id, e.nome || x?.nome)}${e.ruolo && e.ruolo !== 'congress' ? ` <span class="wp-pol-tag">${escapeHtml(vT(`role_${e.ruolo}`))}</span>` : ''}</li>`;
          }).join('')}</ul></div>`;
      }).join('')}</div>
      ${nulle.length ? `<h3 class="wp-vt-h3">${escapeHtml(vT('null_notes'))}</h3><ul class="wp-vt-notes">${nulle.map((x) => `<li>“${escapeHtml(x.n)}” <span class="wp-pol-dim">— ${userLink(x.id, x.nome)}</span></li>`).join('')}</ul>` : ''}`;
  }

  const nulle = (s.sequenza || []).filter((x) => x.s === 'nulla' && x.n);
  const part = s.partecipanti || null;
  return `${nulle.length ? `<h3 class="wp-vt-h3">${escapeHtml(vT('null_notes'))}</h3><ul class="wp-vt-notes">${nulle.map((x) => `<li>“${escapeHtml(x.n)}”</li>`).join('')}</ul>` : ''}
    ${part ? `<h3 class="wp-vt-h3">${escapeHtml(vT('participants', { n: part.length }))}</h3>
      <div class="wp-vt-names">${part.map((id) => userLink(id, perId.get(id)?.nome)).join(', ') || '—'}</div>
      <div class="wp-pol-note">${escapeHtml(vT('participants_note'))}</div>` : ''}`;
}

// ── Il corpo elettorale ───────────────────────────────────────────

function _renderElectorate(v) {
  const el = _slot('electorate');
  if (!el) return;
  if (v.corpo === 'referendum') {
    el.innerHTML = v.aventiDiritto != null
      ? `<div class="panel wp-vt-electorate"><div class="panel-title">${escapeHtml(vT('electorate_title'))}</div>
          <div class="wp-pol-note">${escapeHtml(vT('electorate_referendum', { n: fmtNum(v.aventiDiritto), nation: nomeNazione(v.nazione) }))}</div></div>`
      : '';
    return;
  }
  const elettori = v.elettori;
  if (!elettori) {
    el.innerHTML = v.testoRiservato || v.aventiDiritto == null ? ''
      : `<div class="panel wp-vt-electorate"><div class="wp-pol-dim">${escapeHtml(vT('electorate_n', { n: fmtNum(v.aventiDiritto) }))}</div></div>`;
    return;
  }
  const gruppi = new Map();
  for (const e of elettori) {
    const k = e.partito || '_';
    if (!gruppi.has(k)) gruppi.set(k, { nome: e.partitoNome || (e.partito ? vT('unknown_party') : vT('no_party')), partito: e.partito, n: 0, righe: [] });
    const g = gruppi.get(k); g.n++; g.righe.push(e);
  }
  const ordinati = [...gruppi.values()].sort((a, b) => b.n - a.n);
  el.innerHTML = `<details class="panel wp-vt-electorate">
    <summary class="panel-title">${escapeHtml(vT('electorate_title'))} <span class="badge-count">${elettori.length}</span></summary>
    <div class="wp-pol-note">${escapeHtml(vT('electorate_note'))}</div>
    <div class="wp-vt-seats">${ordinati.map((g) => `<div class="wp-vt-party" style="--pc:${g.partito ? getPartyColor(g.partito) : '#8b949e'}">
      <div class="wp-vt-party-head"><i></i><strong>${escapeHtml(g.nome)}</strong> <span class="wp-pol-dim">${g.n}</span></div>
      <div class="wp-vt-names">${g.righe.map((e) => `${userLink(e.id, e.nome)}${e.ruolo && e.ruolo !== 'congress' ? ` <span class="wp-pol-tag">${escapeHtml(vT(`role_${e.ruolo}`))}</span>` : ''}`).join(', ')}</div>
    </div>`).join('')}</div>
  </details>`;
}

// ---------------------------------------------------------------------------
// Il modulo
// ---------------------------------------------------------------------------

function _apriModulo() {
  _formOpen = true;
  _renderHead();
  const el = _slot('form');
  if (!el) return;
  const radio = (name, val, title, desc, checked) => `<label class="wp-vt-opt">
      <input type="radio" name="${name}" value="${val}"${checked ? ' checked' : ''}>
      <span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(desc)}</small></span></label>`;
  const durata = (m) => (m < 1440 ? vT('dur_hours', { n: m / 60 }) : vT('dur_days', { n: m / 1440 }));
  el.innerHTML = `<form class="panel wp-vt-form" novalidate>
    <div class="panel-title">${escapeHtml(vT('form_title', { nation: nomeNazione(_country) }))}</div>
    <label class="wp-vt-field">${escapeHtml(vT('f_title'))}
      <input name="titolo" maxlength="120" required placeholder="${escapeHtml(vT('f_title_ph'))}"></label>
    <label class="wp-vt-field">${escapeHtml(vT('f_text'))}
      <textarea name="testo" maxlength="6000" rows="6" placeholder="${escapeHtml(vT('f_text_ph'))}"></textarea></label>
    <fieldset class="wp-vt-fs"><legend>${escapeHtml(vT('meta_electorate'))}</legend>
      ${radio('corpo', 'congresso', vT('corpo_congresso'), vT('corpo_desc_congresso'), true)}
      ${radio('corpo', 'istituzioni', vT('corpo_istituzioni'), vT('corpo_desc_istituzioni'))}
      ${radio('corpo', 'referendum', vT('corpo_referendum'), vT('corpo_desc_referendum'))}
    </fieldset>
    <fieldset class="wp-vt-fs"><legend>${escapeHtml(vT('meta_ballot'))}</legend>
      ${radio('scrutinio', 'palese', vT('scrutinio_palese'), vT('scrutinio_desc_palese'), true)}
      ${radio('scrutinio', 'segreto', vT('scrutinio_segreto'), vT('scrutinio_desc_segreto'))}
    </fieldset>
    <fieldset class="wp-vt-fs"><legend>${escapeHtml(vT('meta_visibility'))}</legend>
      ${radio('visibilita', 'istituzioni', vT('vis_istituzioni'), vT('vis_desc_istituzioni'), true)}
      ${radio('visibilita', 'pubblico', vT('vis_pubblico'), vT('vis_desc_pubblico'))}
    </fieldset>
    <div class="wp-vt-row">
      <label class="wp-vt-field">${escapeHtml(vT('meta_rule'))}
        <select name="maggioranza">
          <option value="semplice">${escapeHtml(vT('maj_semplice'))}</option>
          <option value="assoluta">${escapeHtml(vT('maj_assoluta'))}</option>
          <option value="due_terzi">${escapeHtml(vT('maj_due_terzi'))}</option>
        </select></label>
      <label class="wp-vt-field">${escapeHtml(vT('f_quorum'))}
        <input name="quorum" type="number" min="0" max="100" step="1" placeholder="${escapeHtml(vT('f_quorum_ph'))}"></label>
    </div>
    <div class="wp-vt-row">
      <label class="wp-vt-field">${escapeHtml(vT('f_opens'))}
        <select name="quando">
          <option value="subito">${escapeHtml(vT('f_opens_now'))}</option>
          <option value="programmata">${escapeHtml(vT('f_opens_later'))}</option>
        </select></label>
      <label class="wp-vt-field" data-wp-vt-when hidden>${escapeHtml(vT('f_opens_at'))}
        <input name="apre" type="datetime-local"></label>
      <label class="wp-vt-field">${escapeHtml(vT('f_duration'))}
        <select name="durataMin">${DURATE_MIN.map((m) => `<option value="${m}"${m === 1440 ? ' selected' : ''}>${escapeHtml(durata(m))}</option>`).join('')}</select></label>
    </div>
    <div class="wp-vt-summary"></div>
    <div class="wp-vt-err" hidden></div>
    <div class="wp-vt-confirm-row">
      <button type="submit" class="wp-vt-btn wp-vt-btn-main">${escapeHtml(vT('f_submit'))}</button>
      <button type="button" class="wp-vt-btn wp-vt-btn-quiet" data-act="cancel-form">${escapeHtml(vT('cancel'))}</button>
    </div>
  </form>`;
  const form = el.querySelector('form');
  form.addEventListener('input', () => _riassunto(form));
  form.addEventListener('change', () => _riassunto(form));
  form.addEventListener('submit', (ev) => { ev.preventDefault(); _inviaModulo(form); });
  _riassunto(form);
  form.querySelector('[name="titolo"]').focus();
}

/** Il canale Discord degli avvisi: stesso posto del modulo, uno alla
 *  volta, e come il modulo non si ridisegna mentre si incolla l'URL. */
function _apriCanale() {
  _formOpen = true;
  _renderHead();
  const el = _slot('form');
  if (!el) return;
  const attivo = Boolean(_list?.poteri?.canale);
  el.innerHTML = `<form class="panel wp-vt-form" novalidate>
    <div class="panel-title">${escapeHtml(vT('ch_title', { nation: nomeNazione(_country) }))}</div>
    <div class="wp-pol-note">${escapeHtml(vT('ch_note'))}</div>
    <div class="wp-pol-cov">${escapeHtml(vT(attivo ? 'ch_state_on' : 'ch_state_off'))} · ${escapeHtml(vT('ch_how'))}</div>
    <label class="wp-vt-field">Webhook
      <input name="url" type="url" autocomplete="off" placeholder="https://discord.com/api/webhooks/…"></label>
    <div class="wp-vt-err" hidden></div>
    <div class="wp-vt-confirm-row">
      <button type="submit" class="wp-vt-btn wp-vt-btn-main">${escapeHtml(vT('ch_save'))}</button>
      ${attivo ? `<button type="button" class="wp-vt-btn wp-vt-btn-danger" data-act="channel-remove">${escapeHtml(vT('ch_remove'))}</button>` : ''}
      <button type="button" class="wp-vt-btn wp-vt-btn-quiet" data-act="cancel-form">${escapeHtml(vT('cancel'))}</button>
    </div>
  </form>`;
  const form = el.querySelector('form');
  form.addEventListener('submit', (ev) => { ev.preventDefault(); _salvaCanale(form, form.querySelector('[name="url"]').value.trim()); });
  form.querySelector('[name="url"]').focus();
}

async function _salvaCanale(form, url) {
  if (_invio) return;
  const err = form.querySelector('.wp-vt-err');
  if (!url && !_list?.poteri?.canale) { err.hidden = false; err.textContent = vErr('url_non_valido'); return; }
  _invio = true; err.hidden = true;
  try {
    await impostaCanale(_country, url);
    trackEvent('political-vote-channel', { set: Boolean(url) });
    _chiudiModulo();
    await _load();
  } catch (e) {
    err.hidden = false; err.textContent = vErr(e?.codice);
  } finally {
    _invio = false;
  }
}

function _chiudiModulo() {
  _formOpen = false;
  const el = _slot('form');
  if (el) el.innerHTML = '';
  _renderHead();
}

function _datiModulo(form) {
  const fd = new FormData(form);
  const programmata = fd.get('quando') === 'programmata';
  const apre = programmata && fd.get('apre') ? new Date(fd.get('apre')).getTime() : null;
  const q = String(fd.get('quorum') || '').trim();
  return {
    nazione: _country,
    titolo: String(fd.get('titolo') || '').trim(),
    testo: String(fd.get('testo') || ''),
    corpo: fd.get('corpo'),
    scrutinio: fd.get('scrutinio'),
    visibilita: fd.get('visibilita'),
    maggioranza: fd.get('maggioranza'),
    quorum: q ? Number(q) : null,
    apre: programmata ? apre : null,
    durataMin: Number(fd.get('durataMin')),
    _programmata: programmata,
  };
}

/** La frase in fondo al modulo: cosa succederà, detto per esteso. Non
 *  ridisegna i campi, scrive solo lì sotto. */
function _riassunto(form) {
  const d = _datiModulo(form);
  form.querySelector('[data-wp-vt-when]').hidden = !d._programmata;
  // Nel referendum gli aventi diritto sono una stima: niente assoluta.
  const ass = form.querySelector('option[value="assoluta"]');
  ass.disabled = d.corpo === 'referendum';
  if (ass.disabled && d.maggioranza === 'assoluta') form.querySelector('[name="maggioranza"]').value = 'semplice';
  const inizio = d._programmata ? d.apre : Date.now();
  const fine = inizio ? inizio + d.durataMin * 60_000 : null;
  // Pezzi di frase propri (sum_*), non le etichette abbassate: in tedesco
  // i nomi restano maiuscoli, e "il congresso" non è "Congresso".
  form.querySelector('.wp-vt-summary').textContent = vT('form_summary', {
    corpo: vT(`sum_corpo_${d.corpo}`),
    scrutinio: vT(`sum_scr_${d.scrutinio}`),
    quando: d._programmata ? (inizio ? fmtDataOra(inizio) : '—') : vT('sum_now'),
    fine: fine ? fmtDataOra(fine) : '—',
    vis: vT(`sum_vis_${d.visibilita}`),
  });
}

async function _inviaModulo(form) {
  if (_invio) return;
  const d = _datiModulo(form);
  const err = form.querySelector('.wp-vt-err');
  const mostra = (codice) => { err.hidden = false; err.textContent = vErr(codice); };
  if (!d.titolo) return mostra('titolo_mancante');
  if (d._programmata && !d.apre) return mostra('apertura_non_valida');
  delete d._programmata;
  _invio = true;
  err.hidden = true;
  const btn = form.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    const r = await creaVotazione(d);
    trackEvent('political-vote-create', { corpo: d.corpo, ballot: d.scrutinio });
    _chiudiModulo();
    _openId = r.votazione.id;
    _syncUrl();
    await _load();
  } catch (e) {
    mostra(e?.codice);
    btn.disabled = false;
  } finally {
    _invio = false;
  }
}

// ---------------------------------------------------------------------------
// Eventi e timer
// ---------------------------------------------------------------------------

function _wire(view) {
  if (_wired) return;
  _wired = true;
  view.addEventListener('click', (ev) => {
    const t = ev.target.closest('[data-act]');
    if (!t || !view.contains(t)) return;
    // Un link dentro una scheda dell'elenco apre il link, non la scheda.
    if (ev.target.closest('a')) return;
    const act = t.dataset.act;
    if (act === 'open') { _apriScheda(Number(t.dataset.id)); }
    else if (act === 'back') { _openId = null; _detail = null; _syncUrl(); _render(); }
    else if (act === 'retry') { _errore = null; _paint(`<div class="panel wp-pol-loading">${escapeHtml(vT('loading'))}</div>`); _load(); }
    else if (act === 'login') { trackEvent('political-vote-login'); entraConDiscord(_country, _openId); }
    else if (act === 'link-char') { _vaiAlProfilo(); }
    else if (act === 'new') { _apriModulo(); }
    else if (act === 'channel') { _apriCanale(); }
    else if (act === 'channel-remove') { if (confirm(vT('ch_remove_confirm'))) _salvaCanale(t.closest('form'), ''); }
    else if (act === 'cancel-form') { _chiudiModulo(); }
    else if (act === 'choose') { _scegli(t); }
    else if (act === 'cast') { _vota(t); }
    else if (act === 'withdraw') { _ritira(); }
    else if (act === 'close-now') { _chiudiOra(); }
    else if (act === 'delete') { _elimina(); }
  });
  view.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const card = ev.target.closest('.wp-vt-card[data-act="open"]');
    if (card) { ev.preventDefault(); _apriScheda(Number(card.dataset.id)); }
  });
  view.addEventListener('change', (ev) => {
    const f = ev.target.closest('[data-wp-vt-filter]');
    if (!f) return;
    if (f.dataset.wpVtFilter === 'tipo') _filtroTipo = f.value;
    else _filtroEsito = f.value;
    _renderList();
  });
}

async function _apriScheda(id) {
  if (!id) return;
  _openId = id;
  _detail = null;
  _syncUrl();
  _paint(`<div class="panel wp-pol-loading">${escapeHtml(vT('loading'))}</div>`);
  trackEvent('political-vote-open');
  await _load();
  document.getElementById(VIEW_ID)?.scrollIntoView?.({ block: 'start' });
}

async function _vaiAlProfilo() {
  const { closePoliticalView } = await import('../app/politicalOverlay.js');
  closePoliticalView();
  (await import('../app/privateOverlay.js')).openPrivateView();
}

function _onTick() {
  if (!_visibile()) { stopVotesView(); return; }
  const t = now();
  document.querySelectorAll(`#${VIEW_ID} [data-wp-vt-cd]`).forEach((el) => {
    el.textContent = fmtDurata(Number(el.dataset.wpVtCd) - t);
  });
  if (_ricarica || !_list || _errore) return;
  // Uno scatto di fase passato (apre, chiude, comincia o finisce lo
  // scrutinio): la firma cambia da sola con l'orologio, e si rilegge —
  // il server intanto apre o sigilla, e dà l'esito quando è ora. Al più
  // una rilettura ogni 5 s: il sigillo arriva fino a 20 s dopo la
  // chiusura, e nel frattempo la fase resta la stessa.
  if (_firma() !== _firmaResa && t - _ultimaRilettura > 5000) {
    _ricarica = true;
    _ultimaRilettura = t;
    setTimeout(() => _load({ silenzioso: true }), 1000);
  }
}
