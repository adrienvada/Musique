/**
 * MA REMARKABLE : PARCOURIR LA TABLETTE ET IMPORTER AU CLIC
 *
 * Sur claude.ai, la page ne peut joindre aucun serveur : elle passe par le
 * connecteur « Portée reMarkable » qu'Adrien a ajouté à claude.ai (la
 * capacité `mcp`). Ailleurs (GitHub Pages), elle appelle ce même connecteur
 * directement, à l'adresse qu'Adrien a collée une fois (connecteur.js).
 * Deux outils lisent la tablette, « arborescence » et « document » ;
 * « relier » sert une fois, avec le code à 8 lettres de my.remarkable.com.
 *
 * Ce module tient le panneau « Ma reMarkable » de l'onglet Partitions, ses
 * lignes dans les Réglages, l'adresse du connecteur (qui sert aussi à la
 * synchronisation : `appelerOutil`) et le panneau des modèles à mettre sur
 * la tablette.
 */
import { adresseEnregistree, connecteurDirect, documentParTranches, enregistrerAdresse, FORME_ADRESSE } from "./connecteur.js";
import { decompacter } from "./stockage.js";
import { erreur, explication } from "./erreurs.js";
import { $, accorde, dateCourte, el, toast } from "./ui.js";
import { defilement } from "./mouvement.js";

// Nom du connecteur tel qu'Adrien l'a ajouté dans claude.ai (Paramètres → Connecteurs).
export const CONNECTEUR = "Portée reMarkable";

/**
 * Les modèles de papier de Portée : ceux qu'on télécharge pour la tablette,
 * et ceux que l'import reconnaît à leurs lignes grises (import-pdf.js). La
 * page d'étalonnage (L16) n'est pas une partition : remplie une fois, elle
 * apprend à Portée tes silences, tes altérations et tes chiffres.
 */
export const MODELES = [
  { id: "melodie-standard", nom: "Mélodie", detail: "7 portées, pour une ligne mélodique." },
  { id: "melodie-large", nom: "Mélodie, large", detail: "5 portées aux interlignes plus grands." },
  { id: "piano-standard", nom: "Piano", detail: "4 systèmes de deux portées, main droite et main gauche." },
  { id: "piano-large", nom: "Piano, large", detail: "3 systèmes, plus de place pour écrire." },
  { id: "etalonnage", nom: "Étalonnage", detail: "Une page à remplir une fois : tes silences, altérations et chiffres." },
];

/** Le nom d'un modèle (« Piano, large ») ; un modèle inconnu garde son identifiant. */
export function nomModele(id) {
  const m = MODELES.find((x) => x.id === id);
  return m ? m.nom : String(id || "");
}

/** « Quart de soupir » → « quart de soupir » ; « C (4/4) » et « 3 de triolet » restent tels quels. */
const enMinuscule = (nom) => (/^[A-ZÀ-Ý][a-zà-ÿ]/.test(nom) ? nom.charAt(0).toLowerCase() + nom.slice(1) : nom);

/**
 * Ce qu'une page d'étalonnage a appris (L16), en clair : combien de signes,
 * et quelles cases sont restées vides (à remplir pour que Portée les
 * reconnaisse). `appris` : les exemples lus sur la page ; `neufs` : ceux
 * que tes gabarits n'avaient pas encore (la même page importée deux fois
 * n'apprend rien de plus) ; `vides` : les noms des cases sans exemple.
 * @param {{ appris: number, neufs: number, vides: string[], cases: number }} bilan
 */
export function bilanEtalonnage({ appris, neufs, vides, cases }) {
  if (!appris) return "Ta page d'étalonnage n'a rien appris à Portée : ses cases sont vides. Écris chaque signe trois fois dans sa case, à côté du signe gris, puis importe-la à nouveau.";
  const quoi = neufs === appris ? `Portée a appris ${appris} ${accorde(appris, "signe")} de ton écriture.`
    : neufs ? `Portée a appris ${neufs} ${accorde(neufs, "signe")} de ton écriture (elle en connaissait déjà ${appris - neufs}).`
      : `Portée connaissait déjà ${appris === 1 ? "ce signe" : `ces ${appris} signes`} de ton écriture : rien de neuf.`;
  if (!vides.length) return `${quoi} Toutes les cases sont remplies.`;
  if (vides.length === cases) return quoi;
  const liste = vides.map(enMinuscule);
  return `${quoi} ${vides.length === 1 ? "Case restée vide" : "Cases restées vides"} : ${liste.join(", ")}. Tu peux les remplir et importer la page à nouveau.`;
}

