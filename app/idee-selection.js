/**
 * L'ÉDITEUR D'IDÉE : LA SÉLECTION
 *
 * Ce qu'on fait des notes choisies :
 *   - la pilule (#idee-pilule), posée au-dessus des notes choisies dans la
 *     grille ou la partition (dessous s'il n'y a pas la place), qui ne sort
 *     jamais de l'écran : ½ ton plus haut ou plus bas, plus court, plus long,
 *     effacer, et « ••• » qui ouvre le menu en cercle ;
 *   - le menu en cercle (menu-radial.js), aussi à l'appui long sur une note :
 *     transposer, octave, durées ×2 ÷2, répéter, à l'envers, miroir,
 *     recaler, en faire une idée à part ;
 *   - la rangée « sélection » du pupitre (#idee-selection), au-dessus du
 *     mode tant qu'une note est choisie : son nom, la précédente, la
 *     suivante, « + suivante », tout, répéter, et « ne plus choisir » ;
 *   - au clavier de l'ordinateur (le cœur appelle voisine, etendre, tout,
 *     aucune, transformer).
 * Une barre fixe qui défilait de côté cachait la moitié de ses gestes ; la
 * pilule reste près du doigt, et le reste a sa place dans le pupitre.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, selection, curseur,
 *   recalage), $, sq, modifier(f, { entendre }), rafraichir(), choisir(ids,
 *   ajouter), notesPiste(), choisies(), effacer(), boiteSelection() →
 *   { boite, zone } à l'écran ou null, deps.nouvelleDepuis(seq).
 * Rend : { transformer(nom), voisine(sens), etendre(), tout(), aucune(),
 *   ouvrirMenu(x, y, options), maj(), placer(), fermer(), menuOuvert }.
 */
import { creerMenuRadial } from "./menu-radial.js";

const DUREES = [
  { pas: 1, nom: "double croche" }, { pas: 2, nom: "croche" }, { pas: 4, nom: "noire" },
  { pas: 8, nom: "blanche" }, { pas: 16, nom: "ronde" },
];

/** Les gestes du menu en cercle, dans l'ordre du tour (en partant du haut). */
export const GESTES = [
  { id: "monter", icone: "haut", libelle: "½ ton", aide: "Un demi-ton plus haut" },
  { id: "octave-haut", icone: "oct-haut", libelle: "octave", aide: "Une octave plus haut" },
  { id: "doubler", icone: "allonger", libelle: "plus lent", aide: "Durées doublées" },
  { id: "dupliquer", icone: "repeter", libelle: "répéter", aide: "Recopier juste après" },
  { id: "retrograder", icone: "envers", libelle: "à l'envers", aide: "La dernière note devient la première" },
  { id: "recaler", icone: "aimant", libelle: "recaler", aide: "Recaler sur la grille" },
  { id: "effacer", icone: "corbeille", libelle: "effacer", aide: "Effacer" },
  { id: "nouvelle", icone: "nouvelle", libelle: "idée à part", aide: "En faire une nouvelle idée" },
  { id: "renverser", icone: "miroir", libelle: "miroir", aide: "Ce qui montait descend" },
  { id: "diviser", icone: "raccourcir", libelle: "plus vite", aide: "Durées divisées par deux" },
  { id: "octave-bas", icone: "oct-bas", libelle: "octave", aide: "Une octave plus bas" },
  { id: "descendre", icone: "bas", libelle: "½ ton", aide: "Un demi-ton plus bas" },
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

export function creerSelection(ctx) {
  const { e, $, sq } = ctx;
  const pilule = $("idee-pilule");
  const rangee = $("idee-selection");
  // Le menu en cercle couvre la pilule : elle se retire le temps qu'il est ouvert.
  const menuRadial = creerMenuRadial({
    actions: GESTES,
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

  function transformer(nom) {
    const ids = [...e.selection];
    if (!ids.length) return undefined;
    const { modifier } = ctx;
    switch (nom) {
      case "monter": return modifier(() => sq.transposer(e.seq, e.piste, ids, 1), { entendre: choisiesApres(ids, 1) });
      case "descendre": return modifier(() => sq.transposer(e.seq, e.piste, ids, -1), { entendre: choisiesApres(ids, -1) });
      case "octave-haut": return modifier(() => sq.transposer(e.seq, e.piste, ids, 12), { entendre: choisiesApres(ids, 12) });
      case "octave-bas": return modifier(() => sq.transposer(e.seq, e.piste, ids, -12), { entendre: choisiesApres(ids, -12) });
      case "dupliquer": return modifier(() => { const copies = sq.dupliquerSelection(e.seq, e.piste, ids); e.selection = new Set(copies); });
      case "doubler": return modifier(() => sq.etirer(e.seq, e.piste, ids, 2));
      case "diviser": return modifier(() => sq.etirer(e.seq, e.piste, ids, 0.5));
      case "retrograder": return modifier(() => sq.retrograder(e.seq, e.piste, ids));
      case "renverser": return modifier(() => sq.renverser(e.seq, e.piste, ids));
      case "recaler": return modifier(() => sq.recaler(e.seq, e.piste, ids, e.recalage));
      case "effacer": return ctx.effacer();
      case "nouvelle": return ctx.deps.nouvelleDepuis && ctx.deps.nouvelleDepuis(extraire(ids));
      default: return undefined;
    }
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

  function action(a, bouton) {
    if (a === "precedente") voisine(-1);
    else if (a === "suivante") voisine(1);
    else if (a === "deselectionner") aucune();
    else if (a === "plus") { const r = bouton.getBoundingClientRect(); ouvrirMenu(r.left + r.width / 2, r.top + r.height / 2); }
    else if (a === "etendre") etendre();
    else if (a === "tout") tout();
    else transformer(a);
  }
  for (const zone of [pilule, rangee]) {
    zone.addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-action]");
      if (b) action(b.dataset.action, b);
    });
  }

  /** Après chaque changement : la rangée du pupitre et le nom du choix. */
  function maj() {
    const sel = ctx.choisies();
    rangee.hidden = !sel.length;
    // Sur deux lignes : la note, puis sa durée (le séparateur reste dans le texte).
    const zone = $("idee-nom-choix");
    zone.textContent = "";
    nomDuChoix(sel, e.seq.tonalite, sq.nomNote).split(" · ").forEach((morceau, i) => {
      if (i) { const sep = document.createElement("span"); sep.className = "sep"; sep.textContent = " · "; zone.appendChild(sep); }
      const s = document.createElement("span");
      s.className = "ligne";
      s.textContent = morceau;
      zone.appendChild(s);
    });
    if (!sel.length) pilule.hidden = true;
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
    transformer, voisine, etendre, tout, aucune, maj, placer,
    ouvrirMenu,
    fermer: () => { menuRadial.fermer(); pilule.hidden = true; },
    get menuOuvert() { return menuRadial.ouvert; },
  };
}
