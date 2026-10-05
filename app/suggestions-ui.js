/**
 * LES SUGGESTIONS DE CLAUDE, DANS L'IDÉE OU LA PAGE QU'ELLES CONCERNENT (H3, C5)
 *
 * Dans une conversation, Claude peut ranger une proposition à côté d'une
 * partition (suggestion_ecrire, connecteur) : des accords, une suite, une
 * variation, un titre, des étiquettes, une note, la réponse à un doute.
 * Elle ne touche jamais la partition. Ici, l'appli la montre dans un bandeau
 * discret en haut de l'idée ou de la page concernée (« Claude propose
 * 4 accords », et pourquoi), avec trois gestes :
 *   - « Écouter » : l'idée avec la proposition, jouée sans rien écrire ;
 *   - « Appliquer » : revérifiée sur la partition telle qu'elle est
 *     (suggestions.js), posée en un seul geste (un seul « Annuler ») ;
 *   - « Ignorer ».
 * Appliquée ou ignorée, elle part du connecteur (suggestion_retirer). Une
 * suggestion qui ne s'applique plus le dit, et part aussi ; une qui ne
 * changerait rien (déjà faite ailleurs) part sans un mot.
 *
 * Tout ce qui vient de Claude s'écrit en texte (textContent), jamais en
 * HTML (S1). Sur le site, par le connecteur (son adresse) ; sur claude.ai,
 * par la capacité `mcp` (les outils suggestions_lister et
 * suggestion_retirer doivent y être déclarés). Un refus de ce côté-là cache
 * la fonction pour la visite ; rien ne réessaie tout seul.
 *
 * Le carnet marque les partitions qui ont des suggestions en attente (le
 * site seulement : sur claude.ai, aucun appel au connecteur ne part sans un
 * geste).
 */
import { appliquerSuggestion, resumeSuggestion, validerSuggestion } from "./suggestions.js";
import { creerEcoute } from "./ecoute.js";
import { indexerParPas, pasParMesure, pasParTemps } from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { egal } from "./fiche.js";
import { expliquer } from "./erreurs.js";
import { ico } from "./icones.js";
import { $, el, toast } from "./ui.js";

// La liste de toutes les suggestions (pour marquer le carnet) se relit au plus toutes les cinq minutes.
const RELIRE_TOUT = 5 * 60 * 1000;
// Ces refus ne passeront pas d'eux-mêmes : la fonction se cache pour la visite (connecteur absent,
// refusé, outils pas déclarés sur claude.ai, connecteur d'avant les suggestions…).
const REFUS_DURABLES = new Set([
  "not_in_manifest", "server_not_connected", "server_not_found", "blocked_by_policy", "approval_required",
  "not_granted", "capability_disabled", "capability_removed", "consent_required", "user_changed",
  "sans_adresse", "adresse_invalide", "tool_error", "bad_request", "transform_error",
]);
const MUSIQUE = new Set(["accords", "suite", "variation"]);
// Ce qu'une suggestion peut changer d'une fiche : de quoi revenir en arrière, et vérifier qu'on le peut.
const CHAMPS = ["titre", "etiquettes", "note", "doutes", "sequence"];

/** « Les accords de Claude sont posés. » : ce qu'« Appliquer » vient de faire. */
function faitDe(p) {
  if (p.genre === "accords") return "Les accords de Claude sont posés.";
  if (p.genre === "suite") return "La suite de Claude est ajoutée.";
  if (p.genre === "variation") return "La variation de Claude remplace la mélodie.";
  if (p.doute !== undefined) return `L'avis de Claude est sur le doute n° ${p.doute + 1}.`;
  const faits = [p.titre !== undefined && "le titre", p.etiquettes !== undefined && "les étiquettes", p.note !== undefined && "la note"].filter(Boolean);
  return faits.length === 1 ? `${faits[0].charAt(0).toUpperCase()}${faits[0].slice(1)} de Claude ${faits[0] === "les étiquettes" ? "sont ajoutées" : faits[0] === "la note" ? "est ajoutée" : "est posé"}.` : "La suggestion de Claude est appliquée.";
}

