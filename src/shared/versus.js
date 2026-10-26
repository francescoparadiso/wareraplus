/* ══════════════════════════════════════════════════════════════
   WarEra+ — I pezzi del "versus", comuni a tutti i confronti 1 vs 1
   ------------------------------------------------------------------
   Il confronto fra giocatori (src/players/main.js) era nato come un
   versus da gioco di combattimento: i due lati uno di fronte all'altro
   coi loro colori, il punteggio delle voci vinte al centro, ogni voce un
   tiro alla fune. Richiesta dell'utente (2026-10-18): lo stesso stile
   per tutti i confronti. Qui stanno i pezzi, in src/styles/versus.css lo
   stile (importato da questo file):

     · vsRow     — una voce: i due valori ai lati, la barra divisa in
                   proporzione in mezzo, il vincitore nel suo colore;
     · vsGroup   — un riquadro di voci col suo titolo e il suo parziale;
     · vsFighter — il ritratto di un lato (persona, unità, nazioni, fazione);
     · vsHero    — i due ritratti, il VS, il punteggio, il verdetto;
     · countUpScore — il punteggio che conta da zero durante l'intro.

   Le regole su cosa si conta sono quelle che ogni confronto aveva già:
   una voce `neutral` (quote di build, guerre in corso) si mostra ma non
   entra nel punteggio, una `lower` vince col valore più basso.

   L'INTRO (la classe wp-vs-intro sulla sezione) va messa solo nel PRIMO
   disegno completo: le animazioni delle barre ripartirebbero a ogni
   ridisegno, e sembrerebbe un difetto. Chi la mette deve anche chiedere
   animationsOn() (src/shared/motion.js) e non ridisegnare per INTRO_MS.
   ══════════════════════════════════════════════════════════════ */

import '../styles/versus.css';
import { escapeHtml } from '../mu/ui.js';

/** Quanto dura l'intro, ultima animazione di versus.css compresa. */
export const VS_INTRO_MS = 2900;

/** Una voce del duello. `win` = 1 (A), 2 (B), 0 (pari o non confrontabile).
 *  `counted` è falso per le voci neutre, che non entrano nel punteggio. */
export function vsRow(label, va, vb, { fmt = (v) => String(v), subA = '', subB = '', lower = false, neutral = false } = {}) {
  const na = Number(va), nb = Number(vb);
  const ok = va != null && vb != null && Number.isFinite(na) && Number.isFinite(nb);
  let win = 0;
  if (ok && !neutral && na !== nb) win = (na > nb) !== lower ? 1 : 2;
  // La barra: quota di A sul totale. Con valori negativi o tutti a zero
  // (succede: punti eco a 0 per entrambi) metà e metà.
  const tot = ok && na >= 0 && nb >= 0 ? na + nb : 0;
  const pa = tot > 0 ? Math.max(4, Math.min(96, (na / tot) * 100)) : 50;
  const val = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? '—' : escapeHtml(fmt(v)));
  return {
    win,
    counted: ok && !neutral,
    html: `
    <div class="wp-vs-row${win === 1 ? ' wp-vs-wa' : win === 2 ? ' wp-vs-wb' : ''}${neutral ? ' wp-vs-neutral' : ''}">
      <div class="wp-vs-val wp-vs-val-a"><b>${val(va)}</b>${subA ? `<small>${escapeHtml(subA)}</small>` : ''}</div>
      <div class="wp-vs-mid">
        <span class="wp-vs-label">${escapeHtml(label)}</span>
        <div class="wp-vs-bar"><i class="wp-vs-bar-a" style="width:${pa.toFixed(1)}%"></i><i class="wp-vs-bar-b" style="width:${(100 - pa).toFixed(1)}%"></i></div>
      </div>
      <div class="wp-vs-val wp-vs-val-b"><b>${val(vb)}</b>${subB ? `<small>${escapeHtml(subB)}</small>` : ''}</div>
    </div>`,
  };
}

