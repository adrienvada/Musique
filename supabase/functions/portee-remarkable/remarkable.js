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
 *
 * UN CLOUD QUI PEUT FLANCHER. reMarkable renvoie des 429 (trop de
 * requêtes) depuis avril 2026, et ses serveurs ont déjà changé d'adresse.
 * Chaque requête retente donc un 429 ou un 5xx, en attendant de plus en plus
 * (avec un peu de hasard, pour ne pas revenir tous en même temps) ; un
 * document ou une page illisible est signalé à part au lieu de tout faire
 * échouer ; et si l'hôte de synchro ne répond plus, on essaie celui que
 * rmapi-js lit par défaut.
 */
import { traitsDePage } from "./rm.js";

const AUTH = "https://webapp-prod.cloud.remarkable.engineering";
const SYNC = "https://internal.cloud.remarkable.com";
// L'hôte que rmapi-js lit par défaut ; il marque l'autre comme ancien pour
// l'envoi. Notre repli si le premier se tait.
export const SYNC_SECOURS = "https://eu.tectonic.remarkable.com";

// Six requêtes à la fois : douze se faisaient refuser par paquets (429).
const PARALLELE = 6;
// Quatre essais au plus pour une requête : le premier et trois nouveaux.
export const ESSAIS = 4;
const ATTENTE_BASE = 500;       // ms, avant le premier nouvel essai
const ATTENTE_MAX = 8000;       // ms, plafond sans Retry-After
const RETRY_AFTER_MAX = 30000;  // ms : claude.ai coupe un appel d'outil à 240 s

// Le sujet d'un PDF Portée est dans ses premiers kilo-octets (reportlab écrit
// le dictionnaire Info en tête) ; un PDF réenregistré l'ajoute à la fin.
const OCTETS_TETE = 32 * 1024;
const OCTETS_QUEUE = 32 * 1024;
// Si le cloud ne sait pas servir la fin seule, on ne lit en entier qu'un
// petit PDF.
const PDF_ENTIER_MAX = 2 * 1024 * 1024;

