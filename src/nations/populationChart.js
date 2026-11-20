/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: la popolazione del mondo nel tempo
   ------------------------------------------------------------------
   Richiesta dell'utente (2026-11-20): «un grafico sull'andamento della
   popolazione totale nel tempo». Sta in cima alla linguetta Grafici, sopra
   le quote di oggi: le quote dicono come è divisa la popolazione ADESSO,
   questo quanto è cambiata.

   Il dato è /population-history del cache-server (server/populationHistory.js):
   la somma di `countryActivePopulation`, cioè i giocatori ATTIVI — chi non
   si collega da 3 giorni esce dal conto e ci rientra quando torna. Le prime
   due settimane sono ricostruite a ritroso dagli eventi del ticker (stessa
   serie, letta all'indietro) e la nota lo dice. Senza server la sezione non
   compare: la popolazione di ieri non la dice nessun'altra fonte.

   Il grafico segue le regole comuni (CLAUDE.md, «Grafici: tooltip e
   cursore»): una colonna `wp-tip-hit` per punto, da metà strada a metà
   strada, con il cursore suo come in ecoSection.js (`wp-nat-cur-col`).
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { getLang } from '../shared/i18n.js';
import { escapeHtml } from '../mu/ui.js';
import { tipAttr } from '../shared/chartTip.js';

const DICT = {
  en: {
    title: 'Active population over time', now: 'Now', d1: 'vs 24 hours ago', d7: 'vs 7 days ago', dAll: 'Since {d}',
    players: 'Active players', all: 'All', days: '{n} d',
    note: 'Sum of the population of every nation as the game counts it: active players only (whoever has not logged in for 3 days drops out and comes back when they return). Hourly from {d}.',
    rebuilt: 'From {a} to {b} the hours are rebuilt backwards from the ticker events (the same data, read in reverse); from then on every hour is recorded.',
    daily: 'Longer than three weeks: one point per day (the last reading of the day).',
  },
  it: {
    title: 'Popolazione attiva nel tempo', now: 'Adesso', d1: 'rispetto a 24 ore fa', d7: 'rispetto a 7 giorni fa', dAll: 'Dal {d}',
    players: 'Giocatori attivi', all: 'Tutto', days: '{n} g',
    note: 'Somma della popolazione di tutte le nazioni come la conta il gioco: solo i giocatori attivi (chi non si collega da 3 giorni esce dal conto e ci rientra quando torna). Ora per ora dal {d}.',
    rebuilt: 'Dal {a} al {b} le ore sono ricostruite a ritroso dagli eventi del ticker (lo stesso dato, letto all\'indietro); da lì in poi si registra ogni ora.',
    daily: 'Oltre tre settimane: un punto al giorno (l\'ultima lettura del giorno).',
  },
  es: {
    title: 'Población activa en el tiempo', now: 'Ahora', d1: 'frente a hace 24 horas', d7: 'frente a hace 7 días', dAll: 'Desde el {d}',
    players: 'Jugadores activos', all: 'Todo', days: '{n} d',
    note: 'Suma de la población de todas las naciones tal como la cuenta el juego: solo jugadores activos (quien no se conecta en 3 días sale del recuento y vuelve al regresar). Hora a hora desde el {d}.',
    rebuilt: 'Del {a} al {b} las horas se reconstruyen hacia atrás a partir de los eventos del ticker (el mismo dato, leído al revés); desde entonces se registra cada hora.',
    daily: 'Más de tres semanas: un punto por día (la última lectura del día).',
  },
  de: {
    title: 'Aktive Bevölkerung im Zeitverlauf', now: 'Jetzt', d1: 'ggü. vor 24 Stunden', d7: 'ggü. vor 7 Tagen', dAll: 'Seit {d}',
    players: 'Aktive Spieler', all: 'Alles', days: '{n} T',
    note: 'Summe der Bevölkerung aller Nationen, wie das Spiel sie zählt: nur aktive Spieler (wer sich 3 Tage nicht einloggt, fällt heraus und kommt bei Rückkehr wieder dazu). Stündlich seit {d}.',
    rebuilt: 'Von {a} bis {b} sind die Stunden rückwärts aus den Ticker-Ereignissen rekonstruiert (dieselben Daten, rückwärts gelesen); seitdem wird jede Stunde aufgezeichnet.',
    daily: 'Länger als drei Wochen: ein Punkt pro Tag (letzter Wert des Tages).',
  },
  fr: {
    title: 'Population active dans le temps', now: 'Maintenant', d1: 'par rapport à il y a 24 h', d7: 'par rapport à il y a 7 jours', dAll: 'Depuis le {d}',
    players: 'Joueurs actifs', all: 'Tout', days: '{n} j',
    note: 'Somme de la population de toutes les nations telle que le jeu la compte : seulement les joueurs actifs (qui ne se connecte pas pendant 3 jours sort du compte et y revient à son retour). Heure par heure depuis le {d}.',
    rebuilt: 'Du {a} au {b}, les heures sont reconstruites à rebours à partir des événements du ticker (la même donnée, lue à l\'envers) ; depuis, chaque heure est enregistrée.',
    daily: 'Au-delà de trois semaines : un point par jour (la dernière lecture du jour).',
  },
  nl: {
    title: 'Actieve bevolking door de tijd', now: 'Nu', d1: 't.o.v. 24 uur geleden', d7: 't.o.v. 7 dagen geleden', dAll: 'Sinds {d}',
    players: 'Actieve spelers', all: 'Alles', days: '{n} d',
    note: 'Som van de bevolking van alle naties zoals het spel die telt: alleen actieve spelers (wie 3 dagen niet inlogt valt eruit en komt terug bij terugkeer). Per uur sinds {d}.',
    rebuilt: 'Van {a} tot {b} zijn de uren achteruit herbouwd uit de ticker-gebeurtenissen (dezelfde gegevens, omgekeerd gelezen); daarna wordt elk uur vastgelegd.',
    daily: 'Langer dan drie weken: één punt per dag (de laatste meting van de dag).',
  },
  sv: {
    title: 'Aktiv befolkning över tid', now: 'Nu', d1: 'mot för 24 timmar sedan', d7: 'mot för 7 dagar sedan', dAll: 'Sedan {d}',
    players: 'Aktiva spelare', all: 'Allt', days: '{n} d',
    note: 'Summan av alla nationers befolkning så som spelet räknar den: bara aktiva spelare (den som inte loggar in på 3 dagar räknas bort och kommer tillbaka vid återkomst). Timme för timme sedan {d}.',
    rebuilt: 'Från {a} till {b} är timmarna återskapade bakåt från tickerns händelser (samma data, läst baklänges); sedan dess registreras varje timme.',
    daily: 'Längre än tre veckor: en punkt per dag (dagens sista avläsning).',
  },
  pt: {
    title: 'População ativa ao longo do tempo', now: 'Agora', d1: 'face a 24 horas atrás', d7: 'face a 7 dias atrás', dAll: 'Desde {d}',
    players: 'Jogadores ativos', all: 'Tudo', days: '{n} d',
    note: 'Soma da população de todas as nações tal como o jogo a conta: só jogadores ativos (quem não entra durante 3 dias sai da contagem e volta quando regressa). Hora a hora desde {d}.',
    rebuilt: 'De {a} a {b} as horas são reconstruídas para trás a partir dos eventos do ticker (o mesmo dado, lido ao contrário); desde então cada hora é registada.',
    daily: 'Mais de três semanas: um ponto por dia (a última leitura do dia).',
  },
  ar: {
    title: 'السكان النشطون عبر الزمن', now: 'الآن', d1: 'مقارنة بقبل 24 ساعة', d7: 'مقارنة بقبل 7 أيام', dAll: 'منذ {d}',
    players: 'اللاعبون النشطون', all: 'الكل', days: '{n} ي',
    note: 'مجموع سكان جميع الدول كما تحسبه اللعبة: اللاعبون النشطون فقط (من لا يدخل لمدة 3 أيام يخرج من العدّ ويعود عند عودته). ساعة بساعة منذ {d}.',
    rebuilt: 'من {a} إلى {b} أُعيد بناء الساعات إلى الوراء من أحداث الشريط الإخباري (البيانات نفسها مقروءة بالعكس)؛ ومنذ ذلك الحين تُسجَّل كل ساعة.',
    daily: 'أكثر من ثلاثة أسابيع: نقطة واحدة لكل يوم (آخر قراءة في اليوم).',
  },
};

function t(key, vars) {
  let s = DICT[getLang()]?.[key] ?? DICT.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
const W = 880, H = 220, PAD_T = 12, PAD_B = 4;
const COLOR = '#58a6ff';
const RANGES = [7, 14, 30, 90];
const RANGE_KEY = 'we_nat_pop_range';

let _range = (() => {
  try { const v = localStorage.getItem(RANGE_KEY); return v === 'all' ? 'all' : (RANGES.includes(Number(v)) ? Number(v) : 'all'); }
  catch { return 'all'; }
})();
let _data = null;   // promessa della risposta, una per sessione

const loc = () => document.documentElement.lang || undefined;
const intero = (v) => Math.round(v).toLocaleString(loc());
const segno = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${intero(Math.abs(v))}`;
const pct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toLocaleString(loc(), { maximumFractionDigits: 1 })}%`;
const data = (ms) => new Date(ms).toLocaleDateString(loc(), { day: 'numeric', month: 'short' });
const dataOra = (ms) => new Date(ms).toLocaleString(loc(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function fetchPopulation() {
  if (!_data) {
    _data = (async () => {
      try {
        const res = await fetch(`${WARERA_CACHE_BASE}/population-history`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        return j?.available && Array.isArray(j.world) && j.world.length > 1 ? j : null;
      } catch (err) {
        console.warn('WarEra+ nations: /population-history non disponibile:', err.message);
        _data = null;   // si riprova alla prossima apertura
        return null;
      }
    })();
  }
  return _data;
}

/** Il punto della serie più vicino (prima) a un istante, o null. */
function valoreA(serie, ms) {
  let best = null;
  for (const p of serie) { if (p[0] <= ms) best = p; else break; }
  return best;
}

/** Oltre tre settimane un punto al giorno: l'ultima lettura di ogni giorno UTC. */
function perGiorno(serie) {
  const out = new Map();
  for (const p of serie) out.set(Math.floor(p[0] / DAY_MS), p);
  return [...out.values()];
}

function graficoHtml(punti, giornaliero) {
  const t0 = punti[0][0], t1 = punti[punti.length - 1][0];
  const span = Math.max(1, t1 - t0);
  const vals = punti.map(p => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const h = H - PAD_T - PAD_B;
  const x = (ms) => ((ms - t0) / span) * W;
  const y = (v) => PAD_T + h - ((v - lo) / (hi - lo)) * h;
  const etichetta = giornaliero ? data : dataOra;

  const path = punti.map(([ms, v], i) => `${i ? 'L' : 'M'}${x(ms).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const area = `${path} L${W},${H - PAD_B} L0,${H - PAD_B} Z`;
  const colonne = punti.map(([ms, v], i) => {
    const xa = i ? (x(punti[i - 1][0]) + x(ms)) / 2 : 0;
    const xb = i < punti.length - 1 ? (x(ms) + x(punti[i + 1][0])) / 2 : W;
    const px = x(ms).toFixed(1), py = y(v).toFixed(1);
    const prima = i ? v - punti[i - 1][1] : null;
    return `<g class="wp-nat-cur-col">
        <g class="wp-nat-cur">
          <line class="wp-nat-cur-line" x1="${px}" x2="${px}" y1="0" y2="${H - PAD_B}" vector-effect="non-scaling-stroke"/>
          <line class="wp-nat-cur-dot" x1="${px}" x2="${px}" y1="${py}" y2="${py}" stroke="${COLOR}" vector-effect="non-scaling-stroke"/>
        </g>
        <rect class="wp-tip-hit" x="${xa.toFixed(1)}" y="0" width="${Math.max(1, xb - xa).toFixed(1)}" height="${H}"${tipAttr(
      etichetta(ms), `${t('players')}\t${intero(v)}`, prima ? `Δ\t${segno(prima)}` : null)}/>
      </g>`;
  }).join('');

  return `
    <div class="wp-nat-lab-axisrow wp-nat-lab-axis-top"><span>${escapeHtml(intero(Math.max(...vals)))}</span><span>${escapeHtml(intero(Math.min(...vals)))}</span></div>
    <svg class="wp-nat-lab-chart wp-nat-pop-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(t('title'))}">
      <path d="${area}" fill="${COLOR}" fill-opacity=".14"/>
      <path d="${path}" fill="none" stroke="${COLOR}" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${colonne}
    </svg>
    <div class="wp-nat-lab-axisrow"><span>${escapeHtml(etichetta(t0))}</span><span>${escapeHtml(etichetta(t1))}</span></div>`;
}

function cardHtml(d) {
  const tutto = d.world;
  const ultimo = tutto[tutto.length - 1];
  const giorniTot = (ultimo[0] - tutto[0][0]) / DAY_MS;
  // Solo gli intervalli più corti della serie, più «Tutto».
  const scelte = RANGES.filter(r => r < giorniTot);
  if (_range !== 'all' && !scelte.includes(_range)) _range = 'all';
  const da = _range === 'all' ? tutto[0][0] : ultimo[0] - _range * DAY_MS;
  let serie = tutto.filter(p => p[0] >= da);
  const giornaliero = (serie[serie.length - 1][0] - serie[0][0]) > 21 * DAY_MS;
  if (giornaliero) serie = perGiorno(serie);

  const delta = (ms) => {
    const p = valoreA(tutto, ms);
    return p && p !== ultimo ? [ultimo[1] - p[1], ((ultimo[1] - p[1]) / p[1]) * 100] : null;
  };
  const tile = (lab, val, cls = '', sub = '') => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val ${cls}">${escapeHtml(val)}</strong>
      ${sub ? `<span class="wp-nat-lab-lab">${escapeHtml(sub)}</span>` : ''}
    </div>`;
  const tileDelta = (lab, dd) => (dd
    ? tile(lab, segno(dd[0]), dd[0] > 0 ? 'wp-nat-up' : dd[0] < 0 ? 'wp-nat-down' : '', pct(dd[1]))
    : '');
  const tiles = [
    tile(t('now'), intero(ultimo[1])),
    tileDelta(t('d1'), delta(ultimo[0] - DAY_MS)),
    tileDelta(t('d7'), delta(ultimo[0] - 7 * DAY_MS)),
    tileDelta(t('dAll', { d: data(serie[0][0]) }), delta(serie[0][0])),
  ].join('');

  const chips = scelte.length ? `
      <div class="wp-nat-curve-range" role="group">
        ${[...scelte, 'all'].map(r => `<button type="button" data-pop-range="${r}" class="${r === _range ? 'active' : ''}">${escapeHtml(r === 'all' ? t('all') : t('days', { n: r }))}</button>`).join('')}
      </div>` : '';

  const note = [
    t('note', { d: data(d.startedAt && (!d.rebuiltFrom || d.startedAt < d.rebuiltFrom) ? d.startedAt : tutto[0][0]) }),
    d.rebuiltFrom && d.rebuiltTo ? t('rebuilt', { a: dataOra(d.rebuiltFrom), b: dataOra(d.rebuiltTo) }) : '',
    giornaliero ? t('daily') : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="wp-nat-curve-head">
      <h4 class="wp-nat-chart-title" data-sec="nat-population">${escapeHtml(t('title'))}</h4>
      ${chips}
    </div>
    <div class="wp-nat-lab-tiles">${tiles}</div>
    ${graficoHtml(serie, giornaliero)}
    <p class="wp-nat-curve-note">${escapeHtml(note)}</p>`;
}

/** Il segnaposto da mettere nella linguetta Grafici: vuoto finché non arriva il dato. */
export function populationSlotHtml() {
  return '<div class="wp-nat-chart wp-nat-pop" id="wp-nat-pop" hidden></div>';
}

/** Riempie il segnaposto (se c'è ancora: l'utente può aver cambiato linguetta). */
export async function paintPopulation(root) {
  const d = await fetchPopulation();
  const el = root?.querySelector('#wp-nat-pop');
  if (!el || !d) return;
  const paint = () => { el.innerHTML = cardHtml(d); el.hidden = false; };
  paint();
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pop-range]');
    if (!b) return;
    const v = b.dataset.popRange;
    _range = v === 'all' ? 'all' : Number(v);
    try { localStorage.setItem(RANGE_KEY, String(_range)); } catch { /* niente: resta per la sessione */ }
    paint();
  });
}
