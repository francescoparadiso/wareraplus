/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: l'emiciclo dello scrutinio PALESE
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-10-23): a fine votazione palese, come
   alla Camera, l'emiciclo che colora i pallini lentamente — verdi,
   rossi — e poi il riepilogo: approvata o no, voti, astenuti, nulle.

   ── IL TEMPO È DEL SERVER ───────────────────────────────────────
   Non c'è un "play". Lo scrutinio comincia per tutti a `scrutinioAlle`
   e dura `durataMs` (li decide server/plusApi/votazioni.js); ogni
   fotogramma si chiede "a che punto siamo?" all'orologio del server
   (`now()` di votes.js, corretto dello scarto) e disegna QUELLO stato.
   Così chi guarda insieme vede accendersi lo stesso seggio nello stesso
   istante, chi arriva a metà trova accesi quelli già passati, e una
   scheda tenuta in background non resta indietro. L'ordine in cui si
   accendono è quello dei voti nel sigillo, già rimescolato dal server:
   uguale per tutti, e non dice chi ha votato prima.

   La scaletta, in quote della durata:
     0,00–0,05  urne chiuse, seggi spenti
     0,05–0,75  i voti si accendono uno alla volta
     0,78–0,88  il tabellone, una casella alla volta
     0,90       la proclamazione (timbro)

   ── I SEGGI ─────────────────────────────────────────────────────
   Congresso e istituzioni: un seggio per elettore FOTOGRAFATO, stessa
   geometria del grafico del parlamento (computeLayout/generatePoints
   di parliament.js), raggruppati per partito da sinistra, col bordo nel
   colore del partito. Chi non vota resta spento, e alla fine si vede.
   Referendum: gli elettori sono migliaia e non stanno in un emiciclo;
   si disegnano al più MAX_PALLINI pallini PROPORZIONALI ai voti
   (sì a sinistra, no a destra) e la legenda dice quanti voti vale uno.

   ── ANIMAZIONI SPENTE ───────────────────────────────────────────
   L'interruttore di Impostazioni (shared/motion.js) qui spegne gli
   ornamenti (il "pop" dei seggi, il timbro che cade: classe
   wp-no-motion), NON l'accensione progressiva: come il replay di una
   battaglia, lo scrutinio è il contenuto, non una decorazione.
   ══════════════════════════════════════════════════════════════ */

import { computeLayout, generatePoints } from './parliament.js';
import { escapeHtml, getPartyColor } from './config.js';
import { vT } from './votesI18n.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 600, H = 318, CX = 300, CY = 300, R_OUT = 290, R_IN = 112;
const MAX_PALLINI = 400;
const Q_ACCENDI_DA = 0.05, Q_ACCENDI_A = 0.75, Q_TABELLONE = 0.78, Q_TABELLONE_FINE = 0.88, Q_TIMBRO = 0.90;
const ORDINE_REFERENDUM = ['si', 'astenuto', 'nulla', 'no'];

/** PRNG deterministico (mulberry32): lo stesso ordine per tutti. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * I seggi: posizione, partito, voto e quota della durata in cui si
 * accende (null = non ha votato). Più quanto vale un pallino.
 */
