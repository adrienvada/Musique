/**
 * L'ÉDITEUR D'IDÉE : LE JEU EN DIRECT
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
 * Chaque touche enfoncée (clavier à l'écran, de l'ordinateur ou MIDI) est
 * notée à l'instant près, en pas, sur l'horloge exacte du transport.
 *
 * ARRONDIR APRÈS COUP. À l'arrêt, on garde les instants bruts et on ouvre
 * une feuille du bas (#idee-arrondi) : « Tel que joué » et « Arrondi » se
 * répondent sur deux rubans, et la grille (noire, croche, double croche)
 * se change en voyant ce que ça change. « Garder » écrit les notes arrondies
 * dans l'idée, en un seul pas d'« Annuler » ; fermer la feuille sans choisir
 * garde aussi, avec la grille affichée : ce qu'on a joué ne se perd jamais.
 * « Recommencer » jette la prise et relance le décompte. Avant, le recalage
 * se faisait d'office, sur une grille réglée ailleurs (feuille Tempo), sans
 * rien montrer de ce qu'il changeait.
 *
 * Deux préférences de l'appareil : `portee:decompte` (0, 1 ou 2 mesures ;
 * 1 par défaut), réglée dans la feuille Tempo ou, d'un appui long, depuis
 * le bouton rouge ; `portee:arrondi` (la dernière grille choisie : 4, 2 ou
 * 1 pas ; croche par défaut). La même grille sert à « Recaler » du menu en
 * cercle : elle vit donc aussi dans e.recalage.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, curseur, selection,
 *   recalage, mode, ouverte, et e.enregistrement, que ce module seul
 *   écrit : { phase: "decompte" | "jeu" | "arrondi", depuis, notes, … }),
 *   $, sq, transport, toast, modifier(f), rafraichir(), source() (ce que
 *   joue le transport), suivreLecture(pas), avantSon(), apresSon() (le micro
 *   se tait puis reprend), choisirMode(mode), grille (pour montrer les notes
 *   gardées).
 * Rend : { basculer(), arreter(), enfoncer(h, v) → true si la note est
 *   prise, relever(h), suivre(pas), maj(), enCours }.
 *
 * Les calculs (où en est la mesure, les barres d'un ruban, l'arrondi) sont
 * exportés et ne touchent pas à la page : tests/direct.test.mjs les essaie.
 */
import * as sq from "./sequence.js";
import { lirePref, ecrirePref } from "./preferences.js";
import { ico } from "./icones.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";

const CLE_DECOMPTE = "portee:decompte";
const CLE_ARRONDI = "portee:arrondi";
/** Les grilles de l'arrondi, en pas (1 pas = une double croche). */
export const GRILLES = [{ pas: 4, nom: "Noire" }, { pas: 2, nom: "Croche" }, { pas: 1, nom: "Double croche" }];
/** Les mesures de décompte. */
export const DECOMPTES = [{ n: 0, nom: "Aucun" }, { n: 1, nom: "1 mesure" }, { n: 2, nom: "2 mesures" }];
/** L'appui long qui ouvre le réglage du décompte, en millisecondes. */
const APPUI_LONG = 550;

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
 * de grille avant la suivante tient jusqu'à elle).
 */
