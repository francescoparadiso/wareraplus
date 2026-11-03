# Come si scrive un articolo WarEra+

Gli articoli (aggiornamenti di versione, analisi delle elezioni…) si scrivono
nell'**Article Writer di <https://arcana.warera.wiki/news>**, in **inglese**.
Questo file raccoglie le regole date dal proprietario del progetto e le
ricette tecniche che le rendono eseguibili. Il riassunto sta in `CLAUDE.md`
("Articoli"); qui c'è il dettaglio.

## Le regole

1. **Si scrive in Arcana, sempre.** Non in un file a parte e poi "da copiare":
   l'articolo intero sta nell'editor (`.tiptap`), con titolo e immagini.
2. **La pagina resta aperta con l'articolo intero**, in cima, nel pannello
   Browser: il proprietario lo copia con **"Copy HTML"** (da altrove "non lo
   prende bene"). Mai premere "Copy HTML" né pubblicare su WarEra al posto suo.
3. **Lingua: inglese.** Tono e stile come `warera-plus-v1.1.html` per gli
   aggiornamenti di versione (voce frappa10, poco tecnico, sulle novità);
   per le analisi, dati prima, e dichiarare in chiaro cosa non si sa.
4. **Riverificare i numeri sui dati grezzi** prima di scrivere e prima di
   consegnare (voti, percentuali, margini, ENP, iscritti, governi riletti dal
   vivo). Dire l'orario di lettura e cosa non si è potuto verificare.
5. **Governi: mettere i membri esistenti** (presidente, vice, ministri),
   segnando chi è nuovo, chi è rimasto, chi è stato spostato e le cariche vuote.
6. **Nessun segnaposto in consegna.** Se l'articolo cita un'immagine, la si
   crea (screenshot dal tool, grafico, collage) e la si mette dove serve.
7. **Immagini: screenshot dal tool** (WarEra+), anche più d'uno per tema, e
   un **collage** quando ci sono più paesi. Poi **caricarle su Imgur** e
   inserire il link diretto nell'articolo (vedi sotto).
8. **Link al tool ovunque abbia senso**: didascalie, riga del governo, testo,
   sezione finale "Explore it yourself in WarEra+".
9. **Link ai partiti con `partyId`** (vedi "Link"): senza, non si risolvono.
10. **Usare formattazione, font e colori** per migliorare l'articolo (palette
    sotto), non solo testo nero.
