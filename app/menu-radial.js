/**
 * LE MENU EN CERCLE
 *
 * Les gestes sur une phrase, en cercle autour du doigt : on garde le doigt
 * appuyé sur une note, le menu s'ouvre, on glisse vers un geste et on lâche
 * (ou on touche le geste, menu ouvert). Plus rapide qu'une barre d'outils,
 * et le pouce n'a pas à traverser l'écran.
 *
 * Chaque geste : { id, icone (nom dans icones.js), libelle, aide, famille } ;
 * les gestes d'une même famille se suivent dans `actions` : le cercle les
 * pose côte à côte, sur une même bande, et laisse un creux plus large
 * entre deux familles (le nom de la famille s'écrit en dedans, si
 * `familles` donne { famille: nom }). Sans famille, un cercle régulier.
 * surFermer() (facultatif) est appelé dès que le menu se ferme.
 */
import { ico } from "./icones.js";

const SVG = "http://www.w3.org/2000/svg";

/**
 * L'angle de chaque geste (radians ; 0 à droite, le sens des aiguilles
 * d'une montre). Entre deux gestes d'une famille : un pas ; entre deux
 * familles : un pas et demi. Le plus grand creux est centré sur `creux`
 * (par défaut vers le bas, là où la main cache déjà le cercle) : on
 * part de là et on fait le tour.
 */
export function disposer(actions, creux = Math.PI / 2) {
  const n = actions.length;
  const groupes = [];
  actions.forEach((a, i) => {
    const dernier = groupes[groupes.length - 1];
    if (dernier && a.famille !== undefined && dernier.famille === a.famille) dernier.indices.push(i);
    else groupes.push({ famille: a.famille, indices: [i] });
  });
  // Sans familles (ou une seule) : un cercle régulier, le premier geste en haut.
  const regulier = groupes.length <= 1 || actions.every((a) => a.famille === undefined);
  const pas = (2 * Math.PI) / (regulier ? n : n + groupes.length / 2);
  const ecart = regulier ? pas : pas * 1.5;
  const angles = new Array(n);
  let angle = regulier ? -Math.PI / 2 : creux + ecart / 2;
  for (const g of groupes) {
    for (const i of g.indices) { angles[i] = angle; angle += pas; }
    angle += ecart - pas;
  }
  return { angles, groupes, pas };
}

