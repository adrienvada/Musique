/**
 * LE CLAVIER À L'ÉCRAN
 *
 * Deux façons de jouer la même chose, au doigt, à plusieurs doigts (accords) :
 *   - Piano : les touches d'un piano (une octave et un do sur un téléphone,
 *     trois octaves sur un ordinateur) ;
 *   - Gamme : huit grosses touches, les sept degrés de la gamme de l'idée et
 *     l'octave. On n'y peut pas faire de fausse note.
 *
 * Au-dessus, une barre : le choix Piano / Gamme, les chevrons ‹ › et une
 * « carte des octaves » (do2 à do6) qui montre où l'on est et permet d'y
 * sauter d'un toucher, ou en glissant le doigt. Changer d'octave à l'aveugle
 * avec ‹ › était le défaut du clavier d'avant.
 *
 * La gamme de l'idée se voit sur le piano : une pastille bleue sur les touches
 * de la gamme (la tonique cerclée), les autres un peu atténuées mais jouables.
 *
 * Le clavier ne sait rien de l'idée : il dit seulement quelle touche s'enfonce
 * et se relève (surNote) ; la tonalité et les réglages lui sont donnés par
 * regler(). Les calculs de gamme sont des fonctions pures (testées sous Node).
 */
import { nomNote, lireTonalite } from "./sequence.js";
import { ico } from "./icones.js";

const BLANCHES = [0, 2, 4, 5, 7, 9, 11];
const NOIRES = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // demi-ton → touche blanche à sa gauche
// Les degrés d'une gamme, en demi-tons depuis la tonique. En mineur, c'est le
// mineur naturel, celui de l'armure : la sensible haussée reste jouable, mais
// hors gamme (atténuée), comme toute note étrangère.
const MAJEUR = [0, 2, 4, 5, 7, 9, 11];
const MINEUR = [0, 2, 3, 5, 7, 8, 10];
const mod12 = (x) => ((x % 12) + 12) % 12;

// Le clavier part de do1 (24) au plus bas, et monte jusqu'à do7 (96) : sept
// octaves de départ. La carte en montre cinq à la fois.
const BAS_MIN = 24, BAS_MAX = 96;
export const OCTAVES_CARTE = 5;

// Une touche blanche fait au moins 44 px au doigt : huit touches (une octave
// et un do) tiennent juste sur un téléphone de 390 px, maintenant que les
// chevrons ne lui prennent plus de place. Un écran plus étroit en montre sept.
export const LARGEUR_TOUCHE = 44;
export const combien = (largeur) => Math.max(7, Math.min(22, Math.floor(largeur / LARGEUR_TOUCHE)));

// --- Les calculs de gamme (purs) ---------------------------------------------

/** La gamme d'une tonalité (« C », « F#m »…) : sa tonique et ses sept classes de hauteur (0 à 11). */
export function gammeDe(tonalite) {
  const k = lireTonalite(tonalite);
  const intervalles = k.mineur ? MINEUR : MAJEUR;
  return { tonique: k.pc, mineur: k.mineur, intervalles, classes: new Set(intervalles.map((i) => mod12(k.pc + i))) };
}

/**
 * Les huit touches du mode Gamme, à partir de la première tonique à
 * partir de `bas` : les sept degrés, puis la tonique une octave plus haut.
 * { h, degre (1 à 8), nom (« Fa♯ »), octave, tonique }
 */
export function touchesDeGamme(tonalite, bas) {
  const g = gammeDe(tonalite);
  const h0 = bas + mod12(g.tonique - bas);
  return Array.from({ length: 8 }, (_, i) => {
    const h = h0 + g.intervalles[i % 7] + (i === 7 ? 12 : 0);
    const [, lettres, octave] = /^(.*?)(-?\d+)$/.exec(nomNote(h, tonalite));
    return { h, degre: i + 1, nom: lettres[0].toUpperCase() + lettres.slice(1), octave: Number(octave), tonique: i % 7 === 0 };
  });
}

