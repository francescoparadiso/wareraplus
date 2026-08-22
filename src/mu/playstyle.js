/* ══════════════════════════════════════════════════════════════
   WarEra+ — Stile di gioco: guerra / economia
   ------------------------------------------------------------------
   Un giocatore WarEra distribuisce punti abilità fra skill di
   combattimento e skill di impresa. Da quella distribuzione si legge come
   gioca davvero, ed è un dato che il gioco non espone come tale: va
   ricavato.

   COSA CONTARE. Ogni skill è un oggetto { level, value, weapon,
   equipment, total, … }. Conta solo `level`: è l'unica parte che il
   giocatore ha scelto. `value`/`total` includono la base che hanno tutti
   (caso reale: criticalDamages vale 100 anche a level 0), le armi,
   l'equipaggiamento e la percentuale da grado militare — bastano a far
   risultare "guerriero" chiunque abbia raccolto un fucile.

   QUANTO VALE UN LIVELLO. Portare una skill a livello n costa n(n+1)/2
   punti cumulati. Verificato su 900 utenti campionati dalle classifiche
   (ricchezza, danni, livello, territorio, casse): la somma dei costi su
   tutte le skill coincide con `leveling.spentSkillPoints` per 900 su 900.
   Contare i livelli invece dei punti sovrastimerebbe le skill basse —
   livello 8 costa 36 punti, livello 2 ne costa 3.

   SKILL NEUTRE. energy/health/hunger restano fuori dal calcolo: le
   prendono tutti (15% dei punti in mediana) e includerle sposterebbe solo
   ogni indice verso il centro senza distinguere nessuno.

   SOGLIE. L'indice `guerra / (guerra + economia)` è nettamente bimodale:
   sui 900 campionati, 682 stanno sopra 0,8 o sotto 0,2 e la fascia
   centrale 0,3-0,7 è il 5%. Da qui i tagli a 0,3 e 0,7, con "misto" per
   quel 5% invece di forzarlo da una parte.

   CONTROPROVA. L'indice descrive il gioco reale e non se stesso: sopra
   0,7 i danni mediani sono 47,3M contro 20,1M, sotto 0,3 la ricchezza
   mediana è 40.070 contro 25.560 — e né danni né ricchezza entrano nel
   calcolo.

   ⚠️ È una fotografia: `leveling.freeReset` e `skillsExpiration` dicono
   che le skill si possono resettare, quindi un giocatore può cambiare
   assetto prima di una guerra e tornare indietro dopo.

   Lo stesso calcolo esiste anche lato server (warera-cache-server.js:
   classifyPlaystyle) per i conteggi dell'elenco MU e del pannello
   nazione, dove i dati utente li ha solo lui. Qui serve per le schede
   dove i membri sono già stati scaricati, e il conto si fa dal vivo su
   dati completi. Se cambi le soglie o gli elenchi di skill, vanno
   cambiati in tutti e due i posti.
   ══════════════════════════════════════════════════════════════ */

export const WAR_SKILLS = ['attack', 'criticalChance', 'criticalDamages', 'armor', 'precision', 'dodge', 'lootChance'];
export const ECO_SKILLS = ['companies', 'entrepreneurship', 'production', 'management'];

const skillCost = n => (n * (n + 1)) / 2;

/** { mode: 'war'|'eco'|'mixed'|'undecided', index, war, eco } per un utente
 *  nella forma restituita da user.getUserLite. */
export function classifyPlaystyle(user) {
  const pts = key => skillCost(user?.skills?.[key]?.level || 0);
  const war = WAR_SKILLS.reduce((s, k) => s + pts(k), 0);
  const eco = ECO_SKILLS.reduce((s, k) => s + pts(k), 0);
  if (war + eco === 0) return { mode: 'undecided', index: null, war, eco };
  const index = war / (war + eco);
  return {
    mode: index >= 0.7 ? 'war' : index <= 0.3 ? 'eco' : 'mixed',
    index, war, eco,
  };
}

/** Conteggi su una lista di utenti già scaricati. Stessa forma di quelli
 *  che il server mette in `mu.playstyle` e in /mu-playstyle-by-country, così
 *  chi disegna non deve sapere da dove arrivano. */
export function countPlaystyles(users) {
  const out = { war: 0, eco: 0, mixed: 0, undecided: 0, known: 0 };
  for (const u of users) {
    if (!u?.skills) continue;
    out.known++;
    out[classifyPlaystyle(u).mode]++;
  }
  return out;
}

/** Ordine di lettura e classe CSS di ogni gruppo. "undecided" per ultimo:
 *  è l'assenza di una scelta, non una terza scuola di pensiero. */
export const PLAYSTYLE_GROUPS = ['war', 'eco', 'mixed', 'undecided'];

/** Variazione fra il campione più vecchio della finestra e quello attuale.
 *  Le righe dello storico sono [ts, war, eco, mixed, undecided, known].
 *
 *  Il confronto è sui NUMERI ASSOLUTI, non sulle percentuali: "dieci persone
 *  sono passate alla guerra" è il fatto, mentre una percentuale si muove
 *  anche solo perché sono entrati o usciti membri dalle unità. `known`
 *  serve appunto a distinguere i due casi, e viene riportato.
 *
 *  Ritorna null se non c'è abbastanza storico per un confronto onesto (una
 *  sola misurazione non è una tendenza). */
