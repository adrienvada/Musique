/**
 * DE LA PAGE LUE À LA PARTITION ABC
 *
 * lirePartition(pages, cal, {titre}) enchaîne la lecture de chaque page
 * (lecteur.js), range les événements par système et par main, trouve le
 * chiffrage d'après la durée des mesures, et écrit l'ABC.
 *
 * Les durées sont comptées en croches : c'est l'unité de l'ABC produit
 * (L:1/8). Une noire vaut 2, une blanche 4, une croche pointée 1,5.
 */
import { assembler, lirePage, nomDePas, tonalite, verifierCalibration } from "./lecteur.js";

/**
 * La version du lecteur. Elle change quand une même page se lit autrement :
 * une partition lue par une version plus ancienne, et pas encore corrigée,
 * peut être relue (son ABC et ses doutes en profitent). L'appli la range
 * avec chaque partition lue (versionLecteur).
 */
export const VERSION_LECTEUR = 2;

// ------------------------------------------------------------------------
// Durées et hauteurs en ABC
// ------------------------------------------------------------------------

function fraction(d) {
  for (const den of [1, 2, 4, 8]) {
    const num = d * den;
    if (Math.abs(num - Math.round(num)) < 1e-6) return [Math.round(num), den];
  }
  return [Math.round(d * 8), 8];
}

export function dureeABC(d) {
  const [num, den] = fraction(d);
  if (den === 1) return num === 1 ? "" : String(num);
  return (num === 1 ? "" : String(num)) + "/" + (den === 2 ? "" : den);
}

function hauteurABC(portee, tete) {
  const { lettre, octave } = nomDePas(portee, tete.pas);
  let s = octave >= 5 ? lettre.toLowerCase() + "'".repeat(octave - 5) : lettre + ",".repeat(Math.max(0, 4 - octave));
  return (tete.alteration || "") + s;
}

// ------------------------------------------------------------------------
// Chiffrage
// ------------------------------------------------------------------------

/**
 * Les chiffrages que le lecteur peut deviner, du plus courant au plus rare.
 * Avant, n'importe quelle durée de mesure devenait un chiffrage : une mesure
 * fausse sur deux donnait 5/4, un point manqué 7/8, un triolet 9/8, sans
 * aucun doute (audit du 04/10, C1). 2/2 a la durée de 4/4 : il ne se devine
 * pas, il se lit (gabarits, L16). 5/4 et 7/8 ne sont retenus que si toutes
 * les mesures de la pièce les confirment.
 */
const USUELS = [
  { croches: 8, m: "4/4" }, { croches: 6, m: "3/4" }, { croches: 4, m: "2/4" }, { croches: 12, m: "12/8", compose: true },
  { croches: 6, m: "6/8", compose: true }, { croches: 3, m: "3/8" }, { croches: 9, m: "9/8", compose: true },
  { croches: 10, m: "5/4", rare: true }, { croches: 7, m: "7/8", rare: true },
];

/** Le chiffrage usuel d'une durée de mesure (en croches), ou null. */
function usuel(croches, par3) {
  const c = USUELS.filter((u) => Math.abs(u.croches - croches) < 1e-6);
  if (!c.length) return null;
  return c.find((u) => !!u.compose === !!par3) || c[0];
}

/**
 * Le chiffrage d'une section (des lignes qui partagent la même mesure),
 * d'après la durée de ses mesures : le chiffrage usuel qui en explique le
 * plus. `premieres` : la durée des premières mesures de la section, qui
 * peuvent être des levées ; elles votent quand elles tombent juste, et ne
 * contredisent rien sinon. Rend aussi combien de mesures le confirment.
 */
