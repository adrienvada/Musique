/**
 * LES RÉGLAGES « AVEC LIVE » (audit du 04/10, M10)
 *
 * La sortie MIDI (sortie-midi.js) et le dossier des .mid (dossier-midi.js) :
 * leurs lignes dans les réglages, et la feuille du choix du port. Chrome et
 * Edge sur ordinateur seulement : ailleurs (téléphone, Safari, Firefox,
 * claude.ai), la section reste cachée et rien n'est demandé au navigateur.
 */
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { ico } from "./icones.js";
import { SortieMidi, sortieMidiPossible } from "./sortie-midi.js";
import { creerDossierMidi, dossierMidiPossible, baseAppareil } from "./dossier-midi.js";
import { $, pluriel } from "./ui.js";
import { explication, expliquer } from "./erreurs.js";

/**
 * @param o {
 *   transport             celui de l'appli : la sortie MIDI s'y branche ;
 *   fabriquer(p, idees)   les octets du .mid d'une idée ou d'un morceau ;
 *   toast(texte, duree)   les messages de l'appli ;
 *   dansClaude            la page claude.ai (ni l'un ni l'autre n'y marche).
 * }
 * @returns { sortie, dossier, surListe(liste) } : surListe à chaque changement de la bibliothèque.
 */
export function brancherLive({ transport, fabriquer, toast, dansClaude = false }) {
  const avecSortie = !dansClaude && sortieMidiPossible();
  const avecDossier = !dansClaude && dossierMidiPossible();
  if (!avecSortie && !avecDossier) return { sortie: null, dossier: null, surListe() {} };
  $("reglages-live").hidden = false;
  const sortie = avecSortie ? brancherSortie(transport, toast) : null;
  const dossier = avecDossier ? brancherDossier(fabriquer, toast) : null;
  return { sortie, dossier, surListe: (liste) => { if (dossier) dossier.surListe(liste); } };
}

function brancherSortie(transport, toast) {
  const sortie = new SortieMidi();
  transport.sortieMidi = sortie;
  $("live-sortie").hidden = false;
  const montrer = () => {
    const nom = sortie.nom;
    $("sortie-midi-nom").textContent = !nom ? "Aucune" : sortie.active ? nom : `${nom} (débranchée)`;
    $("sortie-midi-muet").hidden = !nom;
    $("sortie-midi-muet").setAttribute("aria-checked", String(sortie.muetVoulu));
  };
  sortie.surEtat = montrer;
  montrer();
  // Le port choisi la dernière fois revient sans rien demander : l'accès a déjà été donné.
  sortie.rebrancher().then(montrer, montrer);

  const feuille = brancherFeuille($("feuille-sortie-midi"));
  $("sortie-midi-fermer").addEventListener("click", () => fermerFeuille(feuille));
  $("sortie-midi").addEventListener("click", async () => {
    let ports;
    try { ports = await sortie.ports(); } catch {
      toast("Portée n'a pas eu accès au MIDI de cet ordinateur.");
      return;
    }
    const liste = $("sortie-midi-liste");
    liste.textContent = "";
    const choisi = sortie.active ? sortie.port.id : null;
    const ajouter = (id, nom) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn" + (id === choisi ? " btn-plein" : "");
      b.setAttribute("aria-pressed", String(id === choisi));
      b.innerHTML = `${ico(id === choisi ? "ok" : id ? "clavier" : "fermer", "s")}<span></span>`;
      b.lastChild.textContent = nom;
      b.addEventListener("click", async () => {
        try { await sortie.choisir(id); } catch (e) { toast(expliquer(e, "Ce port MIDI n'a pas pu s'ouvrir.")); }
        fermerFeuille(feuille);
      });
      liste.appendChild(b);
    };
    for (const p of ports) ajouter(p.id, p.nom);
    ajouter(null, "Aucune");
    $("sortie-midi-sous").textContent = ports.length
      ? "Le port vers lequel Portée envoie ce qu'elle joue."
      : "Aucun port MIDI sur cet ordinateur. Sur Mac, mets en ligne le Gestionnaire IAC ; sur Windows, crée un port avec loopMIDI ; puis rouvre cette liste.";
    ouvrirFeuille(feuille);
  });
  $("sortie-midi-muet").addEventListener("click", () => {
    sortie.muetVoulu = !sortie.muetVoulu;
    montrer();
  });
  return sortie;
}

function brancherDossier(fabriquer, toast) {
  $("live-dossier").hidden = false;
  let dit = false;
  const montrer = (e) => {
    $("dossier-midi-nom").textContent = e.nom || "Aucun";
    $("dossier-midi-autoriser").hidden = !e.nom || e.permission === "granted";
    $("dossier-midi-tout").hidden = !e.nom;
    $("dossier-midi-oublier").hidden = !e.nom;
    $("dossier-midi-etat").textContent = texteEtat(e);
    // Une fois par visite : des changements attendent que le navigateur rende la permission.
    if (e.attendPermission && !dit) {
      dit = true;
      toast(`Le dossier « ${e.nom} » attend ta permission pour recevoir les .mid : Réglages, Avec Live.`, 9000);
    }
  };
  const dossier = creerDossierMidi({ base: baseAppareil(), fabriquer, surEtat: montrer });
  $("dossier-midi").addEventListener("click", async () => {
    try { await dossier.choisir(); } catch (e) { toast(`Ce dossier n'a pas pu être choisi : ${explication(e)}`); }
  });
  $("dossier-midi-autoriser").addEventListener("click", async () => {
    if (!(await dossier.autoriser())) toast("Sans ta permission, Portée ne peut pas écrire dans ce dossier.");
  });
  $("dossier-midi-tout").addEventListener("click", () => { dossier.toutReecrire(); });
  $("dossier-midi-oublier").addEventListener("click", () => { dossier.oublier(); });
  return dossier;
}

/** Ce que dit la ligne d'état du dossier. */
export function texteEtat(e) {
  if (!e.nom) return "";
  if (e.permission !== "granted") {
    return "Le navigateur redemande la permission d'écrire à chaque visite : touche « Autoriser » (ou choisis « Autoriser à chaque visite »).";
  }
  const d = e.dernier;
  if (!d) return "";
  const heure = new Date(d.quand).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  if (d.erreur) return `Pas tout écrit, à ${heure} : ${d.erreur}`;
  const fait = [d.ecrits ? `${pluriel(d.ecrits, "écrit")}` : "", d.effaces ? `${pluriel(d.effaces, "effacé")}` : ""].filter(Boolean).join(", ");
  return `À jour à ${heure} : ${pluriel(d.total, "fichier")}${fait ? ` (${fait})` : ""}.`;
}
