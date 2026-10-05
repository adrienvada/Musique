/**
 * LES QUESTIONS DE L'APPLI
 *
 * Une seule façon de demander : la fenêtre de l'appli (`#dialogue`), avec
 * un titre, une phrase, des réponses, et « Annuler ». Avant, il y en avait
 * trois (audit du 04/10, T3) : cette fenêtre pour supprimer depuis le
 * carnet, un bandeau sous la barre dans « Corriger » et « Écouter », et
 * `window.confirm` pour effacer le mémo vocal. Celle du navigateur ne suit
 * pas l'ambiance de l'appli, et une page intégrée (claude.ai) peut ne pas
 * avoir le droit de l'ouvrir : la réponse est alors « non », sans rien
 * montrer.
 *
 * Le focus va d'abord sur « Annuler » (I6) : `showModal()` le donnait au
 * premier bouton, souvent « Supprimer », qu'un Entrée de trop validait.
 * Échap ferme la fenêtre, comme « Annuler » (le clavier de l'appli laisse
 * les touches aux fenêtres ouvertes, app.js).
 */
import { $, el } from "./ui.js";
import { ico } from "./icones.js";

/**
 * Une petite fenêtre : un titre, une phrase, des boutons ; rend la valeur du
 * bouton choisi, ou null (Annuler, Échap, précédent).
 * @param {string} titre
 * @param {string} texte
 * @param {{ valeur: string, texte: string, icone?: string, plein?: boolean, danger?: boolean }[]} choix
 *   `icone` : le nom d'une icône d'icones.js, devant le texte (« + » ne s'écrit pas en caractère).
 */
export function dialogue(titre, texte, choix) {
  const d = $("dialogue");
  const f = $("dialogue-dedans");
  f.textContent = "";
  const liste = el("div", "liste-choix");
  for (const c of choix) {
    const b = el("button", "btn" + (c.plein ? " btn-plein" : "") + (c.danger ? " btn-danger" : ""), c.texte);
    if (c.icone) b.insertAdjacentHTML("afterbegin", ico(c.icone, "s"));
    b.value = c.valeur;
    liste.appendChild(b);
  }
  const annuler = el("button", "btn btn-petit", "Annuler");
  annuler.value = "";
  annuler.autofocus = true;
  f.append(el("h2", "", titre), el("p", "remarque", texte), liste, annuler);
  return new Promise((ok) => {
    d.addEventListener("close", () => ok(d.returnValue || null), { once: true });
    d.returnValue = "";
    d.showModal();
  });
}

/**
 * Oui ou non, pour un geste qu'on ne défait pas.
 * @param {{ titre: string, texte: string, oui: string, danger?: boolean }} q
 * @returns {Promise<boolean>}
 */
export async function confirmer({ titre, texte, oui, danger = true }) {
  return (await dialogue(titre, texte, [{ valeur: "oui", texte: oui, danger }])) === "oui";
}

/**
 * Faut-il supprimer `p` (partition, idée ou morceau) ? Une idée qui sert
 * dans un morceau le dit : sa partie y sera sautée.
 * @param {{ type?: string, titre: string, id: string }} p
 * @param {any[]} partitions  toute la bibliothèque (pour les morceaux qui emploient l'idée)
 */
export function veutSupprimer(p, partitions = []) {
  const quoi = p.type === "morceau" ? "le morceau" : p.type === "idee" ? "l'idée" : "la partition";
  let texte = "Ses pages partent avec elle. C'est définitif.";
  if (p.type === "morceau") texte = "Ses idées restent dans ta bibliothèque. C'est définitif.";
  if (p.type === "idee") {
    const morceaux = partitions.filter((m) => m.type === "morceau" && (m.blocs || []).some((b) => b.idee === p.id)).map((m) => `« ${m.titre} »`);
    texte = morceaux.length ? `Elle sert dans ${morceaux.join(", ")} : cette partie y sera sautée. C'est définitif.` : "C'est définitif.";
  }
  return confirmer({ titre: `Supprimer ${quoi} « ${p.titre} » ?`, texte, oui: "Supprimer" });
}
