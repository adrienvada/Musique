/**
 * L'ÉDITEUR D'IDÉE : LE JEU EN DIRECT, ET LA CAPTURE APRÈS COUP
 *
 * Le bouton rouge du transport (#idee-enregistrer, ou R au clavier) lance
 * une scène lisible à bout de bras, à la place de la grille ; le pupitre
 * reste en place avec son clavier, car on joue avec :
 *   - le DÉCOMPTE : un chiffre géant (4, 3, 2, 1, au vrai tempo) et les
 *     points des temps (#idee-decompte, #idee-temps) ;
 *   - le JEU : un cadre rouge autour de l'écran (#idee-cadre), un point qui
 *     clignote et le chrono, le numéro de la mesure en grand, les points
 *     des temps (le premier en rouge, le courant qui grossit) et un ruban
 *     qui montre les notes jouées au fil de l'eau, avec la tête de lecture ;
 *   - « Arrêter » (#idee-arreter), un gros bouton ; le bouton rouge du
 *     transport devient un carré stop.
 *
 * L'INSTANT D'UNE TOUCHE (audit du 04/10, M6). Chaque touche (clavier à
 * l'écran, de l'ordinateur ou MIDI) arrive avec l'instant de son geste
 * (event.timeStamp, l'horodatage du message MIDI) ; le transport le rapporte
 * à ce qu'on entendait à ce moment-là, et la latence de l'appareil s'en
 * retranche. Avant, l'instant était pris quand le code s'exécutait : des
 * doubles croches jouées au doigt tombaient une fois sur quatre un cran trop
 * tard. La latence se règle d'un geste (« tape avec le clic », dans la
 * feuille Tempo) : huit tapes, la médiane de leur écart au clic, retenue sur
 * l'appareil (`portee:latence-jeu`, en millisecondes).
 *
 * LA PÉDALE DE MAINTIEN (M9). Une note relâchée pendant que la pédale du
 * clavier MIDI est enfoncée dure jusqu'à ce que la pédale se relève, ou
 * jusqu'à ce que la même note soit rejouée.
 *
 * ARRONDIR APRÈS COUP. À l'arrêt, on garde les instants bruts et on ouvre
 * une feuille du bas (#idee-arrondi) : « Tel que joué » et « Arrondi » se
 * répondent sur deux rubans, et la grille (noire, croche, double croche)
 * se change en voyant ce que ça change. « Garder » écrit les notes arrondies
 * dans l'idée, en un seul pas d'« Annuler » ; fermer la feuille sans choisir
 * garde aussi, avec la grille affichée : ce qu'on a joué ne se perd jamais.
 * « Recommencer » jette la prise et relance le décompte. Les notes jouées
 * pendant le décompte ne sont pas gardées (la prise commence au premier
 * temps) : la feuille le dit, et combien (M11).
 *
 * LA CAPTURE APRÈS COUP (M13, comme « Capture MIDI » dans Live). Sans avoir
 * touché le bouton rouge, ce qu'on joue au clavier s'écrit note à note, de
 * la durée choisie ; Portée garde aussi en mémoire la dernière phrase jouée,
 * avec son rythme (seize mesures au plus ; un silence de quatre secondes,
 * ou de deux mesures, en commence une autre). « Capturer » (la pastille
 * #idee-capturer, ou C au clavier) la reprend dans la même feuille de
 * l'arrondi : « Garder » remplace les notes écrites pendant qu'on jouait
 * par celles-ci, avec leur rythme ; « Jeter » laisse l'idée comme elle est.
 * Elle se cale sur la musique si l'idée tournait, sinon sur le tempo de
 * l'idée, à partir de la première note (là où elle s'est écrite).
 *
 * Préférences de l'appareil : `portee:decompte` (0, 1 ou 2 mesures ; 1 par
 * défaut), réglée dans la feuille Tempo ou, d'un appui long, depuis le bouton
 * rouge ; `portee:arrondi` (la dernière grille choisie : 4, 2 ou 1 pas ;
 * croche par défaut), qui sert aussi à « Recaler » du menu en cercle (elle
 * vit donc aussi dans e.recalage) ; `portee:latence-jeu`.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, curseur, selection,
 *   recalage, mode, ouverte, et e.enregistrement, que ce module seul
 *   écrit : { phase: "decompte" | "jeu" | "arrondi", depuis, notes, … }),
 *   $, sq, transport, toast, modifier(f), rafraichir(), source() (ce que
 *   joue le transport), suivreLecture(pas), avantSon(), apresSon() (le micro
 *   se tait puis reprend), choisirMode(mode), grille (pour montrer les notes
 *   gardées).
 * Rend : { basculer(), arreter(), capturer(), ouvrir(), enfoncer(h, v,
 *   quand, { muet }) → true si la note est prise, relever(h, quand),
 *   pedale(bas, quand), suivre(pas), maj(), enCours }.
 *
 * Les calculs (où en est la mesure, les barres d'un ruban, l'arrondi, la
 * latence, la prise et la capture) sont exportés et ne touchent pas à la
 * page : tests/direct.test.mjs les essaie.
 */
import * as sq from "./sequence.js";
import { lirePref, ecrirePref } from "./preferences.js";
import { ico } from "./icones.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";
import { garderEveille, laisserDormir } from "./eveil.js";

const CLE_DECOMPTE = "portee:decompte";
const CLE_ARRONDI = "portee:arrondi";
const CLE_LATENCE = "portee:latence-jeu";
/** Les grilles de l'arrondi, en pas (1 pas = une double croche). */
export const GRILLES = [{ pas: 4, nom: "Noire" }, { pas: 2, nom: "Croche" }, { pas: 1, nom: "Double croche" }];
/** Les mesures de décompte. */
export const DECOMPTES = [{ n: 0, nom: "Aucun" }, { n: 1, nom: "1 mesure" }, { n: 2, nom: "2 mesures" }];
/** L'appui long qui ouvre le réglage du décompte, en millisecondes. */
const APPUI_LONG = 550;
/** Le réglage de la latence : au tempo 100, deux mesures de clics, et l'on tape huit fois. */
export const REGLAGE = { tempo: 100, clics: 12, tapes: 8 };
/** Une nouvelle phrase pour la capture après ce silence (ou deux mesures, si c'est plus long). */
export const SILENCE_PHRASE = 4000;
/** La capture garde au plus ces dernières mesures, et s'oublie après une minute sans jouer. */
export const MESURES_CAPTURE = 16;
const OUBLI_CAPTURE = 60000;

