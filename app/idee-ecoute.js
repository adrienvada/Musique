/**
 * L'ÉCOUTE DANS L'ÉDITEUR D'IDÉE : ÉCOUTER, LA BOUCLE, LE MÉTRONOME
 *
 * Le bouton Écouter (et Espace), la boucle (les mesures de la sélection,
 * sinon toute l'idée) et le métronome. Pendant l'écoute, la tête avance
 * dans la grille, ou la note jouée s'allume sur la partition. Le micro se
 * tait tant que le piano joue (il l'entendrait), puis reprend.
 *
 * Il vivait dans idee.js (audit du 04/10, T3). Les modules du pupitre en
 * empruntent la source (le jeu en direct) et la pause du micro (les
 * accords), par le contexte de l'éditeur.
 */
import * as sq from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { ico } from "./icones.js";
import { expliquer } from "./erreurs.js";

/**
 * @param ctx {
 *   e (l'état de l'éditeur : l'écoute y écrit la boucle et le métronome),
 *   $, transport, toast, grille, choisies() → les notes choisies, rafraichir(),
 *   chant(), direct(), partition() → les modules créés après elle (elle ne
 *   s'en sert que pendant l'écoute)
 * }
 */
export function creerEcouteIdee(ctx) {
  const { e, $, transport } = ctx;

  let cache = { version: -1, notesA: null, fin: 0 };
  /**
   * Ce que le transport joue : toutes les voix (accompagnement compris),
   * rangées par pas une fois par version de l'idée. Le tempo se relit à
   * chaque fois : il se règle pendant l'écoute.
   */
  function source() {
    if (cache.version !== e.version) cache = { version: e.version, ...sq.indexerParPas(voixCompletes(e.seq).flatMap((v) => v.notes)) };
    return { tempo: e.seq.tempo, mesure: sq.pasParMesure(e.seq), temps: sq.pasParTemps(e.seq), fin: cache.fin, notesA: cache.notesA };
  }

  /** La boucle : les mesures de la sélection, sinon toute l'idée. */
  function etendueBoucle() {
    const mesure = sq.pasParMesure(e.seq);
    const sel = ctx.choisies();
    if (sel.length) {
      const [a, b] = sq.etendue(sel);
      return [Math.floor(a / mesure) * mesure, Math.ceil(b / mesure) * mesure];
    }
    return [0, sq.nbMesures(e.seq) * mesure];
  }

  // Le micro et le piano ne marchent pas ensemble (le piano repasserait dans
  // le micro) : le micro se tait tant que le piano joue, puis reprend.
  const avantSon = () => ctx.chant().pause();
  const apresSon = () => ctx.chant().reprendre();

  function majJouer(enCours) {
    const b = $("idee-jouer");
    b.innerHTML = ico(enCours ? "pause" : "lire");
    b.setAttribute("aria-label", enCours ? "Arrêter l'écoute" : "Écouter");
    b.setAttribute("aria-pressed", String(enCours));
  }

  /** Suit la lecture : la tête dans la grille, ou la note jouée sur la partition. */
  function suivre(pas) {
    if (e.affichage === "grille") ctx.grille.lecture(pas);
    else ctx.partition().suivre(pas);
    ctx.direct().suivre(pas);
  }

  /** Écoute l'idée, depuis la boucle, la sélection ou le curseur ; arrête si elle joue. */
  async function jouer() {
    if (transport.actif) { transport.arreter(); return; }
    if (e.enregistrement) return;
    avantSon();
    const s = source();
    const boucle = e.boucle ? etendueBoucle() : null;
    let depuis = 0;
    if (boucle) depuis = boucle[0];
    else if (e.selection.size) depuis = Math.min(...ctx.choisies().map((n) => n.d));
    else if (e.curseur > 0 && e.curseur < s.fin) depuis = e.curseur;
    majJouer(true);
    try {
      await transport.jouer(source, {
        depuis, boucle, metronome: e.metronome,
        // Les commandes de l'écran verrouillé (eveil.js, M8) : le titre, et « lecture » qui relance.
        titre: e.titre, relancer: () => { if (e.ouverte && !transport.actif) jouer(); },
        surPosition: suivre,
        surFin: () => { majJouer(false); suivre(null); apresSon(); ctx.partition().apresLecture(); },
      });
    } catch (err) {
      majJouer(false);
      apresSon();
      ctx.toast(expliquer(err, "Le piano n'a pas pu se charger."));
    }
  }

  $("idee-jouer").addEventListener("click", jouer);
  $("idee-boucle").addEventListener("click", () => {
    e.boucle = !e.boucle;
    transport.regler({ boucle: e.boucle ? etendueBoucle() : null });
    ctx.rafraichir();
  });
  $("idee-metronome").addEventListener("click", () => {
    e.metronome = !e.metronome;
    transport.regler({ metronome: e.metronome });
    ctx.rafraichir();
  });

  return {
    source, etendueBoucle, avantSon, apresSon, jouer, suivre,
    /** La boucle et le métronome montrent leur état. */
    maj() {
      $("idee-boucle").setAttribute("aria-pressed", String(e.boucle));
      $("idee-metronome").setAttribute("aria-pressed", String(e.metronome));
    },
  };
}
