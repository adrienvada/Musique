/**
 * OÙ VIVENT TES PARTITIONS
 *
 * Publiée sur claude.ai, l'appli range tout dans la base de sa page : tes
 * partitions te suivent sur chaque appareil où tu ouvres le lien. Ouverte
 * ailleurs (GitHub Pages, fichier local), elle range tout dans ce
 * navigateur, avec IndexedDB : localStorage plafonne vers 5 Mo, soit
 * quelques dizaines de pages. Le reste de l'appli ne voit pas la différence.
 * Une sauvegarde (un fichier .json) passe la bibliothèque d'un navigateur
 * à l'autre.
 *
 * Une partition = un document `partitions/<id>` (titre, ABC, doutes…) ;
 * ses traits, page par page, dans `partitions/<id>/pages/<n>` : une page
 * dense pèse ~60 Ko, on ne les charge qu'à l'ouverture de l'atelier.
 *
 * Chaque fiche passe par `normaliserFiche` (fiche.js) quand elle est
 * rangée, restaurée ou lue : une fiche mal formée, venue d'une sauvegarde
 * ou d'un autre appareil, ne peut plus vider le carnet (audit du 04/10, S6).
 */
import { EPOQUE, compacter, dateIso, decompacter, egal, fusionnerFiches, normaliserChamps, normaliserFiche, sansDates, uneMsPlusTard } from "./fiche.js";

// Ils vivent dans fiche.js, sans DOM (la synchro et ses essais s'en servent
// sans tirer tout le stockage) ; on les donne encore d'ici, où on les prenait.
export { compacter, decompacter };

const CLE_LOCALE = "portee:partitions";
const FORMAT_SAUVEGARDE = "portee-sauvegarde";
// Ce que la bibliothèque commune accepte comme identifiant (bibliotheque.js).
const ID_VALIDE = /^[A-Za-z0-9_-]{1,64}$/;
// Un document de la base de claude.ai ne dépasse pas 256 Kio : le son d'un
// mémo (base64) y est rangé par morceaux de 180 000 caractères (D8).
const MORCEAU_MEMO = 180000;

export function nouvelId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

const plusTard = (iso) => {
  const maintenant = new Date().toISOString();
  return iso && !(maintenant > iso) ? uneMsPlusTard(iso) : maintenant;
};
const lireFiche = (brute, id) => {
  const f = normaliserFiche(brute);
  return f ? { ...f, id } : null;
};
const parDate = (a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || "");

/**
 * Le stockage de l'appli : la base de claude.ai, sinon IndexedDB, sinon
 * localStorage. `surBloque(message)` : la base est tenue par un autre
 * onglet resté sur une version précédente ; on attend qu'il la lâche.
 */
export async function ouvrirStockage({ surBloque } = {}) {
  const claude = typeof window !== "undefined" ? window.claude : undefined;
  const use = claude && typeof claude.use === "function" ? (n) => claude.use(n).catch(() => null) : async () => null;
  const [db, downloads] = await Promise.all([use("db"), use("downloads")]);
  if (db) return stockageClaude(db, downloads);
  try {
    return await stockageIndexe("portee", { surBloque });
  } catch (e) {
    // Une base bloquée par un autre onglet, ou déjà ouverte par une version
    // plus récente, n'est pas une base absente : se replier sur localStorage
    // montrerait une bibliothèque vide (audit, S13). On le dit plutôt.
    if (e && (e.code === "base_bloquee" || e.code === "version_plus_recente")) throw e;
    console.warn("IndexedDB indisponible, repli sur localStorage", e);
    return stockageLocal();
  }
}

// ------------------------------------------------------------------------
// claude.ai : la base de la page
// ------------------------------------------------------------------------

