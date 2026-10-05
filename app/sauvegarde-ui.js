/**
 * LA SAUVEGARDE DE LA BIBLIOTHÈQUE, ET CE QUI LA GARDE SUR CET APPAREIL
 *
 * Les Réglages, « Sauvegarde » : toute la bibliothèque (traits et mémos
 * compris) dans un .json, qui passe d'un appareil à l'autre, et de claude.ai
 * au site. Ce que la restauration a fait se dit en une phrase
 * (`bilanRestauration`, essayée sous Node), avec le mot juste : une idée
 * n'est pas une partition (audit de l'interface, B12).
 *
 * Et « L'appli » : si le navigateur a promis de garder la bibliothèque, la
 * place qu'elle prend, comment installer Portée quand c'est ce qui la
 * protège, la date de la dernière sauvegarde, et un rappel discret au-delà
 * de 30 jours quand rien d'autre ne la copie ailleurs (audit du 04/10, D9 ;
 * les textes sont dans garde.js).
 */
import { demanderProtection, etatStockage, restaurer, sauvegarde } from "./stockage.js";
import { accordeA, CLE_DERNIERE_SAUVEGARDE, compteParSorte, garde, rappelSauvegarde, sorteDe } from "./garde.js";
import { echec, expliquer } from "./erreurs.js";
import { ecrirePref, lirePref } from "./preferences.js";
import { ico } from "./icones.js";
import { $, el, pluriel, toast } from "./ui.js";

/**
 * Ce qui est revenu, par sorte, d'après la sauvegarde : ce qui n'était pas
 * déjà là et n'a pas échoué. Si le compte ne tombe pas juste (un identifiant
 * en double dans le fichier, une liste en retard sur le stockage), null : le
 * bilan dira « éléments », sans se tromper de sorte.
 * @param {any} contenu  la sauvegarde lue
 * @param {Set<string>} dejaLa  les identifiants déjà dans la bibliothèque
 * @param {{ revenues: number, echecs: { id?: string }[] }} bilan  ce que rend restaurer()
 */
export function sortesRevenues(contenu, dejaLa, bilan) {
  const echouees = new Set((bilan.echecs || []).map((x) => x.id));
  const vues = new Set();
  const sortes = { idee: 0, morceau: 0, partition: 0 };
  for (const e of Array.isArray(contenu && contenu.partitions) ? contenu.partitions : []) {
    if (!e || typeof e.id !== "string" || !e.id || dejaLa.has(e.id) || echouees.has(e.id) || vues.has(e.id)) continue;
    vues.add(e.id);
    sortes[sorteDe(e.donnees)]++;
  }
  return sortes.idee + sortes.morceau + sortes.partition === bilan.revenues ? sortes : null;
}

/**
 * Ce que la restauration a fait, en une phrase : combien sont revenues
 * (même supprimées ailleurs depuis), combien étaient déjà là (gardées telles
 * quelles), et lesquelles n'ont pas pu revenir, avec la raison. `sortes` :
 * ce qui est revenu, par sorte (sortesRevenues) ; sans lui, des « éléments ».
 * `gabarits` : les exemples de ton écriture (L16) que la sauvegarde a appris
 * en plus à cette bibliothèque ; sans les dire, une sauvegarde qui n'apporte
 * qu'eux se disait « vide ».
 */
export function bilanRestauration({ revenues = 0, ignorees = 0, differentes = 0, echecs = [], sortes = null, gabarits = 0 }) {
  const appris = gabarits > 0 ? pluriel(gabarits, "exemple de ton écriture appris", "exemples de ton écriture appris") : "";
  if (!revenues && !echecs.length) {
    if (appris) return `${appris}${ignorees ? ` · ${ignorees} déjà là` : ""}.`;
    return ignorees ? "Rien à restaurer : tout est déjà dans ta bibliothèque." : "Cette sauvegarde est vide.";
  }
  const morceaux = [];
  if (revenues) {
    const compte = sortes ? compteParSorte(sortes) : null;
    morceaux.push(compte && compte.total === revenues ? `${compte.texte} ${accordeA(compte, "revenu")}` : pluriel(revenues, "élément revenu", "éléments revenus"));
  }
  if (ignorees) {
    const changees = differentes ? ` (dont ${pluriel(differentes, "modifié depuis, gardé tel quel", "modifiés depuis, gardés tels quels")})` : "";
    morceaux.push(`${ignorees} déjà là${changees}`);
  }
  if (echecs.length) {
    const lesquelles = echecs.slice(0, 3).map((x) => `« ${x.titre} » (${x.raison})`).join(", ") + (echecs.length > 3 ? "…" : "");
    morceaux.push(`${pluriel(echecs.length, "n'a pas pu revenir", "n'ont pas pu revenir")} : ${lesquelles}`);
  }
  if (appris) morceaux.push(appris);
  return morceaux.join(" · ") + ".";
}

/** « 2 idées et 3 partitions sauvegardées. » */
export function messageSauvegarde(partitions) {
  const sortes = { idee: 0, morceau: 0, partition: 0 };
  for (const p of partitions) sortes[sorteDe(p)]++;
  const compte = compteParSorte(sortes);
  return compte.total ? `${compte.texte} ${accordeA(compte, "sauvegardé")}.` : "Sauvegarde faite.";
}

/** « le 3 oct. » : le jour d'une date, sans l'heure. */
const jour = (iso) => `le ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : "numeric" })}`;

/**
 * @param deps {
 *   stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   dansClaude(), synchronisee() → la synchronisation est branchée,
 *   apresSauvegarde() (l'état du haut, qui peut porter le rappel, se redessine)
 * }
 */