export function playstyleDelta(series) {
  if (!Array.isArray(series) || series.length < 2) return null;
  const first = series[0];
  const last = series[series.length - 1];
  return {
    war: last[1] - first[1],
    eco: last[2] - first[2],
    mixed: last[3] - first[3],
    known: last[5] - first[5],
    fromTs: first[0],
    toTs: last[0],
  };
}

/** Il travaso NETTO fra guerra ed economia dentro la finestra.
 *
 *  Un giocatore che passa all'economia lo fa quasi sempre venendo dalla
 *  guerra: i due delta si muovono in direzioni opposte e la parte che si
 *  corrisponde è gente che ha cambiato scuola, non gente entrata o uscita dal
 *  campione. Quella parte è `min(|war|, |eco|)` — deliberatamente la stima
 *  PIÙ PRUDENTE: se guerra fa +2 ed economia -7, cinque dei sette se ne sono
 *  andati dal campione (o sono diventati ibridi), due soli sono passati di là.
 *
 *  Se i due delta hanno lo stesso segno non c'è stato travaso, solo il
 *  campione che cresce o cala: ritorna null, e la riga non compare.
 *
 *  `base` (il `known` attuale) serve alla percentuale; senza, `pct` è null. */
export function playstyleSwitch(delta, base) {
  if (!delta) return null;
  const { war, eco } = delta;
  if (war === 0 || eco === 0) return null;
  if ((war > 0) === (eco > 0)) return null; // stesso verso: campione, non travaso
  const n = Math.min(Math.abs(war), Math.abs(eco));
  if (!n) return null;
  return {
    n,
    to: war > 0 ? 'war' : 'eco',
    from: war > 0 ? 'eco' : 'war',
    pct: base > 0 ? (n / base) * 100 : null,
  };
}

/** Somma i conteggi di più nazioni (o unità): serve al pannello alleanza,
 *  dove la domanda è come gioca il blocco nel suo insieme. Le nazioni senza
 *  dato semplicemente non contribuiscono, e `countries` dice su quante il
 *  totale è costruito — un blocco di 20 nazioni con dati per 12 va detto,
 *  non nascosto dietro una barra che sembra completa. */
export function sumPlaystyleCounts(list) {
  const out = { war: 0, eco: 0, mixed: 0, undecided: 0, known: 0, countries: 0, total: 0 };
  for (const c of list) {
    if (!c?.known) continue;
    out.countries++;
    for (const g of PLAYSTYLE_GROUPS) out[g] += c[g] || 0;
    out.known += c.known;
    // `total` = cittadini censiti della nazione (server: pollCitizens).
    // Manca sui server vecchi: in quel caso si ripiega su `known`, così la
    // somma resta un numero sensato invece di zero.
    out.total += (c.total ?? c.known);
  }
  return out;
}

/** Somma le variazioni di più nazioni, ognuna calcolata sulla PROPRIA serie
 *  con playstyleDelta. Non si sommano le serie fra loro perché i campioni di
 *  nazioni diverse non cadono negli stessi istanti (il server scrive una riga
 *  solo quando i conteggi di quella nazione cambiano): sommare per indice
 *  confronterebbe momenti diversi. Sommare i delta invece è esatto, ognuno è
 *  già "da inizio finestra a ora" per casa sua.
 *
 *  Ritorna null se nessuna nazione ha abbastanza storico. */
export function sumPlaystyleDeltas(seriesByCountry) {
  const deltas = Object.values(seriesByCountry || {}).map(playstyleDelta).filter(Boolean);
  if (!deltas.length) return null;
  return {
    war: deltas.reduce((s, d) => s + d.war, 0),
    eco: deltas.reduce((s, d) => s + d.eco, 0),
    mixed: deltas.reduce((s, d) => s + d.mixed, 0),
    known: deltas.reduce((s, d) => s + d.known, 0),
    fromTs: Math.min(...deltas.map(d => d.fromTs)),
    toTs: Math.max(...deltas.map(d => d.toTs)),
  };
}

/** Barra proporzionale + conteggi. Classi `wp-ps-*` definite in shell.css
 *  (non in mu.css): la usano sia la scheda MU sia il pannello nazione, e il
 *  pannello nazione vive senza che il modulo MU sia mai stato aperto —
 *  quindi il suo foglio di stile non è detto che sia caricato.
 *
 *  `labels` arriva da fuori perché i due punti di uso hanno dizionari i18n
 *  diversi (src/mu/i18n.js e src/shared/i18n.js). */
export function playstyleBarHtml(counts, labels) {
  if (!counts?.known) return '';
  const groups = PLAYSTYLE_GROUPS.filter(g => counts[g] > 0);
  return `
    <div class="wp-ps">
      <div class="wp-ps-bar">
        ${groups.map(g => `<span class="wp-ps-seg wp-ps-${g}" style="width:${(counts[g] / counts.known) * 100}%" title="${labels[g]} · ${counts[g]}"></span>`).join('')}
      </div>
      <div class="wp-ps-legend">
        ${groups.map(g => `
          <span class="wp-ps-item">
            <span class="wp-ps-dot wp-ps-${g}"></span>
            <strong>${counts[g]}</strong>
            <span>${labels[g]}</span>
          </span>`).join('')}
      </div>
    </div>`;
}
