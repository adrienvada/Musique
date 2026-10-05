/**
 * L'ÉDITEUR D'IDÉE : DEMANDER À CLAUDE (H2, la version claude.ai)
 *
 * Une feuille du bas (#idee-claude), ouverte depuis le « ••• » de l'idée
 * (sur toute l'idée) ou depuis la boîte à outils de la sélection (sur les
 * notes choisies). Cinq demandes : des accords, une suite de deux mesures,
 * une variation (plus calme, plus sautillante, en mineur, plus ornée), un
 * titre et des étiquettes, ou ce que tu veux, dit en une phrase.
 *
 * Le principe (audit du 04/10, H2) : sur l'ABC et les notes, les meilleurs
 * modèles réussissent environ la moitié des exercices publics. Claude
 * propose, Portée vérifie chaque réponse avant de la montrer
 * (claude-idee.js : durées, hauteurs, accords, place), et Adrien écoute puis
 * choisit. Rien ne s'écrit sans son geste (« Garder »), et ce qu'il garde
 * s'écrit d'un coup : un seul « Annuler » le défait.
 *
 * Seulement quand claude.ai donne `sample` (claude.use("sample")) : sur le
 * site, la fonction n'existe pas, et ni la feuille ni ses entrées ne se
 * montrent (rien de grisé). Chaque appel part d'un geste d'Adrien, jamais en
 * boucle ni au chargement ; il a son AbortController et un bouton
 * « Arrêter » ; « Claude réfléchit… » tant que rien n'est venu (5 à 60 s,
 * plus avec des outils). Ce que Claude écrit est du JSON : il ne se montre
 * jamais. Une réponse que Portée refuse ne s'applique pas, et l'écran le dit
 * sans détail (la raison va à la console). Jamais de nouvel essai tout seul.
 *
 * Reçoit du cœur (ctx) : e (l'état, en lecture seule), $, transport, toast,
 *   avantSon() et apresSon() (le micro se tait pendant l'écoute),
 *   etiquettes() → celles de la bibliothèque, et les deux seules écritures,
 *   qui passent par le cœur : remplacerIdee(seq, options) (par `modifier` :
 *   un seul « Annuler ») et changerTitre(titre, etiquettes).
 * Rend : { ouvrir({ selection }), fermer(), disponible }.
 */
import { INTENTIONS, MESSAGE_REFUS, appliquer, demande, empechement, etendueEcoute, lireEchec, nettoyer, resume, valider } from "./claude-idee.js";
import { outilsSurCopie } from "./claude-outils.js";
import { cloner, indexerParPas, nbMesures, nomTonalite, pasParMesure, pasParTemps } from "./sequence.js";
import { STYLES, accordsDeLaMelodie, familleDe, joliAccord, lireAccord, roueDeLaTonalite, voixCompletes } from "./harmonie.js";
import { lieuDuChoix } from "./idee-selection.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { ico } from "./icones.js";
import { echapper, pluriel } from "./ui.js";
import { expliquer } from "./erreurs.js";

/** Les cinq demandes, dans l'ordre de la feuille ; `aide` dit sur quoi elle porte. */
const DEMANDES = [
  { genre: "accords", icone: "accords", nom: "Des accords", aide: (sel) => (sel ? "pour les mesures des notes choisies" : "pour toute l'idée, d'après ta mélodie") },
  { genre: "suite", icone: "suivant", nom: "Une suite", aide: () => "deux mesures de plus, après la fin" },
  { genre: "variation", icone: "crayon", nom: "Une variation", aide: (sel) => (sel ? "des notes choisies : plus calme, plus ornée…" : "de toute la piste : plus calme, plus ornée…") },
  { genre: "titre", icone: "etiquette", nom: "Un titre et des étiquettes", aide: () => "pour la retrouver dans ton carnet" },
  { genre: "libre", icone: "bulle", nom: "Ce que tu veux", aide: () => "dis-le-lui en une phrase" },
];

/** Ce que dit l'appli quand Adrien a gardé : comment le défaire. */
const GARDE = {
  accords: "Accords gardés : «\u00a0Annuler\u00a0» les retire.",
  suite: "Suite gardée : «\u00a0Annuler\u00a0» la retire.",
  variation: "Variation gardée : «\u00a0Annuler\u00a0» rend les notes d'avant.",
  libre: "C'est fait : «\u00a0Annuler\u00a0» rend l'idée d'avant.",
  titre: "Titre et étiquettes gardés.",
};