export function devinerChiffrage(durees, par3, premieres = []) {
  if (!durees.length && !premieres.length) return null;
  const votes = new Map();
  for (const d of [...durees, ...premieres]) {
    const u = usuel(d, par3);
    if (u) votes.set(u, (votes.get(u) || 0) + 1);
  }
  const total = (u) => durees.length + premieres.filter((d) => Math.abs(d - u.croches) < 1e-6).length;
  const classes = [...votes.entries()].filter(([u]) => !u.rare).sort((a, b) => b[1] - a[1] || USUELS.indexOf(a[0]) - USUELS.indexOf(b[0]));
  if (classes.length) {
    const [u, n] = classes[0];
    return { m: u.m, croches: u.croches, appuis: n, total: total(u), autres: classes.slice(1).map(([x]) => x.m) };
  }
  // 5/4 ou 7/8 : seulement si toutes les mesures (au moins deux) le disent.
  const rares = [...votes.entries()].filter(([u, n]) => u.rare && n >= 2 && n === total(u));
  if (rares.length) return { m: rares[0][0].m, croches: rares[0][0].croches, appuis: rares[0][1], total: rares[0][1], autres: [] };
  return null;
}

// ------------------------------------------------------------------------
// Découpage d'une voix en mesures
// ------------------------------------------------------------------------

function mesuresDe(evs) {
  const mesures = [];
  let m = { evs: [], barreAvant: null, barreApres: null, fermee: false };
  for (const e of evs) {
    if (e.type === "barre") {
      if (m.evs.length) {
        m.barreApres = e; m.fermee = true; mesures.push(m);
        m = { evs: [], barreAvant: e, barreApres: null, fermee: false };
      } else {
        // Barre en tête de ligne (reprise |: par exemple) : elle ouvre la mesure.
        m.barreAvant = e;
      }
    } else m.evs.push(e);
  }
  if (m.evs.length) mesures.push(m);
  for (const x of mesures) {
    x.duree = x.evs.reduce((a, e) => a + dureeEv(e), 0);
    // Une pause dit « toute la mesure », quelle qu'elle soit : elle ne vote pas pour le chiffrage.
    x.pause = x.evs.some((e) => e.pause);
  }
  return mesures;
}

function dureeEv(e) {
  return e.duree * (e.points ? 1.5 : 1);
}

function barreABC(b, derniere) {
  if (!b) return "|";
  const { gauche, droite } = b.reprise || {};
  if (gauche && droite) return "::";
  if (gauche) return ":|";
  if (droite) return "|:";
  if (b.double && derniere) return "|]";
  if (b.double) return "||";
  return "|";
}

/**
 * L'ABC d'une mesure. Chaque événement retient au passage où son jeton tombe
 * dans ce texte (`pos`) : c'est ce qui permet à l'atelier de viser la note
 * d'un doute sans relire l'ABC. Une note liée à la suivante (liaison de
 * durée, L11) est suivie d'un « - », hors de son jeton.
 */
function mesureABC(m, portee) {
  let texte = "";
  let groupe = null;
  for (const e of m.evs) {
    const d = dureeABC(dureeEv(e));
    let j;
    if (e.type === "silence") j = "z" + d;
    else {
      const ts = [...e.tetes].sort((a, b) => a.pas - b.pas).map((t) => hauteurABC(portee, t));
      j = (ts.length > 1 ? `[${ts.join("")}]` : ts[0]) + d;
    }
    // Les notes d'une même ligature s'écrivent collées : l'ABC les relie.
    const lie = e.type === "note" && e.ligature !== null && e.ligature === groupe;
    if (!lie && texte) texte += " ";
    e.pos = [texte.length, texte.length + j.length];
    texte += j + (e.liee ? "-" : "");
    groupe = e.type === "note" ? e.ligature : null;
  }
  return texte;
}

// ------------------------------------------------------------------------
// Lecture complète
// ------------------------------------------------------------------------