export function stockageClaude(db, downloads) {
  const col = db.collection("partitions");
  const docMemo = (id, n = null) => db.doc(n === null ? `partitions/${id}/memo/audio` : `partitions/${id}/memo/audio-${n}`);
  const effacer = (doc) => doc.delete().catch(() => {});
  /** Combien de morceaux a le mémo rangé (0 : aucun, ou l'ancien document unique). */
  async function morceauxDuMemo(id) {
    const d = await docMemo(id).get().catch(() => null);
    const m = d && d.exists ? d.data() : null;
    return m && Number.isInteger(m.morceaux) ? m.morceaux : 0;
  }
  async function ecrireMemo(id, memo) {
    const avant = await morceauxDuMemo(id);
    if (!memo) {
      await effacer(docMemo(id));
      for (let i = 0; i < avant; i++) await effacer(docMemo(id, i));
      return;
    }
    const son = typeof memo.base64 === "string" ? memo.base64 : "";
    const n = Math.max(1, Math.ceil(son.length / MORCEAU_MEMO));
    // Les morceaux d'abord, l'index ensuite : on ne lit jamais un index qui renvoie à un morceau absent.
    for (let i = 0; i < n; i++) await docMemo(id, i).set({ base64: son.slice(i * MORCEAU_MEMO, (i + 1) * MORCEAU_MEMO) });
    await docMemo(id).set({ type: memo.type, duree: memo.duree, morceaux: n });
    for (let i = n; i < avant; i++) await effacer(docMemo(id, i));
  }
  return {
    mode: "claude",
    midiDirect: false, // la liste des téléchargements de claude.ai ignore .mid
    ecouter(rappel, erreur) {
      return col.orderBy("modifieLe", "desc").onSnapshot(
        (snap) => rappel(snap.docs.map((d) => lireFiche(d.data(), d.id)).filter(Boolean)),
        (e) => erreur && erreur(e),
      );
    },
    async lire(id) {
      const d = await col.doc(id).get();
      return d.exists ? lireFiche(d.data(), id) : null;
    },
    async pages(id, nb) {
      const sortie = [];
      for (let n = 1; n <= nb; n++) {
        const d = await db.doc(`partitions/${id}/pages/${n}`).get();
        sortie.push(d.exists ? decompacter(d.data().traits) : []);
      }
      return sortie;
    },
    async creer(id, donnees, pages = [], { memo = null } = {}) {
      const d = normaliserFiche(donnees);
      if (!d) throw new Error("Cette partition est illisible : rien n'a été enregistré.");
      // Les pages d'abord : une partition visible a toujours ses traits.
      for (let n = 0; n < pages.length; n++) {
        await db.doc(`partitions/${id}/pages/${n + 1}`).set({ traits: compacter(pages[n]) });
      }
      if (memo) await ecrireMemo(id, memo);
      await col.doc(id).set(d);
    },
    async modifier(id, patch) {
      // Seulement les champs donnés, remis en forme : la base fusionne elle-même les champs d'un document.
      await col.doc(id).update(normaliserChamps(patch));
    },
    async supprimer(id, nb) {
      await col.doc(id).delete();
      for (let n = 1; n <= nb; n++) await db.doc(`partitions/${id}/pages/${n}`).delete();
      await ecrireMemo(id, null).catch(() => {});
    },
    /** Le mémo : l'ancien document unique, ou ses morceaux recollés. */
    async lireMemo(id) {
      const d = await docMemo(id).get();
      if (!d.exists) return null;
      const m = d.data();
      if (typeof m.base64 === "string") return m;
      if (!Number.isInteger(m.morceaux)) return null;
      const parts = [];
      for (let i = 0; i < m.morceaux; i++) {
        const p = await docMemo(id, i).get();
        if (!p.exists) return null; // en cours de réécriture : on relira
        parts.push(p.data().base64 || "");
      }
      return { type: m.type, duree: m.duree, base64: parts.join("") };
    },
    ecrireMemo,
    async enregistrerFichier(nom, donnees) {
      if (!downloads) return telechargerNavigateur(nom, donnees);
      return downloads.save({ filename: nom, data: donnees });
    },
  };
}

// ------------------------------------------------------------------------
// localStorage : le dernier recours (pas d'IndexedDB du tout)
// ------------------------------------------------------------------------

function stockageLocal() {
  const abonnes = new Set();
  const lireTout = () => {
    try { return JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}"); } catch { return {}; }
  };
  const enListe = (tout) => Object.entries(tout).map(([id, d]) => lireFiche(d, id)).filter(Boolean).sort(parDate);
  const ecrireTout = (tout) => {
    try { localStorage.setItem(CLE_LOCALE, JSON.stringify(tout)); }
    catch { throw new Error("Le stockage de ce navigateur est plein : supprime une partition ou ouvre l'appli sur claude.ai."); }
    const liste = enListe(tout);
    abonnes.forEach((f) => f(liste));
  };
  const ecrireMemo = (id, memo) => {
    try {
      if (memo) localStorage.setItem(`portee:memo:${id}`, JSON.stringify(memo));
      else localStorage.removeItem(`portee:memo:${id}`);
    } catch { throw new Error("Le stockage de ce navigateur est plein : le mémo n'a pas pu être gardé."); }
  };
  return {
    mode: "local",
    midiDirect: true,
    ecouter(rappel) {
      abonnes.add(rappel);
      rappel(enListe(lireTout()));
      return () => abonnes.delete(rappel);
    },
    async lire(id) {
      const d = lireTout()[id];
      return d ? lireFiche(d, id) : null;
    },
    async pages(id) {
      try { return JSON.parse(localStorage.getItem(`portee:pages:${id}`) || "[]").map(decompacter); } catch { return []; }
    },
    async creer(id, donnees, pages = [], { memo = null } = {}) {
      const d = normaliserFiche(donnees);
      if (!d) throw new Error("Cette partition est illisible : rien n'a été enregistré.");
      try { localStorage.setItem(`portee:pages:${id}`, JSON.stringify(pages.map(compacter))); } catch { /* sans traits, la partition reste lisible */ }
      if (memo) ecrireMemo(id, memo);
      const tout = lireTout(); tout[id] = d; ecrireTout(tout);
    },
    async modifier(id, patch) {
      const tout = lireTout(); if (!tout[id]) return;
      tout[id] = normaliserFiche({ ...tout[id], ...patch }) || tout[id]; ecrireTout(tout);
    },
    async supprimer(id) {
      const tout = lireTout(); delete tout[id]; ecrireTout(tout);
      try { localStorage.removeItem(`portee:pages:${id}`); localStorage.removeItem(`portee:memo:${id}`); } catch { /* rien à faire */ }
    },
    async lireMemo(id) {
      try { return JSON.parse(localStorage.getItem(`portee:memo:${id}`) || "null"); } catch { return null; }
    },
    async ecrireMemo(id, memo) { ecrireMemo(id, memo); },
    async enregistrerFichier(nom, donnees) {
      return telechargerNavigateur(nom, donnees);
    },
  };
}

