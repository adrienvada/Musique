/**
 * LES PIÈCES DE « CORRIGER » ET DE « ÉCOUTER »
 *
 * Les deux écrans (ecran-atelier.js, ecran-lecteur.js) tiennent l'état et
 * décident ; ici, on dessine : les repères numérotés sur ta page, la carte
 * d'un doute (une loupe, une question, de gros boutons), les points
 * d'avancement, l'état « Tout est relu », la pastille de la barre, et deux
 * détails d'écran (les onglets Corriger ↔ Écouter rangés sous la barre de
 * l'écran ouvert, la hauteur du panneau du bas). Et ce que les deux écrans
 * partagent pour faire entendre la page : la gravure, le tempo, l'écoute.
 *
 * Rien ici ne touche à l'ABC ni au stockage : chaque bouton rappelle l'écran.
 */
import { ico } from "./icones.js";
import { cadreDoute, dessinerPage, fenetreLoupe } from "./manuscrit.js";
import { ecrirePref, lirePref } from "./preferences.js";
import { notesDePage, surlignage } from "./ecoute-page.js";
import { expliquer } from "./erreurs.js";
import { $, echapper, el, pluriel, toast } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

function bouton(classe, html, surClic, libelle) {
  const b = el("button", classe);
  b.type = "button";
  b.innerHTML = html;
  if (libelle) b.setAttribute("aria-label", libelle);
  b.addEventListener("click", surClic);
  return b;
}

// ------------------------------------------------------------------------
// L'écran
// ------------------------------------------------------------------------

/**
 * Corriger ↔ Écouter : un seul jeu de boutons (déjà câblés), rangé sous la
 * barre de l'écran ouvert. Le déplacer fait perdre le focus au clavier : on le rend.
 */
export function placerOnglets(idSection) {
  const onglets = $("onglets-partition");
  const barre = $(idSection).querySelector(".barre-ecran");
  if (!onglets || !barre || onglets.parentElement === barre) return;
  const avait = onglets.contains(document.activeElement) ? document.activeElement.id : null;
  barre.appendChild(onglets);
  if (avait) $(avait).focus({ preventScroll: true });
}

/** L'état d'une partition dans sa barre : « Prête », ou le nombre de doutes qui restent. */
export function pastilleBarre(p) {
  const restants = (p.doutes || []).filter((d) => !d.leve).length;
  if (p.statut === "prete") return el("span", "pastille p-ok", "Prête");
  return el("span", "pastille p-doute", restants ? pluriel(restants, "doute") : "À relire");
}

/**
 * Un message passager qui propose un geste (« Relire »), comme celui d'une
 * mise à jour (mises-a-jour.js, `.toast-action`) : seul son bouton prend le
 * toucher, et il part seul au bout de `duree`. Ce n'est pas une question qui
 * arrête tout : on peut l'ignorer.
 */
export function proposerGeste(texte, libelle, geste, duree = 12000) {
  $("toast-geste")?.remove();
  const m = el("div", "toast toast-action");
  m.id = "toast-geste";
  m.setAttribute("role", "status");
  m.setAttribute("popover", "manual");
  const b = el("button", "btn btn-petit", libelle);
  b.type = "button";
  b.addEventListener("click", () => { m.remove(); geste(); });
  m.append(el("span", "", texte), b);
  document.body.appendChild(m);
  // En « popover », comme les autres messages : au-dessus d'une feuille ouverte.
  if (m.showPopover) { try { m.showPopover(); } catch { /* sans popover : il s'affiche quand même */ } }
  setTimeout(() => m.remove(), duree);
}

/** Le panneau du bas est fixé : l'écran lui laisse sa hauteur, mesurée, pour que rien ne passe dessous. */
export function suivreDock(section, dock) {
  if (!("ResizeObserver" in window)) { section.style.setProperty("--dock-h", "340px"); return; }
  new ResizeObserver(() => section.style.setProperty("--dock-h", `${dock.offsetHeight}px`)).observe(dock);
}

// ------------------------------------------------------------------------
// Ta page, la partition lue, ou les deux
// ------------------------------------------------------------------------

const VUES = ["page", "lue", "deux"];

/** Le choix de cet appareil ; à défaut, les deux côte à côte si l'écran est large, ta page seule sinon. */
export function vueAtelierChoisie() {
  const v = lirePref("portee:atelier-vue");
  if (VUES.includes(v)) return v;
  return window.matchMedia("(min-width: 900px)").matches ? "deux" : "page";
}