export function creerMenuRadial({ actions, familles = {}, surChoix, surFermer = () => {} }) {
  const fond = document.createElement("div");
  fond.className = "radial";
  fond.hidden = true;
  fond.innerHTML = `<div class="radial-cercle"><svg class="radial-bandes" aria-hidden="true"></svg><button class="radial-centre" aria-label="Fermer le menu">${ico("fermer")}</button>${actions.map((a) => `<button class="radial-geste" data-geste="${a.id}" title="${a.aide || a.libelle}" aria-label="${a.aide || a.libelle}">${ico(a.icone)}<span class="radial-texte" aria-hidden="true">${a.libelle}</span></button>`).join("")}</div>`;
  document.body.appendChild(fond);
  const cercle = fond.querySelector(".radial-cercle");
  const bandes = fond.querySelector(".radial-bandes");
  const gestes = [...fond.querySelectorAll(".radial-geste")];
  const { angles, groupes, pas } = disposer(actions);
  let survole = null;
  let ouvertA = 0;

  function placer(x, y) {
    const rayon = Math.min(136, (Math.min(innerWidth, innerHeight) - 90) / 2);
    // Deux gestes d'une même famille se touchent presque : sur un petit écran, le cercle rétrécit et les boutons aussi.
    const taille = Math.max(46, Math.min(66, Math.floor(2 * rayon * Math.sin(pas / 2)) - 3));
    cercle.style.setProperty("--bouton", `${taille}px`);
    const marge = rayon + taille / 2 + 15;
    const cx = Math.max(marge, Math.min(innerWidth - marge, x));
    const cy = Math.max(marge, Math.min(innerHeight - marge, y));
    cercle.style.left = `${cx}px`;
    cercle.style.top = `${cy}px`;
    gestes.forEach((g, i) => {
      g.style.transform = `translate(${Math.cos(angles[i]) * rayon}px, ${Math.sin(angles[i]) * rayon}px) translate(-50%, -50%)`;
    });
    // Une bande par famille, derrière ses gestes (un trait épais aux bouts ronds, deux fois :
    // le bord, puis le fond), et le nom de la famille en dedans, face à elle.
    bandes.textContent = "";
    cercle.querySelectorAll(".radial-famille").forEach((el) => el.remove());
    if (groupes.length <= 1 || actions.every((a) => a.famille === undefined)) return;
    for (const g of groupes) {
      const a = angles[g.indices[0]], b = angles[g.indices[g.indices.length - 1]];
      const point = (t, r = rayon) => `${(Math.cos(t) * r).toFixed(1)} ${(Math.sin(t) * r).toFixed(1)}`;
      const d = g.indices.length > 1 ? `M ${point(a)} A ${rayon} ${rayon} 0 0 1 ${point(b)}` : `M ${point(a)} l 0.01 0`;
      for (const [classe, epaisseur] of [["radial-bande-bord", taille + 14], ["radial-bande", taille + 12]]) {
        const p = document.createElementNS(SVG, "path");
        p.setAttribute("class", classe);
        p.setAttribute("stroke-width", epaisseur);
        p.setAttribute("d", d);
        bandes.appendChild(p);
      }
      if (g.famille !== undefined && familles[g.famille]) {
        const milieu = (a + b) / 2;
        const t = document.createElement("span");
        t.className = "radial-famille";
        t.textContent = familles[g.famille];
        const dedans = rayon - taille - 2;
        t.style.transform = `translate(${Math.cos(milieu) * dedans}px, ${Math.sin(milieu) * dedans}px) translate(-50%, -50%)`;
        cercle.appendChild(t);
      }
    }
  }

  // Les écouteurs du glissé (appui long → glisser → lâcher), posés à l'ouverture
  // et retirés d'un seul geste, quelle que soit la façon dont le menu se ferme (T5).
  let glisse = null;
  function finirGlisse() {
    if (glisse) glisse.abort();
    glisse = null;
  }

  function fermer() {
    const etait = !fond.hidden;
    fond.hidden = true;
    survole = null;
    gestes.forEach((g) => g.classList.remove("survole"));
    finirGlisse();
    if (etait) surFermer();
  }

  /** Le geste sous le doigt (pendant le glissé du « appui long → glisser → lâcher »). */
  function suivre(ev) {
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    const g = el && el.closest && el.closest(".radial-geste");
    if (g === survole) return;
    gestes.forEach((x) => x.classList.toggle("survole", x === g));
    survole = g;
  }

  function lacher() {
    finirGlisse();
    if (survole) { const id = survole.dataset.geste; fermer(); surChoix(id); }
  }

  fond.addEventListener("click", (ev) => {
    const g = ev.target.closest(".radial-geste");
    if (g) { fermer(); surChoix(g.dataset.geste); return; }
    // Le doigt qui vient d'ouvrir le menu (appui long) ne le referme pas en se levant.
    if (performance.now() - ouvertA < 400) return;
    fermer();
  });
  document.addEventListener("keydown", (ev) => { if (!fond.hidden && ev.key === "Escape") fermer(); });

  return {
    /** Ouvre autour de (x, y) ; `glisser` : le doigt est encore posé (appui long). */
    ouvrir(x, y, { glisser = false } = {}) {
      placer(x, y);
      fond.hidden = false;
      ouvertA = performance.now();
      if (glisser) {
        finirGlisse();
        glisse = new AbortController();
        window.addEventListener("pointermove", suivre, { signal: glisse.signal });
        window.addEventListener("pointerup", lacher, { signal: glisse.signal });
      }
    },
    fermer,
    get ouvert() { return !fond.hidden; },
  };
}