export function brancherSauvegarde({ stockage, partitions, dansClaude = () => false, synchronisee = () => false, apresSauvegarde = () => {} }) {
  async function sauvegarder() {
    try {
      const contenu = await sauvegarde(stockage(), partitions());
      const jourIso = new Date().toISOString().slice(0, 10);
      await stockage().enregistrerFichier(`Portée - sauvegarde ${jourIso}.json`, new Blob([JSON.stringify(contenu)], { type: "application/json" }));
      // La date de la sauvegarde : le rappel des Réglages part d'elle.
      ecrirePref(CLE_DERNIERE_SAUVEGARDE, new Date().toISOString());
      toast(messageSauvegarde(partitions()));
      afficher();
      apresSauvegarde();
    } catch (e) {
      if (e && e.code === "declined") return;
      console.error(e);
      toast(echec("La sauvegarde", e));
    }
  }

  async function restaurerFichier(fichier) {
    try {
      const contenu = JSON.parse(await fichier.text());
      const dejaLa = new Set(partitions().map((p) => p.id));
      const bilan = await restaurer(stockage(), contenu, dejaLa);
      toast(bilanRestauration({ ...bilan, sortes: sortesRevenues(contenu, dejaLa, bilan) }), bilan.echecs.length ? 10000 : 5000);
    } catch (e) {
      console.error(e);
      toast(e instanceof SyntaxError ? "Ce fichier n'est pas une sauvegarde de Portée." : expliquer(e, "La restauration n'a pas abouti."), 7000);
    }
  }

  /** La plus ancienne partition : sans sauvegarde, le rappel compte depuis elle. */
  const plusAncienne = () => partitions().reduce((min, p) => (p.creeLe && (!min || p.creeLe < min) ? p.creeLe : min), null);

  /** La dernière sauvegarde, et le rappel quand il le faut. */
  function afficherSauvegarde() {
    const derniere = lirePref(CLE_DERNIERE_SAUVEGARDE);
    const date = derniere && Number.isFinite(Date.parse(derniere)) ? derniere : null;
    $("derniere-sauvegarde").textContent = date ? jour(date) : "Jamais";
    const surClaude = dansClaude() || (!!stockage() && stockage().mode === "claude");
    // « Jamais » ne se dit que si on sait le retenir : la page claude.ai peut refuser le stockage local.
    $("derniere-sauvegarde-ligne").hidden = !date && (partitions().length === 0 || surClaude);
    const rappel = rappelSauvegarde({ derniere: date, plusAncienne: plusAncienne(), synchronisee: synchronisee(), surClaude });
    const r = $("rappel-sauvegarde");
    r.hidden = !rappel;
    if (rappel) { r.innerHTML = ico("attention", "s"); r.appendChild(el("span", "", rappel)); }
  }

  let demande = 0;
  /** Ce qui garde la bibliothèque de ce navigateur (sur claude.ai, c'est claude.ai qui la garde : rien à dire). */
  async function afficherGarde() {
    const ici = !!stockage() && stockage().mode !== "claude" && !dansClaude();
    for (const id of ["garde-ligne", "garde-place-ligne"]) $(id).hidden = !ici;
    if (!ici) { for (const id of ["garde-proteger", "garde-conseil", "garde-guide"]) $(id).hidden = true; return; }
    const n = ++demande;
    const etat = await etatStockage().catch(() => null);
    if (n !== demande) return; // une autre demande est partie entre-temps
    const g = garde(etat, { synchronisee: synchronisee() });
    $("garde-protegee").textContent = g.protegee;
    $("garde-place").textContent = g.place || "On ne sait pas";
    $("garde-proteger").hidden = !g.proteger;
    $("garde-conseil").textContent = g.conseil || "";
    $("garde-conseil").hidden = !g.conseil;
    const zone = $("garde-guide");
    zone.hidden = !g.guide;
    zone.textContent = "";
    if (!g.guide) return;
    const titre = el("p", "guide-titre");
    titre.innerHTML = ico("attention", "s");
    titre.appendChild(el("span", "", g.guide.titre));
    const etapes = el("ol");
    for (const t of g.guide.etapes) etapes.appendChild(el("li", "", t));
    zone.append(titre, el("p", "", g.guide.pourquoi), etapes, el("p", "remarque", g.guide.apres));
  }

  /** Les Réglages se montrent, ou la bibliothèque vient de s'ouvrir : tout se relit. */
  function afficher() {
    if (!stockage()) return;
    afficherSauvegarde();
    afficherGarde();
  }

  async function proteger() {
    const oui = await demanderProtection();
    toast(oui === true ? "Le navigateur gardera ta bibliothèque."
      : oui === false ? "Le navigateur n'a pas voulu le promettre : installe Portée sur cet appareil, ou sauvegarde ta bibliothèque de temps en temps."
        : "Ce navigateur ne sait pas le promettre : sauvegarde ta bibliothèque de temps en temps.", 7000);
    afficherGarde();
  }

  $("sauvegarder").addEventListener("click", sauvegarder);
  $("restaurer").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restaurerFichier(f); });
  $("garde-proteger").addEventListener("click", proteger);
  return {
    afficher,
    /** Le rappel de sauvegarde (null : pas de rappel), pour l'état du haut. */
    rappel: () => (stockage() ? rappelSauvegarde({ derniere: lirePref(CLE_DERNIERE_SAUVEGARDE), plusAncienne: plusAncienne(), synchronisee: synchronisee(), surClaude: dansClaude() || stockage().mode === "claude" }) : null),
  };
}
