/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — "Cosa puoi fare"
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-30): chi entra e NON è di una nazione
   dell'alleanza P.A.S.T.A. vedeva la card "non aperta al tuo paese" e
   nient'altro — come se dopo il login non ci fosse niente. Ma qualcosa
   c'è: gli Accordi e le Votazioni non passano dal filtro nazione.

   Questa pagina è la prima cosa dopo il login. Elenca TUTTE le funzioni
   che l'area (e i pezzi riservati di WarEra+) offrono, e per ognuna dice
   se è aperta a chi guarda; se non lo è, dice cosa manca invece di
   nasconderla — una funzione nascosta è una funzione che nessuno sa
   che esiste. Le aperte hanno il bottone che porta lì.

   ⚠️ È un ANNUNCIO, non un permesso. Il permesso vero lo dà il server ad
   ogni chiamata (filtroNazione, capacitaDi, governaUnaParte…): qui si
   riproduce la stessa regola solo per scrivere "aperta" o "non aperta"
   sulla card. Se le due divergono vince il server, e la funzione
   risponde con il suo errore. Per questo la regola sta in `stato()`, un
   solo posto, e non sparsa nel disegno.
   ══════════════════════════════════════════════════════════════ */

import { pnT } from './i18nPanoramica.js';
import { closePrivateView } from '../app/privateOverlay.js';

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Cosa può fare chi guarda.
 *
 * @param {object} ctx
 * @param {object} ctx.account         l'account (verificato, admin…)
 * @param {object|null} ctx.ruoli      risposta di /roles: derivati, capacita, nazione
 * @param {boolean|null} ctx.accessoNazione  esito della lettura di "La mia nazione":
 *                                     false = il server ha detto no (null = non ancora noto)
 * @returns {Array<{id, gruppo, aperta, motivo, nota}>}
 */
export function stato({ account, ruoli, accessoNazione }) {
  const cap = ruoli?.capacita || {};
  const admin = Boolean(account.admin);
  const verificato = Boolean(account.verificato);

  // Se i ruoli non sono arrivati (gioco che non risponde) non si dichiara
  // chiusa una funzione che potrebbe essere aperta: `abilitata` assente
  // vale "sì", e il server dice no da sé.
  const nazioneChiusa = ruoli?.nazione?.abilitata === false;
  const poteri = Boolean(cap.chiedePer?.length || cap.approvaPer?.length || cap.gestisceNazione?.length);

  // Il motivo per cui il perimetro P.A.S.T.A. è chiuso a chi guarda.
  const motivoArea = admin ? null : !verificato ? 'needLink' : nazioneChiusa ? 'needNation' : null;

  const voci = [];

  voci.push({ id: 'nazione', gruppo: 'area', scheda: 'nazione', motivo: motivoArea });
  voci.push({
    id: 'operazioni', gruppo: 'area', scheda: 'operazioni',
    motivo: motivoArea || (accessoNazione === false ? 'needChosen' : null),
  });
  voci.push({
    id: 'contratti', gruppo: 'area', scheda: 'contratti',
    motivo: motivoArea || (admin || poteri ? null : 'needRole'),
  });
  if (admin) voci.push({ id: 'admin', gruppo: 'area', scheda: 'admin', motivo: null });

  voci.push({
    id: 'bilancio', gruppo: 'altrove',
    motivo: motivoArea || (admin || cap.chiedePer?.length ? null : 'needCommander'),
  });
  // Accordi: leggerli è di tutti; scriverli del governo di una delle parti,
  // senza filtro nazione (vedi la testata di server/plusApi/accordi.js).
  voci.push({
    id: 'accordi', gruppo: 'altrove', motivo: null,
    nota: cap.gestisceNazione?.length || admin ? 'accordiWrite' : 'accordiRead',
  });
  // Votazioni: il personaggio collegato serve per votare, non per leggere.
  voci.push({
    id: 'votazioni', gruppo: 'altrove', motivo: null,
    nota: verificato || admin ? 'votazioniNote' : 'votazioniNoLink',
  });

  return voci.map((v) => ({ ...v, aperta: !v.motivo }));
}

/** Chiude l'area e apre la sezione: le due viste sono overlay a schermo
 *  intero, e lasciare l'area aperta sotto farebbe tornare Indietro su una
 *  pagina che l'utente credeva di aver lasciato (stessa scelta di
 *  mappaOperazione.js). */
const APRI_ALTROVE = {
  bilancio: async () => (await import('../app/muOverlay.js')).openMuView(undefined, { tab: 'wealth' }),
  accordi: async () => (await import('../app/accordiOverlay.js')).openAccordiView(),
  votazioni: async () => (await import('../app/politicalOverlay.js'))
    .openPoliticalView(undefined, '', { openVotes: true }),
};

/**
 * @param {object} ctx            vedi stato()
 * @param {(scheda: string) => void} apriScheda  apre una pagina dell'area
 * @returns {HTMLElement}
 */
export function creaPanoramica(ctx, apriScheda) {
  const sezione = el('section', 'wp-pv-pn');

  const testa = el('div', 'wp-pv-pn-testa');
  testa.appendChild(el('h2', 'wp-pv-pn-titolo', pnT('title')));
  testa.appendChild(el('p', 'wp-pv-body', pnT('lead')));
  sezione.appendChild(testa);

  const voci = stato(ctx);
  for (const [gruppo, etichetta] of [['area', 'groupArea'], ['altrove', 'groupElsewhere']]) {
    const di = voci.filter((v) => v.gruppo === gruppo);
    if (!di.length) continue;
    sezione.appendChild(el('h3', 'wp-pv-pn-gruppo', pnT(etichetta)));
    const griglia = el('div', 'wp-pv-pn-griglia');
    for (const v of di) griglia.appendChild(cardFunzione(v, apriScheda));
    sezione.appendChild(griglia);
  }

  sezione.appendChild(el('p', 'wp-pv-note', pnT('footer')));
  return sezione;
}

function cardFunzione(v, apriScheda) {
  const card = el('article', `wp-pv-pn-card${v.aperta ? '' : ' chiusa'}`);

  const riga = el('div', 'wp-pv-pn-riga');
  riga.appendChild(el('h4', 'wp-pv-pn-nome', pnT(v.id)));
  riga.appendChild(el('span', `wp-pv-pn-stato ${v.aperta ? 'si' : 'no'}`,
    `${v.aperta ? '' : '🔒 '}${pnT(v.aperta ? 'available' : 'locked')}`));
  card.appendChild(riga);

  card.appendChild(el('p', 'wp-pv-pn-desc', pnT(`${v.id}Body`)));

  // Aperta: la nota di cosa si può fare ("puoi anche scrivere"); chiusa: il
  // perché, che è la parte che serve a chi non può entrare.
  if (!v.aperta) card.appendChild(el('p', 'wp-pv-pn-motivo', pnT(v.motivo)));
  else if (v.nota) card.appendChild(el('p', 'wp-pv-note', pnT(v.nota)));

  if (v.aperta) {
    const b = el('button', 'wp-pv-btn wp-pv-btn-primary wp-pv-btn-small', `${pnT('open')} →`);
    b.type = 'button';
    if (v.scheda) {
      b.addEventListener('click', () => apriScheda(v.scheda));
    } else {
      b.title = pnT('unitHint');
      b.addEventListener('click', async () => {
        closePrivateView();
        try { await APRI_ALTROVE[v.id](); }
        catch (err) { console.warn('[area riservata] sezione non aperta:', v.id, err); }
      });
    }
    card.appendChild(b);
  }
  return card;
}