export function lirePartition(pages, cal, { titre = "Sans titre" } = {}) {
  verifierCalibration(cal);
  if (!Array.isArray(pages)) throw new Error("Pas de page à lire.");
  const lues = [];
  const doutes = [];
  const systemes = []; // { page, index, voix: [{portee, evs}], entetes }
  pages.forEach((traits, i) => {
    const lue = lirePage(traits, cal, i + 1);
    const asm = assembler(lue);
    // Nom de chaque tête, pour les images de contrôle et l'atelier.
    for (const t of lue.tetes) {
      const n = nomDePas(lue.portees[t.portee], t.pas);
      t.nom = `${"do ré mi fa sol la si".split(" ")["CDEFGAB".indexOf(n.lettre)]}${n.octave}`;
    }
    lues.push(lue);
    doutes.push(...asm.doutes);
    cal.systemes.forEach((s, is) => {
      const portees = lue.portees.filter((p) => p.systeme === is);
      const voix = portees.map((p) => ({ portee: p, evs: asm.parPortee[p.index] }));
      if (voix.every((v) => !v.evs.some((e) => e.type !== "barre"))) return; // système vide
      systemes.push({ page: i + 1, index: is, voix, entetes: portees.map((p) => asm.entetes[p.index]) });
    });
  });

  const piano = cal.systemes[0].portees.length === 2;

  // 1. Les mesures de chaque voix, puis les sections : une section commence
  //    à la première ligne, et à chaque ligne où un chiffrage est écrit. Le
  //    chiffrage ne change plus qu'à une telle ligne : avant, une ligne dont
  //    les mesures étaient fausses changeait de chiffrage sans rien demander.
  const sections = [];
  systemes.forEach((sys, n) => {
    sys.voix = sys.voix.map((v) => ({ ...v, mesures: mesuresDe(v.evs) }));
    sys.ecrit = sys.entetes.some((e) => e.chiffrage);
    if (n === 0 || sys.ecrit) sections.push({ systemes: [], ecrit: sys.ecrit });
    sections[sections.length - 1].systemes.push(sys);
    sys.section = sections[sections.length - 1];
  });
  let precedent = null;
  for (const s of sections) {
    // Votent les mesures fermées par une barre, sauf les pauses (elles
    // durent ce que dure la mesure). La première de la section peut être une
    // levée : elle vote à part. Une mesure qui a peut-être un triolet (un
    // « 3 » sur trois croches liées) vote avec une croche de moins.
    const durees = [], premieres = [];
    const duree = (m) => m.duree - (m.evs.some((e) => e.triolet) ? 1 : 0);
    s.systemes.forEach((sys, k) => sys.voix.forEach((v) => {
      for (const m of v.mesures.filter((m) => m.fermee && !m.pause)) (k === 0 && m === v.mesures[0] ? premieres : durees).push(duree(m));
    }));
    const groupes = s.systemes.flatMap((sys) => sys.voix.flatMap((v) => groupesLigatures(v.evs)));
    const par3 = groupes.length > 0 && groupes.filter((g) => g % 3 === 0).length / groupes.length >= 0.5;
    s.devine = devinerChiffrage(durees, par3, premieres);
    s.m = s.devine ? { m: s.devine.m, croches: s.devine.croches } : precedent;
    precedent = s.m;
  }
  // En mesure composée, trois croches liées sont la règle, pas un triolet.
  const systemeDe = (d) => systemes.find((s) => s.page === d.page && s.voix.some((v) => v.portee.index === d.portee));
  for (let i = doutes.length - 1; i >= 0; i--) {
    if (doutes[i].type !== "triolet") continue;
    const s = systemeDe(doutes[i]);
    if (s && s.section.m && /\/8$/.test(s.section.m.m)) doutes.splice(i, 1);
  }

  let cle = null, chiffrage = null;
  const lignes = [];
  const enTete = { M: null, K: null };
  let numeroMesure = 1;
  let leveeCourante = 0;

  systemes.forEach((sys, n) => {
    // Armure : celle écrite en tête de la première portée du système.
    const e0 = sys.entetes[0];
    let k = cle;
    if (e0.bemols && e0.dieses) {
      // Bémols et dièses mêlés : ce n'est pas une armure. On garde les plus
      // nombreux, et on le demande (avant, la ligne passait en do sans rien dire).
      const parBemols = tonalite(e0.bemols, 0), parDieses = tonalite(0, e0.dieses);
      k = e0.bemols >= e0.dieses ? parBemols : parDieses;
      doutes.push({
        type: "armure", variante: "melee", cle: k, autres: [k === parBemols ? parDieses : parBemols, "C"], bemols: e0.bemols, dieses: e0.dieses,
        page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), _sys: sys,
        message: `Armure de ${e0.bemols} bémol${e0.bemols > 1 ? "s" : ""} et ${e0.dieses} dièse${e0.dieses > 1 ? "s" : ""} : lue en ${k}.`,
      });
    } else if (e0.bemols || e0.dieses) k = tonalite(e0.bemols, e0.dieses);
    else if (cle && cle !== "C") {
      doutes.push({ type: "armure", cle, autres: ["C"], page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), _sys: sys, message: `Pas d'armure en début de ligne : celle de la ligne précédente (${cle}) est reprise.` });
    }
    if (!k) k = "C";
    // Armure ou altération de la première note (lecteur.js) : les deux tonalités en jeu.
    for (const d of doutes.filter((d) => d._hesitation && d.page === sys.page && sys.voix.some((v) => v.portee.index === d.portee))) {
      const b = d.alteration === "_" ? 1 : 0, di = d.alteration === "^" ? 1 : 0;
      d.cle = k;
      d.autreCle = d.lue === "alteration" ? tonalite(e0.bemols + b, e0.dieses + di) : tonalite(Math.max(0, e0.bemols - b), Math.max(0, e0.dieses - di));
      d._sys = sys;
    }

    // Chiffrage : celui de la section.
    const section = sys.section;
    const debutSection = section.systemes[0] === sys;
    const m = section.m;
    const voix = sys.voix;
    // Une pause dure toute la mesure, quelle qu'elle soit.
    for (const v of voix) for (const mes of v.mesures) {
      if (!mes.pause) continue;
      for (const e of mes.evs) if (e.pause) e.duree = m ? m.croches : 8;
      mes.duree = mes.evs.reduce((a, e) => a + dureeEv(e), 0);
    }
    if (debutSection) {
      if (sys.ecrit && !section.devine) {
        doutes.push({ type: "chiffrage", page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), message: "Chiffrage écrit mais pas de mesure complète pour le vérifier." });
      } else if (section.devine && section.devine.appuis < section.devine.total / 2) {
        // Moins de la moitié des mesures tombent juste : le chiffrage lui-même est douteux.
        doutes.push({
          type: "chiffrage", variante: "contredit", m: section.devine.m, autres: section.devine.autres, appuis: section.devine.appuis, total: section.devine.total,
          page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), _section: section,
          message: `Chiffrage deviné : ${section.devine.m}, mais seules ${section.devine.appuis} mesures sur ${section.devine.total} le confirment.`,
        });
      }
    }

    const champs = [];
    if (n === 0) { enTete.K = k; enTete.M = m ? m.m : "none"; }
    else {
      if (k !== cle) champs.push(`[K:${k}]`);
      if (m && (!chiffrage || m.m !== chiffrage.m)) champs.push(`[M:${m.m}]`);
    }
    cle = k; chiffrage = m;

    // Contrôle des temps, mesure par mesure. Une ligne finit toujours une
    // mesure, barre écrite ou non.
    //  - Une levée n'est acceptée qu'en tête de pièce, ou en tête d'une section
    //    dont le chiffrage est écrit (ta page de mélodie : la gamme, puis la
    //    pièce en 12/8 avec sa levée) ; de même durée dans toutes les voix ; et
    //    suivie d'une mesure complète. Avant, toute première mesure plus courte
    //    d'une ligne passait pour une levée (un soupir retiré à la main gauche
    //    ne levait rien).
    //  - La dernière mesure peut compléter la levée (fin de pièce ou reprise),
    //    ou rester inachevée en fin de pièce.
    const nbMesures = Math.max(...voix.map((v) => v.mesures.length));
    const enTeteDePiece = n === 0 || (debutSection && section.ecrit);
    const premieres = voix.map((v) => v.mesures[0]).filter(Boolean);
    const estLevee = !!m && enTeteDePiece && premieres.length === voix.length
      && premieres.every((p) => p.duree < m.croches - 1e-6 && Math.abs(p.duree - premieres[0].duree) < 1e-6)
      && voix.every((v) => v.mesures[1] && Math.abs(v.mesures[1].duree - m.croches) < 1e-6);
    if (estLevee) leveeCourante = premieres[0].duree;
    else if (enTeteDePiece) leveeCourante = 0;
    const decalage = estLevee ? 1 : 0; // la levée n'est pas une mesure : elle ne se compte pas
    voix.forEach((v, iv) => {
      v.mesures.forEach((mes, i) => {
        if (!m) return;
        const premiere = i === 0, derniere = i === v.mesures.length - 1;
        if (premiere && estLevee) return;
        const finDeReprise = mes.barreApres && mes.barreApres.reprise && mes.barreApres.reprise.gauche;
        const finDePiece = derniere && n === systemes.length - 1;
        if ((finDeReprise || finDePiece) && leveeCourante && Math.abs(mes.duree + leveeCourante - m.croches) < 1e-6) return;
        if (finDePiece && !mes.fermee && mes.duree < m.croches) return;
        const ecart = Math.abs(mes.duree - m.croches) > 1e-6;
        if (ecart) {
          const rang = i + 1 - decalage;
          const lieu = rang > 0 ? `${rang}ᵉ mesure` : "levée";
          const propositions = trancher(mes, m, doutes);
          doutes.push({
            type: "mesure", page: sys.page, portee: v.portee.index, mesure: numeroMesure + i - decalage,
            // Pour poser la question : où (ligne, main, rang dans la ligne) et combien de croches.
            ligne: n + 1, ...(piano ? { main: iv ? "gauche" : "droite" } : {}), rang, trouve: mes.duree, attendu: m.croches,
            boite: boiteMesure(mes, v.portee, cal),
            message: `Ligne ${n + 1}${piano ? (iv ? ", main gauche" : ", main droite") : ""}, ${lieu} : ${temps(mes.duree)} au lieu de ${temps(m.croches)}.`,
            _mes: mes,
            ...(propositions.length ? { propositions } : {}),
          });
        }
      });
    });

    // Écriture ABC de la ligne.
    const derniereLigne = n === systemes.length - 1;
    // Chaque mesure et chaque note retient où elle tombe dans sa ligne (`place`) :
    // les doutes en font leur `cible`, une fois l'ABC entier assemblé.
    const ecrireVoix = (v, prefixe = "") => {
      const debut = v.mesures[0] && v.mesures[0].barreAvant ? barreABC(v.mesures[0].barreAvant, false) + " " : "";
      const ligne = lignes.length;
      let pos = prefixe.length + champs.join("").length + debut.length;
      const corps = v.mesures.map((mes, i) => {
        const fin = mes.barreApres ? barreABC(mes.barreApres, derniereLigne && i === v.mesures.length - 1) : "";
        const texte = mesureABC(mes, v.portee);
        mes.place = { ligne, debut: pos, fin: pos + texte.length };
        for (const e of mes.evs) e.place = { ligne, debut: pos + e.pos[0], fin: pos + e.pos[1] };
        const piece = texte + (fin ? " " + fin : "");
        pos += piece.length + 1; // + l'espace qui sépare deux mesures
        return piece;
      });
      // Une voix plus courte que l'autre est complétée par des silences invisibles.
      for (let i = v.mesures.length; i < nbMesures; i++) corps.push(`x${dureeABC(m ? m.croches : 8)} |`);
      return prefixe + champs.join("") + debut + corps.join(" ");
    };
    sys.premiereLigne = lignes.length;
    if (piano) {
      voix.forEach((v, i) => lignes.push(ecrireVoix(v, `[V:${i + 1}] `)));
    } else lignes.push(ecrireVoix(voix[0]));
    sys.derniereLigne = lignes.length - 1;
    numeroMesure += nbMesures - decalage;
  });

  const composees = enTete.M && /^(6|9|12)\/8$/.test(enTete.M);
  // La clé de chaque voix vient de la calibration : en clé de sol, abcjs n'a
  // rien à savoir ; une autre clé doit être dite, sinon la gravure place mal les notes.
  const cles = cal.systemes[0].portees.map((p) => CLES_ABC[p.cle] || "treble");
  const entete = [
    "X:1",
    `T:${titre}`,
    `M:${enTete.M || "none"}`,
    "L:1/8",
    composees ? "Q:3/8=60" : "Q:1/4=90",
    `K:${enTete.K || "C"}${!piano && cles[0] !== "treble" ? ` clef=${cles[0]}` : ""}`,
    ...(piano ? ["%%score {1 2}", ...cles.map((c, i) => `V:${i + 1} clef=${c}`)] : []),
  ];
  const abc = [...entete, ...lignes].join("\n");

  // Les doutes dans l'ordre de la page (page, ligne, de gauche à droite),
  // chacun avec son numéro : c'est l'ordre où l'atelier les pose, et les
  // propositions d'une mesure nomment les doutes qu'elles règlent.
  const systemeDePortee = new Map(lues.flatMap((l) => l.portees.map((p) => [p.index, p.systeme])));
  doutes.sort((a, b) => (a.page - b.page) || (systemeDePortee.get(a.portee) - systemeDePortee.get(b.portee)) || ((a.boite ? a.boite.x0 : 0) - (b.boite ? b.boite.x0 : 0)) || (a.portee - b.portee));
  doutes.forEach((d, i) => { d.id = `d${i + 1}`; });

  // Où tombe chaque doute dans l'ABC (début et fin du jeton ou de la mesure).
  // C'est ce qui permet à l'atelier de poser une question fermée et d'appliquer
  // la réponse sur la bonne note ; l'ABC, lui, n'en dépend pas.
  let debutLigne = entete.join("\n").length + 1;
  const debutsLignes = lignes.map((l) => { const d = debutLigne; debutLigne += l.length + 1; return d; });
  const absolu = (place) => (place ? { debut: debutsLignes[place.ligne] + place.debut, fin: debutsLignes[place.ligne] + place.fin } : null);
  const lignesDe = (a, b) => ({ debut: debutsLignes[a], fin: debutsLignes[b] + lignes[b].length });
  for (const d of doutes) {
    const place = (d._ev || d._mes || {}).place;
    if (place) d.cible = absolu(place);
    // Un triolet vise ses trois notes, de la première à la dernière.
    if (d._evFin && d.cible && d._evFin.place) d.cible = { debut: d.cible.debut, fin: absolu(d._evFin.place).fin };
    // La note à hampe dont une tête sans hampe ferait partie (accord à hampe courte, L10).
    if (d._accord && d._accord.place) d.cibleAccord = absolu(d._accord.place);
    // Les lignes d'un système (ses deux voix au piano) : ce que réécrit un changement d'armure.
    if (d._sys && d._sys.premiereLigne !== undefined) d.cibleLigne = lignesDe(d._sys.premiereLigne, d._sys.derniereLigne);
    // Les lignes d'une section : ce que réécrit un changement de chiffrage.
    if (d._section) {
      const s = d._section.systemes;
      d.cibleLigne = lignesDe(s[0].premiereLigne, s[s.length - 1].derniereLigne);
    }
    // Les propositions d'une mesure : la place de chaque note à changer, et les doutes qu'elles règlent.
    for (const p of d.propositions || []) {
      for (const c of p.changements) {
        c.cible = absolu(c._ev.place);
        if (c._evFin) c.cible = { debut: c.cible.debut, fin: absolu(c._evFin.place).fin };
        if (c._doute) c.doute = c._doute.id;
        delete c._ev; delete c._evFin; delete c._doute;
      }
      p.regle = p.changements.map((c) => c.doute).filter(Boolean);
    }
    for (const k of ["_ev", "_evFin", "_mes", "_sys", "_section", "_hesitation", "_accord"]) delete d[k];
  }

  return { abc, doutes, lues, piano, nbSystemes: systemes.length };
}