// ------------------------------------------------------------------------
// IndexedDB. Magasins :
//   partitions  id → données (titre, ABC, doutes, modifieLe…)
//   pages       id → pages compactées (lues seulement à l'ouverture), ou
//               [{ memo }] pour une idée qui a un mémo vocal
//   envois      id → { numero, modifieLe, pages, supprime } : ce qui reste
//               à envoyer à la bibliothèque commune (synchro.js)
//   meta        clé → valeur (curseur de synchronisation, adresse,
//               « rejoint », et « quarantaine:<envoi|reception>:<id> » : ce
//               que la synchro a mis de côté, avec la raison)
//   bases       id → { donnees, modifieLe, pagesLe, supprime, rev, enVol } :
//               la dernière version convenue avec la bibliothèque commune
//               (reçue, ou envoyée et acceptée), d'où partent les
//               modifications d'ici. La synchro fusionne à partir d'elle (D4).
//               `rev` (le numéro que lui a donné le connecteur) l'identifie :
//               deux versions peuvent avoir la même date.
// Version 1 : partitions et pages ; la 2 ajoute envois et meta ; la 3, bases.
// ------------------------------------------------------------------------

const VERSION_BASE = 3;
const MAGASINS = ["partitions", "pages", "envois", "meta", "bases"];
const QUARANTAINE = "quarantaine:";

