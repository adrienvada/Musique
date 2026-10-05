/**
 * LA BIBLIOTHÈQUE SYNCHRONISÉE, CÔTÉ CONNECTEUR
 *
 * Chaque appareil garde toute la bibliothèque dans son navigateur (hors
 * ligne compris) ; le connecteur en garde la référence commune, en objets
 * JSON dans le stockage Supabase :
 *   bibliotheque/<id>.json     { id, donnees, modifieLe, supprime, pagesLe, rev }
 *   pages/<id>.json            les traits, compactés (lourds : à part), ou le mémo
 *   versions/<id>/<date>-r<rev>.json  les versions précédentes : 20 au plus, 30 jours (D6)
 *   corbeille/<id>.json        ce qui a été supprimé : { id, titre, type,
 *                              supprimeLe, modifieLe et rev (la version d'avant) }, 30 jours
 *   verrous/<id>.json          le temps d'une écriture : une seule à la fois
 *                              par partition (S9)
 * À côté, suggestions/<id>/… (suggestions.js) : ce que Claude propose pour
 * une partition. Elles partent avec elle quand elle quitte la corbeille.
 *
 * Écriture conditionnelle (D4) : l'appareil dit de quelle version il part
 * (`base` : son modifieLe ; null pour une partition neuve). Si la référence a
 * changé depuis, l'écriture est refusée avec la version actuelle : l'appareil
 * fusionne et renvoie. Sans `base` (un appareil d'avant le 04/10), le plus
 * récent gagne, comme avant. Une partition supprimée laisse une « pierre
 * tombale » (supprime: true) pour que les autres appareils la suppriment
 * aussi ; son contenu reste 30 jours dans la corbeille.
 *
 * Un appareil demande « ce qui a changé depuis mon curseur » : le curseur
 * est la date d'écriture du stockage (son horloge, pas celle des appareils).
 * On relit les 10 secondes d'avant : une écriture datée juste avant le
 * curseur mais visible juste après n'est plus sautée (S10). L'appareil
 * reconnaît ce qu'il a déjà.
 *
 * Chaque écriture est vérifiée avant d'être rangée (S4, S6) : identifiant,
 * date ISO pas plus d'un jour dans le futur, types de base, 256 Ko de fiche
 * et 5 Mo de pages au plus. Un refus n'est pas une erreur : la réponse
 * { accepte: false, refus } dit pourquoi, et l'appareil met la partition de
 * côté sans bloquer les autres.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;
const PARALLELE = 12;
const JOUR = 24 * 3600 * 1000;

export const LIMITES = {
  // Comme un document de la base de claude.ai : une fiche passe partout, ou nulle part.
  donnees: 256 * 1024,
  // Un mémo d'une minute (1,3 Mo en base64 même quand Safari ignore le débit demandé), ou des pages de traits denses.
  pages: 5 * 1024 * 1024,
  // Une horloge en avance de plus d'un jour : sa date gagnerait tout, longtemps.
  futur: JOUR,
  versions: 20,
  garde: 30 * JOUR,
  recouvrement: 10 * 1000,
  // Un verrou plus vieux vient d'une écriture coupée en route : on le lève.
  verrou: 30 * 1000,
  attente: 5000,
};

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
const octets = (texte) => new TextEncoder().encode(texte).length;
/** L'instant d'une date ISO, ou null si ce n'en est pas une (« zzz »). */
const instant = (x) => {
  if (typeof x !== "string" || !DATE_ISO.test(x)) return null;
  const t = Date.parse(x);
  return Number.isFinite(t) ? t : null;
};
/**
 * Le nom d'objet d'une version : sa date sans ponctuation, puis son numéro
 * de révision (2026-10-04T10:15:00.123Z, rev 7 → 20261004T101500123Z-r7). La
 * date seule ne suffit pas : deux appareils dont l'horloge retarde datent
 * tous deux « la version d'avant + 1 ms ».
 */
const dateCompacte = (modifieLe) => String(modifieLe).replace(/[^0-9A-Za-z]/g, "").slice(0, 40);
const nomDeVersion = (f) => `${dateCompacte(f.modifieLe)}-r${Number.isInteger(f.rev) ? f.rev : 0}`;
function lireNomDeVersion(nom) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-r(\d+)\.json$/.exec(nom);
  return m ? { modifieLe: `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.${m[7]}Z`, rev: Number(m[8]) } : null;
}

