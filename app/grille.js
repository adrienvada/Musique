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
 *     lecture part) et choisit la mesure (celle des accords) ; toucher
 *     l'accord d'une mesure, ou « + accord » sur la mesure choisie, ouvre
 *     les accords ;
 *   - pincer à deux doigts (ou Ctrl + molette) zoome dans le temps.
 * Glisser sur le fond fait défiler, comme partout. Les notes des autres
 * pistes restent visibles, en pâle.
 *
 * La règle n'écrit « + accord » que sur la mesure choisie : répété dans
 * chaque mesure, il couvrait la règle d'un texte gris qu'on ne lisait plus.
 */
import { nomNote, pasParMesure, pasParTemps, nbMesures } from "./sequence.js";
import { joliAccord } from "./harmonie.js";
import { ico } from "./icones.js";

const HAUT = 108, BAS = 21;
const NOIRES = new Set([1, 3, 6, 8, 10]);
const PX_MIN = 4, PX_MAX = 28;
const borne = (x, a, b) => Math.max(a, Math.min(b, x));

export function creerGrille(conteneur, rappels) {
  // Au doigt, des rangées plus hautes : une note de 20 px se touche sans viser.
  const auDoigt = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  let px = 11, rang = auDoigt ? 20 : 17;
  let etat = null;
  let geste = null;
  let pince = null;
  const pointeurs = new Set();
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
    if (rappels.defile) rappels.defile();
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
      // Entre si et do (l'octave), et entre mi et fa : deux touches blanches côte à côte.
      if (h % 12 === 0) svg += `<line class="g-octave" x1="0" x2="${largeur}" y1="${y + rang - 0.5}" y2="${y + rang - 0.5}"/>`;
      else if (h % 12 === 5) svg += `<line class="g-mi-fa" x1="0" x2="${largeur}" y1="${y + rang - 0.5}" y2="${y + rang - 0.5}"/>`;
    }
    const pasLigne = px >= 9 ? 1 : 2;
    for (let p = 0; p <= total; p += pasLigne) {
      const classe = p % mesure === 0 ? "g-barre" : p % temps === 0 ? "g-temps" : "g-pas";
      const x = p * px + (classe === "g-barre" ? 0 : 0.5);
      svg += `<line class="${classe}" x1="${x}" x2="${x}" y1="0" y2="${hauteur}"/>`;
    }
    fond.innerHTML = svg;
    // La bande de gauche : un petit clavier qu'on touche pour entendre la
    // note. Les do portent leur octave ; les autres touches blanches leur
    // nom quand la rangée est assez haute pour le lire.
    let k = "";
    for (let h = HAUT; h >= BAS; h--) {
      const noire = NOIRES.has(h % 12);
      const nom = noire ? "" : h % 12 === 0 ? nomNote(h) : rang >= 14 ? nomNote(h).replace(/-?\d+$/, "") : "";
      k += `<div class="g-touche${noire ? " noire" : ""}${h % 12 === 0 ? " do" : ""}" data-h="${h}" style="top:${yDe(h)}px;height:${rang}px">${nom}</div>`;
    }
    touches.innerHTML = k;
  }

  function dessinerRegle(seq, total) {
    const mesure = pasParMesure(seq);
    let r = "";
    if (etat.boucle) r += `<div class="g-boucle" style="left:${etat.boucle[0] * px}px;width:${(etat.boucle[1] - etat.boucle[0]) * px}px"></div>`;
    for (let m = 0; m * mesure < total; m++) {
      const accords = (seq.accords || []).filter((a) => a.d >= m * mesure && a.d < (m + 1) * mesure);
      const noms = accords.map((a) => `<button type="button" class="g-accord" data-mesure="${m}" style="left:${a.d === m * mesure ? 22 : (a.d - m * mesure) * px + 4}px" aria-label="Accord ${joliAccord(a.nom)}, mesure ${m + 1}">${joliAccord(a.nom)}</button>`).join("");
      const ajouter = !accords.length && etat.accordsVisibles ? `<button type="button" class="g-ajouter" data-mesure="${m}" aria-label="Poser un accord, mesure ${m + 1}">${ico("plus", "s")}accord</button>` : "";
      r += `<div class="g-mesure${m === etat.mesureChoisie ? " choisie" : ""}" data-mesure="${m}" style="left:${m * mesure * px}px;width:${mesure * px}px"><span class="g-numero">${m + 1}</span>${noms}${ajouter}</div>`;
    }
    r += `<div class="g-repere" style="left:${etat.curseur * px}px"${etat.curseurVisible === false ? " hidden" : ""}></div>`;
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
      const nom = n.l * px >= 30 ? `<span>${nomNote(n.h, seq.tonalite)}</span>` : "";
      html += `<div class="g-note${choisie ? " choisie" : ""}" data-id="${n.id}" style="left:${n.d * px}px;top:${yDe(n.h)}px;width:${n.l * px - 1}px;height:${rang - 1}px">${nom}<i class="g-bord"></i></div>`;
    }
    calque.innerHTML = html;
    curseur.style.left = `${etat.curseur * px}px`;
    curseur.hidden = etat.curseurVisible === false;
    invite.hidden = seq.pistes.some((p) => p.notes.length);
  }

  /**
   * @param e { seq, piste, selection (Set d'ids), curseur, curseurVisible,
   *   boucle, pas (grille d'aimantation), mesureChoisie, accordsVisibles }
   */
  function afficher(e) {
    const premiere = !etat;
    etat = e;
    // Quatre mesures libres après la dernière note, et au moins toute la largeur visible.
    const mesure = pasParMesure(e.seq);
    const visibles = Math.ceil((defil.clientWidth || 0) / (px * mesure));
    const total = Math.max(nbMesures(e.seq) + 4, visibles + 1) * mesure;
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

  /**
   * Le cadre des notes `ids` de la piste, à l'écran (coordonnées du
   * navigateur), et la partie visible des notes : la pilule de la
   * sélection s'y place.
   */
  function boite(ids) {
    if (!etat) return null;
    const voulues = new Set(ids);
    const notes = etat.seq.pistes[etat.piste].notes.filter((n) => voulues.has(n.id));
    if (!notes.length) return null;
    const r = plan.getBoundingClientRect();
    return {
      boite: {
        left: r.left + Math.min(...notes.map((n) => n.d)) * px,
        right: r.left + Math.max(...notes.map((n) => n.d + n.l)) * px,
        top: r.top + Math.min(...notes.map((n) => yDe(n.h))),
        bottom: r.top + Math.max(...notes.map((n) => yDe(n.h))) + rang,
      },
      zone: defil.getBoundingClientRect(),
    };
  }

  /** La tête de lecture (null : cachée) ; la vue la suit. */
  function lecture(pas) {
    tete.hidden = pas === null || pas < 0;
    if (tete.hidden) return;
    const x = pas * px;
    tete.style.transform = `translateX(${x}px)`;
    if (x > defil.scrollLeft + defil.clientWidth - 30 || x < defil.scrollLeft) defil.scrollLeft = Math.max(0, x - 30);
  }

  /**
   * Zoom dans le temps. `ancre` (abscisse à l'écran) reste sous le doigt ;
   * sans elle, c'est le milieu de la vue.
   */
  function zoomA(nouveau, ancre = null) {
    if (!etat) return;
    const r = defil.getBoundingClientRect();
    const x = ancre === null ? defil.clientWidth / 2 : borne(ancre - r.left, 0, defil.clientWidth);
    const instant = (defil.scrollLeft + x) / px;
    const avant = px;
    px = borne(nouveau, PX_MIN, PX_MAX);
    if (px === avant) return;
    signature = "";
    afficher(etat);
    defil.scrollLeft = Math.max(0, instant * px - x);
  }
  const zoom = (facteur, ancre = null) => zoomA(Math.round(px * facteur), ancre);

  // --- Gestes ---------------------------------------------------------------

  const aimanter = (pas) => Math.round(pas / etat.pas) * etat.pas;
  const noteDe = (id) => etat.seq.pistes[etat.piste].notes.find((n) => n.id === id);

  /** Un geste interrompu (deuxième doigt, appel du système) : tout revient. */
  function abandonner() {
    if (geste && geste.long) clearTimeout(geste.long);
    const bougeait = geste && geste.bouge;
    geste = null;
    conteneur.classList.remove("en-geste");
    if (etat && bougeait) dessinerNotes();
  }

  plan.addEventListener("pointerdown", (e) => {
    pointeurs.add(e.pointerId);
    // Deux doigts : c'est un pincement, pas une note qu'on pose ou qu'on tire.
    if (pointeurs.size > 1) { abandonner(); return; }
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
    if (!geste.bouge) { geste.bouge = true; clearTimeout(geste.long); conteneur.classList.add("en-geste"); }
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

  const finPointeur = (e) => pointeurs.delete(e.pointerId);
  plan.addEventListener("pointerup", (e) => {
    finPointeur(e);
    const g = geste;
    geste = null;
    conteneur.classList.remove("en-geste");
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

  plan.addEventListener("pointercancel", (e) => { finPointeur(e); abandonner(); });
  // Un doigt levé hors de la grille ne doit pas y rester compté.
  for (const type of ["pointerup", "pointercancel"]) window.addEventListener(type, finPointeur);
  plan.addEventListener("contextmenu", (e) => e.preventDefault());

  const regleCadre = conteneur.querySelector(".g-regle");
  regleCadre.addEventListener("pointerdown", (e) => {
    if (!etat || e.target.closest(".g-accord, .g-ajouter")) return;
    const r = regle.getBoundingClientRect();
    const pas = (e.clientX - r.left) / px;
    const temps = pasParTemps(etat.seq);
    rappels.curseur(Math.max(0, Math.round(pas / temps) * temps), Math.max(0, Math.floor(pas / pasParMesure(etat.seq))));
  });
  // Les accords s'ouvrent au clic, pas à l'appui : la feuille qui monte
  // recevrait sinon le clic du même doigt sur son voile, et se refermerait.
  regleCadre.addEventListener("click", (e) => {
    const accord = etat && e.target.closest(".g-accord, .g-ajouter");
    if (!accord) return;
    const r = regle.getBoundingClientRect();
    rappels.accord(Number(accord.dataset.mesure), (e.clientX - r.left) / px);
  });
  touches.addEventListener("pointerdown", (e) => {
    const t = e.target.closest(".g-touche");
    if (t) rappels.ecouter(Number(t.dataset.h));
  });
  // Ctrl + molette (et le pincement du pavé tactile, que le navigateur
  // envoie ainsi) : zoom, comme dans un logiciel de musique.
  defil.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomA(px * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
  }, { passive: false });
  // Pincer à deux doigts : le temps s'étire ou se resserre entre les doigts.
  // La grille garde son défilement au doigt (touch-action) ; seul le
  // mouvement à deux doigts est pris ici.
  let imagePince = null;
  defil.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    pince = { ecart: Math.max(20, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), px, centre: (a.clientX + b.clientX) / 2 };
    abandonner();
  }, { passive: true });
  defil.addEventListener("touchmove", (e) => {
    if (!pince || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    const ecart = Math.max(20, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY));
    cancelAnimationFrame(imagePince);
    imagePince = requestAnimationFrame(() => { if (pince) zoomA(pince.px * (ecart / pince.ecart), pince.centre); });
  }, { passive: false });
  const finPince = (e) => { if (e.touches.length < 2) pince = null; };
  defil.addEventListener("touchend", finPince);
  defil.addEventListener("touchcancel", finPince);

  return {
    afficher, lecture, zoom, centrer, montrer, boite,
    get px() { return px; },
  };
}
