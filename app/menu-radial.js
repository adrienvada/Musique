/**
 * LE MENU EN CERCLE
 *
 * Les gestes sur une phrase, en cercle autour du doigt : on garde le doigt
 * appuyé sur une note, le menu s'ouvre, on glisse vers un geste et on lâche
 * (ou on touche le geste, menu ouvert). Plus rapide qu'une barre d'outils,
 * et le pouce n'a pas à traverser l'écran.
 *
 * Chaque geste : { id, icone (nom dans icones.js), libelle, aide } ;
 * surFermer() (facultatif) est appelé dès que le menu se ferme.
 */
import { ico } from "./icones.js";

export function creerMenuRadial({ actions, surChoix, surFermer = () => {} }) {
  const fond = document.createElement("div");
  fond.className = "radial";
  fond.hidden = true;
  fond.innerHTML = `<div class="radial-cercle"><button class="radial-centre" aria-label="Fermer le menu">${ico("fermer")}</button>${actions.map((a) => `<button class="radial-geste" data-geste="${a.id}" title="${a.aide || a.libelle}" aria-label="${a.aide || a.libelle}">${ico(a.icone)}<span class="radial-texte" aria-hidden="true">${a.libelle}</span></button>`).join("")}</div>`;
  document.body.appendChild(fond);
  const cercle = fond.querySelector(".radial-cercle");
  const gestes = [...fond.querySelectorAll(".radial-geste")];
  let survole = null;
  let ouvertA = 0;

  function placer(x, y) {
    const rayon = Math.min(118, (Math.min(innerWidth, innerHeight) - 70) / 2);
    const marge = rayon + 34;
    const cx = Math.max(marge, Math.min(innerWidth - marge, x));
    const cy = Math.max(marge, Math.min(innerHeight - marge, y));
    cercle.style.left = `${cx}px`;
    cercle.style.top = `${cy}px`;
    gestes.forEach((g, i) => {
      const angle = -Math.PI / 2 + (2 * Math.PI * i) / gestes.length;
      g.style.transform = `translate(${Math.cos(angle) * rayon}px, ${Math.sin(angle) * rayon}px) translate(-50%, -50%)`;
    });
  }

  function fermer() {
    const etait = !fond.hidden;
    fond.hidden = true;
    survole = null;
    gestes.forEach((g) => g.classList.remove("survole"));
    window.removeEventListener("pointermove", suivre);
    window.removeEventListener("pointerup", lacher);
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
    window.removeEventListener("pointermove", suivre);
    window.removeEventListener("pointerup", lacher);
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
        window.addEventListener("pointermove", suivre);
        window.addEventListener("pointerup", lacher);
      }
    },
    fermer,
    get ouvert() { return !fond.hidden; },
  };
}
