/**
 * LA GRILLE (« PIANO ROLL »)
 *
 * Les notes de l'idée en rectangles : le temps de gauche à droite, la
 * hauteur de bas en haut, comme dans Ableton ou GarageBand. Au doigt :
 *   - toucher une case vide pose une note (de la durée choisie) ;
 *   - toucher une note la choisit et la fait entendre ; deux fois de suite,
 *     l'efface ; un appui long ouvre le menu des gestes ;
 *   - la glisser la déplace (temps et hauteur) ; tirer son bord droit
 *     l'allonge ou la raccourcit ;
 *   - toucher la règle place le curseur (là où le clavier écrit, là où la
 *     lecture part) ; toucher la ligne des accords en choisit un.
 * Glisser sur le fond fait défiler, comme partout. Les notes des autres
 * pistes restent visibles, en pâle.
 */
import { nomNote, pasParMesure, pasParTemps, nbMesures } from "./sequence.js";
import { joliAccord } from "./harmonie.js";

const HAUT = 108, BAS = 21;
const NOIRES = new Set([1, 3, 6, 8, 10]);
const NS = "http://www.w3.org/2000/svg";

export function creerGrille(conteneur, rappels) {
  let px = 11, rang = 17;
  let etat = null;
  let geste = null;
  let dernierToucher = { id: null, t: 0 };

  conteneur.classList.add("grille-notes");
  conteneur.innerHTML = `
    <div class="g-coin"></div>
    <div class="g-regle"><div class="g-regle-dedans"></div></div>
    <div class="g-touches"><div class="g-touches-dedans"></div></div>
    <div class="g-defil"><div class="g-plan"><svg class="g-fond" aria-hidden="true"></svg><div class="g-notes"></div><div class="g-curseur"></div><div class="g-lecture" hidden></div></div></div>
    <p class="g-invite" hidden>Joue sur le clavier, chante, ou touche la grille pour poser une note.</p>`;
  const regle = conteneur.querySelector(".g-regle-dedans");
  const touches = conteneur.querySelector(".g-touches-dedans");
  const defil = conteneur.querySelector(".g-defil");
  const plan = conteneur.querySelector(".g-plan");
  const fond = conteneur.querySelector(".g-fond");
  const calque = conteneur.querySelector(".g-notes");
  const curseur = conteneur.querySelector(".g-curseur");
  const tete = conteneur.querySelector(".g-lecture");
  const invite = conteneur.querySelector(".g-invite");

  const yDe = (h) => (HAUT - h) * rang;
  const hDe = (y) => Math.max(BAS, Math.min(HAUT, HAUT - Math.floor(y / rang)));

  defil.addEventListener("scroll", () => {
    regle.style.transform = `translateX(${-defil.scrollLeft}px)`;
    touches.style.transform = `translateY(${-defil.scrollTop}px)`;
  });

  // --- Dessin -------------------------------------------------------------

  let signature = "";
  function dessinerFond(seq, total) {
    const mesure = pasParMesure(seq), temps = pasParTemps(seq);
    const largeur = total * px, hauteur = (HAUT - BAS + 1) * rang;
    const sig = [largeur, hauteur, mesure, temps, px, rang].join();
    if (sig === signature) return;
    signature = sig;
    plan.style.width = `${largeur}px`;
    plan.style.height = `${hauteur}px`;
    regle.style.width = `${largeur}px`;
    touches.style.height = `${hauteur}px`;
    fond.setAttribute("width", largeur);
    fond.setAttribute("height", hauteur);
    let svg = "";
    for (let h = HAUT; h >= BAS; h--) {
      const y = yDe(h);
      if (NOIRES.has(h % 12)) svg += `<rect class="g-rang-noir" x="0" y="${y}" width="${largeur}" height="${rang}"/>`;
      if (h % 12 === 0) svg += `<line class="g-octave" x1="0" x2="${largeur}" y1="${y + rang}" y2="${y + rang}"/>`;
    }
    const pasLigne = px >= 9 ? 1 : 2;
    for (let p = 0; p <= total; p += pasLigne) {
      const classe = p % mesure === 0 ? "g-barre" : p % temps === 0 ? "g-temps" : "g-pas";
      svg += `<line class="${classe}" x1="${p * px}" x2="${p * px}" y1="0" y2="${hauteur}"/>`;
    }
    fond.innerHTML = svg;
    // Le petit clavier de gauche : on le touche pour entendre la note.
    let k = "";
    for (let h = HAUT; h >= BAS; h--) {
      k += `<div class="g-touche${NOIRES.has(h % 12) ? " noire" : ""}" data-h="${h}" style="top:${yDe(h)}px;height:${rang}px">${h % 12 === 0 ? nomNote(h) : ""}</div>`;
    }
    touches.innerHTML = k;
  }

  function dessinerRegle(seq, total) {
    const mesure = pasParMesure(seq);
    let r = "";
    if (etat.boucle) r += `<div class="g-boucle" style="left:${etat.boucle[0] * px}px;width:${(etat.boucle[1] - etat.boucle[0]) * px}px"></div>`;
    for (let m = 0; m * mesure < total; m++) {
      const accord = (seq.accords || []).filter((a) => a.d >= m * mesure && a.d < (m + 1) * mesure);
      const accords = accord.map((a) => `<span class="g-accord" style="left:${(a.d - m * mesure) * px}px">${joliAccord(a.nom)}</span>`).join("");
      r += `<div class="g-mesure" data-mesure="${m}" style="left:${m * mesure * px}px;width:${mesure * px}px">
        <div class="g-accords" role="button" tabindex="-1" data-mesure="${m}" aria-label="Accord de la mesure ${m + 1}">${accords || (etat.accordsVisibles ? '<span class="g-accord g-vide">+ accord</span>' : "")}</div>
        <span class="g-numero">${m + 1}</span></div>`;
    }
    r += `<div class="g-repere" style="left:${etat.curseur * px}px"></div>`;
    regle.innerHTML = r;
  }

  function dessinerNotes() {
    const { seq, piste, selection } = etat;
    let html = "";
    seq.pistes.forEach((p, i) => {
      if (i === piste) return;
      for (const n of p.notes) html += `<div class="g-note autre" style="left:${n.d * px}px;top:${yDe(n.h)}px;width:${n.l * px - 1}px;height:${rang - 1}px"></div>`;
    });
    for (const n of seq.pistes[piste].notes) {
      const choisie = selection.has(n.id);
      const nom = n.l * px >= 34 ? `<span>${nomNote(n.h, seq.tonalite)}</span>` : "";
      html += `<div class="g-note${choisie ? " choisie" : ""}" data-id="${n.id}" style="left:${n.d * px}px;top:${yDe(n.h)}px;width:${n.l * px - 1}px;height:${rang - 1}px">${nom}<i class="g-bord"></i></div>`;
    }
    calque.innerHTML = html;
    curseur.style.left = `${etat.curseur * px}px`;
    invite.hidden = seq.pistes.some((p) => p.notes.length);
  }

  /**
   * @param e { seq, piste, selection (Set d'ids), curseur, boucle, pas (grille
   *   d'aimantation), duree (longueur d'une note posée), accordsVisibles }
   */
  function afficher(e) {
    const premiere = !etat;
    etat = e;
    const total = (nbMesures(e.seq) + 4) * pasParMesure(e.seq);
    dessinerFond(e.seq, total);
    dessinerRegle(e.seq, total);
    dessinerNotes();
    if (premiere) requestAnimationFrame(centrer);
  }

  /** Amène les notes (ou le do central) au milieu de la vue. */
  function centrer() {
    const notes = etat.seq.pistes[etat.piste].notes;
    const hauteurs = notes.length ? notes.map((n) => n.h) : [60, 72];
    const milieu = (Math.min(...hauteurs) + Math.max(...hauteurs)) / 2;
    defil.scrollTop = Math.max(0, yDe(milieu) - defil.clientHeight / 2);
  }

  /** Fait venir une note dans la vue si elle en sort. */
  function montrer(n) {
    const x = n.d * px, y = yDe(n.h);
    if (x < defil.scrollLeft || x > defil.scrollLeft + defil.clientWidth - 40) defil.scrollLeft = Math.max(0, x - 60);
    if (y < defil.scrollTop || y > defil.scrollTop + defil.clientHeight - rang) defil.scrollTop = Math.max(0, y - defil.clientHeight / 2);
  }

  /** La tête de lecture (null : cachée) ; la vue la suit. */
  function lecture(pas) {
    tete.hidden = pas === null || pas < 0;
    if (tete.hidden) return;
    const x = pas * px;
    tete.style.transform = `translateX(${x}px)`;
    if (x > defil.scrollLeft + defil.clientWidth - 30 || x < defil.scrollLeft) defil.scrollLeft = Math.max(0, x - 30);
  }

  function zoom(facteur) {
    const centre = (defil.scrollLeft + defil.clientWidth / 2) / px;
    px = Math.max(4, Math.min(28, Math.round(px * facteur)));
    signature = "";
    afficher(etat);
    defil.scrollLeft = Math.max(0, centre * px - defil.clientWidth / 2);
  }

  // --- Gestes ---------------------------------------------------------------

  const aimanter = (pas) => Math.round(pas / etat.pas) * etat.pas;
  const noteDe = (id) => etat.seq.pistes[etat.piste].notes.find((n) => n.id === id);

  plan.addEventListener("pointerdown", (e) => {
    if (!etat || e.button > 0) return;
    const el = e.target.closest(".g-note:not(.autre)");
    const r = plan.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (!el) { geste = { type: "vide", x0: e.clientX, y0: e.clientY, x, y, t0: performance.now() }; return; }
    const id = Number(el.dataset.id);
    const n = noteDe(id);
    if (!n) return;
    e.preventDefault();
    const bord = x > (n.d + n.l) * px - Math.max(8, Math.min(18, n.l * px * 0.35));
    geste = { type: bord ? "etirer" : "deplacer", id, el, x0: e.clientX, y0: e.clientY, d: n.d, h: n.h, l: n.l, n, bouge: false };
    el.setPointerCapture(e.pointerId);
    geste.long = setTimeout(() => {
      if (!geste || geste.bouge) return;
      geste.type = "menu";
      rappels.menu(id, e.clientX, e.clientY);
    }, 550);
  });

  plan.addEventListener("pointermove", (e) => {
    if (!geste || geste.type === "vide" || geste.type === "menu") return;
    const dx = e.clientX - geste.x0, dy = e.clientY - geste.y0;
    if (!geste.bouge && Math.hypot(dx, dy) < 5) return;
    if (!geste.bouge) { geste.bouge = true; clearTimeout(geste.long); }
    const { n } = geste;
    if (geste.type === "deplacer") {
      const d = Math.max(0, aimanter(n.d + dx / px));
      const h = Math.max(BAS, Math.min(HAUT, n.h - Math.round(dy / rang)));
      if (h !== geste.h) rappels.ecouter(h);
      geste.d = d; geste.h = h;
      geste.el.style.left = `${d * px}px`;
      geste.el.style.top = `${yDe(h)}px`;
      const nom = geste.el.querySelector("span");
      if (nom) nom.textContent = nomNote(h, etat.seq.tonalite);
    } else {
      const l = Math.max(1, aimanter(n.d + n.l + dx / px) - n.d);
      geste.l = l;
      geste.el.style.width = `${l * px - 1}px`;
    }
  });

  plan.addEventListener("pointerup", (e) => {
    const g = geste;
    geste = null;
    if (!g) return;
    clearTimeout(g.long);
    if (g.type === "menu") return;
    if (g.type === "vide") {
      const bouge = Math.hypot(e.clientX - g.x0, e.clientY - g.y0) > 8;
      if (bouge || performance.now() - g.t0 > 600) return;
      rappels.poser(Math.max(0, Math.floor(g.x / px / etat.pas) * etat.pas), hDe(g.y));
      return;
    }
    if (!g.bouge) {
      const maintenant = performance.now();
      if (dernierToucher.id === g.id && maintenant - dernierToucher.t < 350) { dernierToucher = { id: null, t: 0 }; rappels.effacer(g.id); return; }
      dernierToucher = { id: g.id, t: maintenant };
      rappels.choisir(g.id, e.shiftKey || e.metaKey || e.ctrlKey);
      return;
    }
    if (g.type === "deplacer") rappels.deplacer(g.id, g.d, g.h);
    else rappels.redimensionner(g.id, g.l);
  });

  plan.addEventListener("pointercancel", () => {
    if (geste && geste.long) clearTimeout(geste.long);
    geste = null;
    if (etat) dessinerNotes();
  });
  plan.addEventListener("contextmenu", (e) => e.preventDefault());

  conteneur.querySelector(".g-regle").addEventListener("pointerdown", (e) => {
    if (!etat) return;
    const r = regle.getBoundingClientRect();
    const accords = e.target.closest(".g-accords");
    if (accords) { rappels.accord(Number(accords.dataset.mesure), (e.clientX - r.left) / px); return; }
    rappels.curseur(Math.max(0, Math.round((e.clientX - r.left) / px / pasParTemps(etat.seq)) * pasParTemps(etat.seq)));
  });
  touches.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".g-touche");
    if (t) rappels.ecouter(Number(t.dataset.h));
  });
  // Ctrl + molette : zoom, comme dans un logiciel de musique.
  defil.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  return { afficher, lecture, zoom, centrer, montrer };
}
