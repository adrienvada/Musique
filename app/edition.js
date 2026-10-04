/**
 * CORRIGER UNE NOTE SANS ÉCRIRE D'ABC
 *
 * Adrien touche une note de la partition gravée ; abcjs dit où elle est
 * dans le texte ABC (startChar). Ce module lit le « jeton » à cet endroit
 * (une note, un accord ou un silence) et le réécrit : monter ou descendre
 * d'un degré, changer la durée, pointer, altérer, changer en silence,
 * dupliquer, supprimer. Le texte ABC reste la seule source de vérité : la
 * gravure, l'écoute et le MIDI le relisent.
 *
 * Durées comptées en croches, comme le lecteur (L:1/8).
 *
 * Sans import : le module sert tel quel à l'appli (dist/) et aux tests.
 */

const LETTRES = "CDEFGAB";
const NOMS = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };
const ALTERATIONS = { "^": "♯", "^^": "𝄪", _: "♭", __: "𝄫", "=": "♮" };
export const DUREES = [
  { croches: 0.5, nom: "double croche" },
  { croches: 1, nom: "croche" },
  { croches: 2, nom: "noire" },
  { croches: 4, nom: "blanche" },
  { croches: 8, nom: "ronde" },
];

/** Une durée en croches → le suffixe ABC ("", "2", "/", "3/2"…). */
export function dureeABC(croches) {
  for (const den of [1, 2, 4, 8, 16]) {
    const num = Math.round(croches * den);
    if (Math.abs(num / den - croches) > 1e-9) continue;
    if (den === 1) return num === 1 ? "" : String(num);
    return (num === 1 ? "" : String(num)) + "/" + (den === 2 ? "" : den);
  }
  return String(croches);
}