// Les types de base d'une fiche : de quoi arrêter une fiche empoisonnée (des
// étiquettes qui ne sont pas une liste vidaient le carnet), sans juger le
// détail, que l'appli remet en forme à la réception. null vaut absent.
const TYPES = {
  titre: "texte", type: "texte", statut: "texte", abc: "texte", abcLu: "texte", note: "texte", modele: "texte",
  creeLe: "texte", modifieLe: "texte", etiquettes: "textes", favori: "booleen", memo: "objet", sequence: "objet",
  doutes: "liste", blocs: "liste", apercu: "liste", tempo: "nombre", transposition: "nombre", nbPages: "nombre",
};
const VERIFS = {
  texte: (v) => typeof v === "string",
  textes: (v) => Array.isArray(v) && v.every((x) => typeof x === "string"),
  booleen: (v) => typeof v === "boolean",
  objet: (v) => typeof v === "object" && !Array.isArray(v),
  liste: (v) => Array.isArray(v),
  nombre: (v) => typeof v === "number" && Number.isFinite(v),
};
function champMalForme(d) {
  for (const [k, t] of Object.entries(TYPES)) if (d[k] !== undefined && d[k] !== null && !VERIFS[t](d[k])) return k;
  if (d.sequence && !Array.isArray(d.sequence.pistes)) return "sequence.pistes";
  if (d.memo && d.memo.duree !== undefined && !VERIFS.nombre(d.memo.duree)) return "memo.duree";
  return null;
}
const pageValide = (p) => Array.isArray(p)
  ? p.every((t) => Array.isArray(t) && t.every((n) => typeof n === "number" && Number.isFinite(n)))
  : !!p && typeof p === "object" && !!p.memo && typeof p.memo === "object" && typeof p.memo.base64 === "string";

/** Ce qui ne va pas dans une écriture, ou null si elle peut être rangée. */
export function verifierEcriture(args, maintenant = Date.now()) {
  if (!args || typeof args !== "object") return "Il faut les arguments de l'écriture.";
  const { id, donnees, pages, supprime, modifieLe, base, baseRev } = args;
  if (typeof id !== "string" || !ID.test(id)) return "Identifiant de partition invalide.";
  if (supprime !== undefined && supprime !== null && typeof supprime !== "boolean") return "« supprime » doit valoir true ou false.";
  const t = instant(modifieLe);
  if (t === null) return "Il faut la date de modification (modifieLe), en date ISO.";
  if (t > maintenant + LIMITES.futur) return "La date de modification est à plus d'un jour dans le futur : l'horloge de cet appareil est sans doute déréglée.";
  if (base !== undefined && base !== null && instant(base) === null) return "La version de départ (base) doit être une date ISO, ou null.";
  if (baseRev !== undefined && baseRev !== null && !(Number.isInteger(baseRev) && baseRev >= 0)) return "Le numéro de la version de départ (baseRev) doit être un entier.";
  if (!supprime) {
    if (!donnees || typeof donnees !== "object" || Array.isArray(donnees)) return "Il faut les données de la partition.";
    const taille = octets(JSON.stringify(donnees));
    if (taille > LIMITES.donnees) return `La partition est trop lourde (${Math.ceil(taille / 1024)} Ko, 256 Ko au plus).`;
    const champ = champMalForme(donnees);
    if (champ) return `Partition mal formée (champ « ${champ} »).`;
  }
  if (pages !== undefined && pages !== null) {
    if (!Array.isArray(pages)) return "Les pages doivent être une liste.";
    const taille = octets(JSON.stringify(pages));
    if (taille > LIMITES.pages) return `Les pages sont trop lourdes (${(taille / 1048576).toFixed(1)} Mo, 5 Mo au plus).`;
    if (!pages.every(pageValide)) return "Une page est mal formée (des traits en nombres, ou un mémo).";
  }
  return null;
}

export class Bibliotheque {
  /** `maintenant` : l'horloge du connecteur (les tests la déplacent pour voir passer 30 jours). */
  constructor(objets, { maintenant = () => Date.now() } = {}) {
    this.objets = objets;
    this.maintenant = maintenant;
  }

  /** Les fiches écrites après `depuis` (toutes si absent), relues avec 10 s de recouvrement, et le nouveau curseur. */
  async changements(depuis = null) {
    const liste = await this.objets.lister("bibliotheque");
    const t = instant(depuis); // un curseur illisible : on repart du début
    const seuil = t === null ? null : t - LIMITES.recouvrement;
    let curseur = t === null ? null : depuis, plusTard = t;
    for (const o of liste) {
      const m = Date.parse(o.maj);
      if (Number.isFinite(m) && (plusTard === null || m > plusTard)) { curseur = o.maj; plusTard = m; }
    }
    // Un objet sans date lisible est toujours relu : mieux vaut deux fois que jamais.
    const nouvelles = liste.filter((o) => seuil === null || !(Date.parse(o.maj) <= seuil));
    const fiches = await enParallele(nouvelles, (o) => this.objets.lire(`bibliotheque/${o.nom}`));
    return { partitions: fiches.filter(Boolean), curseur: curseur || null };
  }

