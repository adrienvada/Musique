/**
 * LA BIBLIOTHÈQUE SYNCHRONISÉE, VUE DE L'APPLI
 *
 * Sur le site seulement : sur claude.ai, la base de la page suffit. Chaque
 * appareil garde toute la bibliothèque ; synchro.js échange les changements
 * avec la bibliothèque commune, par le connecteur. Déclencheurs :
 * démarrage, retour sur l'onglet ou du réseau, quelques secondes après une
 * modification, et toutes les 90 s tant que la page est visible.
 *
 * Ce module dit où en est la synchronisation (les Réglages, l'icône du
 * haut) et tient la partition ouverte à jour quand elle a changé ailleurs :
 * sur un autre appareil (la synchro en a reçu), ou dans un autre onglet.
 */
import { creerSynchro } from "./synchro.js";
import { adresseEnregistree } from "./connecteur.js";
import { cause } from "./erreurs.js";
import { $, el, heure, pluriel, toast } from "./ui.js";

/**
 * @param deps {
 *   dansClaude(), stockage() → le stockage ouvert,
 *   appeler(outil, args) → la réponse du connecteur (tablette.js),
 *   formulaireAdresse(apres) (tablette.js), majReglagesRm() (tablette.js),
 *   montrerSynchro({ nuage, ton, titre }) (l'icône de l'accueil),
 *   ouverte() → l'écran qui montre une partition, ou null : {
 *     partition() → son identifiant (null : pas encore enregistrée),
 *     occupe() → une écriture attend ou est en cours ici,
 *     recharger(p) → true s'il a repris la version p (false : rien de ce qu'il montre n'a changé),
 *     supprimee(ou) → ce qu'on dit si elle a disparu ailleurs (`ou` : « sur un autre appareil »…) },
 *   quitter() (revenir à la bibliothèque),
 *   rappel() → le rappel de sauvegarde, ou null (sauvegarde-ui.js)
 * }
 */
