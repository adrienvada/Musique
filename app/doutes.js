/**
 * LES DOUTES, UN PAR UN : DE LA LECTURE À UNE QUESTION FERMÉE
 *
 * Quand le lecteur n'est pas sûr (un trait qui pourrait être un crochet, une
 * mesure à 11 croches au lieu de 12…), il le dit dans `lecteur/`. Ce module
 * en fait ce qu'Adrien voit dans « Corriger » : une question à deux réponses
 * (« Croche ou noire ? ») dont la réponse applique le vrai geste d'edition.js
 * sur la bonne note de l'ABC. Adrien ne lit pas l'ABC : il touche une réponse.
 *
 * Deux difficultés, deux réponses :
 *  - retrouver la note. Le lecteur écrit, pour chaque doute, où tombe sa note
 *    ou sa mesure dans l'ABC qu'il a produit (`cible`). Chaque correction
 *    décale le texte qui la suit : `vise` suit ces décalages (`suivre`), et
 *    se perd (null) si la note elle-même a disparu. Sans `vise` (ancienne
 *    partition, note supprimée), on ne propose pas de réponse fermée : Adrien
 *    corrige lui-même, ou laisse tel quel ;
 *  - ne pas croire le passé. Les réponses se calculent sur l'ABC d'aujourd'hui
 *    (la mesure compte-t-elle encore 11 croches ?), jamais sur ce que le lecteur
 *    avait vu.
 *
 * Sans import hors edition.js : le module sert tel quel à l'appli et aux tests.
 */
import * as ed from "./edition.js";
import { accorde, pluriel } from "./ui.js";

/**
 * Les autres places qu'un doute peut viser, en plus de sa note ou de sa
 * mesure : la ligne (ou les lignes) que réécrit une réponse d'armure ou de
 * chiffrage, la note à hampe d'un accord à refaire, et, autour d'un signe
 * inconnu, la note qui le suit (s'il est une altération) et celle qui le
 * précède (s'il est un silence). [cible, visée, contenant].
 */
/** @type {[string, string, boolean][]} */
const SECONDAIRES = [["cibleLigne", "viseLigne", true], ["cibleAccord", "viseAccord", false],
  ["cibleSuivante", "viseSuivante", false], ["ciblePrecedente", "visePrecedente", false]];

/** Les doutes d'une lecture neuve : aucun n'est levé, et chacun vise sa cible. */
export function preparerDoutes(doutes) {
  return doutes.map((d) => {
    const p = { ...d, leve: false, vise: d.cible ? { ...d.cible } : null };
    for (const [c, v] of SECONDAIRES) if (d[c]) p[v] = { ...d[c] };
    for (const prop of p.propositions || []) for (const ch of prop.changements || []) ch.vise = ch.cible ? { ...ch.cible } : null;
    return p;
  });
}

/**
 * Donne à chaque doute sa visée au premier regard de l'atelier : la cible de la
 * lecture, si l'ABC n'a pas bougé depuis. Sinon (corrigé avant, ou lu avant que
 * les doutes aient une cible), il n'a pas de visée : question sans réponse fermée.
 * Les autres visées (ligne, accord, propositions) suivent la même règle.
 */
export function initialiserVise(doutes, abc, abcLu) {
  for (const d of doutes) {
    if (d.vise === undefined) d.vise = d.cible && abc === abcLu ? { ...d.cible } : null;
    for (const [c, v] of SECONDAIRES) if (d[c] && d[v] === undefined) d[v] = abc === abcLu ? { ...d[c] } : null;
    for (const prop of d.propositions || []) for (const ch of prop.changements || []) if (ch.vise === undefined) ch.vise = ch.cible && abc === abcLu ? { ...ch.cible } : null;
  }
}

