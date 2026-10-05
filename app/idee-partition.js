/**
 * LA PARTITION DE L'ÉDITEUR D'IDÉE (gravée par abcjs)
 *
 * L'idée vit en notes (sequence.js) : la partition n'en est qu'une
 * traduction, gravée dans `#idee-gravure`. On la touche pour choisir une
 * note ; pendant l'écoute, la note jouée s'allume ; un trait montre où le
 * clavier écrira.
 *
 * Elle vivait dans idee.js (audit du 04/10, T3), qui gardait dans son état
 * (`e.jetons`, `e.elements`) ce que la gravure seule lit. Elle ne fait plus
 * que lire l'état de l'éditeur : ce que veut dire un toucher (choisir une
 * note, placer le curseur), c'est l'éditeur qui le décide (`surClic`).
 *
 * La mise en page (combien de mesures par ligne, quelle largeur de portée)
 * est une fonction sans DOM ni état, essayée sous Node
 * (tests/idee-partition.test.mjs) : `mettreEnPage`.
 */
import * as sq from "./sequence.js";
import { voixCompletes } from "./harmonie.js";

// La gravure se regroupe (audit du 04/10, M2, et audit de l'interface).
// abcjs regrave toute la partition : de 10 à 40 ms pour une idée courte au
// téléphone, plus de 400 ms pour 64 mesures, et jusqu'à trois gravures par
// changement (six sur grand écran) pour ajuster la mise en page.
//   - Pendant la lecture : une gravure toutes les 300 ms au plus, d'un seul
//     passage, avec la mise en page d'avant ; sinon le transport manquait
//     des notes. L'arrêt regrave en entier.
//   - En écrivant : 150 ms après la dernière note, d'un seul passage tant
//     que le nombre de mesures ne change pas ; dix notes tapées vite ne
//     coûtent qu'une gravure.
//   - Choisir une note ne regrave plus rien : seules ses couleurs changent.
const GRAVURE_EN_LECTURE = 300, GRAVURE_EN_ECRIVANT = 150;

/**
 * La mise en page de la partition : combien de mesures par ligne, et la
 * largeur de portée qu'on demande à abcjs (`staffwidth`).
 *
 * La gravure remplit la place de la grille. Au téléphone, deux mesures par
 * ligne, assez grandes pour se lire et se toucher au doigt ; une idée courte
 * en prend moins par ligne, ou se grave plus grand, plutôt que de laisser un
 * grand vide sous la portée. Bornes : la portée agrandie deux fois au plus
 * au téléphone (1,6 fois sur un grand écran), et assez de place par mesure
 * pour que les notes ne se touchent pas.
 *
 * Seule une gravure dit la hauteur qu'elle prend, et seul abcjs sait graver :
 * `graver(parLigne, largeurPortee)` grave et rend cette hauteur. Le calcul,
 * lui, ne touche ni à la page ni à un état : les essais lui passent une
 * fausse gravure.
 *
 * @param {object} o
 * @param {number} o.largeur  la largeur de la zone, en pixels
 * @param {number} o.hauteur  la hauteur à remplir
 * @param {number} o.mesures  le nombre de mesures de l'idée
 * @param {(parLigne: number, largeurPortee: number) => number} o.graver  grave, et rend la hauteur obtenue
 * @param {{ parLigne: number, largeurPortee: number } | null} [o.reprise]  la mise en page d'avant,
 *   reprise telle quelle, d'une seule gravure (pendant la lecture, M2)
 * @returns {{ parLigne: number, largeurPortee: number }}
 */
