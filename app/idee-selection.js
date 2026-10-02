/**
 * L'ÉDITEUR D'IDÉE : LA SÉLECTION
 *
 * Ce qu'on fait des notes choisies, rangé du plus rapide au plus complet :
 *   - la pilule (#idee-pilule), posée au-dessus des notes choisies dans la
 *     grille ou la partition (dessous s'il n'y a pas la place), qui ne sort
 *     jamais de l'écran : ½ ton et octave, plus haut ou plus bas, effacer,
 *     et « ••• » qui ouvre la boîte à outils ;
 *   - la boîte à outils (#idee-boite), une feuille du bas rangée par
 *     familles : Durée, Rythme, Motif, Ailleurs. Un geste s'applique, la
 *     feuille reste ouverte (on en enchaîne souvent plusieurs) et dit ce
 *     qui vient de se passer ; la grille, derrière, bouge ;
 *   - le menu en cercle (menu-radial.js), le raccourci de l'appui long sur
 *     une note : les gestes de hauteur, de rythme, de motif et « ailleurs »,
 *     chaque famille côte à côte ;
 *   - la rangée « sélection » du pupitre (#idee-selection), au-dessus du
 *     mode tant qu'une note est choisie : son nom, la précédente, la
 *     suivante, « + suivante », tout, répéter, et « ne plus choisir » ;
 *   - au clavier de l'ordinateur (le cœur appelle voisine, etendre, tout,
 *     aucune, transformer).
 * Douze gestes en cercle, sans ordre, étaient le seul chemin vers la moitié
 * d'entre eux : la pilule garde ce qu'on fait cent fois, la boîte range le
 * reste, et le cercle n'est plus qu'un raccourci.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, selection, curseur,
 *   recalage, duree, pointee), $, sq, toast(texte), modifier(f, { entendre }),
 *   rafraichir(), choisir(ids, ajouter), notesPiste(), choisies(), effacer(),
 *   choisirDuree(pas), annuler(), boiteSelection() → { boite, zone } à
 *   l'écran ou null, deps.nouvelleDepuis(seq).
 * Rend : { transformer(nom), durer(pas), pointer(), voisine(sens), etendre(),
 *   tout(), aucune(), ouvrirMenu(x, y, options), ouvrirBoite(), maj(),
 *   placer(), fermer(), menuOuvert, boiteOuverte }.
 */
import { creerMenuRadial } from "./menu-radial.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";

const DUREES = [
  { pas: 1, nom: "double croche" }, { pas: 2, nom: "croche" }, { pas: 4, nom: "noire" },
  { pas: 8, nom: "blanche" }, { pas: 16, nom: "ronde" },
];

/** Les familles du menu en cercle (le nom écrit à l'intérieur, face à chaque groupe). */
export const FAMILLES = { hauteur: "Hauteur", rythme: "Rythme", motif: "Motif", ailleurs: "Ailleurs" };

/**
 * Les gestes du menu en cercle, famille par famille : menu-radial.js les
 * pose dans cet ordre, dans le sens des aiguilles d'une montre, en
 * laissant un creux entre deux familles. La hauteur d'abord, du plus grave
 * au plus aigu : elle monte le long du côté gauche, ce qui est plus haut
 * est plus haut. Les durées n'y sont pas (la boîte à outils les range), ni
 * « recaler » ni « répéter » (la boîte, et pour répéter la rangée du
 * pupitre) : dix gestes se visent au doigt, douze se chevauchaient.
 */
