/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: l'urna dello scrutinio SEGRETO
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): a fine timer di un voto segreto
   parte uno scrutinio che legge un voto alla volta, con una bella
   animazione. Qui: la scheda esce dall'urna, si gira, si legge (con la
   nota, se è nulla) e vola sul suo mucchio; i mucchi crescono, la barra
   della maggioranza si riempie, e alla fine tabellone e timbro.

   ── IL TEMPO È DEL SERVER ───────────────────────────────────────
   Come l'emiciclo (votesHemicycle.js): nessun "play", ogni fotogramma
   disegna lo stato a `ora del server − scrutinioAlle`. La scaletta è
   la STESSA formula di durataScrutinio in server/plusApi/votazioni.js:

       congresso e istituzioni: 3 s d'apertura + 3 s a scheda, TUTTE
         uguali + 3 s di chiusura (accelerare qui era troppo veloce per
         leggerle: richiesta dell'utente);
       referendum: 3 s d'apertura + 3 s a scheda le prime 10 + 1 s le
         prossime 30 + 20 s di spoglio rapido per tutte le altre + 3 s

   (i 6 s del server sono apertura + chiusura). Se il server ha tagliato
   al suo tetto, la scaletta si comprime in proporzione (`scala`):
   finisce comunque quando il server dice che l'esito è pubblico.
   ⚠️ Cambiare una delle due formule senza l'altra sfasa l'animazione.

   L'ordine delle schede è quello del sigillo, rimescolato dal server:
   uguale per tutti, e senza legame con chi ha votato quando.

   ── ANIMAZIONI SPENTE ───────────────────────────────────────────
   Come nell'emiciclo, l'interruttore di Impostazioni spegne gli
   ornamenti (giro della scheda, scossone dell'urna, timbro che cade),
   non la lettura: le schede si leggono comunque una alla volta.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml } from './config.js';
import { vT } from './votesI18n.js';
import { animationsOn } from '../shared/motion.js';

const SCELTE = ['si', 'no', 'astenuto', 'nulla'];
const INTRO = 3000, OUTRO = 3000, LENTA = 3000, MEDIA = 1000, RAPIDO = 20000;
const PRIME_LENTE = 10, FINO_A_MEDIE = 40;

/** Quando si legge ogni scheda (ms "grezzi", prima della scala). Fuori
 *  dal referendum tutte allo stesso passo, lento. */
function scaletta(n, referendum) {
  const inizio = new Array(n);
  const durata = new Array(n);
  let t = INTRO;
  if (!referendum) {
    for (let k = 0; k < n; k++) { inizio[k] = t; durata[k] = LENTA; t += LENTA; }
    return { inizio, durata, fineSchede: t, totale: t + OUTRO, rapidoDa: Infinity };
  }
  for (let k = 0; k < Math.min(n, FINO_A_MEDIE); k++) {
    const d = k < PRIME_LENTE ? LENTA : MEDIA;
    inizio[k] = t; durata[k] = d; t += d;
  }
  if (n > FINO_A_MEDIE) {
    const d = RAPIDO / (n - FINO_A_MEDIE);
    for (let k = FINO_A_MEDIE; k < n; k++) { inizio[k] = t; durata[k] = d; t += d; }
  }
  return { inizio, durata, fineSchede: t, totale: t + OUTRO, rapidoDa: FINO_A_MEDIE };
}

const lerp = (a, b, x) => a + (b - a) * Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - (1 - x) ** 3;

/**
 * Monta l'urna in `el`. Stessa firma di mountHemicycle.
 * @returns {{ stop(): void }}
 */
export function mountUrn(el, { scrutinio: s, now, modo = 'diretta', tabellone = modo === 'diretta' }) {
  const seq = s.sequenza || [];
  const n = seq.length;
  const e = s.esito;
  // `corpo` arriva con lo scrutinio; per uno sigillato prima che ci fosse,
  // un referendum si riconosce dall'assenza del corpo elettorale.
  const referendum = s.corpo ? s.corpo === 'referendum' : !s.elettori;
  const sc = scaletta(n, referendum);
  const scala = sc.totale > 0 ? (s.durataMs || sc.totale) / sc.totale : 1;
  const soglia = e?.soglia || 1;
  const lettaA = (k) => sc.inizio[k] + sc.durata[k] * 0.85; // quando cade sul mucchio

  el.innerHTML = `<div class="wp-vt-urn${modo === 'finale' ? ' wp-vt-urn-final' : ''}">
    <div class="wp-vt-hemi-status" data-u="status"></div>
    <div class="wp-vt-urn-stage">
      <div class="wp-vt-urn-box" data-u="box"><div class="wp-vt-urn-slot"></div><span>${escapeHtml(vT('urn_label'))}</span>
        <div class="wp-vt-urn-left" data-u="left"></div></div>
      <div class="wp-vt-urn-desk">
        <div class="wp-vt-urn-fly" data-u="fly">
          <div class="wp-vt-urn-card" data-u="card">
            <div class="wp-vt-urn-face wp-vt-urn-back"><b>WarEra+</b><span>${escapeHtml(vT('urn_ballot'))}</span></div>
            <div class="wp-vt-urn-face wp-vt-urn-front" data-u="front"></div>
          </div>
        </div>
        <div class="wp-vt-urn-fast" data-u="fast" hidden>${escapeHtml(vT('urn_fast'))}</div>
        <div class="wp-vt-urn-count" data-u="count"></div>
      </div>
      <div class="wp-vt-urn-piles">
        ${SCELTE.map((k) => `<div class="wp-vt-urn-pile wp-vt-c-${k}" data-u="pile-${k}">
          <div class="wp-vt-urn-stack" data-u="stack-${k}"></div>
          <div class="wp-vt-urn-n" data-u="n-${k}">0</div>
          <div class="wp-vt-urn-l">${escapeHtml(vT(`scelta_${k}`))}</div>
        </div>`).join('')}
      </div>
      ${tabellone && e ? `<div class="wp-vt-hemi-stamp wp-vt-stamp wp-vt-stamp-${e.esito}" data-u="stamp">${escapeHtml(vT(`stamp_${e.esito}`))}</div>` : ''}
    </div>
    <div class="wp-vt-urn-meter">
      <div class="wp-vt-urn-meter-bar"><i data-u="meter"></i><b style="left:${Math.min(100, (soglia / Math.max(1, e?.votanti || soglia, soglia)) * 100)}%"></b></div>
      <div class="wp-vt-urn-meter-l"><span data-u="meter-l"></span><em data-u="reached" hidden>★ ${escapeHtml(vT('urn_reached'))}</em></div>
    </div>
    ${tabellone && e ? `<div class="wp-vt-board wp-vt-hemi-board" data-u="board">
      ${[['b_present', e.presenti], ['b_voters', e.votanti], ['b_majority', e.soglia],
        ['scelta_si', e.conteggi.si, 'si'], ['scelta_no', e.conteggi.no, 'no'], ['scelta_astenuto', e.conteggi.astenuto, 'astenuto'],
        ['scelta_nulla', e.conteggi.nulla, 'nulla'], [e.stimati ? 'b_eligible_est' : 'b_eligible', e.aventiDiritto]]
        .map(([k, val, c]) => `<div class="wp-vt-board-cell ${c ? `wp-vt-c-${c}` : ''}"><div class="wp-vt-board-v">${Number(val ?? 0).toLocaleString()}</div><div class="wp-vt-board-l">${escapeHtml(vT(k))}</div></div>`).join('')}
    </div>
    <div class="wp-vt-hemi-proclaim" data-u="proclaim">${escapeHtml(vT(`hc_proclaim_${e.esito}`))}</div>` : ''}
    ${modo === 'finale' ? `<button class="wp-vt-btn wp-vt-btn-quiet wp-vt-hemi-replay" type="button" data-u="replay">↻ ${escapeHtml(vT('hc_replay'))}</button>` : ''}
  </div>`;

  const q = (k) => el.querySelector(`[data-u="${k}"]`);
  // Due livelli apposta: `fly` si sposta, rimpicciolisce e sfuma; `card`
  // dentro ruota e basta. L'opacità sullo stesso elemento che ruota in 3D
  // lo appiattisce, e a metà giro si vedrebbe il fronte specchiato.
  const fly = q('fly'), card = q('card'), front = q('front'), box = q('box');
  const celle = [...el.querySelectorAll('[data-u="board"] .wp-vt-board-cell')];
  // Il "denominatore" della barra: i votanti finali (sì + no), così la
  // tacca della soglia sta ferma mentre la barra del sì cresce.
  const fondoBarra = Math.max(1, e?.votanti || 0, soglia);
  let raf = null;
  let inizioReplay = null;
  let frontDi = -1;
  let ultimoScossone = -1;
  // Dove deve volare la scheda in mano: dal centro del tavolo al mucchio
  // della sua scelta, in pixel, misurato quando la scheda cambia (il
  // layout cambia con la finestra, la scaletta no).
  let volo = { dx: 0, dy: 0 };
  const misuraVolo = (scelta) => {
    const desk = fly.parentElement.getBoundingClientRect();
    const pila = q(`stack-${scelta}`).getBoundingClientRect();
    volo = {
      dx: (pila.left + pila.width / 2) - (desk.left + desk.width / 2),
      dy: (pila.top + pila.height / 2) - (desk.top + desk.height / 2),
    };
  };
  const mucchi = Object.fromEntries(SCELTE.map((k) => [k, -1]));

  const tempoGrezzo = () => {
    if (modo === 'finale' && inizioReplay == null) return sc.totale;
    const trascorso = inizioReplay != null ? performance.now() - inizioReplay : now() - s.scrutinioAlle;
    return Math.max(0, trascorso / scala);
  };

  function disegna() {
    const r = tempoGrezzo();
    const motion = animationsOn();

    // Quante schede sono già sul mucchio, e quale è in mano.
    let lette = 0;
    while (lette < n && r >= lettaA(lette)) lette++;
    let inMano = -1;
    for (let k = Math.min(n - 1, lette + 1); k >= 0; k--) {
      if (r >= sc.inizio[k] && r < sc.inizio[k] + sc.durata[k]) { inMano = k; break; }
    }
    const conta = { si: 0, no: 0, astenuto: 0, nulla: 0 };
    for (let k = 0; k < lette; k++) conta[seq[k].s]++;

    // I mucchi: numero, e una pila di schedine (al più 14 si vedono).
    for (const k of SCELTE) {
      q(`n-${k}`).textContent = conta[k].toLocaleString();
      if (conta[k] !== mucchi[k]) {
        const pila = q(`stack-${k}`);
        const vis = Math.min(14, conta[k]);
        if (pila.childElementCount !== vis) {
          pila.innerHTML = Array.from({ length: vis }, (_, i) => `<i style="--i:${i};--r:${((i * 37) % 9) - 4}deg"></i>`).join('');
        }
        if (mucchi[k] >= 0 && conta[k] > mucchi[k] && motion) {
          const p = q(`pile-${k}`);
          p.classList.remove('bump'); void p.offsetWidth; p.classList.add('bump');
        }
        mucchi[k] = conta[k];
      }
    }
    q('left').textContent = vT('urn_left', { n: (n - lette).toLocaleString() });
    q('count').textContent = n
      ? vT('urn_counting', { k: Math.min(n, Math.max(lette, inMano + 1)).toLocaleString(), n: n.toLocaleString() })
      : vT('urn_empty');

    // La barra del sì verso la soglia.
    q('meter').style.width = `${Math.min(100, (conta.si / fondoBarra) * 100)}%`;
    q('meter-l').textContent = vT('urn_meter', { si: conta.si.toLocaleString(), soglia: soglia.toLocaleString() });
    q('reached').hidden = !(e?.esito === 'approvata' && conta.si >= soglia);

    // La scheda in mano: esce, si gira, si legge, vola sul mucchio.
    const rapido = inMano >= sc.rapidoDa;
    q('fast').hidden = !rapido;
    if (inMano >= 0 && !rapido) {
      const x = (r - sc.inizio[inMano]) / sc.durata[inMano];
      const b = seq[inMano];
      if (frontDi !== inMano) {
        frontDi = inMano;
        front.className = `wp-vt-urn-face wp-vt-urn-front wp-vt-c-${b.s}`;
        front.innerHTML = `<strong>${escapeHtml(vT(`scelta_${b.s}`))}</strong>${b.n ? `<em>“${escapeHtml(b.n)}”</em>` : ''}`;
        misuraVolo(b.s);
      }
      // 0–15% esce dall'urna · 15–45% si gira · 45–80% si legge · 80–100% vola.
      const esce = easeOut(x / 0.15);
      const gira = motion ? lerp(180, 0, (x - 0.15) / 0.3) : (x < 0.3 ? 180 : 0);
      const vola = Math.max(0, (x - 0.8) / 0.2);
      const w = fly.offsetWidth, h = fly.offsetHeight;
      const tx = lerp(-0.6 * w, 0, esce) + lerp(0, volo.dx, easeOut(vola));
      const ty = lerp(0.3 * h, 0, esce) + lerp(0, volo.dy, easeOut(vola));
      const s2 = vola > 0 ? lerp(1, 0.22, vola) : lerp(0.6, 1, esce);
      fly.style.opacity = String(vola > 0 ? lerp(1, 0, (vola - 0.7) / 0.3) : lerp(0, 1, x / 0.08));
      fly.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s2.toFixed(3)})`;
      card.style.transform = `rotateY(${gira.toFixed(1)}deg)`;
      if (motion && inMano !== ultimoScossone) {
        ultimoScossone = inMano;
        box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake');
      }
    } else {
      fly.style.opacity = r < INTRO && n ? String(lerp(0, 1, r / INTRO)) : '0';
      fly.style.transform = 'translate(-60%, 30%) scale(.6)';
      card.style.transform = 'rotateY(180deg)';
    }

    // La frase in alto.
    const fase = r >= sc.totale ? 'fine' : r >= sc.fineSchede ? 'chiusura' : r >= INTRO ? (rapido ? 'rapido' : 'lettura') : 'apertura';
    q('status').textContent = vT(`urn_status_${fase}`);
    el.querySelector('.wp-vt-urn')?.classList.toggle('wp-vt-urn-done', r >= sc.fineSchede);

    // Tabellone e timbro, nella chiusura.
    if (celle.length) {
      const pc = (r - sc.fineSchede) / OUTRO;
      const quante = pc <= 0 ? 0 : Math.min(celle.length, Math.ceil((pc / 0.6) * celle.length));
      celle.forEach((c, i) => c.classList.toggle('on', i < quante));
      q('board')?.classList.toggle('on', pc > 0);
      q('stamp')?.classList.toggle('on', pc >= 0.6);
      q('proclaim')?.classList.toggle('on', pc >= 0.6);
    }

    if (!el.isConnected) { raf = null; return; }
    raf = r < sc.totale ? requestAnimationFrame(disegna) : null;
  }

  q('replay')?.addEventListener('click', () => {
    inizioReplay = performance.now();
    frontDi = -1;
    if (!raf) raf = requestAnimationFrame(disegna);
  });

  disegna();
  return { stop() { if (raf) cancelAnimationFrame(raf); raf = null; } };
}

/** Per le prove: la scaletta da sola (deve sommare come il server). */
export const _scaletta = scaletta;