  async pages(id) {
    verifierId(id);
    return (await this.objets.lire(`pages/${id}.json`)) || [];
  }

  /**
   * Écrit une partition (ou sa suppression). Rend { accepte: true, fiche },
   * ou { accepte: false, actuelle } (la référence a une autre version :
   * fusionner et renvoyer), ou { accepte: false, refus } (écriture invalide).
   * `base` : le modifieLe de la version d'où part l'écriture (null : la
   * partition ne doit pas exister) ; `baseRev`, son numéro, quand l'appareil
   * le connaît : c'est lui qui départage deux versions de même date.
   */
  async ecrire(args = {}) {
    const refus = verifierEcriture(args, this.maintenant());
    if (refus) return { accepte: false, refus };
    const { id, donnees = null, pages = null, modifieLe } = args;
    const supprime = args.supprime === true;
    const conditionnelle = Object.prototype.hasOwnProperty.call(args, "base");
    const liberer = await this.verrouiller(id);
    try {
      const actuelle = await this.objets.lire(`bibliotheque/${id}.json`);
      const autreVersion = (a) => a.modifieLe !== args.base || (Number.isInteger(args.baseRev) && Number.isInteger(a.rev) && a.rev !== args.baseRev);
      if (conditionnelle ? actuelle && autreVersion(actuelle) : actuelle && actuelle.modifieLe > modifieLe) {
        return { accepte: false, actuelle };
      }
      const ecritLe = new Date(this.maintenant()).toISOString();
      // La version d'avant est gardée : on peut y revenir pendant 30 jours (D6).
      if (actuelle) await this.objets.ecrire(`versions/${id}/${nomDeVersion(actuelle)}.json`, actuelle);
      // Les traits d'une partition supprimée restent, avec la corbeille : elle peut revenir entière.
      if (!supprime && pages) await this.objets.ecrire(`pages/${id}.json`, pages);
      const fiche = {
        id,
        donnees: supprime ? null : donnees,
        modifieLe,
        supprime,
        pagesLe: pages && !supprime ? modifieLe : (actuelle && actuelle.pagesLe) || null,
        rev: (Number.isInteger(actuelle && actuelle.rev) ? actuelle.rev : 0) + 1,
      };
      await this.objets.ecrire(`bibliotheque/${id}.json`, fiche);
      if (supprime && actuelle && !actuelle.supprime) {
        const d = actuelle.donnees || {};
        await this.objets.ecrire(`corbeille/${id}.json`, {
          id, titre: typeof d.titre === "string" ? d.titre : "Sans titre", type: typeof d.type === "string" ? d.type : null,
          supprimeLe: ecritLe, modifieLe: actuelle.modifieLe, rev: Number.isInteger(actuelle.rev) ? actuelle.rev : 0,
        });
      } else if (!supprime && actuelle && actuelle.supprime) {
        await this.objets.supprimer(`corbeille/${id}.json`);
      }
      // On élague en écrivant : l'historique reste loin du quota gratuit (1 Go), sans tâche à part.
      if (supprime || fiche.rev % 5 === 0) await this.elaguer(id).catch(() => {});
      if (supprime || fiche.rev % 10 === 0) await this.elaguerCorbeille(id).catch(() => {});
      return { accepte: true, fiche };
    } finally {
      await liberer();
    }
  }

  /**
   * Une seule écriture à la fois par partition : sans verrou, deux écritures
   * simultanées lisaient la même version puis écrivaient chacune, et la plus
   * ancienne pouvait gagner (S9). Le verrou est un objet créé « seulement
   * s'il n'existe pas » : le stockage ne laisse qu'une création réussir.
   */
  async verrouiller(id) {
    if (typeof this.objets.creer !== "function") return async () => {};
    const chemin = `verrous/${id}.json`;
    const debut = this.maintenant();
    for (let essai = 0; ; essai++) {
      if (await this.objets.creer(chemin, { le: new Date(this.maintenant()).toISOString() })) {
        return () => this.objets.supprimer(chemin).catch(() => {});
      }
      if (this.maintenant() - debut > LIMITES.attente || essai > 100) {
        throw new Error("La bibliothèque commune enregistre déjà cette partition : réessaie dans un instant.");
      }
      const v = await this.objets.lire(chemin);
      if (v && !(Date.parse(v.le) > this.maintenant() - LIMITES.verrou)) { await this.objets.supprimer(chemin); continue; }
      await attendre(80 + Math.random() * 120);
    }
  }

  /** Les versions précédentes d'une partition : 20 au plus, et rien de plus de 30 jours. */
  async elaguer(id) {
    const liste = (await this.objets.lister(`versions/${id}`)).sort((a, b) => b.nom.localeCompare(a.nom));
    const limite = this.maintenant() - LIMITES.garde;
    const vieilles = liste.filter((o, i) => i >= LIMITES.versions || Date.parse(o.maj) < limite);
    await enParallele(vieilles, (o) => this.objets.supprimer(`versions/${id}/${o.nom}`));
  }