export const GESTES = [
  { id: "octave-bas", famille: "hauteur", icone: "oct-bas", libelle: "octave", aide: "Une octave plus bas" },
  { id: "descendre", famille: "hauteur", icone: "bas", libelle: "½ ton", aide: "Un demi-ton plus bas" },
  { id: "monter", famille: "hauteur", icone: "haut", libelle: "½ ton", aide: "Un demi-ton plus haut" },
  { id: "octave-haut", famille: "hauteur", icone: "oct-haut", libelle: "octave", aide: "Une octave plus haut" },
  { id: "doubler", famille: "rythme", icone: "allonger", libelle: "plus lent", aide: "Plus lent : durées doublées" },
  { id: "diviser", famille: "rythme", icone: "raccourcir", libelle: "plus vite", aide: "Plus vite : durées divisées par deux" },
  { id: "retrograder", famille: "motif", icone: "envers", libelle: "à l'envers", aide: "À l'envers : la dernière note devient la première" },
  { id: "renverser", famille: "motif", icone: "miroir", libelle: "miroir", aide: "Miroir : ce qui montait descend" },
  { id: "nouvelle", famille: "ailleurs", icone: "nouvelle", libelle: "idée à part", aide: "En faire une idée à part" },
  { id: "effacer", famille: "ailleurs", icone: "corbeille", libelle: "effacer", aide: "Effacer" },
];

/**
 * Où poser la pilule (coordonnées du navigateur) : centrée au-dessus des
 * notes choisies, dessous s'il n'y a pas la place, toujours dans la zone
 * visible (si les notes en sortent, la pilule reste au bord).
 * @param boite  { left, right, top, bottom } des notes choisies
 * @param zone   { left, right, top, bottom } de la partie visible des notes
 * @param cadre  { left, right } où la pilule a le droit d'aller en largeur
 * @returns { x, y, dessous }
 */
export function placerPilule({ boite, zone, cadre = zone, largeur, hauteur, marge = 8, ecart = 10 }) {
  const borne = (v, a, b) => (b < a ? a : Math.max(a, Math.min(b, v)));
  const centre = (boite.left + boite.right) / 2;
  const x = borne(centre - largeur / 2, cadre.left + marge, cadre.right - marge - largeur);
  let y = boite.top - ecart - hauteur;
  let dessous = false;
  if (y < zone.top + marge) { y = boite.bottom + ecart; dessous = true; }
  y = borne(y, zone.top + marge, zone.bottom - marge - hauteur);
  return { x, y, dessous };
}

/** Le nom de ce qui est choisi : « si4 · croche », « accord do-mi-sol · noire », « 5 notes ». */
export function nomDuChoix(sel, tonalite, nomNote) {
  if (!sel.length) return "";
  const d0 = Math.min(...sel.map((n) => n.d));
  const premieres = sel.filter((n) => n.d === d0);
  if (sel.length > premieres.length) return `${sel.length} notes`;
  const nom = premieres.map((n) => nomNote(n.h, tonalite)).join("-");
  const l = premieres[0].l;
  const duree = DUREES.find((d) => d.pas === l || d.pas * 1.5 === l);
  const dureeNom = duree ? duree.nom + (duree.pas === l ? "" : " pointée") : `${l} pas`;
  return `${premieres.length > 1 ? "accord " : ""}${nom} · ${dureeNom}`;
}

/** Le titre de la boîte à outils : « si4, croche », « accord do-mi-sol, noire », « 4 notes choisies ». */
export function titreDuChoix(sel, tonalite, nomNote) {
  const nom = nomDuChoix(sel, tonalite, nomNote);
  return /^\d+ notes$/.test(nom) ? `${nom} choisies` : nom.replace(" · ", ", ");
}

/**
 * Où sont les notes choisies, quand leur nom ne le dit pas : « mesure 2 »,
 * « mesures 1 à 3 » (la mesure où chaque note commence).
 */
export function lieuDuChoix(sel, pasParMesure) {
  if (!sel.length) return "";
  const premiere = Math.floor(Math.min(...sel.map((n) => n.d)) / pasParMesure) + 1;
  const derniere = Math.floor(Math.max(...sel.map((n) => n.d)) / pasParMesure) + 1;
  return premiere === derniere ? `mesure ${premiere}` : `mesures ${premiere} à ${derniere}`;
}