const NOMS_DUREES = { 0.5: "double croche", 0.75: "double croche pointée", 1: "croche", 1.5: "croche pointée", 2: "noire", 3: "noire pointée", 4: "blanche", 6: "blanche pointée", 8: "ronde", 12: "ronde pointée" };
const ordinal = (k) => (k === 1 ? "1ʳᵉ" : `${k}ᵉ`);

/**
 * Trancher par la mesure (L15). Les décisions limites (ligature ou crochet,
 * point ou pas, tête ou trait) sont justement celles qu'une mesure fausse
 * désigne : on essaie leurs autres lectures, seules ou deux à deux, et on
 * garde celles qui complètent la mesure. En mesure simple, trois croches
 * liées peuvent aussi être un triolet. Chaque proposition dit quelles notes
 * changer (leur place deviendra leur `cible`) et quels doutes elle règle.
 */
function trancher(mes, m, doutes) {
  const manque = m.croches - mes.duree;
  const notes = mes.evs.filter((e) => e.type === "note");
  const rang = (e) => ordinal(notes.indexOf(e) + 1);
  const candidats = [];
  for (const d of doutes) {
    if (!d._ev || !d.alternative || !mes.evs.includes(d._ev)) continue;
    const e = d._ev, avant = dureeEv(e), alt = d.alternative;
    if (alt.croches !== undefined) candidats.push({ delta: alt.croches - avant, e, changement: { _ev: e, croches: alt.croches, _doute: d }, texte: `${rang(e)} note en ${NOMS_DUREES[alt.croches] || temps(alt.croches)}` });
    else if (alt.supprimer) candidats.push({ delta: -avant, e, changement: { _ev: e, supprimer: true, _doute: d }, texte: `sans la ${rang(e)} note` });
  }
  if (!/\/8$/.test(m.m)) {
    const groupes = new Map();
    for (const e of notes) if (e.ligature !== null) (groupes.get(e.ligature) || groupes.set(e.ligature, []).get(e.ligature)).push(e);
    for (const g of groupes.values()) {
      if (g.length !== 3 || g.some((e) => Math.abs(dureeEv(e) - 1) > 1e-6)) continue;
      const d = doutes.find((x) => x.type === "triolet" && x._ev === g[0]);
      candidats.push({ delta: -1, e: g[0], changement: { _ev: g[0], _evFin: g[2], triolet: true, ...(d ? { _doute: d } : {}) }, texte: `triolet sur les ${rang(g[0])} à ${rang(g[2])} notes` });
    }
  }
  const propositions = [];
  const ajouter = (choix) => {
    const texte = choix.map((c) => c.texte).join(", ");
    propositions.push({ texte: texte.charAt(0).toUpperCase() + texte.slice(1), changements: choix.map((c) => ({ ...c.changement })) });
  };
  for (const a of candidats) if (Math.abs(a.delta - manque) < 1e-6) ajouter([a]);
  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      const [a, b] = [candidats[i], candidats[j]];
      if (a.e !== b.e && Math.abs(a.delta + b.delta - manque) < 1e-6) ajouter([a, b]);
    }
  }
  return propositions.slice(0, 3);
}