/** Le genre d'un doute, aussi pour les partitions lues avant qu'il soit écrit (on le déduit du message). */
export function typeDe(d) {
  if (d.type) return d.type;
  const m = d.message || "";
  if (/petit trait au bout de la hampe/i.test(m)) return "crochet";
  if (/au lieu de/.test(m)) return "mesure";
  if (/tête pleine sans hampe/i.test(m)) return "sans-hampe";
  if (/signe non reconnu/i.test(m)) return "signe";
  if (/pas d'armure/i.test(m)) return "armure";
  if (/chiffrage/i.test(m)) return "chiffrage";
  return "autre";
}

/**
 * Une partition lue avant que les doutes sachent où est leur note : si rien n'a
 * encore été corrigé, on relit ses traits (c'est déterministe) et on reprend
 * ce que la lecture neuve en dit. `lus` : les doutes d'une lecture neuve.
 */
export function completerDoutes(doutes, lus) {
  const restants = [...lus];
  return doutes.map((d) => {
    if (d.type) return d;
    const k = restants.findIndex((n) => n.page === d.page && n.portee === d.portee && n.message === d.message);
    if (k < 0) return d;
    const [n] = restants.splice(k, 1);
    return { ...d, ...n, leve: d.leve, vise: n.cible ? { ...n.cible } : null };
  });
}

// ------------------------------------------------------------------------
// Suivre les corrections
// ------------------------------------------------------------------------

/**
 * Où est un morceau d'ABC [debut, fin[ quand [de, a[ est remplacé par `longueur`
 * caractères ? `contenant` : une mesure, qui grandit quand on écrit à ses
 * bords ; sinon un jeton (une note), qui ne s'étend pas à ce qu'on insère à
 * côté. Null si la modification le coupe en deux ou l'avale.
 */
export function deplacerVise(vise, { de, a, longueur }, contenant = false) {
  if (!vise) return null;
  const { debut: s, fin: e } = vise;
  const delta = longueur - (a - de);
  if (!contenant && de === a && de <= s) return { debut: s + delta, fin: e + delta };
  if (!contenant && de === a && de >= e) return { debut: s, fin: e };
  if (de >= s && a <= e) return { debut: s, fin: e + delta }; // dedans, ou la note elle-même remplacée
  if (a <= s) return { debut: s + delta, fin: e + delta };
  if (de >= e) return { debut: s, fin: e };
  return null;
}

/**
 * Décale la visée de chaque doute après une modification de l'ABC (change les
 * doutes sur place). `modif` peut être une liste : un geste qui touche
 * plusieurs endroits (une armure et une note) la rend dans l'ordre où il les a
 * faites, chacune dans le texte laissé par la précédente.
 */
export function suivre(doutes, modif) {
  if (!modif) return;
  for (const m of Array.isArray(modif) ? modif : [modif]) {
    for (const d of doutes) {
      if (d.vise) d.vise = deplacerVise(d.vise, m, typeDe(d) === "mesure");
      for (const [, v, contenant] of SECONDAIRES) if (d[v]) d[v] = deplacerVise(d[v], m, contenant);
      for (const p of d.propositions || []) for (const c of p.changements || []) if (c.vise) c.vise = deplacerVise(c.vise, m);
    }
  }
}

/** Une visée après plusieurs modifications. */
function apres(vise, modifs, contenant = false) {
  let v = vise;
  for (const m of modifs) v = deplacerVise(v, m, contenant);
  return v;
}

/**
 * Plusieurs gestes de suite, comme un seul : chacun reçoit le texte laissé par
 * le précédent et la liste des modifications déjà faites (pour retrouver sa
 * cible). Le résultat se lit comme celui d'un geste d'edition.js.
 */
function enchainer(abc, gestes) {
  let texte = abc, premier = null, depuis = 0;
  const modifs = [];
  for (const g of gestes) {
    const r = g(texte, modifs);
    if (!r) return null;
    texte = r.abc;
    modifs.push(...(Array.isArray(r.modif) ? r.modif : r.modif ? [r.modif] : []));
    if (!premier) { premier = { debut: r.debut, fin: r.fin }; depuis = modifs.length; }
  }
  // La place du premier geste (pour l'éclat de l'atelier), suivie à travers les suivants.
  const place = premier ? apres(premier, modifs.slice(depuis)) || premier : { debut: 0, fin: 0 };
  return { abc: texte, debut: place.debut, fin: place.fin, modif: modifs };
}

/** La modification entre deux textes, quand on ne la connaît pas (saisie dans le mode avancé). */
export function modifEntre(ancien, nouveau) {
  let p = 0;
  while (p < ancien.length && p < nouveau.length && ancien[p] === nouveau[p]) p++;
  let s = 0;
  while (s < ancien.length - p && s < nouveau.length - p && ancien[ancien.length - 1 - s] === nouveau[nouveau.length - 1 - s]) s++;
  return { de: p, a: ancien.length - s, longueur: nouveau.length - p - s };
}

// ------------------------------------------------------------------------
// Lire la cible dans l'ABC d'aujourd'hui
// ------------------------------------------------------------------------

/** La note visée par un doute, ou null si elle n'est plus là telle quelle. */
export function noteVisee(d, abc) {
  return jetonVise(d.vise, abc);
}

/** Le jeton qui occupe exactement la place `vise`, ou null. */
function jetonVise(vise, abc) {
  if (!vise) return null;
  const j = ed.lireJeton(abc, vise.debut);
  return j && j.fin === vise.fin ? j : null;
}

/**
 * Les notes et silences d'une mesure visée, dans l'ordre, ou null si le texte
 * est autre chose (décoration…). Une liaison de durée (« - ») ne compte pas ;
 * dans un triolet (« (3 »), chaque note compte pour les deux tiers de sa
 * durée écrite : c'est sa `duree` (sa durée écrite reste `croches`).
 */
export function jetonsDeLaMesure(d, abc) {
  return d.vise ? jetonsEntre(abc, d.vise.debut, d.vise.fin) : null;
}

/** Les jetons de [debut, fin[ (voir jetonsDeLaMesure), ou null. */
export function jetonsEntre(abc, debut, fin) {
  const jetons = [];
  let pos = debut, triolet = 0;
  while (pos < fin) {
    if (abc[pos] === " " || abc[pos] === "-") { pos++; continue; }
    if (abc.startsWith("(3", pos)) { triolet = 3; pos += 2; continue; }
    const j = ed.lireJeton(abc, pos);
    if (!j || j.fin <= pos || j.fin > fin) return null;
    jetons.push({ ...j, duree: triolet ? (j.croches * 2) / 3 : j.croches });
    if (triolet) triolet--;
    pos = j.fin;
  }
  return jetons.length ? jetons : null;
}

/** La durée d'une liste de jetons, triolets compris. */
const somme = (jetons) => jetons.reduce((t, j) => t + (j.duree ?? j.croches), 0);

/** Où regarder dans la partition lue : { debut, fin, genre } ou null. */
export function cibleVisible(d, abc) {
  const t = typeDe(d);
  if (t === "mesure" || t === "triolet") return jetonsDeLaMesure(d, abc) ? { ...d.vise, genre: "mesure" } : null;
  if (["crochet", "sans-hampe", "tete-manquante", "ligature", "hauteur", "tete", "point"].includes(t) || (t === "armure" && d.variante === "premiere-note")) return noteVisee(d, abc) ? { ...d.vise, genre: "note" } : null;
  return null;
}

// ------------------------------------------------------------------------
// Recalculer les doutes de mesure sur l'ABC d'aujourd'hui (L13)
// ------------------------------------------------------------------------

/** La durée d'une mesure (en croches, L:1/8) d'après un chiffrage écrit, ou null. */
function crochesDe(m) {
  if (m === "C" || m === "C|") return 8;
  const x = /^(\d+)\/(\d+)$/.exec(m || "");
  return x ? (Number(x[1]) * 8) / Number(x[2]) : null;
}

/**
 * Les mesures de l'ABC d'aujourd'hui, voix par voix : où elles sont, ce
 * qu'elles durent (triolets compris), si une barre les ferme, et ce qu'elles
 * devraient durer d'après le chiffrage en vigueur. Une mesure qui contient
 * autre chose que des notes, des silences, des liaisons et des triolets est
 * « illisible » : on n'en dit rien (le mode avancé permet tout).
 */
export function mesuresDeLAbc(abc) {
  const sortie = [];
  let p = 0, systeme = 0, voixAvant = null, metreEnTete = "none";
  const metres = new Map(); // voix → chiffrage en vigueur
  const BARRE = /^(:*\|+\]?:*|::|:+)/;
  for (const texte of abc.split("\n")) {
    const debutLigne = p;
    p += texte.length + 1;
    const h = /^M:\s*(\S+)/.exec(texte);
    if (h) { metreEnTete = h[1]; continue; }
    if (/^[A-Za-z]:|^%/.test(texte) || !texte.trim()) continue;
    const v = /^\[V:\s*([^\]\s]+)\]\s*/.exec(texte);
    const voix = v ? v[1] : "1";
    // Un nouveau système commence à chaque ligne de la première voix.
    if (!v || voixAvant === null || voix <= voixAvant) systeme++;
    voixAvant = voix;
    let pos = v ? v[0].length : 0, rang = 0, triolet = 0, section = false;
    let courante = null;
    const fermer = (fermee, reprise) => {
      if (courante && courante.jetons) sortie.push({ ...courante, fermee, reprise });
      courante = null;
    };
    while (pos < texte.length) {
      const c = texte[pos];
      if (c === " " || c === "-") { pos++; continue; }
      const champ = /^\[([A-Za-z]):([^\]]*)\]/.exec(texte.slice(pos));
      if (champ) {
        if (champ[1] === "M") { metres.set(voix, champ[2].trim()); if (!courante) section = true; }
        pos += champ[0].length;
        continue;
      }
      const barre = BARRE.exec(texte.slice(pos));
      if (barre) { fermer(true, /^:/.test(barre[0])); pos += barre[0].length; continue; }
      if (texte.startsWith("(3", pos)) { triolet = 3; pos += 2; continue; }
      if (!courante) {
        rang++;
        const m = metres.get(voix) || metreEnTete;
        courante = { voix, systeme, rang, debut: debutLigne + pos, fin: debutLigne + pos, croches: 0, jetons: 0, lisible: true, metre: m, attendu: crochesDe(m), invisible: true, section };
        section = false;
      }
      const j = ed.lireJeton(abc, debutLigne + pos);
      if (!j || j.fin <= debutLigne + pos) { courante.lisible = false; pos++; continue; }
      courante.croches += triolet ? (j.croches * 2) / 3 : j.croches;
      if (triolet) triolet--;
      courante.jetons++;
      if (!j.invisible) courante.invisible = false;
      courante.fin = j.fin;
      pos = j.fin - debutLigne;
    }
    fermer(false, false);
  }
  return sortie;
}