const CHANGEE = "L'idée a changé pendant que Claude réfléchissait (sur un autre appareil ?) : redemande-lui.";
const MENU_AUTORISATIONS = "Pour autoriser Claude, ouvre le menu Autorisations de cette page, sur claude.ai, puis redemande.";
const SANS_PANNEAU = "Claude n'est pas autorisé pour cette page : autorise-le dans son menu Autorisations, sur claude.ai, puis redemande.";
const AIDE_LIBRE = "En une phrase, avec tes mots. Rien ne change avant que tu aies écouté et gardé.";
const ETAPES = ["genres", "intentions", "libre", "attente", "proposition", "message"];

const majuscule = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);
/** « texte », avec des espaces insécables : un guillemet ne reste jamais seul en bout de ligne. */
const entreGuillemets = (t) => `«\u00a0${t}\u00a0»`;

export function creerClaude(ctx) {
  const { e, $ } = ctx;
  const feuille = brancherFeuille($("idee-claude"), { surFermer: () => oublier() });
  // window.claude est là avant les scripts de la page, dans claude.ai ; ailleurs, jamais (claude.d.ts).
  const claude = globalThis.claude;
  let sample = null;          // la fonction de claude.ai, ou null : sur le site, la fonction n'existe pas
  let limites = null;         // sample.limits() : `tools` quand la page peut offrir des outils
  let disponible = false;     // les entrées se montrent ; faux pour la visite si claude.ai refuse
  let outilsPermis = false;   // « Ce que tu veux » avec les outils de claude-outils.js
  let permissions = null;     // la promesse de claude.use("permissions"), cherchée la première fois qu'elle sert
  let surSelection = false;   // ouverte depuis la boîte à outils : les notes choisies
  let precision = { intention: null, phrase: "" };
  let dernier = null;         // la dernière demande (« Une autre », « Réessayer »)
  let appel = null;           // la demande partie : { genre, options, idee, session, version, controleur, atelier, gestes }
  let proposition = null;     // ce que Claude propose, vérifié : { ici, genre, valeur, nouvelle, etendue }
  let style = "plaque";       // l'accompagnement pour écouter (et garder) des accords
  let ecoute = false, tete = null;

  // --- La fonction existe-t-elle ? --------------------------------------------------

  async function trouver() {
    if (!claude || typeof claude.use !== "function") return;
    // use() ne demande rien à Adrien et ne coûte rien (claude.d.ts) ; l'accord se demande au premier appel.
    const s = await Promise.resolve().then(() => claude.use("sample")).catch(() => null);
    if (typeof s !== "function" || typeof s.json !== "function") return;
    sample = s;
    limites = typeof s.limits === "function" ? await s.limits().catch(() => null) : null;
    outilsPermis = !!(limites && limites.tools && limites.tools.maxCount > 0);
    disponible = true;
    montrerEntrees();
  }

  /** Le « ••• » de l'idée et la boîte à outils : « Demander à Claude » s'y montre, ou pas du tout. */
  function montrerEntrees() {
    for (const b of document.querySelectorAll("[data-avec-claude]")) b.hidden = !disponible;
  }

  /** Le panneau des autorisations de claude.ai (permissions.d.ts : intégré, jamais déclaré), ou null. */
  function panneauDesAutorisations() {
    // La promesse elle-même est gardée : deux demandes rapprochées ne cherchent pas deux fois.
    if (!permissions) permissions = Promise.resolve().then(() => claude.use("permissions")).catch(() => null);
    return permissions.then((p) => (p && typeof p.manage === "function" ? p : null));
  }

  // --- Ouvrir, les étapes ---------------------------------------------------------

  /** Ouvre la feuille ; `selection` : depuis la boîte à outils, sur les notes choisies. */
  function ouvrir({ selection = false } = {}) {
    if (!disponible || !e.ouverte) return;
    if (e.enregistrement) { ctx.toast("Arrête d'abord le jeu en direct."); return; }
    oublier();
    surSelection = !!selection && e.selection.size > 0;
    precision = { intention: null, phrase: $("claude-phrase").value };
    revenirAuxGenres();
    ouvrirFeuille(feuille);
    focaliser();
  }

  function allerA(etape) {
    for (const x of ETAPES) $(`claude-${x}`).hidden = x !== etape;
    $("claude-retour").hidden = etape === "genres" || etape === "attente";
  }

  /** Le premier bouton utile de l'étape montrée (au clavier, et pour le lecteur d'écran). */
  function focaliser() {
    const etape = ETAPES.find((x) => !$(`claude-${x}`).hidden);
    const cible = {
      genres: () => $("claude-genres").querySelector("button:not([disabled])"),
      intentions: () => $("claude-intentions-choix").querySelector("button"),
      libre: () => $("claude-phrase"),
      attente: () => $("claude-arreter"),
      // Un titre : « Garder », pas son champ (au téléphone, le clavier monterait par-dessus la proposition).
      proposition: () => (proposition && proposition.genre === "titre" ? $("claude-garder") : $("claude-ecouter")),
      message: () => [$("claude-autoriser"), $("claude-reessayer"), $("claude-retour")].find((b) => !b.hidden),
    }[etape];
    const el = cible && cible();
    if (el) el.focus();
  }

  function revenirAuxGenres() {
    oublier();
    majSur();
    majGenres();
    allerA("genres");
  }

  /** Sur quoi porte la demande, sous le titre de la feuille. */
  function majSur() {
    const zone = $("claude-sur");
    if (surSelection) {
      const sel = e.seq.pistes[e.piste].notes.filter((n) => e.selection.has(n.id));
      zone.textContent = `Sur ${sel.length > 1 ? `les ${sel.length} notes choisies` : "la note choisie"}, ${lieuDuChoix(sel, pasParMesure(e.seq))}.`;
      return;
    }
    const total = e.seq.pistes.reduce((t, p) => t + p.notes.length, 0);
    zone.textContent = total
      ? `Sur toute l'idée : ${pluriel(nbMesures(e.seq), "mesure")}, ${nomTonalite(e.seq.tonalite).toLowerCase()}.`
      : "Ton idée est encore vide : Claude peut l'écrire d'après ta phrase.";
  }

  function optionsDe() {
    return {
      selection: surSelection ? { piste: e.piste, ids: [...e.selection] } : undefined,
      piste: e.piste,
      intention: precision.intention,
      phrase: precision.phrase,
      titre: e.titre,
      etiquettes: [...e.etiquettes],
      etiquettesConnues: ctx.etiquettes ? ctx.etiquettes() : [],
    };
  }

  /** Les cinq demandes ; celle qui n'aurait pas d'objet dit pourquoi, au lieu de partir (empechement). */
  function majGenres() {
    const options = optionsDe();
    $("claude-genres").innerHTML = DEMANDES.map((d) => {
      // Une variation attend son intention, « Ce que tu veux » sa phrase : on regarde ce qui empêcherait le reste.
      const raison = empechement(d.genre, e.seq, { ...options, intention: Object.keys(INTENTIONS)[0], phrase: "…" });
      return `<button class="claude-genre" type="button" data-genre="${d.genre}"${raison ? " disabled" : ""}>${ico(d.icone, "l")}<span class="claude-genre-texte"><span class="nom">${d.nom}</span><span class="aide">${echapper(raison || d.aide(surSelection))}</span></span></button>`;
    }).join("");
  }

  $("claude-intentions-choix").innerHTML = Object.keys(INTENTIONS)
    .map((k) => `<button class="btn claude-intention" type="button" data-intention="${echapper(k)}">${echapper(majuscule(k))}</button>`).join("");

  function choisirGenre(genre) {
    if (genre === "variation") { allerA("intentions"); focaliser(); return; }
    if (genre === "libre") { allerA("libre"); $("claude-libre-aide").textContent = AIDE_LIBRE; focaliser(); return; }
    demander(genre);
  }

  function envoyerPhrase() {
    precision.phrase = $("claude-phrase").value;
    const raison = empechement("libre", e.seq, optionsDe());
    if (raison) { $("claude-libre-aide").textContent = raison; $("claude-phrase").focus(); return; }
    demander("libre");
  }

  /** Après « Arrêter » : là où l'on était avant de demander. */
  const etapeAvant = (genre) => (genre === "variation" ? "intentions" : genre === "libre" ? "libre" : "genres");

  // --- Demander, recevoir --------------------------------------------------------

  const aJour = (ici) => e.ouverte && e.session === ici.session && e.version === ici.version;

  async function demander(genre) {
    if (!disponible || !sample || !e.ouverte) return;
    dernier = genre;
    arreterEcoute();
    proposition = null;
    // Une copie de ce qui part : la réponse se vérifie et s'applique sur elle, et si
    // l'idée change entre-temps (la synchro), rien ne s'applique (aJour).
    const idee = cloner(e.seq);
    const options = optionsDe();
    const raison = empechement(genre, idee, options);
    if (raison) { montrerMessage(raison, { reessayer: false }); return; }
    const ici = { genre, options, idee, session: e.session, version: e.version, controleur: new AbortController(), atelier: null, gestes: [] };
    if (genre === "libre" && outilsPermis) {
      ici.atelier = outilsSurCopie(idee, { max: limites.tools.maxCount, surGeste: (fait) => progres(ici, fait) });
      options.outils = ici.atelier.outils;
    }
    let d;
    try {
      d = demande(genre, idee, options);
    } catch (err) {
      console.error(err);
      montrerMessage(expliquer(err), { reessayer: false });
      return;
    }
    appel = ici;
    $("claude-reflechit").textContent = "Claude réfléchit…";
    $("claude-progres").hidden = true;
    $("claude-progres").textContent = "";
    // Ce qu'on peut attendre (sample.d.ts) : le modèle rapide pour un titre, plusieurs tours avec les outils.
    $("claude-attente-aide").textContent = genre === "titre" ? "Quelques secondes. Portée vérifie sa réponse avant de te la montrer."
      : ici.atelier ? "Avec ses outils, souvent 30 à 90 secondes. Portée revérifie la copie avant de te la montrer."
        : "Souvent 10 à 60 secondes. Portée vérifie sa réponse avant de te la montrer.";
    allerA("attente");
    focaliser();
    let reponse;
    try {
      reponse = await sample.json(d.input, {
        ...d.opts,
        signal: ici.controleur.signal,
        // Ce qu'il écrit est du JSON : on ne le montre pas, on dit seulement qu'il écrit.
        onText: () => { if (appel === ici) $("claude-reflechit").textContent = ici.atelier ? "Claude travaille sur une copie de l'idée…" : "Claude écrit sa proposition…"; },
      });
    } catch (err) {
      if (appel !== ici) return; // arrêtée, fermée, ou une autre demande est partie
      appel = null;
      await echouer(err, genre);
      return;
    }
    if (appel !== ici) return;
    appel = null;
    recevoir(ici, reponse);
  }

  /** Un geste que Claude vient de faire sur la copie (« Ce que tu veux », avec outils). */
  function progres(ici, fait) {
    if (appel !== ici) return;
    ici.gestes.push(fait);
    const zone = $("claude-progres");
    zone.hidden = false;
    zone.textContent = `Sur la copie : ${ici.gestes.join(" ; ")}.`;
  }

  function arreterDemande() {
    const ici = appel;
    if (!ici) return;
    appel = null;
    ici.controleur.abort();
    allerA(etapeAvant(ici.genre));
    focaliser();
  }

  function recevoir(ici, reponse) {
    if (!aJour(ici)) { montrerMessage(CHANGEE); return; }
    const options = ici.atelier ? { ...ici.options, copie: ici.atelier.copie() } : ici.options;
    const r = valider(ici.genre, reponse, ici.idee, options);
    if (!r.ok) {
      // La raison exacte sert à la console : Adrien n'a pas à lire ce qui clochait dans le JSON.
      console.info(`Demander à Claude (${ici.genre}) : Portée refuse la proposition : ${r.raison}`);
      if ("pourquoi" in r) montrerMessage("Claude n'a rien changé.", { pourquoi: r.pourquoi });
      else montrerMessage(MESSAGE_REFUS);
      return;
    }
    const nouvelle = appliquer(ici.genre, ici.idee, r.proposition, options);
    proposition = { ici, genre: ici.genre, valeur: r.proposition, nouvelle, etendue: etendueEcoute(ici.genre, r.proposition, ici.idee, nouvelle) };
    if (ici.genre === "accords") style = nouvelle.accompagnement && nouvelle.accompagnement !== "aucun" ? nouvelle.accompagnement : "plaque";
    afficherProposition();
    allerA("proposition");
    focaliser();
  }

  async function echouer(err, genre) {
    const lu = lireEchec(err);
    if (!lu) {
      // Pas une erreur de `sample` : une erreur de Portée ou du navigateur, dite par erreurs.js.
      console.error("Demander à Claude :", err);
      montrerMessage(expliquer(err));
      return;
    }
    if (lu.code === "cancelled") { allerA(etapeAvant(genre)); focaliser(); return; }
    console.warn(`Demander à Claude : ${lu.code}`, err && err.message);
    if (lu.sansOutils) outilsPermis = false;
    if (lu.cacher) { disponible = false; montrerEntrees(); }
    const autoriser = lu.autoriser ? await panneauDesAutorisations() : null;
    // Sans panneau à ouvrir d'ici, la phrase dit où autoriser Claude.
    const texte = lu.autoriser && !autoriser ? SANS_PANNEAU : lu.texte;
    montrerMessage(texte, { reessayer: !lu.cacher, autoriser: !!autoriser });
  }

  function montrerMessage(texte, { pourquoi = "", reessayer = true, autoriser = false } = {}) {
    arreterEcoute();
    $("claude-message-texte").textContent = texte;
    const pq = $("claude-message-pourquoi");
    pq.hidden = !pourquoi;
    pq.textContent = pourquoi ? entreGuillemets(pourquoi) : "";
    $("claude-autoriser").hidden = !autoriser;
    $("claude-reessayer").hidden = !reessayer || !dernier || !disponible;
    allerA("message");
    focaliser();
  }

  /** « Autoriser Claude » : le panneau des autorisations de claude.ai, puis on relit l'état (permissions.d.ts). */
  async function autoriser() {
    const p = await panneauDesAutorisations();
    if (!p) { montrerMessage(MENU_AUTORISATIONS, { reessayer: false }); return; }
    try {
      await p.manage();
    } catch {
      montrerMessage(MENU_AUTORISATIONS, { reessayer: false });
      return;
    }
    const etat = await Promise.resolve().then(() => p.state("sample")).catch(() => "unavailable");
    if (etat !== "granted" && etat !== "prompt") {
      montrerMessage("Claude n'est toujours pas autorisé pour cette page.", { reessayer: false, autoriser: true });
      return;
    }
    disponible = true;
    montrerEntrees();
    revenirAuxGenres();
    focaliser();
    ctx.toast("Claude est autorisé pour cette page : redemande-lui.");
  }

  // --- Montrer la proposition ----------------------------------------------------

  function afficherProposition() {
    const p = proposition;
    const dit = resume(p.genre, p.valeur, p.ici.idee, p.nouvelle);
    $("claude-resume").textContent = majuscule(dit);
    $("claude-resume").hidden = !dit;
    const apercu = $("claude-apercu");
    apercu.hidden = p.genre === "titre";
    apercu.innerHTML = p.genre === "accords" ? bande(p) : p.genre === "titre" ? "" : rouleau(p, dit);
    $("claude-styles-bloc").hidden = p.genre !== "accords";
    if (p.genre === "accords") majStyles();
    $("claude-champs").hidden = p.genre !== "titre";
    if (p.genre === "titre") {
      $("claude-titre-champ").value = p.nouvelle.titre;
      $("claude-etiquettes-champ").value = p.nouvelle.etiquettes.join(", ");
    }
    const pq = $("claude-pourquoi");
    pq.hidden = !p.valeur.pourquoi;
    pq.textContent = p.valeur.pourquoi ? entreGuillemets(p.valeur.pourquoi) : "";
    $("claude-ecouter").hidden = p.genre === "titre";
    majEcoute();
  }

  /** L'accord que Portée aussi trouve d'après la mélodie (harmonie.js) : la même racine, la même triade. */
  function vaAvecLaMelodie(seq, a, fin, roue) {
    const lu = lireAccord(a.nom);
    const r = lu && roue.find((x) => x.racine === lu.racine && x.qualite === familleDe(lu));
    return !!r && accordsDeLaMelodie(seq, a.d, fin).includes(r.nom);
  }

  /**
   * La bande des mesures, comme dans la feuille des accords : chaque mesure
   * et ce que Claude y pose, « avant » quand il remplace un accord, teinté
   * quand Portée trouve aussi qu'il va avec la mélodie (une comparaison
   * avec harmonie.js, pas un verdict).
   */
  function bande(p) {
    const seq = p.nouvelle, avant = p.ici.idee;
    const ppm = pasParMesure(seq), ppt = pasParTemps(seq);
    const roue = roueDeLaTonalite(seq.tonalite);
    let html = "", teintes = 0;
    for (let m = p.valeur.debut / ppm; m < p.valeur.fin / ppm; m++) {
      const debut = m * ppm, fin = debut + ppm;
      const ici = p.valeur.accords.filter((a) => a.d >= debut && a.d < fin);
      const avaient = (avant.accords || []).filter((a) => a.d >= debut && a.d < fin);
      const places = ici.map((a, k) => {
        const va = vaAvecLaMelodie(seq, a, k + 1 < ici.length ? ici[k + 1].d : fin, roue);
        if (va) teintes++;
        // Le temps de tout accord qui n'est pas sur le premier (même s'il est seul dans sa mesure).
        const t = (a.d - debut) / ppt + 1;
        const temps = t > 1 ? `<span class="claude-temps mono">${t}ᵉ temps</span>` : "";
        return `<span class="claude-accord${va ? " melodie" : ""}">${temps}${echapper(joliAccord(a.nom))}</span>`;
      });
      const changes = avaient.length && avaient.map((a) => a.nom).join(" ") !== ici.map((a) => a.nom).join(" ");
      html += `<div class="claude-mesure" data-mesure="${m}"><span class="claude-num mono">${m + 1}</span>`
        + `<span class="claude-accords">${places.join("") || '<span class="claude-accord rien" title="L\'accord d\'avant continue">·</span>'}</span>`
        + (changes ? `<span class="claude-avant">avant : ${echapper(avaient.map((a) => joliAccord(a.nom)).join(", "))}</span>` : "")
        + "</div>";
    }
    const legende = teintes ? '<p class="remarque claude-legende"><i class="claude-pastille claude-melodie" aria-hidden="true"></i>Teinté : Portée trouve aussi qu\'il va avec ta mélodie.</p>' : "";
    return `<div class="claude-bande" role="group" aria-label="Les accords proposés, mesure par mesure">${html}</div>${legende}`;
  }

  /**
   * Un mini rouleau de piano des mesures qui changent : ce qui reste en gris,
   * ce que Claude propose en bleu, ce qui partirait en pointillé. Une suite se
   * voit après la dernière mesure, dans sa zone.
   */
  function rouleau(p, dit) {
    const seq = p.nouvelle, avant = p.ici.idee;
    const [a, b] = p.etendue;
    const ppm = pasParMesure(seq), ppt = pasParTemps(seq);
    const dedans = (n) => n.d < b && n.d + n.l > a;
    const cle = (i, n) => `${i}:${n.d},${n.l},${n.h}`;
    // Les notes d'avant, par valeur : une note identique à une note d'avant reste ; les autres arrivent ou partent.
    const restent = new Map();
    avant.pistes.forEach((piste, i) => piste.notes.filter(dedans).forEach((n) => restent.set(cle(i, n), (restent.get(cle(i, n)) || 0) + 1)));
    const notes = [];
    seq.pistes.forEach((piste, i) => piste.notes.filter(dedans).forEach((n) => {
      const k = cle(i, n);
      if (restent.get(k)) { restent.set(k, restent.get(k) - 1); notes.push({ n, classe: "claude-reste" }); } else notes.push({ n, classe: "claude-propose" });
    }));
    avant.pistes.forEach((piste, i) => piste.notes.filter(dedans).forEach((n) => {
      const k = cle(i, n);
      if (restent.get(k)) { restent.set(k, restent.get(k) - 1); notes.push({ n, classe: "claude-remplace" }); }
    }));
    const hs = notes.map((x) => x.n.h);
    const haut = hs.length ? Math.max(...hs) : 72, bas = hs.length ? Math.min(...hs) : 60;
    const etendue = Math.max(12, haut - bas), sommet = (haut + bas) / 2 + etendue / 2;
    const zone = 92, y0 = 18; // sous les numéros des mesures
    const pente = zone / (etendue + 1);
    const epaisseur = Math.max(3, Math.min(8, pente * 0.85));
    const x = (pas) => ((Math.max(a, Math.min(b, pas)) - a) / (b - a)) * 100;
    let html = "";
    if (p.genre === "suite") {
      const f = nbMesures(avant) * ppm;
      html += `<i class="claude-zone" style="left:${x(f).toFixed(2)}%;width:${(x(b) - x(f)).toFixed(2)}%"></i>`;
    }
    for (let m = a; m < b; m += ppm) {
      html += `<i class="claude-barre" style="left:${x(m).toFixed(2)}%"></i><span class="claude-num-mesure mono" style="left:${x(m).toFixed(2)}%">${m / ppm + 1}</span>`;
      for (let t = m + ppt; t < Math.min(b, m + ppm); t += ppt) html += `<i class="claude-temps-trait" style="left:${x(t).toFixed(2)}%"></i>`;
    }
    // Ce qui part d'abord, dessous ; ce qui reste, puis ce qui arrive, par-dessus.
    const ordre = { "claude-remplace": 0, "claude-reste": 1, "claude-propose": 2 };
    html += notes.sort((u, v) => ordre[u.classe] - ordre[v.classe]).map(({ n, classe }) => {
      const g = x(n.d), largeur = x(n.d + n.l) - g;
      return `<i class="claude-note ${classe}" style="left:${g.toFixed(2)}%;width:calc(${largeur.toFixed(2)}% - 1px);top:${(y0 + (sommet - n.h) * pente).toFixed(1)}px;height:${epaisseur.toFixed(1)}px"></i>`;
    }).join("");
    html += '<i class="claude-tete" id="claude-tete" hidden></i>';
    // La légende ne dit que ce qui est dessiné.
    const presentes = new Set(notes.map((n) => n.classe));
    const legende = `<p class="remarque claude-legende">${[["claude-propose", "proposé"], ["claude-reste", "sans changement"], ["claude-remplace", "remplacé"]]
      .filter(([classe]) => presentes.has(classe))
      .map(([classe, dit]) => `<span><i class="claude-pastille ${classe}" aria-hidden="true"></i> ${dit}</span>`).join(" ")}</p>`;
    // Assez de place par mesure pour lire les notes : au-delà, la zone défile.
    const largeurMin = Math.round(((b - a) / ppm) * 72);
    return `<div class="claude-defil"><div class="claude-rouleau" role="img" aria-label="${echapper(majuscule(dit))}" style="min-width:${largeurMin}px">${html}</div></div>${legende}`;
  }

  function majStyles() {
    $("claude-styles").innerHTML = STYLES.map((s) => `<button type="button" data-style="${s.id}" aria-pressed="${s.id === style}">${echapper(s.nom)}</button>`).join("");
  }

  /** Le style d'accompagnement des accords proposés : on l'entend tout de suite, et il se garde avec eux. */
  function changerStyle(id) {
    if (!STYLES.some((s) => s.id === id) || id === style) return;
    style = id;
    majStyles();
    if (ecoute) { arreterEcoute(); ecouter(); }
  }

  // --- Écouter, sans rien écrire -------------------------------------------------

  /** Ce qu'on écoute et ce qu'on garde : la séquence proposée, avec l'accompagnement choisi pour des accords. */
  const aGarder = (p) => (p.genre === "accords" ? { ...p.nouvelle, accompagnement: style } : p.nouvelle);

  function majEcoute() {
    const b = $("claude-ecouter");
    b.setAttribute("aria-pressed", String(ecoute));
    b.innerHTML = `${ico(ecoute ? "stop" : "lire", "s")}<span>${ecoute ? "Arrêter" : "Écouter"}</span>`;
  }

  function arreterEcoute() {
    if (ecoute) ctx.transport.arreter(); // surFin remet le bouton et le micro en ordre
  }

  /** Joue la proposition là où elle change (etendueEcoute), accompagnement compris, sans toucher à l'idée. */
  async function ecouter() {
    if (ecoute) { arreterEcoute(); return; }
    const p = proposition;
    if (!p || !p.etendue) return;
    const seq = aGarder(p);
    const [debut, fin] = p.etendue;
    const { notesA, fin: finNotes, vide } = indexerParPas(voixCompletes(seq).flatMap((v) => v.notes).filter((n) => n.d >= debut && n.d < fin));
    if (vide) return;
    const surFin = () => { ecoute = false; tete = null; placerTete(); majEcoute(); ctx.apresSon(); };
    ctx.avantSon();
    ecoute = true;
    majEcoute();
    try {
      await ctx.transport.jouer(
        () => ({ tempo: seq.tempo, mesure: pasParMesure(seq), temps: pasParTemps(seq), fin: finNotes, notesA }),
        { depuis: debut, surFin, surPosition: (pas) => { tete = pas; placerTete(); } },
      );
    } catch (err) {
      surFin();
      ctx.toast(expliquer(err, "Le piano n'a pas pu se charger."));
    }
  }

  /** La tête de lecture dans le rouleau ; dans la bande des accords, la mesure qui joue s'allume. */
  function placerTete() {
    const p = proposition;
    const t = $("claude-tete");
    if (t && p && p.etendue) {
      const [a, b] = p.etendue;
      const x = tete === null ? -1 : (tete - a) / (b - a);
      t.hidden = !(x >= 0 && x < 1);
      t.style.left = `${(x * 100).toFixed(2)}%`;
    }
    const ppm = p ? pasParMesure(p.nouvelle) : 16;
    for (const c of $("claude-apercu").querySelectorAll("[data-mesure]")) {
      c.classList.toggle("joue", tete !== null && Math.floor(tete / ppm) === Number(c.dataset.mesure));
    }
  }

  // --- Garder : une seule écriture, un seul « Annuler » ------------------------------

  const nouvellesNotes = (avant, apres, piste) => {
    const vues = new Set(avant.pistes[piste].notes.map((n) => n.id));
    return apres.pistes[piste].notes.filter((n) => !vues.has(n.id)).map((n) => n.id);
  };

  function garder() {
    const p = proposition;
    if (!p) return;
    if (!aJour(p.ici)) { proposition = null; montrerMessage(CHANGEE); return; }
    arreterEcoute();
    if (p.genre === "titre") {
      // Les champs qu'Adrien a pu retoucher ; un titre vide redevient celui du jour (le cœur s'en charge).
      const titre = nettoyer($("claude-titre-champ").value);
      // En minuscules et 40 caractères au plus : la forme que la bibliothèque leur donne (fiche.js).
      const etiquettes = [...new Set($("claude-etiquettes-champ").value.split(",").map((t) => nettoyer(t).toLowerCase().slice(0, 40)).filter(Boolean))];
      ctx.changerTitre(titre, etiquettes);
    } else {
      const seq = aGarder(p);
      // Une variation des notes choisies : ce sont les nouvelles notes qu'on voit choisies ensuite.
      const choisir = surSelection && p.genre === "variation" ? nouvellesNotes(p.ici.idee, seq, p.valeur.piste) : null;
      ctx.remplacerIdee(seq, { choisir, curseurALaFin: p.genre === "suite" });
    }
    proposition = null;
    fermerFeuille(feuille);
    ctx.toast(GARDE[p.genre]);
  }

  // --- Les gestes de la feuille ----------------------------------------------------

  /** La feuille se ferme (ou l'éditeur) : la demande en route s'arrête, l'écoute se tait, rien ne s'écrit. */
  function oublier() {
    if (appel) { const ici = appel; appel = null; ici.controleur.abort(); }
    arreterEcoute();
    proposition = null;
    tete = null;
  }

  feuille.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !feuille.contains(b) || b.disabled) return;
    if (b.hasAttribute("data-fermer")) { fermerFeuille(feuille); return; }
    if (b.dataset.genre) { choisirGenre(b.dataset.genre); return; }
    if (b.dataset.intention) { precision.intention = b.dataset.intention; demander("variation"); return; }
    if (b.dataset.style) { changerStyle(b.dataset.style); return; }
    switch (b.id) {
      case "claude-retour": revenirAuxGenres(); focaliser(); break;
      case "claude-arreter": arreterDemande(); break;
      case "claude-ecouter": ecouter(); break;
      case "claude-autre":
      case "claude-reessayer": if (dernier) demander(dernier); break;
      case "claude-garder": garder(); break;
      case "claude-autoriser": autoriser(); break;
      default:
    }
  });
  $("claude-libre").addEventListener("submit", (ev) => { ev.preventDefault(); envoyerPhrase(); });
  // Au clavier de l'ordinateur, Ctrl (ou ⌘) + Entrée envoie ; Entrée seule va à la ligne.
  $("claude-phrase").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); envoyerPhrase(); }
  });

  trouver();

  return {
    ouvrir,
    /** L'éditeur se ferme ou ouvre une autre idée : la feuille se ferme, sans rien écrire. */
    fermer() { oublier(); fermerFeuille(feuille); },
    /** La version claude.ai peut interroger Claude (et claude.ai ne l'a pas refusé pour cette visite). */
    get disponible() { return disponible; },
  };
}
