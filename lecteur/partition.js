/**
 * DE LA PAGE LUE À LA PARTITION ABC
 *
 * lirePartition(pages, cal, {titre}) enchaîne la lecture de chaque page
 * (lecteur.js), range les événements par système et par main, devine le
 * chiffrage d'après la durée des mesures, et écrit l'ABC.
 *
 * Les durées sont comptées en croches : c'est l'unité de l'ABC produit
 * (L:1/8). Une noire vaut 2, une blanche 4, une croche pointée 1,5.
 */
import { assembler, alterationsArmure, lirePage, nomDePas, tonalite } from "./lecteur.js";

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

/** Durées des mesures complètes d'une voix (sans la première ni la dernière). */
function dureesMesures(mesures) {
  const pleines = mesures.filter((m) => m.fermee);
  return pleines.slice(pleines.length > 2 ? 1 : 0).map((m) => m.duree);
}

function deviner(durees, groupesPar3) {
  if (!durees.length) return null;
  const compte = new Map();
  for (const d of durees) compte.set(d, (compte.get(d) || 0) + 1);
  const [d] = [...compte.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0];
  if (d <= 0) return null;
  if (groupesPar3 && Number.isInteger(d) && d % 3 === 0) return { m: `${d}/8`, croches: d };
  if (Number.isInteger(d) && d % 2 === 0) return { m: `${d / 2}/4`, croches: d };
  if (Number.isInteger(d)) return { m: `${d}/8`, croches: d };
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
  for (const x of mesures) x.duree = x.evs.reduce((a, e) => a + dureeEv(e), 0);
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
  if (b.double || b.epais) return "||";
  return "|";
}

function mesureABC(m, portee) {
  const jetons = [];
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
    if (lie) jetons[jetons.length - 1] += j;
    else jetons.push(j);
    groupe = e.type === "note" ? e.ligature : null;
  }
  return jetons.join(" ");
}

// ------------------------------------------------------------------------
// Lecture complète
// ------------------------------------------------------------------------

