// ═══════════════════════════════════════════════════════════════════════
// WarEra+ — colore di una nazione come lo disegna il GIOCO
// ═══════════════════════════════════════════════════════════════════════
// Prima la mappa prendeva il colore da countryLabels[].strokeColor (i dati di
// map.getMapData): è la tinta del bordo dell'etichetta, più scura e a volte
// sbagliata (Cechia "sand" usciva #363630 quasi grigio, l'Austria "gray
// light" aveva la stessa tinta della Spagna "gray dark"). Inoltre 61 paesi su
// 180 non hanno etichetta (Belgio, Slovacchia, Danimarca, Ungheria…) e
// cadevano sul grigio neutro.
//
// Il gioco invece colora ogni nazione col token `${scheme}${accento}` dove
// scheme e mapAccent vengono da country.getAllCountries e l'accento vale
// light=675, normal=725, dark=775 (bundle app.warera.io, _app: `y={light:675,
// normal:725,dark:775}`). Qui sotto ci sono i 23 scheme in uso coi tre valori,
// estratti da lì il 2026-10-18.
//
// Additivo: se una nazione non ha scheme (o ne ha uno sconosciuto) si
// restituisce null e chi chiama ricade sul comportamento di prima.
// ═══════════════════════════════════════════════════════════════════════

const ACCENT_STEP = { light: '675', normal: '725', dark: '775' };

const GAME_PALETTE = {
  red:        { 675: '#7A2123', 725: '#681C1D', 775: '#551718' },
  primary:    { 675: '#7A2123', 725: '#681C1D', 775: '#551718' },
  deepOrange: { 675: '#832E23', 725: '#6F271D', 775: '#5B2018' },
  brown:      { 675: '#57514E', 725: '#4A4442', 775: '#3D3836' },
  sand:       { 675: '#58584D', 725: '#4A4B41', 775: '#3D3D36' },
  orange:     { 675: '#7D3C21', 725: '#69331C', 775: '#562A17' },
  lightOrange:{ 675: '#7D5221', 725: '#69451C', 775: '#563917' },
  amber:      { 675: '#745922', 725: '#624C1C', 775: '#503E17' },
  yellow:     { 675: '#606124', 725: '#51521E', 775: '#424319' },
  olive:      { 675: '#5C5E48', 725: '#4E4F3D', 775: '#404132' },
  lime:       { 675: '#485B32', 725: '#3D4D2B', 775: '#323F23' },
  lightGreen: { 675: '#336131', 725: '#2B5229', 775: '#234322' },
  green:      { 675: '#196335', 725: '#15542C', 775: '#114524' },
  emerald:    { 675: '#12623C', 725: '#105333', 775: '#0D442A' },
  cyan:       { 675: '#255A5F', 725: '#1F4C51', 775: '#1A3E42' },
  teal:       { 675: '#1F6558', 725: '#1A564B', 775: '#16463D' },
  deepPink:   { 675: '#7F2738', 725: '#6B2130', 775: '#581B27' },
  lightBlue:  { 675: '#155B91', 725: '#124D7B', 775: '#0E3F64' },
  gray:       { 675: '#3C636A', 725: '#335459', 775: '#2A4449' },
  blue:       { 675: '#1E3F88', 725: '#193673', 775: '#152C5E' },
  indigo:     { 675: '#362A7C', 725: '#2E2369', 775: '#261D56' },
  violet:     { 675: '#5A3274', 725: '#4D2A62', 775: '#3F2350' },
  purple:     { 675: '#5A3295', 725: '#4C2A7E', 775: '#3E2367' },
  pink:       { 675: '#6A2B60', 725: '#592551', 775: '#491E43' },
};

/** Colore di gioco di una nazione (oggetto di country.getAllCountries), o null. */
export function gameNationColor(nation) {
  const step = ACCENT_STEP[nation?.mapAccent] || ACCENT_STEP.normal;
  return GAME_PALETTE[nation?.scheme]?.[step] || null;
}