/**
 * Ce qu'on dit des pages que le connecteur n'a pas su lire (C3) :
 * « La page 3 n'a pas pu être lue… », ou null s'il n'y en a pas. `liste` :
 * `pagesIllisibles` du connecteur ([{ numero, raison }]).
 * @param {unknown} liste
 */
export function pagesIllisibles(liste) {
  const numeros = [...new Set((Array.isArray(liste) ? liste : []).map((p) => (p && typeof p === "object" ? p.numero : p)).filter(Number.isInteger))].sort((a, b) => a - b);
  if (!numeros.length) return null;
  if (numeros.length === 1) return `La page ${numeros[0]} n'a pas pu être lue : réessaie plus tard, ou exporte-la en PDF.`;
  return `Les pages ${numeros.slice(0, -1).join(", ")} et ${numeros.at(-1)} n'ont pas pu être lues : réessaie plus tard, ou exporte-les en PDF.`;
}

/**
 * @param deps {
 *   dansClaude(), stockage() → le stockage ouvert, partitions() → la bibliothèque,
 *   ouvrir(id, vue), enregistrerLecture({ titre, modele, version, pages, source, avertissement }) (import-pdf.js),
 *   importerEtalonnage({ nom, pages, version, avertissement }) (import-pdf.js : une page d'étalonnage, L16),
 *   versPartitions() (l'onglet où vivent les panneaux), surAdresse() (une adresse
 *   enregistrée : la synchronisation démarre), surOubli() (l'adresse oubliée : elle s'arrête)
 * }
 */