function costruisciSeggi(s) {
  const voti = s.voti || [];
  const n = voti.length;
  const quando = (k) => Q_ACCENDI_DA + (Q_ACCENDI_A - Q_ACCENDI_DA) * ((k + 0.5) / Math.max(1, n));

  if (s.elettori?.length) {
    const ordineVoto = new Map(voti.map((x, k) => [x.id, k]));
    const voto = new Map(voti.map((x) => [x.id, x]));
    // Per partito, i gruppi più grandi a sinistra; i senza partito in fondo.
    const gruppi = new Map();
    for (const e of s.elettori) {
      const k = e.partito || '_';
      if (!gruppi.has(k)) gruppi.set(k, []);
      gruppi.get(k).push(e);
    }
    const ordinati = [...gruppi.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '_') - (kb === '_') || b.length - a.length)
      .flatMap(([, righe]) => righe.sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''))));
    return {
      peso: 1,
      seggi: ordinati.map((e) => {
        const x = voto.get(e.id);
        return {
          scelta: x?.s || null,
          t: x ? quando(ordineVoto.get(e.id)) : null,
          colore: e.partito ? getPartyColor(e.partito) : '#8b949e',
          titolo: `${e.nome || '?'}${e.partitoNome ? ` — ${e.partitoNome}` : ''}`,
          nota: x?.n || null,
        };
      }),
    };
  }

  // Referendum: pallini proporzionali (resto maggiore), sì a sinistra.
  const conta = { si: 0, no: 0, astenuto: 0, nulla: 0 };
  voti.forEach((x) => { conta[x.s] = (conta[x.s] || 0) + 1; });
  const tot = Math.max(1, n);
  const P = Math.min(n, MAX_PALLINI);
  const quote = ORDINE_REFERENDUM.map((k) => ({ k, q: (conta[k] * P) / tot }));
  quote.forEach((x) => { x.n = Math.floor(x.q); });
  let resto = P - quote.reduce((a, x) => a + x.n, 0);
  [...quote].sort((a, b) => (b.q - b.n) - (a.q - a.n)).forEach((x) => { if (resto > 0 && x.q > x.n) { x.n++; resto--; } });
  const seggi = quote.flatMap((x) => Array.from({ length: x.n }, () => ({ scelta: x.k, colore: null, titolo: null })));
  // L'ordine d'accensione: rimescolato, lo stesso per tutti (seme = id).
  const r = rng(Number(s.id) || 1);
  const ordine = seggi.map((_, i) => i);
  for (let i = ordine.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ordine[i], ordine[j]] = [ordine[j], ordine[i]]; }
  ordine.forEach((idx, k) => {
    seggi[idx].t = Q_ACCENDI_DA + (Q_ACCENDI_A - Q_ACCENDI_DA) * ((k + 0.5) / Math.max(1, seggi.length));
  });
  return { peso: n / Math.max(1, P), seggi, conta };
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/**
 * Monta l'emiciclo in `el`.
 * @param {HTMLElement} el
 * @param {object} o
 * @param {object} o.scrutinio  la risposta di /votazioni/:id/scrutinio
 * @param {() => number} o.now  l'ora del server
 * @param {'diretta'|'finale'} o.modo  diretta = sincronizzato su scrutinioAlle;
 *   finale = tutto acceso, con "Rivedi" che riparte da zero (solo per chi guarda)
 * @param {boolean} [o.tabellone]  tabellone e timbro dentro (in diretta sì;
 *   a votazione conclusa li disegna già la scheda dell'esito)
 * @returns {{ stop(): void }}
 */