function groupesLigatures(evs) {
  const tailles = new Map();
  for (const e of evs) if (e.type === "note" && e.ligature !== null) tailles.set(e.ligature, (tailles.get(e.ligature) || 0) + dureeEv(e));
  return [...tailles.values()];
}

function temps(croches) {
  const txt = Number.isInteger(croches) ? String(croches) : croches.toFixed(1).replace(".", ",");
  return `${txt} croche${croches > 1 ? "s" : ""}`;
}

function bandeau(sys, cal) {
  const p0 = sys.voix[0].portee, p1 = sys.voix[sys.voix.length - 1].portee;
  const marge = 0.3 * cal.interligne; // en interlignes, comme tous les seuils (c'était 10 px)
  return { x0: cal.x_debut, y0: p0.haut - marge, x1: cal.x_debut + 6 * cal.interligne, y1: p1.bas + marge };
}

// Le nom abcjs de chaque clé des calibrations.
const CLES_ABC = { sol: "treble", fa: "bass", ut3: "alto", ut4: "tenor" };

function boiteMesure(mes, portee, cal) {
  const xs = mes.evs.map((e) => e.x);
  const x0 = mes.barreAvant ? mes.barreAvant.x : Math.min(...xs) - cal.interligne;
  const x1 = mes.barreApres ? mes.barreApres.x : Math.max(...xs) + cal.interligne;
  return { x0, y0: portee.haut - cal.interligne, x1, y1: portee.bas + cal.interligne };
}