/** Échange le code à 8 lettres de my.remarkable.com contre un jeton d'appareil. */
export async function enregistrerAppareil(code, auth = AUTH) {
  const propre = String(code || "").trim().toLowerCase();
  if (!/^[a-z]{8}$/.test(propre)) throw new Error("Le code fait 8 lettres, sans espace (my.remarkable.com/device/desktop/connect).");
  // Pas de nouvel essai ici : le code ne sert qu'une fois, et un second envoi
  // d'un code déjà accepté serait refusé.
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

/** Le jeton du coffre ne se lit plus (clé du coffre perdue ou changée) : comme une révocation. */
export class JetonIlisible extends Error {}

/** Le cloud a répondu, mais par une erreur. */
class ErreurCloud extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

/** L'hôte ne répond plus du tout (réseau), même après les nouveaux essais. */
class HoteMuet extends Error {}

/** Un hôte qui se tait, ou qui n'a plus de synchro à cette adresse : on en essaie un autre. */
const hoteAbsent = (e) => e instanceof HoteMuet || (e instanceof ErreurCloud && (e.statut >= 500 || e.statut === 404 || e.statut === 410));

const messageDe = (e) => (e && e.message) || String(e);

/**
 * L'attente avant le n-ième nouvel essai (n = 1, 2, 3) : ce que demande
 * Retry-After s'il est là (secondes ou date), sinon une attente qui double à
 * chaque fois, dont la seconde moitié est tirée au hasard.
 */
export function attenteAvant(n, retryAfter = null, alea = Math.random) {
  const annoncee = lireRetryAfter(retryAfter);
  if (annoncee !== null) return Math.min(annoncee, RETRY_AFTER_MAX);
  const plafond = Math.min(ATTENTE_BASE * 2 ** (n - 1), ATTENTE_MAX);
  return Math.round(plafond / 2 + (alea() * plafond) / 2);
}

function lireRetryAfter(v) {
  if (!v) return null;
  const t = String(v).trim();
  if (/^\d+$/.test(t)) return Number(t) * 1000;
  const date = Date.parse(t);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** L'hôte de synchro donné par le secret PORTEE_HOTE_SYNC, s'il a la forme d'une adresse https. */
export function hoteDeSynchro(valeur) {
  const t = String(valeur || "").trim().replace(/\/+$/, "");
  return /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(t) ? t : null;
}

const attendreVraiment = (ms) => new Promise((ok) => setTimeout(ok, ms));

export class CloudRemarkable {
  /**
   * `coffre` garde le jeton d'appareil (coffre.js). `hotes` : { auth, sync,
   * secours } (sync vient du secret PORTEE_HOTE_SYNC ; les tests visent un
   * faux cloud). `options.attendre` et `options.alea` ne servent qu'aux
   * tests, pour ne pas attendre pour de vrai.
   */
  constructor(coffre, hotes = {}, options = {}) {
    this.coffre = coffre;
    this.auth = hotes.auth || AUTH;
    this.sync = hotes.sync || SYNC;
    // Le secours par défaut ne vaut que pour un vrai hôte (https) : un faux
    // cloud de test qui flanche ne doit jamais renvoyer vers le vrai.
    this.secours = hotes.secours !== undefined ? hotes.secours : this.sync.startsWith("https://") ? SYNC_SECOURS : null;
    this.syncActif = null; // l'hôte qui a répondu en dernier
    this.attendre = options.attendre || attendreVraiment;
    this.alea = options.alea || Math.random;
    this.jetonAppareil = null;
    this.jetonUtilisateur = null;
    this.metadonnees = new Map(); // empreinte d'un document → { nom, type, parent… }
    this.modeles = new Map();     // empreinte d'un PDF → modèle Portée (ou null)
  }

  /** Relie la tablette : le code devient un jeton d'appareil, rangé au coffre. */
  async relier(code) {
    const jeton = await enregistrerAppareil(code, this.auth);
    await this.coffre.ecrire(jeton);
    this.jetonAppareil = jeton;
    this.jetonUtilisateur = null;
  }

  /**
   * Une requête, retentée sur un 429, un 5xx ou une coupure du réseau
   * (lire seulement : rien ici n'écrit dans le cloud). Rend la dernière
   * réponse, bonne ou non ; lève HoteMuet si le réseau ne répond jamais.
   */
  async essayer(url, init) {
    for (let essai = 1; ; essai++) {
      let r;
      try {
        r = await fetch(url, init);
      } catch (e) {
        if (essai >= ESSAIS) throw new HoteMuet(`Le cloud reMarkable ne répond pas (${messageDe(e)}). Réessaie dans un moment.`);
        await this.attendre(attenteAvant(essai, null, this.alea));
        continue;
      }
      if ((r.status === 429 || r.status >= 500) && essai < ESSAIS) {
        const retryAfter = r.headers.get("retry-after");
        await r.body?.cancel();
        await this.attendre(attenteAvant(essai, retryAfter, this.alea));
        continue;
      }
      return r;
    }
  }

  async jeton(renouveler = false) {
    if (this.jetonUtilisateur && !renouveler) return this.jetonUtilisateur;
    try {
      this.jetonAppareil ??= await this.coffre.lire();
    } catch (e) {
      // Le coffre ne sait plus déchiffrer le jeton : il faut relier à nouveau.
      if (e instanceof JetonIlisible) throw new NonReliee("revoquee");
      throw e;
    }
    if (!this.jetonAppareil) throw new NonReliee("jamais");
    const r = await this.essayer(`${this.auth}/token/json/2/user/new`, {
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

  /** Une lecture authentifiée ; un 401 renouvelle le jeton d'utilisateur une fois. */
  async requete(url, entetes = {}) {
    let renouveler = false;
    for (;;) {
      const r = await this.essayer(url, { headers: { authorization: `Bearer ${await this.jeton(renouveler)}`, "user-agent": "portee", ...entetes } });
      if (r.ok) return r;
      await r.body?.cancel();
      if (r.status === 401 && !renouveler) { renouveler = true; continue; }
      throw new ErreurCloud(r.status, `Le cloud reMarkable répond HTTP ${r.status} pour ${entetes["rm-filename"] || "la racine"}.`);
    }
  }

  /**
   * La racine, sur le premier hôte qui répond : celui qui a répondu la
   * dernière fois, puis celui du secret (ou l'habituel), puis le secours. Les
   * blobs se lisent ensuite sur ce même hôte.
   */
  async racine() {
    const hotes = [...new Set([this.syncActif, this.sync, this.secours].filter(Boolean))];
    let derniere = null;
    for (const hote of hotes) {
      try {
        const r = await this.requete(`${hote}/sync/v4/root`);
        const racine = await r.json(); // { hash, generation, schemaVersion }
        this.syncActif = hote;
        return racine;
      } catch (e) {
        if (!hoteAbsent(e)) throw e; // une vraie réponse (403…) : changer d'hôte n'y ferait rien
        derniere = e;
      }
    }
    throw derniere;
  }

  get hoteBlobs() {
    return this.syncActif || this.sync;
  }

  async blob(empreinte, nom) {
    const r = await this.requete(`${this.hoteBlobs}/sync/v3/files/${empreinte}`, { "rm-filename": nom });
    return new Uint8Array(await r.arrayBuffer());
  }

  async index(empreinte, nom) {
    return lireIndex(new TextDecoder().decode(await this.blob(empreinte, nom)));
  }

  async metadonneesDe(e) {
    if (!this.metadonnees.has(e.hash)) {
      const fichiers = await this.index(e.hash, `${e.id}.docSchema`);
      const meta = fichiers.find((f) => f.id.endsWith(".metadata"));
      if (!meta) throw new Error("ce document n'a pas de fiche (.metadata)");
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
    return this.metadonnees.get(e.hash);
  }

  /**
   * Tous les dossiers et documents, sans la corbeille ni les éléments
   * supprimés : { noeuds, illisibles }. Un document qu'on n'arrive pas à lire
   * va dans `illisibles` ({ id, raison }) : les autres restent là.
   */
  async arborescence() {
    const { hash } = await this.racine();
    const entrees = await this.index(hash, "root.docSchema");
    const illisibles = [];
    const noeuds = await enParallele(entrees, async (e) => {
      try {
        return { id: e.id, ...(await this.metadonneesDe(e)) };
      } catch (err) {
        if (err instanceof NonReliee) throw err;
        illisibles.push({ id: e.id, raison: messageDe(err) });
        return null;
      }
    });
    return { noeuds: noeuds.filter((n) => n && !n.supprime && n.parent !== "trash"), illisibles };
  }

  /**
   * Le modèle Portée d'un PDF, lu dans son sujet, sans télécharger tout le
   * PDF : sa tête d'abord, sa fin ensuite. Un même modèle importé plusieurs
   * fois garde la même empreinte : on ne le relit pas.
   */
  async modeleDuPdf(f) {
    if (!this.modeles.has(f.hash)) this.modeles.set(f.hash, await this.lireSujet(f));
    return this.modeles.get(f.hash);
  }

  async lireSujet(f) {
    // La tête. Un cloud qui ignore Range envoie tout : on s'arrête quand même.
    const tete = await this.morceau(f, `bytes=0-${OCTETS_TETE - 1}`);
    const taille = tailleTotale(tete) ?? (Number.isFinite(f.taille) && f.taille > 0 ? f.taille : null);
    const debut = await lireAuPlus(tete, OCTETS_TETE);
    const trouve = sujetPortee(debut.octets);
    // Un 206 n'est qu'un morceau : il faut la taille pour savoir s'il était tout.
    const toutLu = (tete.status !== 206 && debut.complet) || (taille !== null && debut.octets.length >= taille);
    if (trouve || toutLu) return trouve;
    // La fin, si le cloud sait la servir seule ; sinon le PDF entier, s'il est petit.
    const fin = await this.morceau(f, `bytes=-${OCTETS_QUEUE}`);
    if (fin.status === 206) return sujetPortee((await lireAuPlus(fin, OCTETS_QUEUE)).octets);
    const tout = await lireAuPlus(fin, PDF_ENTIER_MAX);
    return tout.complet ? sujetPortee(tout.octets) : null;
  }

  /** Un morceau d'un blob (en-tête Range) ; sans Range si le cloud le refuse. */
  async morceau(f, range) {
    const adresse = `${this.hoteBlobs}/sync/v3/files/${f.hash}`;
    try {
      return await this.requete(adresse, { "rm-filename": f.id, range });
    } catch (e) {
      if (!(e instanceof ErreurCloud && (e.statut === 416 || e.statut === 400))) throw e;
      return this.requete(adresse, { "rm-filename": f.id });
    }
  }

  /**
   * Un document : son nom, le modèle Portée sur lequel il a été écrit (lu
   * dans le sujet du PDF d'origine), le nombre de pages, celles qui ont de
   * l'encre (`pagesEcrites`), et les traits de chaque page écrite, dans
   * l'ordre du document.
   *
   * `options.pages` : les numéros voulus (à partir de 1), sinon toutes.
   * `options.budget` et `options.mesure(traits)` : la réponse s'arrête avant
   * de dépasser le budget (au moins une page) ; ce qui reste à lire est dans
   * `pagesRestantes`. Une page illisible va dans `pagesIllisibles`.
   */
  async document(id, { pages: voulues = null, budget = Infinity, mesure = null } = {}) {
    const { hash } = await this.racine();
    const entrees = await this.index(hash, "root.docSchema");
    const e = entrees.find((x) => x.id === id);
    if (!e) throw new Error("Ce document n'existe plus sur la tablette.");
    const fichiers = await this.index(e.hash, `${id}.docSchema`);
    const trouver = (fin) => fichiers.find((f) => f.id.endsWith(fin));
    const lireJson = async (f) => (f ? JSON.parse(new TextDecoder().decode(await this.blob(f.hash, f.id))) : null);
    const meta = await lireJson(trouver(".metadata"));
    const contenu = await lireJson(trouver(".content"));
    const pdf = trouver(".pdf");
    const modele = pdf ? await this.modeleDuPdf(pdf) : null;
    const ordre = ordrePages(contenu);
    const rmDe = (numero) => fichiers.find((x) => x.id === `${id}/${ordre[numero - 1]}.rm`);
    const pagesEcrites = ordre.map((_, i) => i + 1).filter((n) => rmDe(n));
    const numeros = (voulues || ordre.map((_, i) => i + 1)).filter((n) => n >= 1 && n <= ordre.length);
    const lues = [], illisibles = [], restantes = [];
    let poids = 0;
    // Par paquets de six, dans l'ordre : on s'arrête dès que le budget est atteint.
    for (let i = 0; i < numeros.length; i += PARALLELE) {
      if (poids >= budget) { restantes.push(...numeros.slice(i)); break; }
      const paquet = await enParallele(numeros.slice(i, i + PARALLELE), async (numero) => {
        const f = rmDe(numero);
        if (!f) return null;
        try {
          const traits = traitsDePage(await this.blob(f.hash, f.id));
          return traits.length ? { numero, traits } : null;
        } catch (err) {
          if (err instanceof NonReliee) throw err;
          illisibles.push({ numero, raison: messageDe(err) });
          return null;
        }
      });
      for (const page of paquet) {
        if (!page) continue;
        const p = mesure ? mesure(page.traits) : 0;
        if (lues.length && poids + p > budget) { restantes.push(page.numero); poids = budget; continue; }
        lues.push(page);
        poids += p;
      }
    }
    return {
      id,
      nom: meta ? meta.visibleName : id,
      modele,
      nombrePages: ordre.length,
      pagesEcrites,
      pages: lues,
      pagesIllisibles: illisibles.sort((a, b) => a.numero - b.numero),
      pagesRestantes: restantes.filter((n) => rmDe(n)).sort((a, b) => a - b),
    };
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

/** La taille du fichier entier, d'après Content-Range (« bytes 0-32767/1234567 »). */
function tailleTotale(r) {
  const m = /\/(\d+)\s*$/.exec(r.headers.get("content-range") || "");
  return m ? Number(m[1]) : null;
}

/**
 * Au plus `max` octets d'une réponse : le reste n'est pas téléchargé.
 * `complet` : la réponse s'est terminée avant la borne.
 */
async function lireAuPlus(reponse, max) {
  const morceaux = [];
  let total = 0, complet = false;
  if (!reponse.body) {
    complet = true;
  } else {
    const lecteur = reponse.body.getReader();
    for (;;) {
      if (total >= max) { await lecteur.cancel().catch(() => {}); break; }
      const { done, value } = await lecteur.read();
      if (done) { complet = true; break; }
      morceaux.push(value);
      total += value.byteLength;
    }
  }
  const octets = new Uint8Array(total);
  let i = 0;
  for (const m of morceaux) { octets.set(m, i); i += m.byteLength; }
  return { octets: octets.subarray(0, Math.min(total, max)), complet };
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
