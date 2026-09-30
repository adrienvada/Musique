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
 */

const CLE_LOCALE = "portee:partitions";
const FORMAT_SAUVEGARDE = "portee-sauvegarde";

/** Traits → entiers au demi-pixel près : deux fois plus léger, aucune perte utile. */
export function compacter(traits) {
  return traits.map((t) => t.flatMap(([x, y]) => [Math.round(x * 2), Math.round(y * 2)]));
}
export function decompacter(compacts) {
  return compacts.map((t) => {
    const pts = [];
    for (let i = 0; i < t.length; i += 2) pts.push([t[i] / 2, t[i + 1] / 2]);
    return pts;
  });
}

export function nouvelId() {
  return "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export async function ouvrirStockage() {
  const claude = window.claude;
  const use = claude && typeof claude.use === "function" ? (n) => claude.use(n).catch(() => null) : async () => null;
  const [db, downloads] = await Promise.all([use("db"), use("downloads")]);
  if (db) return stockageClaude(db, downloads);
  try {
    return await stockageIndexe();
  } catch (e) {
    console.warn("IndexedDB indisponible, repli sur localStorage", e);
    return stockageLocal();
  }
}

function stockageClaude(db, downloads) {
  const col = db.collection("partitions");
  return {
    mode: "claude",
    midiDirect: false, // la liste des téléchargements de claude.ai ignore .mid
    ecouter(rappel, erreur) {
      return col.orderBy("modifieLe", "desc").onSnapshot(
        (snap) => rappel(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (e) => erreur && erreur(e),
      );
    },
    async lire(id) {
      const d = await col.doc(id).get();
      return d.exists ? { id, ...d.data() } : null;
    },
    async pages(id, nb) {
      const sortie = [];
      for (let n = 1; n <= nb; n++) {
        const d = await db.doc(`partitions/${id}/pages/${n}`).get();
        sortie.push(d.exists ? decompacter(d.data().traits) : []);
      }
      return sortie;
    },
    async creer(id, donnees, pages) {
      // Les pages d'abord : une partition visible a toujours ses traits.
      for (let n = 0; n < pages.length; n++) {
        await db.doc(`partitions/${id}/pages/${n + 1}`).set({ traits: compacter(pages[n]) });
      }
      await col.doc(id).set(donnees);
    },
    async modifier(id, patch) {
      await col.doc(id).update(patch);
    },
    async supprimer(id, nb) {
      await col.doc(id).delete();
      for (let n = 1; n <= nb; n++) await db.doc(`partitions/${id}/pages/${n}`).delete();
    },
    async enregistrerFichier(nom, donnees) {
      if (!downloads) return telechargerNavigateur(nom, donnees);
      return downloads.save({ filename: nom, data: donnees });
    },
  };
}

function stockageLocal() {
  const abonnes = new Set();
  const lireTout = () => {
    try { return JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}"); } catch { return {}; }
  };
  const ecrireTout = (tout) => {
    try { localStorage.setItem(CLE_LOCALE, JSON.stringify(tout)); }
    catch { throw new Error("Le stockage de ce navigateur est plein : supprime une partition ou ouvre l'appli sur claude.ai."); }
    const liste = Object.entries(tout).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || ""));
    abonnes.forEach((f) => f(liste));
  };
  return {
    mode: "local",
    midiDirect: true,
    ecouter(rappel) {
      abonnes.add(rappel);
      const tout = lireTout();
      rappel(Object.entries(tout).map(([id, d]) => ({ id, ...d })).sort((a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || "")));
      return () => abonnes.delete(rappel);
    },
    async lire(id) {
      const d = lireTout()[id];
      return d ? { id, ...d } : null;
    },
    async pages(id) {
      try { return JSON.parse(localStorage.getItem(`portee:pages:${id}`) || "[]").map(decompacter); } catch { return []; }
    },
    async creer(id, donnees, pages) {
      try { localStorage.setItem(`portee:pages:${id}`, JSON.stringify(pages.map(compacter))); } catch { /* sans traits, la partition reste lisible */ }
      const tout = lireTout(); tout[id] = donnees; ecrireTout(tout);
    },
    async modifier(id, patch) {
      const tout = lireTout(); if (!tout[id]) return;
      tout[id] = { ...tout[id], ...patch }; ecrireTout(tout);
    },
    async supprimer(id) {
      const tout = lireTout(); delete tout[id]; ecrireTout(tout);
      try { localStorage.removeItem(`portee:pages:${id}`); } catch { /* rien à faire */ }
    },
    async enregistrerFichier(nom, donnees) {
      return telechargerNavigateur(nom, donnees);
    },
  };
}

// ------------------------------------------------------------------------
// IndexedDB : deux magasins, « partitions » (id → données) et « pages »
// (id → pages compactées, lues seulement à l'ouverture de l'atelier).
// ------------------------------------------------------------------------