/** La durée que toutes les notes choisies ont en commun, { pas, pointee }, ou null si elles diffèrent. */
export function dureeCommune(sel) {
  if (!sel.length || sel.some((n) => n.l !== sel[0].l)) return null;
  const l = sel[0].l;
  const d = DUREES.find((x) => x.pas === l || x.pas * 1.5 === l);
  return d ? { pas: d.pas, pointee: d.pas !== l } : null;
}

const nomDuree = (pas, pointee) => DUREES.find((d) => d.pas === pas).nom + (pointee ? " pointée" : "");

/** Ce que la boîte à outils dit après un geste (n : le nombre de notes choisies). */
const RETOURS = {
  doubler: () => "Plus lent : les durées sont doublées",
  diviser: () => "Plus vite : les durées sont divisées par deux",
  recaler: (n, grille) => `Recalé sur la ${grille}`,
  dupliquer: (n) => `Répété à la suite : ${n} ${n > 1 ? "notes" : "note"} de plus`,
  retrograder: () => "À l'envers : la dernière note passe en premier",
  renverser: () => "Miroir : ce qui montait descend",
};
/** …et quand le geste n'aurait rien changé (rien n'est alors enregistré, pas même un « Annuler »). */
const RIENS = {
  recaler: (n, grille) => `Déjà calé sur la ${grille}`,
  retrograder: () => "Rien à retourner : choisis au moins deux notes",
  renverser: () => "Rien à retourner : choisis au moins deux notes",
};
const AIDE_BOITE = "Chaque geste s'applique tout de suite.";

