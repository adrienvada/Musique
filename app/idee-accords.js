/**
 * L'ÉDITEUR D'IDÉE : LES ACCORDS
 *
 * Deux façons de poser un accord sur une mesure :
 *   - le mode Accords du pupitre (#pupitre-accords) : six touches, les
 *     accords les plus courants de la tonalité (I ii iii IV V vi en majeur,
 *     i III iv V VI VII en mineur), qui posent l'accord sur la mesure
 *     choisie dans la règle (e.mesureChoisie) et le font entendre ;
 *   - la feuille des accords (#feuille-accords), ouverte par l'accord d'une
 *     mesure ou « + accord » dans la règle, ou par « Tous les accords ».
 *
 * La feuille montre la logique de la tonalité et ce que l'accompagnement va
 * jouer, avant même de l'entendre :
 *   - en haut, la bande des mesures (numéro et accord posé) : un toucher
 *     change de mesure ;
 *   - un aperçu de la mesure, comme un mini rouleau de piano : la mélodie en
 *     bleu, l'accompagnement calculé en gris (il change avec l'accord et le
 *     style) ; le bouton rond l'écoute ;
 *   - la roue des sept accords de la tonalité, l'accord posé au centre avec
 *     ses notes en clair. Cerclés : ceux qui viennent souvent après l'accord
 *     d'avant (la table de harmonie.js) ; teintés : ceux que la mélodie de la
 *     mesure appelle ;
 *   - les couleurs (simple, septième, sus4, add9), qui changent la sorte de
 *     l'accord posé et celle des prochains ;
 *   - le style d'accompagnement, en quatre cartes qui dessinent leur motif
 *     (le même `seq.accompagnement` que le menu de la feuille Tempo) ;
 *   - « Un autre accord » (n'importe quelle racine, n'importe quelle sorte),
 *     un changement à mi-mesure, « Retirer », « Harmoniser toute l'idée ».
 * Toucher un accord l'entend et le pose. Le premier accord posé met
 * l'accompagnement en route, pour qu'on l'entende.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, mesureChoisie, mode), $,
 *   toast, transport, modifier(f), rafraichir(), entendre(hauteurs, duree),
 *   avantSon(), apresSon().
 * Rend : { entrer(), sortir(), maj(), ouvrirFeuille(m, pas), fermer() }.
 */
import { pasParMesure, pasParTemps, nbMesures, nomTonalite, lireTonalite } from "./sequence.js";
import {
  roueDeLaTonalite, suitesProbables, accordsDeLaMelodie, notesDeLAccord, appliquerCouleur, couleurDe, COULEURS,
  degreDeLAccord, harmoniser, accompagnement, voixCompletes, motifAccompagnement, STYLES,
  lireAccord, nomRacine, joliAccord, QUALITES,
} from "./harmonie.js";
import { ico } from "./icones.js";
import { echapper } from "./ui.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";

/** Les six accords du pupitre : ceux de la roue, sans l'accord diminué (qui sonne rarement seul). */
export function accordsDuPupitre(tonalite) {
  return roueDeLaTonalite(tonalite).filter((r) => r.qualite !== "dim");
}

// La roue : le rayon sur lequel se posent les accords, et la hauteur de son centre (px).
const RAYON = 100, CENTRE_Y = 131;

/**
 * Remplace le contenu d'une zone sans perdre le doigt : le défilement et le
 * bouton qui avait le focus (retrouvé par son data-cle) sont rendus à la zone.
 */
function rendre(zone, html) {
  const actif = document.activeElement;
  const cle = actif && zone.contains(actif) ? actif.dataset.cle : null;
  const defil = zone.scrollLeft;
  zone.innerHTML = html;
  zone.scrollLeft = defil;
  if (cle) {
    const encore = [...zone.querySelectorAll("[data-cle]")].find((x) => x.dataset.cle === cle);
    if (encore) encore.focus({ preventScroll: true });
  }
}

