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
 *   - pincer à deux doigts zoome : en écartant les doigts en largeur, le
 *     temps s'étire ; en hauteur, les rangées grandissent. Un pincement en
 *     biais fait les deux. À la souris : Ctrl + molette pour le temps,
 *     Alt + molette pour la hauteur.
 * Glisser sur le fond fait défiler, comme partout. Les notes des autres
 * pistes restent visibles, en pâle. En mode Chanter, une couche « voix » y
 * trace la hauteur chantée (voir plus bas).
 *
 * La règle n'écrit « + accord » que sur la mesure choisie : répété dans
 * chaque mesure, il couvrait la règle d'un texte gris qu'on ne lisait plus.
 */
import { nomNote, pasParMesure, pasParTemps, nbMesures } from "./sequence.js";
import { joliAccord } from "./harmonie.js";
import { ico } from "./icones.js";
import { echapper } from "./ui.js";
import { lirePref, ecrirePref } from "./preferences.js";

const HAUT = 108, BAS = 21;
const NOIRES = new Set([1, 3, 6, 8, 10]);
// Le temps : un pas (la double croche) de 4 à 28 px. La hauteur : une rangée
// de 6 px (plus de quatre octaves dans la vue d'un téléphone, pour voir où
// est la mélodie) à 44 px (la taille d'un doigt : au-delà, rien n'y gagne).
const PX_MIN = 4, PX_MAX = 28;
const RANG_MIN = 6, RANG_MAX = 44;
// En dessous de cette hauteur de rangée, le nom de la note ne tient plus dans son rectangle.
const RANG_NOM = 13;
const CLE_ZOOM = "portee:zoom-grille";
const borne = (x, a, b) => Math.max(a, Math.min(b, x));

/**
 * Ce qu'un pincement change au zoom : l'écart des doigts en largeur règle le
 * temps, l'écart en hauteur règle les rangées. `debut` et `maintenant` :
 * { dx, dy }, les écarts (positifs) entre les deux doigts, en px.
 *
 * Un écart de moins de `plancher` px compte pour `plancher` : deux doigts
 * posés côte à côte ne sont jamais tout à fait à la même hauteur, et ce
 * petit écart vertical, qui varie d'un rien, ne doit pas faire bondir la
 * hauteur des rangées pendant qu'on zoome dans le temps (et inversement).
 */
export function facteursPince(debut, maintenant, plancher = 60) {
  const f = (avant, apres) => Math.max(apres, plancher) / Math.max(avant, plancher);
  return { temps: f(debut.dx, maintenant.dx), hauteur: f(debut.dy, maintenant.dy) };
}