export function mettreEnPage({ largeur, hauteur, mesures, graver, reprise = null }) {
  if (reprise) {
    graver(reprise.parLigne, reprise.largeurPortee);
    return { parLigne: reprise.parLigne, largeurPortee: reprise.largeurPortee };
  }
  const agrandiMax = largeur < 700 ? 2 : 1.6;
  const etroite = largeur / agrandiMax; // la portée la plus étroite permise
  let parLigne = Math.max(1, Math.min(6, Math.floor(largeur / 170)));
  let largeurPortee = parLigne * 200;
  let h = graver(parLigne, largeurPortee);
  // Pas plus de 420 px par mesure : sur un grand écran, une ligne de plus
  // pour remplir la hauteur étalerait les notes d'un bord à l'autre.
  const moinsParLigne = Math.max(1, Math.floor(largeur / 420));
  while (parLigne > moinsParLigne && h < hauteur * 0.6) {
    // La hauteur qu'aurait la gravure avec une mesure de moins par ligne.
    const autre = Math.max((parLigne - 1) * 200, etroite);
    const ensuite = h * (largeurPortee / autre) * (Math.ceil(mesures / (parLigne - 1)) / Math.ceil(mesures / parLigne));
    if (ensuite > hauteur) break;
    parLigne--;
    largeurPortee = autre;
    h = graver(parLigne, largeurPortee);
  }
  if (h < hauteur * 0.6) {
    // Encore de la place : les mêmes lignes, gravées plus grand.
    const voulue = Math.max(parLigne * 130, etroite, (largeurPortee * h) / (hauteur * 0.85));
    if (voulue < largeurPortee - 10) {
      largeurPortee = Math.round(voulue);
      graver(parLigne, largeurPortee);
    }
  }
  return { parLigne, largeurPortee };
}

/**
 * @param ctx {
 *   e (l'état de l'éditeur, en lecture seule), $, transport, abcjs() → window.ABCJS,
 *   surClic(jeton) (on a touché une note ou un silence de la gravure),
 *   apresGravure() (une gravure attendue vient de se faire), rafraichir()
 * }
 */
