/**
 * L'ÉDITEUR D'IDÉE : LES ACCORDS
 *
 * Deux façons de poser un accord sur une mesure :
 *   - le mode Accords du pupitre (#pupitre-accords) : six touches, les
 *     accords les plus courants de la tonalité (I ii iii IV V vi en majeur,
 *     i III iv V VI VII en mineur), qui posent l'accord sur la mesure
 *     choisie dans la règle (e.mesureChoisie) et le font entendre ;
 *   - la feuille de tous les accords (#feuille-accords), ouverte par
 *     l'accord d'une mesure ou « + accord » dans la règle, ou par « Tous
 *     les accords » : ceux qui vont avec les notes de la mesure, du plus
 *     probable au moins probable, n'importe quel autre, un changement à
 *     mi-mesure, et « Proposer pour toute l'idée ».
 * Le premier accord posé met l'accompagnement en route, pour qu'on
 * l'entende.
 *
 * Reçoit du cœur (ctx) : e (l'état : seq, piste, mesureChoisie, mode), $,
 *   toast, modifier(f), rafraichir(), entendre(hauteurs, duree),
 *   notesPiste().
 * Rend : { entrer(), sortir(), maj(), ouvrirFeuille(m, pas), fermer() }.
 */
import { pasParMesure, nbMesures, lireTonalite } from "./sequence.js";
import { accordsDeLaTonalite, suggerer, harmoniser, lireAccord, nomRacine, joliAccord, QUALITES } from "./harmonie.js";
import { brancherFeuille, ouvrirFeuille, fermerFeuille } from "./feuilles.js";

/** Les six accords du pupitre, dans l'ordre de la gamme. */
export function accordsDuPupitre(tonalite) {
  const k = lireTonalite(tonalite);
  const voulus = k.mineur ? ["i", "III", "iv", "V", "VI", "VII"] : ["I", "ii", "iii", "IV", "V", "vi"];
  const tous = accordsDeLaTonalite(tonalite);
  return voulus.map((degre) => tous.find((a) => a.degre === degre)).filter(Boolean);
}