const NOTE = /(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)/y;
const DUREE = /(\d*)(\/*)(\d*)/y;

/** Lit une durée ABC ("", "2", "/", "3/2", "//") en croches. */
function lireDuree(texte, pos) {
  DUREE.lastIndex = pos;
  const m = DUREE.exec(texte);
  const num = m[1] ? Number(m[1]) : 1;
  let den = 1;
  if (m[2]) den = m[3] ? Number(m[3]) * 2 ** (m[2].length - 1) : 2 ** m[2].length;
  return { croches: num / den, fin: pos + m[0].length };
}

function lireNote(texte, pos) {
  NOTE.lastIndex = pos;
  const m = NOTE.exec(texte);
  if (!m) return null;
  const lettre = m[2].toUpperCase();
  let octave = m[2] === lettre ? 4 : 5;
  for (const c of m[3]) octave += c === "'" ? 1 : -1;
  return { alteration: m[1] || "", lettre, octave, fin: pos + m[0].length };
}

/**
 * Le jeton qui commence à `debut` : { type: note|accord|silence, notes,
 * croches, debut, fin }, ou null si ce n'est pas une note.
 */
export function lireJeton(abc, debut) {
  let pos = debut;
  const c = abc[pos];
  if (c === "z" || c === "x") {
    const d = lireDuree(abc, pos + 1);
    return { type: "silence", notes: [], croches: d.croches, debut, fin: d.fin, invisible: c === "x" };
  }
  if (c === "[" && /[\^_=A-Ga-g]/.test(abc[pos + 1] || "")) {
    const notes = [];
    pos++;
    while (abc[pos] !== "]") {
      const n = lireNote(abc, pos);
      if (!n) return null;
      notes.push(n);
      pos = n.fin;
    }
    const d = lireDuree(abc, pos + 1);
    return { type: "accord", notes, croches: d.croches, debut, fin: d.fin };
  }
  const n = lireNote(abc, pos);
  if (!n) return null;
  const d = lireDuree(abc, n.fin);
  return { type: "note", notes: [n], croches: d.croches, debut, fin: d.fin };
}

function ecrireNote({ alteration, lettre, octave }) {
  const base = octave >= 5 ? lettre.toLowerCase() + "'".repeat(octave - 5) : lettre + ",".repeat(4 - octave);
  return alteration + base;
}

function ecrireJeton(j) {
  const d = dureeABC(j.croches);
  if (j.type === "silence") return (j.invisible ? "x" : "z") + d;
  if (j.type === "accord") return "[" + j.notes.map(ecrireNote).join("") + "]" + d;
  return ecrireNote(j.notes[0]) + d;
}

/**
 * Chaque geste rend le nouvel ABC, la place de la note touchée (debut, fin) et
 * `modif` : le morceau d'ABC remplacé, [de, a[, par un texte de `longueur`
 * caractères. L'atelier s'en sert pour suivre les doutes (doutes.js) : une
 * correction ne doit pas décaler la note qu'un autre doute vise.
 */
function remplacer(abc, j, nouveau) {
  const texte = typeof nouveau === "string" ? nouveau : ecrireJeton(nouveau);
  return { abc: abc.slice(0, j.debut) + texte + abc.slice(j.fin), debut: j.debut, fin: j.debut + texte.length, modif: { de: j.debut, a: j.fin, longueur: texte.length } };
}

/** Monte (pas > 0) ou descend d'autant de degrés ; l'altération écrite tombe. */
export function deplacer(abc, j, pas) {
  if (j.type === "silence" || !pas) return null;
  const notes = j.notes.map((n) => {
    const rang = n.octave * 7 + LETTRES.indexOf(n.lettre) + pas;
    return { alteration: "", lettre: LETTRES[((rang % 7) + 7) % 7], octave: Math.floor(rang / 7) };
  });
  return remplacer(abc, j, { ...j, notes });
}

/** Nouvelle durée, en croches ; garde le point si la note en avait un. */
export function changerDuree(abc, j, croches) {
  const pointee = estPointee(j.croches);
  return remplacer(abc, j, { ...j, croches: pointee ? croches * 1.5 : croches });
}

export function estPointee(croches) {
  return DUREES.some((d) => Math.abs(d.croches * 1.5 - croches) < 1e-9);
}

/** Ajoute ou retire le point. */
export function basculerPoint(abc, j) {
  const pointee = estPointee(j.croches);
  return remplacer(abc, j, { ...j, croches: pointee ? j.croches / 1.5 : j.croches * 1.5 });
}

/** Dièse, bémol ou bécarre ; la même altération une seconde fois l'enlève. */
export function alterer(abc, j, alteration) {
  if (j.type === "silence") return null;
  const notes = j.notes.map((n) => ({ ...n, alteration: n.alteration === alteration ? "" : alteration }));
  return remplacer(abc, j, { ...j, notes });
}

/** Note ↔ silence, à durée égale (le silence redevient la dernière note connue, ou un do). */
export function basculerSilence(abc, j, noteParDefaut = { alteration: "", lettre: "C", octave: 5 }) {
  if (j.type === "silence") return remplacer(abc, j, { type: "note", notes: [noteParDefaut], croches: j.croches });
  return remplacer(abc, j, { type: "silence", notes: [], croches: j.croches });
}

/** Une copie juste après : pour la note oubliée d'une mesure. */
export function dupliquer(abc, j) {
  const texte = abc.slice(j.debut, j.fin);
  const suite = abc.slice(j.fin);
  // Collée à la suivante si elles étaient liées par une ligature, séparée sinon.
  const colle = /^[\^_=A-Ga-g[]/.test(suite);
  const ajout = colle ? texte : " " + texte;
  return { abc: abc.slice(0, j.fin) + ajout + suite, debut: j.fin + (colle ? 0 : 1), fin: j.fin + ajout.length, modif: { de: j.fin, a: j.fin, longueur: ajout.length } };
}

/** Supprime le jeton (et l'espace qui le suivait, pour ne pas en laisser deux). */
export function supprimer(abc, j) {
  let fin = j.fin;
  if (abc[j.debut - 1] === " " && abc[fin] === " ") fin++;
  return { abc: abc.slice(0, j.debut) + abc.slice(fin), debut: j.debut, fin: j.debut, modif: { de: j.debut, a: fin, longueur: 0 } };
}

/**
 * Une durée exacte, en croches, sans toucher au point : la réponse à
 * « il manque une croche » rallonge ou raccourcit la dernière note de ce qui
 * manque, qu'elle soit pointée ou non.
 */
export function fixerDuree(abc, j, croches) {
  if (!(croches > 0)) return null;
  return remplacer(abc, j, { ...j, croches });
}

/** Un silence de cette durée juste après le jeton (le plus souvent, la fin d'une mesure). */
export function ajouterSilence(abc, j, croches) {
  if (!(croches > 0)) return null;
  const ajout = " z" + dureeABC(croches);
  return { abc: abc.slice(0, j.fin) + ajout + abc.slice(j.fin), debut: j.fin + 1, fin: j.fin + ajout.length, modif: { de: j.fin, a: j.fin, longueur: ajout.length } };
}

/** « sol croche », « la♭ noire pointée », « accord do-mi-sol, blanche », « soupir ». */
export function decrire(j) {
  const base = DUREES.find((d) => Math.abs(d.croches - j.croches) < 1e-9 || Math.abs(d.croches * 1.5 - j.croches) < 1e-9);
  const duree = base ? base.nom + (estPointee(j.croches) ? " pointée" : "") : `${j.croches} croches`;
  if (j.type === "silence") {
    const noms = { 0.5: "quart de soupir", 1: "demi-soupir", 2: "soupir", 4: "demi-pause", 8: "pause" };
    return noms[j.croches] || `silence de ${duree}`;
  }
  const nom = (n) => NOMS[n.lettre] + (ALTERATIONS[n.alteration] || "") + n.octave;
  if (j.type === "accord") return `accord ${j.notes.map(nom).join("-")}, ${duree}`;
  return `${nom(j.notes[0])}, ${duree}`;
}

/** Hauteur MIDI de chaque note (pour la faire entendre), d'après l'armure `K:`. */
export function hauteursMidi(j, armure = {}) {
  const pas = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const decal = { "^": 1, "^^": 2, _: -1, __: -2, "=": 0 };
  return j.notes.map((n) => {
    const alt = n.alteration ? decal[n.alteration] : (armure[n.lettre] || 0);
    return 12 * (n.octave + 1) + pas[n.lettre] + alt;
  });
}

/**
 * La tonalité écrite (« Eb », « C ») en vigueur à la position `pos` : le K:
 * de l'en-tête, puis le dernier [K:] de la même voix ([V:1], [V:2]) avant `pos`.
 */
export function cleA(abc, pos) {
  const avant = abc.slice(0, pos);
  const voixDe = (ligne) => (/^\[V:\s*([^\]\s]+)/.exec(ligne) || [])[1] || null;
  const lignes = avant.split("\n");
  const voix = voixDe(lignes[lignes.length - 1]);
  let cle = "C";
  for (const l of lignes) {
    const h = /^K:\s*([A-G][b#]?(?:m|min)?)/.exec(l);
    if (h) { cle = h[1]; continue; }
    if (/^[A-Za-z]:|^%/.test(l)) continue;
    const v = voixDe(l);
    if (voix && v && v !== voix) continue;
    for (const m of l.matchAll(/\[K:\s*([A-G][b#]?(?:m|min)?)/g)) cle = m[1];
  }
  return cle;
}

/**
 * L'armure d'une ligne, ou des deux voix d'un système de piano : `ligne` est
 * le morceau d'ABC [debut, fin[ qui couvre ces lignes entières (la cible
 * d'un doute d'armure). Les lignes suivantes gardent leur armure : si elles
 * la tenaient de celle-ci, elles reçoivent la leur ([K:…]). La première ligne
 * de la pièce change le K: de l'en-tête plutôt que d'écrire deux armures de suite.
 * C'est le geste qui manquait pour « Non, sans armure » (refonte 10).
 */
export function changerArmure(abc, ligne, cle) {
  if (!ligne || !/^[A-G][b#]?(m|min)?$/.test(cle || "")) return null;
  const lignes = [];
  let p = 0;
  for (const texte of abc.split("\n")) { lignes.push({ debut: p, fin: p + texte.length, texte }); p += texte.length + 1; }
  const entete = (l) => /^[A-Za-z]:|^%/.test(l.texte);
  const corps = lignes.filter((l) => !entete(l));
  const dans = corps.filter((l) => l.debut >= ligne.debut && l.fin <= ligne.fin && l.fin > l.debut);
  if (!dans.length) return null;
  const n = dans.length;
  const apres = corps.filter((l) => l.debut > dans[n - 1].fin).slice(0, n);
  const PREFIXE = /^(\[V:[^\]]*\]\s*)?((?:\[[A-Za-z]:[^\]]*\])*)/;
  const champs = (l) => { const m = PREFIXE.exec(l.texte); return { voix: (m[1] || "").length, longueur: (m[2] || "").length, texte: m[2] || "" }; };
  const editions = [];
  // Les lignes suivantes gardent la tonalité qu'elles avaient.
  for (const l of apres) {
    const c = champs(l);
    if (/\[K:/.test(c.texte)) continue;
    const ancienne = cleA(abc, l.debut + c.voix);
    if (ancienne !== cle) editions.push({ de: l.debut + c.voix, a: l.debut + c.voix, texte: `[K:${ancienne}]` });
  }
  const premiere = corps[0] === dans[0];
  const k = lignes.find((l) => /^K:/.test(l.texte));
  for (const l of dans) {
    const c = champs(l);
    const sansK = c.texte.replace(/\[K:[^\]]*\]/g, "");
    let nouveaux = sansK;
    if (premiere && k) {
      // La première ligne : on change l'en-tête, la ligne n'a pas besoin de [K:].
    } else if (cleA(abc, l.debut + c.voix) !== cle) nouveaux = `[K:${cle}]` + sansK; // la tonalité qu'elle reçoit de sa voix
    if (nouveaux !== c.texte) editions.push({ de: l.debut + c.voix, a: l.debut + c.voix + c.longueur, texte: nouveaux });
  }
  if (premiere && k) {
    const m = /^K:\s*([A-G][b#]?(?:m|min)?)?/.exec(k.texte);
    if ((m[1] || "C") !== cle) editions.push({ de: k.debut, a: k.debut + m[0].length, texte: `K:${cle}` });
  }
  if (!editions.length) return { abc, debut: ligne.debut, fin: ligne.fin, modif: [] };
  // De la fin vers le début : chaque modification se lit dans le texte d'avant elle, sans décalage.
  editions.sort((x, y) => y.de - x.de);
  let texte = abc;
  const modif = [];
  for (const e of editions) {
    texte = texte.slice(0, e.de) + e.texte + texte.slice(e.a);
    modif.push({ de: e.de, a: e.a, longueur: e.texte.length });
  }
  const delta = editions.filter((e) => e.de < ligne.fin).reduce((t, e) => t + e.texte.length - (e.a - e.de), 0);
  const avant = editions.filter((e) => e.a <= ligne.debut).reduce((t, e) => t + e.texte.length - (e.a - e.de), 0);
  return { abc: texte, debut: ligne.debut + avant, fin: ligne.fin + delta, modif };
}

/** Altérations de l'armure en vigueur à la position `pos` (K: ou [K:] le plus proche avant). */
export function armureA(abc, pos) {
  const avant = abc.slice(0, pos);
  const ks = [...avant.matchAll(/(?:^K:|\[K:)\s*([A-G][b#]?)(m|min)?/gm)];
  const k = ks.length ? ks[ks.length - 1] : null;
  const tonalites = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  let n = k ? tonalites[k[1]] ?? 0 : 0;
  if (k && k[2]) n -= 3; // mineur : trois altérations de moins que le majeur du même nom
  const dieses = "FCGDAEB", bemols = "BEADGCF";
  const armure = {};
  for (let i = 0; i < Math.abs(n); i++) armure[(n > 0 ? dieses : bemols)[i]] = n > 0 ? 1 : -1;
  return armure;
}