const requete = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });

function ouvrirBase() {
  return new Promise((ok, ko) => {
    if (typeof indexedDB === "undefined") { ko(new Error("pas d'IndexedDB")); return; }
    const r = indexedDB.open("portee", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("partitions");
      r.result.createObjectStore("pages");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
    r.onblocked = () => ko(new Error("base bloquée par un autre onglet"));
  });
}

async function stockageIndexe() {
  const base = await ouvrirBase();
  const abonnes = new Set();
  const magasin = (nom, mode = "readonly") => base.transaction(nom, mode).objectStore(nom);
  const ecrire = (nom, f) => new Promise((ok, ko) => {
    const t = base.transaction(nom, "readwrite");
    f(t.objectStore(nom));
    t.oncomplete = () => ok();
    t.onerror = () => ko(t.error);
    t.onabort = () => ko(t.error || new Error("écriture annulée (stockage plein ?)"));
  });
  const liste = async () => {
    const [cles, valeurs] = await Promise.all([requete(magasin("partitions").getAllKeys()), requete(magasin("partitions").getAll())]);
    return valeurs.map((d, i) => ({ id: cles[i], ...d })).sort((a, b) => (b.modifieLe || "").localeCompare(a.modifieLe || ""));
  };
  const prevenir = async () => { const l = await liste(); abonnes.forEach((f) => f(l)); };

  // Une bibliothèque rangée par une version précédente dans localStorage
  // passe dans IndexedDB, une fois.
  try {
    const ancien = JSON.parse(localStorage.getItem(CLE_LOCALE) || "{}");
    for (const [id, d] of Object.entries(ancien)) {
      const pages = JSON.parse(localStorage.getItem(`portee:pages:${id}`) || "[]");
      await ecrire("pages", (m) => m.put(pages, id));
      await ecrire("partitions", (m) => m.put(d, id));
      localStorage.removeItem(`portee:pages:${id}`);
    }
    localStorage.removeItem(CLE_LOCALE);
  } catch { /* rien à reprendre */ }

  // Demande au navigateur de ne pas effacer la bibliothèque quand il manque de place.
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch { /* facultatif */ }

  return {
    mode: "local",
    midiDirect: true,
    ecouter(rappel, erreur) {
      abonnes.add(rappel);
      liste().then(rappel, (e) => erreur && erreur(e));
      return () => abonnes.delete(rappel);
    },
    async lire(id) {
      const d = await requete(magasin("partitions").get(id));
      return d ? { id, ...d } : null;
    },
    async pages(id) {
      const p = await requete(magasin("pages").get(id));
      return (p || []).map(decompacter);
    },
    async creer(id, donnees, pages) {
      await ecrire("pages", (m) => m.put(pages.map(compacter), id));
      await ecrire("partitions", (m) => m.put(donnees, id));
      prevenir();
    },
    async modifier(id, patch) {
      const d = await requete(magasin("partitions").get(id));
      if (!d) return;
      await ecrire("partitions", (m) => m.put({ ...d, ...patch }, id));
      prevenir();
    },
    async supprimer(id) {
      await ecrire("partitions", (m) => m.delete(id));
      await ecrire("pages", (m) => m.delete(id));
      prevenir();
    },
    async enregistrerFichier(nom, donnees) {
      return telechargerNavigateur(nom, donnees);
    },
  };
}

// ------------------------------------------------------------------------
// Sauvegarde : toute la bibliothèque dans un fichier, et retour
// ------------------------------------------------------------------------

/** Toute la bibliothèque, traits compris, en un objet JSON. */
export async function sauvegarde(stockage, partitions) {
  const sortie = [];
  for (const p of partitions) {
    const { id, ...donnees } = p;
    const pages = await stockage.pages(id, p.nbPages || 0).catch(() => []);
    sortie.push({ id, donnees, pages: pages.map(compacter) });
  }
  return { format: FORMAT_SAUVEGARDE, version: 1, creeLe: new Date().toISOString(), partitions: sortie };
}

/** Remet une sauvegarde dans la bibliothèque ; les partitions déjà là sont gardées telles quelles. */
export async function restaurer(stockage, contenu, dejaLa) {
  if (!contenu || contenu.format !== FORMAT_SAUVEGARDE || !Array.isArray(contenu.partitions)) {
    throw new Error("Ce fichier n'est pas une sauvegarde de Portée.");
  }
  let ajoutees = 0;
  for (const { id, donnees, pages } of contenu.partitions) {
    if (!id || !donnees || dejaLa.has(id)) continue;
    await stockage.creer(id, donnees, (pages || []).map(decompacter));
    ajoutees++;
  }
  return { ajoutees, ignorees: contenu.partitions.length - ajoutees };
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