export function mountHemicycle(el, { scrutinio: s, now, modo = 'diretta', tabellone = modo === 'diretta' }) {
  const { seggi, peso, conta } = costruisciSeggi(s);
  const e = s.esito;
  const aventi = e?.aventiDiritto ?? seggi.length;

  el.innerHTML = `<div class="wp-vt-hemi${modo === 'finale' ? ' wp-vt-hemi-final' : ''}">
    <div class="wp-vt-hemi-status" data-h="status"></div>
    <div class="wp-vt-hemi-stage">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(vT('hc_aria'))}"></svg>
      <div class="wp-vt-hemi-center">
        <div class="wp-vt-hemi-big"><span class="wp-vt-c-si" data-h="si">0</span><i>·</i><span class="wp-vt-c-no" data-h="no">0</span></div>
        <div class="wp-vt-hemi-small" data-h="small"></div>
      </div>
      ${tabellone && e ? `<div class="wp-vt-hemi-stamp wp-vt-stamp wp-vt-stamp-${e.esito}" data-h="stamp">${escapeHtml(vT(`stamp_${e.esito}`))}</div>` : ''}
    </div>
    <div class="wp-vt-hemi-legend">
      ${['si', 'no', 'astenuto', 'nulla'].map((k) => `<span class="wp-vt-c-${k}"><i></i>${escapeHtml(vT(`scelta_${k}`))} <b data-h="n-${k}">0</b></span>`).join('')}
      ${s.elettori?.length ? `<span class="wp-vt-c-assente"><i></i>${escapeHtml(vT('absent'))} <b data-h="n-assente">—</b></span>` : ''}
      ${peso > 1.01 ? `<em>${escapeHtml(vT('hc_each', { k: peso.toFixed(peso < 10 ? 1 : 0) }))}</em>` : ''}
    </div>
    ${tabellone && e ? `<div class="wp-vt-board wp-vt-hemi-board" data-h="board">
      ${[['b_present', e.presenti], ['b_voters', e.votanti], ['b_majority', e.soglia],
        ['scelta_si', e.conteggi.si, 'si'], ['scelta_no', e.conteggi.no, 'no'], ['scelta_astenuto', e.conteggi.astenuto, 'astenuto'],
        ['scelta_nulla', e.conteggi.nulla, 'nulla'], [e.stimati ? 'b_eligible_est' : 'b_eligible', e.aventiDiritto]]
        .map(([k, val, c]) => `<div class="wp-vt-board-cell ${c ? `wp-vt-c-${c}` : ''}"><div class="wp-vt-board-v">${Number(val ?? 0).toLocaleString()}</div><div class="wp-vt-board-l">${escapeHtml(vT(k))}</div></div>`).join('')}
    </div>
    <div class="wp-vt-hemi-proclaim" data-h="proclaim">${escapeHtml(vT(`hc_proclaim_${e.esito}`))}</div>` : ''}
    ${modo === 'finale' ? `<button class="wp-vt-btn wp-vt-btn-quiet wp-vt-hemi-replay" type="button" data-h="replay">↻ ${escapeHtml(vT('hc_replay'))}</button>` : ''}
  </div>`;

  // Geometria del parlamento: stessi raggi relativi, stessi seggi per fila.
  const svg = el.querySelector('svg');
  const layout = computeLayout(seggi.length, R_IN, R_OUT);
  const punti = layout ? generatePoints(layout) : [];
  // Con pochi seggi i pallini sono grossi e la fila di base esce sotto il
  // centro: l'altezza si allarga di quel raggio, o finirebbe sotto la legenda.
  if (layout) svg.setAttribute('viewBox', `0 ${-Math.ceil(layout.dotR)} ${W} ${Math.ceil(CY + layout.dotR * 2 + 4)}`);
  const cerchi = punti.map((p, i) => {
    const g = seggi[i];
    const c = svgEl('circle', {
      cx: (CX + p.radius * Math.cos(p.angle)).toFixed(1),
      cy: (CY + p.radius * Math.sin(p.angle)).toFixed(1),
      r: (layout.dotR * 0.92).toFixed(2),
      class: 'wp-vt-seat',
    });
    if (g.colore) c.style.setProperty('--pc', g.colore);
    if (g.titolo) {
      const t = svgEl('title');
      t.textContent = g.titolo;
      c.appendChild(t);
    }
    svg.appendChild(c);
    return c;
  });

  const q = (k) => el.querySelector(`[data-h="${k}"]`);
  const celle = [...el.querySelectorAll('[data-h="board"] .wp-vt-board-cell')];
  const stato = { accesi: new Array(seggi.length).fill(false), fase: null, celle: 0 };
  let raf = null;
  let inizioReplay = null; // performance.now() del "Rivedi", null = sul server

  /** Quanto dello scrutinio è passato, da 0 a 1. */
  const quota = () => {
    if (modo === 'finale' && inizioReplay == null) return 1;
    const trascorso = inizioReplay != null ? performance.now() - inizioReplay : now() - s.scrutinioAlle;
    return Math.max(0, Math.min(1, trascorso / Math.max(1, s.durataMs)));
  };

  function disegna() {
    const p = quota();
    const n ={ si: 0, no: 0, astenuto: 0, nulla: 0 };
    let accesiOra = 0;
    seggi.forEach((g, i) => {
      const acceso = g.t != null && p >= g.t;
      if (acceso) {
        n[g.scelta]++;
        accesiOra++;
        if (!stato.accesi[i]) {
          stato.accesi[i] = true;
          const c = cerchi[i];
          if (!c) return;
          c.classList.add('lit', `wp-vt-seat-${g.scelta}`);
          // Il "pop" solo per chi si accende ADESSO: chi arriva a metà
          // trova accesi i seggi passati, senza cento esplosioni insieme.
          if (s.durataMs * Math.abs(p - g.t) < 600) {
            c.classList.add('pop');
            setTimeout(() => c.classList.remove('pop'), 700);
          }
        }
      } else if (stato.accesi[i]) {
        // Il "Rivedi" riparte da zero: si spegne tutto.
        stato.accesi[i] = false;
        cerchi[i]?.classList.remove('lit', 'pop', 'wp-vt-seat-si', 'wp-vt-seat-no', 'wp-vt-seat-astenuto', 'wp-vt-seat-nulla');
      }
    });

    // Numeri: nel referendum ogni pallino vale `peso` voti, e il conto
    // si porta al totale vero quando sono accesi tutti.
    const tutti = accesiOra === seggi.filter((g) => g.t != null).length;
    const mostra = (k) => {
      if (conta) return tutti ? conta[k] : Math.round(n[k] * peso);
      return n[k];
    };
    q('si').textContent = mostra('si').toLocaleString();
    q('no').textContent = mostra('no').toLocaleString();
    for (const k of ['si', 'no', 'astenuto', 'nulla']) { const b = q(`n-${k}`); if (b) b.textContent = mostra(k).toLocaleString(); }
    const votato = ['si', 'no', 'astenuto', 'nulla'].reduce((a, k) => a + mostra(k), 0);
    q('small').textContent = vT('hc_voted', { n: votato.toLocaleString(), tot: Number(aventi).toLocaleString() });
    const ass = q('n-assente');
    const finiti = p >= Q_ACCENDI_A;
    if (ass) ass.textContent = finiti ? Math.max(0, aventi - votato).toLocaleString() : '—';
    el.querySelector('.wp-vt-hemi')?.classList.toggle('wp-vt-hemi-done', finiti);

    // La frase in alto.
    const fase = p >= 1 ? 'fine' : p >= Q_TABELLONE ? 'chiusura' : p >= Q_ACCENDI_DA ? 'voto' : 'attesa';
    if (fase !== stato.fase) {
      stato.fase = fase;
      q('status').textContent = vT(`hc_status_${fase}`);
    }

    // Il tabellone, una casella alla volta, poi il timbro.
    if (celle.length) {
      const quante = p < Q_TABELLONE ? 0
        : Math.min(celle.length, Math.ceil(((p - Q_TABELLONE) / (Q_TABELLONE_FINE - Q_TABELLONE)) * celle.length));
      if (quante !== stato.celle) {
        celle.forEach((c, i) => c.classList.toggle('on', i < quante));
        stato.celle = quante;
      }
      q('board')?.classList.toggle('on', p >= Q_TABELLONE);
      q('stamp')?.classList.toggle('on', p >= Q_TIMBRO);
      q('proclaim')?.classList.toggle('on', p >= Q_TIMBRO);
    }

    if (!el.isConnected) { raf = null; return; }
    raf = p < 1 ? requestAnimationFrame(disegna) : null;
  }

  q('replay')?.addEventListener('click', () => {
    inizioReplay = performance.now();
    if (!raf) raf = requestAnimationFrame(disegna);
  });

  disegna();
  return {
    stop() { if (raf) cancelAnimationFrame(raf); raf = null; },
  };
}