/**
 * Les doutes de mesure, recalculés après un geste (L13). Après la bonne
 * réponse à un doute, une mesure pouvait tomber à 11 croches sans que rien ne
 * le dise : la lecture ne pose ses doutes qu'une fois. Cette fonction relit les
 * mesures de l'ABC d'aujourd'hui avec les règles du lecteur (levée en tête de
 * pièce ou de section, dernière mesure qui complète la levée ou reste
 * inachevée) et ajoute un doute pour chaque mesure fausse qu'aucun doute de
 * mesure ne vise encore. Il propose les autres lectures des doutes de marge
 * encore ouverts dans la mesure (L15). Pure : les doutes reçus ne changent
 * pas ; la liste rendue les reprend, suivis des nouveaux.
 */
export function recalculerDoutes(doutes, abc) {
  const mesures = mesuresDeLAbc(abc).filter((m) => !m.invisible);
  const nouveaux = [];
  const voix = [...new Set(mesures.map((m) => m.voix))];
  const piano = voix.length > 1;
  const numero = doutes.reduce((n, d) => Math.max(n, Number((/^r(\d+)$/.exec(d.id || "") || [])[1] || 0)), 0);
  for (const v of voix) {
    const ms = mesures.filter((m) => m.voix === v);
    let levee = 0;
    ms.forEach((m, k) => {
      if (!m.lisible || !m.attendu) return;
      // Une mesure courte en tête de pièce ou de section est la levée. Le lecteur
      // demandait aussi qu'une mesure complète la suive ; ici, c'est souvent
      // cette mesure-là que le geste vient de changer : c'est elle qui a le doute.
      const enTete = k === 0 || m.section;
      if (enTete) {
        if (m.croches < m.attendu - 1e-6 && ms.length > 1) { levee = m.croches; m.levee = true; return; }
        levee = 0;
      }
      const derniere = k === ms.length - 1;
      if ((m.reprise || derniere) && levee && Math.abs(m.croches + levee - m.attendu) < 1e-6) return;
      if (derniere && !m.fermee && m.croches < m.attendu) return;
      if (Math.abs(m.croches - m.attendu) < 1e-6) return;
      if (doutes.some((d) => typeDe(d) === "mesure" && d.vise && d.vise.debut < m.fin && d.vise.fin > m.debut)) return;
      // La place sur la page : celle d'un doute dont la note est dans cette mesure (souvent celui qu'on vient de régler).
      const voisin = doutes.find((d) => d.vise && d.boite && d.vise.debut >= m.debut && d.vise.fin <= m.fin);
      const ligne = mesures.filter((x) => x.systeme === m.systeme && x.voix === v);
      const rang = ligne.filter((x) => !x.levee).indexOf(m) + 1;
      const main = piano ? (v === voix[0] ? "droite" : "gauche") : null;
      const d = {
        id: `r${numero + nouveaux.length + 1}`, type: "mesure", origine: "recalcul",
        page: voisin ? voisin.page : 1, portee: voisin ? voisin.portee : 0, boite: voisin ? voisin.boite : null,
        ligne: m.systeme, ...(main ? { main } : {}), rang, trouve: m.croches, attendu: m.attendu,
        message: `Ligne ${m.systeme}${main ? `, main ${main}` : ""}, ${rang}ᵉ mesure : ${nb(m.croches)} ${accorde(m.croches, "croche")} au lieu de ${nb(m.attendu)} ${accorde(m.attendu, "croche")}.`,
        cible: null, vise: { debut: m.debut, fin: m.fin }, leve: false,
      };
      const propositions = proposerPourMesure(doutes, abc, m);
      nouveaux.push(propositions.length ? { ...d, propositions } : d);
    });
  }
  return [...doutes, ...nouveaux];
}