/** Montre la vue, et la retient pour la prochaine fois si `retenir`. */
export function afficherVueAtelier(v = vueAtelierChoisie(), retenir = false) {
  if (retenir) ecrirePref("portee:atelier-vue", v);
  $("zones-atelier").dataset.vue = v;
  $("vues-atelier").querySelectorAll("[data-vue]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.vue === v)));
  return v;
}

// ------------------------------------------------------------------------
// Les repères de doute sur la page
// ------------------------------------------------------------------------

/**
 * Un cadre et un numéro sur chaque doute de la page affichée (bleu ; vert
 * pointillé une fois réglé). Ce sont de vrais boutons posés sur le <svg> en
 * pourcentages de sa fenêtre : ils suivent la taille de la page, et gardent
 * 44 px de toucher même pour un petit trait.
 */
export function dessinerReperes(zone, svg, cal, doutes, page, actif, surChoix) {
  zone.textContent = "";
  const vb = svg.viewBox.baseVal;
  if (!vb || !vb.width) return;
  doutes.forEach((d, i) => {
    if ((d.page || 1) !== page || !d.boite) return;
    const c = cadreDoute(cal, d.boite);
    const b = el("button", "repere" + (d.leve ? " fait" : "") + (i === actif ? " actif" : ""));
    b.type = "button";
    b.style.left = `${((c.x + c.largeur / 2 - vb.x) / vb.width) * 100}%`;
    b.style.top = `${((c.y + c.hauteur / 2 - vb.y) / vb.height) * 100}%`;
    b.style.width = `${(c.largeur / vb.width) * 100}%`;
    b.style.height = `${(c.hauteur / vb.height) * 100}%`;
    b.setAttribute("aria-label", `Doute ${i + 1}${d.leve ? " (réglé)" : ""}`);
    if (i === actif) b.setAttribute("aria-current", "true");
    const n = el("span", "numero", String(i + 1));
    n.setAttribute("aria-hidden", "true");
    b.appendChild(n);
    b.addEventListener("click", () => surChoix(i));
    zone.appendChild(b);
  });
}

// ------------------------------------------------------------------------
// Le panneau du bas : un doute à la fois
// ------------------------------------------------------------------------

/** « Doute 1 sur 2 » et les points d'avancement (un toucher sur un point ouvre ce doute). */
export function dessinerPas(doutes, actif, surChoix, enMain = false) {
  const ouverts = doutes.filter((d) => !d.leve).length;
  $("dock-titre").textContent = actif >= 0 ? `Doute ${actif + 1} sur ${doutes.length}${enMain ? " · à la main" : ""}`
    : doutes.length ? pluriel(doutes.length, "doute réglé", "doutes réglés") : "Relecture";
  const pas = $("pas-doutes");
  pas.textContent = "";
  if (doutes.length < 2) return;
  doutes.forEach((d, i) => {
    const b = el("button", "pas-doute" + (d.leve ? " fait" : ""));
    b.type = "button";
    b.setAttribute("aria-label", `Doute ${i + 1} sur ${doutes.length}${d.leve ? ", réglé" : ""}`);
    if (i === actif) b.setAttribute("aria-current", "step");
    b.addEventListener("click", () => surChoix(i));
    pas.appendChild(b);
  });
  pas.title = `${ouverts} à régler`;
}

/**
 * La carte d'un doute : la loupe sur le passage, la question, les réponses.
 * @param o { doute, question (doutes.poser), cal, traits, surReponse(r), surRouvrir, surMoiMeme, surVoulu }
 */
export function dessinerCarteDoute(zone, o) {
  const { doute, question, cal, traits } = o;
  zone.textContent = "";
  const carte = el("div", "doute-carte");
  zone.appendChild(carte);
  if (doute.boite && cal) {
    const loupe = el("div", "loupe");
    loupe.setAttribute("role", "img");
    loupe.setAttribute("aria-label", "Le passage en question, agrandi");
    const svg = document.createElementNS(NS, "svg");
    loupe.appendChild(svg);
    carte.appendChild(loupe);
    const rapport = loupe.clientWidth && loupe.clientHeight ? loupe.clientWidth / loupe.clientHeight : 3.6;
    dessinerPage(svg, cal, traits, { vue: fenetreLoupe(cal, doute.boite, rapport), doutes: [{ boite: doute.boite, leve: doute.leve }], actif: 0 });
  }
  const texte = el("div", "doute-texte");
  texte.append(el("h2", "doute-question", question.titre), el("p", "doute-detail", question.detail));
  carte.appendChild(texte);
  // L'avis que Claude a rangé depuis une conversation (H3, suggestions.js) :
  // une phrase, montrée comme la sienne, jamais appliquée seule.
  const avisRange = doute.avis && typeof doute.avis.texte === "string" ? doute.avis.texte.trim() : "";
  if (avisRange) {
    const bloc = el("div", "avis-claude");
    bloc.append(el("span", "surtitre", "Claude"), el("p", "", avisRange));
    texte.appendChild(bloc);
  }

  if (doute.leve) {
    const etat = el("div", "doute-etat");
    etat.append(el("span", "pastille p-ok", "Réglé"));
    if (doute.reponse) etat.append(el("span", "remarque", `Ta réponse : ${doute.reponse}`));
    texte.appendChild(etat);
    const reponses = el("div", "reponses");
    reponses.appendChild(bouton("reponse rouvrir", `${ico("annuler", "s")}Rouvrir ce doute`, o.surRouvrir));
    carte.appendChild(reponses);
    return;
  }

  const reponses = el("div", "reponses");
  for (const r of question.reponses) {
    // Le texte d'une réponse peut venir de la fiche (une proposition, un chiffrage) : échappé (S1).
    const b = bouton("reponse", `${ico(r.icone)}<span>${echapper(r.texte)}</span>`, () => o.surReponse(r));
    b.dataset.reponse = r.id;
    reponses.appendChild(b);
  }
  if (question.reponses.length) carte.appendChild(reponses);
  const aide = el("div", "doute-aide");
  if (question.manuel) aide.appendChild(bouton("btn btn-fantome", "Je corrige moi-même", o.surMoiMeme));
  if (question.voulu) aide.appendChild(bouton("btn btn-fantome", "C'est voulu, laisser", o.surVoulu));
  if (aide.children.length) carte.appendChild(aide);
}

/** « Je corrige moi-même » : on touche la note dans la partition lue ; en attendant, une consigne. */
export function dessinerConsigne(zone, texte) {
  zone.textContent = "";
  zone.appendChild(el("p", "doute-detail", texte));
}

/** Plus aucun doute ouvert : « Tout est relu », ou « Rien de douteux » si Portée n'avait rien vu. */
export function dessinerRelu(zone, { aucun, surRevoir, surValider }) {
  zone.textContent = "";
  const bloc = el("div", "relu");
  const tete = el("div", "relu-tete");
  const rond = el("span", "rond-ok");
  rond.innerHTML = ico("ok", "l");
  const texte = el("div", "relu-texte");
  texte.append(
    el("h2", "", aucun ? "Rien de douteux" : "Tout est relu"),
    el("p", "", "Écoute pour vérifier, exporte, ou retouche une note en la touchant sur la partition lue."),
  );
  tete.append(rond, texte);
  bloc.appendChild(tete);
  const reponses = el("div", "reponses");
  if (!aucun) reponses.appendChild(bouton("reponse rouvrir", `${ico("annuler", "s")}Revoir`, surRevoir));
  const valider = bouton("btn btn-plein reponse", `${ico("ecouter")}<span>C'est bon : écouter et exporter</span>`, surValider);
  valider.id = "valider";
  reponses.appendChild(valider);
  bloc.appendChild(reponses);
  zone.appendChild(bloc);
}

// ------------------------------------------------------------------------
// Faire entendre la page (les deux écrans)
// ------------------------------------------------------------------------

// Pour la gravure seulement : la dernière ligne s'étire sur toute la largeur,
// sinon une pièce d'une mesure s'affiche minuscule. abcjs compte ses
// positions (startChar) dans ce texte-là : on retranche le préfixe.
export const PREFIXE_GRAVURE = "%%stretchlast 1\n";
export const pourGravure = (abc) => PREFIXE_GRAVURE + abc;

// Ce qu'abcjs reproche, en mots d'Adrien (du plus précis au plus général).
const RAISONS_ABC = [
  [/Unknown character/i, "un caractère que la gravure ne connaît pas, ignoré"],
  [/to end the chord/i, "un accord qui n'est pas fermé (il manque « ] »)"],
  [/Spaces are not allowed in chords/i, "une espace dans un accord"],
  [/nest triplets/i, "un triolet dans un triolet"],
  [/triplet/i, "un triolet mal écrit"],
  [/decoration/i, "une décoration inconnue"],
  [/bar type/i, "une barre de mesure inconnue"],
  [/key signature/i, "une armure que la gravure ne connaît pas"],
];
const ENTITES_ABC = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Ce qu'abcjs reproche au texte ABC (le mode avancé), en français. abcjs le
 * dit en anglais et en HTML (« Music Line:7:18: Unknown character ignored:
 * … <span …>h</span>… ») : l'avertissement s'affichait tel quel (défaut
 * signalé par le lot architecture, I13). On garde où (la ligne du texte que
 * tu vois : la gravure en a une de plus en tête, PREFIXE_GRAVURE) et le
 * caractère en cause ; le détail reste dans la console.
 * @param {string} brut  un avertissement d'abcjs
 * @param {number} [autres]  combien d'autres avertissements suivent
 */
export function avertissementAbc(brut, autres = 0) {
  const texte = String(brut || "");
  const place = /^Music Line:(\d+):(\d+):/.exec(texte);
  const fautif = /<span[^>]*>([^<]*)<\/span>/.exec(texte);
  const raison = (RAISONS_ABC.find(([motif]) => motif.test(texte)) || [null, "un passage que la gravure ne comprend pas"])[1];
  const caractere = fautif && fautif[1] && fautif[1] !== "SPACE" ? fautif[1].replace(/&(amp|lt|gt|quot|#39);/g, (e) => ENTITES_ABC[e]) : "";
  const lignes = PREFIXE_GRAVURE.split("\n").length - 1;
  const ou = place ? `Ligne ${Math.max(1, Number(place[1]) - lignes)}, ${Number(place[2])}ᵉ caractère${caractere ? ` (« ${caractere} »)` : ""} : ` : "";
  const suite = autres > 0 ? ` Et ${autres === 1 ? "un autre endroit" : `${autres} autres endroits`}.` : "";
  return `${ou || "Quelque part : "}${raison}.${suite}`;
}

/** Tempo en noires par minute, d'après la partition gravée. */
export function tempoInitial(objet) {
  try {
    const f = objet.getMeterFraction();
    const noires = (f.num / f.den) * 4;
    const ms = objet.millisecondsPerMeasure();
    if (noires > 0 && ms > 0) return Math.round((60000 * noires) / ms);
  } catch { /* chiffrage libre : valeur par défaut */ }
  return 90;
}

/** Le bouton d'écoute d'une partition : « Écouter » ou « Arrêter », avec son icône. */
export function libelleLecture(bouton, joue) {
  bouton.innerHTML = joue ? `${ico("stop", "s")}Arrêter` : `${ico("lire", "s")}Écouter`;
}

/**
 * Écoute une page lue, depuis « Corriger » ou « Écouter » : ses notes passent
 * par le transport, sur l'horloge du son (ecoute-page.js, audit du 04/10,
 * M5) ; abcjs ne sert plus qu'à surligner ce qui joue. Une seule écoute pour
 * les deux écrans (`ecoute`, ecoute.js) : le même bouton arrête, l'autre
 * remplace ; arrêtée pendant que le piano se charge, elle ne part pas.
 * @param {{ ecoute: any, abcjs: () => any }} deps
 */
export function creerEcoutePage({ ecoute, abcjs }) {
  return async function ecouter({ objet, abc, bouton, qpm, transposition = 0, voixMuettes = new Set(), titre = "" }) {
    if (ecoute.cle === bouton) { ecoute.arreter(); return; }
    if (!objet) { ecoute.arreter(); return; }
    const { source } = notesDePage(objet, pourGravure(abc), { tempo: qpm, transposition, voixMuettes });
    const lumiere = surlignage(abcjs(), objet, qpm);
    bouton.textContent = "Chargement du piano…";
    try {
      await ecoute.jouer(bouton, source, {
        titre: titre || "Partition",
        relancer: () => { if (ecoute.cle === null) bouton.click(); },
        surPosition: (pas) => lumiere.surligner(pas),
        surDepart: () => libelleLecture(bouton, true),
        surArret: () => { lumiere.eteindre(); libelleLecture(bouton, false); },
      });
    } catch (e) {
      console.error(e);
      toast(expliquer(e, "Le piano n'a pas pu se charger."));
    }
  };
}