export function creerAccords(ctx) {
  const { e, $, toast } = ctx;
  const feuille = $("feuille-accords");
  const panneau = $("pupitre-accords");
  const ouverte = { d: 0 };    // la position (en pas) dont la feuille s'occupe : début de mesure, ou milieu
  let racineChoisie = null;    // « Un autre accord » : la racine touchée
  let couleur = "simple";      // la puce allumée quand la mesure n'a pas d'accord
  let roueFaite = null;        // la tonalité pour laquelle la roue est dessinée
  let ecoute = false;          // « Écouter la mesure » joue
  let mot = null;              // un message du moment, qui remplace la légende de la roue
  let minuterieMot = null;
  let dernierPas = -1;         // pour ne recentrer la bande que quand la mesure change
  let tete = null;             // où en est « Écouter la mesure » (en pas), ou null

  brancherFeuille(feuille, { surFermer: () => { racineChoisie = null; arreterEcoute(); dire(""); } });

  // --- Lire l'idée --------------------------------------------------------------

  const accordsTries = () => [...(e.seq.accords || [])].sort((a, b) => a.d - b.d);

  /** Ce qui entoure la position `d` : sa mesure, où s'arrête son accord, l'accord posé là, celui d'avant. */
  function autour(d) {
    const mesure = pasParMesure(e.seq);
    const m = Math.floor(d / mesure);
    const tous = accordsTries();
    const suivant = tous.find((a) => a.d > d);
    return {
      mesure, m,
      fin: Math.min((m + 1) * mesure, suivant ? suivant.d : Infinity),
      actuel: tous.find((a) => a.d === d) || null,
      avant: [...tous].reverse().find((a) => a.d < d) || null,
    };
  }

  /** Les marques de la roue et des touches : ce qui vient souvent après l'accord d'avant, ce que la mélodie appelle. */
  function reperes(d) {
    const { fin, avant } = autour(d);
    return {
      avant,
      suites: new Set(suitesProbables(e.seq.tonalite, avant && avant.nom)),
      melodie: accordsDeLaMelodie(e.seq, d, fin),
    };
  }

  /** Fait entendre un accord, comme l'accompagnement le jouera. */
  function entendreAccord(nom) {
    const a = lireAccord(nom);
    if (!a) return;
    ctx.entendre([36 + (a.basse ?? a.racine), ...a.intervalles.map((i) => 48 + a.racine + i)], 1.2);
  }

  /**
   * Dit quelque chose. La feuille ouverte cache le message d'en haut de
   * l'écran (elle est au-dessus de tout) : dedans, il remplace la légende de
   * la roue quelques secondes ; sinon, c'est le message habituel.
   */
  function dire(texte, duree = 6000) {
    clearTimeout(minuterieMot);
    $("accords-annonce").textContent = feuille.open ? texte || "" : "";
    if (!feuille.open) { mot = null; if (texte) toast(texte, duree); return; }
    mot = texte || null;
    if (texte) minuterieMot = setTimeout(() => { mot = null; majAide(); }, duree);
    majAide();
  }

  function poser(d, nom) {
    const accords = e.seq.accords || [];
    const premier = !accords.length;
    const actuel = accords.find((a) => a.d === d);
    const enRoute = premier && (!e.seq.accompagnement || e.seq.accompagnement === "aucun");
    arreterEcoute(); // l'accord posé s'entend seul, pas sous la mesure qui jouait
    if (!actuel || actuel.nom !== nom) {
      ctx.modifier(() => {
        e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d);
        e.seq.accords.push({ d, nom });
        e.seq.accords.sort((a, b) => a.d - b.d);
        if (enRoute) e.seq.accompagnement = "plaque";
      });
    }
    entendreAccord(nom);
    if (enRoute) dire(feuille.open
      ? "Les accords s'entendent en accords plaqués. Un autre accompagnement : plus bas."
      : "Les accords s'entendent en accords plaqués. Un autre accompagnement : touche « Tous les accords ».");
  }

  // --- Le mode Accords du pupitre ---------------------------------------------

  const mesureChoisie = () => Math.max(0, e.mesureChoisie || 0);

  function majPupitre() {
    if (panneau.hidden || !e.seq) return;
    const m = mesureChoisie();
    const d = m * pasParMesure(e.seq);
    const { actuel } = autour(d);
    const { avant, suites, melodie } = reperes(d);
    const pose = actuel ? lireAccord(actuel.nom) : null;
    $("accords-mesure").textContent = `Mesure ${m + 1}`;
    $("accords-mesure-avant").disabled = m === 0;
    rendre($("accords-pads"), accordsDuPupitre(e.seq.tonalite).map((a) => {
      const suite = suites.has(a.nom), appelle = melodie.includes(a.nom);
      const dit = `${joliAccord(a.nom)}, ${a.degre}${suite ? (avant ? `, souvent après ${joliAccord(avant.nom)}` : ", souvent au début") : ""}${appelle ? ", va avec la mélodie" : ""}`;
      return `<button class="accord-pad${suite ? " suite" : ""}${appelle ? " melodie" : ""}" data-accord="${echapper(a.nom)}" data-cle="p-${echapper(a.nom)}" aria-pressed="${!!pose && pose.racine === a.racine}" aria-label="${echapper(dit)}"><span class="mono degre">${a.degre}</span><span class="nom">${joliAccord(a.nom)}</span></button>`;
    }).join(""));
  }

  function changerMesure(sens) {
    const fin = nbMesures(e.seq) + 3;
    e.mesureChoisie = Math.max(0, Math.min(fin, mesureChoisie() + sens));
    ctx.rafraichir();
  }

  $("accords-pads").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-accord]");
    if (b) poser(mesureChoisie() * pasParMesure(e.seq), b.dataset.accord);
  });
  $("accords-mesure-avant").addEventListener("click", () => changerMesure(-1));
  $("accords-mesure-apres").addEventListener("click", () => changerMesure(1));
  $("accords-plus").addEventListener("click", () => ouvrirLaFeuille(mesureChoisie(), 0));

  // --- La feuille des accords ----------------------------------------------------

  /** La puce qui suit l'accord posé ; sans accord, la dernière choisie reste. */
  function suivreCouleur(actuel, { remettre = false } = {}) {
    if (actuel) couleur = couleurDe(actuel.nom) || "simple";
    else if (remettre) couleur = "simple";
  }

  /** Ouvre la feuille sur la mesure `m` ; `pas` dit si l'on a touché sa seconde moitié. */
  function ouvrirLaFeuille(m, pas = 0) {
    const mesure = pasParMesure(e.seq);
    const moitie = Math.floor(mesure / 2);
    // Un accord à mi-mesure, s'il y en a un et qu'on touche la seconde moitié.
    const milieu = pas - m * mesure >= moitie && (e.seq.accords || []).some((a) => a.d === m * mesure + moitie);
    ouverte.d = m * mesure + (milieu ? moitie : 0);
    e.mesureChoisie = m;
    racineChoisie = null;
    dernierPas = -1;
    suivreCouleur(autour(ouverte.d).actuel, { remettre: true });
    mot = null;
    ouvrirFeuille(feuille);
    ctx.rafraichir();
  }

  /** Va à une autre position dans la feuille (la règle la suit). */
  function allerA(d) {
    ouverte.d = d;
    racineChoisie = null;
    e.mesureChoisie = Math.floor(d / pasParMesure(e.seq));
    suivreCouleur(autour(d).actuel);
    dire("");
    ctx.rafraichir();
  }

  /** La bande des mesures : un toucher change de mesure (ou de moitié, si la mesure en a deux). */
  function majBande(d, m, mesure) {
    const tous = accordsTries();
    const nb = Math.max(nbMesures(e.seq) + 1, m + 1);
    let html = "";
    for (let i = 0; i < nb; i++) {
      const debut = i * mesure;
      // Les places de la mesure : son début, ses accords, et la position qu'on édite si elle n'a pas d'accord.
      const places = new Set([debut, ...tous.filter((a) => a.d >= debut && a.d < debut + mesure).map((a) => a.d)]);
      if (d >= debut && d < debut + mesure) places.add(d);
      const boutons = [...places].sort((a, b) => a - b).map((p, k) => {
        const a = tous.find((x) => x.d === p);
        const nom = a ? joliAccord(a.nom) : "·";
        return `<button class="accords-place" type="button" data-d="${p}" data-cle="m-${p}" aria-pressed="${p === d}" aria-label="Mesure ${i + 1}${p > debut ? ", 2ᵉ moitié" : ""}${a ? `, accord ${echapper(nom)}` : ", sans accord"}"><span class="num mono">${k === 0 ? i + 1 : "½"}</span><span class="acc${a ? "" : " rien"}">${echapper(nom)}</span></button>`;
      });
      html += `<div class="accords-cellule${i === m ? " on" : ""}${boutons.length > 1 ? " double" : ""}">${boutons.join("")}</div>`;
    }
    const zone = $("accords-bande");
    rendre(zone, html);
    // La mesure courante au milieu de la bande, quand on vient d'y arriver (pas à chaque dessin : on peut faire défiler).
    if (dernierPas !== d) {
      dernierPas = d;
      const cellule = zone.querySelector(".accords-cellule.on");
      if (cellule) zone.scrollLeft = Math.max(0, cellule.offsetLeft - (zone.clientWidth - cellule.offsetWidth) / 2);
    }
  }

  /** L'aperçu : la mesure comme un mini rouleau de piano, ce qui sonnera (mélodie en bleu, accompagnement en gris). */
  function majApercu(d, m, mesure, { fin: finAccord }) {
    const debut = m * mesure, fin = debut + mesure;
    const dedans = (n) => n.d < fin && n.d + n.l > debut;
    const melodie = e.seq.pistes.flatMap((p) => p.notes).filter(dedans);
    const acc = accompagnement(e.seq).filter(dedans);
    const hauteurs = [...melodie, ...acc].map((n) => n.h);
    // L'échelle verticale suit ce qu'on voit : au moins une octave, centrée sur les notes.
    const haut = hauteurs.length ? Math.max(...hauteurs) : 66, bas = hauteurs.length ? Math.min(...hauteurs) : 54;
    const etendue = Math.max(11, haut - bas), centre = (haut + bas) / 2;
    const sommet = centre + etendue / 2;
    const hZone = 52, y0 = 19; // sous la ligne des noms d'accords
    const pente = hZone / (etendue + 1);
    const epaisseur = Math.max(3, Math.min(7, pente * 0.8));
    const pct = (x) => (((Math.max(debut, Math.min(fin, x)) - debut) / mesure) * 100).toFixed(2);
    const barre = (n, classe) => `<i class="apercu-note ${classe}" style="left:${pct(n.d)}%;width:calc(${(pct(n.d + n.l) - pct(n.d)).toFixed(2)}% - 1px);top:${(y0 + (sommet - n.h) * pente).toFixed(1)}px;height:${epaisseur.toFixed(1)}px"></i>`;
    const temps = pasParTemps(e.seq);
    let html = "";
    // Une mesure à deux accords, ou une moitié qu'on édite : on y ombre la part dont on s'occupe.
    if (d % mesure || finAccord < fin) html += `<i class="apercu-zone" style="left:${pct(d)}%;width:${(pct(finAccord) - pct(d)).toFixed(2)}%"></i>`;
    for (let t = temps; t < mesure; t += temps) html += `<i class="apercu-temps" style="left:${pct(debut + t)}%"></i>`;
    html += melodie.map((n) => barre(n, "mel")).join("") + acc.map((n) => barre(n, "acc")).join("");
    html += accordsTries().filter((a) => a.d >= debut && a.d < fin).map((a) => `<span class="apercu-accord" style="left:${pct(a.d)}%">${echapper(joliAccord(a.nom))}</span>`).join("");
    if (!acc.length) {
      const dit = !(e.seq.accords || []).length ? "Pose un accord : l'accompagnement s'affichera ici."
        : (e.seq.accompagnement || "aucun") === "aucun" ? "Sans accompagnement : choisis un style plus bas." : "";
      if (dit) html += `<span class="apercu-aide">${dit}</span>`;
    }
    const zone = $("accords-apercu");
    zone.innerHTML = html + `<i class="apercu-tete" id="accords-tete" hidden></i>`;
    placerTete();
    const style = STYLES.find((s) => s.id === (e.seq.accompagnement || "aucun"));
    zone.setAttribute("aria-label", `Mesure ${m + 1} : ${melodie.length} note${melodie.length > 1 ? "s" : ""} de mélodie, ${acc.length} d'accompagnement (${style ? style.nom.toLowerCase() : "sans"})`);
  }

  /** La tête de lecture de l'aperçu, pendant « Écouter la mesure ». */
  function placerTete() {
    const t = $("accords-tete");
    if (!t || !e.seq) return;
    const mesure = pasParMesure(e.seq);
    const x = tete === null ? -1 : (tete - Math.floor(ouverte.d / mesure) * mesure) / mesure;
    t.hidden = !(x >= 0 && x < 1);
    t.style.left = `${(x * 100).toFixed(2)}%`;
  }

  /** La roue : sept accords sur un cercle, dans l'ordre des degrés, l'accord posé au centre. */
  function construireRoue() {
    roueFaite = e.seq.tonalite;
    const sommets = roueDeLaTonalite(e.seq.tonalite).map((r, i) => {
      const angle = ((-90 + (i * 360) / 7) * Math.PI) / 180;
      return `<button class="roue-accord" type="button" data-roue="${i}" data-cle="r-${i}" style="left:calc(50% + ${(RAYON * Math.cos(angle)).toFixed(1)}px);top:${(CENTRE_Y + RAYON * Math.sin(angle)).toFixed(1)}px"><span class="nom">${joliAccord(r.nom)}</span><span class="mono degre">${r.degre}</span></button>`;
    }).join("");
    $("accords-roue").innerHTML = `<span class="roue-orbite" aria-hidden="true"></span><button class="roue-centre rien" type="button" id="accords-centre" style="top:${CENTRE_Y}px"><span class="nom"></span><span class="notes"></span></button>${sommets}`;
  }

  function majRoue(d, actuel, avant) {
    if (roueFaite !== e.seq.tonalite) construireRoue();
    const roue = roueDeLaTonalite(e.seq.tonalite);
    const { suites, melodie } = reperes(d);
    const pose = actuel ? lireAccord(actuel.nom) : null;
    for (const b of $("accords-roue").querySelectorAll(".roue-accord")) {
      const r = roue[Number(b.dataset.roue)];
      const on = !!pose && pose.racine === r.racine;
      const suite = suites.has(r.nom), appelle = melodie.includes(r.nom);
      b.classList.toggle("on", on);
      b.classList.toggle("suite", suite);
      b.classList.toggle("melodie", appelle);
      b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-label", `${joliAccord(r.nom)}, ${r.degre}${suite ? (avant ? `, souvent après ${joliAccord(avant.nom)}` : ", souvent au début") : ""}${appelle ? ", va avec la mélodie" : ""}`);
    }
    // Au centre : l'accord posé, en grand, et ses notes en clair.
    const centre = $("accords-centre");
    const nom = actuel ? joliAccord(actuel.nom) : "—";
    centre.classList.toggle("rien", !actuel);
    centre.disabled = !actuel;
    centre.setAttribute("aria-label", actuel ? `${nom} : réentendre` : "Pas d'accord ici");
    const grandeur = nom.length > 5 ? "tres-long" : nom.length > 3 ? "long" : "";
    centre.firstElementChild.className = `nom ${grandeur}`;
    centre.firstElementChild.textContent = nom;
    centre.lastElementChild.textContent = actuel ? notesDeLAccord(actuel.nom).join(" · ") : avant ? `${joliAccord(avant.nom)} continue` : "touche un accord";
    $("accords-tonalite").textContent = nomTonalite(e.seq.tonalite);
  }

  /** La légende de la roue, ou le message du moment. */
  function majAide() {
    if (!feuille.open || !e.seq) return;
    const zone = $("accords-aide");
    const { actuel, avant } = autour(ouverte.d);
    const { suites, melodie } = reperes(ouverte.d);
    // Une phrase prend toute la ligne (le nom de la tonalité s'efface) ; la légende n'en prend que la droite.
    const phrase = mot || (actuel && degreDeLAccord(actuel.nom, e.seq.tonalite) < 0 ? "Cet accord n'est pas de la tonalité : un accord de la roue y ramène." : "");
    zone.parentElement.classList.toggle("avec-phrase", !!phrase);
    if (phrase) { zone.textContent = phrase; return; }
    const parts = [];
    if (suites.size) parts.push(`<span class="legende"><i class="pt suite"></i>${avant ? `souvent après ${echapper(joliAccord(avant.nom))}` : "pour commencer"}</span>`);
    if (melodie.length) parts.push(`<span class="legende"><i class="pt melodie"></i>vont avec ta mélodie</span>`);
    zone.innerHTML = parts.join("") || "Touche un accord : il s'entend et se pose.";
  }

  /** Les puces de couleur : la sorte de l'accord posé ; sans accord, celle des prochains. */
  function majCouleurs(actuel) {
    const allumee = actuel ? couleurDe(actuel.nom) : couleur;
    rendre($("accords-couleurs"), COULEURS.map((c) => {
      const resultat = actuel ? appliquerCouleur(actuel.nom, c.id, e.seq.tonalite) : null;
      return `<button class="puce" type="button" data-couleur="${c.id}" data-cle="c-${c.id}" aria-pressed="${c.id === allumee}"${actuel && !resultat ? " disabled" : ""}${resultat ? ` title="${echapper(joliAccord(resultat))}"` : ""}>${c.nom}</button>`;
    }).join(""));
  }

  /** Les cartes de style : chacune dessine ce que le style joue (le calcul même de l'accompagnement). */
  function majStyles() {
    const courant = e.seq.accompagnement || "aucun";
    const motifs = STYLES.map((s) => ({ ...s, ...motifAccompagnement(s.id, e.seq.mesure) }));
    const hs = motifs.flatMap((s) => s.notes.map((n) => n.h));
    const bas = Math.min(...hs), haut = Math.max(...hs);
    rendre($("accords-styles"), motifs.map((s) => {
      const barres = s.notes.map((n) => `<i style="left:${((n.d / s.pas) * 100).toFixed(1)}%;width:calc(${((n.l / s.pas) * 100).toFixed(1)}% - 2px);top:${(((haut - n.h) / (haut - bas)) * 22).toFixed(1)}px"></i>`).join("");
      return `<button class="accords-style" type="button" data-style="${s.id}" data-cle="s-${s.id}" aria-pressed="${s.id === courant}"><span class="nom">${s.nom}</span><span class="motif${s.notes.length ? "" : " rien"}" aria-hidden="true">${barres}</span></button>`;
    }).join(""));
  }

  function majFeuille() {
    if (!feuille.open || !e.seq) return;
    const d = ouverte.d;
    const lieu = autour(d);
    const { m, mesure, actuel, avant } = lieu;
    $("accords-ou").textContent = `Mesure ${m + 1}${d % mesure ? ", 2ᵉ moitié" : ""}`;
    majBande(d, m, mesure);
    majApercu(d, m, mesure, lieu);
    majRoue(d, actuel, avant);
    majAide();
    majCouleurs(actuel);
    majStyles();
    // Un autre accord : n'importe quelle racine, n'importe quelle sorte.
    const k = lireTonalite(e.seq.tonalite);
    const racines = Array.from({ length: 12 }, (_, i) => nomRacine(k.pc + i, e.seq.tonalite));
    const lu = actuel ? lireAccord(actuel.nom) : null;
    racineChoisie = racineChoisie ?? (lu ? nomRacine(lu.racine, e.seq.tonalite) : racines[0]);
    rendre($("accords-racines"), racines.map((r) => `<button class="btn" type="button" data-racine="${r}" data-cle="x-${r}" aria-pressed="${r === racineChoisie}">${joliAccord(r)}</button>`).join(""));
    rendre($("accords-qualites"), Object.keys(QUALITES).map((q) => `<button class="btn" type="button" data-accord="${racineChoisie}${q}" data-cle="q-${q}" aria-pressed="${!!actuel && actuel.nom === racineChoisie + q}">${joliAccord(racineChoisie + q)}</button>`).join(""));
    $("accord-retirer").disabled = !actuel;
    const aMilieu = (e.seq.accords || []).some((a) => a.d === m * mesure + Math.floor(mesure / 2));
    $("accord-milieu").textContent = d % mesure ? "Revenir au début de la mesure" : aMilieu ? "Accord du milieu de la mesure" : "Changer au milieu de la mesure";
    $("accord-avant").disabled = d === 0;
    $("accord-apres").disabled = m >= nbMesures(e.seq);
    majEcoute();
  }

  // --- Écouter la mesure -----------------------------------------------------------

  function majEcoute() {
    const b = $("accords-ecouter");
    b.setAttribute("aria-pressed", String(ecoute));
    b.setAttribute("aria-label", ecoute ? "Arrêter l'écoute" : "Écouter la mesure");
    b.title = b.getAttribute("aria-label");
    b.innerHTML = ico(ecoute ? "stop" : "lire");
  }

  function arreterEcoute() {
    if (ecoute) ctx.transport.arreter(); // surFin remet le bouton et le micro en ordre
  }

  /** Joue la mesure de la feuille : la mélodie et l'accompagnement tels qu'ils seront gravés. */
  async function ecouterMesure() {
    if (ecoute) { arreterEcoute(); return; }
    const mesure = pasParMesure(e.seq);
    const debut = Math.floor(ouverte.d / mesure) * mesure, fin = debut + mesure;
    const parPas = new Map();
    for (const v of voixCompletes(e.seq)) {
      for (const n of v.notes) {
        if (n.d < debut || n.d >= fin) continue;
        if (!parPas.has(n.d)) parPas.set(n.d, []);
        parPas.get(n.d).push(n);
      }
    }
    if (!parPas.size) {
      dire((e.seq.accompagnement || "aucun") === "aucun" && (e.seq.accords || []).length
        ? "Sans accompagnement, on n'entend plus que ta mélodie : ici, elle est vide."
        : "Rien à écouter ici : pose un accord, ou écris une mélodie.");
      return;
    }
    const surFin = () => { ecoute = false; tete = null; placerTete(); majEcoute(); ctx.apresSon(); };
    ctx.avantSon();
    ecoute = true;
    majEcoute();
    try {
      await ctx.transport.jouer(
        () => ({ tempo: e.seq.tempo, mesure, temps: pasParTemps(e.seq), fin, notesA: (p) => parPas.get(p) || [] }),
        { depuis: debut, surFin, surPosition: (pas) => { tete = pas; placerTete(); } },
      );
    } catch (err) {
      surFin();
      dire(err.message || "Le piano n'a pas pu se charger.");
    }
  }

  // --- Les gestes de la feuille -----------------------------------------------------

  /** Un accord de la roue : posé dans la couleur allumée (« Septième » → Dm7). */
  function poserDeLaRoue(i) {
    const r = roueDeLaTonalite(e.seq.tonalite)[i];
    poser(ouverte.d, appliquerCouleur(r.nom, couleur, e.seq.tonalite) || r.nom);
    suivreCouleur(autour(ouverte.d).actuel);
  }

  function choisirCouleur(id) {
    const { actuel } = autour(ouverte.d);
    couleur = id;
    if (!actuel) {
      majFeuille();
      dire(`${COULEURS.find((c) => c.id === id).nom} : touche un accord de la roue.`, 4000);
      return;
    }
    const nom = appliquerCouleur(actuel.nom, id, e.seq.tonalite);
    if (nom) poser(ouverte.d, nom);
  }

  /** Change le style d'accompagnement (celui de la feuille Tempo : la même donnée) et l'écoute. */
  async function choisirStyle(id) {
    if ((e.seq.accompagnement || "aucun") !== id) ctx.modifier(() => { e.seq.accompagnement = id; });
    if (ecoute) { ctx.transport.arreter(); }
    await ecouterMesure();
  }

  feuille.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b || !feuille.contains(b)) return;
    if (b.id === "accords-centre") { const { actuel } = autour(ouverte.d); if (actuel) entendreAccord(actuel.nom); return; }
    if (b.dataset.roue !== undefined) { poserDeLaRoue(Number(b.dataset.roue)); return; }
    if (b.dataset.couleur) { choisirCouleur(b.dataset.couleur); return; }
    if (b.dataset.style) { choisirStyle(b.dataset.style); return; }
    if (b.dataset.d !== undefined) { allerA(Number(b.dataset.d)); return; }
    if (b.dataset.accord) { poser(ouverte.d, b.dataset.accord); return; }
    if (b.dataset.racine) { racineChoisie = b.dataset.racine; majFeuille(); }
  });
  $("accords-fermer").addEventListener("click", () => fermerFeuille(feuille));
  $("accords-ecouter").addEventListener("click", ecouterMesure);
  $("accord-avant").addEventListener("click", () => { const mesure = pasParMesure(e.seq); allerA(Math.max(0, (Math.ceil(ouverte.d / mesure) - 1) * mesure)); });
  $("accord-apres").addEventListener("click", () => { const mesure = pasParMesure(e.seq); allerA((Math.floor(ouverte.d / mesure) + 1) * mesure); });
  $("accord-milieu").addEventListener("click", () => {
    const mesure = pasParMesure(e.seq);
    const debut = Math.floor(ouverte.d / mesure) * mesure;
    allerA(ouverte.d % mesure ? debut : debut + Math.floor(mesure / 2));
  });
  $("accord-retirer").addEventListener("click", () => {
    const d = ouverte.d;
    ctx.modifier(() => { e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d); });
  });
  $("accords-tout").addEventListener("click", () => {
    // `suggerer` lit la première piste : sans mélodie, il n'y a rien d'après quoi proposer.
    if (!e.seq.pistes[0].notes.length) { dire("Écris d'abord une mélodie : les accords se proposent d'après ses notes."); return; }
    const avait = (e.seq.accords || []).length;
    ctx.modifier(() => {
      e.seq.accords = harmoniser(e.seq);
      if (!e.seq.accompagnement || e.seq.accompagnement === "aucun") e.seq.accompagnement = "plaque";
    });
    suivreCouleur(autour(ouverte.d).actuel);
    const n = e.seq.accords.length, s = n > 1 ? "s" : "";
    dire(avait
      ? `${n} accord${s} proposé${s} d'après ta mélodie, à la place de ceux d'avant (« Annuler » les rend).`
      : `${n} accord${s} proposé${s} d'après ta mélodie. Écoute, puis change ceux qui ne te plaisent pas.`, 9000);
  });

  return {
    entrer() { panneau.hidden = false; majPupitre(); },
    sortir() { panneau.hidden = true; },
    maj() { majPupitre(); majFeuille(); },
    ouvrirFeuille: ouvrirLaFeuille,
    fermer() { fermerFeuille(feuille); },
  };
}
