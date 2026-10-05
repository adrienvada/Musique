/**
 * ÉCOUTER UNE PAGE LUE
 *
 * Une page lue sur la tablette vit en ABC. Avant l'audit du 04/10 (M5),
 * abcjs la jouait au fil de ses minuteries (TimingCallbacks) : chaque note
 * partait quand la minuterie tombait, au rythme des images de l'écran, et
 * des croches de 250 ms en faisaient de 120 à 390 dès que l'écran se
 * redessinait. Ses notes passent maintenant par le transport (transport.js),
 * programmées d'avance sur l'horloge du son, comme une idée ;
 * TimingCallbacks ne sert plus qu'à savoir quoi surligner, et quand : la
 * position vient du transport, image par image.
 *
 * Les notes viennent d'abcjs (setUpAudio : reprises dépliées), avec leur
 * force : les accents et les temps forts de la page s'entendent comme avant
 * (sequenceDepuisAbc, qui fait une idée d'une page, les laisse de côté).
 * La transposition s'ajoute à chaque hauteur ; une main coupée (V:1, V:2)
 * ne joue pas, mais se surligne encore.
 *
 * Le tempo est en noires par minute, comme le curseur de l'écran. abcjs, lui,
 * compte en temps (la noire pointée en 12/8) : en 6/8 ou 12/8, l'écoute
 * d'avant allait une fois et demie trop vite, notes chevauchées.
 *
 * Sans page : les calculs (plagesVoix, notesDePage, evenementA) se testent
 * sous Node avec abcjs (tests/ecoute-page.test.mjs).
 */
import { pasParMesure, pasParTemps } from "./sequence.js";

/** Les plages de caractères de chaque voix dans l'ABC (« [V:1] … », « [V:2] … »), pour couper une main. */
export function plagesVoix(abc) {
  const plages = [];
  let pos = 0;
  for (const ligne of abc.split("\n")) {
    const m = ligne.match(/^\[V:(\d+)\]/);
    if (m) plages.push({ voix: Number(m[1]), de: pos, a: pos + ligne.length });
    pos += ligne.length + 1;
  }
  return plages;
}

/** La mesure d'une partition abcjs, [num, den] ; 4/4 si elle est libre ou étrange. */
function mesureDe(objet) {
  try {
    const f = objet.getMeterFraction();
    if (f && f.num > 0 && [1, 2, 4, 8, 16].includes(f.den)) return [f.num, f.den];
  } catch { /* mesure libre */ }
  return [4, 4];
}

/**
 * Les notes d'une page, prêtes pour le transport.
 * @param objet  la partition gravée par abcjs (renderAbc)
 * @param abc    le texte gravé (celui dont abcjs compte les positions)
 * @param o      { tempo (noires par minute), transposition (demi-tons), voixMuettes (Set de numéros de voix) }
 * @returns { source() → { tempo, mesure, temps, fin, notesA(pas) }, fin (pas), hauteurs }
 */
export function notesDePage(objet, abc, { tempo, transposition = 0, voixMuettes = new Set() }) {
  const audio = objet.setUpAudio({ chordsOff: true });
  const plages = plagesVoix(abc);
  const voixDe = (c, i) => (plages.length ? (plages.find((p) => c >= p.de && c <= p.a) || { voix: 1 }).voix : i + 1);
  const parPas = new Map();
  let fin = 0;
  audio.tracks.forEach((piste, i) => {
    for (const ev of piste) {
      if (ev.cmd !== "note" || !(ev.pitch >= 0)) continue;
      if (voixMuettes.has(voixDe(ev.startChar, i))) continue;
      const d = Math.round(ev.start * 16), l = Math.max(1, Math.round(ev.duration * 16));
      if (!parPas.has(d)) parPas.set(d, []);
      parPas.get(d).push({ h: ev.pitch + transposition, l, v: ev.volume || 90 });
      fin = Math.max(fin, d + l);
    }
  });
  const mesure = mesureDe(objet);
  const seq = { mesure };
  return {
    fin,
    source: () => ({ tempo, mesure: pasParMesure(seq), temps: pasParTemps(seq), fin, notesA: (p) => parPas.get(p) || [] }),
  };
}

/** L'indice du dernier événement commencé à `ms` (ou −1 avant le premier). Les événements sont dans l'ordre du temps. */
export function evenementA(evenements, ms) {
  let bas = 0, haut = evenements.length - 1, trouve = -1;
  while (bas <= haut) {
    const m = (bas + haut) >> 1;
    if (evenements[m].milliseconds <= ms + 1) { trouve = m; bas = m + 1; } else haut = m - 1;
  }
  return trouve;
}

/** Le tempo à donner à abcjs, qui compte en temps de la mesure (`temps` en rondes : 0,375 pour la noire pointée), d'après nos noires par minute. */
export const qpmAbcjs = (tempo, temps = 0.25) => (tempo * 0.25) / temps;

/**
 * Le surlignage d'une page qui joue : ce que TimingCallbacks sait des
 * notes gravées (quels éléments, à quelle milliseconde), lu à la position du
 * transport.
 * @param lib    window.ABCJS
 * @returns { surligner(pas), eteindre() }
 */
export function surlignage(lib, objet, tempo) {
  let temps = 0.25;
  try { temps = objet.getBeatLength() || 0.25; } catch { /* une noire */ }
  let evenements = [];
  try {
    const tc = new lib.TimingCallbacks(objet, { qpm: qpmAbcjs(tempo, temps) });
    evenements = (tc.noteTimings || []).filter((ev) => ev.type === "event");
  } catch { /* rien à surligner */ }
  const msParPas = 60000 / (tempo * 4);
  let courant = -1, allumes = [];
  const eteindre = () => { for (const n of allumes) n.classList.remove("joue"); allumes = []; courant = -1; };
  return {
    surligner(pas) {
      const i = pas === null ? -1 : evenementA(evenements, pas * msParPas);
      if (i === courant) return;
      eteindre();
      courant = i;
      if (i < 0) return;
      allumes = (evenements[i].elements || []).flat().filter((n) => n && n.classList);
      for (const n of allumes) n.classList.add("joue");
    },
    eteindre,
  };
}
