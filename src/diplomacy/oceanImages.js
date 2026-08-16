// oceanImages.js
//
// WarEra+ — carica in maplibre le illustrazioni "da mappa antica" fornite
// dall'utente (nave, mostro marino, relitto, texture "onda") e le rende
// disponibili come icone (map.addImage) sia per i pallini animati sulle
// rotte commerciali (tema scuro) sia per gli easter egg/texture statici
// sulla mappa "pergamena" (tema chiaro, vedi antiqueTheme.js).
//
// ATTENZIONE — file da fornire a mano: queste immagini sono state
// incollate in chat, non salvate su disco, quindi non è stato possibile
// estrarle automaticamente nel progetto. Vanno salvate qui, con questi
// nomi esatti:
//   public/icons/ocean/ship.png
//   public/icons/ocean/sea-monster.png
//   public/icons/ocean/shipwreck.png
//   public/icons/ocean/wave-1.png
//   public/icons/ocean/wave-2.png
// Se un file manca, il relativo layer viene semplicemente saltato (nessun
// errore bloccante) — vedi loadOceanImages().
//
// Round 2 (tema SCURO — vedi darkFleetTheme.js): stesso meccanismo, altro
// batch di illustrazioni fornite dall'utente in chat, stesso vincolo (vanno
// salvate a mano). Nomi distinti dal batch "tema chiaro" sopra per evitare
// collisioni:
//   public/icons/ocean/fleet-destroyers.png  (pattuglia: sommergibile +
//     cacciatorpediniere/fregate — la formazione da 6 navi)
//   public/icons/ocean/fleet-carrier.png     (gruppo portaerei da 7 navi)
//   public/icons/ocean/cargo-ship.png        (nave container/mercantile)
//   public/icons/ocean/wave-dark.png         (l'onda singola stile
//     "maremoto/cresta" — diversa dalle wave-1/wave-2 già in uso per il
//     tema chiaro, non le sostituisce)
//
// Round 3 (varietà onde tema scuro): altre 2 texture "onda" per alternare
// coi 3 disegni invece di ripetere sempre lo stesso (vedi WAVE_TEXTURE in
// darkFleetTheme.js):
//   public/icons/ocean/wave-dark-2.png
//   public/icons/ocean/wave-dark-3.png

export const OCEAN_IMAGE_IDS = {
  ship: 'wp-ocean-img-ship',
  seaMonster: 'wp-ocean-img-sea-monster',
  shipwreck: 'wp-ocean-img-shipwreck',
  wave1: 'wp-ocean-img-wave-1',
  wave2: 'wp-ocean-img-wave-2',
  fleetDestroyers: 'wp-ocean-img-fleet-destroyers',
  fleetCarrier: 'wp-ocean-img-fleet-carrier',
  cargoShip: 'wp-ocean-img-cargo-ship',
  waveDark: 'wp-ocean-img-wave-dark',
  waveDark2: 'wp-ocean-img-wave-dark-2',
  waveDark3: 'wp-ocean-img-wave-dark-3',
};

const SOURCES = {
  [OCEAN_IMAGE_IDS.ship]: '/icons/ocean/ship.png',
  [OCEAN_IMAGE_IDS.seaMonster]: '/icons/ocean/sea-monster.png',
  [OCEAN_IMAGE_IDS.shipwreck]: '/icons/ocean/shipwreck.png',
  [OCEAN_IMAGE_IDS.wave1]: '/icons/ocean/wave-1.png',
  [OCEAN_IMAGE_IDS.wave2]: '/icons/ocean/wave-2.png',
  [OCEAN_IMAGE_IDS.fleetDestroyers]: '/icons/ocean/fleet-destroyers.png',
  [OCEAN_IMAGE_IDS.fleetCarrier]: '/icons/ocean/fleet-carrier.png',
  [OCEAN_IMAGE_IDS.cargoShip]: '/icons/ocean/cargo-ship.png',
  [OCEAN_IMAGE_IDS.waveDark]: '/icons/ocean/wave-dark.png',
  [OCEAN_IMAGE_IDS.waveDark2]: '/icons/ocean/wave-dark-2.png',
  [OCEAN_IMAGE_IDS.waveDark3]: '/icons/ocean/wave-dark-3.png',
};