export function creerGrille(conteneur, rappels) {
  // Au doigt, des rangées plus hautes : une note de 20 px se touche sans viser.
  // Le zoom choisi se garde sur l'appareil : on le règle une fois à sa main.
  const auDoigt = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  let px = 11, rang = auDoigt ? 20 : 17;
  try {
    const z = JSON.parse(lirePref(CLE_ZOOM) || "null");
    if (z && Number.isFinite(z.px) && Number.isFinite(z.rang)) {
      px = borne(z.px, PX_MIN, PX_MAX);
      rang = borne(Math.round(z.rang), RANG_MIN, RANG_MAX);
    }
  } catch { /* une préférence illisible : le zoom par défaut */ }
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
      const noms = accords.map((a) => `<button type="button" class="g-accord" data-mesure="${m}" style="left:${a.d === m * mesure ? 22 : (a.d - m * mesure) * px + 4}px" aria-label="Accord ${echapper(joliAccord(a.nom))}, mesure ${m + 1}">${echapper(joliAccord(a.nom))}</button>`).join("");
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
      const nom = n.l * px >= 30 && rang >= RANG_NOM ? `<span>${nomNote(n.h, seq.tonalite)}</span>` : "";
      html += `<div class="g-note${choisie ? " choisie" : ""}" data-id="${echapper(n.id)}" style="left:${n.d * px}px;top:${yDe(n.h)}px;width:${n.l * px - 1}px;height:${rang - 1}px">${nom}<i class="g-bord"></i></div>`;
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
   * Un point de la vue : sa place dans la zone qui défile (x, y, en px) et ce
   * qu'il y a dessous (pas : le temps, en pas ; rangs : la hauteur, en
   * rangées depuis le haut). Sans coordonnées, le milieu de la vue.
   */
  function point(clientX = null, clientY = null) {
    const r = defil.getBoundingClientRect();
    const x = clientX === null ? defil.clientWidth / 2 : borne(clientX - r.left, 0, defil.clientWidth);
    const y = clientY === null ? defil.clientHeight / 2 : borne(clientY - r.top, 0, defil.clientHeight);
    return { x, y, pas: (defil.scrollLeft + x) / px, rangs: (defil.scrollTop + y) / rang };
  }

  /**
   * Zoom dans le temps (`nouveauPx`) et en hauteur (`nouveauRang`). Ce qui
   * était sous `p` (pas, rangs) revient sous sa place à l'écran (x, y) : sous
   * les doigts qui pincent, ou au milieu de la vue.
   */
  function zoomA(nouveauPx, nouveauRang, p = point()) {
    if (!etat) return;
    const avant = [px, rang];
    px = borne(nouveauPx, PX_MIN, PX_MAX);
    rang = borne(Math.round(nouveauRang), RANG_MIN, RANG_MAX);
    if (px !== avant[0] || rang !== avant[1]) {
      signature = "";
      afficher(etat);
      retenirZoom();
    }
    defil.scrollLeft = Math.max(0, p.pas * px - p.x);
    defil.scrollTop = Math.max(0, p.rangs * rang - p.y);
  }
  /** Les boutons − et + : `axe` vaut "temps" ou "hauteur". */
  const zoom = (facteur, axe = "temps") => axe === "hauteur" ? zoomA(px, rang * facteur) : zoomA(Math.round(px * facteur), rang);

  // Écrit une fois le geste fini, pas à chaque image d'un pincement.
  let minuterieZoom = null;
  function retenirZoom() {
    clearTimeout(minuterieZoom);
    minuterieZoom = setTimeout(() => ecrirePref(CLE_ZOOM, JSON.stringify({ px, rang })), 400);
  }

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
  // envoie ainsi) : zoom dans le temps, comme dans un logiciel de musique.
  // Alt + molette : la hauteur des rangées (Ableton fait de même).
  defil.addEventListener("wheel", (e) => {
    if (!e.ctrlKey && !e.altKey) return;
    e.preventDefault();
    // Alt change parfois la molette en défilement de côté : on prend le delta qui bouge.
    const delta = e.deltaY || e.deltaX;
    if (!delta) return;
    const f = delta < 0 ? 1.15 : 1 / 1.15;
    const p = point(e.clientX, e.clientY);
    if (e.ctrlKey) zoomA(px * f, rang, p);
    else zoomA(px, rang * f, p);
  }, { passive: false });
  // Pincer à deux doigts : la grille s'étire entre les doigts, en largeur
  // (le temps) et en hauteur (les rangées), et suit leur milieu (on peut
  // déplacer la vue en pinçant). La grille garde son défilement à un doigt
  // (touch-action) ; seul le mouvement à deux doigts est pris ici.
  let imagePince = null;
  const ecarts = (a, b) => ({ dx: Math.abs(a.clientX - b.clientX), dy: Math.abs(a.clientY - b.clientY) });
  defil.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 2) return;
    const [a, b] = e.touches;
    const p = point((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    pince = { ...ecarts(a, b), px, rang, pas: p.pas, rangs: p.rangs };
    abandonner();
  }, { passive: true });
  defil.addEventListener("touchmove", (e) => {
    if (!pince || e.touches.length !== 2) return;
    if (e.cancelable) e.preventDefault();
    const [a, b] = e.touches;
    const f = facteursPince(pince, ecarts(a, b));
    const cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
    cancelAnimationFrame(imagePince);
    imagePince = requestAnimationFrame(() => {
      if (!pince) return;
      const r = defil.getBoundingClientRect();
      zoomA(pince.px * f.temps, pince.rang * f.hauteur, { pas: pince.pas, rangs: pince.rangs, x: cx - r.left, y: cy - r.top });
    });
  }, { passive: false });
  const finPince = (e) => { if (e.touches.length < 2) pince = null; };
  defil.addEventListener("touchend", finPince);
  defil.addEventListener("touchcancel", finPince);

  // --- La voix (mode Chanter) -------------------------------------------------
  //
  // idee-chant.js y pose, mesure après mesure, la hauteur de la voix : un
  // trait (le surligneur) défile vers la gauche au-dessus de la grille, avec
  // un point au bout, et la rangée visée s'allume dessous, comme sa touche
  // dans la bande de gauche. Les rangées étant déjà les notes, la voix se lit
  // sans autre échelle. La grille défile en hauteur pour garder la voix dans
  // la vue. La couche ne prend aucun toucher et ne dessine rien tant qu'on
  // ne chante pas ; son style est dans idee-chant.css.
  function creerVoix() {
    const reduit = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const MEMOIRE = 4000; // ms de voix gardées : la longueur du trait
    const TOUR = 2 * Math.PI * 12; // le tour du point : la tenue s'y remplit
    let points = []; // { t, m } : m est une hauteur MIDI (fractionnaire), null pour un silence
    let cible = null, tenue = 0, image = 0, suit = false;
    let couche = null, rangee = null, touche = null, trace = null, bord = null, anneau = null, eclatPoint = null, cercles = [], degrades = [], cadreVoix = "", finEclat = null;
    const yPlan = (m) => yDe(m) + rang / 2; // le milieu de la rangée de la note m

    function preparer() {
      if (couche) return;
      couche = document.createElement("div");
      couche.className = "g-voix";
      couche.setAttribute("aria-hidden", "true");
      // Le trait s'efface en s'éloignant du point : un dégradé d'opacité tendu dans
      // l'espace de la couche (userSpaceOnUse). Calé sur la boîte du trait, il ne
      // marcherait pas : une ligne presque horizontale n'a presque pas de hauteur.
      couche.innerHTML = `<svg><defs>
        <linearGradient id="g-voix-trace" class="g-degrade-trace" gradientUnits="userSpaceOnUse" y1="0" y2="0"><stop offset="0" stop-opacity="0"/><stop offset="1" stop-opacity="1"/></linearGradient>
        <linearGradient id="g-voix-bord" class="g-degrade-bord" gradientUnits="userSpaceOnUse" y1="0" y2="0"><stop offset="0" stop-opacity="0"/><stop offset="1" stop-opacity="0.75"/></linearGradient>
      </defs><path class="g-bord-trace"/><path class="g-trace"/><circle class="g-eclat" r="12"/><circle class="g-piste" r="12"/><circle class="g-anneau" r="12"/><circle class="g-pointe" r="6"/></svg>`;
      conteneur.appendChild(couche);
      trace = couche.querySelector(".g-trace");
      bord = couche.querySelector(".g-bord-trace");
      anneau = couche.querySelector(".g-anneau");
      eclatPoint = couche.querySelector(".g-eclat");
      cercles = [...couche.querySelectorAll("circle")];
      degrades = [...couche.querySelectorAll("linearGradient")];
      anneau.setAttribute("stroke-dasharray", TOUR.toFixed(2));
      // La rangée visée se glisse sous les notes, au-dessus du fond.
      rangee = document.createElement("div");
      rangee.className = "g-cible";
      rangee.hidden = true;
      plan.insertBefore(rangee, calque);
    }

    /** Allume la rangée de la note h (et sa touche) ; null l'éteint. */
    function allumer(h) {
      if (h === cible && (h === null || (touche && touche.isConnected && rangee.style.height === `${rang}px`))) return;
      cible = h;
      if (touche) touche.classList.remove("cible");
      touche = null;
      if (!rangee) return;
      rangee.hidden = h === null;
      if (h === null) return;
      rangee.style.top = `${yDe(h)}px`;
      rangee.style.height = `${rang}px`;
      touche = touches.querySelector(`.g-touche[data-h="${h}"]`);
      if (touche) touche.classList.add("cible");
    }

    function dessiner() {
      image = 0;
      if (!couche) return;
      const L = defil.clientWidth, H = defil.clientHeight;
      if (!L || !H) { couche.classList.remove("actif"); return; } // la grille est cachée (la partition)
      // La couche recouvre exactement la zone qui défile (sans sa barre de défilement).
      // Elle ne se place pas dans la grille CSS : un élément à place fixe y chasserait
      // la zone de sa case.
      const cadre = `${defil.offsetLeft}px ${defil.offsetTop}px ${L}px ${H}px`;
      if (cadre !== cadreVoix) {
        cadreVoix = cadre;
        Object.assign(couche.style, { left: `${defil.offsetLeft}px`, top: `${defil.offsetTop}px`, width: `${L}px`, height: `${H}px` });
      }
      const maintenant = performance.now();
      while (points.length && maintenant - points[0].t > MEMOIRE) points.shift();
      const dernier = points[points.length - 1];
      const enVoix = !!dernier && dernier.m !== null && maintenant - dernier.t < 250;
      // La grille défile en hauteur pour garder la voix dans la vue : dès qu'elle
      // approche d'un bord, la grille la recentre en douceur.
      if (enVoix) {
        const y = yPlan(dernier.m);
        const marge = Math.min(rang * 2.5, H / 4);
        const vue = y - defil.scrollTop;
        if (vue < marge || vue > H - marge) suit = true;
        if (suit) {
          const but = Math.max(0, Math.min(defil.scrollHeight - H, y - H / 2));
          // En douceur ; d'un coup si la voix est sortie de la vue (elle ne doit pas
          // se chercher), ou pour qui a demandé moins de mouvement.
          defil.scrollTop += (but - defil.scrollTop) * (reduit || vue < 0 || vue > H ? 1 : 0.2);
          if (Math.abs(but - defil.scrollTop) < 1.5) suit = false;
        }
      }
      // Le point est à droite ; le trait file derrière lui, sur une longueur
      // qui suit la largeur de la grille (un téléphone, un grand écran).
      const tete = L - 24;
      const longueur = Math.max(200, Math.min(520, L * 0.62));
      const vitesse = longueur / (MEMOIRE / 1000);
      let d = "", dedans = false;
      for (const p of points) {
        if (p.m === null) { dedans = false; continue; }
        const x = (tete - (maintenant - p.t) * vitesse / 1000).toFixed(1);
        const y = (yPlan(p.m) - defil.scrollTop).toFixed(1);
        d += dedans ? `L${x} ${y}` : `M${x} ${y}h.01`; // un point seul se voit quand même
        dedans = true;
      }
      const yTete = enVoix ? yPlan(dernier.m) - defil.scrollTop : 0;
      if (enVoix) d += `L${tete} ${yTete.toFixed(1)}`;
      trace.setAttribute("d", d);
      bord.setAttribute("d", d);
      for (const g of degrades) {
        g.setAttribute("x1", (tete - longueur).toFixed(1));
        g.setAttribute("x2", (tete - longueur * 0.12).toFixed(1));
      }
      couche.classList.toggle("actif", enVoix);
      if (enVoix) {
        for (const el of cercles) { el.setAttribute("cx", tete); el.setAttribute("cy", yTete.toFixed(1)); }
        anneau.setAttribute("stroke-dashoffset", (TOUR * (1 - tenue)).toFixed(2));
        anneau.classList.toggle("pleine", tenue >= 1);
      }
      if (points.length) image = requestAnimationFrame(dessiner);
    }

    return {
      /**
       * Une mesure de la voix : m (hauteur MIDI exacte, null : silence),
       * cible (la note visée, dont la rangée s'allume), tenue (0 à 1 : le
       * quart de seconde qui reste à tenir avant que la note s'écrive).
       */
      point(m, { cible: h = null, tenue: t = 0 } = {}) {
        preparer();
        const dernier = points[points.length - 1];
        if (m !== null || (dernier && dernier.m !== null)) points.push({ t: performance.now(), m });
        if (points.length > 400) points.splice(0, points.length - 400); // un onglet en arrière-plan ne dessine plus : on ne laisse pas grossir
        tenue = t;
        allumer(h);
        if (!image && points.length) image = requestAnimationFrame(dessiner);
      },
      /** Un éclat sur le point et la rangée : la note vient de s'écrire. */
      eclat() {
        if (!couche) return;
        for (const el of [eclatPoint, rangee]) { el.classList.remove("va"); void el.getBoundingClientRect(); el.classList.add("va"); }
        // Le style « va » ne reste pas : un élément qui se remontre rejouerait l'animation.
        clearTimeout(finEclat);
        finEclat = setTimeout(() => { eclatPoint.classList.remove("va"); rangee.classList.remove("va"); }, 700);
      },
      /** Plus personne ne chante : la couche se vide. */
      fin() {
        points = []; suit = false; tenue = 0;
        allumer(null);
        cancelAnimationFrame(image);
        image = 0;
        if (!couche) return;
        couche.classList.remove("actif");
        trace.setAttribute("d", "");
        bord.setAttribute("d", "");
      },
    };
  }
  const voix = creerVoix();

  return {
    afficher, lecture, zoom, centrer, montrer, boite, voix,
    get px() { return px; },
  };
}
