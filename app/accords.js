/**
 * LIRE UN NOM D'ACCORD
 *
 * « F#m7/E », « Bb », « G7sus4 » : la racine, la sorte d'accord, la basse,
 * et comment s'écrit chaque note (fa♯ et non sol♭ dans un ré 7).
 *
 * POURQUOI UN MODULE À PART. La partition (sequence.js) en a besoin pour
 * épeler l'accompagnement et les notes de la mélodie qui appartiennent à
 * l'accord ; or harmonie.js importe déjà sequence.js. Rangée ici, la lecture
 * des noms sert aux deux sans qu'ils s'importent l'un l'autre.
 *
 * Sans dépendance (appli et tests).
 */
export const RACINES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const LETTRES = "CDEFGAB";
const mod12 = (x) => ((x % 12) + 12) % 12;

/** Les sortes d'accords qu'on sait lire et jouer : suffixe → intervalles (demi-tons). */
export const QUALITES = {
  "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  dim: [0, 3, 6], dim7: [0, 3, 6, 9], m7b5: [0, 3, 6, 10], aug: [0, 4, 8],
  sus2: [0, 2, 7], sus4: [0, 5, 7], "7sus4": [0, 5, 7, 10], 6: [0, 4, 7, 9], m6: [0, 3, 7, 9],
  9: [0, 4, 7, 10, 14], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14], m9: [0, 3, 7, 10, 14],
};
export const FORME = /^([A-G])([#b]?)(maj7|m7b5|dim7|7sus4|madd9|add9|sus2|sus4|dim|aug|maj|m9|m7|m6|m|7|6|9)?(?:\/([A-G])([#b]?))?$/;

/** « F#m7/E » → { racine: 6, qualite: "m7", intervalles, basse: 4 } ; null si illisible. */
export function lireAccord(nom) {
  const m = FORME.exec((nom || "").trim());
  if (!m) return null;
  const alt = (a) => (a === "#" ? 1 : a === "b" ? -1 : 0);
  const qualite = m[3] === "maj" ? "" : m[3] || "";
  return {
    racine: mod12(RACINES[m[1]] + alt(m[2])),
    qualite,
    intervalles: QUALITES[qualite],
    basse: m[4] ? mod12(RACINES[m[4]] + alt(m[5])) : null,
  };
}

// Combien de lettres au-dessus de la racine chaque intervalle s'écrit (tierce
// = deux lettres plus haut, quinte = quatre…) : c'est ce qui donne mi♭ et non ré♯.
const LETTRES_DE = { 0: 0, 2: 1, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 5, 10: 6, 11: 6, 14: 1 };

/**
 * Les notes d'un accord, épelées : [{ pc, lettre, alt }] (alt : −2 à +2),
 * la basse d'abord (la note d'après « / », si elle n'est pas dans l'accord),
 * puis l'accord du grave à l'aigu. [] si le nom ne se lit pas.
 * « D7 » → ré, fa♯, la, do ; « Bdim7 » → si, ré, fa, la♭.
 */
export function epellationsDeLAccord(nom) {
  const m = FORME.exec((nom || "").trim());
  const a = lireAccord(nom);
  if (!m || !a) return [];
  const iRacine = LETTRES.indexOf(m[1]);
  const ecrire = (lettre, pc) => ({ pc: mod12(pc), lettre, alt: ((mod12(pc - RACINES[lettre]) + 6) % 12) - 6 });
  const notes = a.intervalles.map((i) => {
    // Dans l'accord diminué de septième, le 9 est une septième diminuée, pas une sixte.
    const pas = a.qualite === "dim7" && i === 9 ? 6 : LETTRES_DE[i];
    return ecrire(LETTRES[(iRacine + pas) % 7], a.racine + i);
  });
  if (a.basse === null) return notes;
  return [ecrire(m[4], a.basse), ...notes.filter((n) => n.pc !== a.basse)];
}
