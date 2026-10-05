/**
 * LES SUGGESTIONS DE CLAUDE, RANGÉES À CÔTÉ DES PARTITIONS
 *
 * Dans une conversation, Claude peut proposer des accords, une suite, une
 * variation ou un mot (un titre, une réponse à un doute) pour une
 * partition d'Adrien. La proposition ne touche jamais la partition : elle
 * est rangée à part, dans le même compartiment privé que la bibliothèque,
 *   suggestions/<partition>/<suggestion>.json
 * et c'est Adrien qui l'applique d'un geste dans Portée, ou l'écarte. Ainsi
 * rien de ce que Claude écrit ne peut abîmer une partition, ni se mêler à
 * la synchronisation. Quand une partition part pour de bon (30 jours dans la
 * corbeille), ses suggestions partent avec elle (bibliotheque.js).
 *
 * Le contenu est vérifié par l'outil qui l'écrit (conversation.js) ; ici, on
 * range et on relit.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/; // ni « / » ni « .. » : l'id devient un nom de fichier
const PARALLELE = 6;

/** Un identifiant de suggestion : « s », l'heure en base 36, cinq caractères au hasard. */
export function nouveauSid() {
  return "s" + Date.now().toString(36) + hasard(5);
}

/** `n` caractères en base 36, tirés par WebCrypto (Math.random peut en donner moins). */
export function hasard(n) {
  const octets = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(octets, (o) => (o % 36).toString(36)).join("");
}

export function verifierIdentifiant(id, quoi = "Identifiant") {
  if (typeof id !== "string" || !ID.test(id)) throw new Error(`${quoi} invalide : des lettres, des chiffres, « - » ou « _ », 64 au plus.`);
}

export class Suggestions {
  constructor(objets) {
    this.objets = objets;
  }

  /** Range une suggestion déjà vérifiée ; rend sa fiche. */
  async ecrire({ cible, genre, contenu, pourquoi }) {
    verifierIdentifiant(cible, "Identifiant de partition");
    const fiche = { sid: nouveauSid(), cible, genre, contenu, pourquoi, creeLe: new Date().toISOString(), auteur: "claude" };
    await this.objets.ecrire(`suggestions/${cible}/${fiche.sid}.json`, fiche);
    return fiche;
  }

  /** Les suggestions d'une partition, ou de toutes ; les plus récentes d'abord. */
  async lister(cible = null) {
    if (cible !== null) verifierIdentifiant(cible, "Identifiant de partition");
    const dossiers = cible !== null ? [cible] : (await this.objets.listerDossiers("suggestions")).filter((d) => ID.test(d));
    const chemins = [];
    for (const d of dossiers) {
      for (const o of await this.objets.lister(`suggestions/${d}`)) chemins.push(`suggestions/${d}/${o.nom}`);
    }
    const fiches = await enParallele(chemins, (c) => this.objets.lire(c).catch(() => null));
    return fiches.filter((f) => f && f.sid).sort((a, b) => (b.creeLe || "").localeCompare(a.creeLe || ""));
  }

  /** Retire une suggestion ; `retiree` dit si elle existait (le refaire ne fait rien). */
  async retirer(cible, sid) {
    verifierIdentifiant(cible, "Identifiant de partition");
    verifierIdentifiant(sid, "Identifiant de suggestion");
    const chemin = `suggestions/${cible}/${sid}.json`;
    if (!(await this.objets.lire(chemin))) return { retiree: false };
    await this.objets.supprimer(chemin);
    return { retiree: true };
  }
}

async function enParallele(liste, f) {
  const sortie = new Array(liste.length);
  let suivant = 0;
  await Promise.all(Array.from({ length: Math.min(PARALLELE, liste.length) }, async () => {
    while (suivant < liste.length) {
      const i = suivant++;
      sortie[i] = await f(liste[i], i);
    }
  }));
  return sortie;
}