// --- Les calculs (sans page) ---------------------------------------------------

/** Le décompte retenu : 1 mesure tant qu'on n'a rien choisi. */
export function decompteRetenu(valeur) {
  const n = Number(valeur);
  return valeur !== null && valeur !== undefined && valeur !== "" && [0, 1, 2].includes(n) ? n : 1;
}

/** La grille retenue pour l'arrondi : la croche tant qu'on n'a rien choisi. */
export function grilleRetenue(valeur) {
  const n = Number(valeur);
  return GRILLES.some((g) => g.pas === n) ? n : 2;
}

/**
 * La latence retenue, en millisecondes : 0 tant qu'on ne l'a pas réglée, et
 * bornée (−150 à 400 ms) : un réglage raté ne doit pas déplacer tout le jeu.
 */
export function latenceRetenue(valeur) {
  const n = Number(valeur);
  if (valeur === null || valeur === undefined || valeur === "" || !Number.isFinite(n)) return 0;
  return Math.max(-150, Math.min(400, Math.round(n)));
}

/**
 * La latence d'après des tapes faites avec le clic. Pour chaque tape (l'instant
 * entendu, en secondes, sur l'horloge du son), l'écart au clic le plus
 * proche ; une tape à plus d'un tiers d'intervalle de tout clic est écartée
 * (un oubli, un doublé) ; la médiane de ce qui reste, s'il reste au moins
 * `minimum` tapes. Positive : la tape arrive après le clic (le toucher, le
 * son en Bluetooth, la main qui suit le clic plutôt que de l'anticiper).
 * @returns { latence (ms), gardees } ou null (pas assez de tapes)
 */
export function latenceDesTapes(tapes, clics, { minimum = 5 } = {}) {
  if (clics.length < 2) return null;
  const tries = [...clics].sort((a, b) => a - b);
  const intervalle = (tries[tries.length - 1] - tries[0]) / (tries.length - 1);
  const ecarts = [];
  for (const t of tapes) {
    let proche = tries[0];
    for (const c of tries) if (Math.abs(c - t) < Math.abs(proche - t)) proche = c;
    if (Math.abs(t - proche) <= intervalle / 3) ecarts.push(t - proche);
  }
  if (ecarts.length < minimum) return null;
  ecarts.sort((a, b) => a - b);
  const m = ecarts.length >> 1;
  const mediane = ecarts.length % 2 ? ecarts[m] : (ecarts[m - 1] + ecarts[m]) / 2;
  return { latence: Math.round(mediane * 1000), gardees: ecarts.length };
}

/**
 * Où en est la scène à l'instant `pas` (en pas, négatif pendant le décompte).
 * Pendant le décompte : le chiffre à dire (4, 3, 2, 1 à chaque mesure), le
 * temps courant et, s'il y a deux mesures, laquelle. Pendant le jeu : le
 * numéro de la mesure (celui de la règle de la grille) et le temps courant.
 * @param opts { depuis (début de la prise), decompte (mesures), mesure (pas), temps (pas) }
 */
export function etatScene(pas, { depuis, decompte, mesure, temps }) {
  const nTemps = Math.max(1, Math.round(mesure / temps));
  if (pas < depuis) {
    const debut = depuis - decompte * mesure;
    const i = Math.max(0, Math.floor((pas - debut) / temps + 1e-9));
    const dedans = i % nTemps;
    return { phase: "decompte", chiffre: nTemps - dedans, temps: dedans, nTemps, tour: Math.min(decompte, Math.floor(i / nTemps) + 1), tours: decompte };
  }
  const dansMesure = pas - Math.floor(pas / mesure) * mesure;
  return { phase: "jeu", mesure: Math.floor(pas / mesure) + 1, temps: Math.min(nTemps - 1, Math.floor(dansMesure / temps + 1e-9)), nTemps };
}

