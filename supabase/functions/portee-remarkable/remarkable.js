/**
 * CLIENT DU CLOUD REMARKABLE (lecture seule)
 *
 * Le même protocole que rmapi (ddvk, version maintenue), réduit au strict
 * nécessaire : lister l'arborescence et télécharger un document. On n'écrit
 * jamais rien dans le cloud d'Adrien.
 *
 * COMMENT LE CLOUD RANGE LES FICHIERS. Tout est un « blob » repéré par son
 * empreinte SHA-256. La racine donne l'empreinte d'un index : une ligne par
 * document ou dossier. Chaque document a lui-même un index : une ligne par
 * fichier (.metadata pour le nom et le dossier parent, .content pour l'ordre
 * des pages, .pdf pour le PDF d'origine, <id>/<page>.rm pour les traits).
 *
 * AUTHENTIFICATION. Un jeton d'appareil, obtenu une fois avec le code à
 * 8 lettres de my.remarkable.com, s'échange contre un jeton d'utilisateur
 * valable quelques heures. Le jeton d'appareil vit dans le coffre du
 * connecteur (coffre.js), jamais dans l'appli.
 */
import { traitsDePage } from "./rm.js";

const AUTH = "https://webapp-prod.cloud.remarkable.engineering";
const SYNC = "https://internal.cloud.remarkable.com";
const PARALLELE = 12;

/** Échange le code à 8 lettres de my.remarkable.com contre un jeton d'appareil. */
export async function enregistrerAppareil(code, auth = AUTH) {
  const propre = String(code || "").trim().toLowerCase();
  if (!/^[a-z]{8}$/.test(propre)) throw new Error("Le code fait 8 lettres, sans espace (my.remarkable.com/device/desktop/connect).");
  const r = await fetch(`${auth}/token/json/2/device/new`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer" },
    body: JSON.stringify({ code: propre, deviceDesc: "desktop-linux", deviceID: crypto.randomUUID() }),
  });
  const texte = (await r.text()).trim();
  if (!r.ok || !texte) throw new Error(`reMarkable refuse ce code (HTTP ${r.status}) : il a peut-être expiré, demandes-en un nouveau.`);
  return texte;
}

/** La tablette n'est pas (ou plus) reliée : il faut un nouveau code. */
export class NonReliee extends Error {
  constructor(raison) {
    super(raison === "revoquee"
      ? "reMarkable ne reconnaît plus Portée : relie à nouveau la tablette avec un nouveau code."
      : "La tablette n'est pas encore reliée à Portée.");
    this.raison = raison; // "jamais" | "revoquee"
  }
}

export class CloudRemarkable {
  /**
   * `coffre` garde le jeton d'appareil (coffre.js). `hotes` ne sert qu'aux
   * tests, pour viser un faux cloud.
   */
  constructor(coffre, hotes = {}) {
    this.coffre = coffre;
    this.auth = hotes.auth || AUTH;
    this.sync = hotes.sync || SYNC;
    this.jetonAppareil = null;
    this.jetonUtilisateur = null;
    this.metadonnees = new Map(); // empreinte d'un document → { nom, type, parent… }
  }

  /** Relie la tablette : le code devient un jeton d'appareil, rangé au coffre. */
  async relier(code) {
    const jeton = await enregistrerAppareil(code, this.auth);
    await this.coffre.ecrire(jeton);
    this.jetonAppareil = jeton;
    this.jetonUtilisateur = null;
  }