/**
 * La première octave de la carte, pour que l'octave `octave` (1 à 7) s'y trouve :
 * la carte ne bouge que si l'on en sort (sinon les cases changeraient de
 * place sous le doigt).
 */
export function fenetreOctaves(octave, debut = 2, nb = OCTAVES_CARTE) {
  if (octave < debut) debut = octave;
  else if (octave > debut + nb - 1) debut = octave - nb + 1;
  return Math.max(BAS_MIN / 12 - 1, Math.min(BAS_MAX / 12 - 1 - nb + 1, debut));
}

// --- Le clavier ---------------------------------------------------------------

/**
 * @param conteneur l'élément qui reçoit la barre et le clavier
 * @param options { surNote(h, bas, vitesse), surOctave(bas) (l'octave a changé
 *   par un geste sur les chevrons ou la carte), surFacon("piano" | "gamme") }
 */
export function creerClavier(conteneur, { surNote, surOctave = () => {}, surFacon = () => {} }) {
  let bas = null; // la touche la plus à gauche : toujours un do
  let voulue = null; // une hauteur à montrer dès le premier dessin
  let nbBlanches = 14;
  let marquees = new Set();
  let tonalite = null; // la gamme de l'idée
  let montrerGamme = true; // la préférence « Montrer la gamme sur le clavier »
  let facon = "piano";
  let debutCarte = 2; // do2 : la première case de la carte
  const enfoncees = new Map(); // pointeur → hauteur

  conteneur.classList.add("clavier");
  conteneur.innerHTML = `
    <div class="clavier-barre">
      <div class="seg clavier-facon" role="group" aria-label="Façon de jouer">
        <button type="button" data-facon="piano" aria-pressed="true">Piano</button>
        <button type="button" data-facon="gamme" aria-pressed="false">Gamme</button>
      </div>
      <button type="button" class="clavier-octave" data-sens="-1" aria-label="Une octave plus bas">${ico("retour")}</button>
      <div class="clavier-carte" role="group" aria-label="Octaves du clavier"></div>
      <button type="button" class="clavier-octave" data-sens="1" aria-label="Une octave plus haut">${ico("suivant")}</button>
    </div>
    <div class="clavier-touches" role="group" aria-label="Clavier de piano"></div>
    <div class="clavier-gamme" role="group" aria-label="Les huit notes de la gamme" hidden></div>`;
  const zone = conteneur.querySelector(".clavier-touches");
  const pads = conteneur.querySelector(".clavier-gamme");
  const carte = conteneur.querySelector(".clavier-carte");

  const plusHaute = () => bas + 12 * Math.floor((nbBlanches - 1) / 7) + BLANCHES[(nbBlanches - 1) % 7];
  // Ce que le clavier montre : le piano, du do de gauche à sa dernière touche ; la Gamme,
  // de la première tonique jusqu'à son octave. Faire venir une hauteur, c'est choisir le do
  // de gauche pour qu'elle y soit (en Gamme : pour qu'elle soit l'une des huit touches, si elle est de la gamme).
  const toniqueDe = () => (tonalite ? gammeDe(tonalite).tonique : 0);
  const enGamme = () => facon === "gamme" && !!tonalite;
  const visible = (h) => bas !== null && (enGamme() ? h >= bas + toniqueDe() && h <= bas + toniqueDe() + 12 : h >= bas && h <= plusHaute());
  const basPourVoir = (h) => borner(enGamme() ? h - toniqueDe() : h);
  const borner = (h) => Math.max(BAS_MIN, Math.min(BAS_MAX, 12 * Math.floor(h / 12)));
  const octaveDe = (do_) => do_ / 12 - 1; // do4 = 60 → octave 4

  // --- Le piano ---------------------------------------------------------------

  function dessiner() {
    const largeur = conteneur.clientWidth;
    if (!largeur) return; // caché : on dessinera quand il se montrera
    nbBlanches = combien(largeur);
    // Au départ : le do central à gauche sur un téléphone, une octave plus bas ailleurs.
    if (bas === null) {
      bas = nbBlanches < 14 ? 60 : 48;
      if (voulue !== null && !visible(voulue)) bas = basPourVoir(voulue);
    }
    zone.textContent = "";
    zone.style.setProperty("--blanches", nbBlanches);
    // Sous 34 px par touche, seuls les do gardent leur nom.
    zone.classList.toggle("etroit", largeur / nbBlanches < 34);
    for (let i = 0; i < nbBlanches; i++) {
      const h = bas + 12 * Math.floor(i / 7) + BLANCHES[i % 7];
      const t = document.createElement("div");
      t.className = "touche blanche";
      t.dataset.h = h;
      t.style.left = `calc(${i} * 100% / var(--blanches))`;
      // Le nom de la note : « do4 » pour un do (avec son octave), « ré » pour les autres.
      const nom = document.createElement("span");
      nom.textContent = h % 12 === 0 ? nomNote(h) : nomNote(h).replace(/\d+$/, "");
      if (h % 12 === 0) nom.className = "do";
      t.appendChild(nom);
      zone.appendChild(t);
    }
    for (let i = 0; i < nbBlanches; i++) {
      const h0 = bas + 12 * Math.floor(i / 7) + BLANCHES[i % 7];
      const h = h0 + 1;
      if (NOIRES[h % 12] === undefined || i === nbBlanches - 1) continue;
      const t = document.createElement("div");
      t.className = "touche noire";
      t.dataset.h = h;
      t.style.left = `calc((${i + 1} - 0.31) * 100% / var(--blanches))`;
      zone.appendChild(t);
    }
    habiller();
    marquer([...marquees]);
    for (const h of enfoncees.values()) zone.querySelector(`[data-h="${h}"]`)?.classList.add("enfoncee");
    dessinerCarte();
  }

  /** La gamme sur les touches : une pastille bleue sur celles de la gamme, la tonique cerclée, les autres atténuées. */
  function habiller() {
    const g = montrerGamme && tonalite ? gammeDe(tonalite) : null;
    zone.classList.toggle("avec-gamme", !!g);
    for (const t of zone.querySelectorAll(".touche")) {
      const pc = mod12(Number(t.dataset.h));
      const dans = !g || g.classes.has(pc);
      t.classList.toggle("hors", !dans);
      t.classList.toggle("tonique", !!g && pc === g.tonique);
      let repere = t.querySelector(".repere-gamme");
      if (g && dans) {
        if (!repere) { repere = document.createElement("i"); repere.className = "repere-gamme"; t.prepend(repere); }
      } else repere?.remove();
    }
  }

  // --- Le mode Gamme -----------------------------------------------------------

  function dessinerPads() {
    pads.textContent = "";
    if (bas === null || !tonalite) return;
    for (const p of touchesDeGamme(tonalite, bas)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pad" + (p.tonique ? " tonique" : "");
      b.dataset.h = p.h;
      b.setAttribute("aria-label", `Degré ${p.degre}, ${nomNote(p.h, tonalite)}`);
      b.innerHTML = `<span class="pad-haut"><span class="pad-degre">${p.degre}</span><span class="pad-octave">${p.octave}</span></span><span class="pad-nom">${p.nom}</span>`;
      pads.appendChild(b);
    }
    marquer([...marquees]);
    for (const h of enfoncees.values()) pads.querySelector(`[data-h="${h}"]`)?.classList.add("enfoncee");
  }

  function changerFacon(f, { annoncer = false } = {}) {
    facon = f === "gamme" ? "gamme" : "piano";
    zone.hidden = facon !== "piano";
    pads.hidden = facon !== "gamme";
    conteneur.querySelectorAll("[data-facon]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.facon === facon)));
    if (facon === "gamme") dessinerPads();
    else dessiner();
    dessinerCarte();
    if (annoncer) surFacon(facon);
  }

  // --- La carte des octaves ----------------------------------------------------

  /** Cinq cases, do2 à do6 d'ordinaire : l'octave de gauche en gras, celles que le clavier montre en bleu. */
  function dessinerCarte() {
    if (bas === null) return;
    const debut = fenetreOctaves(octaveDe(bas), debutCarte);
    if (debut !== debutCarte || !carte.firstChild) {
      debutCarte = debut;
      carte.textContent = "";
      for (let i = 0; i < OCTAVES_CARTE; i++) {
        const o = debutCarte + i;
        const b = document.createElement("button");
        b.type = "button";
        b.className = "carte-octave";
        b.dataset.bas = 12 * (o + 1);
        // « do » se retire des cases sur un écran très étroit (la feuille de style) : le chiffre suffit.
        b.innerHTML = `<span class="carte-do">do</span>${o}`;
        b.setAttribute("aria-label", `Aller à l'octave de do${o}`);
        carte.appendChild(b);
      }
    }
    // Ce que le clavier montre : du do de gauche jusqu'avant le dernier do, qui n'est
    // qu'une touche de plus (en mode Gamme : l'octave de gauche seulement).
    for (const b of carte.children) {
      const h = Number(b.dataset.bas);
      b.classList.toggle("dans", facon === "gamme" ? h === bas : h >= bas && h < plusHaute());
      b.setAttribute("aria-pressed", String(h === bas));
    }
  }

  /** Va à l'octave du do `h` : un geste de la personne (carte, chevrons). */
  function sauter(h) {
    const nouveau = borner(h);
    if (nouveau === bas) return;
    bas = nouveau;
    toutDessiner();
    surOctave(bas);
  }

  function toutDessiner() {
    dessiner(); // le piano, et la carte avec lui
    if (facon === "gamme") dessinerPads();
    dessinerCarte(); // (un clavier caché ne se dessine pas : la carte, elle, doit suivre)
  }

  // La carte se touche, ou se parcourt en glissant le doigt : chaque case fait ~30 px
  // de large, la bande entière sert de cible (on vise une région, pas une case).
  const caseSous = (ev) => {
    const r = carte.getBoundingClientRect();
    if (!r.width || !carte.children.length) return null;
    const i = Math.max(0, Math.min(carte.children.length - 1, Math.floor(((ev.clientX - r.left) / r.width) * carte.children.length)));
    return carte.children[i];
  };
  carte.addEventListener("pointerdown", (ev) => {
    const c = caseSous(ev);
    if (!c) return;
    ev.preventDefault();
    try { carte.setPointerCapture(ev.pointerId); } catch { /* facultatif */ }
    sauter(Number(c.dataset.bas));
  });
  carte.addEventListener("pointermove", (ev) => {
    if (!carte.hasPointerCapture?.(ev.pointerId)) return;
    const c = caseSous(ev);
    if (c) sauter(Number(c.dataset.bas));
  });
  // Au clavier de l'ordinateur (Tab, puis Entrée) : un clic sans pointeur.
  carte.addEventListener("click", (ev) => {
    const c = ev.target.closest("[data-bas]");
    if (c && ev.detail === 0) sauter(Number(c.dataset.bas));
  });
  conteneur.querySelectorAll(".clavier-octave").forEach((b) => b.addEventListener("click", () => decaler(Number(b.dataset.sens))));
  conteneur.querySelector(".clavier-facon").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-facon]");
    if (b && b.dataset.facon !== facon) changerFacon(b.dataset.facon, { annoncer: true });
  });

  // --- Les touches au doigt (piano et gamme : le même chemin) --------------------

  const toucheDe = (cible) => cible.closest(".touche, .pad");
  const allumer = (h, oui) => conteneur.querySelectorAll(`.touche[data-h="${h}"], .pad[data-h="${h}"]`).forEach((t) => t.classList.toggle("enfoncee", oui));

  function relacher(id) {
    const h = enfoncees.get(id);
    if (h === undefined) return;
    enfoncees.delete(id);
    if (![...enfoncees.values()].includes(h)) allumer(h, false);
    surNote(h, false);
  }

  for (const surface of [zone, pads]) {
    surface.addEventListener("pointerdown", (e) => {
      const t = toucheDe(e.target);
      if (!t) return;
      e.preventDefault();
      const h = Number(t.dataset.h);
      enfoncees.set(e.pointerId, h);
      t.classList.add("enfoncee");
      surNote(h, true, Math.round(70 + 40 * Math.min(1, e.pressure || 0.5)));
    });
    // Pas de menu ni de loupe quand on laisse le doigt sur une touche.
    surface.addEventListener("contextmenu", (e) => e.preventDefault());
  }
  for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, (e) => relacher(e.pointerId));
  // Au clavier de l'ordinateur, une grosse touche (Tab, puis Entrée) joue une note courte.
  pads.addEventListener("click", (e) => {
    const t = e.target.closest(".pad");
    if (!t || e.detail !== 0) return;
    const h = Number(t.dataset.h);
    surNote(h, true, 90);
    allumer(h, true);
    setTimeout(() => { allumer(h, false); surNote(h, false); }, 300);
  });

  function decaler(sens) {
    sauter(bas + 12 * sens);
  }

  /** Surligne les hauteurs choisies (la note sélectionnée dans l'idée). */
  function marquer(hauteurs) {
    marquees = new Set(hauteurs);
    conteneur.querySelectorAll(".touche, .pad").forEach((t) => t.classList.toggle("marquee", marquees.has(Number(t.dataset.h))));
  }

  /** Montre une touche enfoncée par un autre moyen (clavier MIDI, ordinateur, micro). */
  function montrer(h, enfoncee) {
    allumer(h, enfoncee);
  }

  /** Fait venir la hauteur `h` dans la partie visible, si elle n'y est pas. */
  function amener(h) {
    if (bas === null) { voulue = h; return; }
    if (visible(h)) return;
    bas = basPourVoir(h);
    toutDessiner();
  }

  /** Montre l'octave du do `h`, quoi qu'il arrive (Z et X au clavier de l'ordinateur). */
  function aller(h) {
    const nouveau = borner(h);
    if (bas === null) { bas = nouveau; return; }
    if (nouveau === bas) return;
    bas = nouveau;
    toutDessiner();
  }

  /**
   * Ce que le clavier doit savoir de l'idée et des préférences : { tonalite
   * (celle de l'idée), montrerGamme (la préférence), facon ("piano" ou "gamme") }.
   * Ne redessine que ce qui change : on l'appelle à chaque rafraîchissement.
   */
  function regler(o = {}) {
    let habille = false, refaitPads = false;
    if (o.tonalite !== undefined && o.tonalite !== tonalite) { tonalite = o.tonalite; habille = true; refaitPads = true; }
    if (o.montrerGamme !== undefined && o.montrerGamme !== montrerGamme) { montrerGamme = o.montrerGamme; habille = true; }
    if (habille && bas !== null && zone.firstChild) habiller();
    if (o.facon !== undefined && o.facon !== facon) changerFacon(o.facon);
    else if (refaitPads && facon === "gamme") dessinerPads();
  }

  // Se redessine quand la largeur change le nombre de touches, ou quand le clavier
  // reparaît (un autre mode du pupitre l'avait caché : Z et X ont pu le bouger entre-temps).
  let largeurVue = 0;
  new ResizeObserver(() => {
    const l = conteneur.clientWidth;
    if (l && (bas === null || !largeurVue || combien(l) !== nbBlanches)) toutDessiner();
    largeurVue = l;
  }).observe(conteneur);
  dessiner();
  return { marquer, montrer, amener, aller, decaler, regler, visible, get bas() { return bas; }, get facon() { return facon; } };
}
