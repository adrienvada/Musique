/**
 * UNE ÉCOUTE À LA FOIS, PAR ÉCRAN
 *
 * Le jeton de l'écran Morceau (`const moi`), pour tous les écrans qui font
 * sonner le transport : « Corriger », « Écouter », le morceau, les cartes
 * de la bibliothèque (audit du 04/10, T3, T4). Chaque écoute porte une clé
 * (le bouton touché, le bloc écouté) : la même clé arrête, une autre clé
 * remplace. Le piano peut mettre des secondes à se télécharger : une écoute
 * arrêtée ou remplacée pendant ce temps ne part pas à son arrivée, et ce
 * que l'écran montre (« Arrêter », la tête de lecture) revient en place.
 * (Le transport tient le même jeton de son côté, depuis le lot son.)
 *
 * Sans DOM : essayé sous Node avec un faux transport (tests/ecoute.test.mjs).
 */

/**
 * @param {{ jouer: (source: any, options: any) => Promise<boolean | undefined>, arreter: () => void }} transport
 */
export function creerEcoute(transport) {
  /** @type {{ cle: any, surArret: () => void } | null} */
  let lecture = null;

  /** Ce qui sonnait (ou attendait le piano) s'arrête, et l'écran se remet en place. */
  function arreter() {
    if (!lecture) return;
    const l = lecture;
    lecture = null;
    transport.arreter();
    l.surArret();
  }

  /**
   * Fait sonner `source` sous la clé `cle` ; la même clé arrête l'écoute en cours.
   * @param {any} cle
   * @param {any} source  ce que joue le transport
   * @param {{ surDepart?: () => void, surArret?: () => void, surFin?: () => void, [k: string]: any }} [options]
   *   celles de transport.jouer, plus surDepart (la lecture part vraiment) et
   *   surArret (elle s'arrête : fin, arrêt, remplacée, ou le piano n'est pas venu)
   * @returns {Promise<boolean>} vrai si elle est partie
   */
  async function jouer(cle, source, { surDepart = () => {}, surArret = () => {}, surFin = () => {}, ...options } = {}) {
    if (lecture) {
      const meme = lecture.cle === cle;
      arreter();
      if (meme) return false;
    }
    const moi = { cle, surArret };
    lecture = moi;
    const finir = () => { if (lecture === moi) { lecture = null; surArret(); } };
    try {
      const parti = await transport.jouer(source, { ...options, surFin: () => { surFin(); finir(); } });
      if (lecture !== moi) return false;
      if (parti === false) { finir(); return false; }
      surDepart();
      return true;
    } catch (e) {
      finir();
      throw e;
    }
  }

  return {
    jouer, arreter,
    /** La clé de l'écoute en cours (ou qui attend le piano), ou null. */
    get cle() { return lecture ? lecture.cle : null; },
  };
}