11. **Non chiedere il consenso a ogni passo** di questo flusso (screenshot,
    caricamento su Imgur, incolla nell'editor, correzioni): si fa e si
    riferisce. Restano all'utente: il login, "Copy HTML" e la pubblicazione.

## Dati

Fonti, dalla più grezza alla più comoda (tutte senza chiave):

- governi: `government.getByCountryId` su `api6.warera.io` (`president`,
  `vicePresident`, `minOfDefense`, `minOfForeignAffairs`, `minOfEconomy`);
  storico dei gabinetti in `/political-history?countryId=` del cache-server
  (`governments.rows`, una lettura ogni 6 ore);
- elezioni: `/elections?countryIds=a,b,c` del cache-server; i voti stanno in
  `votes` (`{userId: n}`), i candidati in `candidates` (con `party`, `isElected`);
- popolazione attiva: `ranking.getRanking {rankingType:'countryActivePopulation'}`;
  si muove ogni ora, quindi datare la lettura e ricalcolare l'affluenza;
- spostamenti: `/migration-flows?days=30&daily=1` (vista Migrazioni) e
  `/citizen-moves?countryId=` (pannello nazione) **danno numeri leggermente
  diversi**: nell'articolo vale quello che compare nello screenshot.

Controlli minimi: la somma dei voti è `votesCount`; percentuali e margini
ricalcolati; ENP = 1/Σp²; i numeri dello screenshot del tool coincidono.
Le elezioni del congresso chiudono il **7** del mese, le presidenziali il 3
(si apre il 1°). Ogni voto presidenziale azzera il gabinetto e il presidente
lo ricostruisce in ore: leggere i governi a distanza dal voto.

## Link

Ogni menzione è un `<span data-content-link="" data-content-type=…
data-content-data="{&quot;…&quot;}" data-original-text="https://app.warera.io/<tipo>/<id>">`
(span vuoto, il nome lo mette l'editor):

| tipo | `data-content-data` |
|---|---|
| user | `{"userId":…, "fullMatch":…}` |
| party | `{"partyId":…, "fullMatch":…}` ← **senza `partyId` il link non funziona** |
| country | `{"countryId":…, "fullMatch":…}` |

Validare tutti gli id con l'API (`user.getUserLite`, `party.getById`,
`country.getAllCountries`) prima di incollare. Arcana sa taggare solo User,
Country, Battle, Article, Company, Military Unit: i **partiti** e i paesi
nati dopo la sua lista (Maldive) compaiono come **URL nudi nell'editor**, ed
è normale — l'HTML è giusto.

Link al tool (`https://wareraplus.vercel.app/`, sempre il live, mai il dev):
`?section=political&country=<id>` (Political View, ultima presidenziale),
`?section=nations&nation=<id>` (Statistiche nazione),
`?map=migration&focus=<id>&days=30` (mappa Migrazioni), `?tm=<epoch ms>`
(time machine). Elenco completo dei parametri: `handleIncomingDeepLink` in
`src/main.js`. Evitare come testo del link un dominio nudo
(`wareraplus.vercel.app`): l'editor lo riscrive in `http://…`.

## Formattazione

L'editor accetta `h2`, `strong`/`em`, `span` con `color` e `font-family`,
`blockquote`, `hr`, liste, `text-align`; la dimensione del testo viene scartata.
Font: Texturina per titoli e sommario (gli altri della lista sono decorativi).
Palette (leggibile su fondo chiaro e scuro): ambra `#d97706` titoli dei paesi
ed etichette dei paragrafi; blu `#2563eb` sezioni speciali; verde `#1a7d3f`
risultato del vincitore, sezioni di sintesi, affluenza ≥ 55%; rosso `#dc3545`
cariche vuote, affluenza < 40%; grigio `#6b7280` note e didascalie.
Sommario di apertura centrato; note sui dati, "In short" e le interpretazioni
dell'autore in `blockquote`; didascalie centrate in corsivo grigio, col link al tool.

## Screenshot e grafici

Con **Chrome headless e un piccolo driver CDP** (WebSocket globale di Node,
nessuna dipendenza), non col browser interno (screenshot a ~800 px) e sul
**deploy dev** (`wareraplus-dev.vercel.app`), perché il live scrive su
`/visits`, Umami e Vercel Analytics a ogni caricamento.

- Political View: `?section=political&country=<id>`; attendere
  `#presRacePanel .pres-winner-label`; nascondere `#wp-deploy-badge`,
  `#statsRow`, `#presGovernmentPanel` e il toast "Fetching…" (risalire
  all'antenato `position: fixed`); ritagliare da `.app > header.header` al
  fondo di `#presRacePanel`. Viewport 1400 px, dpr 1,5 → ~1956 px.
- Mappa Migrazioni (WebGL): flag `--use-angle=swiftshader
  --enable-unsafe-swiftshader --ignore-gpu-blocklist`, dpr 1,5, ~35 s di
  attesa; la mappa si sposta trascinando col mouse (`Input.dispatchMouseEvent`)
  sull'Oceano Indiano; parcheggiare il mouse sulla barra in alto, altrimenti
  compare il tooltip di una nazione.
- Collage: pagina HTML a griglia aperta da `file://`, screenshot a dpr 1.
- Dove il tool non ha una vista adatta (affluenza fra paesi, arrivi nel tempo)
  si disegna un grafico nello stile di WarEra+ (sfondo `#0b0e14`, oro,
  Playfair Display) con i dati verificati, e lo si dichiara come tale.
- Altezza dello screenshot = altezza di `document.body`, non
  `documentElement.scrollHeight` (quella è almeno il viewport).

## Imgur

1. **Il login lo fa l'utente**, nel pannello Browser (`imgur.com/upload`,
   anche il popup cookie): le credenziali non si inseriscono mai. La sessione
   resta nel pannello.
2. Il campo `#file-input` accetta più file: si riempie con `File` costruiti in
   pagina e un evento `change`. I byte arrivano alla pagina via `window.name`
   (un server locale serve una pagina che lo imposta; poi `navigate` a imgur).
3. Il caricamento crea un **album nascosto** nell'account dell'utente: non
   darlo mai alla galleria pubblica ("Share with the community").
4. Imgur **riordina** le immagini e le ricomprime (~2% di byte in meno):
   abbinare link e file con una firma a pixel (disegnare ridotto su canvas e
   confrontare), non con nome o dimensione. Link diretti `https://i.imgur.com/<id>.png`.
5. Nell'articolo: popover "Insert image" (`#nd-image-url-input` +
   `#nd-image-insert-btn`) o `<img class="tiptap-image" src=…>` nell'HTML
   incollato (funziona). Host ammessi: Imgur, Giphy, Tenor, Cloudinary,
   PostImages, ImgBB, ImageBam.