// La versione "nave" fornita ha sfondo bianco pieno (le altre due sono già
// trasparenti): la chiave qui sotto lo rimuove al volo via canvas, così
// l'utente non deve pre-ritagliarla a mano in un editor.
function keyOutWhiteBackground(ctx, w, h) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  // controlla un angolo per capire se lo sfondo è davvero bianco pieno
  // (le immagini già trasparenti hanno alpha 0 lì, quindi la media resta bassa)
  const cornerIsWhite = d[0] > 235 && d[1] > 235 && d[2] > 235 && d[3] > 200;
  if (!cornerIsWhite) return;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (r > 235 && g > 235 && b > 235) {
      d[i + 3] = 0; // bianco pieno -> trasparente
    } else if (r > 205 && g > 205 && b > 205) {
      d[i + 3] = Math.round(d[i + 3] * 0.25); // bordo antialiasing morbido
    }
  }
  ctx.putImageData(img, 0, 0);
}

// WarEra+ perf (mobile) — queste illustrazioni sono 1536x1024 l'una: a
// risoluzione piena sono 1,5 megapixel × 4 byte = 6 MB di soli pixel per
// immagine, che vanno scansionati da keyOutWhiteBackground, letti da
// getImageData e tenuti in memoria da maplibre. Su un telefono è un costo
// sproporzionato per una decorazione.
//
// Su schermi piccoli si dimezza il lato in fase di caricamento (un quarto
// dei pixel). La dimensione a schermo NON cambia: maplibre calcola il lato
// visibile come larghezza/pixelRatio, quindi dimezzando la larghezza si
// dimezza anche il pixelRatio dichiarato più sotto. L'unica differenza è
// la nitidezza allo zoom massimo su un'icona che, di suo, a quel punto
// occupa già più dell'intero schermo.
const MOBILE_MAX_WIDTH = 768;
const isSmallScreen = () => window.innerWidth <= MOBILE_MAX_WIDTH;

function loadOneImage(map, id, url) {
  return new Promise(resolve => {
    if (map.hasImage(id)) { resolve(true); return; }
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => {
      try {
        const shrink = isSmallScreen() ? 0.5 : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(el.naturalWidth * shrink));
        canvas.height = Math.max(1, Math.round(el.naturalHeight * shrink));
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        keyOutWhiteBackground(ctx, canvas.width, canvas.height);
        // ImageData, non il <canvas> grezzo: map.addImage() non lo
        // accetta direttamente in questa versione di maplibre-gl (la
        // conversione interna leggeva le dimensioni come 0x0 e lanciava
        // RangeError "mismatched image size", che qui era comunque
        // contenuto dal try/catch ma faceva comunque fallire il layer).
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        // pixelRatio scalato insieme al lato (vedi nota su `shrink` sopra):
        // è ciò che tiene la dimensione a schermo identica a prima.
        if (!map.hasImage(id)) map.addImage(id, imageData, { pixelRatio: 2 * shrink });
        resolve(true);
      } catch (err) {
        console.warn(`[oceanImages] impossibile processare ${url}:`, err);
        resolve(false);
      }
    };
    el.onerror = () => {
      // Non bloccante: senza il file, i layer che lo usano vengono
      // semplicemente saltati altrove (vedi chiamanti).
      console.warn(`[oceanImages] immagine mancante: ${url} — vedi le istruzioni in testa a oceanImages.js`);
      resolve(false);
    };
    el.src = url;
  });
}

// Promessa per SINGOLA immagine, non una sola per tutto il gruppo.
// WarEra+ perf (mobile): prima esisteva un unico `_loadPromise` che
// caricava TUTTE le 11 illustrazioni al primo chiamante — quindi il tema
// scuro tirava dentro anche le 5 del tema chiaro (e viceversa), mai
// mostrate. Verificato dal vivo a tema scuro: 11 immagini in mappa, 17,3
// megapixel, ~66 MB di soli pixel. Ora ogni tema chiede le sue e paga solo
// quelle, e la memoizzazione per-id fa sì che un'immagine condivisa fra i
// due gruppi (oggi nessuna, ma domani chissà) venga comunque caricata una
// volta sola.
const _imagePromises = new Map();

/**
 * Carica in maplibre (una sola volta ciascuna) le immagini richieste.
 * Ritorna una mappa { [OCEAN_IMAGE_IDS.x]: boolean } con l'esito, così i
 * chiamanti possono saltare in sicurezza i layer per le immagini mancanti.
 *
 * @param {object} map istanza maplibre
 * @param {string[]} [ids] id da caricare (default: tutte — mantenuto per
 *   compatibilità, ma i due temi passano sempre il proprio sottoinsieme)
 */
export function loadOceanImages(map, ids) {
  const wanted = ids?.length ? ids : Object.keys(SOURCES);
  return (async () => {
    const results = {};
    for (const id of wanted) {
      const url = SOURCES[id];
      if (!url) { results[id] = false; continue; }
      if (!_imagePromises.has(id)) _imagePromises.set(id, loadOneImage(map, id, url));
      results[id] = await _imagePromises.get(id);
    }
    return results;
  })();
}
