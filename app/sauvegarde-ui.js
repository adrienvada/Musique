/**
 * LA SAUVEGARDE DE LA BIBLIOTHÈQUE DANS UN FICHIER, ET SA RESTAURATION
 *
 * Les Réglages, « Sauvegarde » : toute la bibliothèque (traits et mémos
 * compris) dans un .json, qui passe d'un appareil à l'autre, et de claude.ai
 * au site. Ce que la restauration a fait se dit en une phrase
 * (`bilanRestauration`, essayée sous Node).
 */
import { restaurer, sauvegarde } from "./stockage.js";
import { echec, expliquer } from "./erreurs.js";
import { $, accorde, pluriel, toast } from "./ui.js";

/**
 * Ce que la restauration a fait, en une phrase : combien sont revenues
 * (même supprimées ailleurs depuis), combien étaient déjà là (gardées telles
 * quelles), et lesquelles n'ont pas pu revenir, avec la raison.
 */
export function bilanRestauration({ revenues = 0, ignorees = 0, differentes = 0, echecs = [] }) {
  if (!revenues && !echecs.length) return ignorees ? "Rien à restaurer : tout est déjà dans ta bibliothèque." : "Cette sauvegarde est vide.";
  const morceaux = [];
  if (revenues) morceaux.push(pluriel(revenues, "partition revenue", "partitions revenues"));
  if (ignorees) {
    const changees = differentes ? ` (dont ${pluriel(differentes, "modifiée depuis, gardée telle quelle", "modifiées depuis, gardées telles quelles")})` : "";
    morceaux.push(`${ignorees} déjà là${changees}`);
  }
  if (echecs.length) {
    const lesquelles = echecs.slice(0, 3).map((x) => `« ${x.titre} » (${x.raison})`).join(", ") + (echecs.length > 3 ? "…" : "");
    morceaux.push(`${pluriel(echecs.length, "n'a pas pu revenir", "n'ont pas pu revenir")} : ${lesquelles}`);
  }
  return morceaux.join(" · ") + ".";
}

/**
 * @param deps { stockage() → le stockage ouvert, partitions() → la bibliothèque }
 */
export function brancherSauvegarde({ stockage, partitions }) {
  async function sauvegarder() {
    try {
      const contenu = await sauvegarde(stockage(), partitions());
      const jour = new Date().toISOString().slice(0, 10);
      await stockage().enregistrerFichier(`Portée - sauvegarde ${jour}.json`, new Blob([JSON.stringify(contenu)], { type: "application/json" }));
      const n = contenu.partitions.length;
      toast(`${pluriel(n, "partition")} ${accorde(n, "sauvegardée")}.`);
    } catch (e) {
      if (e && e.code === "declined") return;
      console.error(e);
      toast(echec("La sauvegarde", e));
    }
  }

  async function restaurerFichier(fichier) {
    try {
      const contenu = JSON.parse(await fichier.text());
      const bilan = await restaurer(stockage(), contenu, new Set(partitions().map((p) => p.id)));
      toast(bilanRestauration(bilan), bilan.echecs.length ? 10000 : 5000);
    } catch (e) {
      console.error(e);
      toast(e instanceof SyntaxError ? "Ce fichier n'est pas une sauvegarde de Portée." : expliquer(e, "La restauration n'a pas abouti."), 7000);
    }
  }

  $("sauvegarder").addEventListener("click", sauvegarder);
  $("restaurer").addEventListener("change", (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) restaurerFichier(f); });
}
