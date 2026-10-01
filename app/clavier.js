/**
 * LE CLAVIER À L'ÉCRAN
 *
 * Un piano qu'on joue au doigt, à plusieurs doigts (accords). Les flèches
 * changent d'octave ; le nombre de touches suit la largeur de l'écran
 * (une octave et demie sur un téléphone, trois sur un ordinateur). Il ne sait
 * rien de l'idée : il dit seulement quelle touche s'enfonce et se relève.
 */
import { nomNote } from "./sequence.js";

const BLANCHES = [0, 2, 4, 5, 7, 9, 11];
const NOIRES = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }; // demi-ton → touche blanche à sa gauche

// Une touche blanche fait 32 à 46 px : assez pour le doigt, et au moins neuf
// touches (une octave et un ton) sur un téléphone.
const largeurTouche = (largeur) => Math.max(32, Math.min(46, largeur / 10));
const combien = (largeur) => Math.max(7, Math.min(22, Math.floor(largeur / largeurTouche(largeur))));

export function creerClavier(conteneur, { surNote }) {
  let bas = null; // la touche la plus à gauche : toujours un do
  let voulue = null; // une hauteur à montrer dès le premier dessin
  let nbBlanches = 14;
  let marquees = new Set();
  const enfoncees = new Map(); // pointeur → hauteur

  conteneur.classList.add("clavier");
  conteneur.innerHTML = `
    <button class="clavier-octave" data-sens="-1" aria-label="Une octave plus bas">‹</button>
    <div class="clavier-touches" role="group" aria-label="Clavier de piano"></div>
    <button class="clavier-octave" data-sens="1" aria-label="Une octave plus haut">›</button>`;
  const zone = conteneur.querySelector(".clavier-touches");

  function dessiner() {
    if (!zone.clientWidth) return; // caché : on dessinera quand il se montrera
    nbBlanches = combien(zone.clientWidth);
    // Au départ : le do central à gauche sur un téléphone, une octave plus bas ailleurs.
    if (bas === null) {
      bas = nbBlanches < 14 ? 60 : 48;
      if (voulue !== null && (voulue < bas || voulue > plusHaute())) bas = Math.max(24, Math.min(96, 12 * Math.floor(voulue / 12)));
    }
    zone.textContent = "";
    zone.style.setProperty("--blanches", nbBlanches);
    for (let i = 0; i < nbBlanches; i++) {
      const h = bas + 12 * Math.floor(i / 7) + BLANCHES[i % 7];
      const t = document.createElement("div");
      t.className = "touche blanche";
      t.dataset.h = h;
      t.style.left = `calc(${i} * 100% / var(--blanches))`;
      if (h % 12 === 0) { const e = document.createElement("span"); e.textContent = nomNote(h); t.appendChild(e); }
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
    marquer([...marquees]);
    for (const h of enfoncees.values()) zone.querySelector(`[data-h="${h}"]`)?.classList.add("enfoncee");
  }

  function relacher(id) {
    const h = enfoncees.get(id);
    if (h === undefined) return;
    enfoncees.delete(id);
    if (![...enfoncees.values()].includes(h)) zone.querySelector(`[data-h="${h}"]`)?.classList.remove("enfoncee");
    surNote(h, false);
  }

  zone.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".touche");
    if (!t) return;
    e.preventDefault();
    const h = Number(t.dataset.h);
    enfoncees.set(e.pointerId, h);
    t.classList.add("enfoncee");
    surNote(h, true, Math.round(70 + 40 * Math.min(1, e.pressure || 0.5)));
  });
  for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, (e) => relacher(e.pointerId));
  // Pas de menu ni de loupe quand on laisse le doigt sur une touche.
  zone.addEventListener("contextmenu", (e) => e.preventDefault());
  conteneur.querySelectorAll(".clavier-octave").forEach((b) => b.addEventListener("click", () => decaler(Number(b.dataset.sens))));

  const plusHaute = () => bas + 12 * Math.floor((nbBlanches - 1) / 7) + BLANCHES[(nbBlanches - 1) % 7];

  function decaler(sens) {
    bas = Math.max(24, Math.min(96, bas + 12 * sens));
    dessiner();
  }

  /** Surligne les hauteurs choisies (la note sélectionnée dans l'idée). */
  function marquer(hauteurs) {
    marquees = new Set(hauteurs);
    zone.querySelectorAll(".touche").forEach((t) => t.classList.toggle("marquee", marquees.has(Number(t.dataset.h))));
  }

  /** Montre une touche enfoncée par un autre moyen (clavier MIDI, ordinateur, micro). */
  function montrer(h, enfoncee) {
    zone.querySelector(`[data-h="${h}"]`)?.classList.toggle("enfoncee", enfoncee);
  }

  /** Fait venir la hauteur `h` dans la partie visible, si elle n'y est pas. */
  function amener(h) {
    if (bas === null) { voulue = h; return; }
    if (h >= bas && h <= plusHaute()) return;
    bas = Math.max(24, Math.min(96, 12 * Math.floor(h / 12)));
    dessiner();
  }

  new ResizeObserver(() => { if (zone.clientWidth && (bas === null || combien(zone.clientWidth) !== nbBlanches)) dessiner(); }).observe(zone);
  dessiner();
  return { marquer, montrer, amener, decaler, get bas() { return bas; } };
}