/** Trancher par la mesure (L15), sur l'ABC d'aujourd'hui : les doutes de marge ouverts dans la mesure `m`. */
function proposerPourMesure(doutes, abc, m) {
  const manque = m.attendu - m.croches;
  const jetons = jetonsEntre(abc, m.debut, m.fin) || [];
  const notes = jetons.filter((j) => j.type !== "silence");
  const rang = (vise) => { const k = notes.findIndex((j) => j.debut === vise.debut) + 1; return k === 1 ? "1ʳᵉ" : `${k}ᵉ`; };
  const candidats = [];
  for (const d of doutes) {
    if (d.leve || !d.alternative || !d.vise || d.vise.debut < m.debut || d.vise.fin > m.fin) continue;
    const j = jetonVise(d.vise, abc);
    if (!j) continue;
    const a = d.alternative;
    if (a.croches !== undefined) candidats.push({ d, delta: a.croches - j.croches, changement: { vise: { ...d.vise }, croches: a.croches, doute: d.id }, texte: `${rang(d.vise)} note en ${nomDuree(a.croches)}` });
    else if (a.supprimer) candidats.push({ d, delta: -j.croches, changement: { vise: { ...d.vise }, supprimer: true, doute: d.id }, texte: `sans la ${rang(d.vise)} note` });
  }
  const propositions = [];
  const ajouter = (choix) => {
    const texte = choix.map((c) => c.texte).join(", ");
    propositions.push({ texte: majuscule(texte), changements: choix.map((c) => c.changement), regle: choix.map((c) => c.d.id).filter(Boolean) });
  };
  for (const a of candidats) if (Math.abs(a.delta - manque) < 1e-6) ajouter([a]);
  for (let i = 0; i < candidats.length; i++) {
    for (let k = i + 1; k < candidats.length; k++) {
      if (candidats[i].d.vise.debut !== candidats[k].d.vise.debut && Math.abs(candidats[i].delta + candidats[k].delta - manque) < 1e-6) ajouter([candidats[i], candidats[k]]);
    }
  }
  return propositions.slice(0, 3);
}

// ------------------------------------------------------------------------
// Poser la question
// ------------------------------------------------------------------------

const NOMS_CLES = { C: "do", D: "ré", E: "mi", F: "fa", G: "sol", A: "la", B: "si" };

/** « Eb » → « mi♭ majeur ». */
export function nomCle(cle) {
  if (!cle || !NOMS_CLES[cle[0]]) return "la même";
  return `${NOMS_CLES[cle[0]]}${cle[1] === "b" ? "♭" : cle[1] === "#" ? "♯" : ""} majeur`;
}

const nb = (n) => (Number.isInteger(n) ? String(n) : n.toLocaleString("fr-FR", { maximumFractionDigits: 2 }));
/** « une croche », « 2 croches », « 1,5 croche ». */
export function enCroches(n) {
  if (Math.abs(n - 1) < 1e-9) return "une croche";
  if (Math.abs(n - 0.5) < 1e-9) return "une double croche";
  return `${nb(n)} ${accorde(n, "croche")}`;
}