export function creerAccords(ctx) {
  const { e, $, toast } = ctx;
  const feuille = $("feuille-accords");
  const panneau = $("pupitre-accords");
  const ouverte = { d: 0 };
  let racineChoisie = null;

  brancherFeuille(feuille, { surFermer: () => { racineChoisie = null; } });

  /** Fait entendre un accord, comme l'accompagnement le jouera. */
  function entendreAccord(nom) {
    const a = lireAccord(nom);
    if (!a) return;
    ctx.entendre([36 + (a.basse ?? a.racine), ...a.intervalles.map((i) => 48 + a.racine + i)], 1.2);
  }

  function poser(d, nom) {
    const premier = !(e.seq.accords || []).length;
    ctx.modifier(() => {
      e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d);
      e.seq.accords.push({ d, nom });
      e.seq.accords.sort((a, b) => a.d - b.d);
      if (premier && (!e.seq.accompagnement || e.seq.accompagnement === "aucun")) e.seq.accompagnement = "plaque";
    });
    entendreAccord(nom);
    if (premier) toast("Les accords s'entendent en accords plaqués. Un autre accompagnement : touche le tempo, sous le titre.", 6000);
  }

  // --- Le mode Accords du pupitre ---------------------------------------------

  const mesureChoisie = () => Math.max(0, e.mesureChoisie || 0);

  function majPupitre() {
    if (panneau.hidden || !e.seq) return;
    const m = mesureChoisie();
    const d = m * pasParMesure(e.seq);
    const actuel = (e.seq.accords || []).find((a) => a.d === d);
    $("accords-mesure").textContent = `Mesure ${m + 1}`;
    $("accords-mesure-avant").disabled = m === 0;
    $("accords-pads").innerHTML = accordsDuPupitre(e.seq.tonalite).map((a) => `<button class="accord-pad" data-accord="${a.nom}" aria-pressed="${!!actuel && actuel.nom === a.nom}"><span class="mono degre">${a.degre}</span><span class="nom">${joliAccord(a.nom)}</span></button>`).join("");
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

  // --- La feuille de tous les accords ------------------------------------------

  /** Ouvre la feuille sur la mesure `m` ; `pas` dit si l'on a touché sa seconde moitié. */
  function ouvrirLaFeuille(m, pas = 0) {
    const mesure = pasParMesure(e.seq);
    const moitie = Math.floor(mesure / 2);
    // Un accord à mi-mesure, s'il y en a un et qu'on touche la seconde moitié.
    const milieu = pas - m * mesure >= moitie && (e.seq.accords || []).some((a) => a.d === m * mesure + moitie);
    ouverte.d = m * mesure + (milieu ? moitie : 0);
    e.mesureChoisie = m;
    racineChoisie = null;
    ouvrirFeuille(feuille);
    ctx.rafraichir();
  }

  function majFeuille() {
    if (!feuille.open || !e.seq) return;
    const mesure = pasParMesure(e.seq);
    const d = ouverte.d;
    const m = Math.floor(d / mesure);
    const moitie = Math.floor(mesure / 2);
    const fin = (e.seq.accords || []).filter((a) => a.d > d).reduce((x, a) => Math.min(x, a.d), (m + 1) * mesure);
    const actuel = (e.seq.accords || []).find((a) => a.d === d);
    $("accords-ou").textContent = `Mesure ${m + 1}${d % mesure ? ", 2ᵉ moitié" : ""}`;
    const degres = new Map(accordsDeLaTonalite(e.seq.tonalite).map((a) => [a.nom, a.degre]));
    const proposes = suggerer(e.seq, d, fin, 8);
    if (actuel && !proposes.includes(actuel.nom)) proposes.unshift(actuel.nom);
    $("accords-proposes").innerHTML = proposes.map((nom) => `<button class="btn" data-accord="${nom}" aria-pressed="${!!actuel && actuel.nom === nom}">${joliAccord(nom)}${degres.has(nom) ? ` <span class="degre">${degres.get(nom)}</span>` : ""}</button>`).join("");
    const k = lireTonalite(e.seq.tonalite);
    const racines = Array.from({ length: 12 }, (_, i) => nomRacine(k.pc + i, e.seq.tonalite));
    const lu = actuel ? lireAccord(actuel.nom) : null;
    racineChoisie = racineChoisie ?? (lu ? nomRacine(lu.racine, e.seq.tonalite) : racines[0]);
    $("accords-racines").innerHTML = racines.map((r) => `<button class="btn" data-racine="${r}" aria-pressed="${r === racineChoisie}">${joliAccord(r)}</button>`).join("");
    $("accords-qualites").innerHTML = Object.keys(QUALITES).map((q) => `<button class="btn" data-accord="${racineChoisie}${q}" aria-pressed="${!!actuel && actuel.nom === racineChoisie + q}">${joliAccord(racineChoisie + q)}</button>`).join("");
    $("accord-retirer").disabled = !actuel;
    const aMilieu = (e.seq.accords || []).some((a) => a.d === m * mesure + moitie);
    $("accord-milieu").textContent = d % mesure ? "Revenir au début de la mesure" : aMilieu ? "Accord du milieu de la mesure" : "Changer au milieu de la mesure";
    $("accord-avant").disabled = d === 0;
  }

  /** Va à une autre mesure dans la feuille (la règle la suit). */
  function allerA(d) {
    ouverte.d = d;
    racineChoisie = null;
    e.mesureChoisie = Math.floor(d / pasParMesure(e.seq));
    ctx.rafraichir();
  }

  feuille.addEventListener("click", (ev) => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.accord) { poser(ouverte.d, b.dataset.accord); return; }
    if (b.dataset.racine) { racineChoisie = b.dataset.racine; majFeuille(); }
  });
  $("accords-fermer").addEventListener("click", () => fermerFeuille(feuille));
  $("accord-avant").addEventListener("click", () => { const mesure = pasParMesure(e.seq); allerA(Math.max(0, (Math.ceil(ouverte.d / mesure) - 1) * mesure)); });
  $("accord-apres").addEventListener("click", () => { const mesure = pasParMesure(e.seq); allerA((Math.floor(ouverte.d / mesure) + 1) * mesure); });
  $("accord-milieu").addEventListener("click", () => {
    const mesure = pasParMesure(e.seq);
    const debut = Math.floor(ouverte.d / mesure) * mesure;
    ouverte.d = ouverte.d % mesure ? debut : debut + Math.floor(mesure / 2);
    racineChoisie = null;
    majFeuille();
  });
  $("accord-retirer").addEventListener("click", () => {
    const d = ouverte.d;
    ctx.modifier(() => { e.seq.accords = (e.seq.accords || []).filter((a) => a.d !== d); });
  });
  $("accords-tout").addEventListener("click", () => {
    if (!ctx.notesPiste().length && e.piste === 0) { toast("Écris d'abord une mélodie : les accords se proposent d'après ses notes."); return; }
    ctx.modifier(() => {
      e.seq.accords = harmoniser(e.seq);
      if (!e.seq.accompagnement || e.seq.accompagnement === "aucun") e.seq.accompagnement = "plaque";
    });
    toast(`${e.seq.accords.length} accord${e.seq.accords.length > 1 ? "s" : ""} proposé${e.seq.accords.length > 1 ? "s" : ""} : écoute, puis change ceux qui ne te plaisent pas.`, 6000);
  });

  return {
    entrer() { panneau.hidden = false; majPupitre(); },
    sortir() { panneau.hidden = true; },
    maj() { majPupitre(); majFeuille(); },
    ouvrirFeuille: ouvrirLaFeuille,
    fermer() { fermerFeuille(feuille); },
  };
}