export function creerSelection(ctx) {
  const { e, $, sq } = ctx;
  const pilule = $("idee-pilule");
  const rangee = $("idee-selection");
  const boite = brancherFeuille($("idee-boite"), {
    // La pilule revient dès que la boîte se ferme (elle se retire pendant qu'elle est ouverte).
    surFermer: () => { pilule.classList.remove("sous-le-menu"); placer(); },
  });
  const retour = $("idee-boite-retour");
  // Le menu en cercle couvre la pilule : elle se retire le temps qu'il est ouvert.
  const menuRadial = creerMenuRadial({
    actions: GESTES,
    familles: FAMILLES,
    surChoix: (id) => transformer(id),
    surFermer: () => { pilule.classList.remove("sous-le-menu"); placer(); },
  });
  const ouvrirMenu = (x, y, options) => { pilule.classList.add("sous-le-menu"); menuRadial.ouvrir(x, y, options); };

  /** Les hauteurs de la sélection après transposition (pour les faire entendre). */
  function choisiesApres(ids, demiTons) {
    const sel = ctx.notesPiste().filter((n) => ids.includes(n.id));
    const d0 = Math.min(...sel.map((n) => n.d));
    return sel.filter((n) => n.d === d0).map((n) => n.h + demiTons);
  }

  /** La sélection, seule, comme une idée à part (calée au début). */
  function extraire(ids) {
    const sel = ctx.notesPiste().filter((n) => ids.includes(n.id));
    const mesure = sq.pasParMesure(e.seq);
    const d0 = Math.floor(Math.min(...sel.map((n) => n.d)) / mesure) * mesure;
    const seq = sq.nouvelleSequence({ tempo: e.seq.tempo, mesure: e.seq.mesure, tonalite: e.seq.tonalite });
    for (const n of sel) sq.poser(seq, 0, { d: n.d - d0, l: n.l, h: n.h, v: n.v });
    return seq;
  }

  /** Les gestes qui ne touchent qu'aux notes choisies (on peut donc les essayer sur une copie). */
  const SUR_NOTES = {
    "monter": (seq, ids) => sq.transposer(seq, e.piste, ids, 1),
    "descendre": (seq, ids) => sq.transposer(seq, e.piste, ids, -1),
    "octave-haut": (seq, ids) => sq.transposer(seq, e.piste, ids, 12),
    "octave-bas": (seq, ids) => sq.transposer(seq, e.piste, ids, -12),
    "doubler": (seq, ids) => sq.etirer(seq, e.piste, ids, 2),
    "diviser": (seq, ids) => sq.etirer(seq, e.piste, ids, 0.5),
    "retrograder": (seq, ids) => sq.retrograder(seq, e.piste, ids),
    "renverser": (seq, ids) => sq.renverser(seq, e.piste, ids),
    "recaler": (seq, ids) => sq.recaler(seq, e.piste, ids, e.recalage),
  };
  const DEMI_TONS = { "monter": 1, "descendre": -1, "octave-haut": 12, "octave-bas": -12 };

  /** Le geste changerait-il quelque chose ? Un « Annuler » pour rien, c'est du bruit. */
  function changerait(nom, ids) {
    const copie = sq.cloner(e.seq);
    SUR_NOTES[nom](copie, ids);
    return JSON.stringify(copie.pistes[e.piste].notes) !== JSON.stringify(ctx.notesPiste());
  }

  /**
   * Applique un geste à toute la sélection. Rend false si rien n'a été fait
   * (pas de sélection, geste inconnu, ou rien à changer).
   */
  function transformer(nom) {
    const ids = [...e.selection];
    if (!ids.length) return false;
    const { modifier } = ctx;
    if (SUR_NOTES[nom]) {
      if (!changerait(nom, ids)) return false;
      const demi = DEMI_TONS[nom];
      modifier(() => SUR_NOTES[nom](e.seq, ids), demi === undefined ? {} : { entendre: choisiesApres(ids, demi) });
      return true;
    }
    switch (nom) {
      case "dupliquer": modifier(() => { const copies = sq.dupliquerSelection(e.seq, e.piste, ids); e.selection = new Set(copies); }); return true;
      case "effacer": ctx.effacer(); return true;
      case "nouvelle": if (!ctx.deps.nouvelleDepuis) return false; ctx.deps.nouvelleDepuis(extraire(ids)); return true;
      default: return false;
    }
  }

  /** La durée de la sélection : les notes choisies la prennent toutes (et c'est aussi celle des prochaines). */
  function fixerDuree(pas, pointee) {
    e.pointee = pointee && pas !== 1; // pas de double croche pointée
    ctx.choisirDuree(pas);
  }

  /** Une durée pour toute la sélection ; la pointée reste ou non, comme elle est allumée dans la boîte. */
  function durer(pas) {
    const sel = ctx.choisies();
    if (!sel.length) return false;
    const commune = dureeCommune(sel);
    const pointee = !!commune && commune.pointee && pas !== 1;
    if (commune && commune.pas === pas && commune.pointee === pointee) return false;
    fixerDuree(pas, pointee);
    return true;
  }

  /** Pointée ou non, à la durée commune (sans durée commune, il n'y a rien à pointer). */
  function pointer() {
    const commune = dureeCommune(ctx.choisies());
    if (!commune || commune.pas === 1) return false;
    fixerDuree(commune.pas, !commune.pointee);
    return true;
  }

  /** La note d'avant ou d'après (sans sélection : le curseur saute d'une note). */
  function voisine(sens) {
    const notes = ctx.notesPiste();
    if (!notes.length) return;
    const debuts = [...new Set(notes.map((n) => n.d))].sort((a, b) => a - b);
    const sel = ctx.choisies();
    let cible;
    if (sel.length) {
      const d0 = Math.min(...sel.map((n) => n.d));
      cible = sens > 0 ? debuts.find((d) => d > d0) : [...debuts].reverse().find((d) => d < d0);
    } else {
      cible = sens > 0 ? debuts.find((d) => d >= e.curseur) : [...debuts].reverse().find((d) => d < e.curseur);
    }
    if (cible === undefined) return;
    ctx.choisir(notes.filter((n) => n.d === cible).map((n) => n.id));
  }

  /** Ajoute à la sélection la note (ou l'accord) qui suit. */
  function etendre() {
    const notes = ctx.notesPiste();
    const sel = ctx.choisies();
    if (!sel.length) { voisine(1); return; }
    const fin = Math.max(...sel.map((n) => n.d));
    const suivant = notes.filter((n) => n.d > fin);
    if (!suivant.length) return;
    const d = Math.min(...suivant.map((n) => n.d));
    ctx.choisir(notes.filter((n) => n.d === d).map((n) => n.id), true);
  }

  const tout = () => ctx.choisir(ctx.notesPiste().map((n) => n.id));
  const aucune = () => { e.selection.clear(); ctx.rafraichir(); };

  function action(a) {
    if (a === "precedente") voisine(-1);
    else if (a === "suivante") voisine(1);
    else if (a === "deselectionner") aucune();
    else if (a === "plus") ouvrirBoite();
    else if (a === "etendre") etendre();
    else if (a === "tout") tout();
    else transformer(a);
  }
  for (const zone of [pilule, rangee]) {
    zone.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-action]");
      if (b) action(b.dataset.action);
    });
  }

  // --- La boîte à outils -----------------------------------------------------------

  const nomGrille = () => ({ 1: "double croche", 2: "croche", 4: "noire" })[e.recalage] || `grille de ${e.recalage} pas`;

  /** Le retour visible d'un geste, sous le titre (relu par les lecteurs d'écran). */
  function dire(texte, fait = true) {
    retour.textContent = texte;
    retour.classList.toggle("fait", fait);
    // On relance le petit éclat qui fait voir que le message vient de changer.
    retour.classList.remove("neuf");
    void retour.offsetWidth;
    retour.classList.add("neuf");
  }

  const toutes = () => (e.selection.size > 1 ? "Toutes en " : "En ");
  // « Annuler » de la boîte défait les gestes de la boîte, pas la dernière note écrite avant de l'ouvrir.
  let faits = 0;
  /** Un geste de plus à défaire (le geste a déjà redessiné : on rallume « Annuler » à la main). */
  function compter() { faits++; if (boite.open) majBoite(ctx.choisies()); }

  /** Un geste de la boîte : on l'applique, la feuille reste ouverte et dit ce qui s'est passé. */
  function geste(nom) {
    const n = e.selection.size;
    const fait = transformer(nom);
    if (fait) compter();
    if (nom === "effacer") {
      // Plus rien n'est choisi : la boîte s'est refermée toute seule (maj), le message passe donc par le toast.
      if (fait) ctx.toast(n > 1 ? `${n} notes effacées. Annuler les remet.` : "Note effacée. Annuler la remet.");
      return;
    }
    if (nom === "nouvelle") return; // l'éditeur s'ouvre sur la nouvelle idée
    if (fait) dire(RETOURS[nom](n, nomGrille()));
    else dire((RIENS[nom] || (() => "Rien à changer"))(n, nomGrille()), false);
  }

  boite.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || b.disabled) return;
    if (b.hasAttribute("data-fermer")) { fermerFeuille(boite); return; }
    if (b.dataset.duree) {
      const pas = Number(b.dataset.duree);
      const pointee = !!(dureeCommune(ctx.choisies()) || {}).pointee && pas !== 1;
      if (durer(pas)) { compter(); dire(toutes() + nomDuree(pas, pointee)); }
      else dire(`Déjà en ${nomDuree(pas, pointee)}`, false);
    } else if (b.hasAttribute("data-pointee")) {
      if (pointer()) {
        compter();
        const c = dureeCommune(ctx.choisies());
        dire(toutes() + nomDuree(c.pas, c.pointee));
      }
    } else if (b.dataset.action === "annuler") {
      faits = Math.max(0, faits - 1);
      ctx.annuler();
      dire("Annulé");
    } else if (b.dataset.action) geste(b.dataset.action);
  });

  /** Le titre, la durée commune et l'état d'« Annuler » : à chaque changement de l'idée. */
  function majBoite(sel) {
    $("idee-boite-titre").textContent = titreDuChoix(sel, e.seq.tonalite, sq.nomNote);
    const commune = dureeCommune(sel);
    boite.querySelectorAll("[data-duree]").forEach((b) => b.setAttribute("aria-pressed", String(!!commune && commune.pas === Number(b.dataset.duree))));
    const point = boite.querySelector("[data-pointee]");
    point.setAttribute("aria-pressed", String(!!commune && commune.pointee));
    point.disabled = !commune || commune.pas === 1;
    point.title = point.disabled ? "Pointée : donne d'abord la même durée à toutes les notes (pas de double croche pointée)" : "Pointée : la moitié en plus";
    $("idee-boite-annuler").disabled = !faits || !e.annuler.length;
  }

  /**
   * La boîte monte du bas de l'écran : si elle cache les notes choisies, la
   * vue défile juste ce qu'il faut pour les garder au-dessus d'elle (on
   * regarde la grille bouger pendant qu'on enchaîne les gestes).
   */
  function degager() {
    const ou = ctx.boiteSelection();
    if (!ou) return;
    const r = boite.getBoundingClientRect();
    if (ou.boite.right < r.left || ou.boite.left > r.right) return; // à côté de la feuille, pas dessous
    const haut = innerHeight - boite.offsetHeight - 12;
    let dy = ou.boite.bottom - haut;
    // Jamais au point de sortir les notes par le haut.
    dy = Math.min(dy, ou.boite.top - ou.zone.top - 8);
    if (dy <= 0) return;
    const defil = e.affichage === "grille" ? $("idee-grille").querySelector(".g-defil") : $("idee-partition");
    if (defil) defil.scrollTop += dy;
  }

  function ouvrirBoite() {
    if (!ctx.choisies().length) return;
    menuRadial.fermer();
    faits = 0;
    retour.textContent = AIDE_BOITE;
    retour.classList.remove("fait", "neuf");
    majBoite(ctx.choisies());
    pilule.classList.add("sous-le-menu");
    ouvrirFeuille(boite);
    degager();
  }

  /** Après chaque changement : la rangée du pupitre, le nom du choix, la boîte si elle est ouverte. */
  function maj() {
    const sel = ctx.choisies();
    rangee.hidden = !sel.length;
    pilule.setAttribute("aria-label", sel.length > 1 ? "Les notes choisies" : "La note choisie");
    // Sur deux lignes : la note, puis sa durée ; pour plusieurs notes, combien, puis où.
    const zone = $("idee-nom-choix");
    zone.textContent = "";
    const lignes = nomDuChoix(sel, e.seq.tonalite, sq.nomNote).split(" · ");
    if (lignes.length === 1 && sel.length) lignes.push(lieuDuChoix(sel, sq.pasParMesure(e.seq)));
    lignes.forEach((morceau, i) => {
      if (i) { const sep = document.createElement("span"); sep.className = "sep"; sep.textContent = " · "; zone.appendChild(sep); }
      const s = document.createElement("span");
      s.className = "ligne";
      s.textContent = morceau;
      zone.appendChild(s);
    });
    if (!sel.length) { pilule.hidden = true; fermerFeuille(boite); } else if (boite.open) majBoite(sel);
  }

  /** Pose la pilule au-dessus des notes choisies (après le dessin, et quand la vue défile). */
  function placer() {
    const ou = e.selection.size ? ctx.boiteSelection() : null;
    if (!ou) { pilule.hidden = true; return; }
    pilule.hidden = false;
    const surface = pilule.offsetParent ? pilule.offsetParent.getBoundingClientRect() : { left: 0, top: 0, right: innerWidth };
    const { x, y, dessous } = placerPilule({
      boite: ou.boite, zone: ou.zone, cadre: surface,
      largeur: pilule.offsetWidth, hauteur: pilule.offsetHeight,
    });
    pilule.style.transform = `translate(${Math.round(x - surface.left)}px, ${Math.round(y - surface.top)}px)`;
    pilule.classList.toggle("dessous", dessous);
  }

  return {
    transformer, durer, pointer, voisine, etendre, tout, aucune, maj, placer,
    ouvrirMenu, ouvrirBoite,
    fermer: () => { menuRadial.fermer(); fermerFeuille(boite); pilule.hidden = true; },
    get menuOuvert() { return menuRadial.ouvert; },
    get boiteOuverte() { return boite.open; },
  };
}