export function arrondir(brutes, grille, depuis) {
  return sq.quantifier(brutes.map((n) => ({ ...n, debut: n.debut - depuis, fin: n.fin - depuis })), { grille, origine: depuis });
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
    const enCours = [...r.ouvertes].map(([h, o]) => ({ d: o.debut, f: Math.max(pas, o.debut), h }));
    const jouees = r.notes.map((n) => ({ d: n.debut, f: n.fin, h: n.h })).concat(enCours);
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
    const signature = `${r.notes.length}|${enCours.length ? Math.round(pas * 8) : "-"}`;
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
    transport.arreter();
    // On joue au clavier : celui de l'écran doit être là (Chanter et Accords n'ont pas de touches à jouer).
    if (e.mode === "chanter" || e.mode === "accords") ctx.choisirMode("clavier");
    ctx.avantSon();
    const mesure = sq.pasParMesure(e.seq);
    const depuis = Math.floor(Math.min(e.curseur, sq.finSequence(e.seq)) / mesure) * mesure;
    const decompte = decompteRetenu_();
    e.selection.clear();
    const prise = { phase: decompte ? "decompte" : "jeu", depuis, decompte, notes: [], ouvertes: new Map(), grille: e.recalage, total: 0 };
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
    const fin = transport.position();
    for (const [h, o] of r.ouvertes) r.notes.push({ h, debut: o.debut, fin: Math.max(fin, o.debut), v: o.v });
    r.ouvertes.clear();
    const jouees = arrondir(r.notes, r.grille, r.depuis);
    if (!jouees.length) {
      finir();
      if (e.ouverte) toast("Rien n'a été joué : l'idée n'a pas changé.");
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

  /** Écrit les notes arrondies dans l'idée, un seul pas d'« Annuler ». */
  function garder() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    e.enregistrement = null; // avant de fermer la feuille : sa fermeture ne refait rien
    fermerFeuille(feuille);
    majBouton();
    const notes = arrondir(r.notes, r.grille, r.depuis);
    if (!notes.length) { ctx.rafraichir(); return; }
    ctx.modifier(() => {
      const ids = notes.map((n) => sq.poser(e.seq, e.piste, n));
      e.selection = new Set(ids);
      e.curseur = Math.max(...notes.map((n) => n.d + n.l));
    });
    // La grille a suivi la tête jusqu'au bout de la prise : on revient montrer ce qui vient d'être écrit.
    const premiere = notes[0];
    requestAnimationFrame(() => { if (e.ouverte) ctx.grille.montrer(premiere); });
    // Court : le message passager est étroit, et « Annuler » est juste en dessous, dans le pupitre.
    if (e.ouverte) toast(`${pluriel(notes.length, "note")} gardée${notes.length > 1 ? "s" : ""}.`);
  }

  /** Jette la prise et relance le décompte. */
  function recommencer() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    e.enregistrement = null;
    fermerFeuille(feuille);
    demarrer();
  }

  // --- La feuille de l'arrondi -------------------------------------------------------

  /** Le titre, les deux rubans et la grille choisie : tout se redessine quand la grille change. */
  function majArrondi() {
    const r = e.enregistrement;
    if (!r || r.phase !== "arrondi") return;
    const mesure = sq.pasParMesure(e.seq), temps = sq.pasParTemps(e.seq);
    const brutes = r.notes.map((n) => ({ d: n.debut, f: n.fin, h: n.h }));
    const arrondies = arrondir(r.notes, r.grille, r.depuis).map((n) => ({ d: n.d, f: n.d + n.l, h: n.h }));
    $("idee-arrondi-titre").textContent = `${pluriel(r.total, "note")} jouée${r.total > 1 ? "s" : ""}`;
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
    if (e.enregistrement && e.enregistrement.phase === "arrondi") { e.enregistrement.grille = pas; majArrondi(); }
    majReglages();
  }

  function choisirDecompte(n) {
    ecrirePref(CLE_DECOMPTE, String(decompteRetenu(n)));
    majReglages();
    majBouton();
  }

  /** La feuille Tempo : le décompte et la grille retenus. */
  function majReglages() {
    const n = decompteRetenu_();
    $("idee-decompte-mesures").querySelectorAll("[data-decompte]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.decompte) === n)));
    $("idee-recalage-reglage").querySelectorAll("[data-grille]").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.grille) === e.recalage)));
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

  $("idee-decompte-mesures").addEventListener("click", (ev) => { const b = ev.target.closest("[data-decompte]"); if (b) choisirDecompte(b.dataset.decompte); });
  $("idee-recalage-reglage").addEventListener("click", (ev) => { const b = ev.target.closest("[data-grille]"); if (b) choisirGrille(b.dataset.grille); });
  $("idee-grilles").addEventListener("click", (ev) => { const b = ev.target.closest("[data-grille]"); if (b) choisirGrille(b.dataset.grille); });
  $("idee-recommencer").addEventListener("click", recommencer);
  $("idee-garder").addEventListener("click", garder);
  // Fermer la feuille (le voile, Échap) sans choisir : on garde, avec la grille affichée.
  brancherFeuille(feuille, { surFermer: () => garder() });

  majBouton();
  majReglages();

  return {
    basculer: () => (e.enregistrement ? arreter() : demarrer()),
    arreter,
    /** Une touche s'enfonce : pendant la prise, on note l'instant (la feuille ouverte avale la note). */
    enfoncer(h, v) {
      const r = e.enregistrement;
      if (!r) return false;
      if (r.phase !== "arrondi") r.ouvertes.set(h, { debut: transport.position(), v });
      return true;
    },
    relever(h) {
      const r = e.enregistrement;
      const o = r && r.phase !== "arrondi" && r.ouvertes.get(h);
      if (!o) return;
      r.notes.push({ h, debut: o.debut, fin: transport.position(), v: o.v });
      r.ouvertes.delete(h);
    },
    suivre,
    maj() { majReglages(); majBouton(); },
    get enCours() { return !!e.enregistrement; },
  };
}
