/**
 * LES AUTRES VERSIONS D'UNE PARTITION, VUES DE L'APPLI
 *
 * Trois écrans pour ce que la bibliothèque commune garde (le site
 * synchronisé seulement : sans connecteur, ou sur claude.ai, rien de tout
 * cela n'apparaît) et pour ce que la synchronisation range à côté :
 *   - la copie de conflit (D4) : garder celle-ci, les deux, ou l'autre,
 *     depuis son « ••• » (la logique est dans conflits.js) ;
 *   - les versions précédentes d'une partition, d'une idée ou d'un morceau
 *     (D6) : leur date, ce que chacune a changé quand c'est simple
 *     (versions.js), et « Récupérer cette version » ;
 *   - la corbeille (D6, Réglages) : ce qui a été supprimé ces 30 derniers
 *     jours, et « Récupérer ».
 * Une version ou une partition récupérée s'écrit comme une modification
 * neuve (synchro.js) : celle d'aujourd'hui devient une version précédente à
 * son tour, et tout part vers les autres appareils.
 *
 * Les deux feuilles du bas sont posées à la racine de la page : l'éditeur
 * d'idée, qui cache l'accueil, ouvre aussi celle des versions. Les questions
 * passent par dialogue.js, les erreurs par erreurs.js.
 */
