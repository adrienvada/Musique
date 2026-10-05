/**
 * L'ÉCRAN « ÉCOUTER ET EXPORTER »
 *
 * La page lue, gravée au propre ; on l'écoute au piano (tempo, transposition,
 * une main ou les deux), on l'exporte (MIDI, MusicXML, ABC, impression), ou
 * on la continue en idée. Il partage la page ouverte avec « Corriger »
 * (page-ouverte.js) : le tempo et la transposition choisis ici s'y
 * enregistrent, et le MIDI les reprend.
 *
 * Une fabrique, comme l'éditeur d'idée et l'écran Morceau (audit du 04/10,
 * T3) : il vivait dans app.js, avec son état dans des variables de module.
 */
import { sequenceDepuisAbc } from "./sequence.js";
import { transposerIdee } from "./harmonie.js";
import { fermerFeuille, ouvrirFeuille } from "./feuilles.js";
import { expliquer } from "./erreurs.js";
import { $, dateRelative, toast } from "./ui.js";
import { pastilleBarre, placerOnglets, pourGravure, suivreDock, tempoInitial } from "./atelier.js";

/**
 * @param deps {
 *   page (page-ouverte.js), ecouter(o) (atelier.js, creerEcoutePage), arreterEcoute(),
 *   abcjs() → window.ABCJS, exports { exporterMidi, exporterMusicXml, exporterAbc },
 *   ouvrirIdee(p, options), supprimer() (la page ouverte, après la question)
 * }
 */
export function creerEcranLecteur(deps) {
  const { page, abcjs } = deps;
  let objet = null;     // la partition gravée par abcjs
  let transposition = 0;
  const p = () => page.partition;

  /** Une page s'ouvre : sa transposition est celle qu'on lui avait choisie. */
  function ouvrir(partition) {
    transposition = partition.transposition || 0;
  }

  function afficher() {
    const x = p();
    placerOnglets("vue-lecteur");
    $("titre-lecteur").textContent = x.titre;
    $("statut-lecteur").replaceChildren(pastilleBarre(x));
    const k = (x.abc.match(/^K:(.*)$/m) || [])[1] || "C";
    const m0 = (x.abc.match(/^M:(.*)$/m) || [])[1];
    const m = !m0 || m0 === "none" ? "libre" : m0;
    $("meta-lecteur").textContent = `${k} · ${m === "libre" ? "mesure libre" : m} · lue ${dateRelative(x.creeLe)}`;
    $("mains").hidden = !/^\[V:2\]/m.test(x.abc);
    graver();
    const q = x.tempo || tempoInitial(objet);
    $("tempo").value = q;
    $("tempo-val").textContent = `♩ = ${q}`;
  }

  function graver() {
    const lib = abcjs();
    const zone = $("gravure-lecteur");
    $("transp-val").textContent = (transposition > 0 ? "+" : "") + transposition;
    if (!lib) { zone.textContent = "La gravure n'a pas pu se charger (connexion ?)."; return; }
    [objet] = lib.renderAbc(zone, pourGravure(p().abc), { responsive: "resize", add_classes: true, visualTranspose: transposition, paddingleft: 0, paddingright: 0 });
  }

  const voixMuettes = () => new Set([...($("main-droite").checked ? [] : [1]), ...($("main-gauche").checked ? [] : [2])]);
  const ecouter = () => deps.ecouter({
    objet, abc: p().abc, bouton: $("ecouter"),
    qpm: Number($("tempo").value), transposition, voixMuettes: voixMuettes(),
    titre: p().titre || "Partition",
  });

  /** Une page lue devient une idée : on la prolonge au clavier, en direct, avec des accords. */
  function continuerEnIdee() {
    const x = p();
    if (!abcjs()) { toast("abcjs n'a pas pu se charger (connexion ?)."); return; }
    try {
      const seq = sequenceDepuisAbc(x.abc, abcjs(), { tempo: x.tempo });
      // Ce qu'on entend (et ce que le MIDI exporte) : la page transposée.
      transposerIdee(seq, x.transposition || 0);
      deps.ouvrirIdee(null, { seq, titre: `${x.titre} (idée)` });
      toast("Une copie en idée : la page d'origine ne change pas.");
    } catch (e) {
      console.error(e);
      toast(`Cette partition n'a pas pu devenir une idée : ${expliquer(e)}`);
    }
  }

  // --- Branchements ------------------------------------------------------------------

  $("ecouter").addEventListener("click", ecouter);
  $("tempo").addEventListener("input", () => {
    $("tempo-val").textContent = `♩ = ${$("tempo").value}`;
    deps.arreterEcoute();
    page.changer({ tempo: Number($("tempo").value) }, { delai: 600 });
  });
  const transposer = (d) => {
    transposition = Math.max(-12, Math.min(12, transposition + d));
    deps.arreterEcoute();
    graver();
    page.changer({ transposition });
  };
  $("transp-moins").addEventListener("click", () => transposer(-1));
  $("transp-plus").addEventListener("click", () => transposer(1));
  $("main-droite").addEventListener("change", deps.arreterEcoute);
  $("main-gauche").addEventListener("change", deps.arreterEcoute);
  $("export-abc").addEventListener("click", () => deps.exports.exporterAbc(p()));
  $("export-musicxml").addEventListener("click", () => deps.exports.exporterMusicXml(p()));
  $("export-midi").addEventListener("click", () => deps.exports.exporterMidi(p(), { tempo: Number($("tempo").value), transposition }));
  $("imprimer").addEventListener("click", () => window.print());
  $("continuer-idee").addEventListener("click", continuerEnIdee);
  $("supprimer-lecteur").addEventListener("click", deps.supprimer);
  // Le panneau du bas est fixé : l'écran lui laisse sa hauteur.
  suivreDock($("vue-lecteur"), $("transport-lecteur"));
  // « ••• » : une feuille du bas. Toucher une de ses actions la referme.
  $("plus-lecteur").addEventListener("click", () => ouvrirFeuille($("feuille-lecteur")));
  $("feuille-lecteur").addEventListener("click", (e) => { if (e.target.closest(".liste-actions .btn")) fermerFeuille($("feuille-lecteur")); });

  return {
    ouvrir, afficher,
    /** On quitte l'écran : le tempo réglé à l'instant part tout de suite. */
    fermer: () => page.vider(),
    /** Rien à défaire ici avant de quitter l'écran (la feuille « ••• » se ferme d'elle-même). */
    reculer: () => false,
    /** Raccourci : Espace écoute (ou arrête). Rend true si la touche a servi. */
    toucheBas(e) {
      if (e.code !== "Space" || (e.target.closest && e.target.closest("button"))) return false;
      ecouter();
      return true;
    },
  };
}
