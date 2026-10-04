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

/** Les doutes d'une lecture neuve : aucun n'est levé, et chacun vise sa cible. */
export function preparerDoutes(doutes) {
  return doutes.map((d) => ({ ...d, leve: false, vise: d.cible ? { ...d.cible } : null, ...(d.cibleLigne ? { viseLigne: { ...d.cibleLigne } } : {}) }));
}

/**
 * Donne à chaque doute sa visée au premier regard de l'atelier : la cible de la
 * lecture, si l'ABC n'a pas bougé depuis. Sinon (corrigé avant, ou lu avant que
 * les doutes aient une cible), il n'a pas de visée : question sans réponse fermée.
 * `viseLigne` (la ligne d'un doute d'armure) suit la même règle.
 */
export function initialiserVise(doutes, abc, abcLu) {
  for (const d of doutes) {
    if (d.vise === undefined) d.vise = d.cible && abc === abcLu ? { ...d.cible } : null;
    if (d.cibleLigne && d.viseLigne === undefined) d.viseLigne = abc === abcLu ? { ...d.cibleLigne } : null;
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
      if (d.viseLigne) d.viseLigne = deplacerVise(d.viseLigne, m, true);
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
  if (!d.vise) return null;
  const j = ed.lireJeton(abc, d.vise.debut);
  return j && j.fin === d.vise.fin ? j : null;
}

/** Les notes et silences d'une mesure visée, dans l'ordre, ou null si le texte est autre chose (triolet, décoration…). */
export function jetonsDeLaMesure(d, abc) {
  if (!d.vise) return null;
  const jetons = [];
  let pos = d.vise.debut;
  while (pos < d.vise.fin) {
    if (abc[pos] === " ") { pos++; continue; }
    const j = ed.lireJeton(abc, pos);
    if (!j || j.fin <= pos || j.fin > d.vise.fin) return null;
    jetons.push(j);
    pos = j.fin;
  }
  return jetons.length ? jetons : null;
}

/** Où regarder dans la partition lue : { debut, fin, genre } ou null. */
export function cibleVisible(d, abc) {
  const t = typeDe(d);
  if (t === "mesure") return jetonsDeLaMesure(d, abc) ? { ...d.vise, genre: "mesure" } : null;
  if (["crochet", "sans-hampe"].includes(t) || (t === "armure" && d.variante === "premiere-note")) return noteVisee(d, abc) ? { ...d.vise, genre: "note" } : null;
  return null;
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
  return `${nb(n)} croche${n > 1 ? "s" : ""}`;
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
      detail: `Je vois ${d.bemols} bémol${d.bemols > 1 ? "s" : ""} et ${d.dieses} dièse${d.dieses > 1 ? "s" : ""} au début de la ligne : une armure n'a que l'un ou l'autre. Je l'ai lue en ${nomCle(d.cle)}.`,
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
    const trouve = jetons ? jetons.reduce((t, j) => t + j.croches, 0) : (d.trouve ?? trouveMsg);
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
    if (manque > 0) {
      return {
        ...sortie, titre: `Il manque ${enCroches(manque)}`,
        reponses: [
          reponse("silence", "Ajouter un silence", "silence", (a) => ed.ajouterSilence(a, derniere(a), manque), `Un silence de ${enCroches(manque)} complète la mesure.`),
          reponse("allonger", "Allonger la dernière note", "allonger", (a) => ed.fixerDuree(a, derniere(a), derniere(a).croches + manque), "La dernière note est allongée."),
        ],
      };
    }
    const trop = -manque;
    const reponses = [];
    if (fin.croches > trop + 1e-6) reponses.push(reponse("raccourcir", "Raccourcir la dernière note", "raccourcir", (a) => ed.fixerDuree(a, derniere(a), derniere(a).croches - trop), "La dernière note est raccourcie."));
    if (Math.abs(fin.croches - trop) < 1e-6) reponses.push(reponse("enlever", "Enlever la dernière note", "corbeille", (a) => ed.supprimer(a, derniere(a)), "La dernière note est enlevée."));
    return { ...sortie, titre: `Il y a ${enCroches(trop)} de trop`, reponses };
  }

  if (type === "sans-hampe") {
    const j = noteVisee(d, abc);
    return {
      ...base, manuel: true,
      titre: "Est-ce une noire ?",
      detail: "Je vois une tête de note pleine, sans queue : je l'ai lue comme une noire.",
      reponses: !j ? [] : [
        reponse("noire", "Oui, une noire", "d4", null, "La note reste une noire."),
        reponse("enlever", "Non, l'enlever", "corbeille", (a) => ed.supprimer(a, noteVisee(d, a)), "La note est enlevée."),
      ],
    };
  }

  if (type === "signe") {
    return {
      ...base, manuel: true,
      titre: "Un signe que je ne reconnais pas",
      detail: "Je l'ai laissé de côté. Si c'est une note ou un silence, corrige la partition lue.",
      reponses: [reponse("ignorer", "L'ignorer", "ok", null, "Le signe est ignoré.")],
    };
  }

  if (type === "armure") return poserArmure(d, abc, base);

  if (type === "chiffrage") {
    return {
      ...base,
      titre: "Le chiffrage est-il bon ?",
      detail: "Un chiffrage est écrit au début de la ligne, mais aucune mesure complète ne permet de le vérifier.",
      reponses: [reponse("ok", "Oui, c'est bon", "ok", null, "Le chiffrage est gardé.")],
    };
  }

  return { ...base, reponses: [reponse("vu", "C'est vu", "ok", null, "C'est noté.")] };
}
