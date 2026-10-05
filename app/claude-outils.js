/**
 * DEMANDER À CLAUDE : LES OUTILS DE « CE QUE TU VEUX » (H2)
 *
 * Quand la page peut offrir des outils à Claude (`sample.limits().tools`),
 * une demande libre (« transpose en ré et double les durées de la deuxième
 * mesure ») ne lui fait pas réécrire l'idée note à note, ce que les modèles
 * réussissent mal : il appelle des outils qui font les gestes d'Adrien,
 * ceux de sequence.js (transposer, étirer, à l'envers, miroir, recaler…),
 * sur une COPIE de l'idée. Rien n'est gardé avant qu'Adrien ait écouté la
 * copie et touché « Garder » ; la copie est revérifiée à la fin
 * (claude-idee.js, valider avec `options.copie`).
 *
 * Ces outils vivaient dans claude-idee.js, qui recevait les gestes en
 * paramètre tant que sequence.js ne passait pas `npm run types` : il passe
 * depuis le lot architecture, et l'import est direct.
 *
 * Sans DOM : appli et tests.
 */
import { BORNES, cloner, effacer, etirer, finSequence, nomTonalite, pasParMesure, pasParTemps, poser, recaler, renverser, retrograder, transposer } from "./sequence.js";
import { transposerIdee } from "./harmonie.js";
import { champs, chevauchement, chevauchements, enPas, entierDans, formeSure, lireNotes, nomDAccord, poserAccords } from "./claude-idee.js";

/**
 * @typedef {import("./claude-idee.js").Sequence} Sequence
 * @typedef {import("./claude-idee.js").Accord} Accord
 */

const PORTEE = {
  piste: { type: "integer", minimum: 1, description: "La piste, comptée de 1 (1 par défaut)." },
  debut: { type: "integer", minimum: 0, description: "Seulement les notes qui commencent à partir de ce pas (0 par défaut)." },
  fin: { type: "integer", minimum: 1, description: "… et avant ce pas (la fin de l'idée par défaut)." },
};
// Sans « required » quand rien n'est requis : une liste vide n'est pas permise partout (JSON Schema draft 4).
const schema = (/** @type {Record<string, unknown>} */ proprietes, /** @type {string[]} */ requis = []) => ({
  type: /** @type {"object"} */ ("object"), properties: proprietes, ...(requis.length ? { required: requis } : {}), additionalProperties: false,
});

const nb = (/** @type {number} */ n, /** @type {string} */ mot) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const accordees = (/** @type {number} */ n, /** @type {string} */ mot) => `${mot}${n > 1 ? "s" : ""}`;

/**
 * Des outils pour Claude, au format de sample.d.ts ({ name, description,
 * inputSchema, execute }), qui travaillent sur une COPIE de l'idée :
 * transposer (des notes, ou toute l'idée avec ses accords et sa tonalité),
 * étirer, poser des accords, ajouter ou effacer des notes, recaler, à
 * l'envers, miroir. Ce sont les gestes de sequence.js : Claude fait ce que
 * ferait Adrien. Chaque `execute` rend peu de chose (ce qui est fait et la
 * taille de la copie) et lève une Error en français sur une entrée
 * invalide : Claude la lit et corrige. Un geste qui ferait se chevaucher
 * deux notes de même hauteur, ou déborder l'idée, est défait avant
 * l'erreur : la copie reste jouable.
 *
 * `copie()` rend l'état final, à passer à valider (options.copie).
 * Options : `max`, combien d'outils au plus (sample.limits().tools.maxCount ;
 * les premiers sont les plus utiles) ; `surGeste(fait)`, appelé après
 * chaque geste réussi, pour que l'écran montre où en est Claude (un appel
 * avec outils fait plusieurs tours, de 30 à 90 secondes).
 * @param {Sequence} idee
 * @param {{ max?: number, surGeste?: (fait: string) => void }} [options]
 */