  /**
   * La corbeille : au bout de 30 jours, une partition supprimée part pour de
   * bon, et avec elle ses traits, ses versions et les suggestions que Claude
   * avait rangées pour elle (suggestions.js) : sans la partition, personne ne
   * les appliquerait plus, et elles resteraient dans le stockage pour rien.
   */
  async elaguerCorbeille(sauf = null) {
    const limite = this.maintenant() - LIMITES.garde;
    for (const o of await this.objets.lister("corbeille")) {
      const id = o.nom.replace(/\.json$/, "");
      if (!(Date.parse(o.maj) < limite) || !ID.test(id) || id === sauf) continue;
      const liberer = await this.verrouiller(id);
      try {
        const tete = await this.objets.lire(`bibliotheque/${id}.json`);
        // Revenue entre-temps : seule l'entrée de la corbeille part ; ses suggestions restent.
        if (tete && tete.supprime) {
          await this.objets.supprimer(`pages/${id}.json`);
          await this.viderDossier(`versions/${id}`);
          await this.viderDossier(`suggestions/${id}`);
        }
        await this.objets.supprimer(`corbeille/${id}.json`);
      } finally {
        await liberer();
      }
    }
  }

  /** Supprime tous les objets d'un dossier. */
  async viderDossier(dossier) {
    const objets = await this.objets.lister(dossier);
    await enParallele(objets, (o) => this.objets.supprimer(`${dossier}/${o.nom}`));
  }

  /** Les versions d'une partition, la plus récente d'abord : [{ modifieLe, rev, ecritLe, supprime, actuelle }]. */
  async versions(id) {
    verifierId(id);
    const [tete, liste] = await Promise.all([this.objets.lire(`bibliotheque/${id}.json`), this.objets.lister(`versions/${id}`)]);
    // Une version gardée ne dit pas, par son nom, si c'était une suppression : `supprime` est facultatif.
    /** @type {Array<{ modifieLe: string, rev: number | null, ecritLe?: string, supprime?: boolean, actuelle: boolean }>} */
    const sortie = tete ? [{ modifieLe: tete.modifieLe, rev: Number.isInteger(tete.rev) ? tete.rev : null, supprime: !!tete.supprime, actuelle: true }] : [];
    for (const o of liste) {
      const v = lireNomDeVersion(o.nom);
      if (v && !(tete && tete.modifieLe === v.modifieLe && (tete.rev ?? 0) === v.rev)) sortie.push({ ...v, ecritLe: o.maj, actuelle: false });
    }
    return sortie.sort((a, b) => b.modifieLe.localeCompare(a.modifieLe) || (b.rev ?? 0) - (a.rev ?? 0));
  }

  /**
   * Une version d'une partition (la fiche entière, données comprises), ou
   * null. Deux versions de même date : `rev` les départage ; sans lui, la
   * plus récente des deux.
   */
  async version(id, modifieLe, rev = null) {
    verifierId(id);
    if (instant(modifieLe) === null) throw new Error("Il faut la date de la version (modifieLe), en date ISO.");
    const tete = await this.objets.lire(`bibliotheque/${id}.json`);
    if (tete && tete.modifieLe === modifieLe && (rev === null || (tete.rev ?? 0) === rev)) return tete;
    if (Number.isInteger(rev)) return (await this.objets.lire(`versions/${id}/${nomDeVersion({ modifieLe, rev })}.json`)) || null;
    const candidates = (await this.objets.lister(`versions/${id}`)).map((o) => ({ o, v: lireNomDeVersion(o.nom) })).filter(({ v }) => v && v.modifieLe === modifieLe);
    if (!candidates.length) return null;
    const { o } = candidates.sort((a, b) => b.v.rev - a.v.rev)[0];
    return (await this.objets.lire(`versions/${id}/${o.nom}`)) || null;
  }

  /** Ce qui a été supprimé depuis moins de 30 jours, le plus récent d'abord. */
  async corbeille() {
    const limite = this.maintenant() - LIMITES.garde;
    const entrees = await enParallele((await this.objets.lister("corbeille")).filter((o) => Date.parse(o.maj) >= limite), (o) => this.objets.lire(`corbeille/${o.nom}`));
    return entrees
      .filter((e) => e && typeof e.id === "string")
      .map((e) => ({ ...e, expireLe: new Date(Date.parse(e.supprimeLe) + LIMITES.garde).toISOString() }))
      .sort((a, b) => String(b.supprimeLe).localeCompare(String(a.supprimeLe)));
  }
}

function verifierId(id) {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Identifiant de partition invalide.");
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