export function creerPartition(ctx) {
  const { e, $ } = ctx;
  // Les jetons de l'ABC gravé (sq.ecrireAbc) et, pour chacun, ses éléments dans la gravure.
  let jetons = [], elements = new Map();
  let dernierJeton = null; // celui qui s'allume pendant l'écoute
  let miseEnPage = null; // { largeur, parLigne, largeurPortee } : celle de la dernière gravure ajustée
  let gravureFaite = 0, gravureAttendue = null, gravureRapide = false;
  let gravee = null; // { id, version, largeur, hauteur, mesures } : ce que montre la gravure en place

  const taille = () => ({ largeur: $("idee-gravure").clientWidth || 600, hauteur: Math.max(160, ($("idee-partition").clientHeight || 400) - 36) });

  /** L'idée ou la place ont changé : on regrave (regroupé, voir plus haut) ; sinon, on ne fait que recolorer. */
  function planifier() {
    const zone = $("idee-gravure");
    const { largeur, hauteur } = taille();
    const fraiche = gravee && gravee.id === e.id && gravee.version === e.version && gravee.largeur === largeur && gravee.hauteur === hauteur && zone.querySelector("svg");
    clearTimeout(gravureAttendue);
    gravureAttendue = null;
    if (fraiche) { marquerChoisies(); return; }
    if (!gravee || gravee.id !== e.id) { graver(); return; } // la première gravure de cette idée : tout de suite
    const lecture = ctx.transport.actif;
    const attente = lecture ? gravureFaite + GRAVURE_EN_LECTURE - performance.now() : GRAVURE_EN_ECRIVANT;
    const graverMaintenant = () => {
      gravureAttendue = null;
      if (!e.ouverte || e.affichage !== "partition") return;
      gravureFaite = performance.now();
      const memes = gravee && gravee.mesures === sq.nbMesures(e.seq);
      if (ctx.transport.actif) gravureRapide = true;
      graver({ unPassage: ctx.transport.actif || memes });
      ctx.apresGravure();
    };
    if (attente <= 0) graverMaintenant();
    else gravureAttendue = setTimeout(graverMaintenant, attente);
  }

  /** La lecture s'arrête : la partition gravée d'un seul passage retrouve sa mise en page ajustée. */
  function apresLecture() {
    if (!gravureRapide || !e.ouverte || e.affichage !== "partition") return;
    gravureRapide = false;
    gravee = null;
    ctx.rafraichir();
  }

  /** @param o { unPassage : pendant la lecture, une seule gravure, avec la mise en page d'avant (M2) } */
  function graver({ unPassage = false } = {}) {
    const lib = ctx.abcjs();
    const zone = $("idee-gravure");
    if (!lib) { zone.textContent = "La partition n'a pas pu se charger (connexion ?). La grille marche sans."; return; }
    const { largeur, hauteur } = taille();
    const toutes = voixCompletes(e.seq);
    const couleur = getComputedStyle(document.body).getPropertyValue("--stylo").trim() || "#2B48B0";
    const mesures = sq.nbMesures(e.seq);
    const reprise = unPassage && miseEnPage && miseEnPage.largeur === largeur ? miseEnPage : null;
    let objet = null, graves = [];
    const page = mettreEnPage({
      largeur, hauteur, mesures, reprise,
      graver: (parLigne, largeurPortee) => {
        const ecrit = sq.ecrireAbc(e.seq, { voix: toutes, mesuresParLigne: parLigne });
        graves = ecrit.jetons;
        [objet] = lib.renderAbc(zone, ecrit.abc, {
          responsive: "resize", add_classes: true, paddingtop: 6, paddingbottom: 6, paddingleft: 0, paddingright: 0,
          staffwidth: largeurPortee,
          clickListener: surClic, selectTypes: ["note"], selectionColor: couleur,
        });
        return zone.getBoundingClientRect().height;
      },
    });
    if (!reprise) miseEnPage = { largeur, ...page };
    jetons = graves;
    elements = new Map();
    dernierJeton = null;
    for (const ligne of (objet && objet.lines) || []) {
      for (const portee of ligne.staff || []) {
        for (const voix of portee.voices || []) {
          for (const el of voix) {
            if (el.el_type !== "note" || !el.abselem) continue;
            const j = sq.jetonA(jetons, el.startChar);
            if (j) elements.set(j, (el.abselem.elemset || []).filter(Boolean));
          }
        }
      }
    }
    gravee = { id: e.id, version: e.version, largeur, hauteur, mesures };
    marquerChoisies();
  }

  /** abcjs dit l'endroit de l'ABC qu'on a touché : l'éditeur décide de ce qu'il veut dire. */
  function surClic(abcelem) {
    const j = sq.jetonA(jetons, abcelem.startChar);
    if (j) ctx.surClic(j);
  }

  /** Les notes choisies en couleur sur la gravure en place, et le curseur : sans rien regraver. */
  function marquerChoisies() {
    for (const [j, els] of elements) {
      const oui = j.voix === e.piste && j.ids.some((id) => e.selection.has(id));
      els.forEach((x) => x.classList.toggle("choisie", oui));
    }
    placerCaret();
  }

  /** Le curseur sur la partition : un trait avant la note où le clavier écrira. */
  function placerCaret() {
    const caret = $("idee-caret");
    const zone = $("idee-partition");
    const candidats = jetons.filter((j) => j.voix === e.piste && j.couche === 0);
    let j = candidats.find((x) => x.a >= e.curseur);
    let apres = false;
    if (!j) { j = candidats.at(-1); apres = true; }
    const els = j && elements.get(j);
    caret.hidden = !els || !els.length || e.selection.size > 0;
    if (caret.hidden) return;
    const r = els[0].getBoundingClientRect(), z = zone.getBoundingClientRect();
    caret.style.left = `${(apres ? r.right + 6 : r.left - 4) - z.left + zone.scrollLeft}px`;
    caret.style.top = `${r.top - z.top + zone.scrollTop - 18}px`;
    caret.style.height = `${Math.max(40, r.height + 36)}px`;
  }

  /** La note jouée s'allume (pas = null : l'écoute s'arrête). */
  function suivre(pas) {
    const j = pas === null ? null : jetons.find((x) => x.voix === e.piste && x.couche === 0 && pas >= x.a && pas < x.a + x.l);
    if (j === dernierJeton) return;
    for (const el of (dernierJeton && elements.get(dernierJeton)) || []) el.classList.remove("joue");
    for (const el of (j && elements.get(j)) || []) el.classList.add("joue");
    dernierJeton = j;
  }

  /** Le cadre des notes choisies sur la gravure, pour y poser la boîte à outils (comme grille.boite). */
  function boite() {
    const zone = $("idee-partition");
    const rs = [...zone.querySelectorAll(".choisie")].map((x) => x.getBoundingClientRect()).filter((r) => r.width || r.height);
    if (!rs.length) return null;
    return {
      boite: { left: Math.min(...rs.map((r) => r.left)), right: Math.max(...rs.map((r) => r.right)), top: Math.min(...rs.map((r) => r.top)), bottom: Math.max(...rs.map((r) => r.bottom)) },
      zone: zone.getBoundingClientRect(),
    };
  }

  return {
    planifier, apresLecture, suivre, boite,
    /** Une autre idée s'ouvre : sa partition se grave tout de suite, avec sa propre mise en page. */
    oublier() { gravee = null; miseEnPage = null; },
  };
}
