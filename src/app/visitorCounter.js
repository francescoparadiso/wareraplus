/* ══════════════════════════════════════════════════════════════
   WarEra+ — Contatore visite (pill accanto a Ko-fi e all'autore)
   ------------------------------------------------------------------
   Richiesta esplicita: far vedere quante persone hanno usato il tool.
   Il numero arriva da /visits sul server di cache (vedi il blocco in
   testa a quell'endpoint in server/warera-cache-server.js per come
   conta e cosa NON registra) e parte dal totale che Vercel Analytics
   aveva misurato fino al giorno in cui il contatore è nato: 1325
   visitatori. Il seme sta lato server, non qui, così cambiarlo non
   richiede un deploy del client.

   ── L'IDENTIFICATIVO ───────────────────────────────────────────────
   Un numero casuale generato dal browser e tenuto in localStorage.
   Serve a una cosa sola: non contare dieci volte chi ricarica dieci
   volte. Non è legato alla persona, non viaggia con nient'altro, e chi
   pulisce i dati del sito ricomincia da capo — che per un contatore
   pubblico è un difetto accettabile e per la privacy è il contrario di
   un difetto.

   ── IL PALLINO VERDE ───────────────────────────────────────────────
   Accanto al totale, quante persone stanno usando il tool ADESSO. Il
   conto lo tiene il server (finestra di 5 minuti, tutto in memoria); qui
   si ripassa una volta al minuto con `count=0`, cioe' dicendo "ci sono
   ancora" senza toccare il totale delle visite.

   Il battito si ferma a scheda nascosta e riparte quando torna in primo
   piano: una scheda dimenticata in fondo alla barra non e' qualcuno che
   sta usando il tool, e dopo cinque minuti deve uscire dal conteggio da
   sola. E' anche il motivo per cui il ritmo lo detta il server
   (`heartbeatMs` nella risposta) invece di una costante qui: cambiarlo
   e' un pm2 restart, non un deploy.

   ── DEGRADO ────────────────────────────────────────────────────────
   Come ogni cosa che passa dal VPS: se il server non risponde la pill
   non compare affatto. Mai un numero inventato, mai uno zero, mai un
   segnaposto che sembra un dato — accanto ci sono due pill vere, e una
   terza vuota si leggerebbe come un guasto. Se il server risponde ma
   non conosce `online` (versione vecchia, non ancora rideployata), il
   pallino non compare e il totale delle visite resta: mezza pill vera e'
   meglio di una pill intera con dentro un numero finto.
   ══════════════════════════════════════════════════════════════ */

import { fetchVisitsViaCache } from '../diplomacy/cacheClient.js';
import { t } from '../shared/i18n.js';

const STORAGE_KEY = 'we_visitor_id';

/** Identificativo di questo browser. In localStorage e non in
 *  sessionStorage: con sessionStorage ogni scheda nuova sarebbe un
 *  visitatore nuovo, e il contatore conterebbe le schede, non le
 *  persone. Se localStorage non è disponibile (navigazione privata
 *  stretta, storage bloccato) si ripiega su un id volatile: quella
 *  visita conta una volta e non lascia traccia. */
function visitorId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || String(Math.random()).slice(2) + Date.now().toString(36));
      localStorage.setItem(STORAGE_KEY, id);
    }
    return id;
  } catch (_) {
    return String(Math.random()).slice(2) + Date.now().toString(36);
  }
}

/** Scrive nella pill i due numeri dell'ultima risposta. Il pallino verde
 *  esiste solo se il server sa dire quanti sono online: un server vecchio
 *  non lo manda, e allora la pill mostra le sole visite. */
function paint(pill, data) {
  const num = pill.querySelector('.wp-visits-num');
  if (num) num.textContent = data.total.toLocaleString();

  const slot = pill.querySelector('.wp-visits-online-slot');
  if (!slot) return;
  if (!Number.isFinite(data.online)) { slot.innerHTML = ''; return; }
  slot.innerHTML = `
    <span class="wp-visits-online" title="${t('online_hint')}">
      <span class="wp-visits-dot" aria-hidden="true"></span>
      <span class="wp-visits-online-num">${data.online}</span>
    </span>`;
}

export async function initVisitorCounter() {
  const host = document.getElementById('wp-bottom-credits');
  if (!host) return;

  const id = visitorId();
  const data = await fetchVisitsViaCache(id);
  if (!data) return; // server giù: nessuna pill, vedi testata

  const pill = document.createElement('div');
  pill.className = 'wp-visits-pill';
  pill.id = 'wp-visits-pill';
  pill.title = t('visits_hint');
  pill.innerHTML = `
    <span class="wp-visits-icon" aria-hidden="true">👁</span>
    <span class="wp-visits-text">
      <span class="wp-visits-num"></span>
      <span class="wp-visits-label">${t('visits_label')}</span>
    </span>
    <span class="wp-visits-online-slot"></span>`;
  host.appendChild(pill);
  paint(pill, data);

  // ── Battito: "ci sono ancora", senza toccare il totale ──
  // `count: false` è la differenza fra un heartbeat e una visita nuova.
  // Il ritmo lo detta il server; il valore qui sotto è solo la rete di
  // sicurezza se la risposta non lo porta.
  const every = Number.isFinite(data.heartbeatMs) ? data.heartbeatMs : 60000;
  let timer = null;

  const beat = async () => {
    if (document.hidden) return;
    const fresh = await fetchVisitsViaCache(id, { count: false });
    // Una risposta mancata non azzera niente: resta l'ultimo numero buono
    // finché il server non torna. Un "0 online" lampeggiante a ogni
    // singhiozzo di rete sarebbe una bugia, non un aggiornamento.
    if (fresh) paint(pill, fresh);
  };

  const start = () => { if (!timer) timer = setInterval(beat, every); };
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

  start();
  // A scheda nascosta si smette del tutto: chi ha il tool in una scheda
  // dimenticata non lo sta usando, e dopo cinque minuti il server lo
  // toglie dal conto da solo. Tornando in primo piano si ribatte subito,
  // senza aspettare il minuto pieno.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else { beat(); start(); }
  });

  // Ritraduzione a lingua cambiata: stessa convenzione di tutto il resto
  // dello shell (evento su window, vedi src/app/langSync.js). I numeri
  // non si ricomprano, si riscrivono solo le parole.
  window.addEventListener('wareraplus:langchange', () => {
    const label = pill.querySelector('.wp-visits-label');
    if (label) label.textContent = t('visits_label');
    pill.title = t('visits_hint');
    const online = pill.querySelector('.wp-visits-online');
    if (online) online.title = t('online_hint');
  });
}