import { MARQUE_CONFLIT, trancher } from "./conflits.js";
import { accordeSorte, nomDeSorte, resteDansLaCorbeille, resumeChangement } from "./versions.js";
import { confirmer } from "./dialogue.js";
import { explication } from "./erreurs.js";
import { brancherFeuille, fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { ico } from "./icones.js";
import { $, dateCourte, el, toast } from "./ui.js";

// Les versions d'une partition se lisent quelques-unes à la fois : vingt d'un coup chargeraient le connecteur pour rien.
const EN_PARALLELE = 4;

/** « le 3 oct. » */
const jour = (iso) => `le ${new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}`;

/**
 * @param deps {
 *   stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   synchro() → la synchronisation (synchro.js), ou null sans elle,
 *   apresRecuperation(id) (la partition ouverte, si c'est elle, se reprend)
 * }
 */
export function creerVersions(deps) {
  const synchro = () => (deps.synchro ? deps.synchro() : null);
  /** Ce qui part va à la corbeille (30 jours) avec la synchronisation ; sans elle, pour de bon. */
  const ouVa = () => (synchro() ? "à la corbeille : tu pourras la récupérer pendant 30 jours (Réglages, Corbeille)" : "pour de bon");

  // ---------------------------------------------------------------------------
  // La copie de conflit (D4)
  // ---------------------------------------------------------------------------

  /** L'autre version d'une copie de conflit, si elle est encore là. */
  const autreDe = (copie) => deps.partitions().find((x) => x.id === copie.conflitDe) || null;

  /**
   * Trancher entre une copie de conflit et l'autre version. « Garder
   * celle-ci » et « Garder l'autre » font partir une version : on demande ;
   * « Garder les deux » ne défait rien, on le fait tout de suite.
   * @param {"celle-ci" | "les-deux" | "l-autre"} choix
   */
  async function trancherConflit(choix, copie) {
    const autre = autreDe(copie);
    const titre = copie.titre.endsWith(MARQUE_CONFLIT) ? copie.titre.slice(0, -MARQUE_CONFLIT.length) : copie.titre;
    if (choix === "celle-ci") {
      const texte = autre ? `Elle remplace l'autre version, qui part ${ouVa()}.` : "L'autre version n'est plus là : celle-ci reste, sans la marque.";
      if (!(await confirmer({ titre: `Garder cette version de « ${titre} » ?`, texte, oui: "Garder celle-ci", danger: false }))) return;
    } else if (choix === "l-autre") {
      if (!(await confirmer({ titre: `Garder l'autre version de « ${titre} » ?`, texte: `Celle-ci part ${ouVa()}.`, oui: "Garder l'autre", danger: false }))) return;
    }
    try {
      await trancher(choix, copie, deps.stockage());
    } catch (e) {
      console.error(e);
      toast(`Rien n'a changé : ${explication(e)}`, 7000);
      return;
    }
    toast(choix === "les-deux" ? `Les deux versions de « ${titre} » restent.`
      : choix === "celle-ci" ? `« ${titre} » : cette version est gardée.`
        : `« ${titre} » : l'autre version est gardée.`);
  }

  // ---------------------------------------------------------------------------
  // Les feuilles du bas, posées une fois à la racine de la page
  // ---------------------------------------------------------------------------

  /** Une feuille du bas : son titre, une phrase, sa liste ; `surFermer` à chaque fermeture. */
  function feuille(id, titre, surFermer) {
    const d = el("dialog", "feuille-bas feuille-versions");
    d.id = id;
    d.setAttribute("aria-labelledby", `${id}-titre`);
    const tete = el("div", "feuille-tete");
    const h = el("h2", "", titre);
    h.id = `${id}-titre`;
    const fermer = el("button", "btn rond btn-fantome");
    fermer.type = "button";
    fermer.setAttribute("aria-label", "Fermer");
    fermer.innerHTML = ico("fermer");
    fermer.addEventListener("click", () => fermerFeuille(d));
    tete.append(h, fermer);
    const sous = el("p", "remarque versions-sous");
    const liste = el("div", "versions-liste");
    liste.setAttribute("aria-live", "polite");
    d.append(tete, sous, liste);
    document.body.appendChild(d);
    brancherFeuille(d, { surFermer });
    return { d, sous, liste };
  }

  /** Une phrase à la place de la liste (on demande, c'est vide, ça n'a pas marché). */
  function dire(f, texte) {
    f.liste.textContent = "";
    f.liste.appendChild(el("p", "versions-vide", texte));
  }

  /** Une ligne : un titre, une phrase, et son bouton (ou rien). */
  function ligne(titre, phrase, bouton = null) {
    const l = el("div", "version");
    const texte = el("div", "version-texte");
    texte.append(el("span", "version-titre", titre), el("span", "version-resume", phrase));
    l.appendChild(texte);
    if (bouton) l.appendChild(bouton);
    return l;
  }

  function boutonRecuperer(texte, etiquette) {
    const b = el("button", "btn btn-petit");
    b.type = "button";
    b.innerHTML = `${ico("historique", "s")}${texte}`;
    if (etiquette) b.setAttribute("aria-label", etiquette);
    return b;
  }

  // ---------------------------------------------------------------------------
  // Les versions précédentes (D6)
  // ---------------------------------------------------------------------------

  let fv = null;
  let demande = 0; // chaque ouverture a son numéro : ce qui arrive pour une ouverture d'avant ne s'affiche pas
  const feuilleVersions = () => (fv ??= feuille("feuille-versions", "Versions précédentes", () => { demande++; }));

  /**
   * Les versions d'une partition, la plus récente d'abord. La liste vient
   * tout de suite ; ce que chacune a changé arrive ensuite, quelques
   * versions à la fois (il faut lire chacune).
   */
  async function ouvrirVersions(p) {
    const s = synchro();
    if (!s || !p) return;
    const f = feuilleVersions();
    const moi = ++demande;
    f.sous.textContent = `« ${p.titre} » : la bibliothèque commune garde chaque version 30 jours (20 au plus).`;
    dire(f, "Je demande ses versions à la bibliothèque commune…");
    ouvrirFeuille(f.d);
    let versions;
    try {
      // Ce qui attend part d'abord : la liste est à jour, et une version récupérée part de la dernière.
      await s.synchroniser().catch(() => {});
      versions = await s.versions(p.id);
    } catch (e) {
      console.error(e);
      if (moi === demande) dire(f, `Les versions ne sont pas venues : ${explication(e)}`);
      return;
    }
    if (moi !== demande) return;
    if (!versions.length) { dire(f, "Elle n'est pas encore dans la bibliothèque commune : sa première version y partira à la prochaine synchronisation."); return; }
    if (versions.length === 1) { dire(f, "Pas encore de version précédente : la bibliothèque commune en garde une à chaque changement."); return; }
    f.liste.replaceChildren();
    // Deux versions dans la même minute (des gestes rapprochés) : les secondes les distinguent.
    const courtes = versions.map((v) => dateCourte(v.modifieLe));
    const quandDe = (v, i) => (courtes.filter((c) => c === courtes[i]).length < 2 ? courtes[i]
      : `${courtes[i].split(", ")[0]}, ${new Date(v.modifieLe).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
    const lignes = versions.map((v, i) => {
      const quand = quandDe(v, i);
      const bouton = v.actuelle ? null : boutonRecuperer("Récupérer cette version", `Récupérer la version du ${quand}`);
      const l = ligne(v.actuelle ? "Maintenant" : quand, "…", bouton);
      if (bouton) bouton.addEventListener("click", () => recupererVersion(p, v, bouton, quand));
      f.liste.appendChild(l);
      return { v, l, bouton };
    });
    // Le contenu de chaque version, au fil des lectures (null : plus gardée).
    const contenus = new Map();
    // Ce que chacune a changé : il faut la version et celle d'avant. Lues quelques-unes à la fois.
    const resume = (i) => {
      const x = lignes[i];
      if (!contenus.has(i)) return;
      const contenu = contenus.get(i);
      const phrase = x.l.querySelector(".version-resume");
      if (contenu === null || contenu.supprime) {
        phrase.textContent = contenu === null ? "Plus gardée." : "Supprimée ce jour-là.";
        if (x.bouton) x.bouton.remove();
        return;
      }
      if (i + 1 >= lignes.length) { phrase.textContent = "La plus ancienne gardée."; return; }
      if (!contenus.has(i + 1)) return;
      const avant = contenus.get(i + 1);
      phrase.textContent = resumeChangement(avant && !avant.supprime ? avant.donnees : null, contenu.donnees) || (avant ? "Rien qui se voie." : "");
    };
    let suivante = 0;
    await Promise.all(Array.from({ length: Math.min(EN_PARALLELE, lignes.length) }, async () => {
      while (suivante < lignes.length) {
        const i = suivante++;
        const v = lignes[i].v;
        const contenu = await s.version(p.id, v.modifieLe, Number.isInteger(v.rev) ? v.rev : null).catch(() => null);
        if (moi !== demande) return;
        contenus.set(i, contenu);
        resume(i);
        if (i > 0) resume(i - 1);
      }
    }));
  }

  async function recupererVersion(p, v, bouton, quand = dateCourte(v.modifieLe)) {
    const s = synchro();
    if (!s) return;
    const oui = await confirmer({
      titre: `Revenir à la version du ${quand} ?`,
      texte: "Celle que tu as maintenant reste dans les versions précédentes : tu pourras y revenir.",
      oui: "Récupérer cette version", danger: false,
    });
    if (!oui) return;
    bouton.disabled = true;
    try {
      await s.recupererVersion(p.id, v.modifieLe, Number.isInteger(v.rev) ? v.rev : null);
    } catch (e) {
      console.error(e);
      bouton.disabled = false;
      toast(`La version du ${quand} n'est pas revenue : ${explication(e)}`, 7000);
      return;
    }
    fermerFeuille(feuilleVersions().d);
    toast(`« ${p.titre} » : la version du ${quand} est revenue.`);
    if (deps.apresRecuperation) await deps.apresRecuperation(p.id);
  }

  // ---------------------------------------------------------------------------
  // La corbeille (D6)
  // ---------------------------------------------------------------------------

  let fc = null;
  let demandeCorbeille = 0;
  const feuilleCorbeille = () => (fc ??= feuille("feuille-corbeille", "Corbeille", () => { demandeCorbeille++; }));

  async function ouvrirCorbeille() {
    const s = synchro();
    if (!s) return;
    const f = feuilleCorbeille();
    const moi = ++demandeCorbeille;
    f.sous.textContent = "Ce que tu as supprimé ces 30 derniers jours. Récupéré, il revient sur tous tes appareils.";
    dire(f, "Je regarde dans la corbeille de la bibliothèque commune…");
    ouvrirFeuille(f.d);
    let entrees;
    try {
      entrees = await s.corbeille();
    } catch (e) {
      console.error(e);
      if (moi === demandeCorbeille) dire(f, `La corbeille ne s'ouvre pas : ${explication(e)}`);
      return;
    }
    if (moi !== demandeCorbeille) return;
    // Déjà revenue ici (récupérée, pas encore partie) : on ne la propose plus.
    const ici = new Set(deps.partitions().map((x) => x.id));
    const restantes = entrees.filter((x) => !ici.has(x.id));
    if (!restantes.length) { dire(f, "La corbeille est vide."); return; }
    f.liste.replaceChildren();
    for (const x of restantes) {
      const titre = typeof x.titre === "string" && x.titre ? x.titre : "Sans titre";
      const bouton = boutonRecuperer("Récupérer", `Récupérer « ${titre} »`);
      const l = ligne(titre, `${nomDeSorte(x.type)} · ${accordeSorte(x.type, "supprimé")} ${jour(x.supprimeLe)} · ${resteDansLaCorbeille(x.expireLe)}`, bouton);
      bouton.addEventListener("click", () => recupererSupprimee({ ...x, titre }, bouton, l, f));
      f.liste.appendChild(l);
    }
  }

  async function recupererSupprimee(x, bouton, l, f) {
    const s = synchro();
    if (!s) return;
    bouton.disabled = true;
    try {
      await s.recupererSupprimee(x.id);
    } catch (e) {
      console.error(e);
      bouton.disabled = false;
      toast(`« ${x.titre} » n'est pas ${accordeSorte(x.type, "revenu")} : ${explication(e)}`, 7000);
      return;
    }
    l.remove();
    if (!f.liste.querySelector(".version")) dire(f, "La corbeille est vide.");
    toast(`« ${x.titre} » est ${accordeSorte(x.type, "revenu")} dans ta bibliothèque.`);
  }

  // La ligne des Réglages (Synchronisation › Corbeille) : elle n'apparaît qu'avec la synchronisation.
  const ligneCorbeille = $("ouvrir-corbeille");
  if (ligneCorbeille) ligneCorbeille.addEventListener("click", ouvrirCorbeille);

  return {
    trancherConflit, autreDe, ouvrirVersions, ouvrirCorbeille,
    /** Les versions précédentes et la corbeille existent ici (le site, synchronisé). */
    possibles: () => !!synchro(),
  };
}