/**
 * @param deps {
 *   appeler(outil, args) → la réponse du connecteur (tablette.js),
 *   actif() → les suggestions ont un sens ici (le site synchronisé, ou claude.ai),
 *   dansClaude(), transport (pour « Écouter »),
 *   surChange() (la liste des suggestions a changé : le carnet redessine ses marques)
 * }
 */
export function creerSuggestions(deps) {
  let desactivee = false;
  let parCible = new Map(); // cible → fiches de suggestion, d'après la dernière lecture
  let luesLe = 0;
  const traitees = new Set(); // les sid appliqués ou ignorés pendant la visite (si le retrait n'a pas pu partir)

  const possible = () => !desactivee && deps.actif();

  /** Un refus durable cache la fonction pour la visite ; une panne passagère attend le prochain geste. */
  function echecAppel(e) {
    const code = e && e.code;
    console.warn("Suggestions de Claude :", code || e);
    if (REFUS_DURABLES.has(code)) {
      desactivee = true;
      parCible = new Map();
      for (const b of Object.values(bandeaux)) b.vider();
      if (deps.surChange) deps.surChange();
    }
  }

  /** Les suggestions d'une partition (ou de toutes, `cible` null), d'après le connecteur. */
  async function lister(cible) {
    const r = await deps.appeler("suggestions_lister", cible ? { cible } : {});
    const fiches = Array.isArray(r && r.suggestions) ? r.suggestions.filter((s) => s && typeof s.sid === "string" && typeof s.cible === "string") : [];
    return fiches.filter((s) => !traitees.has(s.sid));
  }

  /** Retire une suggestion du connecteur (appliquée, ignorée, ou qui ne s'applique plus). */
  async function retirer(s) {
    traitees.add(s.sid);
    const restantes = (parCible.get(s.cible) || []).filter((x) => x.sid !== s.sid);
    parCible.set(s.cible, restantes);
    if (deps.surChange) deps.surChange();
    try {
      await deps.appeler("suggestion_retirer", { cible: s.cible, sid: s.sid });
    } catch (e) {
      // Elle reviendra à la prochaine visite : déjà faite, elle ne changera plus rien et partira sans un mot.
      console.warn("Suggestion pas retirée :", e);
    }
  }

  /**
   * Toutes les suggestions, pour marquer le carnet : sur le site, au plus
   * toutes les cinq minutes (après une synchronisation). Sur claude.ai,
   * jamais sans geste.
   */
  async function rafraichir() {
    if (!possible() || deps.dansClaude() || Date.now() - luesLe < RELIRE_TOUT) return;
    luesLe = Date.now();
    try {
      const fiches = await lister(null);
      parCible = Map.groupBy(fiches, (s) => s.cible);
      if (deps.surChange) deps.surChange();
    } catch (e) {
      echecAppel(e);
    }
  }

  /** Combien de suggestions attendent pour cette partition. */
  const pour = (id) => (possible() ? (parCible.get(id) || []).filter((s) => !traitees.has(s.sid)).length : 0);

  // ---------------------------------------------------------------------------
  // Le bandeau d'un écran
  // ---------------------------------------------------------------------------

  const bandeaux = {};

  /**
   * Le bandeau d'un écran : `conteneur` (dans la page) ; `ctx.fiche()` → la
   * partition telle que l'écran la montre (avec ce qui n'est pas encore
   * enregistré), `ctx.changer(f)` → pose la fiche `f` comme un seul geste,
   * rend false s'il ne peut pas (ce n'est plus elle).
   */
  function bandeau(nom, conteneur, ctx) {
    const ecoute = creerEcoute(deps.transport);
    let liste = []; // [{ fiche, proposition }]
    let id = null;
    let demande = 0;
    let deplie = false;

    function vider() {
      demande++;
      liste = [];
      id = null;
      ecoute.arreter();
      rendre();
    }

    function rendre() {
      conteneur.textContent = "";
      conteneur.hidden = !liste.length;
      if (!liste.length) return;
      const { fiche, proposition } = liste[0];
      const rang = el("div", "bandeau-rang");
      const quoi = el("button", "bandeau-quoi");
      quoi.type = "button";
      quoi.setAttribute("aria-expanded", String(deplie));
      quoi.title = deplie ? "Cacher pourquoi" : "Pourquoi ?";
      quoi.innerHTML = ico("etincelle", "s");
      quoi.appendChild(el("span", "bandeau-texte", resumeSuggestion(fiche)));
      if (liste.length > 1) quoi.appendChild(el("span", "bandeau-compte", `1 sur ${liste.length}`));
      quoi.addEventListener("click", () => { deplie = !deplie; rendre(); });
      rang.appendChild(quoi);
      const geste = (icone, texte, agir, { plein = false } = {}) => {
        const b = el("button", `btn btn-petit${plein ? " btn-plein" : ""}`);
        b.type = "button";
        b.setAttribute("aria-label", texte);
        b.title = texte;
        b.innerHTML = ico(icone, "s");
        b.appendChild(el("span", "bandeau-libelle", texte));
        b.addEventListener("click", () => agir(b));
        rang.appendChild(b);
        return b;
      };
      if (MUSIQUE.has(proposition.genre)) geste("lire", "Écouter", (b) => ecouter(liste[0], b));
      geste("ok", "Appliquer", () => appliquer(liste[0]), { plein: true });
      geste("fermer", "Ignorer", () => ignorer(liste[0]));
      conteneur.appendChild(rang);
      if (deplie) conteneur.appendChild(el("p", "bandeau-pourquoi", proposition.pourquoi ? `Pourquoi : ${proposition.pourquoi}` : "Claude n'a pas dit pourquoi."));
    }

    /** Ce que l'écran montre maintenant ; null si ce n'est plus la partition des suggestions. */
    const cible = () => {
      const f = ctx.fiche();
      return f && f.id === id ? f : null;
    };

    /** Une autre partition s'ouvre (ou aucune) : on lit ses suggestions, qu'on vérifie sur elle. */
    async function montrer(p) {
      vider();
      if (!p || !p.id || !possible()) return;
      id = p.id;
      const moi = ++demande;
      let fiches;
      try {
        fiches = await lister(p.id);
      } catch (e) {
        echecAppel(e);
        return;
      }
      if (moi !== demande) return; // une autre partition s'est ouverte entre-temps
      parCible.set(p.id, fiches);
      if (deps.surChange) deps.surChange();
      const f = cible() || p;
      const valables = [];
      for (const s of fiches) {
        const v = validerSuggestion(s, f);
        if (v.ok) { valables.push({ fiche: s, proposition: v.proposition }); continue; }
        // Elle ne changerait rien (déjà faite sur un autre appareil, un doute déjà réglé) : elle part sans un mot.
        retirer(s);
        if (!v.sansEffet) toast(`Cette suggestion ne peut pas s'appliquer (${v.raison}) : elle est retirée.`, 7000);
      }
      liste = valables;
      deplie = false;
      rendre();
    }

    /** L'idée avec la proposition, jouée sans rien écrire. Le même bouton arrête. */
    async function ecouter(item, bouton) {
      if (ecoute.cle === bouton) { ecoute.arreter(); return; }
      const f = cible();
      if (!f) return;
      const v = validerSuggestion(item.fiche, f);
      if (!v.ok) { ecarter(item, v); return; }
      const seq = appliquerSuggestion(f, v.proposition).sequence;
      const { notesA, fin } = indexerParPas(voixCompletes(seq).flatMap((x) => x.notes));
      // Une suite s'écoute depuis la mesure d'avant : on entend d'où elle part.
      const depuis = v.proposition.genre === "suite" ? Math.max(0, v.proposition.origine - pasParMesure(seq)) : 0;
      const remettre = () => { bouton.innerHTML = ico("lire", "s"); bouton.appendChild(el("span", "bandeau-libelle", "Écouter")); bouton.setAttribute("aria-label", "Écouter"); bouton.title = "Écouter"; };
      const lecture = ecoute.jouer(bouton, () => ({ tempo: seq.tempo, mesure: pasParMesure(seq), temps: pasParTemps(seq), fin, notesA }), {
        depuis, titre: `${f.titre} : ${resumeSuggestion(item.fiche)}`, surArret: remettre,
      });
      bouton.innerHTML = ico("stop", "s");
      bouton.appendChild(el("span", "bandeau-libelle", "Arrêter"));
      bouton.setAttribute("aria-label", "Arrêter");
      bouton.title = "Arrêter";
      try {
        await lecture;
      } catch (e) {
        console.error(e);
        toast(expliquer(e, "Le piano n'a pas pu se charger."));
      }
    }

    /** Revalidée sur la partition telle qu'elle est, posée en un geste, puis retirée du connecteur. */
    function appliquer(item) {
      const avant = cible();
      if (!avant) return;
      const v = validerSuggestion(item.fiche, avant);
      if (!v.ok) { ecarter(item, v); return; }
      const nouvelle = appliquerSuggestion(avant, v.proposition);
      ecoute.arreter();
      if (!ctx.changer(nouvelle)) { toast("La partition s'enregistre encore : réessaie dans un instant."); return; }
      liste = liste.filter((x) => x !== item);
      rendre();
      retirer(item.fiche);
      // Un seul geste, un seul « Annuler » : tant que rien d'autre n'a changé.
      proposerAnnuler(faitDe(v.proposition), () => {
        const ici = cible();
        const intacte = ici && CHAMPS.every((c) => egal(ici[c], nouvelle[c]) || (c === "sequence" && !nouvelle.sequence));
        if (!intacte) { toast(nom === "idee" ? "L'idée a changé depuis : « Annuler », dans l'éditeur, défait les gestes un par un." : "La page a changé depuis : rien n'a été défait."); return; }
        ctx.changer(avant);
      });
    }

    function ignorer(item) {
      ecoute.arreter();
      liste = liste.filter((x) => x !== item);
      rendre();
      retirer(item.fiche);
    }

    /** Elle ne s'applique plus (la partition a changé depuis) : on le dit, et elle part. */
    function ecarter(item, v) {
      liste = liste.filter((x) => x !== item);
      rendre();
      retirer(item.fiche);
      if (!v.sansEffet) toast(`Cette suggestion ne peut pas s'appliquer (${v.raison}) : elle est retirée.`, 7000);
    }

    bandeaux[nom] = { montrer, vider };
    return bandeaux[nom];
  }

  /** « C'est fait » avec « Annuler » : un message passager qui propose un geste (comme « Recharger »). */
  function proposerAnnuler(texte, annuler) {
    const avant = $("toast-annuler-suggestion");
    if (avant) avant.remove();
    const m = el("div", "toast toast-action");
    m.id = "toast-annuler-suggestion";
    m.setAttribute("role", "status");
    m.setAttribute("popover", "manual");
    const b = el("button", "btn btn-petit", "Annuler");
    b.type = "button";
    b.addEventListener("click", () => { m.remove(); annuler(); });
    m.append(el("span", "", texte), b);
    document.body.appendChild(m);
    if (m.showPopover) { try { m.showPopover(); } catch { /* sans popover : il s'affiche quand même */ } }
    setTimeout(() => m.remove(), 10000);
  }

  return {
    bandeau, rafraichir, pour,
    /** Montre les suggestions de `p` dans le bandeau de l'écran `nom` (null : aucune partition). */
    montrer: (nom, p) => (bandeaux[nom] ? bandeaux[nom].montrer(p) : undefined),
  };
}