const NOMS_DUREES = { 0.5: "double croche", 0.75: "double croche pointée", 1: "croche", 1.5: "croche pointée", 2: "noire", 3: "noire pointée", 4: "blanche", 6: "blanche pointée", 8: "ronde", 12: "ronde pointée" };
/** « noire », « croche pointée » : le nom d'une durée en croches. */
export const nomDuree = (c) => NOMS_DUREES[c] || `${nb(c)} croches`;
const majuscule = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// Ce qui peut précéder une note dans un groupe lié : la fin d'une autre note.
const finDeNote = /[A-Ga-g,'\d/\]]/;

/** Sépare une note de la précédente quand elles étaient collées (liées) : une espace devant. */
function delier(abc, vise) {
  if (!vise || vise.debut === 0 || !finDeNote.test(abc[vise.debut - 1])) return { abc, debut: vise.debut, fin: vise.fin, modif: [] };
  return { abc: abc.slice(0, vise.debut) + " " + abc.slice(vise.debut), debut: vise.debut + 1, fin: vise.fin + 1, modif: { de: vise.debut, a: vise.debut, longueur: 1 } };
}

/** Colle une note à la précédente (les relie d'une ligature) en retirant l'espace entre elles. */
function lier(abc, vise) {
  if (!vise || vise.debut < 2 || abc[vise.debut - 1] !== " " || !finDeNote.test(abc[vise.debut - 2])) return { abc, debut: vise.debut, fin: vise.fin, modif: [] };
  return { abc: abc.slice(0, vise.debut - 1) + abc.slice(vise.debut), debut: vise.debut - 1, fin: vise.fin - 1, modif: { de: vise.debut - 1, a: vise.debut, longueur: 0 } };
}

/**
 * « Croche liée ou noire ? » (L2) : une ligature qui s'arrête au ras de la
 * hampe. La réponse change la durée et coupe (ou fait) la ligature dans l'ABC.
 */
function poserLigature(d, abc, base) {
  const j = noteVisee(d, abc);
  const alt = d.alternative && d.alternative.croches;
  const cur = j ? j.croches : null;
  const liee = d.lue === "liee";
  const titre = cur && alt ? (liee ? `${majuscule(nomDuree(cur))} liée ou ${nomDuree(alt)} ?` : `${majuscule(nomDuree(cur))} ou ${nomDuree(alt)} liée ?`) : "Ligature ou pas ?";
  const changer = (a) => {
    const jj = noteVisee(d, a);
    if (!jj) return null;
    return enchainer(a, [(t) => ed.fixerDuree(t, jj, alt), (t, modifs) => (liee ? delier : lier)(t, apres(d.vise, modifs))]);
  };
  return {
    ...base, manuel: true, titre,
    detail: liee
      ? "La ligature s'arrête juste avant la queue de cette note : je l'ai liée aux autres. Si elle ne l'atteint pas, la note est seule."
      : "La ligature s'arrête juste avant la queue de cette note : je l'ai laissée seule. Si elle l'atteint, la note est liée aux autres.",
    reponses: !j || !alt ? [] : [
      reponse("garder", majuscule(nomDuree(cur)) + (liee ? " liée" : ""), "ok", null, "La note est gardée telle quelle."),
      reponse("autre", majuscule(nomDuree(alt)) + (liee ? "" : " liée"), "crayon", changer, `La note devient une ${nomDuree(alt)}.`),
    ],
  };
}

/** « La ou sol ? » (L2) : une tête entre deux places. */
function poserHauteur(d, abc, base) {
  const j = noteVisee(d, abc);
  const { note: k = 0, pas = 0 } = d.alternative || {};
  const n = j && j.notes[k];
  const nom = (x) => (x ? NOMS_CLES[x.lettre] : "");
  const autre = n && ed.deplacerNote(abc, j, k, pas);
  const nAutre = autre && ed.lireJeton(autre.abc, j.debut).notes[k];
  return {
    ...base, manuel: true,
    titre: n && nAutre ? `${majuscule(nom(n))} ou ${nom(nAutre)} ?` : "Quelle note ?",
    detail: n ? `Cette tête est entre deux places : je l'ai lue ${nom(n)}${j.notes.length > 1 ? " (dans l'accord)" : ""}.` : (d.message || ""),
    reponses: !n || !nAutre ? [] : [
      reponse("garder", majuscule(nom(n)), "ok", null, `La note reste un ${nom(n)}.`),
      reponse("autre", majuscule(nom(nAutre)), pas > 0 ? "haut" : "bas", (a) => { const jj = noteVisee(d, a); return jj && ed.deplacerNote(a, jj, k, pas); }, `La note devient un ${nom(nAutre)}.`),
    ],
  };
}

/** « Pointée ou pas ? » (L2) : un point à la limite de la distance où il compte. */
function poserPoint(d, abc, base) {
  const j = noteVisee(d, abc);
  const alt = d.alternative && d.alternative.croches;
  return {
    ...base, manuel: true, titre: "Pointée ou pas ?",
    detail: d.lue === "pointee" ? "Le point est loin de la note : je l'ai compté. C'est peut-être un point de reprise, ou une trace." : "Un point un peu loin de la note : je ne l'ai pas compté.",
    reponses: !j || !alt ? [] : [
      reponse("garder", majuscule(nomDuree(j.croches)), "ok", null, "La note est gardée telle quelle."),
      reponse("autre", majuscule(nomDuree(alt)), "point", (a) => { const jj = noteVisee(d, a); return jj && ed.fixerDuree(a, jj, alt); }, `La note devient une ${nomDuree(alt)}.`),
    ],
  };
}

/**
 * Les propositions d'une mesure qui ne tombe pas juste (L15) : chacune change
 * une ou deux notes (une autre lecture d'une décision limite) pour la
 * compléter. Elles ne sont proposées que si elles complètent encore la mesure
 * dans l'ABC d'aujourd'hui. Chaque réponse dit les doutes qu'elle règle (`regle`).
 */
function reponsesPropositions(d, abc, jetons, attendu) {
  if (!jetons || attendu === undefined) return [];
  const actuel = somme(jetons);
  const sortie = [];
  (d.propositions || []).forEach((p, k) => {
    const changements = p.changements || [];
    let delta = 0;
    for (const c of changements) {
      if (c.triolet) {
        const g = c.vise && jetonsEntre(abc, c.vise.debut, c.vise.fin);
        if (!g || g.length !== 3 || abc.slice(Math.max(0, c.vise.debut - 2), c.vise.debut) === "(3") return;
        delta -= somme(g) / 3;
      } else {
        const j = jetonVise(c.vise, abc);
        if (!j) return;
        delta += c.supprimer ? -j.croches : c.croches - j.croches;
      }
    }
    if (Math.abs(actuel + delta - attendu) > 1e-6) return;
    const geste = (a) => {
      // De la droite vers la gauche : chaque changement garde la place des précédents.
      const ordre = [...changements].sort((x, y) => y.vise.debut - x.vise.debut);
      return enchainer(a, ordre.map((c) => (t) => {
        if (c.triolet) return ed.faireTriolet(t, c.vise);
        const j = jetonVise(c.vise, t);
        return j && (c.supprimer ? ed.supprimer(t, j) : ed.fixerDuree(t, j, c.croches));
      }));
    };
    const r = reponse(`proposition-${k + 1}`, p.texte, "crayon", geste, "La mesure est complète.");
    r.regle = p.regle || [];
    sortie.push(r);
  });
  return sortie;
}

/** « Mi♭ majeur », ou « Sans armure » pour do majeur : le texte d'un bouton. */
function libelleCle(cle) {
  if (!cle || cle === "C") return "Sans armure";
  const n = nomCle(cle);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

const SIGNES = { "^": "♯", _: "♭", "=": "♮" };

/**
 * Les doutes d'armure. Trois cas : la ligne reprend l'armure de la ligne
 * d'avant ; l'armure mêle bémols et dièses ; une altération collée à la
 * première note (armure de la ligne, ou altération de cette note ?). Les
 * réponses réécrivent l'armure de la ligne entière (edition.changerArmure),
 * et l'altération de la note quand il le faut, en un seul geste.
 */
function poserArmure(d, abc, base) {
  const ligne = d.viseLigne || null;
  const versCle = (cle) => (a, modifs) => (ligne ? ed.changerArmure(a, apres(ligne, modifs, true), cle) : null);
  if (d.variante === "melee") {
    const reponses = [reponse("garder", libelleCle(d.cle), "ok", null, "L'armure est gardée.")];
    if (ligne) for (const autre of d.autres || []) reponses.push(reponse(`cle-${autre}`, libelleCle(autre), "crayon", (a) => versCle(autre)(a, []), `L'armure devient : ${libelleCle(autre).toLowerCase()}.`));
    return {
      ...base, manuel: true, titre: "Bémols ou dièses ?",
      detail: `Je vois ${pluriel(d.bemols, "bémol")} et ${pluriel(d.dieses, "dièse")} au début de la ligne : une armure n'a que l'un ou l'autre. Je l'ai lue en ${nomCle(d.cle)}.`,
      reponses,
    };
  }
  if (d.variante === "premiere-note") {
    const j = noteVisee(d, abc);
    const signe = SIGNES[d.alteration] || "";
    const surNote = (a, modifs) => {
      const v = d.vise && apres(d.vise, modifs);
      const jj = v && ed.lireJeton(a, v.debut);
      return jj && jj.fin === v.fin ? ed.alterer(a, jj, d.alteration) : null;
    };
    const parNote = reponse("note", "Cette note seulement", "crayon", null, "L'altération ne vaut que pour cette note.");
    const parLigne = reponse("ligne", `Toute la ligne : ${libelleCle(d.lue === "alteration" ? d.autreCle : d.cle).toLowerCase()}`, "crayon", null, "C'est l'armure de la ligne.");
    if (d.lue === "alteration") parLigne.geste = j && ligne ? (a) => enchainer(a, [surNote, versCle(d.autreCle)]) : null;
    else parNote.geste = j && ligne ? (a) => enchainer(a, [versCle(d.autreCle), surNote]) : null;
    const reponses = (d.lue === "alteration" ? [parNote, parLigne] : [parLigne, parNote]).filter((r, i) => i === 0 || r.geste);
    return {
      ...base, manuel: true, titre: "Armure ou altération ?",
      detail: d.lue === "alteration"
        ? `Le ${signe} juste devant la première note : je l'ai lu pour cette note seulement. Si c'est l'armure, il vaut pour toute la ligne.`
        : `Le ${signe} au début de la ligne, à la hauteur de la première note : je l'ai lu comme l'armure. Si c'est une altération, il ne vaut que pour cette note.`,
      reponses,
    };
  }
  const cle = d.cle || ((d.message || "").match(/\(([A-G][b#]?)\)/) || [])[1];
  const reponses = [reponse("meme", "Oui, la même", "ok", null, "L'armure est gardée.")];
  if (ligne && cle && cle !== "C") reponses.push(reponse("sans", "Non, sans armure", "crayon", (a) => versCle("C")(a, []), "La ligne n'a plus d'armure."));
  return {
    ...base,
    titre: "Même armure qu'avant ?",
    detail: `Il n'y a pas d'armure au début de cette ligne : je garde celle de la ligne d'avant${cle ? ` (${nomCle(cle)})` : ""}.`,
    reponses,
  };
}

/** « Ligne 2, main droite, 3ᵉ mesure » : où est le doute, dans les mots d'Adrien. */
function endroit(d) {
  if (!d.ligne) return null;
  return `Ligne ${d.ligne}${d.main ? `, main ${d.main}` : ""}${d.rang ? `, ${d.rang}ᵉ mesure` : ""}`;
}

/** Une réponse : le texte du bouton, son icône, et le geste (null : rien à changer dans l'ABC). */
const reponse = (id, texte, icone, geste, fait) => ({ id, texte, icone, geste, fait: fait || texte });

/**
 * Une réponse qui t'apprend (L16) : elle dit aussi ce que le signe était.
 * `apprendre` : [{ traits, etiquette }], les numéros des traits sur la page
 * du doute et l'étiquette de gabarits.js ; l'atelier en fait des exemples
 * (ajouterExemple), pour que le lecteur reconnaisse ce signe la prochaine fois.
 */
const qui = (r, apprendre) => (apprendre && apprendre.length ? { ...r, apprendre } : r);

// Ce qu'un signe inconnu peut être, avec son nom dans la question et son geste.
const ALTERATIONS = [["diese", "Un dièse", "^"], ["bemol", "Un bémol", "_"], ["becarre", "Un bécarre", "="]];
const SILENCES = [["soupir", "Un soupir", 2], ["demi-soupir", "Un demi-soupir", 1], ["quart-soupir", "Un quart de soupir", 0.5]];

/**
 * Les exemples qu'apprend une réponse de chiffrage : un chiffre par signe
 * écrit, ceux du haut puis ceux du bas, de gauche à droite (« 12/8 » : 1, 2
 * en haut, 8 en bas ; « C » : un signe). Rien si le compte ne tombe pas juste.
 */
export function exemplesDuChiffrage(d, m) {
  const signes = d.chiffres || [];
  if (!signes.length) return [];
  if (m === "C" || m === "C|") return signes.length === 1 ? [{ traits: signes[0].traits, etiquette: m }] : [];
  const x = /^(\d+)\/(\d+)$/.exec(m || "");
  if (!x) return [];
  const haut = signes.filter((s) => s.haut), bas = signes.filter((s) => !s.haut);
  if (haut.length !== x[1].length || bas.length !== x[2].length || /0/.test(x[1] + x[2])) return [];
  return [...haut.map((s, i) => ({ traits: s.traits, etiquette: x[1][i] })), ...bas.map((s, i) => ({ traits: s.traits, etiquette: x[2][i] }))];
}

/**
 * La question d'un doute, d'après l'ABC d'aujourd'hui :
 * { type, titre, detail, reponses: [{ id, texte, icone, geste(abc) → résultat d'edition.js ou null, fait }],
 *   voulu (« c'est voulu, laisser »), manuel (« je corrige moi-même »), cible }
 */
export function poser(d, abc) {
  const type = typeDe(d);
  const base = { type, titre: "À vérifier", detail: d.message || "", reponses: [], voulu: false, manuel: false, cible: cibleVisible(d, abc) };

  if (type === "crochet") {
    const j = noteVisee(d, abc);
    const noire = j && Math.abs((ed.estPointee(j.croches) ? j.croches / 1.5 : j.croches) - 2) < 1e-9;
    return {
      ...base, manuel: true,
      titre: "Croche ou noire ?",
      detail: "Il y a un petit trait au bout de la hampe : un crochet, ou un reste de geste ?",
      reponses: !j ? [] : [
        reponse("noire", "Noire", "d4", noire ? null : (a) => ed.changerDuree(a, noteVisee(d, a), 2), "La note est une noire."),
        reponse("croche", "Croche", "d2", (a) => ed.changerDuree(a, noteVisee(d, a), 1), "La note devient une croche."),
      ],
    };
  }

  if (type === "mesure") {
    const jetons = jetonsDeLaMesure(d, abc);
    const [trouveMsg, attenduMsg] = ((d.message || "").match(/: ([\d,]+) croches? au lieu de ([\d,]+) croche/) || []).slice(1).map((x) => Number(x.replace(",", ".")));
    const trouve = jetons ? somme(jetons) : (d.trouve ?? trouveMsg);
    const attendu = d.attendu ?? attenduMsg;
    const lieu = endroit(d);
    const detail = (trouve !== undefined && attendu !== undefined)
      ? `${lieu ? lieu + " : j" : "J"}'en compte ${nb(trouve)} au lieu de ${nb(attendu)}.` : (d.message || "");
    const manque = trouve !== undefined && attendu !== undefined ? attendu - trouve : null;
    const sortie = { ...base, manuel: true, voulu: true, detail };
    if (manque === null) return { ...sortie, titre: "Une mesure ne tombe pas juste" };
    if (Math.abs(manque) < 1e-6) {
      return { ...sortie, voulu: false, titre: "La mesure est complète", detail: `${lieu ? lieu + " : e" : "E"}lle compte maintenant ${nb(attendu)} croches.`, reponses: jetons ? [reponse("complete", "C'est bon", "ok", null, "La mesure est complète.")] : [] };
    }
    if (!jetons) return { ...sortie, titre: manque > 0 ? `Il manque ${enCroches(manque)}` : `Il y a ${enCroches(-manque)} de trop` };
    const derniere = (a) => { const l = jetonsDeLaMesure(d, a); return l && l[l.length - 1]; };
    const fin = jetons[jetons.length - 1];
    // D'abord les autres lectures des décisions limites de la mesure (L15), puis les gestes de toujours.
    const proposees = reponsesPropositions(d, abc, jetons, attendu);
    if (proposees.length) sortie.detail += ` ${proposees.length > 1 ? "Ces lectures la complètent" : "Cette lecture la complète"} :`;
    if (manque > 0) {
      return {
        ...sortie, titre: `Il manque ${enCroches(manque)}`,
        reponses: [
          ...proposees,
          reponse("silence", "Ajouter un silence", "silence", (a) => ed.ajouterSilence(a, derniere(a), manque), `Un silence ${/^une /.test(enCroches(manque)) ? "d'" : "de "}${enCroches(manque)} complète la mesure.`),
          reponse("allonger", "Allonger la dernière note", "allonger", (a) => ed.fixerDuree(a, derniere(a), derniere(a).croches + manque), "La dernière note est allongée."),
        ],
      };
    }
    const trop = -manque;
    const reponses = [...proposees];
    if (fin.croches > trop + 1e-6) reponses.push(reponse("raccourcir", "Raccourcir la dernière note", "raccourcir", (a) => ed.fixerDuree(a, derniere(a), derniere(a).croches - trop), "La dernière note est raccourcie."));
    if (Math.abs(fin.croches - trop) < 1e-6) reponses.push(reponse("enlever", "Enlever la dernière note", "corbeille", (a) => ed.supprimer(a, derniere(a)), "La dernière note est enlevée."));
    return { ...sortie, titre: `Il y a ${enCroches(trop)} de trop`, reponses };
  }

  if (type === "sans-hampe") {
    const j = noteVisee(d, abc);
    // Une tête vide sans hampe, loin de la portée (L6) : une ronde, ou une lettre ?
    const ronde = /ronde/.test(d.message || "") || (j && Math.abs(j.croches - 8) < 1e-9);
    return {
      ...base, manuel: true,
      titre: ronde ? "Est-ce une ronde ?" : "Est-ce une noire ?",
      detail: ronde ? "Je vois une tête de note vide, sans queue ni ligne supplémentaire, loin de la portée : je l'ai lue comme une ronde. C'est peut-être une lettre." : "Je vois une tête de note pleine, sans queue : je l'ai lue comme une noire.",
      reponses: !j ? [] : [
        ronde ? reponse("ronde", "Oui, une ronde", "d16", null, "La note reste une ronde.") : reponse("noire", "Oui, une noire", "d4", null, "La note reste une noire."),
        // Juste au-dessus d'une note à hampe : la note d'un accord à hampe courte (L10).
        ...(!ronde && jetonVise(d.viseAccord, abc) ? [reponse("accord", "Une note de l'accord", "accords", (a) => ed.joindreAccord(a, noteVisee(d, a), jetonVise(d.viseAccord, a)), "La note rejoint l'accord.")] : []),
        reponse("enlever", "Non, l'enlever", "corbeille", (a) => ed.supprimer(a, noteVisee(d, a)), "La note est enlevée."),
      ],
    };
  }

  if (type === "triolet") {
    const jetons = d.vise ? jetonsEntre(abc, d.vise.debut, d.vise.fin) : null;
    const deja = d.vise && abc.slice(Math.max(0, d.vise.debut - 2), d.vise.debut) === "(3";
    return {
      ...base, manuel: true, titre: "Un triolet ?",
      detail: "Je vois un petit signe sur trois notes liées, peut-être un « 3 » : trois notes dans le temps de deux.",
      reponses: [
        ...(jetons && jetons.length === 3 && !deja ? [qui(reponse("triolet", "Oui, un triolet", "d2", (a) => ed.faireTriolet(a, d.vise), "Les trois notes forment un triolet."), d.traits && [{ traits: d.traits, etiquette: "triolet" }])] : []),
        reponse("non", "Non, trois notes", "ok", null, "Les trois notes restent telles quelles."),
      ],
    };
  }

  if (type === "ligature") return poserLigature(d, abc, base);
  if (type === "hauteur") return poserHauteur(d, abc, base);
  if (type === "point") return poserPoint(d, abc, base);
  if (type === "tete") {
    const j = noteVisee(d, abc);
    return {
      ...base, manuel: true, titre: "Une note ou un trait ?",
      detail: "Ce gribouillis ressemble à une tête de note, mais de justesse : c'est peut-être un trait.",
      reponses: !j ? [] : [
        reponse("note", "Une note", "d4", null, "La note est gardée."),
        reponse("enlever", "Un trait : l'enlever", "corbeille", (a) => ed.supprimer(a, noteVisee(d, a)), "La note est enlevée."),
      ],
    };
  }

  if (type === "tete-manquante") {
    return {
      ...base, manuel: true,
      titre: "Il manque une note ?",
      detail: "Je vois un trait droit, comme une queue de note, mais sans tête : une note manque peut-être juste après celle-ci.",
      reponses: [reponse("ignorer", "Non, l'ignorer", "ok", null, "Le trait est ignoré.")],
    };
  }

  if (type === "signe") {
    // Ce que le signe peut être (L16) : une altération de la note qui le suit,
    // un silence après celle qui le précède. Chaque réponse l'apprend à tes
    // gabarits ; celle que tes gabarits y voient de justesse (`propose`) vient
    // en premier, et la question la nomme.
    const apprend = (etiquette) => d.traits && [{ traits: d.traits, etiquette }];
    const suivante = jetonVise(d.viseSuivante, abc), precedente = jetonVise(d.visePrecedente, abc);
    const choix = [
      ...(suivante && suivante.type !== "silence" ? ALTERATIONS.map(([e, texte, alt]) => qui(reponse(e, texte, "crayon", (a) => ed.alterer(a, jetonVise(d.viseSuivante, a), alt), `${texte} sur la note qui suit.`), apprend(e))) : []),
      ...(precedente ? SILENCES.map(([e, texte, croches]) => qui(reponse(e, texte, "silence", (a) => ed.ajouterSilence(a, jetonVise(d.visePrecedente, a), croches), `${texte} est ajouté.`), apprend(e))) : []),
    ];
    const propose = choix.find((r) => r.id === d.propose);
    const nom = propose && propose.texte.replace(/^Un /, "un ");
    return {
      ...base, manuel: true,
      titre: propose ? `Est-ce ${nom} ?` : "Un signe que je ne reconnais pas",
      detail: propose ? `Il ressemble à ${nom}, de loin. Je l'ai laissé de côté.` : "Je l'ai laissé de côté. Dis-moi ce que c'est : je le reconnaîtrai la prochaine fois.",
      reponses: [...(propose ? [propose] : []), ...choix.filter((r) => r !== propose), reponse("ignorer", "L'ignorer", "ok", null, "Le signe est ignoré.")],
    };
  }

  if (type === "armure") return poserArmure(d, abc, base);

  if (type === "chiffrage") {
    if (d.variante === "contredit") {
      // Le chiffrage deviné (ou lu par tes gabarits, L16) n'explique pas la
      // moitié des mesures (L1) : les autres en réponses. Chaque réponse dit
      // aussi quels chiffres sont écrits : tes gabarits les apprennent.
      const autres = (d.autres || []).slice(0, 3);
      const justes = d.appuis === 0 ? `aucune des ${d.total} mesures ne tombe juste` : d.appuis === 1 ? `une seule mesure sur ${d.total} tombe juste` : `seules ${d.appuis} mesures sur ${d.total} tombent juste`;
      return {
        ...base, manuel: true, titre: "Le chiffrage est-il bon ?",
        detail: `J'ai ${d.lu ? "lu" : "deviné"} ${d.m}, mais ${justes}.`,
        reponses: [
          qui(reponse("ok", `Oui, ${d.m}`, "ok", null, "Le chiffrage est gardé."), exemplesDuChiffrage(d, d.m)),
          ...(d.viseLigne ? autres.map((m) => qui(reponse(`m-${m}`, m, "metronome", (a) => ed.changerChiffrage(a, d.viseLigne, m), `Le chiffrage devient ${m}.`), exemplesDuChiffrage(d, m))) : []),
        ],
      };
    }
    return {
      ...base,
      titre: "Le chiffrage est-il bon ?",
      detail: "Un chiffrage est écrit au début de la ligne, mais aucune mesure complète ne permet de le vérifier.",
      reponses: [reponse("ok", "Oui, c'est bon", "ok", null, "Le chiffrage est gardé.")],
    };
  }

  return { ...base, reponses: [reponse("vu", "C'est vu", "ok", null, "C'est noté.")] };
}