export function creerSynchronisation(deps) {
  const { dansClaude, stockage } = deps;
  let synchro = null, minuterieSynchro = null, battement = null, dernierEtat = null;

  const synchronisable = () => !dansClaude() && !!stockage() && stockage().synchronisable && !!adresseEnregistree();

  async function demarrer() {
    if (!synchronisable()) { afficher(null); return; }
    // Une autre adresse, c'est une autre bibliothèque commune : on la rejoint depuis le début.
    const adresse = adresseEnregistree();
    const s = stockage();
    if ((await s.lireMeta("adresse")) !== adresse) {
      await s.ecrireMeta("curseur", null);
      await s.ecrireMeta("rejoint", false);
      await s.ecrireMeta("adresse", adresse);
    }
    synchro ??= creerSynchro({ local: s, appeler: deps.appeler, surEtat: afficher });
    s.surChangement(() => { clearTimeout(minuterieSynchro); minuterieSynchro = setTimeout(synchroniser, 2500); });
    clearInterval(battement);
    battement = setInterval(() => { if (document.visibilityState === "visible") synchroniser(); }, 90000);
    synchroniser();
  }

  function arreter() {
    clearInterval(battement);
    clearTimeout(minuterieSynchro);
    if (stockage() && stockage().surChangement) stockage().surChangement(() => {});
    synchro = null;
    afficher(null);
  }

  async function synchroniser() {
    if (!synchro || !synchronisable()) return;
    try {
      const { recues } = await synchro.synchroniser();
      if (recues) await rafraichirOuverte("sur un autre appareil");
    } catch (e) {
      console.warn("Synchronisation", e);
    }
  }

  /**
   * La partition ouverte a peut-être changé ailleurs : on la reprend, ou on
   * revient à la bibliothèque si elle a disparu. Un seul endroit pour les
   * quatre écrans (audit du 04/10, T4) : l'idée et le morceau se
   * rechargeaient dès que la synchro recevait quoi que ce soit, avec un
   * faux « modifiée sur un autre appareil » ; et une écriture en cours ici
   * se voyait remplacée à l'écran par la version d'avant. `ou` : d'où vient
   * le changement, pour le dire juste (un autre onglet n'est pas un autre
   * appareil, D7).
   */
  async function rafraichirOuverte(ou = "sur un autre appareil") {
    const ecran = deps.ouverte();
    const id = ecran && ecran.partition();
    if (!id) return;
    const neuve = await stockage().lire(id);
    // Entre-temps, on a pu changer d'écran ou de partition : ce qu'on a lu n'est plus pour lui.
    if (deps.ouverte() !== ecran || ecran.partition() !== id) return;
    if (!neuve) { toast(ecran.supprimee(ou)); deps.quitter(); return; }
    // Une écriture qui attend ou qui part garde la main : elle partira à son tour, et le
    // stockage la fusionnera avec ce qui est arrivé (S8).
    if (ecran.occupe()) return;
    if (await ecran.recharger(neuve)) toast(`« ${neuve.titre} » a été modifiée ${ou} : mise à jour.`);
  }

  function afficher(e) {
    if (e) dernierEtat = e;
    const actif = synchronisable();
    const s = stockage();
    $("synchroniser").hidden = !actif;
    $("activer-synchro").hidden = actif || dansClaude() || !(s && s.synchronisable);
    deps.majReglagesRm();
    if (!s) return;
    if (dansClaude() || s.mode === "claude") {
      // Les textes de claude.ai sont posés au démarrage ; ici, seulement l'icône du haut.
      const surClaude = s.mode === "claude";
      if (!surClaude) $("mode").textContent = "Enregistré dans ce navigateur";
      deps.montrerSynchro(surClaude
        ? { nuage: true, ton: "ok", titre: "Enregistré sur claude.ai" }
        : { nuage: false, ton: "gris", titre: "Enregistré dans ce navigateur" });
      return;
    }
    if (!actif) {
      $("mode").textContent = "Enregistré dans ce navigateur";
      $("mode-detail").textContent = "Tes partitions restent dans ce navigateur. Active la synchronisation pour les retrouver sur tous tes appareils, ou sauvegarde-les dans un fichier.";
      // Sans synchronisation, une sauvegarde trop ancienne se voit aussi en haut, discrètement (D9).
      const rappel = deps.rappel ? deps.rappel() : null;
      deps.montrerSynchro(rappel
        ? { nuage: false, ton: "alerte", titre: "Enregistré dans ce navigateur, pas synchronisé : pense à sauvegarder", vers: "rg-sauvegarde" }
        : { nuage: false, ton: "gris", titre: "Enregistré dans ce navigateur, pas synchronisé" });
      return;
    }
    const d = dernierEtat || { etat: "encours" };
    const attente = d.attente ? ` · ${pluriel(d.attente, "modification")} en attente` : "";
    if (d.etat === "encours") $("mode").textContent = "Synchronisation…";
    else if (d.etat === "ok") $("mode").textContent = `Synchronisé à ${heure(d.le)}` + attente;
    else $("mode").textContent = (navigator.onLine === false ? "Hors ligne" : "Synchronisation impossible") + attente;
    $("mode-detail").textContent = d.etat === "erreur"
      ? `Tes partitions restent dans ce navigateur et partiront à la prochaine connexion. (${d.erreur ? cause(d.erreur) : "erreur"})`
      : "Ta bibliothèque est synchronisée : tu retrouves les mêmes partitions sur chaque appareil où tu as collé l'adresse du connecteur.";
    // L'icône du haut : verte quand tout est parti, ambre quand quelque chose attend.
    deps.montrerSynchro({ nuage: d.etat !== "erreur", ton: d.etat === "ok" ? "ok" : d.etat === "erreur" ? "alerte" : "gris", titre: $("mode").textContent });
  }

  function formulaire() {
    const bloc = el("div", "aide-connecteur");
    const p = el("p", "", "Colle l'adresse de ton connecteur « Portée reMarkable » (la même que dans claude.ai). Fais-le sur chaque appareil : ils partageront la même bibliothèque, et le bouton reMarkable marchera aussi.");
    bloc.append(p, deps.formulaireAdresse(() => { bloc.remove(); toast("Synchronisation activée."); }));
    return bloc;
  }

  $("synchroniser").addEventListener("click", synchroniser);
  $("activer-synchro").addEventListener("click", () => {
    if (!document.querySelector("#zone-synchro .aide-connecteur")) $("zone-synchro").appendChild(formulaire());
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") synchroniser(); });
  window.addEventListener("online", synchroniser);
  window.addEventListener("offline", () => afficher(dernierEtat && { ...dernierEtat, etat: "erreur", erreur: { name: "NetworkError", message: "hors ligne" } }));

  return {
    demarrer, arreter, synchroniser, afficher, rafraichirOuverte,
    /** La synchronisation est branchée (le site, une adresse de connecteur, IndexedDB). */
    active: synchronisable,
    /** Le stockage est ouvert : un autre onglet qui change une partition la fait reprendre ici (S8). */
    brancher() {
      const s = stockage();
      if (s && s.surAutreOnglet) s.surAutreOnglet(() => rafraichirOuverte("dans un autre onglet"));
    },
  };
}