/** Le chrono de la prise : minutes:secondes depuis le début du jeu (pas 0 = `depuis`). */
export function chrono(pas, depuis, tempo) {
  const s = Math.max(0, Math.floor(((pas - depuis) * 15) / tempo + 1e-9));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * La page du ruban en direct : deux mesures à la fois (quatre si elles sont
 * courtes, une si elles sont longues), pour que les notes aient la même
 * largeur quelle que soit la mesure ; quand la tête arrive au bout, la page
 * suivante commence.
 */
export function pageRuban(pas, depuis, mesure) {
  const parPage = mesure <= 8 ? 4 : mesure <= 20 ? 2 : 1;
  const largeur = parPage * mesure;
  const page = Math.max(0, Math.floor((pas - depuis) / largeur));
  return { de: depuis + page * largeur, a: depuis + (page + 1) * largeur };
}

/**
 * Les hauteurs que montre un ruban : au moins `rangsMin` demi-tons, centrés
 * sur ce qui est joué, avec un demi-ton de marge. En direct, on part de
 * `base` (autour du do central) et la fenêtre ne fait que s'agrandir : les
 * notes déjà tracées ne sautent pas.
 */
export function fenetreHauteurs(hauteurs, { rangsMin = 12, base = null } = {}) {
  let bas = base ? base.bas : Infinity, haut = base ? base.haut : -Infinity;
  for (const h of hauteurs) { bas = Math.min(bas, h - 1); haut = Math.max(haut, h + 1); }
  if (!Number.isFinite(bas)) { bas = 59; haut = 72; }
  while (haut - bas + 1 < rangsMin) { bas -= 1; if (haut - bas + 1 < rangsMin) haut += 1; }
  return { bas, haut };
}

/**
 * Les barres d'un ruban, en pour-cent de sa largeur et de sa hauteur.
 * @param notes   [{ d, f, h }] (début et fin en pas, hauteur MIDI)
 * @param fenetre { de, a (pas), bas, haut (hauteurs) }
 */
export function barresRuban(notes, { de, a, bas, haut }) {
  const largeur = a - de, rangs = haut - bas + 1;
  const barres = [];
  for (const n of notes) {
    // Une touche à peine effleurée dure presque zéro pas : elle se voit quand même (largeur minimale en CSS).
    const f = Math.max(n.f, n.d);
    if (n.d >= a || (f <= de && n.d < de) || n.h < bas || n.h > haut) continue;
    const x0 = Math.max(n.d, de), x1 = Math.min(f, a);
    barres.push({
      x: ((x0 - de) / largeur) * 100,
      w: ((x1 - x0) / largeur) * 100,
      y: ((haut - n.h + 0.5) / rangs) * 100,
      hauteur: 100 / rangs,
      debutCoupe: n.d < de, finCoupee: f > a,
    });
  }
  return barres;
}

const pct = (x) => Math.round(x * 100) / 100;

/** Le HTML des barres (la couleur et la forme sont dans idee-direct.css). */
export function htmlBarres(barres, classe = "") {
  return barres.map((b) => `<i class="dir-note${classe ? " " + classe : ""}${b.debutCoupe ? " coupee-avant" : ""}${b.finCoupee ? " coupee-apres" : ""}" style="left:${pct(b.x)}%;width:${pct(b.w)}%;top:${pct(b.y)}%;--rang:${pct(b.hauteur)}%"></i>`).join("");
}

/**
 * Les traits d'un ruban : la barre de mesure, les temps et, si on les veut,
 * les pas de la grille d'arrondi ; avec le numéro de chaque mesure.
 */
export function htmlLignes({ de, a, mesure, temps, grille = 0, numeros = false }) {
  const largeur = a - de;
  const x = (p) => pct(((p - de) / largeur) * 100);
  let html = "";
  if (grille) for (let p = Math.ceil(de / grille) * grille; p < a; p += grille) html += `<i class="dir-pas" style="left:${x(p)}%"></i>`;
  for (let p = Math.ceil(de / temps) * temps; p < a; p += temps) {
    const barre = p % mesure === 0;
    html += `<i class="dir-temps-ligne${barre ? " barre" : ""}" style="left:${x(p)}%"></i>`;
    if (numeros && barre) html += `<b class="dir-numero" style="left:${x(p)}%">${p / mesure + 1}</b>`;
  }
  return html;
}

/**
 * Les notes jouées, arrondies : instants bruts (en pas depuis le début de la
 * partition, comme transport.position()) → notes posées sur la grille.
 * C'est sq.quantifier, qui connaît le « jeu lié » (une note relâchée un pas
 * de grille avant la suivante tient jusqu'à elle ; la dernière, jusqu'à la
 * fin de son temps : `temps`, celui de la mesure, la noire pointée en 6/8).
 */
export function arrondir(brutes, grille, depuis, temps = 4) {
  return sq.quantifier(brutes.map((n) => ({ ...n, debut: n.debut - depuis, fin: n.fin - depuis })), { grille, origine: depuis, temps });
}

/**
 * Combien de notes jouées pendant le décompte l'arrondi ne garde pas (M11) :
 * la prise commence au premier temps, et une levée jouée avant lui disparaît.
 * Le comportement ne change pas (garder la levée, ou non, reste à décider) :
 * on le dit, au lieu de la faire disparaître sans un mot.
 */
export function nonGardees(brutes, grille, depuis) {
  // La règle de sq.quantifier : une note attaquée avant le premier temps (arrondie) et finie avant lui
  // ne s'écrit pas. Compter ce qu'il rend ne suffirait pas : deux attaques d'une même note, dans le même
  // pas, n'en font qu'une, sans être perdues.
  return brutes.filter((n) => {
    const d = Math.round((n.debut - depuis) / grille) * grille;
    const f = Math.round((n.fin - depuis) / grille) * grille;
    return d < 0 && f <= 0;
  }).length;
}

// --- La prise : ce qu'on joue, touche par touche (sans page) -----------------------

/**
 * Ce qu'on joue pendant une prise ou une capture : les touches enfoncées,
 * celles que la pédale tient, les notes finies. Les instants sont des
 * positions (en pas pour une prise, en millisecondes pour une capture).
 */
export const nouvellePrise = () => ({ notes: [], ouvertes: new Map(), tenues: new Map(), pedale: false });

const finir = (p, h, o, t) => p.notes.push({ h, debut: o.debut, fin: Math.max(t, o.debut), v: o.v });

/** Une touche s'enfonce à `t`. La même note que tenait la pédale s'arrête là (on la rejoue). */
export function noterDebut(p, h, v, t) {
  if (p.tenues.has(h)) { finir(p, h, p.tenues.get(h), t); p.tenues.delete(h); }
  if (p.ouvertes.has(h)) finir(p, h, p.ouvertes.get(h), t);
  p.ouvertes.set(h, { debut: t, v });
}

/** Une touche se relève à `t` : la note finit là, ou la pédale la tient. */
export function noterFin(p, h, t) {
  const o = p.ouvertes.get(h);
  if (!o) return;
  p.ouvertes.delete(h);
  if (p.pedale) p.tenues.set(h, o);
  else finir(p, h, o, t);
}

/** La pédale de maintien s'enfonce ou se relève à `t` ; relevée, ce qu'elle tenait finit là. */
export function noterPedale(p, bas, t) {
  p.pedale = !!bas;
  if (bas) return;
  for (const [h, o] of p.tenues) finir(p, h, o, t);
  p.tenues.clear();
}

/** La prise s'arrête à `t` : ce qui sonnait encore (touches, pédale) finit là. */
export function fermerPrise(p, t) {
  for (const [h, o] of [...p.ouvertes, ...p.tenues]) finir(p, h, o, t);
  p.ouvertes.clear();
  p.tenues.clear();
}

/** Ce qui sonne encore dans une prise, pour le ruban : [{ h, debut }]. */
export const enCoursDe = (p) => [...p.ouvertes, ...p.tenues].map(([h, o]) => ({ h, debut: o.debut }));

/**
 * Les notes d'une capture (instants en millisecondes) → des notes « telles
 * que jouées », en pas, prêtes pour l'arrondi : la première tombe sur
 * `depart` (là où elle s'est écrite, ou là où en était la musique qui
 * tournait), les autres suivent au tempo de l'idée. Jouée par-dessus une
 * boucle (`boucle` : [de, a[), chaque note retombe dans la boucle, là où
 * elle a été jouée.
 */
export function brutesDeCapture(notes, { depart, tempo, boucle = null }) {
  if (!notes.length) return [];
  const t0 = Math.min(...notes.map((n) => n.debut));
  const msParPas = 60000 / (tempo * 4);
  return notes.map((n) => {
    let debut = depart + (n.debut - t0) / msParPas;
    if (boucle) { const l = boucle[1] - boucle[0]; debut = boucle[0] + ((((debut - boucle[0]) % l) + l) % l); }
    return { h: n.h, v: n.v, debut, fin: debut + (n.fin - n.debut) / msParPas };
  });
}

const pluriel = (n, mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;

// --- Le module -------------------------------------------------------------------

export function creerDirect(ctx) {
  const { e, $, transport, toast } = ctx;
  const scene = $("idee-scene");
  const feuille = $("idee-arrondi");

  // La grille retenue sert aussi à « Recaler » (menu en cercle) : le cœur la lit dans e.recalage.
  e.recalage = grilleRetenue(lirePref(CLE_ARRONDI));
  const decompteRetenu_ = () => decompteRetenu(lirePref(CLE_DECOMPTE));
  const latence = () => latenceRetenue(lirePref(CLE_LATENCE));
  /** La position (en pas) d'un geste : à son instant, rapporté à ce qu'on entendait, moins la latence de l'appareil. */
  const positionDuGeste = (quand) => transport.position(quand ?? null, { latence: latence() / 1000 });

  // Le ruban en direct : les traits dessous, les notes, la tête de lecture dessus.
  const ruban = {
    lignes: $("idee-ruban-lignes"), notes: $("idee-ruban-notes"), tete: $("idee-ruban-tete"),
    fenetre: null, vu: null, signature: "",
  };

  // --- Le bouton rouge et la scène ---------------------------------------------

  let etatBouton = "";
  function majBouton() {
    const b = $("idee-enregistrer");
    // La prise arrêtée (la feuille de l'arrondi est ouverte) ne tourne plus : le bouton redevient rouge.
    const jeu = !!e.enregistrement && e.enregistrement.phase !== "arrondi";
    const n = decompteRetenu_();
    const cle = `${jeu}|${n}`;
    if (cle === etatBouton) return; // le cœur nous appelle à chaque dessin : on ne refait pas l'icône pour rien
    etatBouton = cle;
    b.setAttribute("aria-pressed", String(jeu));
    b.innerHTML = ico(jeu ? "stop" : "rec", "s");
    const decompte = n ? `décompte : ${pluriel(n, "mesure")}` : "sans décompte";
    b.setAttribute("aria-label", jeu ? "Arrêter le jeu en direct" : `Jouer en direct (${decompte})`);
    b.title = jeu ? "Arrêter (R)" : `Jouer en direct (R) · ${decompte} · appui long pour le régler`;
  }

  /** Montre ou cache la scène et le cadre rouge, selon la phase de la prise. */
  function montrerScene() {
    const r = e.enregistrement;
    const phase = r && r.phase !== "arrondi" ? r.phase : null;
    scene.hidden = !phase;
    $("idee-cadre").hidden = phase !== "jeu";
    // L'écran reste allumé pendant le décompte et le jeu (eveil.js, M8).
    if (phase) garderEveille("direct"); else laisserDormir("direct");
    if (!phase) return;
    scene.dataset.phase = phase;
    const jeu = phase === "jeu";
    $("idee-decompte").hidden = jeu;
    $("idee-mesure-direct").hidden = !jeu;
    $("idee-scene-legende").hidden = !jeu;
    $("idee-scene-point").hidden = !jeu;
    $("idee-scene-titre").textContent = jeu ? "Enregistrement" : "Décompte";
    $("idee-chrono").hidden = !jeu;
    $("idee-arreter").innerHTML = jeu ? `${ico("stop", "l")}<span>Arrêter</span>` : `${ico("fermer")}<span>Annuler</span>`;
    $("idee-arreter").title = jeu ? "Arrêter (R)" : "Annuler (R)";
    $("idee-mode").textContent = jeu ? "Jeu en direct : enregistrement en cours" : "Jeu en direct : décompte, joue ensuite";
    ruban.vu = null; // le ruban se redessine à la première image du jeu
  }

  // --- Où en est la prise ---------------------------------------------------------

  let derniere = { temps: -1, mesure: -1, chiffre: -1, chrono: "", nTemps: 0 };

  function majTemps(nTemps, courant) {
    const zone = $("idee-temps");
    if (zone.children.length !== nTemps) zone.innerHTML = Array.from({ length: nTemps }, (_, i) => `<i${i === 0 ? ' class="premier"' : ""}></i>`).join("");
    [...zone.children].forEach((p, i) => { p.classList.toggle("fait", i < courant); p.classList.toggle("maintenant", i === courant); });
  }

  /** À chaque image de la lecture : le chiffre ou la mesure, les temps, le ruban. */
  function suivre(pas) {
    const r = e.enregistrement;
    if (!r || r.phase === "arrondi" || pas === null) return;
    const mesure = sq.pasParMesure(e.seq), temps = sq.pasParTemps(e.seq);
    const s = etatScene(pas, { depuis: r.depuis, decompte: r.decompte, mesure, temps });
    if (s.phase !== r.phase) { r.phase = s.phase; montrerScene(); derniere.temps = -1; }
    if (s.temps !== derniere.temps || s.nTemps !== derniere.nTemps) { majTemps(s.nTemps, s.temps); derniere.temps = s.temps; derniere.nTemps = s.nTemps; }
    if (s.phase === "decompte") {
      if (s.chiffre !== derniere.chiffre) {
        derniere.chiffre = s.chiffre;
        $("idee-decompte").textContent = s.chiffre;
        $("idee-scene-compte").textContent = s.tours > 1 ? `mesure ${s.tour} sur ${s.tours}` : "";
      }
      majRuban(pas, r, mesure, temps);
      return;
    }
    if (s.mesure !== derniere.mesure) { derniere.mesure = s.mesure; $("idee-mesure-direct").textContent = s.mesure; }
    const c = chrono(pas, r.depuis, e.seq.tempo);
    if (c !== derniere.chrono) { derniere.chrono = c; $("idee-chrono").textContent = c; }
    majRuban(pas, r, mesure, temps);
  }

  function majRuban(pas, r, mesure, temps) {
    const page = pageRuban(pas, r.depuis, mesure);
    const enCours = enCoursDe(r.prise).map((o) => ({ d: o.debut, f: Math.max(pas, o.debut), h: o.h }));
    const jouees = r.prise.notes.map((n) => ({ d: n.debut, f: n.fin, h: n.h })).concat(enCours);
    // La fenêtre des hauteurs ne fait que s'agrandir : les notes déjà tracées ne sautent pas.
    const fen = fenetreHauteurs(jouees.map((n) => n.h), { rangsMin: 20, base: ruban.fenetre ? { bas: ruban.fenetre.bas, haut: ruban.fenetre.haut } : { bas: 55, haut: 77 } });
    const cle = `${page.de}|${mesure}|${temps}|${fen.bas}|${fen.haut}`;
    if (cle !== ruban.vu) {
      ruban.vu = cle;
      ruban.fenetre = { ...page, ...fen };
      ruban.lignes.innerHTML = htmlLignes({ de: page.de, a: page.a, mesure, temps, numeros: true });
      ruban.signature = "";
    }
    // Les notes ne se redessinent que quand elles changent (une note tenue grandit à chaque image).
    const signature = `${r.prise.notes.length}|${enCours.length ? Math.round(pas * 8) : "-"}`;
    if (signature !== ruban.signature) {
      ruban.signature = signature;
      ruban.notes.innerHTML = htmlBarres(barresRuban(jouees, ruban.fenetre));
    }
    const hors = pas < r.depuis;
    ruban.tete.hidden = hors;
    if (!hors) ruban.tete.style.left = `${pct(((pas - page.de) / (page.a - page.de)) * 100)}%`;
  }

  // --- Lancer et arrêter ---------------------------------------------------------------

  async function demarrer() {
    if (e.enregistrement) return;
    if (reglage) finirReglage(false);
    transport.arreter();
    oublierCapture(); // la prise prend le relais de la capture
    // On joue au clavier : celui de l'écran doit être là (Chanter et Accords n'ont pas de touches à jouer).
    if (e.mode === "chanter" || e.mode === "accords") ctx.choisirMode("clavier");
    ctx.avantSon();
    const mesure = sq.pasParMesure(e.seq);
    const depuis = Math.floor(Math.min(e.curseur, sq.finSequence(e.seq)) / mesure) * mesure;
    const decompte = decompteRetenu_();
    e.selection.clear();
    const prise = { phase: decompte ? "decompte" : "jeu", depuis, decompte, prise: nouvellePrise(), grille: e.recalage, total: 0, perdues: 0 };
    e.enregistrement = prise;
    derniere = { temps: -1, mesure: -1, chiffre: -1, chrono: "", nTemps: 0 };
    ruban.fenetre = null;
    montrerScene();
    majBouton();
    suivre(depuis - decompte * mesure);
    ctx.rafraichir();
    try {
      await transport.jouer(ctx.source, {
        depuis, decompte, metronome: true, sansFin: true,
        surPosition: ctx.suivreLecture,
        surFin: () => { if (e.enregistrement === prise && prise.phase !== "arrondi") arreter(); },
      });
      // Arrêté pendant que le piano se chargeait : le transport ne doit pas partir seul.
      if (e.enregistrement !== prise || prise.phase === "arrondi") transport.arreter();
    } catch (err) {
      if (e.enregistrement === prise) finir();
      toast(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  /** Remet l'écran comme avant la prise : plus de scène, plus de cadre, le micro reprend. */
  function finir() {
    e.enregistrement = null;
    montrerScene();
    majBouton();
    $("idee-mode").textContent = "";
    transport.arreter();
    ctx.suivreLecture(null);
    ctx.apresSon();
    ctx.rafraichir();
  }

  /**
   * Arrête. Pendant le décompte, rien n'a été joué : on laisse tout. Pendant
   * le jeu, on ouvre la feuille de l'arrondi ; si l'éditeur se ferme (ou si
   * la feuille est ouverte), on garde tout de suite, avec la grille affichée.
   */
  function arreter() {
    const r = e.enregistrement;
    if (!r) return;
    if (r.phase === "arrondi") { garder(); return; }
    if (r.phase === "decompte") { finir(); return; }
    fermerPrise(r.prise, transport.position());
    r.notes = r.prise.notes;
    r.perdues = nonGardees(r.notes, r.grille, r.depuis);
    const jouees = arrondir(r.notes, r.grille, r.depuis, sq.pasParTemps(e.seq));
    if (!jouees.length) {
      finir();
      // M11 : tout a été joué pendant le décompte ; on le dit, plutôt que « rien n'a été joué ».
      if (e.ouverte) toast(r.perdues ? `${pluriel(r.perdues, "note")} jouée${r.perdues > 1 ? "s" : ""} pendant le décompte : la prise commence au premier temps, l'idée n'a pas changé.` : "Rien n'a été joué : l'idée n'a pas changé.", 6000);
      return;
    }
    r.total = jouees.length;
    r.phase = "arrondi";
    $("idee-mode").textContent = "";
    montrerScene();
    transport.arreter();
    ctx.suivreLecture(null);
    ctx.apresSon();
    majBouton();
    // L'éditeur se ferme : pas de feuille, on garde ce qui a été joué.
    if (!e.ouverte) { garder(); return; }
    majArrondi();
    feuille.returnValue = "";
    ouvrirFeuille(feuille);
  }

  /**
   * Écrit les notes arrondies dans l'idée, un seul pas d'« Annuler ». Une
   * capture remplace les notes écrites pendant qu'on jouait (celles qu'elle a
   * vues s'écrire, et qui sont encore là).
   */
  function garder() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    e.enregistrement = null; // avant de fermer la feuille : sa fermeture ne refait rien
    fermerFeuille(feuille);
    majBouton();
    const notes = arrondir(r.notes, r.grille, r.depuis, sq.pasParTemps(e.seq));
    if (!notes.length) { ctx.rafraichir(); return; }
    ctx.modifier(() => {
      if (r.ecrites && r.ecrites.length) {
        const piste = e.seq.pistes[e.piste];
        const parti = piste ? piste.notes.filter((n) => r.ecrites.some((x) => x.id === n.id && x.h === n.h)).map((n) => n.id) : [];
        // Ce qui suivait se rapproche, comme avant leur écriture ; la capture se pose ensuite, telle que jouée.
        if (parti.length) sq.effacer(e.seq, e.piste, parti);
      }
      const ids = notes.map((n) => sq.poser(e.seq, e.piste, n));
      e.selection = new Set(ids);
      e.curseur = Math.max(...notes.map((n) => n.d + n.l));
    });
    // La grille a suivi la tête jusqu'au bout de la prise : on revient montrer ce qui vient d'être écrit.
    const premiere = notes[0];
    requestAnimationFrame(() => { if (e.ouverte) ctx.grille.montrer(premiere); });
    // Court : le message passager est étroit, et « Annuler » est juste en dessous, dans le pupitre.
    if (e.ouverte) toast(`${pluriel(notes.length, "note")} ${r.capture ? "capturée" : "gardée"}${notes.length > 1 ? "s" : ""}.`);
  }

  /** Jette la prise et relance le décompte ; une capture est seulement jetée (l'idée garde ce qui s'est écrit). */
  function recommencer() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    e.enregistrement = null;
    fermerFeuille(feuille);
    if (r.capture) { majBouton(); ctx.rafraichir(); return; }
    demarrer();
  }

  // --- La feuille de l'arrondi -------------------------------------------------------

  /** Le titre, les deux rubans et la grille choisie : tout se redessine quand la grille change. */
  function majArrondi() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    const mesure = sq.pasParMesure(e.seq), temps = sq.pasParTemps(e.seq);
    const brutes = r.notes.map((n) => ({ d: n.debut, f: n.fin, h: n.h }));
    const arrondies = arrondir(r.notes, r.grille, r.depuis, sq.pasParTemps(e.seq)).map((n) => ({ d: n.d, f: n.d + n.l, h: n.h }));
    $("idee-arrondi-titre").textContent = `${pluriel(r.total, "note")} ${r.capture ? "capturée" : "jouée"}${r.total > 1 ? "s" : ""}`;
    $("idee-arrondi-aide").textContent = r.capture
      ? (r.ecrites && r.ecrites.length ? "Garder remplace les notes écrites pendant que tu jouais par celles-ci, avec leur rythme." : "Garder les écrit dans l'idée, avec leur rythme.") + " Choisis comment l'arrondir."
      : "Choisis comment arrondir le rythme. Fermer la feuille garde ce que tu vois.";
    // M11 : une levée jouée pendant le décompte n'est pas gardée ; on le dit.
    const perdues = $("idee-arrondi-decompte");
    perdues.hidden = !r.perdues;
    perdues.textContent = r.perdues ? `${pluriel(r.perdues, "note")} jouée${r.perdues > 1 ? "s" : ""} pendant le décompte : pas gardée${r.perdues > 1 ? "s" : ""}, la prise commence au premier temps.` : "";
    $("idee-recommencer").innerHTML = r.capture ? `${ico("fermer", "s")}Jeter` : `${ico("annuler", "s")}Recommencer`;
    $("idee-recommencer").title = r.capture ? "Ne pas capturer : l'idée reste comme elle est" : "Jeter la prise et rejouer, avec le décompte";
    const fin = Math.max(...brutes.map((n) => n.f), ...arrondies.map((n) => n.f));
    const mesures = Math.max(1, Math.ceil((fin - r.depuis) / mesure - 1e-9));
    const de = r.depuis, a = r.depuis + mesures * mesure;
    const fen = { de, a, ...fenetreHauteurs([...brutes, ...arrondies].map((n) => n.h), { rangsMin: 10 }) };
    $("idee-plan-arrondi").style.setProperty("--pas", String(a - de));
    const lignes = (grille) => htmlLignes({ de, a, mesure, temps, grille, numeros: true });
    const brut = $("idee-ruban-brut"), rond = $("idee-ruban-arrondi");
    brut.innerHTML = lignes(0) + htmlBarres(barresRuban(brutes, fen));
    // L'arrondi montre ce qu'il a changé : la prise brute, en creux, derrière les notes posées sur la grille.
    rond.innerHTML = lignes(r.grille) + htmlBarres(barresRuban(brutes, fen), "fantome") + htmlBarres(barresRuban(arrondies, fen));
    brut.setAttribute("aria-label", `Tel que joué : ${pluriel(r.total, "note")}`);
    const g = GRILLES.find((x) => x.pas === r.grille);
    rond.setAttribute("aria-label", `Arrondi à la ${g.nom.toLowerCase()} : ${pluriel(arrondies.length, "note")}`);
    $("idee-grilles").querySelectorAll("[data-grille]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.grille) === r.grille)));
  }

  /** La dernière grille choisie est retenue : elle sert aussi à « Recaler ». */
  function choisirGrille(pas) {
    pas = grilleRetenue(pas);
    e.recalage = pas;
    ecrirePref(CLE_ARRONDI, String(pas));
    const r = e.enregistrement;
    if (r && r.phase === "arrondi") { r.grille = pas; if (!r.capture) r.perdues = nonGardees(r.notes, pas, r.depuis); majArrondi(); }
    majReglages();
  }

  function choisirDecompte(n) {
    ecrirePref(CLE_DECOMPTE, String(decompteRetenu(n)));
    majReglages();
    majBouton();
  }

  /** La feuille Tempo : le décompte, la grille et la latence retenus. */
  function majReglages() {
    const n = decompteRetenu_();
    $("idee-decompte-mesures").querySelectorAll("[data-decompte]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.decompte) === n)));
    $("idee-recalage-reglage").querySelectorAll("[data-grille]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.grille) === e.recalage)));
    majLatence();
  }

  // --- La latence : « tape avec le clic » (M6) ------------------------------------------

  let reglage = null; // { tapes: [instants entendus, s], clics: [instants des clics], minuterie }
  let dernierMot = "";

  function majLatence() {
    const pad = $("idee-latence-pad");
    pad.hidden = !reglage;
    $("idee-latence").setAttribute("aria-pressed", String(!!reglage));
    $("idee-latence-texte").textContent = reglage ? "Arrêter le réglage" : lirePref(CLE_LATENCE) !== null ? "Régler à nouveau" : "Régler en tapant avec le clic";
    if (reglage) {
      pad.textContent = reglage.tapes.length ? `Tape avec le clic · ${reglage.tapes.length} sur ${REGLAGE.tapes}` : "Écoute le clic, puis tape ici avec lui";
      return;
    }
    const ms = latence();
    $("idee-latence-etat").textContent = dernierMot || (lirePref(CLE_LATENCE) === null ? "Pas réglée : les notes se placent comme on les entend." : `Réglée : ${ms} ms.`);
  }

  /** Huit tapes avec le clic du métronome ; la médiane de leur écart au clic devient la latence de l'appareil. */
  async function reglerLatence() {
    if (reglage) { finirReglage(false); return; }
    if (e.enregistrement) return;
    transport.arreter();
    ctx.avantSon();
    dernierMot = "";
    const moi = { tapes: [], clics: [] };
    reglage = moi;
    majLatence();
    // Rien que le métronome : une source sans note, au tempo du réglage.
    const source = () => ({ tempo: REGLAGE.tempo, mesure: 16, temps: 4, fin: 0, notesA: () => [] });
    try {
      await transport.jouer(source, { metronome: true, sansFin: true, surFin: () => { if (reglage === moi) finirReglage(true); } });
    } catch (err) {
      if (reglage === moi) { reglage = null; majLatence(); ctx.apresSon(); }
      toast(err.message || "Le piano n'a pas pu se charger.");
      return;
    }
    if (reglage !== moi) return;
    moi.minuterie = setTimeout(() => { if (reglage === moi) finirReglage(true); }, (REGLAGE.clics * 60000) / REGLAGE.tempo + 600);
  }

  /** Une tape (pad, clavier MIDI) pendant le réglage : l'instant qu'on entendait alors. */
  function taper(quand) {
    if (!reglage) return false;
    reglage.tapes.push(transport.instantEntendu(quand ?? null));
    if (reglage.tapes.length >= REGLAGE.tapes) finirReglage(true);
    else majLatence();
    return true;
  }

  function finirReglage(conclure) {
    const r = reglage;
    if (!r) return;
    reglage = null;
    clearTimeout(r.minuterie);
    // Les instants des clics, avant que l'arrêt les oublie.
    const clics = transport.instantsClics ? [...transport.instantsClics] : [];
    transport.arreter();
    ctx.apresSon();
    if (conclure) {
      const res = latenceDesTapes(r.tapes, clics);
      if (res) {
        ecrirePref(CLE_LATENCE, String(latenceRetenue(res.latence)));
        dernierMot = `Réglée : ${latence()} ms, d'après ${res.gardees} tapes.`;
      } else dernierMot = "Pas assez de tapes avec le clic : recommence, en tapant en même temps que lui.";
    }
    majLatence();
  }

  // --- La capture après coup (M13) -------------------------------------------------------

  let capture = null; // { prise (instants en ms), ecrites: [{ id, h }], depart (pas) ou pos0 (position de la musique), dernier, oubli }

  function oublierCapture() {
    if (capture) clearTimeout(capture.oubli);
    capture = null;
    majCapture();
  }

  /** La pastille « Capturer » : dès deux notes jouées, tant qu'aucune prise ne tourne. */
  function majCapture() {
    const b = $("idee-capturer");
    const n = capture ? capture.prise.notes.length + capture.prise.ouvertes.size + capture.prise.tenues.size : 0;
    const voir = n >= 2 && !e.enregistrement && e.ouverte;
    b.hidden = !voir;
    if (voir) b.setAttribute("aria-label", `Capturer les ${n} dernières notes jouées, avec leur rythme (C)`);
  }

  /** Une touche jouée hors d'une prise : la capture la garde, avec son instant. */
  function capterDebut(h, v, quand) {
    const t = quand ?? performance.now();
    const mesureMs = (sq.pasParMesure(e.seq) * 60000) / (e.seq.tempo * 4);
    const enCours = capture && (capture.prise.ouvertes.size || capture.prise.tenues.size);
    // Après un silence, une nouvelle phrase commence.
    if (capture && !enCours && t - capture.dernier > Math.max(SILENCE_PHRASE, 2 * mesureMs)) oublierCapture();
    if (!capture) {
      // Elle se cale sur la musique si l'idée tourne ; sinon, la première note tombe là où elle s'écrit (le curseur).
      const boucle = transport.actif && transport.options && transport.options.boucle;
      capture = { prise: nouvellePrise(), ecrites: [], depart: e.curseur, pos0: transport.actif ? positionDuGeste(t) : null, boucle: boucle ? [...boucle] : null, dernier: t, oubli: null };
    }
    const p = capture.prise;
    // Pas plus de seize mesures : le début s'oublie.
    const limite = t - MESURES_CAPTURE * mesureMs;
    if (p.notes.length && p.notes[0].debut < limite) {
      p.notes = p.notes.filter((n) => n.debut >= limite);
      if (capture.pos0 !== null) capture.pos0 = null; // la musique d'il y a seize mesures n'est plus dans les repères du transport
      if (p.notes.length) capture.depart = e.curseur;
    }
    noterDebut(p, h, v, t);
    // La note qu'écrit ce toucher (l'écriture note à note), pour la remplacer si l'on garde la capture.
    capture.ecrites.push({ id: e.seq.suivant, h });
    capture.dernier = t;
    clearTimeout(capture.oubli);
    capture.oubli = setTimeout(oublierCapture, OUBLI_CAPTURE);
    majCapture();
  }

  /** Reprend la dernière phrase jouée dans la feuille de l'arrondi. */
  function capturer() {
    if (!capture || e.enregistrement || !e.ouverte) return;
    const p = capture.prise;
    fermerPrise(p, performance.now());
    if (p.notes.length < 1) { oublierCapture(); return; }
    const tempo = e.seq.tempo, mesure = sq.pasParMesure(e.seq);
    const enMusique = capture.pos0 !== null;
    const depart = enMusique ? capture.pos0 : capture.depart;
    const boucle = enMusique ? capture.boucle : null;
    const notes = brutesDeCapture(p.notes, { depart, tempo, boucle });
    // Calée sur la musique : l'arrondi part de la mesure (le début de la boucle) ; sinon, de la première note.
    const depuis = boucle ? boucle[0] : enMusique ? Math.max(0, Math.floor(depart / mesure) * mesure) : depart;
    const ecrites = capture.ecrites;
    oublierCapture();
    transport.arreter();
    const r = { phase: "arrondi", capture: true, depuis, decompte: 0, prise: nouvellePrise(), notes, grille: e.recalage, total: 0, perdues: 0, ecrites };
    r.total = arrondir(notes, r.grille, depuis, sq.pasParTemps(e.seq)).length;
    if (!r.total) return;
    e.enregistrement = r;
    majBouton();
    majArrondi();
    feuille.returnValue = "";
    ouvrirFeuille(feuille);
  }

  // --- Les gestes ---------------------------------------------------------------------

  const bouton = $("idee-enregistrer");
  // Appui long sur le bouton rouge : le réglage du décompte (la feuille Tempo, descendue jusqu'à lui).
  let minuterie = null, appuiLong = false;
  bouton.addEventListener("pointerdown", () => {
    appuiLong = false;
    clearTimeout(minuterie);
    if (e.enregistrement) return;
    minuterie = setTimeout(() => {
      appuiLong = true;
      ouvrirFeuille($("idee-reglages"));
      requestAnimationFrame(() => $("idee-decompte-bloc").scrollIntoView({ block: "center" }));
    }, APPUI_LONG);
  });
  for (const nom of ["pointerup", "pointerleave", "pointercancel"]) bouton.addEventListener(nom, () => clearTimeout(minuterie));
  bouton.addEventListener("contextmenu", (ev) => ev.preventDefault());
  bouton.addEventListener("click", () => {
    if (appuiLong) { appuiLong = false; return; }
    if (e.enregistrement) arreter(); else demarrer();
  });
  $("idee-arreter").addEventListener("click", arreter);
  $("idee-capturer").addEventListener("click", capturer);

  $("idee-decompte-mesures").addEventListener("click", (ev) => { const b = ev.target.closest("[data-decompte]"); if (b) choisirDecompte(b.dataset.decompte); });
  $("idee-recalage-reglage").addEventListener("click", (ev) => { const b = ev.target.closest("[data-grille]"); if (b) choisirGrille(b.dataset.grille); });
  $("idee-grilles").addEventListener("click", (ev) => { const b = ev.target.closest("[data-grille]"); if (b) choisirGrille(b.dataset.grille); });
  $("idee-recommencer").addEventListener("click", recommencer);
  $("idee-garder").addEventListener("click", garder);
  // Fermer la feuille (le voile, Échap) sans choisir : on garde, avec la grille affichée.
  brancherFeuille(feuille, { surFermer: () => garder() });
  // Le réglage de la latence : le bouton, et le pavé où l'on tape (au doigt, ou Espace / Entrée).
  $("idee-latence").addEventListener("click", reglerLatence);
  const pad = $("idee-latence-pad");
  pad.addEventListener("pointerdown", (ev) => { ev.preventDefault(); taper(ev.timeStamp); });
  pad.addEventListener("keydown", (ev) => { if ((ev.key === " " || ev.key === "Enter") && !ev.repeat) { ev.preventDefault(); taper(ev.timeStamp); } });
  pad.addEventListener("click", (ev) => ev.preventDefault());
  // Fermer la feuille Tempo arrête le réglage en cours.
  $("idee-reglages").addEventListener("close", () => { if (reglage) finirReglage(false); });

  majBouton();
  majReglages();

  return {
    basculer: () => (e.enregistrement ? arreter() : demarrer()),
    arreter,
    capturer,
    /** Une idée s'ouvre : la capture d'avant ne la concerne pas. */
    ouvrir() { oublierCapture(); if (reglage) finirReglage(false); },
    /**
     * Une touche s'enfonce, à l'instant `quand` (horloge de la page). Pendant
     * une prise, on note sa position (la feuille ouverte avale la note) ;
     * pendant le réglage de la latence, c'est une tape. Sinon, la capture la
     * garde (sauf une note chantée, ou une note choisie qui change de hauteur).
     */
    enfoncer(h, v, quand = null, { muet = false } = {}) {
      if (reglage && !muet) return taper(quand);
      const r = e.enregistrement;
      if (!r) {
        if (!muet && !e.selection.size) capterDebut(h, v, quand);
        return false;
      }
      if (r.phase !== "arrondi") noterDebut(r.prise, h, v, positionDuGeste(quand));
      return true;
    },
    relever(h, quand = null) {
      const r = e.enregistrement;
      if (r && r.phase !== "arrondi") { noterFin(r.prise, h, positionDuGeste(quand)); return; }
      if (!r && capture) { noterFin(capture.prise, h, quand ?? performance.now()); capture.dernier = quand ?? performance.now(); }
    },
    /** La pédale de maintien (M9) : les notes relâchées pendant qu'elle est enfoncée durent jusqu'à ce qu'elle se relève. */
    pedale(bas, quand = null) {
      const r = e.enregistrement;
      if (r && r.phase !== "arrondi") { noterPedale(r.prise, bas, positionDuGeste(quand)); return; }
      if (!r && capture) noterPedale(capture.prise, bas, quand ?? performance.now());
    },
    suivre,
    maj() { majReglages(); majBouton(); majCapture(); },
    get enCours() { return !!e.enregistrement; },
  };
}