  async jeton(renouveler = false) {
    if (this.jetonUtilisateur && !renouveler) return this.jetonUtilisateur;
    this.jetonAppareil ??= await this.coffre.lire();
    if (!this.jetonAppareil) throw new NonReliee("jamais");
    const r = await fetch(`${this.auth}/token/json/2/user/new`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jetonAppareil}` },
    });
    const texte = (await r.text()).trim();
    if (r.status === 401 || r.status === 403) {
      this.jetonAppareil = null; // relu au coffre la prochaine fois : il a peut-être été remplacé
      throw new NonReliee("revoquee");
    }
    if (!r.ok) throw new Error(`Le cloud reMarkable ne répond pas (HTTP ${r.status}). Réessaie dans un moment.`);
    this.jetonUtilisateur = texte;
    return this.jetonUtilisateur;
  }

  async requete(url, entetes = {}, essai = 0) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${await this.jeton(essai > 0)}`, "user-agent": "portee", ...entetes } });
    if (!r.ok) await r.body?.cancel();
    if (r.status === 401 && essai === 0) return this.requete(url, entetes, 1);
    if (!r.ok) throw new Error(`Le cloud reMarkable répond HTTP ${r.status} pour ${entetes["rm-filename"] || url}.`);
    return r;
  }

  async racine() {
    const r = await this.requete(`${this.sync}/sync/v4/root`);
    return r.json(); // { hash, generation, schemaVersion }
  }

  async blob(empreinte, nom) {
    const r = await this.requete(`${this.sync}/sync/v3/files/${empreinte}`, { "rm-filename": nom });
    return new Uint8Array(await r.arrayBuffer());
  }

  async index(empreinte, nom) {
    return lireIndex(new TextDecoder().decode(await this.blob(empreinte, nom)));
  }

  /** Tous les dossiers et documents, sans la corbeille ni les éléments supprimés. */
  async arborescence() {
    const { hash } = await this.racine();
    const entrees = await this.index(hash, "root.docSchema");
    const noeuds = await enParallele(entrees, async (e) => {
      if (!this.metadonnees.has(e.hash)) {
        const fichiers = await this.index(e.hash, `${e.id}.docSchema`);
        const meta = fichiers.find((f) => f.id.endsWith(".metadata"));
        if (!meta) return null;
        const m = JSON.parse(new TextDecoder().decode(await this.blob(meta.hash, meta.id)));
        this.metadonnees.set(e.hash, {
          nom: m.visibleName,
          type: m.type === "CollectionType" ? "dossier" : "document",
          parent: m.parent || "",
          modifie: m.lastModified ? new Date(Number(m.lastModified)).toISOString() : null,
          supprime: !!m.deleted,
          pdf: fichiers.some((f) => f.id.endsWith(".pdf")),
          pages: fichiers.filter((f) => f.id.endsWith(".rm")).length,
        });
      }
      return { id: e.id, ...this.metadonnees.get(e.hash) };
    });
    return noeuds.filter((n) => n && !n.supprime && n.parent !== "trash");
  }

  /**
   * Un document : son nom, le modèle Portée sur lequel il a été écrit (lu
   * dans le sujet du PDF d'origine) et les traits de chaque page écrite, dans
   * l'ordre du document.
   */
  async document(id) {
    const { hash } = await this.racine();
    const entrees = await this.index(hash, "root.docSchema");
    const e = entrees.find((x) => x.id === id);
    if (!e) throw new Error("Ce document n'existe plus sur la tablette.");
    const fichiers = await this.index(e.hash, `${id}.docSchema`);
    const trouver = (fin) => fichiers.find((f) => f.id.endsWith(fin));
    const lireJson = async (f) => (f ? JSON.parse(new TextDecoder().decode(await this.blob(f.hash, f.id))) : null);
    const meta = await lireJson(trouver(".metadata"));
    const contenu = await lireJson(trouver(".content"));
    let modele = null;
    const pdf = trouver(".pdf");
    if (pdf) modele = sujetPortee(await this.blob(pdf.hash, pdf.id));
    const ordre = ordrePages(contenu);
    const pages = await enParallele(ordre, async (pageId, i) => {
      const f = fichiers.find((x) => x.id === `${id}/${pageId}.rm`);
      if (!f) return null;
      const traits = traitsDePage(await this.blob(f.hash, f.id));
      return traits.length ? { numero: i + 1, traits } : null;
    });
    return { id, nom: meta ? meta.visibleName : id, modele, pages: pages.filter(Boolean) };
  }
}

/** Index du cloud : « 3 » ou « 4 » (+ une ligne de synthèse), puis hash:type:id:nb:taille. */
export function lireIndex(texte) {
  const lignes = texte.split("\n").filter((l) => l.trim());
  const schema = lignes.shift();
  if (schema === "4") lignes.shift();
  else if (schema !== "3") throw new Error(`Index reMarkable de format inconnu (${schema}).`);
  return lignes.map((l) => {
    const [hash, type, id, nb, taille] = l.split(":");
    return { hash, type, id, sousFichiers: Number(nb), taille: Number(taille) };
  });
}

/** Ordre des pages : cPages (logiciel 3.x, triées par idx, sans les supprimées), sinon l'ancienne liste. */
export function ordrePages(contenu) {
  if (!contenu) return [];
  const c = contenu.cPages && contenu.cPages.pages;
  if (Array.isArray(c) && c.length) {
    return c
      .filter((p) => !p.deleted)
      .sort((a, b) => ((a.idx && a.idx.value) < (b.idx && b.idx.value) ? -1 : 1))
      .map((p) => p.id);
  }
  return Array.isArray(contenu.pages) ? contenu.pages : [];
}

/** Le sujet d'un PDF Portée : « portee:<modèle>:v1 » (dictionnaire Info non compressé). */
export function sujetPortee(octets) {
  const texte = new TextDecoder("latin1").decode(octets);
  const m = texte.match(/\/Subject\s*\((portee:[a-z0-9-]+):v\d+\)/);
  return m ? m[1].split(":")[1] : null;
}

async function enParallele(liste, f) {
  const sortie = new Array(liste.length);
  let suivant = 0;
  const ouvriers = Array.from({ length: Math.min(PARALLELE, liste.length) }, async () => {
    while (suivant < liste.length) {
      const i = suivant++;
      sortie[i] = await f(liste[i], i);
    }
  });
  await Promise.all(ouvriers);
  return sortie;
}