/** Voci vinte per lato e voci contate, su un elenco di vsRow. */
export function vsTally(rows) {
  const counted = rows.filter(r => r.counted !== false);
  return {
    a: counted.filter(r => r.win === 1).length,
    b: counted.filter(r => r.win === 2).length,
    tot: counted.length,
  };
}

/** Un riquadro di voci. `g` è l'indice del riquadro: l'intro li fa salire
 *  uno dopo l'altro. `body` è HTML in più dopo le voci (un grafico). */
export function vsGroup({ title, icon = '', rows = [], g = 0, body = '', score = true, id = '' }) {
  const t = vsTally(rows);
  const parziale = score && t.tot
    ? `<em><b class="wp-vs-sa">${t.a}</b> – <b class="wp-vs-sb">${t.b}</b></em>` : '';
  return `
    <div class="wp-vs-group" style="--g:${g}"${id ? ` id="${escapeHtml(id)}"` : ''}>
      <h3 class="wp-vs-gtitle">${icon ? `<span>${icon}</span>` : ''}${escapeHtml(title)}${parziale}</h3>
      ${rows.map(r => r.html).join('')}
      ${body}
    </div>`;
}

/** Il ritratto di un lato. Tutto HTML già pronto tranne `side`/`leader`:
 *  `avatar` (un <span class="wp-vs-av">… o l'avatar di una persona),
 *  `name` (di solito un bottone che apre la scheda), `lines` (righe sotto
 *  il nome), `tags` (pillole), `sub` (testo spento in fondo). */
export function vsFighter({ side, leader = false, avatar = '', name = '', lines = [], tags = [], sub = '' }) {
  return `
    <div class="wp-vs-fighter wp-vs-fighter-${side}${leader ? ' wp-vs-leader' : ''}">
      ${avatar}
      ${name}
      ${lines.filter(Boolean).join('')}
      ${tags.filter(Boolean).length ? `<div class="wp-vs-tags">${tags.filter(Boolean).join('')}</div>` : ''}
      ${sub ? `<small class="wp-vs-sub">${sub}</small>` : ''}
    </div>`;
}

/** I due ritratti col VS in mezzo. `center` è HTML in più sotto il
 *  verdetto (il bottone per scambiare i lati). `score: false` finché
 *  manca un lato: uno 0–0 sembrerebbe un pareggio. */
export function vsHero({ a, b, winsA, winsB, verdict = '', intro = false, center = '', score = true }) {
  return `
      <div class="wp-vs-hero">
        ${a}
        <div class="wp-vs-center">
          ${intro ? '<i class="wp-vs-shock"></i>' : ''}
          <span class="wp-vs-badge">VS</span>
          ${!score ? '' : `<div class="wp-vs-score">${intro
            ? `<b class="wp-vs-sa" data-to="${winsA}">0</b><span>–</span><b class="wp-vs-sb" data-to="${winsB}">0</b>`
            : `<b class="wp-vs-sa">${winsA}</b><span>–</span><b class="wp-vs-sb">${winsB}</b>`}</div>`}
          ${verdict ? `<p class="wp-vs-verdict">${escapeHtml(verdict)}</p>` : ''}
          ${center}
        </div>
        ${b}
      </div>`;
}

/** Il punteggio dell'intro conta da 0 al valore vero, dopo lo schianto
 *  del VS (stesso ritardo di wp-vs-pop in versus.css). */
export function countUpScore(root) {
  const els = [...root.querySelectorAll('.wp-vs-hero [data-to]')];
  if (!els.length) return;
  const t0 = performance.now() + 950, dur = 700;
  const step = (now) => {
    const k = Math.max(0, Math.min(1, (now - t0) / dur));
    els.forEach(el => { if (el.isConnected) el.textContent = String(Math.round(Number(el.dataset.to) * (1 - (1 - k) ** 3))); });
    if (k < 1 && els.some(el => el.isConnected)) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
