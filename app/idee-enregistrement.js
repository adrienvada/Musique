/**
 * L'IDÉE DANS LA BIBLIOTHÈQUE : SES ENREGISTREMENTS
 *
 * L'éditeur enregistre tout seul, un instant après le dernier geste
 * (enregistreur.js). Une idée neuve se crée à sa première note (vide, elle
 * ne laisse rien), puis se modifie en disant de quelle version elle part
 * (S8 : la fusion avec ce qu'un autre onglet ou la synchro y a changé). Ce
 * qui part est une copie de l'idée prise au moment du geste, pour l'idée
 * ouverte à ce moment-là : une écriture en retard ne se trompe ni d'idée ni
 * de contenu (T4).
 *
 * Il vivait dans idee.js (audit du 04/10, T3). Sans DOM : vérifié par
 * `npm run types`, essayé sous Node (tests/idee-enregistrement.test.mjs).
 */
import * as sq from "./sequence.js";
import { voixCompletes } from "./harmonie.js";
import { creerEnregistreur } from "./enregistreur.js";
import { cause, explication } from "./erreurs.js";

/**
 * Ce que l'idée montre, copié (les gestes qui suivent ne le changent plus).
 * @param {any} e  l'état de l'éditeur
 */
export const instantane = (e) => ({ titre: e.titre, seq: sq.cloner(e.seq), note: e.note, etiquettes: [...e.etiquettes], favori: e.favori, memo: e.memo });

/**
 * Une idée sans note, sans accord, sans mot ni mémo ne s'enregistre pas.
 * @param {any} x  un instantané
 */
export const vide = (x) => x.seq.pistes.every((p) => !p.notes.length) && !(x.seq.accords || []).length && !x.memo && !x.note && !x.etiquettes.length;

/**
 * La fiche d'une idée, telle que le stockage la garde (l'ABC est écrit d'après ses notes).
 * @param {any} x  un instantané
 */
export function ficheDIdee(x) {
  const { abc } = sq.ecrireAbc(x.seq, { voix: voixCompletes(x.seq), titre: x.titre });
  return {
    type: "idee", titre: x.titre, sequence: x.seq, abc, statut: "idee", nbPages: 0, modele: null, tempo: x.seq.tempo,
    note: x.note, etiquettes: x.etiquettes, favori: x.favori, memo: x.memo,
  };
}

/**
 * @param {object} o
 * @param {any} o.e  l'état de l'éditeur : l'idée ouverte (`session`, `ouverte`) et ce
 *   qu'elle montre ; une idée neuve y reçoit son identifiant (`id`, `creeLe`)
 * @param {() => any} o.stockage  le stockage ouvert (null tant qu'il ne l'est pas)
 * @param {() => string} o.nouvelId
 * @param {(texte: string) => void} o.etat  la ligne d'état de la barre du haut (« Enregistrée »)
 * @param {(texte: string, duree?: number) => void} o.toast
 * @param {number} [o.delai]  en millisecondes, après le dernier geste
 */
export function creerEnregistrementIdee({ e, stockage, nouvelId, etat, toast, delai = 700 }) {
  /** Une idée neuve reçoit son identifiant : à sa première écriture, ou pour la copie de secours. */
  function nommer(s, maintenant) {
    if (s.id) return;
    s.id = nouvelId();
    s.creeLe = maintenant;
    if (s === e.session) { e.id = s.id; e.creeLe = maintenant; }
  }

  /** La copie de secours, quand la page se ferme avant l'écriture (enregistreur.js). */
  function secours(s, x) {
    if (!s.cree && vide(x)) return null;
    const maintenant = new Date().toISOString();
    nommer(s, maintenant);
    return { id: s.id, creer: !s.cree, donnees: { ...ficheDIdee(x), creeLe: s.creeLe, modifieLe: maintenant } };
  }

  /**
   * Écrit une copie de l'idée (`x`) dans son idée (`s`, la session de
   * l'ouverture où on l'a prise) : la créer à la première note, sinon la
   * modifier en disant d'où l'on part (S8).
   */
  async function ecrire(s, x) {
    const ouvert = stockage();
    if (!ouvert) return;
    const ici = () => s === e.session && e.ouverte;
    const maintenant = new Date().toISOString();
    try {
      if (!s.cree) {
        if (vide(x)) { if (ici()) etat(""); return; } // une idée vide ne s'enregistre pas
        nommer(s, maintenant);
        const fiche = { ...ficheDIdee(x), creeLe: s.creeLe, modifieLe: maintenant };
        // Écrite, elle devient la dernière version connue (les écritures se suivent : `s` n'a pas bougé).
        await ouvert.creer(s.id, fiche, []).then(() => { s.cree = true; s.derniere = fiche; });
      } else {
        const fiche = { ...ficheDIdee(x), modifieLe: maintenant };
        await ouvert.modifier(s.id, fiche, { depuis: s.derniere }).then(() => { s.derniere = fiche; });
      }
      if (ici()) etat("Enregistrée");
    } catch (err) {
      console.error(err);
      if (s !== e.session) return;
      etat("Non enregistrée : " + cause(err));
      // L'état ne se voit plus dans la barre : une erreur se dit tout haut.
      if (e.ouverte) toast(`L'idée n'a pas pu être enregistrée : ${explication(err)}`, 8000);
    }
  }

  const ecritures = creerEnregistreur({ ecrire, secours, delai, fondre: (_avant, apres) => apres });

  return {
    /** Enregistrera l'idée telle qu'elle est maintenant, `d` millisecondes après le dernier geste. */
    planifier(d = delai) {
      etat("Enregistrement…");
      ecritures.planifier(e.session, instantane(e), d);
    },
    /** Écrit tout de suite ce qui attend ; la promesse de toutes les écritures. */
    vider: () => ecritures.vider(),
    /** Une écriture attend ou part. */
    get occupe() { return ecritures.occupe; },
    /** La fiche de l'idée ouverte, pour l'exporter ou la partager (null : elle n'est pas encore enregistrée). */
    fiche() {
      if (!e.id) return null;
      return { id: e.id, ...ficheDIdee(instantane(e)), creeLe: e.creeLe };
    },
  };
}