export function outilsSurCopie(idee, { max = Infinity, surGeste = () => {} } = {}) {
  let etat = cloner(idee);
  const ppm = pasParMesure(idee), ppt = pasParTemps(idee);
  const w = enPas(idee).finLibre;
  const verifier = (/** @type {unknown} */ entree, /** @type {string[]} */ permis, /** @type {string[]} */ requis = []) => {
    const e = champs(entree ?? {}, permis, requis, "entrée") || formeSure(entree ?? {});
    if (e) throw new Error(`${e} (permis : ${permis.join(", ")}).`);
    return /** @type {Record<string, any>} */ (entree ?? {});
  };
  const pisteDe = (/** @type {unknown} */ v) => {
    if (v === undefined) return 0;
    if (!entierDans(v, 1, etat.pistes.length)) throw new Error(`piste : de 1 à ${etat.pistes.length}.`);
    return /** @type {number} */ (v) - 1;
  };
  /** Les notes d'une piste qui commencent dans [debut, fin[. */
  const choisir = (/** @type {Record<string, any>} */ e) => {
    const p = pisteDe(e.piste);
    if (e.debut !== undefined && !entierDans(e.debut, 0, w)) throw new Error(`debut : un pas de 0 à ${w}.`);
    if (e.fin !== undefined && !entierDans(e.fin, 1, w)) throw new Error(`fin : un pas de 1 à ${w}.`);
    const debut = e.debut ?? 0, fin = e.fin ?? w;
    const ids = etat.pistes[p].notes.filter((n) => n.d >= debut && n.d < fin).map((n) => n.id);
    if (!ids.length) throw new Error(`Aucune note de la piste ${p + 1} ne commence entre les pas ${debut} et ${fin}.`);
    return { p, ids };
  };
  const resume = (/** @type {string} */ fait) => {
    const notes = etat.pistes.reduce((t, x) => t + x.notes.length, 0);
    return { fait, notes, mesures: Math.max(1, Math.ceil(finSequence(etat) / ppm)), tonalite: etat.tonalite };
  };
  /**
   * Fait un geste ; s'il abîme la copie, le défait et le dit à Claude. Un
   * appel arrêté par Adrien ne touche plus à rien (sample.d.ts : vérifier
   * `signal.aborted` avant d'agir).
   */
  const geste = (/** @type {{ signal?: AbortSignal } | undefined} */ contexte, /** @type {() => string} */ f) => {
    if (contexte && contexte.signal && contexte.signal.aborted) throw new Error("Rien n'est fait : Adrien a arrêté la demande.");
    const sauve = cloner(etat), avant = chevauchements(etat);
    let fait;
    try {
      fait = f();
    } catch (erreur) {
      etat = sauve;
      throw new Error(`Rien n'est fait : ${erreur && erreur.message ? erreur.message : "le geste a échoué"}.`, { cause: erreur });
    }
    let raison = null;
    if (chevauchements(etat) > avant) raison = "deux notes de même hauteur se chevaucheraient";
    else if (finSequence(etat) > w) raison = `l'idée dépasserait le pas ${w}`;
    if (raison) { etat = sauve; throw new Error(`Rien n'est fait : ${raison}. Choisis d'autres notes ou un autre réglage.`); }
    try { surGeste(fait); } catch { /* l'écran qui suit Claude ne doit pas faire échouer son geste */ }
    return resume(fait);
  };

  /** @type {{ name: string, description: string, inputSchema: object, execute: (entree: Record<string, unknown>, contexte?: { signal?: AbortSignal }) => unknown }[]} */
  const outils = [
    {
      name: "transposer_idee",
      description: "Transpose toute la copie (toutes les pistes, les accords et la tonalité) de « demiTons » demi-tons : pour changer de tonalité (de do en ré : 2). Rend ce qui est fait, la nouvelle tonalité et la taille de la copie.",
      inputSchema: schema({ demiTons: { type: "integer", minimum: -12, maximum: 12, description: "De -12 à 12, sauf 0." } }, ["demiTons"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["demiTons"], ["demiTons"]);
        if (!entierDans(e.demiTons, -12, 12) || e.demiTons === 0) throw new Error("demiTons : un entier de -12 à 12, sauf 0.");
        return geste(contexte, () => {
          transposerIdee(etat, e.demiTons);
          const n = Math.abs(e.demiTons);
          return `toute l'idée ${e.demiTons > 0 ? "montée" : "descendue"} de ${nb(n, "demi-ton")}, en ${nomTonalite(etat.tonalite).toLowerCase()}`;
        });
      },
    },
    {
      name: "transposer",
      description: "Monte ou descend des notes d'une piste de la copie de « demiTons » demi-tons (12 = une octave), sans changer la tonalité ni les accords. Sans debut ni fin : toute la piste. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ demiTons: { type: "integer", minimum: -24, maximum: 24, description: "De -24 à 24, sauf 0." }, ...PORTEE }, ["demiTons"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["demiTons", "piste", "debut", "fin"], ["demiTons"]);
        if (!entierDans(e.demiTons, -24, 24) || e.demiTons === 0) throw new Error("demiTons : un entier de -24 à 24, sauf 0.");
        const { p, ids } = choisir(e);
        return geste(contexte, () => {
          transposer(etat, p, ids, e.demiTons);
          return `${nb(ids.length, "note")} ${accordees(ids.length, e.demiTons > 0 ? "montée" : "descendue")} de ${nb(Math.abs(e.demiTons), "demi-ton")}`;
        });
      },
    },
    {
      name: "etirer",
      description: "Double les durées (facteur 2 : plus lent) ou les divise par deux (0.5 : plus vite), à partir de la première note choisie ; ce qui suit sur la piste se décale d'autant. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ facteur: { type: "number", enum: [2, 0.5], description: "2 ou 0.5." }, ...PORTEE }, ["facteur"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["facteur", "piste", "debut", "fin"], ["facteur"]);
        if (e.facteur !== 2 && e.facteur !== 0.5) throw new Error("facteur : 2 ou 0.5.");
        const { p, ids } = choisir(e);
        return geste(contexte, () => { etirer(etat, p, ids, e.facteur); return `${nb(ids.length, "note")} ${e.facteur === 2 ? "deux fois plus lentes" : "deux fois plus rapides"}`; });
      },
    },
    {
      name: "poser_accords",
      description: `Pose des accords (mesure et temps comptés de 1, ${ppm / ppt} temps par mesure ; noms à l'anglaise : C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B). Dans chaque mesure citée, ils remplacent ceux qui y étaient ; un accord sonne jusqu'au suivant. Rend ce qui est fait et la taille de la copie.`,
      inputSchema: schema({
        accords: {
          type: "array", minItems: 1, maxItems: 64,
          items: schema({ mesure: { type: "integer", minimum: 1 }, temps: { type: "integer", minimum: 1, maximum: ppm / ppt }, nom: { type: "string" } }, ["mesure", "temps", "nom"]),
        },
      }, ["accords"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["accords"], ["accords"]);
        const derniere = w / ppm;
        if (!Array.isArray(e.accords) || !e.accords.length || e.accords.length > 64) throw new Error("accords : de 1 à 64 accords.");
        /** @type {Accord[]} */
        const lus = [];
        for (const [i, a] of e.accords.entries()) {
          const ea = champs(a, ["mesure", "temps", "nom"], ["mesure", "temps", "nom"], `accords[${i}]`);
          if (ea) throw new Error(`${ea}.`);
          if (!entierDans(a.mesure, 1, derniere)) throw new Error(`accords[${i}].mesure : de 1 à ${derniere}.`);
          if (!entierDans(a.temps, 1, ppm / ppt)) throw new Error(`accords[${i}].temps : de 1 à ${ppm / ppt}.`);
          const nom = nomDAccord(a.nom);
          if (!nom) throw new Error(`accords[${i}].nom : « ${String(a.nom).slice(0, 24)} » ne se lit pas ; par exemple C, Am, F#m7, Bb, G7, Dsus4, Cmaj7, Em/B.`);
          const d = (a.mesure - 1) * ppm + (a.temps - 1) * ppt;
          if (lus.some((y) => y.d === d)) throw new Error(`accords[${i}] : deux accords au même temps.`);
          lus.push({ d, nom });
        }
        return geste(contexte, () => {
          // Mesure après mesure, dans l'ordre : un accord posé au 3ᵉ temps laisse sonner avant lui celui
          // que Claude vient de poser à la mesure d'avant, pas l'ancien.
          const mesures = [...new Set(lus.map((a) => Math.floor(a.d / ppm)))].sort((a, b) => a - b);
          for (const m of mesures) poserAccords(etat, lus.filter((a) => Math.floor(a.d / ppm) === m), m * ppm, (m + 1) * ppm);
          return `${nb(lus.length, "accord")} ${accordees(lus.length, "posé")}`;
        });
      },
    },
    {
      name: "ajouter_notes",
      description: "Ajoute des notes à une piste de la copie (debut et duree en pas depuis le début de l'idée, hauteur MIDI de 21 à 108, 60 = do central) ; rien d'autre ne bouge. Deux notes de même hauteur ne se chevauchent pas. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({
        notes: {
          type: "array", minItems: 1, maxItems: 256,
          items: schema({ debut: { type: "integer", minimum: 0 }, duree: { type: "integer", minimum: 1 }, hauteur: { type: "integer", minimum: BORNES.bas, maximum: BORNES.haut } }, ["debut", "duree", "hauteur"]),
        },
        piste: PORTEE.piste,
      }, ["notes"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["notes", "piste"], ["notes"]);
        const p = pisteDe(e.piste);
        const lues = lireNotes(e.notes, { fenetre: [0, w], tessiture: BORNES, max: 256 });
        if (lues.raison) throw new Error(`${lues.raison}.`);
        const ch = chevauchement(lues.notes, etat.pistes[p].notes);
        if (ch) throw new Error(`${ch}.`);
        return geste(contexte, () => {
          for (const n of lues.notes) poser(etat, p, { d: n.d, l: n.l, h: n.h });
          return `${nb(lues.notes.length, "note")} ${accordees(lues.notes.length, "ajoutée")}`;
        });
      },
    },
    {
      name: "effacer_notes",
      description: "Efface des notes d'une piste de la copie : celles qui commencent entre debut et fin, et seulement de ces hauteurs MIDI si « hauteurs » est donné ; le reste ne bouge pas. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE, hauteurs: { type: "array", minItems: 1, maxItems: 88, items: { type: "integer", minimum: BORNES.bas, maximum: BORNES.haut } } }),
      execute: (x, contexte) => {
        const e = verifier(x, ["piste", "debut", "fin", "hauteurs"]);
        const choix = choisir(e);
        const p = choix.p;
        let ids = choix.ids;
        if (e.hauteurs !== undefined) {
          if (!Array.isArray(e.hauteurs) || !e.hauteurs.length || e.hauteurs.length > 88 || !e.hauteurs.every((h) => entierDans(h, BORNES.bas, BORNES.haut))) throw new Error("hauteurs : des hauteurs MIDI de 21 à 108.");
          const voulues = new Set(e.hauteurs), gardes = new Set(ids);
          ids = etat.pistes[p].notes.filter((n) => gardes.has(n.id) && voulues.has(n.h)).map((n) => n.id);
          if (!ids.length) throw new Error("Aucune note de ces hauteurs à cet endroit.");
        }
        return geste(contexte, () => { effacer(etat, p, ids, { decaler: false }); return `${nb(ids.length, "note")} ${accordees(ids.length, "effacée")}`; });
      },
    },
    {
      name: "recaler",
      description: "Recale débuts et durées de notes sur une grille, en pas (1 = double croche, 2 = croche, 4 = noire, 8 = blanche). Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ grille: { type: "integer", enum: [1, 2, 4, 8], description: "La grille, en pas." }, ...PORTEE }, ["grille"]),
      execute: (x, contexte) => {
        const e = verifier(x, ["grille", "piste", "debut", "fin"], ["grille"]);
        if (![1, 2, 4, 8].includes(e.grille)) throw new Error("grille : 1, 2, 4 ou 8 pas.");
        const { p, ids } = choisir(e);
        return geste(contexte, () => { recaler(etat, p, ids, e.grille); return `${nb(ids.length, "note")} ${accordees(ids.length, "recalée")} sur ${e.grille} pas`; });
      },
    },
    {
      name: "a_l_envers",
      description: "Joue des notes à l'envers (rétrograde) : la dernière devient la première, au même endroit. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE }),
      execute: (x, contexte) => {
        const e = verifier(x, ["piste", "debut", "fin"]);
        const { p, ids } = choisir(e);
        return geste(contexte, () => { retrograder(etat, p, ids); return `${nb(ids.length, "note")} à l'envers`; });
      },
    },
    {
      name: "miroir",
      description: "Renverse des notes en miroir autour de la première : ce qui montait descend, du même intervalle. Rend ce qui est fait et la taille de la copie.",
      inputSchema: schema({ ...PORTEE }),
      execute: (x, contexte) => {
        const e = verifier(x, ["piste", "debut", "fin"]);
        const { p, ids } = choisir(e);
        return geste(contexte, () => { renverser(etat, p, ids); return `${nb(ids.length, "note")} en miroir`; });
      },
    },
  ];
  return { outils: outils.slice(0, Math.max(0, max)), copie: () => cloner(etat) };
}