export function lirePartition(pages, cal, { titre = "Sans titre" } = {}) {
  const lues = [];
  const doutes = [];
  const systemes = []; // { page, index, voix: [{portee, evs}], entetes }
  pages.forEach((traits, i) => {
    const lue = lirePage(traits, cal, i + 1);
    const asm = assembler(lue, cal);
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
  let cle = null, chiffrage = null;
  const lignes = [];
  const enTete = { M: null, K: null };
  let numeroMesure = 1;
  let leveeCourante = 0;

  systemes.forEach((sys, n) => {
    // Armure : celle écrite en tête de la première portée du système.
    const e0 = sys.entetes[0];
    let k = cle;
    if (e0.bemols || e0.dieses) k = tonalite(e0.bemols, e0.dieses);
    else if (cle && cle !== "C") {
      doutes.push({ page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), message: `Pas d'armure en début de ligne : celle de la ligne précédente (${cle}) est reprise.` });
    }
    if (!k) k = "C";

    // Mesures de chaque voix et chiffrage.
    const voix = sys.voix.map((v) => ({ ...v, mesures: mesuresDe(v.evs) }));
    const durees = voix.flatMap((v) => dureesMesures(v.mesures));
    const groupes = voix.flatMap((v) => groupesLigatures(v.evs));
    const par3 = groupes.length > 0 && groupes.filter((g) => g % 3 === 0).length / groupes.length >= 0.5;
    const devine = deviner(durees, par3);
    let m = chiffrage;
    if (devine && (!chiffrage || e0.chiffrage || devine.m !== chiffrage.m)) m = devine;
    if (e0.chiffrage && !devine) {
      doutes.push({ page: sys.page, portee: sys.voix[0].portee.index, boite: bandeau(sys, cal), message: "Chiffrage écrit mais pas de mesure complète pour le vérifier." });
    }

    const champs = [];
    if (n === 0) { enTete.K = k; enTete.M = m ? m.m : "none"; }
    else {
      if (k !== cle) champs.push(`[K:${k}]`);
      if (m && (!chiffrage || m.m !== chiffrage.m)) champs.push(`[M:${m.m}]`);
    }
    cle = k; chiffrage = m;

    // Contrôle des temps, mesure par mesure. Une ligne finit toujours une
    // mesure, barre écrite ou non. Seules exceptions : la levée en tête de
    // pièce (ou après un changement de chiffrage), et la dernière mesure
    // quand elle complète cette levée (fin de pièce ou reprise).
    const nbMesures = Math.max(...voix.map((v) => v.mesures.length));
    const nouveauChiffrage = !chiffrage || n === 0 || (m && champs.some((c) => c.startsWith("[M:")));
    voix.forEach((v, iv) => {
      v.mesures.forEach((mes, i) => {
        if (!m) return;
        const premiere = i === 0, derniere = i === v.mesures.length - 1;
        if (premiere && nouveauChiffrage && mes.duree < m.croches) { if (iv === 0) leveeCourante = mes.duree; return; }
        const finDeReprise = mes.barreApres && mes.barreApres.reprise && mes.barreApres.reprise.gauche;
        const finDePiece = derniere && n === systemes.length - 1;
        if ((finDeReprise || finDePiece) && leveeCourante && Math.abs(mes.duree + leveeCourante - m.croches) < 1e-6) return;
        if (finDePiece && !mes.fermee && mes.duree < m.croches) return;
        const ecart = Math.abs(mes.duree - m.croches) > 1e-6;
        if (ecart) {
          doutes.push({
            page: sys.page, portee: v.portee.index, mesure: numeroMesure + i,
            boite: boiteMesure(mes, v.portee, cal),
            message: `Ligne ${n + 1}${piano ? (iv ? ", main gauche" : ", main droite") : ""}, ${i + 1}ᵉ mesure : ${temps(mes.duree)} au lieu de ${temps(m.croches)}.`,
          });
        }
      });
    });

    // Écriture ABC de la ligne.
    const derniereLigne = n === systemes.length - 1;
    const ecrireVoix = (v) => {
      const debut = v.mesures[0] && v.mesures[0].barreAvant ? barreABC(v.mesures[0].barreAvant, false) + " " : "";
      const corps = v.mesures.map((mes, i) => {
        const fin = mes.barreApres ? barreABC(mes.barreApres, derniereLigne && i === v.mesures.length - 1) : "";
        return mesureABC(mes, v.portee) + (fin ? " " + fin : "");
      });
      // Une voix plus courte que l'autre est complétée par des silences invisibles.
      for (let i = v.mesures.length; i < nbMesures; i++) corps.push(`x${dureeABC(m ? m.croches : 8)} |`);
      return champs.join("") + debut + corps.join(" ");
    };
    if (piano) {
      voix.forEach((v, i) => lignes.push(`[V:${i + 1}] ${ecrireVoix(v)}`));
    } else lignes.push(ecrireVoix(voix[0]));
    numeroMesure += nbMesures;
  });

  const composees = enTete.M && /^(6|9|12)\/8$/.test(enTete.M);
  const abc = [
    "X:1",
    `T:${titre}`,
    `M:${enTete.M || "none"}`,
    "L:1/8",
    composees ? "Q:3/8=60" : "Q:1/4=90",
    `K:${enTete.K || "C"}`,
    ...(piano ? ["%%score {1 2}", "V:1 clef=treble", "V:2 clef=bass"] : []),
    ...lignes,
  ].join("\n");

  return { abc, doutes, lues, piano, nbSystemes: systemes.length };
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
  return { x0: cal.x_debut, y0: p0.haut - 10, x1: cal.x_debut + 6 * cal.interligne, y1: p1.bas + 10 };
}

function boiteMesure(mes, portee, cal) {
  const xs = mes.evs.map((e) => e.x);
  const x0 = mes.barreAvant ? mes.barreAvant.x : Math.min(...xs) - cal.interligne;
  const x1 = mes.barreApres ? mes.barreApres.x : Math.max(...xs) + cal.interligne;
  return { x0, y0: portee.haut - cal.interligne, x1, y1: portee.bas + cal.interligne };
}

export { alterationsArmure };
