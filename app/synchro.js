/**
 * LA BIBLIOTHÈQUE SYNCHRONISÉE, CÔTÉ APPAREIL
 *
 * Chaque appareil garde toute la bibliothèque (IndexedDB) et note ce qu'il
 * change dans une file d'envois. Une synchronisation :
 *   1. envoie la file au connecteur (bibliotheque_ecrire), pages comprises
 *      quand elles sont nouvelles ;
 *   2. reçoit ce qui a changé ailleurs depuis son curseur
 *      (bibliotheque_changements), et les pages qui lui manquent.
 * Le plus récent gagne (modifieLe) ; une suppression voyage comme une
 * « pierre tombale ». Hors ligne, la file attend : rien ne se perd.
 *
 * `local` : le stockage (stockage.js) ; `appeler(outil, args)` : l'appel
 * d'un outil du connecteur, qui rend son résultat structuré.
 */
export function creerSynchro({ local, appeler, surEtat = () => {} }) {
  let enCours = null;
  let encore = false;

  /** Applique une fiche de la bibliothèque commune si elle est plus récente qu'ici. */
  async function appliquer(f) {
    const ici = await local.lire(f.id);
    if (f.supprime) {
      if (ici && !((ici.modifieLe || "") > f.modifieLe)) { await local.retirer(f.id); return true; }
      return false;
    }
    if (ici && (ici.modifieLe || "") >= f.modifieLe) return false;
    const pagesManquent = !ici || (f.pagesLe && f.pagesLe !== ici.pagesLe);
    const pages = pagesManquent ? ((await appeler("bibliotheque_pages", { id: f.id })) || {}).pages || [] : null;
    await local.recevoir(f.id, { ...f.donnees, modifieLe: f.modifieLe, pagesLe: f.pagesLe }, pages);
    return true;
  }

  async function passe() {
    let envoyees = 0, recues = 0;
    // Premier passage de cet appareil : tout ce qu'il a déjà rejoint la bibliothèque commune.
    if (!(await local.lireMeta("rejoint"))) {
      await local.toutEnvoyer();
      await local.ecrireMeta("rejoint", true);
    }

    // 1. Envoyer
    for (const e of await local.enAttente()) {
      if (e.supprime) {
        await appeler("bibliotheque_ecrire", { id: e.id, supprime: true, modifieLe: e.modifieLe });
        await local.envoye(e.id, e.modifieLe);
        envoyees++;
        continue;
      }
      const c = await local.complete(e.id);
      if (!c) { await local.envoye(e.id, e.modifieLe); continue; }
      const { pagesLe: _interne, ...donnees } = c.donnees;
      const r = await appeler("bibliotheque_ecrire", {
        id: e.id,
        donnees,
        pages: e.pages ? c.pages : null,
        modifieLe: c.donnees.modifieLe || e.modifieLe,
      });
      await local.envoye(e.id, e.modifieLe, r && r.accepte && r.fiche ? r.fiche.pagesLe : null);
      // Refusé : un autre appareil a plus récent, on le prend tout de suite.
      if (r && r.accepte === false && r.actuelle) { if (await appliquer(r.actuelle)) recues++; }
      else envoyees++;
    }

    // 2. Recevoir
    const depuis = (await local.lireMeta("curseur")) || null;
    const { partitions = [], curseur = null } = (await appeler("bibliotheque_changements", { depuis })) || {};
    const attente = new Map((await local.enAttente()).map((e) => [e.id, e]));
    for (const f of partitions) {
      // Une modification locale plus récente, pas encore envoyée, gagne.
      const enAttente = attente.get(f.id);
      if (enAttente && enAttente.modifieLe > f.modifieLe) continue;
      if (await appliquer(f)) recues++;
    }
    if (curseur) await local.ecrireMeta("curseur", curseur);
    return { envoyees, recues };
  }

  return {
    /** Une synchronisation ; si une autre est en cours, elle repassera à la fin. */
    synchroniser() {
      if (enCours) { encore = true; return enCours; }
      enCours = (async () => {
        surEtat({ etat: "encours" });
        let bilan = { envoyees: 0, recues: 0 };
        try {
          do {
            encore = false;
            const b = await passe();
            bilan = { envoyees: bilan.envoyees + b.envoyees, recues: bilan.recues + b.recues };
          } while (encore);
          surEtat({ etat: "ok", le: new Date().toISOString(), ...bilan, attente: (await local.enAttente()).length });
          return bilan;
        } catch (e) {
          surEtat({ etat: "erreur", erreur: e, attente: (await local.enAttente().catch(() => [])).length });
          throw e;
        } finally {
          enCours = null;
        }
      })();
      return enCours;
    },
  };
}