## Editor di Arcana

- Aprire lo scrittore: `ndToggleReaderWriter()`; l'istanza è
  `document.querySelector('.tiptap').editor` (`getHTML()`, `chain()…`). La
  bozza si salva da sola ("Draft saved automatically").
- Incollare un HTML grosso: da pagina https `fetch` e `<script src>` verso
  `http://127.0.0.1` sono bloccati. Funziona **`window.name`**: una pagina
  locale imposta `window.name`, poi si naviga ad arcana (il nome sopravvive,
  testato fino a 8 MB), lo si legge e lo si svuota. Poi `ClipboardEvent('paste')`
  con `DataTransfer` (`text/html`) sul `.tiptap`.
- Svuotare con Ctrl+A e Backspace (mai `execCommand('delete')`: lascia un blocco).
- ⚠️ Incollando in un editor vuoto il primo paragrafo prende gli attributi di
  quello vuoto: rimettere l'allineamento con
  `editor.chain().focus().setTextSelection(1).setTextAlign('center').run()`.
- Dopo l'incolla contare: titoli, immagini, span utente/partito/paese, `partyId`,
  link al tool (devono essere quanti nella sorgente), blockquote, nessun
  `[IMAGE`. L'editor riscrive i link il cui testo sembra un dominio.
- Lasciare la scheda di Arcana in primo piano: chiudere le schede di anteprima
  aperte dalla pagina HTML di lavoro e quella di Imgur.

## Trappole

- Nella shell dello strumento i **backslash dei heredoc vengono mangiati**
  (`\\s` → `s`, `\n` → a capo): gli script con regex vanno scritti con lo
  strumento Write, non con `cat <<EOF`.
- `sleep` in primo piano è bloccato: aspettare con un ciclo `until … do sleep`
  in background.
- Scrivere un file `.html` nella cartella di lavoro lo fa aprire in anteprima
  nel pannello Browser: chiudere quelle schede alla fine.
- Per l'articolo di novembre 2026 l'HTML dell'editor è stato generato da un
  piccolo script con una sintassi a token (`@u:ID`, `@p:ID`, `@c:ID`,
  `[[testo|url]]`, colori), tenuto in una cartella temporanea e **non nel
  repo**: nel repo c'è solo l'HTML finale (`presidential-november-2026.html`,
  se è stato committato). Rifarlo è un'ora di lavoro; se si vuole averlo
  sotto mano per i prossimi articoli, conviene metterlo in `tools/articles/`.