export function creerTablette(deps) {
  const { dansClaude } = deps;
  let mcpPromesse = null;
  let noeudsRm = [];
  let tabletteReliee = null; // null tant que le connecteur n'a pas répondu
  const ouverts = new Set();

  const mcp = () => (mcpPromesse ??= (async () => {
    if (dansClaude()) return window.claude.use("mcp").catch(() => null);
    const adresse = adresseEnregistree();
    return adresse ? connecteurDirect(adresse) : null;
  })());

  /** Un outil du connecteur (la synchronisation s'en sert : bibliotheque_changements…). */
  async function appelerOutil(outil, args) {
    const m = await mcp();
    if (!m) throw erreur("sans_adresse", "Pas d'adresse de connecteur.");
    const r = await m.callTool(CONNECTEUR, outil, args, { cache: false });
    return r.payload;
  }

  /**
   * Les lignes « Ma reMarkable » des Réglages : où en est le connecteur, où en est la tablette.
   * La tablette n'est connue qu'après un premier appel au connecteur (le panneau de l'onglet Partitions).
   */
  function majReglagesRm() {
    const adresse = !!adresseEnregistree();
    $("rm-connecteur").textContent = dansClaude() ? "Portée reMarkable (claude.ai)" : adresse ? "Adresse enregistrée" : "Pas encore d'adresse";
    $("rm-tablette").textContent = tabletteReliee === true ? "Reliée" : tabletteReliee === false ? "À relier"
      : dansClaude() || adresse ? "Pas encore vérifiée" : "Colle l'adresse du connecteur";
    $("changer-adresse").hidden = dansClaude() || !adresse;
  }

  function etatRm(texte, aide = null) {
    const e = $("etat-rm");
    e.textContent = texte;
    if (aide) e.appendChild(aide);
  }

  /** Le message d'un outil en échec (texte renvoyé par le connecteur). */
  function texteOutil(err) {
    const c = err && err.result && err.result.content;
    const t = Array.isArray(c) && c.find((x) => x && x.type === "text");
    return (t && t.text) || (err && err.message) || "";
  }

  /** Ce qu'il faut faire, selon ce qui bloque. Chaque cas a sa réponse. */
  function expliquerErreurRm(err) {
    const code = err && err.code;
    const bloc = el("div", "aide-connecteur");
    const p = (t) => bloc.appendChild(el("p", "", t));
    if (code === "adresse_invalide") {
      p("Cette adresse ne mène à aucun connecteur. Vérifie-la (elle finit par la clé), ou colle la nouvelle.");
      bloc.appendChild(formulaireAdresse());
    } else if (code === "server_not_connected" || code === "server_not_found") {
      p(`Le connecteur « ${CONNECTEUR} » n'est pas ajouté à ton compte claude.ai.`);
      p("Ajoute-le dans claude.ai → Paramètres → Connecteurs → Ajouter un connecteur personnalisé, avec exactement ce nom et l'adresse que Claude t'a donnée. Puis recharge cette page.");
    } else if (code === "needs_reauth") {
      p(`Reconnecte « ${CONNECTEUR} » dans claude.ai → Paramètres → Connecteurs, puis réessaie.`);
    } else if (code === "not_in_manifest") {
      p("Tu as refusé à Portée l'accès à ta reMarkable. Recharge la page pour qu'elle te le redemande.");
    } else if (code === "selection_required") {
      p(`Plusieurs connecteurs s'appellent « ${CONNECTEUR} » : choisis le bon quand claude.ai te le demande, ou supprime le doublon.`);
    } else if (code === "server_unavailable" || code === "upstream_error") {
      p("Le connecteur ne répond pas pour l'instant. Réessaie dans un moment : si ça dure, le projet Supabase s'est peut-être endormi (tableau de bord Supabase → relancer le projet).");
    } else if (code === "tool_error") {
      p(texteOutil(err) || "La reMarkable a refusé la demande.");
    } else if (code === "blocked_by_policy" || code === "approval_required") {
      p("Ton organisation claude.ai bloque ce connecteur pour les pages.");
    } else {
      p(`La reMarkable n'a pas pu être lue : ${explication(err)}`);
    }
    return bloc;
  }

  async function ouvrirRemarkable(rafraichir = false) {
    deps.versPartitions();
    $("panneau-remarkable").hidden = false;
    $("panneau-remarkable").scrollIntoView({ behavior: defilement(), block: "nearest" });
    $("arbre-rm").textContent = "";
    const m = await mcp();
    // Sans connecteur, rien à chercher ni à actualiser : seule l'adresse à coller se montre.
    $("outils-rm").hidden = !m;
    if (!m) {
      const bloc = el("div", "aide-connecteur");
      if (dansClaude()) {
        bloc.textContent = "La page n'a pas accès aux connecteurs de claude.ai : recharge-la et autorise « Portée reMarkable ».";
      } else {
        const p = el("p", "", "Pour parcourir ta reMarkable depuis ce site, colle une fois l'adresse de ton connecteur « Portée reMarkable » (la même que dans claude.ai). Elle reste dans ce navigateur, nulle part ailleurs.");
        bloc.append(p, formulaireAdresse());
      }
      etatRm("", bloc);
      return;
    }
    etatRm("Lecture de ta reMarkable… (quelques secondes la première fois)");
    try {
      const r = await m.callTool(CONNECTEUR, "arborescence", {}, rafraichir ? { cache: { refresh: true } } : undefined);
      recevoirArbre(r.payload);
    } catch (e) {
      console.error(e);
      etatRm("", expliquerErreurRm(e));
    }
  }

  function oublierAdresse() {
    enregistrerAdresse("");
    mcpPromesse = null;
    tabletteReliee = null;
    $("changer-adresse").hidden = true;
    deps.surOubli();
    majReglagesRm();
    // On reste dans les Réglages : l'adresse se recolle juste dessous.
    const zone = $("zone-adresse");
    zone.textContent = "";
    const bloc = el("div", "aide-connecteur");
    const p = el("p", "", "L'ancienne adresse est oubliée. Colle celle de ton connecteur « Portée reMarkable » (la même que dans claude.ai) : elle reste dans ce navigateur, nulle part ailleurs.");
    bloc.append(p, formulaireAdresse(() => { zone.textContent = ""; toast("Adresse enregistrée."); }));
    zone.appendChild(bloc);
    bloc.querySelector("input").focus();
  }

  function recevoirArbre(reponse) {
    if (reponse && reponse.connectee === false) {
      tabletteReliee = false;
      majReglagesRm();
      noeudsRm = [];
      $("arbre-rm").textContent = "";
      etatRm("", formulaireRelier(reponse.raison));
      return;
    }
    tabletteReliee = true;
    majReglagesRm();
    noeudsRm = (reponse && reponse.noeuds) || [];
    const n = noeudsRm.filter((x) => x.type === "document").length;
    // Un document que le cloud n'a pas su rendre ne fait plus tomber les autres (C3) : on le compte.
    const illisibles = Array.isArray(reponse && reponse.illisibles) ? reponse.illisibles.length : 0;
    const aussi = !illisibles ? "" : ` ${illisibles === 1 ? "Un autre n'a pas pu être lu" : `${illisibles} autres n'ont pas pu être lus`} : réessaie dans un moment (Actualiser).`;
    etatRm(`${n} ${accorde(n, "document")} sur ta reMarkable.${aussi}`);
    dessinerArbre();
  }

  /** L'adresse du connecteur, pour appeler la tablette hors de claude.ai. */
  function formulaireAdresse(apres = () => ouvrirRemarkable(true)) {
    const form = el("form", "rangee");
    const champ = el("input");
    Object.assign(champ, { className: "champ", type: "url", placeholder: "https://….supabase.co/functions/v1/portee-remarkable/…", autocomplete: "off", spellcheck: false, value: adresseEnregistree() });
    champ.setAttribute("aria-label", "Adresse du connecteur Portée reMarkable");
    const bouton = el("button", "btn btn-plein", "Enregistrer");
    bouton.type = "submit";
    const retour = el("p", "remarque");
    retour.setAttribute("role", "alert");
    form.append(champ, bouton, retour);
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const adresse = champ.value.trim();
      if (!FORME_ADRESSE.test(adresse)) {
        retour.textContent = "L'adresse ressemble à https://<projet>.supabase.co/functions/v1/portee-remarkable/<clé>.";
        return;
      }
      enregistrerAdresse(adresse);
      mcpPromesse = null;
      $("changer-adresse").hidden = false;
      deps.surAdresse();
      apres();
    });
    return form;
  }

  /** Relier la tablette, une fois pour toutes : le code à 8 lettres de my.remarkable.com. */
  function formulaireRelier(raison) {
    const bloc = el("div", "aide-connecteur");
    const intro = el("p", "", raison === "revoquee"
      ? "Ta reMarkable ne reconnaît plus Portée (appareil retiré de ton compte ?). Relie-la à nouveau :"
      : "Il reste à relier Portée à ta reMarkable. C'est à faire une seule fois :");
    const etapes = el("ol");
    const e1 = el("li");
    const lien = el("a", "", "my.remarkable.com/device/desktop/connect");
    lien.href = "https://my.remarkable.com/device/desktop/connect";
    lien.target = "_blank";
    lien.rel = "noopener";
    e1.append("Ouvre ", lien, " (connecte-toi à ton compte reMarkable) ;");
    const e2 = el("li", "", "recopie ici le code à 8 lettres affiché, sans attendre : il expire au bout de quelques minutes.");
    etapes.append(e1, e2);
    const form = el("form", "rangee");
    const champ = el("input");
    Object.assign(champ, { className: "champ", id: "code-rm", maxLength: 8, placeholder: "abcdefgh", autocomplete: "off", spellcheck: false });
    champ.setAttribute("autocapitalize", "none");
    champ.setAttribute("aria-label", "Code à 8 lettres de my.remarkable.com");
    champ.style.flex = "0 1 160px";
    const bouton = el("button", "btn btn-plein", "Relier");
    bouton.type = "submit";
    form.append(champ, bouton);
    const retour = el("p", "remarque");
    retour.setAttribute("role", "alert");
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const code = champ.value.trim().toLowerCase();
      if (!/^[a-z]{8}$/.test(code)) { retour.textContent = "Le code fait exactement 8 lettres."; champ.focus(); return; }
      const m = await mcp();
      if (!m) return;
      await occuper(bouton, "Liaison…", async () => {
        retour.textContent = "";
        try {
          const r = await m.callTool(CONNECTEUR, "relier", { code }, { cache: false });
          toast("Ta reMarkable est reliée à Portée.");
          recevoirArbre(r.payload);
        } catch (e) {
          console.error(e);
          if (e && e.code === "tool_error") retour.textContent = texteOutil(e) || "reMarkable a refusé ce code.";
          else etatRm("", expliquerErreurRm(e));
        }
      });
    });
    bloc.append(intro, etapes, form, retour);
    return bloc;
  }

  /**
   * Le bouton dit qu'il travaille (« Lecture… »), le temps de `travail`, puis
   * reprend son libellé. Une seule fonction pour les deux boutons qui
   * attendent la tablette : on ne remet pas un libellé lu avant l'attente.
   */
  async function occuper(bouton, pendant, travail) {
    const libelle = bouton.textContent;
    bouton.disabled = true;
    bouton.textContent = pendant;
    try { await travail(); } finally { rendre(bouton, libelle); }
  }
  function rendre(bouton, libelle) {
    bouton.disabled = false;
    bouton.textContent = libelle;
  }

  function dessinerArbre() {
    const zone = $("arbre-rm");
    zone.textContent = "";
    const q = $("recherche-rm").value.trim().toLowerCase();
    const enfants = Map.groupBy(noeudsRm, (n) => n.parent || "");
    const trier = (l) => l.sort((a, b) => (a.type === b.type ? a.nom.localeCompare(b.nom, "fr") : a.type === "dossier" ? -1 : 1));
    const importees = new Map(deps.partitions().filter((p) => p.source && p.source.remarkable).map((p) => [p.source.remarkable, p]));
    // Avec une recherche : liste à plat des documents qui correspondent.
    if (q) {
      const trouves = trier(noeudsRm.filter((n) => n.type === "document" && n.nom.toLowerCase().includes(q)));
      if (!trouves.length) zone.appendChild(el("p", "remarque", "Aucun document ne porte ce nom."));
      for (const d of trouves) zone.appendChild(ligneDocument(d, importees.get(d.id)));
      return;
    }
    const construire = (parent, conteneur) => {
      for (const n of trier(enfants.get(parent) || [])) {
        if (n.type === "dossier") {
          const det = el("details");
          det.open = ouverts.has(n.id);
          det.addEventListener("toggle", () => (det.open ? ouverts.add(n.id) : ouverts.delete(n.id)));
          const sous = el("div", "enfants");
          det.append(el("summary", "", n.nom), sous);
          conteneur.appendChild(det);
          construire(n.id, sous);
        } else {
          conteneur.appendChild(ligneDocument(n, importees.get(n.id)));
        }
      }
    };
    construire("", zone);
  }

  function ligneDocument(d, dejaImportee) {
    const ligne = el("div", "doc-rm");
    const nom = el("span", "nom", d.nom);
    const meta = el("span", "meta", [d.modifie ? dateCourte(d.modifie) : "", d.pdf ? "" : "carnet (pas un modèle Portée)"].filter(Boolean).join(" · "));
    const b = el("button", "btn btn-petit" + (d.pdf ? " btn-plein" : ""), dejaImportee ? "Réimporter" : "Importer");
    b.disabled = !d.pdf;
    b.addEventListener("click", () => importerRemarkable(d, b));
    ligne.append(nom, meta);
    if (dejaImportee) {
      const voir = el("button", "btn btn-petit", "Ouvrir");
      voir.addEventListener("click", () => deps.ouvrir(dejaImportee.id));
      ligne.append(voir);
    }
    ligne.append(b);
    return ligne;
  }

  /**
   * Un document de la tablette. Sur claude.ai, par tranches : claude.ai coupe
   * un résultat d'outil au-delà d'environ 150 000 caractères, et trois pages
   * denses suffisaient (connecteur.js). Le site appelle le connecteur
   * lui-même, sans cette limite : tout d'un coup, comme avant.
   */
  async function lireDocumentRm(m, id) {
    if (m.direct) return (await m.callTool(CONNECTEUR, "document", { id }, { cache: false })).payload || {};
    return documentParTranches(m, CONNECTEUR, id);
  }

  async function importerRemarkable(d, bouton) {
    const m = await mcp();
    if (!m) return;
    await occuper(bouton, "Lecture…", async () => {
      try {
        const doc = await lireDocumentRm(m, d.id);
        if (!doc.modele) {
          toast(`« ${d.nom} » n'a pas été écrit sur un modèle Portée : impossible de savoir où sont les lignes.`, 9000);
          return;
        }
        // La version du modèle, lue dans le sujet du PDF (L9) ; un connecteur d'avant ne la donne pas : la v1.
        const version = Number.isInteger(doc.versionModele) ? doc.versionModele : null;
        const illisibles = pagesIllisibles(doc.pagesIllisibles);
        const pages = (doc.pages || []).map((p) => decompacter(p.traits)).filter((t) => t.length > 0);
        if (!pages.length) {
          toast(illisibles ? `« ${d.nom} » : ${illisibles.charAt(0).toLowerCase()}${illisibles.slice(1)}` : `« ${d.nom} » ne contient encore aucun trait.`, illisibles ? 9000 : 4000);
          return;
        }
        // Une page d'étalonnage (L16) n'est pas une partition : elle apprend tes signes, et le panneau reste ouvert.
        if (doc.modele === "etalonnage") { await deps.importerEtalonnage({ nom: doc.nom || d.nom, pages, version, avertissement: illisibles }); return; }
        const id = await deps.enregistrerLecture({ titre: doc.nom || d.nom, modele: doc.modele, version, pages, source: { remarkable: d.id, modifie: d.modifie || null }, avertissement: illisibles });
        $("panneau-remarkable").hidden = true;
        deps.ouvrir(id, "atelier");
      } catch (e) {
        console.error(e);
        etatRm("", expliquerErreurRm(e));
      }
    });
  }

  // --- Les modèles à mettre sur la tablette ---------------------------------------

  function afficherModeles() {
    deps.versPartitions();
    $("panneau-modeles").hidden = false;
    const zone = $("liste-modeles");
    if (zone.childElementCount) return;
    for (const m of MODELES) {
      const bloc = el("div", "modele");
      const img = el("img");
      img.src = new URL(`./modeles/apercu/${m.id}.svg`, import.meta.url).href;
      img.alt = `Aperçu du modèle ${m.nom}`;
      img.loading = "lazy";
      const b = el("button", "btn btn-petit", "Télécharger le PDF");
      b.addEventListener("click", async () => {
        try {
          const r = await fetch(new URL(`./modeles/${m.id}.pdf`, import.meta.url));
          // Une réponse d'erreur (404, 503) se rangeait comme un PDF : un fichier illisible pour la tablette.
          if (!r.ok) throw erreur("modele_absent", `le serveur ne l'a pas donné (erreur ${r.status}). Réessaie dans un moment.`);
          await deps.stockage().enregistrerFichier(`Portée - ${m.nom}.pdf`, new Blob([await r.arrayBuffer()], { type: "application/pdf" }));
        } catch (e) {
          if (e && e.code === "declined") return;
          console.error(e);
          toast(`Le modèle n'a pas pu être téléchargé : ${explication(e)}`);
        }
      });
      bloc.append(img, el("span", "nom", m.nom), el("span", "remarque", m.detail), b);
      zone.appendChild(bloc);
    }
    $("panneau-modeles").scrollIntoView({ behavior: defilement(), block: "nearest" });
  }

  // --- Branchements ------------------------------------------------------------------

  $("ouvrir-remarkable").addEventListener("click", () => ouvrirRemarkable(false));
  $("reglage-rm").addEventListener("click", () => ouvrirRemarkable(false));
  $("vide-remarkable").addEventListener("click", () => ouvrirRemarkable(false));
  $("actualiser-rm").addEventListener("click", () => ouvrirRemarkable(true));
  $("fermer-rm").addEventListener("click", () => { $("panneau-remarkable").hidden = true; });
  $("recherche-rm").addEventListener("input", dessinerArbre);
  $("changer-adresse").addEventListener("click", oublierAdresse);
  $("ouvrir-modeles").addEventListener("click", afficherModeles);
  $("vide-modeles").addEventListener("click", afficherModeles);
  $("fermer-modeles").addEventListener("click", () => { $("panneau-modeles").hidden = true; });

  return {
    appelerOutil, majReglagesRm, formulaireAdresse,
    /** Un panneau ouvert (la tablette, puis les modèles) se ferme : true s'il y en avait un. */
    reculer() {
      for (const id of ["panneau-remarkable", "panneau-modeles"]) if (!$(id).hidden) { $(id).hidden = true; return true; }
      return false;
    },
    /** Aucun des deux panneaux n'est ouvert. */
    aLaRacine: () => $("panneau-remarkable").hidden && $("panneau-modeles").hidden,
  };
}