let compteurEnvois = 0;
/** Un numéro neuf à chaque envoi noté : la synchro n'efface que l'envoi qu'elle a fait partir (D3). */
const numeroEnvoi = () => `${Date.now().toString(36)}-${(++compteurEnvois).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
/** L'envoi à noter : les pages restent à envoyer tant qu'elles ne sont pas parties. */
const envoi = ({ modifieLe, pages = false, supprime = false }, avant) => ({ numero: numeroEnvoi(), modifieLe, pages: pages || (!supprime && !!(avant && avant.pages && !avant.supprime)), supprime });
/** Ce qu'on garde d'une fiche de la bibliothèque commune, comme base. */
function baseDe(f) {
  const donnees = f.supprime ? null : normaliserFiche(f.donnees);
  return { donnees, modifieLe: f.modifieLe, pagesLe: f.pagesLe ?? null, supprime: !!f.supprime, rev: Number.isInteger(f.rev) ? f.rev : null };
}

/**
 * Passe la base à la version 3 en gardant tout. De la 2 à la 3 : chaque
 * fiche déjà synchronisée (l'appareil a rejoint la bibliothèque commune, et
 * rien n'attend d'être envoyé pour elle) est exactement la dernière version
 * convenue : elle devient sa propre base, et la première fusion se fait
 * déjà champ par champ.
 */
function migrer(db, t, ancienne) {
  for (const m of MAGASINS) if (!db.objectStoreNames.contains(m)) db.createObjectStore(m);
  if (ancienne !== 2) return;
  const bases = t.objectStore("bases");
  t.objectStore("meta").get("rejoint").onsuccess = (e) => {
    if (!e.target.result) return;
    t.objectStore("envois").getAllKeys().onsuccess = (e2) => {
      const enAttente = new Set(e2.target.result);
      t.objectStore("partitions").openCursor().onsuccess = (e3) => {
        const c = e3.target.result;
        if (!c) return;
        const d = normaliserFiche(c.value);
        if (d && !enAttente.has(c.key)) bases.put({ donnees: d, modifieLe: d.modifieLe, pagesLe: c.value.pagesLe ?? null, supprime: false, rev: null }, c.key);
        c.continue();
      };
    };
  };
}

function ouvrirBase(nom, { surBloque } = {}) {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === "undefined") { ko(new Error("pas d'IndexedDB")); return; }
    let r, fini = false;
    try { r = indexedDB.open(nom, VERSION_BASE); } catch (e) { ko(e); return; }
    r.onupgradeneeded = (ev) => migrer(r.result, r.transaction, ev.oldVersion);
    r.onsuccess = () => {
      // Abandonnée entre-temps (base bloquée, sans attente) : on la lâche, pour ne bloquer personne.
      if (fini) { r.result.close(); return; }
      fini = true; ok(r.result);
    };
    r.onerror = () => {
      fini = true;
      const e = r.error;
      if (e && e.name === "VersionError") ko(Object.assign(new Error("Une version plus récente de Portée a déjà ouvert ta bibliothèque dans ce navigateur : recharge la page."), { code: "version_plus_recente", cause: e }));
      else ko(e);
    };
    r.onblocked = () => {
      const message = "Ferme l'autre onglet de Portée : il garde ta bibliothèque ouverte sur une version précédente. Elle s'ouvrira ici dès qu'il sera fermé.";
      // Avec `surBloque`, on attend : la base s'ouvre d'elle-même quand l'autre onglet la lâche.
      if (surBloque) { surBloque(message); return; }
      fini = true;
      ko(Object.assign(new Error(message), { code: "base_bloquee" }));
    };
  });
}

/** La bibliothèque dans IndexedDB. `nom` ne change que dans les tests (deux « appareils »). */
export async function stockageIndexe(nom = "portee", { surBloque } = {}) {
  const base = await ouvrirBase(nom, { surBloque });
  let fermee = false;
  let surChangement = () => {}, surAutreOnglet = () => {}, surFermeture = () => {};
  // Les autres onglets de Portée ouverts sur cette bibliothèque : ils
  // rafraîchissent leur liste quand une partition change ici (D7, S8).
  const canal = typeof BroadcastChannel === "function" ? new BroadcastChannel(nom) : null;
  canal?.unref?.(); // Node (tests) : le canal ne retient pas le programme
  // Une version plus récente de Portée veut passer la base à sa version : on
  // la lâche tout de suite, sinon c'est elle qui resterait bloquée (S13).
  base.onversionchange = () => { base.close(); fermee = true; canal?.close(); surFermeture(); };
  const erreurFermee = () => new Error("Portée a été mise à jour dans un autre onglet : recharge cette page pour continuer.");

  /**
   * Une transaction. `f(o)` y lance ses requêtes par rappels (o.lire, o.mettre,
   * o.effacer), sans `await` au milieu : une transaction IndexedDB se ferme
   * dès qu'elle n'a plus rien à faire. Lire puis écrire dans la même
   * transaction est ce qui rend une modification sûre : rien ne peut se
   * glisser entre les deux (S7). La promesse rend `o.resultat`.
   */
  const transaction = (noms, mode, f) => new Promise((ok, ko) => {
    if (fermee) { ko(erreurFermee()); return; }
    let t;
    try { t = base.transaction(noms, mode); } catch (e) { ko(fermee ? erreurFermee() : e); return; }
    let erreur = null;
    const arreter = (e) => { if (!erreur) erreur = e; try { t.abort(); } catch { /* déjà finie */ } };
    const garde = (g) => (...args) => { if (erreur) return; try { g(...args); } catch (e) { arreter(e); } };
    const o = {
      t, garde, resultat: undefined,
      lire: (m, cle, suite) => { const r = t.objectStore(m).get(cle); r.onsuccess = garde(() => suite(r.result)); },
      mettre: (m, valeur, cle) => t.objectStore(m).put(valeur, cle),
      effacer: (m, cle) => t.objectStore(m).delete(cle),
    };
    try { f(o); } catch (e) { arreter(e); }
    t.oncomplete = () => ok(o.resultat);
    t.onabort = () => ko(erreur || t.error || new Error("écriture annulée (stockage plein ?)"));
  });
  const lireCle = (m, cle) => transaction([m], "readonly", (o) => o.lire(m, cle, (v) => { o.resultat = v; }));
  /** Toutes les valeurs d'un magasin avec leurs clés, lues d'un coup (les deux listes restent alignées). */
  const toutLire = (m, plage = undefined) => transaction([m], "readonly", (o) => {
    const s = o.t.objectStore(m);
    const rc = s.getAllKeys(plage), rv = s.getAll(plage);
    rv.onsuccess = o.garde(() => { o.resultat = rv.result.map((v, i) => [rc.result[i], v]); });
  });

  const abonnes = new Set();
  const liste = async () => (await toutLire("partitions")).map(([id, d]) => lireFiche(d, id)).filter(Boolean).sort(parDate);
  const prevenir = () => liste().then((l) => abonnes.forEach((f) => f(l)), () => {});
  if (canal) canal.onmessage = (ev) => { prevenir(); surAutreOnglet(Array.isArray(ev.data && ev.data.ids) ? ev.data.ids : []); };
  const annoncer = (ids) => { try { canal?.postMessage({ type: "changement", ids }); } catch { /* canal fermé */ } };
  /** Après un changement fait ici : la liste, les autres onglets, et la synchro (sauf pour ce qu'elle a écrit elle-même). */
  const apres = (ids, { synchro = true } = {}) => { if (synchro) surChangement(); prevenir(); annoncer(ids); };

  // Une bibliothèque rangée dans localStorage (une version précédente, ou un
  // repli quand IndexedDB manquait) passe dans IndexedDB, une fois : ses
  // mémos aussi, et chaque partition part ensuite vers les autres appareils
  // (elle n'a jamais été envoyée, S16).
  try {
    const ancien = JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}");
    const lireJson = (cle) => { try { return JSON.parse(localStorage.getItem(cle) || "null"); } catch { return null; } };
    for (const [id, brute] of Object.entries(ancien)) {
      const d = normaliserFiche(brute);
      if (!d) continue;
      const memo = lireJson(`portee:memo:${id}`);
      const pages = memo ? [{ memo }] : Array.isArray(lireJson(`portee:pages:${id}`)) ? lireJson(`portee:pages:${id}`) : [];
      await transaction(["pages", "partitions", "envois"], "readwrite", (o) => {
        o.lire("partitions", id, (deja) => {
          // Déjà là, et plus récente : celle d'IndexedDB reste.
          if (deja && (normaliserFiche(deja)?.modifieLe || "") >= d.modifieLe) return;
          o.mettre("pages", pages, id);
          o.mettre("partitions", d, id);
          o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe: d.modifieLe, pages: true }, avant), id));
        });
      });
      localStorage.removeItem(`portee:pages:${id}`);
      localStorage.removeItem(`portee:memo:${id}`);
    }
    localStorage.removeItem(CLE_LOCALE);
  } catch { /* rien à reprendre */ }

  // Demande au navigateur de ne pas effacer la bibliothèque quand il manque de place (etatStockage dit s'il a accepté).
  try { navigator.storage.persist().catch(() => {}); } catch { /* facultatif */ }

  return {
    mode: "local",
    midiDirect: true,
    synchronisable: true,
    ecouter(rappel, erreur) {
      abonnes.add(rappel);
      liste().then(rappel, (e) => erreur && erreur(e));
      return () => abonnes.delete(rappel);
    },
    async lire(id) {
      const d = await lireCle("partitions", id);
      return d ? lireFiche(d, id) : null;
    },
    async pages(id) {
      const p = await lireCle("pages", id);
      return (Array.isArray(p) ? p : []).filter(Array.isArray).map(decompacter);
    },
    async creer(id, donnees, pages = [], { memo = null } = {}) {
      const d = normaliserFiche(donnees);
      if (!d) throw new Error("Cette partition est illisible : rien n'a été enregistré.");
      await transaction(["partitions", "pages", "envois"], "readwrite", (o) => {
        o.mettre("pages", memo ? [{ memo }] : (pages || []).map(compacter), id);
        o.mettre("partitions", d, id);
        o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe: d.modifieLe, pages: true }, avant), id));
      });
      apres([id]);
    },
    /**
     * Modifie une partition (seulement les champs de `patch`). `depuis` :
     * la version d'où est parti celui qui écrit (l'éditeur qui enregistre
     * l'idée entière) ; si la partition a changé depuis (un autre onglet, la
     * synchro), les deux se fusionnent au lieu que l'une écrase l'autre.
     */
    async modifier(id, patch, { depuis = null } = {}) {
      const fait = await transaction(["partitions", "envois"], "readwrite", (o) => {
        o.lire("partitions", id, (brute) => {
          if (!brute) return; // supprimée entre-temps : rien à modifier
          const d = normaliserFiche(brute);
          let nouveau = normaliserFiche({ ...d, ...patch });
          const b = depuis ? normaliserFiche(depuis) : null;
          if (b && !egal(sansDates(b), sansDates(d))) nouveau = fusionnerFiches({ base: b, locale: nouveau, distante: d }).donnees;
          // Toujours plus récent que la version d'avant, même si l'horloge de cet
          // appareil retarde sur celle de l'appareil qui l'a écrite.
          if (!(nouveau.modifieLe > d.modifieLe)) nouveau.modifieLe = uneMsPlusTard(d.modifieLe);
          o.mettre("partitions", nouveau, id);
          o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe: nouveau.modifieLe }, avant), id));
          o.resultat = true;
        });
      });
      if (fait) apres([id]);
    },
    async supprimer(id) {
      await transaction(["partitions", "pages", "envois"], "readwrite", (o) => {
        o.lire("partitions", id, (brute) => {
          // La pierre tombale passe après la version d'ici, même si l'horloge
          // de cet appareil retarde : sinon la bibliothèque commune la refusait (S3).
          const modifieLe = plusTard(brute ? normaliserFiche(brute)?.modifieLe : null);
          o.effacer("partitions", id);
          o.effacer("pages", id);
          o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe, supprime: true }, avant), id));
        });
      });
      apres([id]);
    },
    /**
     * Le mémo vocal d'une idée. Une idée n'a pas de traits : son contenu
     * lourd (le magasin des pages, synchronisé à part et seulement quand il
     * change) porte son mémo. La synchronisation n'y voit que des pages.
     */
    async lireMemo(id) {
      const p = await lireCle("pages", id);
      const m = Array.isArray(p) ? p.find((x) => x && x.memo) : null;
      return m ? m.memo : null;
    },
    async ecrireMemo(id, memo) {
      const fait = await transaction(["pages", "partitions", "envois"], "readwrite", (o) => {
        o.mettre("pages", memo ? [{ memo }] : [], id);
        o.lire("partitions", id, (brute) => {
          if (!brute) return; // pas encore enregistrée : le son partira avec elle
          const d = normaliserFiche(brute);
          // Un nouveau son change la fiche : sa date avance, pour que l'envoi
          // parte même pendant une synchro (S6) et que les autres appareils le
          // prennent (S14).
          const nouveau = normaliserFiche({ ...d, memo: memo ? { duree: memo.duree, type: memo.type } : null, modifieLe: plusTard(d.modifieLe) });
          o.mettre("partitions", nouveau, id);
          o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe: nouveau.modifieLe, pages: true }, avant), id));
          o.resultat = true;
        });
      });
      if (fait) apres([id]);
    },
    async enregistrerFichier(nom, donnees) {
      return telechargerNavigateur(nom, donnees);
    },

    // --- Onglets
    /** Une partition a changé dans un autre onglet : `f(ids)` (la liste, elle, est déjà rafraîchie). */
    surAutreOnglet(f) { surAutreOnglet = f; },
    /** La base a été fermée pour une version plus récente de Portée, ouverte dans un autre onglet. */
    surFermeture(f) { surFermeture = f; },
    fermer() { fermee = true; canal?.close(); base.close(); },

    // --- Pour la synchronisation (synchro.js) : rien de ceci ne relance une synchro.
    /** Appelé après chaque changement local (pour planifier un envoi). */
    surChangement(f) { surChangement = f; },
    async enAttente() {
      return (await toutLire("envois")).map(([id, v]) => ({ id, ...v }));
    },
    /** Données et pages compactées, telles qu'on les envoie. */
    async complete(id) {
      const [donnees, pages] = await Promise.all([lireCle("partitions", id), lireCle("pages", id)]);
      return donnees ? { donnees: normaliserFiche(donnees), pages: pages || [] } : null;
    },
    /** Tout ce que la synchro doit savoir d'une partition, lu d'un coup : la fiche, son envoi en attente, sa base (et ses pages). */
    etatSynchro(id, { pages = false } = {}) {
      return transaction(["partitions", "envois", "bases", "pages"], "readonly", (o) => {
        const etat = { fiche: null, pagesLeLocal: null, envoi: null, base: null, pages: null };
        o.lire("partitions", id, (brute) => {
          etat.fiche = brute ? normaliserFiche(brute) : null;
          etat.pagesLeLocal = brute && typeof brute.pagesLe === "string" ? brute.pagesLe : null; // d'avant les bases
        });
        o.lire("envois", id, (e) => { etat.envoi = e || null; });
        o.lire("bases", id, (b) => { etat.base = b || null; });
        if (pages) o.lire("pages", id, (p) => { etat.pages = p || []; });
        o.resultat = etat;
      });
    },
    /**
     * Juste avant d'envoyer : si la réponse se perd, on reconnaîtra notre envoi
     * quand il reviendra. `enVol` : { modifieLe, empreinte (du contenu envoyé), supprime }.
     */
    marquerEnVol(id, enVol) {
      return transaction(["bases"], "readwrite", (o) => o.lire("bases", id, (b) => o.mettre("bases", { ...(b || {}), enVol }, id)));
    },
    /** L'envoi `numero` est accepté : la fiche de la bibliothèque devient la base ; l'envoi part, sauf si la partition a encore changé entre-temps. */
    async envoye(id, numero, fiche = null) {
      await transaction(["envois", "bases"], "readwrite", (o) => {
        o.lire("envois", id, (e) => { if (e && (e.numero ?? null) === (numero ?? null)) o.effacer("envois", id); });
        if (fiche) o.mettre("bases", baseDe(fiche), id);
      });
    },
    /**
     * Range ce que la synchro a décidé pour une partition, si rien n'a bougé
     * ici depuis qu'elle l'a lue (même envoi en attente, même version) ;
     * sinon rien, et false : la synchro recommence avec l'état neuf.
     * `donnees` null : la partition part d'ici. `pages` (compactées) : les
     * nouvelles, ou undefined. `base` : la fiche de la bibliothèque commune.
     * `envoyer` : false, ou { pages } (ce qui reste à envoyer).
     */
    async appliquerSynchro(id, { attendu, donnees, pages, base: b, envoyer = false, visible = true }) {
      const fait = await transaction(["partitions", "pages", "envois", "bases"], "readwrite", (o) => {
        o.lire("envois", id, (e) => o.lire("partitions", id, (brute) => {
          const numero = e ? e.numero ?? null : null;
          const modifieLe = brute ? normaliserFiche(brute)?.modifieLe ?? null : null;
          if (numero !== attendu.numero || modifieLe !== attendu.modifieLe) return;
          if (donnees === null) { o.effacer("partitions", id); o.effacer("pages", id); }
          else {
            o.mettre("partitions", normaliserFiche(donnees) || donnees, id);
            if (pages !== undefined && pages !== null) o.mettre("pages", pages, id);
          }
          if (b) o.mettre("bases", baseDe(b), id);
          if (envoyer) o.mettre("envois", { numero: numeroEnvoi(), modifieLe: donnees ? donnees.modifieLe : (e && e.modifieLe) || new Date().toISOString(), pages: !!envoyer.pages, supprime: donnees === null }, id);
          else o.effacer("envois", id);
          o.resultat = true;
        }));
      });
      if (fait && visible) apres([id], { synchro: false });
      return !!fait;
    },
    /** Une partition venue d'un autre appareil (pages compactées, ou null si inchangées). */
    async recevoir(id, donnees, pages) {
      const d = normaliserFiche(donnees);
      if (!d) throw new Error("Fiche illisible.");
      await transaction(["partitions", "pages"], "readwrite", (o) => {
        o.mettre("partitions", d, id);
        if (pages) o.mettre("pages", pages, id);
      });
      apres([id], { synchro: false });
    },
    async retirer(id) {
      await transaction(["partitions", "pages", "envois"], "readwrite", (o) => { o.effacer("partitions", id); o.effacer("pages", id); o.effacer("envois", id); });
      apres([id], { synchro: false });
    },
    /**
     * Tout mettre à envoyer : la première fois qu'un appareil rejoint une
     * bibliothèque commune. Les bases et la quarantaine d'une autre
     * bibliothèque (une autre adresse) ne valent plus rien ici.
     */
    async toutEnvoyer() {
      const fiches = await toutLire("partitions");
      const quarantaine = await toutLire("meta", IDBKeyRange.bound(QUARANTAINE, QUARANTAINE + "￿"));
      await transaction(["envois", "bases", "meta"], "readwrite", (o) => {
        o.t.objectStore("bases").clear();
        for (const [cle] of quarantaine) o.effacer("meta", cle);
        for (const [id, brute] of fiches) {
          const d = normaliserFiche(brute);
          o.lire("envois", id, (avant) => o.mettre("envois", envoi({ modifieLe: (d && d.modifieLe) || new Date().toISOString(), pages: true }, avant), id));
        }
      });
    },
    lireMeta: (cle) => lireCle("meta", cle),
    ecrireMeta: (cle, valeur) => transaction(["meta"], "readwrite", (o) => { o.mettre("meta", valeur, cle); }),
    /** Ce que la synchro a mis de côté : [{ id, sens: "envoi" | "reception", raison, le, … }]. */
    async quarantaine() {
      return (await toutLire("meta", IDBKeyRange.bound(QUARANTAINE, QUARANTAINE + "￿"))).map(([, v]) => v);
    },
    mettreEnQuarantaine: (q) => transaction(["meta"], "readwrite", (o) => { o.mettre("meta", q, `${QUARANTAINE}${q.sens}:${q.id}`); }),
    /** Lève la quarantaine de `id` (à l'envoi, à la réception, ou les deux sans `sens`). */
    leverQuarantaine: (id, sens = null) => transaction(["meta"], "readwrite", (o) => {
      for (const s of sens ? [sens] : ["envoi", "reception"]) o.effacer("meta", `${QUARANTAINE}${s}:${id}`);
    }),
  };
}

// ------------------------------------------------------------------------
// L'état du stockage de ce navigateur (D9) : l'écran viendra ensuite
// ------------------------------------------------------------------------

/**
 * Ce qui protège la bibliothèque de ce navigateur. Safari efface au bout de
 * 7 jours sans visite tout ce qu'un site garde (IndexedDB compris), sauf pour
 * une appli ajoutée à l'écran d'accueil ; ailleurs, un navigateur à court de
 * place peut effacer un site que rien ne protège.
 * @returns { protege (true, false, ou null si on ne sait pas), utilise, quota
 *   (octets, ou null), installee, ios, safari, risque (on peut perdre la
 *   bibliothèque sans le vouloir) }
 */
export async function etatStockage() {
  const nav = typeof navigator !== "undefined" ? navigator : {};
  const s = nav.storage || {};
  const protege = typeof s.persisted === "function" ? await s.persisted().catch(() => null) : null;
  const estimation = typeof s.estimate === "function" ? await s.estimate().catch(() => null) : null;
  const installee = (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches) || nav.standalone === true;
  const ua = nav.userAgent || "";
  const ios = /iPad|iPhone|iPod/.test(ua) || (nav.platform === "MacIntel" && nav.maxTouchPoints > 1);
  const safari = ios || (/Safari\//.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR/.test(ua));
  return {
    protege,
    utilise: estimation && Number.isFinite(estimation.usage) ? estimation.usage : null,
    quota: estimation && Number.isFinite(estimation.quota) ? estimation.quota : null,
    installee: !!installee,
    ios,
    safari,
    risque: (safari && !installee) || protege === false,
  };
}

/** Redemande au navigateur de protéger la bibliothèque ; rend sa réponse (true, false, ou null s'il ne sait pas faire). */
export async function demanderProtection() {
  try { return await navigator.storage.persist(); } catch { return null; }
}

// ------------------------------------------------------------------------
// Sauvegarde : toute la bibliothèque dans un fichier, et retour
// ------------------------------------------------------------------------

/** Toute la bibliothèque, traits compris, en un objet JSON. */
export async function sauvegarde(stockage, partitions) {
  const sortie = [];
  for (const p of partitions) {
    const { id, ...donnees } = p;
    if (p.type) {
      // Une idée ou un morceau : pas de traits ; le mémo vocal, s'il y en a un.
      const memo = stockage.lireMemo ? await stockage.lireMemo(id).catch(() => null) : null;
      sortie.push(memo ? { id, donnees, pages: [], memo } : { id, donnees, pages: [] });
      continue;
    }
    const pages = await stockage.pages(id, p.nbPages || 0).catch(() => []);
    sortie.push({ id, donnees, pages: pages.map(compacter) });
  }
  return { format: FORMAT_SAUVEGARDE, version: 1, creeLe: new Date().toISOString(), partitions: sortie };
}

/** Des pages compactées : chaque page, une liste de traits ; chaque trait, des nombres (x et y alternés). */
const traitsValides = (pages) => Array.isArray(pages) && pages.every((p) => Array.isArray(p) && p.every((t) => Array.isArray(t) && t.every((n) => Number.isFinite(n))));

/**
 * Remet une sauvegarde dans la bibliothèque (D5). Une partition absente
 * d'ici revient, même si elle a été supprimée ailleurs depuis : elle prend
 * la date d'aujourd'hui (dans l'ordre d'origine), et la synchronisation la
 * fait revenir partout au lieu de la re-supprimer (S4). Une partition déjà
 * là reste telle quelle. Une erreur sur une partition n'arrête pas les
 * autres.
 * @returns { revenues, ignorees (déjà là), differentes (déjà là, mais pas
 *   identiques : gardées telles quelles), echecs: [{ id, titre, raison }],
 *   ajoutees (= revenues, nom d'avant) }
 */
export async function restaurer(stockage, contenu, _dejaLa = null) {
  if (!contenu || contenu.format !== FORMAT_SAUVEGARDE || !Array.isArray(contenu.partitions)) {
    throw new Error("Ce fichier n'est pas une sauvegarde de Portée.");
  }
  const bilan = { revenues: 0, ignorees: 0, differentes: 0, echecs: [] };
  // De la plus ancienne à la plus récente : les dates neuves gardent l'ordre du carnet.
  const entrees = contenu.partitions
    .map((e, i) => ({ e, i, quand: dateIso(e && e.donnees && e.donnees.modifieLe) || EPOQUE }))
    .sort((a, b) => a.quand.localeCompare(b.quand) || a.i - b.i)
    .map((x) => x.e);
  // Un identifiant que la bibliothèque commune refuserait (sauvegarde
  // bricolée, ou d'un autre outil) : la partition revient sous un
  // identifiant neuf, et les morceaux qui la citent suivent (S5).
  const renommees = new Map();
  for (const e of entrees) if (e && typeof e.id === "string" && e.id && !ID_VALIDE.test(e.id)) renommees.set(e.id, nouvelId());
  const depart = Date.now();
  let rang = 0;
  for (const e of entrees) {
    const titre = e && e.donnees && typeof e.donnees.titre === "string" ? e.donnees.titre : "Sans titre";
    try {
      if (!e || typeof e.id !== "string" || !e.id) throw new Error("pas d'identifiant");
      const donnees = normaliserFiche(e.donnees);
      if (!donnees) throw new Error("fiche illisible");
      const id = renommees.get(e.id) || e.id;
      if (donnees.type === "morceau") donnees.blocs = donnees.blocs.map((b) => (renommees.has(b.idee) ? { ...b, idee: renommees.get(b.idee) } : b));
      const ici = await stockage.lire(id);
      if (ici) {
        bilan.ignorees++;
        const { id: _i, ...dIci } = ici;
        if (!egal(sansDates(dIci), sansDates(donnees))) bilan.differentes++;
        continue;
      }
      donnees.modifieLe = new Date(depart + rang++).toISOString();
      const pages = !donnees.type && traitsValides(e.pages) ? e.pages.map(decompacter) : [];
      const memo = e.memo && typeof e.memo === "object" && typeof e.memo.base64 === "string" ? e.memo : null;
      await stockage.creer(id, donnees, pages, { memo });
      bilan.revenues++;
    } catch (err) {
      bilan.echecs.push({ id: e && e.id, titre, raison: (err && err.message) || String(err) });
    }
  }
  return { ...bilan, ajoutees: bilan.revenues };
}

function telechargerNavigateur(nom, donnees) {
  const blob = donnees instanceof Blob ? donnees : new Blob([donnees]);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nom; a.hidden = true;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return Promise.resolve({ status: "saved" });
}
